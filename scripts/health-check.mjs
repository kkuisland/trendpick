// 사이트 건강검진: 케이트렌드·AI Wave 의 공개 페이지가 정상인지 매일 확인한다. 읽기만 하고 아무것도 바꾸지 않는다.
// 사용: node scripts/health-check.mjs [--json] [--external]
//   --json      결과를 JSON 으로 출력 (루틴·스크립트용)
//   --external  본문의 외부 링크(공식 출처 등)도 확인한다. 느리고 정부 사이트가 로봇을 막기도 해서 주 1회 정도만.
// 점검 대상은 config/health-check.json, 판정 기준과 루틴 절차는 docs/HEALTH-CHECK.md.
//
// 요청은 curl 로 보낸다. 클라우드 루틴 샌드박스는 프록시 환경변수로만 밖에 나갈 수 있는데,
// curl 은 이를 따르고 Node 의 fetch 는 따르지 않는다. Windows 에도 curl.exe 가 기본으로 있다.
// 종료 코드: 0 이상 없음 / 1 주의만 있음 / 2 문제 있음
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { p } from './lib/util.mjs';

const args = new Set(process.argv.slice(2));
const AS_JSON = args.has('--json');
const EXTERNAL = args.has('--external');
const cfg = JSON.parse(readFileSync(p('config', 'health-check.json'), 'utf8'));
const UA = cfg.userAgent;
const SLOW = cfg.slowSeconds ?? 3;
const MARK = '\n@@HC@@';

/** 한 번 요청: 상태 코드·걸린 시간·리디렉션 주소·본문(텍스트일 때만) */
function fetchOnce(url, { body = true } = {}) {
  return new Promise((resolve) => {
    const argv = ['-sS', '-m', '25', '-A', UA, '-o', body ? '-' : process.platform === 'win32' ? 'NUL' : '/dev/null',
      '-w', `${MARK}%{http_code}\t%{time_total}\t%{content_type}\t%{redirect_url}`, url];
    execFile('curl', argv, { maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      const i = stdout.lastIndexOf(MARK);
      if (i < 0) return resolve({ url, status: 0, time: 0, type: '', location: '', text: '', error: (stderr || err?.message || '').trim() });
      const [status, time, type, loc = ''] = stdout.slice(i + MARK.length).trim().split('\t');
      const error = status === '000' ? (stderr || '').trim() : '';
      // 클라우드 샌드박스의 프록시가 허용 목록 밖 주소를 막은 경우. 사이트 문제가 아니므로 따로 센다.
      const blocked = /CONNECT tunnel failed|EGRESS/i.test(error);
      resolve({ url, status: Number(status), time: Number(time), type, location: loc, text: body ? stdout.slice(0, i) : '', error, blocked });
    });
  });
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const findings = []; // { site, level: 'error'|'warn'|'skip', what, url }
const add = (site, level, what, url = '') => findings.push({ site, level, what, url });
const stats = {};

const attr = (html, re) => [...html.matchAll(re)].map((m) => m[1]);
const decode = (s) => s.replace(/&amp;/g, '&');

function linksOf(html, pageUrl) {
  const raw = [
    ...attr(html, /<a\s[^>]*href="([^"#][^"]*)"/gi),
    ...attr(html, /<script\s[^>]*src="([^"]+)"/gi),
    ...attr(html, /<img\s[^>]*src="([^"]+)"/gi),
    ...attr(html, /<link\s[^>]*rel="stylesheet"[^>]*href="([^"]+)"/gi),
  ];
  const urls = [];
  for (const r of raw) {
    if (/^(mailto|tel|javascript|data):/i.test(r)) continue;
    try {
      const u = new URL(decode(r), pageUrl);
      u.hash = '';
      urls.push(u.href);
    } catch {
      /* 잘못된 주소는 아래 페이지 검사에서 드러난다 */
    }
  }
  return urls;
}

