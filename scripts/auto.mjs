// 자동 이슈 체크 → 선별 → 초안/발행 루틴 (하루 여러 번 실행 전제)
// 사용: node scripts/auto.mjs [--run morning|noon|evening] [--dry] [--force] [--locale ko|en]
//
// 하루 여러 번 돌아도 안전하도록 3중 가드를 둔다:
//   ① 일일 총량 한도 (automation.maxPostsPerDay) — data/state/published.json 으로 추적
//   ② 회당 한도 (automation.maxPostsPerRun)
//   ③ 중복 방지 — 이미 다룬 주제(키워드/이벤트)는 재작성 대신 건너뛰기
// 점수 하한(minScore) 미달이면 "쓸 게 없으면 안 쓴다" — 빈 글 양산 방지.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  p, readConfig, readText, listFiles, parseFrontMatter, todayKST, nowKST,
} from './lib/util.mjs';
import { collect } from './collect.mjs';
import { buildPlanReport } from './plan.mjs';
import { generatePost } from './new-post.mjs';
import { buildSite } from './build.mjs';
import { pingIndexNow } from './indexnow.mjs';

/**
 * 오늘 이미 만들어진 글 수를 실제 콘텐츠 파일에서 센다.
 * 별도 상태 파일을 쓰지 않으므로 CI가 매번 새로 체크아웃해도 정확하고,
 * 사람이 손으로 쓴 글도 한도에 함께 반영된다.
 */
function countTodayPosts() {
  const today = todayKST();
  const dirs = [['content', 'posts'], ['content', 'en', 'posts']];
  const found = [];
  for (const dir of dirs) {
    for (const file of listFiles(p(...dir))) {
      const { meta } = parseFrontMatter(readText(file));
      if (meta.date === today) found.push({ slug: path.basename(file, '.md'), title: meta.title || '' });
    }
  }
  return found;
}

/** 실행 시각대 라벨 (KST) */
function runLabel() {
  const h = nowKST().getUTCHours();
  if (h < 11) return 'morning';
  if (h < 17) return 'noon';
  return 'evening';
}

