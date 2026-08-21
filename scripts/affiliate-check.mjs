// 제휴 링크 점검 — 자동 생성 가능한 건 만들고, 사람이 만들어야 하는 건 요청서를 낸다.
//
// 실행 결과:
//   - 자동 생성 가능(트립닷컴처럼 파라미터 방식, 또는 쿠팡 API 권한 보유) → 즉시 반영
//   - 사람이 대시보드에서 만들어야 하는 것 → data/affiliate-request.md 에 요청서 작성
//     (GitHub Actions 가 이 내용으로 이슈를 만들면 GitHub 이 메일로 알려준다)
//
// 사용: node scripts/affiliate-check.mjs [--apply]
//   --apply : 쿠팡 API 로 생성된 링크를 affiliates.json 에 실제로 기록
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  p, readConfig, readJson, writeJson, readText, writeText, listFiles, parseFrontMatter, todayKST,
} from './lib/util.mjs';
import { resolveUrl } from './lib/affiliates.mjs';
import { hasCoupangKeys, createDeeplinks } from './lib/coupang-api.mjs';
import { sendMail, mailConfigured } from './lib/mailer.mjs';

const POST_DIRS = [
  { locale: 'ko', dir: ['content', 'posts'], urlPrefix: '/posts/' },
  { locale: 'en', dir: ['content', 'en', 'posts'], urlPrefix: '/en/posts/' },
];

function loadPosts() {
  const out = [];
  for (const d of POST_DIRS) {
    for (const file of listFiles(p(...d.dir))) {
      const slug = path.basename(file, '.md');
      const raw = readText(file);
      const { meta, body } = parseFrontMatter(raw);
      if (meta.draft === true) continue;
      out.push({
        slug,
        locale: d.locale,
        url: d.urlPrefix + slug + '/',
        title: meta.title || slug,
        category: meta.category || '',
        event: meta.event || '',
        affKeys: [...body.matchAll(/\{\{aff\s+([\w-]+)\}\}/g)].map((m) => m[1]),
      });
    }
  }
  return out;
}

export async function checkAffiliates({ apply = false } = {}) {
  const config = readConfig();
  const reg = readJson(p('data', 'affiliates.json'));
  const events = readJson(p('data', 'events.json'), []);
  const posts = loadPosts();
  const eventByKey = new Map(events.map((e) => [e.key, e]));

  // 모든 링크/그룹 항목을 평평하게 (그룹은 항목 단위로)
  const entries = [];
  for (const [key, l] of Object.entries(reg.links || {})) {
    entries.push({ key, label: l.title || key, partner: l.partner, node: l });
  }
  for (const [key, g] of Object.entries(reg.groups || {})) {
    (g.items || []).forEach((it, i) => {
      entries.push({ key, label: `${g.title} — ${it.label}`, partner: g.partner, node: it, groupIndex: i });
    });
  }

  const missing = [];
  for (const e of entries) {
    const partner = reg.partners?.[e.partner];
    if (!partner?.enabled) continue;
    if (resolveUrl(e.node, partner, 'x')) continue;
    // 이 링크를 실제로 쓰고 있는 글
    const usedBy = posts.filter((post) => post.affKeys.includes(e.key));
    missing.push({ ...e, usedBy, note: e.node.note || '' });
  }

  // 쿠팡 API 로 자동 생성 시도 (누적 판매액 요건 충족 시에만 동작)
  const autoFilled = [];
  const coupangMissing = missing.filter((m) => m.partner === 'coupang' && m.node.sourceUrl);
  if (coupangMissing.length && hasCoupangKeys()) {
    const r = await createDeeplinks(coupangMissing.map((m) => m.node.sourceUrl));
    if (r.ok) {
      r.links.forEach((link, i) => {
        const target = coupangMissing[i];
        if (!target) return;
        target.node.url = link;
        autoFilled.push({ key: target.key, url: link });
      });
      if (apply) writeJson(p('data', 'affiliates.json'), reg);
    } else {
      console.log(`   쿠팡 API 자동 생성 불가: ${r.reason}`);
    }
  }

  const stillMissing = missing.filter((m) => !autoFilled.some((a) => a.key === m.key));

  // 제휴 기회가 있는데 링크가 없는 글 (이벤트에 수익화 메모가 있는 경우)
  const opportunities = posts
    .filter((post) => post.affKeys.length === 0 && post.event && eventByKey.get(post.event)?.monetize)
    .map((post) => ({ post, monetize: eventByKey.get(post.event).monetize }));

  return { config, reg, posts, stillMissing, autoFilled, opportunities };
}

