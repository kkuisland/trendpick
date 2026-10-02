// IndexNow 핑: 새 글/수정 글 URL을 검색엔진(네이버·빙 등 IndexNow 참여 엔진)에 즉시 알림
// 사용: node scripts/indexnow.mjs [URL ...] [--live] [--since N]
//   URL 생략 시 사이트맵 전체
//   --live     로컬 dist 대신 라이브 사이트(site.url)의 sitemap.xml 을 읽는다.
//              사장님 PC 의 예약 작업이 쓴다 — 로컬 저장소가 뒤처져 있어도 실제로 올라간 주소를 보낸다.
//   --since N  lastmod 가 최근 N일 안인 주소만 보낸다 (바뀌지 않은 주소를 매일 다시 보내지 않기 위해)
//   --dry      보내지 않고 대상 주소만 출력
// 사전 준비: config/site.config.json → apis.indexnow.key 에 32자 내외 임의 키 설정 후 빌드·배포
//
// 클라우드 루틴의 샌드박스는 IndexNow·ktrend.kr 로 나가는 길이 403 으로 막혀 있다.
// 그래서 색인 요청은 사장님 PC 에서 보낸다 (README 「색인 요청」).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { p, readConfig, readText, listFiles, todayKST, daysUntil } from './lib/util.mjs';

/** sitemap.xml 문자열 → [{ loc, lastmod }] */
function parseSitemap(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)]
    .map((m) => ({
      loc: (m[1].match(/<loc>([^<]+)<\/loc>/) || [])[1],
      lastmod: (m[1].match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1] || '',
    }))
    .filter((u) => u.loc);
}

/**
 * 색인 요청 대상 URL 목록.
 * 빌드된 sitemap.xml 을 우선 사용한다 — 영문 섹션·카테고리·캘린더까지
 * 모두 포함된 권위 있는 목록이기 때문. 없으면 글 파일에서 추정한다.
 */
async function sitemapEntries(config, { live }) {
  if (live) {
    const res = await fetch(`${config.site.url}/sitemap.xml`, { headers: { 'user-agent': 'ktrend-indexnow' } });
    if (!res.ok) throw new Error(`라이브 사이트맵을 읽지 못했습니다 (HTTP ${res.status})`);
    return parseSitemap(await res.text());
  }
  const sitemap = p('dist', 'sitemap.xml');
  if (fs.existsSync(sitemap)) {
    const entries = parseSitemap(readText(sitemap));
    if (entries.length) return entries;
  }
  return listFiles(p('content', 'posts')).map((f) => ({
    loc: `${config.site.url}/posts/${path.basename(f, '.md')}/`,
    lastmod: '',
  }));
}

export async function pingIndexNow(config, urls) {
  const key = config.apis.indexnow.key;
  if (!key) return { skipped: true, reason: 'apis.indexnow.key 미설정' };
  if (!urls.length) return { skipped: true, reason: 'URL 없음' };
  let host;
  try {
    host = new URL(config.site.url).host;
  } catch {
    return { skipped: true, reason: 'site.url 미설정' };
  }
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host,
      key,
      keyLocation: `${config.site.url}/${key}.txt`,
      urlList: urls.slice(0, 100),
    }),
  });
  return { status: res.status, ok: res.ok, count: Math.min(urls.length, 100) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const sinceAt = args.indexOf('--since');
  const since = sinceAt >= 0 ? Number(args[sinceAt + 1]) : NaN;
  const stamp = `[${todayKST()} ${new Date().toTimeString().slice(0, 5)}]`;

  const config = readConfig();
  let urls = args.filter((a) => a.startsWith('http'));
  try {
    if (!urls.length) {
      let entries = await sitemapEntries(config, { live });
      // lastmod 가 없는 항목(소개·카테고리 같은 고정 페이지)은 매일 다시 보낼 이유가 없어 뺀다
      if (Number.isFinite(since)) entries = entries.filter((e) => e.lastmod && daysUntil(e.lastmod.slice(0, 10)) >= -since);
      urls = entries.map((e) => e.loc);
    }
    if (args.includes('--dry')) {
      console.log(`${stamp} 보낼 주소 ${urls.length}개 (--dry, 보내지 않음)\n` + urls.join('\n'));
    } else {
      const r = await pingIndexNow(config, urls);
      if (r.skipped) console.log(`${stamp} IndexNow 건너뜀: ${r.reason}`);
      else console.log(`${stamp} IndexNow 응답: HTTP ${r.status} (${r.count}개 URL${live ? ', 라이브 사이트맵' : ''})`);
      if (!r.skipped && !r.ok) process.exitCode = 1;
    }
  } catch (err) {
    console.log(`${stamp} IndexNow 실패: ${err.message}`);
    process.exitCode = 1;
  }
}