export async function runAuto(argv = []) {
  const config = readConfig();
  const dry = argv.includes('--dry');
  const force = argv.includes('--force');
  const runIdx = argv.indexOf('--run');
  const label = runIdx !== -1 ? argv[runIdx + 1] : runLabel();
  const localeIdx = argv.indexOf('--locale');
  const forceLocale = localeIdx !== -1 ? argv[localeIdx + 1] : '';
  // 주제를 직접 지정하면 자동 선별을 건너뛴다 (수동 실행용)
  const topicIdx = argv.indexOf('--topic');
  const manualTopic = topicIdx !== -1 ? argv[topicIdx + 1] : '';
  const catIdx = argv.indexOf('--category');
  const manualCategory = catIdx !== -1 ? argv[catIdx + 1] : '';
  const evIdx = argv.indexOf('--event');
  const manualEvent = evIdx !== -1 ? argv[evIdx + 1] : '';

  const auto = config.automation;
  const today = todayKST();
  const todayPosts = countTodayPosts();

  console.log(`\n🤖 자동 루틴 [${label}] ${today} KST`);
  console.log(`   오늘 작성된 글: ${todayPosts.length}/${auto.maxPostsPerDay}개`);

  // ---------- 1. 수집 ----------
  console.log('\n① 이슈 수집');
  try {
    await collect();
  } catch (err) {
    console.warn('   수집 실패(계속):', err.message || err);
  }

  // ---------- 2. 기획 ----------
  // 기획 리포트는 기존 글 목록과 대조해 이미 다룬 주제를 후보에서 빼므로
  // (plan.mjs 의 isCovered) 별도 중복 추적이 필요 없다.
  console.log('\n② 주제 선별');
  const plan = buildPlanReport();
  let recs = plan.recommendations || [];
  if (manualTopic) {
    recs = [{
      topic: manualTopic,
      category: manualCategory,
      event: manualEvent,
      score: 999,
      blocked: false,
      why: '수동 지정',
    }];
    console.log(`   수동 지정: ${manualTopic}`);
  } else {
    console.log(`   후보 ${recs.length}건`);
  }

  // ---------- 3. 게이트 ----------
  const perRun = auto.maxPostsPerRun || 1;
  // --force 는 사람이 직접 내린 결정이므로 자동 실행용 가드(autoGenerate·일일 한도)를 모두 넘어선다.
  const remainingToday = force
    ? perRun
    : Math.max(0, auto.maxPostsPerDay - todayPosts.length);
  let quota = Math.min(remainingToday, perRun);

  if (!auto.autoGenerate && !force) {
    console.log('\n③ 생성 — 건너뜀 (automation.autoGenerate: false, --force 로 강제 가능)');
    quota = 0;
  } else if (quota === 0) {
    console.log(`\n③ 생성 — 건너뜀 (오늘 한도 ${auto.maxPostsPerDay}개 소진, --force 로 강제 가능)`);
  } else if (force && todayPosts.length >= auto.maxPostsPerDay) {
    console.log(`\n   (수동 실행 --force: 일일 한도 ${auto.maxPostsPerDay}개를 넘겨 진행)`);
  }

  const created = [];
  if (quota > 0) {
    // 점수 하한 + 중복 제거
    const blockedCount = recs.filter((r) => r.blocked).length;
    if (blockedCount) console.log(`   (민감 주제 ${blockedCount}건은 자동 생성에서 제외 — 기획 리포트에서 확인)`);
    const eligible = recs
      .filter((r) => !r.blocked)
      .filter((r) => r.score >= (auto.minScore ?? 55));

    if (!eligible.length) {
      console.log(`\n③ 생성 — 건너뜀 (점수 ${auto.minScore ?? 55} 이상 신규 주제 없음)`);
      console.log('   → 억지로 쓰지 않는 것이 정상 동작입니다.');
    } else {
      console.log(`\n③ 생성 (${Math.min(quota, eligible.length)}건 / 적격 ${eligible.length}건)`);
      const publish = auto.autoPublish;
      for (const rec of eligible.slice(0, quota)) {
        console.log(`   → [${rec.score}] ${rec.topic}`);
        if (dry) {
          created.push({ topic: rec.topic, dry: true });
          continue;
        }
        try {
          const r = await generatePost({
            topic: rec.topic,
            category: rec.category,
            event: rec.event,
            publish,
            locale: forceLocale || 'ko',
            templateFallback: false, // 자동 실행에서는 빈 템플릿을 만들지 않는다
          });
          if (r.mode === 'no-auth') break;
          created.push(r);
        } catch (err) {
          console.warn(`   실패(계속): ${err.message || err}`);
        }
      }
    }
  }

  // ---------- 4. 빌드 ----------
  console.log('\n④ 빌드');
  const { posts } = buildSite();

  // ---------- 5. 색인 핑 ----------
  const newUrls = created
    .filter((c) => c.published && c.slug)
    .map((c) => `${config.site.url}${c.locale === 'en' ? '/en' : ''}/posts/${c.slug}/`);
  if (newUrls.length) {
    const r = await pingIndexNow(config, newUrls);
    if (!r.skipped) console.log(`   IndexNow: HTTP ${r.status} (${newUrls.length}개)`);
  }

  const finalToday = dry ? todayPosts.length + created.length : countTodayPosts().length;
  console.log(`\n🏁 완료 — 이번 실행 ${created.length}개, 오늘 누적 ${finalToday}/${auto.maxPostsPerDay}개, 전체 발행 ${posts.length}개`);
  return { created, todayCount: finalToday, posts };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runAuto(process.argv.slice(2)).catch((err) => {
    console.error('자동 루틴 실패:', err);
    process.exit(1);
  });
}