function buildRequest({ config, stillMissing, autoFilled, opportunities }) {
  const today = todayKST();
  const L = [];
  L.push(`> 자동 점검: ${today} (KST) · 사이트: ${config.site.url}`);
  L.push('');

  if (autoFilled.length) {
    L.push(`## ✅ 자동 생성됨 (${autoFilled.length}건)`);
    L.push('');
    for (const a of autoFilled) L.push(`- \`${a.key}\` → ${a.url}`);
    L.push('');
  }

  if (stillMissing.length) {
    L.push(`## 🔗 직접 만들어 주셔야 하는 링크 (${stillMissing.length}건)`);
    L.push('');
    L.push('아래 링크는 대시보드에서만 만들 수 있습니다. 만드신 뒤 URL을 알려주시거나 `data/affiliates.json`에 넣어주세요.');
    L.push('');
    const byPartner = new Map();
    for (const m of stillMissing) {
      if (!byPartner.has(m.partner)) byPartner.set(m.partner, []);
      byPartner.get(m.partner).push(m);
    }
    for (const [partner, items] of byPartner) {
      const guide =
        partner === 'coupang'
          ? '쿠팡 파트너스 → 링크 생성 → **검색 링크** → 키워드 입력 → 생성된 URL 복사'
          : '트립닷컴 제휴 대시보드 → Link Builder → 대상 URL 변환';
      L.push(`### ${partner}`);
      L.push('');
      L.push(`만드는 법: ${guide}`);
      L.push('');
      for (const m of items) {
        L.push(`- [ ] **${m.label}** (\`${m.key}\`)`);
        if (m.note) L.push(`  - 메모: ${m.note}`);
        if (m.usedBy.length) {
          L.push(`  - ⚠️ 이미 글에서 사용 중이라 지금은 빈칸으로 나옵니다:`);
          for (const u of m.usedBy) L.push(`    - ${u.title} → ${config.site.url}${u.url}`);
        }
      }
      L.push('');
    }
  }

  if (opportunities.length) {
    L.push(`## 💡 제휴 링크를 넣으면 좋을 글 (${opportunities.length}건)`);
    L.push('');
    for (const o of opportunities) {
      L.push(`- **${o.post.title}** → ${config.site.url}${o.post.url}`);
      L.push(`  - 연계 아이디어: ${o.monetize}`);
    }
    L.push('');
  }

  if (!stillMissing.length && !opportunities.length) {
    L.push('## ✅ 요청할 항목 없음');
    L.push('');
    L.push('모든 제휴 링크가 연결되어 있고, 링크가 필요한 글도 없습니다.');
  }

  L.push('---');
  L.push('');
  L.push('링크를 넣는 방법: [docs/AFFILIATE.md](../blob/main/docs/AFFILIATE.md)');
  L.push('');
  L.push('트립닷컴은 평범한 trip.com 주소를 `sourceUrl` 에 넣으면 추적 파라미터가 자동으로 붙습니다 — 대시보드에 들어가지 않아도 됩니다.');
  return L.join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const apply = process.argv.includes('--apply');
  const result = await checkAffiliates({ apply });
  const body = buildRequest(result);
  const outFile = p('data', 'affiliate-request.md');
  writeText(outFile, body + '\n');

  console.log(`\n🔗 제휴 링크 점검 — ${todayKST()}`);
  console.log(`   자동 생성 ${result.autoFilled.length}건 · 수동 필요 ${result.stillMissing.length}건 · 기회 ${result.opportunities.length}건`);
  for (const m of result.stillMissing) {
    console.log(`   [수동] ${m.key} — ${m.label}${m.usedBy.length ? ` (글 ${m.usedBy.length}곳에서 사용 중)` : ''}`);
  }
  for (const o of result.opportunities) console.log(`   [기회] ${o.post.title}`);
  console.log(`   요청서: ${path.relative(process.cwd(), outFile)}`);

  const needsRequest = result.stillMissing.length > 0 || result.opportunities.length > 0;

  // SMTP 가 설정돼 있으면 메일로도 보낸다 (--mail 또는 요청 항목이 있을 때)
  if (needsRequest && mailConfigured() && !process.argv.includes('--no-mail')) {
    const r = await sendMail({
      subject: `[케이트렌드] 제휴 링크 요청 ${result.stillMissing.length}건 · 기회 ${result.opportunities.length}건`,
      text: body,
    });
    console.log(r.sent ? `   📧 메일 발송: ${r.to}` : `   📧 메일 미발송: ${r.reason}`);
  } else if (needsRequest && !mailConfigured()) {
    console.log('   📧 SMTP 미설정 — GitHub 이슈 알림만 사용합니다.');
  }

  // 워크플로가 이슈 생성 여부를 판단할 수 있도록 노출
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('node:fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `needs_request=${needsRequest}\n`);
  }
}
