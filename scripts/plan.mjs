// 콘텐츠 기획 리포트: 이벤트 캘린더 + 수집된 트렌드 → 오늘 쓸 주제 추천
// 사용: node scripts/plan.mjs   (먼저 npm run collect 권장)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  p, readConfig, readJson, readText, writeText, listFiles, parseFrontMatter,
  todayKST, eventStatus, daysUntil, formatKoRange,
} from './lib/util.mjs';

const LEAD_WINDOWS = [30, 14, 7, 3, 1];

function loadAllPosts() {
  return listFiles(p('content', 'posts')).map((file) => {
    const { meta } = parseFrontMatter(readText(file));
    return {
      slug: path.basename(file, '.md'),
      title: meta.title || '',
      tags: meta.tags || [],
      keywords: meta.keywords || [],
      event: meta.event || '',
      draft: meta.draft === true,
    };
  });
}

function isCovered(posts, { keywords = [], event = '' }) {
  return posts.some((post) => {
    if (event && post.event === event) return true;
    const haystack = [post.title, ...post.tags, ...post.keywords].join(' ');
    return keywords.some((k) => k && haystack.includes(k));
  });
}

export function buildPlanReport() {
  const config = readConfig();
  const today = todayKST();
  const events = readJson(p('data', 'events.json'), []);
  const trends = readJson(p('data', 'trends', 'latest.json'), null);
  const posts = loadAllPosts();

  const alerts = [];
  for (const ev of events) {
    const st = eventStatus(ev, today);
    const covered = isCovered(posts, { keywords: ev.keywords, event: ev.key });
    if (st.phase === 'upcoming' && st.days <= 30) {
      const window = LEAD_WINDOWS.find((w) => st.days <= w);
      alerts.push({
        type: 'lead',
        event: ev,
        st,
        covered,
        note: `D-${st.days} — 검색량 급증 전 선점 타이밍${window ? ` (D-${window} 윈도우)` : ''}`,
      });
    } else if (st.phase === 'live') {
      alerts.push({ type: 'live', event: ev, st, covered, note: '진행 중 — 기존 글 업데이트(회전) + 속보성 글 타이밍' });
    } else if (st.phase === 'past' && daysUntil(ev.end || ev.start, today) >= -3) {
      alerts.push({ type: 'recap', event: ev, st, covered, note: '막 종료 — 결과·결산 글 타이밍 (결과 검색 급증)' });
    }
  }

  const trendCands = (trends?.trends || []).slice(0, 10).map((t) => ({
    ...t,
    covered: isCovered(posts, { keywords: [t.keyword] }),
  }));

  // 추천 점수 산정
  const recs = [];
  for (const a of alerts) {
    let score = 0;
    if (a.type === 'live') score = 90;
    else if (a.type === 'recap') score = 85;
    else if (a.st.days <= 1) score = 85;
    else if (a.st.days <= 3) score = 80;
    else if (a.st.days <= 7) score = 70;
    else if (a.st.days <= 14) score = 55;
    else score = 40;
    if (a.covered && a.type === 'lead') score -= 100; // 이미 선점 글 있음
    if (score > 0) {
      const idea = a.type === 'recap' ? `${a.event.name} 최종 결과·결산 총정리` : a.event.ideas?.[0] || `${a.event.name} 총정리`;
      recs.push({
        type: 'event',
        topic: `${a.event.name} — ${idea}`,
        category: a.event.category,
        event: a.event.key,
        score,
        why: a.note,
        command: `npm run new -- "${a.event.name} ${a.type === 'recap' ? '결과 총정리' : '총정리'}" --category "${a.event.category}" --event ${a.event.key}`,
      });
    }
  }
  for (const t of trendCands) {
    if (t.covered) continue;
    let score = t.trafficNum >= 10000 ? 75 : t.trafficNum >= 2000 ? 55 : 35;
    recs.push({
      type: 'trend',
      topic: t.keyword,
      category: '트렌드 이슈',
      event: '',
      score,
      why: `실시간 검색 ${t.traffic}${t.news[0] ? ` · 관련 뉴스: ${t.news[0].slice(0, 50)}` : ''}`,
      command: `npm run new -- "${t.keyword}" --category "트렌드 이슈"`,
    });
  }
  recs.sort((a, b) => b.score - a.score);
  const top = recs.slice(0, 6);

  // 리포트 작성
  const lines = [];
  lines.push(`# 콘텐츠 기획 리포트 — ${today}`);
  lines.push('');
  lines.push('## ① 이벤트 알림 (사전 포지셔닝·회전 타이밍)');
  if (!alerts.length) lines.push('- 30일 내 이벤트 없음');
  for (const a of alerts) {
    lines.push(`- **[${a.st.label}] ${a.event.name}** (${formatKoRange(a.event.start, a.event.end)})${a.covered ? ' ✅ 커버됨' : ' ⬜ 미커버'}`);
    lines.push(`  - ${a.note}`);
    for (const idea of a.event.ideas || []) lines.push(`  - 아이디어: ${idea}`);
  }
  lines.push('');
  lines.push('## ② 실시간 트렌드 후보');
  if (!trendCands.length) lines.push('- 수집 데이터 없음 → `npm run collect` 먼저 실행');
  for (const t of trendCands) {
    lines.push(`- **${t.keyword}** (${t.traffic})${t.covered ? ' ✅ 커버됨' : ''}${t.news[0] ? ` — ${t.news[0]}` : ''}`);
  }
  lines.push('');
  lines.push('## ③ 오늘의 추천 (우선순위 순)');
  top.forEach((r, i) => {
    lines.push(`${i + 1}. **${r.topic}** [${r.category}] (점수 ${r.score})`);
    lines.push(`   - 이유: ${r.why}`);
    lines.push(`   - 실행: \`${r.command}\``);
  });
  lines.push('');
  const report = lines.join('\n');
  const reportPath = p('data', 'plan', `${today}.md`);
  writeText(reportPath, report);

  return { alerts, trendCands, recommendations: top, report, reportPath, config };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { report, reportPath } = buildPlanReport();
  console.log('\n' + report);
  console.log(`저장: ${path.relative(process.cwd(), reportPath)}`);
}
