// 일일 자동화 파이프라인: 수집 → 기획 → (선택) 초안 자동 생성 → 빌드 → IndexNow
// 사용: node scripts/pipeline.mjs [--generate] [--no-generate] [--publish] [--max N]
//
// 자동 생성은 config/site.config.json → automation.autoGenerate 가 true 이거나
// --generate 플래그를 줄 때만 동작. autoPublish(또는 --publish)가 아니면 draft 로 생성.
import { pathToFileURL } from 'node:url';
import { readConfig } from './lib/util.mjs';
import { collect } from './collect.mjs';
import { buildPlanReport } from './plan.mjs';
import { generatePost } from './new-post.mjs';
import { buildSite } from './build.mjs';
import { pingIndexNow } from './indexnow.mjs';

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

export async function runPipeline(argv = []) {
  const config = readConfig();
  const flagGenerate = argv.includes('--generate');
  const flagNoGenerate = argv.includes('--no-generate');
  const flagPublish = argv.includes('--publish');
  const maxIdx = argv.indexOf('--max');
  const maxOverride = maxIdx !== -1 ? parseInt(argv[maxIdx + 1], 10) : NaN;

  console.log('━━━ 1/4 수집 ━━━');
  try {
    await collect();
  } catch (err) {
    console.warn('수집 실패(계속 진행):', err.message || err);
  }

  console.log('\n━━━ 2/4 기획 ━━━');
  const plan = buildPlanReport();
  console.log(`추천 주제 ${plan.recommendations.length}건 → data/plan/ 리포트 저장`);
  for (const r of plan.recommendations) console.log(`   [${r.score}] ${r.topic}`);

  const doGenerate = !flagNoGenerate && (config.automation.autoGenerate || flagGenerate);
  const publish = config.automation.autoPublish || flagPublish;
  const created = [];
  if (doGenerate && plan.recommendations.length) {
    const max = Number.isFinite(maxOverride) ? maxOverride : config.automation.maxPostsPerDay || 2;
    const picks = plan.recommendations.slice(0, max);
    console.log(`\n━━━ 3/4 초안 생성 (${picks.length}건, ${publish ? '자동 발행' : 'draft'}) ━━━`);
    for (const rec of picks) {
      try {
        const r = await generatePost({
          topic: rec.topic,
          category: rec.category,
          event: rec.event,
          publish,
        });
        if (r.mode === 'generated') created.push(r);
        if (r.mode === 'template') break; // 인증 없음 → 반복 무의미
      } catch (err) {
        console.warn(`   생성 실패(계속): ${rec.topic} — ${err.message || err}`);
      }
    }
  } else {
    console.log('\n━━━ 3/4 초안 생성 — 건너뜀 (automation.autoGenerate: false) ━━━');
  }

  console.log('\n━━━ 4/4 빌드 ━━━');
  const { posts } = buildSite();

  // 새로 "발행"된 글이 있으면 IndexNow 핑
  const newUrls = created.filter((c) => c.published).map((c) => `${config.site.url}/posts/${c.slug}/`);
  if (newUrls.length) {
    const r = await pingIndexNow(config, newUrls);
    if (!r.skipped) console.log(`IndexNow 핑: HTTP ${r.status} (${newUrls.length}개)`);
  }

  console.log(`\n🏁 파이프라인 완료 — 발행 글 ${posts.length}개, 오늘 새 초안 ${created.length}개`);
  return { created, posts };
}

if (isMain) {
  runPipeline(process.argv.slice(2)).catch((err) => {
    console.error('파이프라인 실패:', err);
    process.exit(1);
  });
}
