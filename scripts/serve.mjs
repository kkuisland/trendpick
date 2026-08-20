// 로컬 미리보기 서버: dist/ 를 http://localhost:4173 으로 서빙
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { p, readConfig } from './lib/util.mjs';

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
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    // 서브경로 배포(site.url 에 경로 포함) 시 로컬에서도 같은 주소로 미리보기
    if (BASE) {
      if (urlPath === '/' || urlPath === BASE) {
        res.writeHead(301, { location: BASE + '/' }).end();
        return;
      }
      if (urlPath.startsWith(BASE + '/')) urlPath = urlPath.slice(BASE.length);
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
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(fs.readFileSync(file));
  })
  .listen(PORT, () => {
    console.log(`🌐 미리보기: http://localhost:${PORT}  (dist/ 서빙, Ctrl+C 로 종료)`);
  });
