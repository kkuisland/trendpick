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
  p, readConfig, readJson, writeJson, todayKST, nowKST,
} from './lib/util.mjs';
import { collect } from './collect.mjs';
import { buildPlanReport } from './plan.mjs';
import { generatePost } from './new-post.mjs';
import { buildSite } from './build.mjs';
import { pingIndexNow } from './indexnow.mjs';

const STATE_FILE = () => p('data', 'state', 'published.json');

function loadState() {
  const s = readJson(STATE_FILE(), null);
  const today = todayKST();
  if (!s || s.date !== today) return { date: today, runs: [], posts: [], topics: [] };
  return s;
}

function saveState(state) {
  writeJson(STATE_FILE(), state);
}

/** 최근 N일간 다룬 주제인지 (state + 실제 글 목록 양쪽 확인) */
function isDuplicate(topic, event, state, planPosts) {
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');
  const t = norm(topic);
  if (event && state.topics.some((x) => x.event && x.event === event)) return true;
  if (state.topics.some((x) => norm(x.topic) === t)) return true;
  // 기획 리포트가 이미 '커버됨'으로 표시한 주제
  return planPosts.some((x) => norm(x) === t);
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

  const auto = config.automation;
  const state = loadState();
  const today = todayKST();

  console.log(`\n🤖 자동 루틴 [${label}] ${today} KST`);
  console.log(`   오늘 발행: ${state.posts.length}/${auto.maxPostsPerDay}개`);

  // ---------- 1. 수집 ----------
  console.log('\n① 이슈 수집');
  try {
    await collect();
  } catch (err) {
    console.warn('   수집 실패(계속):', err.message || err);
  }

  // ---------- 2. 기획 ----------
  console.log('\n② 주제 선별');
  const plan = buildPlanReport();
  const coveredTitles = [];
  const recs = plan.recommendations || [];
  console.log(`   후보 ${recs.length}건`);

  // ---------- 3. 게이트 ----------
  const remainingToday = Math.max(0, auto.maxPostsPerDay - state.posts.length);
  const perRun = auto.maxPostsPerRun || 1;
  let quota = Math.min(remainingToday, perRun);

  if (!auto.autoGenerate && !force) {
    console.log('\n③ 생성 — 건너뜀 (automation.autoGenerate: false, --force 로 강제 가능)');
    quota = 0;
  } else if (quota === 0) {
    console.log(`\n③ 생성 — 건너뜀 (오늘 한도 ${auto.maxPostsPerDay}개 소진)`);
  }

  const created = [];
  if (quota > 0) {
    // 점수 하한 + 중복 제거
    const blockedCount = recs.filter((r) => r.blocked).length;
    if (blockedCount) console.log(`   (민감 주제 ${blockedCount}건은 자동 생성에서 제외 — 기획 리포트에서 확인)`);
    const eligible = recs
      .filter((r) => !r.blocked)
      .filter((r) => r.score >= (auto.minScore ?? 55))
      .filter((r) => !isDuplicate(r.topic, r.event, state, coveredTitles));

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
          });
          if (r.mode === 'template') {
            console.log('   ⚠️  API 인증 없음 — 템플릿만 생성하고 중단');
            break;
          }
          created.push(r);
          state.posts.push({ slug: r.slug, title: r.title, at: nowKST().toISOString(), run: label });
          state.topics.push({ topic: rec.topic, event: rec.event });
        } catch (err) {
          console.warn(`   실패(계속): ${err.message || err}`);
        }
      }
    }
  }

  state.runs.push({ label, at: nowKST().toISOString(), created: created.length });
  if (!dry) saveState(state);

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

  console.log(`\n🏁 완료 — 이번 실행 ${created.length}개, 오늘 누적 ${state.posts.length}/${auto.maxPostsPerDay}개, 전체 발행 ${posts.length}개`);
  return { created, state, posts };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runAuto(process.argv.slice(2)).catch((err) => {
    console.error('자동 루틴 실패:', err);
    process.exit(1);
  });
}
