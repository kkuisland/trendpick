// 꾸아일랜드 커넥터 — 트렌드픽(순수 node:http 서버)용 연결부.
//
// 커넥터 본체(kkuisland-connector.cjs)는 Express 모양의 req/res 를 기대합니다.
// 여기서 그 모양만 얇게 입혀 serve.mjs 에 끼웁니다. 하는 일:
//   · 꾸아일랜드 「관리자 열기」 → 1분짜리 1회용 서명 표 → 관리자 쿠키(8시간) → /admin/
//   · 사람 방문만 세기 (봇 · /admin · /api · 파일 제외, 개인정보 저장 없음)
//   · 꾸아일랜드에서 승인한 시즌 캠페인 받기 → 한국어 화면 맨 위 띠 + 첫 화면 제목 · 설명
// KKUISLAND_SECRET 이 없으면 전부 꺼져 있습니다(관리자 쿠키도 만들지도 받지도 않음).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { p } from './util.mjs';

const require = createRequire(import.meta.url);
const connector = require('./kkuisland-connector.cjs');

const SECRET = process.env.KKUISLAND_SECRET || '';
const ADMIN_COOKIE = 'kk_admin';
const ADMIN_HOURS = 8;

// ── 관리자 쿠키 ─────────────────────────────────────────
// 값: <만료시각>.<HMAC(비밀키, "admin\n만료시각")>. 비밀번호는 쿠키에 들어가지 않습니다.
// SameSite=Strict 라 다른 사이트에서 보낸 저장 요청(POST)에는 실리지 않습니다(CSRF 방지).
function sign(msg) { return crypto.createHmac('sha256', SECRET).update(msg).digest('base64url'); }

export function adminCookieOk(req) {
  if (!SECRET) return false;
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)kk_admin=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = sign('admin\n' + exp);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

function setAdminCookie(res) {
  const exp = Date.now() + ADMIN_HOURS * 3600e3;
  const secure = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
  res.setHeader('set-cookie', `${ADMIN_COOKIE}=${exp}.${sign('admin\n' + exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_HOURS * 3600}${secure ? '; Secure' : ''}`);
}

// ── Express 모양 입히기 ─────────────────────────────────
function shim(req, res) {
  const u = new URL(req.url || '/', 'http://x');
  req.path = u.pathname;
  req.query = Object.fromEntries(u.searchParams);
  req.get = (name) => req.headers[String(name).toLowerCase()];
  const fwd = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  req.ip = fwd || req.socket.remoteAddress || '';
  res.locals = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.set = (k, v) => { res.setHeader(k, v); return res; };
  res.type = (t) => { res.setHeader('content-type', t.includes('/') ? t : (t === 'text/css' ? 'text/css; charset=utf-8' : t)); return res; };
  res.send = (body) => { if (!res.getHeader('content-type')) res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(body); return res; };
  res.json = (o) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; };
  res.redirect = (to) => { res.statusCode = 302; res.setHeader('location', to); res.end(); return res; };
  // serve.mjs 는 writeHead 에 머리글을 바로 넘깁니다. 커넥터가 "화면이었나"를 알 수 있게 기억해 둡니다.
  const writeHead = res.writeHead;
  res.writeHead = function (code, a, b) {
    const h = a && typeof a === 'object' && !Array.isArray(a) ? a : b;
    if (h) for (const k of Object.keys(h)) if (k.toLowerCase() === 'content-type') res.__ct = h[k];
    return writeHead.apply(this, arguments);
  };
  const getHeader = res.getHeader.bind(res);
  res.getHeader = (n) => getHeader(n) ?? (String(n).toLowerCase() === 'content-type' ? res.__ct : undefined);
}

function postCount() {
  try { return fs.readdirSync(p('content', 'posts')).filter((f) => f.endsWith('.md')).length; } catch { return 0; }
}

const mw = connector({
  secret: SECRET,
  dataFile: path.join(os.tmpdir(), 'kkuisland-trendpick.json'),
  exclude: ['/admin', '/api', '/__', '/assets'],
  seoPaths: ['/'],
  siteName: ['트렌드픽', 'TrendPick'],
  login: (req, res) => setAdminCookie(res),
  stats: () => ({ 글: postCount() })
});

// 요청 하나를 커넥터에 먼저 보여 줍니다. 커넥터가 응답을 끝냈으면 true.
export function kkuisland(req, res) {
  shim(req, res);
  return new Promise((resolve, reject) => {
    let passed = false;
    Promise.resolve(mw(req, res, (err) => { if (err) return reject(err); passed = true; resolve(false); }))
      .then(() => { if (!passed) resolve(true); }, reject);
  });
}

// ── HTML 에 캠페인 끼우기 ────────────────────────────────
// 한국어 화면에만 겁니다(/en/ 은 한국어 문구가 어울리지 않음). 제목 · 설명은 첫 화면에서만.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function withCampaign(html, res, urlPath) {
  const c = res.locals && res.locals.kkCampaign;
  const seo = res.locals && res.locals.kkSeo;
  if ((!c && !seo) || urlPath.startsWith('/en/')) return html;
  let out = html;
  if (seo) {
    if (seo.title) {
      out = out.replace(/<title>[^<]*<\/title>/i, `<title>${esc(seo.title)}</title>`)
        .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/i, `$1${esc(seo.title)}$2`);
    }
    if (seo.description) {
      out = out.replace(/(<meta\s+name="description"\s+content=")[^"]*(")/i, `$1${esc(seo.description)}$2`)
        .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/i, `$1${esc(seo.description)}$2`);
    }
  }
  if (c && c.banner && c.banner.text) {
    const text = esc(c.banner.text);
    const inner = c.banner.link ? `<a href="${esc(c.banner.link)}">${text}</a>` : text;
    out = out.replace(/<\/head>/i, '<link rel="stylesheet" href="/__kkuisland/banner.css"></head>')
      .replace(/(<body[^>]*>)/i, `$1<input type="checkbox" id="kk-x" hidden><div class="kk-banner kk-${esc(c.banner.tone || 'calm')}" role="region" aria-label="시즌 안내">${inner}<label for="kk-x" aria-label="닫기">×</label></div>`);
  }
  return out;
}
