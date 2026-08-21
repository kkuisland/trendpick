// IndexNow 핑: 새 글/수정 글 URL을 검색엔진(네이버·빙 등 IndexNow 참여 엔진)에 즉시 알림
// 사용: node scripts/indexnow.mjs [URL ...]   (URL 생략 시 사이트맵 전체)
// 사전 준비: config/site.config.json → apis.indexnow.key 에 32자 내외 임의 키 설정 후 빌드·배포
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { p, readConfig, readText, listFiles } from './lib/util.mjs';

/**
 * 색인 요청 대상 URL 목록.
 * 빌드된 sitemap.xml 을 우선 사용한다 — 영문 섹션·카테고리·캘린더까지
 * 모두 포함된 권위 있는 목록이기 때문. 없으면 글 파일에서 추정한다.
 */
function allUrls(config) {
  const sitemap = p('dist', 'sitemap.xml');
  if (fs.existsSync(sitemap)) {
    const locs = [...readText(sitemap).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (locs.length) return locs;
  }
  return listFiles(p('content', 'posts')).map(
    (f) => `${config.site.url}/posts/${path.basename(f, '.md')}/`
  );
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
  const config = readConfig();
  let urls = process.argv.slice(2).filter((a) => a.startsWith('http'));
  if (!urls.length) urls = allUrls(config);
  pingIndexNow(config, urls).then((r) => {
    if (r.skipped) console.log(`IndexNow 건너뜀: ${r.reason}`);
    else console.log(`IndexNow 응답: HTTP ${r.status} (${r.count}개 URL)`);
  });
}