async function checkSite(site) {
  const S = site.name;
  const host = new URL(site.base).host;
  stats[S] = { pages: 0, links: 0, slow: 0 };

  // 1. 첫 화면 — 열리지 않으면 이후 점검은 의미가 없다
  const home = await fetchOnce(site.base + '/');
  if (home.status === 0) {
    add(S, 'error', `첫 화면에 연결하지 못함 (${home.error || '응답 없음'}). 사이트 장애이거나, 점검하는 곳의 네트워크가 막힌 경우`, home.url);
    return;
  }
  if (home.status !== 200) add(S, 'error', `첫 화면 HTTP ${home.status}`, home.url);

  // 2. 필수 파일
  for (const f of site.files || []) {
    const r = await fetchOnce(site.base + f.path, { body: !/\.(png|jpe?g|webp|gif|ico)$/i.test(f.path) });
    if (r.status !== 200) { add(S, 'error', `${f.path} HTTP ${r.status}`, r.url); continue; }
    if (f.mustContain && !r.text.toLowerCase().includes(f.mustContain.toLowerCase())) add(S, 'error', `${f.path} 에 "${f.mustContain}" 이 없음`, r.url);
    if (f.mustNotMatch && new RegExp(f.mustNotMatch, 'mi').test(r.text)) add(S, 'error', `${f.path} 가 사이트 전체를 막고 있음`, r.url);
  }

  // 3. 주소 넘김 (www → 루트 등)
  for (const rd of site.redirects || []) {
    const r = await fetchOnce(rd.from, { body: false });
    if (r.blocked) { add(S, 'skip', '점검하는 곳의 네트워크가 이 주소를 막아 www 넘김을 확인하지 못함', rd.from); continue; }
    const ok = [301, 308].includes(r.status) && r.location === rd.to;
    if (!ok) add(S, rd.level || 'error', `${rd.from} 가 ${rd.to} 로 영구 이동하지 않음 (HTTP ${r.status}${r.location ? ' → ' + r.location : ''}${r.error ? ', ' + r.error : ''})`, rd.from);
  }

  // 4. 어드민 보호 — 로그인 없이 열리면 가장 심각한 문제
  for (const url of site.protected || []) {
    const r = await fetchOnce(url, { body: false });
    if (r.blocked) { add(S, 'skip', '점검하는 곳의 네트워크가 이 주소를 막아 어드민 보호를 확인하지 못함', url); continue; }
    if (r.status === 200) add(S, 'error', '어드민이 로그인 없이 열림 (Cloudflare Access 보호 확인 필요)', url);
    else if (![301, 302, 303, 307].includes(r.status) || !/cloudflareaccess\.com/.test(r.location)) add(S, 'warn', `어드민 응답이 예상과 다름 (HTTP ${r.status}${r.location ? ' → ' + r.location.slice(0, 60) : ''})`, url);
  }

  // 5. 사이트맵의 모든 페이지
  const sm = await fetchOnce(site.base + site.sitemap);
  if (sm.status !== 200) { add(S, 'error', `사이트맵 HTTP ${sm.status}`, sm.url); return; }
  const locs = attr(sm.text, /<loc>([^<]+)<\/loc>/g).map(decode);
  const mods = attr(sm.text, /<lastmod>([^<]+)<\/lastmod>/g);
  if (!locs.length) { add(S, 'error', '사이트맵에 주소가 하나도 없음', sm.url); return; }
  if (site.freshDays && mods.length) {
    const newest = mods.map((d) => Date.parse(d)).filter(Number.isFinite).sort((a, b) => b - a)[0];
    const days = (Date.now() - newest) / 86400000;
    if (days > site.freshDays) add(S, 'warn', `${Math.floor(days)}일째 새 글·갱신이 없음 (매일 발행 루틴 확인)`, sm.url);
  }

  const pages = await pool(locs, cfg.concurrency, (u) => fetchOnce(u));
  stats[S].pages = pages.length;
  const internal = new Set();
  const external = new Set();
  const pageSet = new Set(locs);
  for (const r of pages) {
    if (r.status === 0) { add(S, 'error', `연결 실패 (${r.error || '응답 없음'})`, r.url); continue; }
    if ([301, 302, 307, 308].includes(r.status)) { add(S, 'warn', `사이트맵 주소가 다른 곳으로 넘어감 → ${r.location}`, r.url); continue; }
    if (r.status !== 200) { add(S, 'error', `HTTP ${r.status}`, r.url); continue; }
    if (r.time > SLOW) { stats[S].slow++; add(S, 'warn', `느림 (${r.time.toFixed(1)}초)`, r.url); }
    const html = r.text;
    if (!/<title>[^<]{2,}<\/title>/i.test(html)) add(S, 'error', '제목(<title>)이 비어 있음', r.url);
    if (!/<meta\s+name="description"\s+content="[^"]{10,}"/i.test(html)) add(S, 'warn', '검색 설명(description)이 없거나 너무 짧음', r.url);
    if (/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html)) add(S, 'warn', '사이트맵에 있는데 noindex (검색 제외) 상태', r.url);
    const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
    if (/\[확인 필요\]|여기에 기재하세요/.test(visible)) add(S, 'error', '미완성 표시([확인 필요] 등)가 공개돼 있음', r.url);
    if (visible.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length < 400) add(S, 'warn', '본문이 거의 비어 있음 (얇은 페이지)', r.url);
    for (const l of linksOf(html, r.url)) {
      const h = new URL(l).host;
      if (h === host) {
        // /cdn-cgi/ 는 Cloudflare 가 이메일 주소를 가릴 때 넣는 주소라 로봇에게는 404 가 정상이다.
        if (!pageSet.has(l) && !/\/_next\/|\/cdn-cgi\//.test(l)) internal.add(l);
      } else if (!/(^|\.)admin\./.test(h)) external.add(l);
    }
  }

  // 6. 페이지 안의 내부 링크·도구 스크립트·이미지 (사이트맵 밖의 것만)
  const linkList = [...internal];
  stats[S].links = linkList.length;
  const linkResults = await pool(linkList, cfg.concurrency, (u) => fetchOnce(u, { body: false }));
  for (const r of linkResults) {
    if (r.status === 0) add(S, 'warn', `내부 링크 연결 실패 (${r.error || '응답 없음'})`, r.url);
    else if (r.status >= 400) add(S, 'error', `깨진 내부 링크·파일 HTTP ${r.status}`, r.url);
  }

  // 7. (선택) 외부 링크 — 주의로만 알린다. 정부·대학 사이트는 로봇 요청을 막는 일이 잦다.
  if (EXTERNAL) {
    const ext = [...external].filter((u) => /^https?:/.test(u));
    stats[S].external = ext.length;
    const res = await pool(ext, 4, (u) => fetchOnce(u, { body: false }));
    for (const r of res) if (r.status === 404 || r.status === 410) add(S, 'warn', `외부 링크가 없어짐 HTTP ${r.status}`, r.url);
  }
}

const started = Date.now();
for (const site of cfg.sites) await checkSite(site);
const errors = findings.filter((f) => f.level === 'error');
const warns = findings.filter((f) => f.level === 'warn');
const skips = findings.filter((f) => f.level === 'skip');
const code = errors.length ? 2 : warns.length ? 1 : 0;

if (AS_JSON) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), stats, errors, warns, skips }, null, 2));
} else {
  const kst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  console.log(`🩺 사이트 건강검진 ${kst} KST (${Math.round((Date.now() - started) / 1000)}초)`);
  for (const [name, s] of Object.entries(stats)) console.log(`   ${name}: 페이지 ${s.pages}개 · 내부 링크 ${s.links}개${s.external != null ? ` · 외부 링크 ${s.external}개` : ''}`);
  if (!errors.length && !warns.length) console.log('✅ 이상 없음');
  for (const [title, list] of [['❌ 문제', errors], ['⚠️ 주의', warns], ['ℹ️ 확인 못 함', skips]]) {
    if (!list.length) continue;
    console.log(`\n${title} ${list.length}건`);
    for (const f of list) console.log(`   - [${f.site}] ${f.what}${f.url ? `  ${f.url}` : ''}`);
  }
}
process.exit(code);
