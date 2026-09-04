// 로컬 미리보기 서버: dist/ 를 http://localhost:4173 으로 서빙
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { p, readConfig } from './lib/util.mjs';
import { routeLanguage, langCookie } from './lib/lang-route.mjs';
import { handleAdminApi, adminApiEnabled } from './lib/admin-api.mjs';

const DIST = p('dist');
const PORT = Number(process.env.PORT || 4173);
let BASE = '';
try {
  BASE = new URL(readConfig().site.url).pathname.replace(/\/+$/, '');
} catch {
  /* url 미설정 */
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

http
  .createServer((req, res) => {
    const [rawPath, rawQuery = ''] = (req.url || '/').split('?');
    let urlPath = decodeURIComponent(rawPath);
    let setLangCookie = null;

    // 어드민 저장 API — 정적 파일보다 먼저 처리한다
    if (urlPath.startsWith('/api/')) {
      handleAdminApi(req, res, urlPath)
        .then((handled) => {
          if (handled) return;
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'not found' }));
        })
        .catch((err) => {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: String(err.message || err) }));
        });
      return;
    }
    // 과거 서브경로(/trendpick) 주소로 들어온 요청은 루트로 영구 이동
    if (!BASE && (urlPath === '/trendpick' || urlPath.startsWith('/trendpick/'))) {
      res.writeHead(301, { location: urlPath.slice('/trendpick'.length) || '/' }).end();
      return;
    }
    // 서브경로 배포(site.url 에 경로 포함) 시 로컬에서도 같은 주소로 미리보기
    if (BASE) {
      if (urlPath === '/' || urlPath === BASE) {
        res.writeHead(301, { location: BASE + '/' }).end();
        return;
      }
      if (urlPath.startsWith(BASE + '/')) urlPath = urlPath.slice(BASE.length);
    }
    // 방문자 언어에 따른 진입 분기 (루트만, 크롤러 제외 — lang-route.mjs 참고)
    {
      const decision = routeLanguage({ urlPath, query: rawQuery, headers: req.headers });
      if (decision.setLang) setLangCookie = langCookie(decision.setLang);
      if (decision.action === 'redirect') {
        res.writeHead(302, {
          location: decision.to,
          // 언어·쿠키에 따라 응답이 달라지므로 중간 캐시가 한 사용자의 결과를
          // 다른 사용자에게 재사용하지 않도록 명시한다.
          vary: 'Accept-Language, Cookie',
          'cache-control': 'no-store',
        }).end();
        return;
      }
    }

    if (urlPath.endsWith('/')) urlPath += 'index.html';
    let file = path.join(DIST, urlPath);
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      res.writeHead(301, { location: urlPath + '/' }).end();
      return;
    }
    if (!fs.existsSync(file)) {
      const notFound = path.join(DIST, '404.html');
      if (fs.existsSync(notFound)) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(notFound));
      } else {
        res.writeHead(404).end('Not Found');
      }
      return;
    }
    const ext = path.extname(file).toLowerCase();
    // 프로덕션(Railway 등)에서도 쓰이므로 HTML은 항상 재검증, 정적 자산은 1시간 캐시
    // 서비스워커는 캐시하지 않는다. 여기에 낡은 사본이 한 시간 남으면
    // 그 사이 방문자는 예전 워커에 붙잡혀 갱신이 그만큼 밀린다.
    const noCache = ext === '.html' || urlPath === '/sw.js';
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': noCache ? 'no-cache' : 'public, max-age=3600',
    };
    // 루트는 언어에 따라 리디렉션될 수 있으므로 캐시 키에 언어를 포함시킨다.
    if (urlPath === '/index.html') headers.vary = 'Accept-Language, Cookie';
    if (setLangCookie) headers['set-cookie'] = setLangCookie;
    res.writeHead(200, headers);
    res.end(fs.readFileSync(file));
  })
  .listen(PORT, () => {
    console.log(`🌐 미리보기: http://localhost:${PORT}  (dist/ 서빙, Ctrl+C 로 종료)`);
    console.log(
      adminApiEnabled()
        ? '🔐 어드민 저장 API 활성화 (/admin/ 에서 바로 저장됩니다)'
        : '🔐 어드민 저장 API 비활성 — ADMIN_PASSWORD·GITHUB_TOKEN 을 설정하면 켜집니다'
    );
  });
