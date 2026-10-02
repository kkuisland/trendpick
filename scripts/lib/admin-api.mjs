// 어드민 저장 API
//
// Railway 컨테이너의 파일시스템은 재배포하면 사라진다. 그래서 저장은 파일을 쓰는 대신
// GitHub 저장소에 커밋한다 — 그러면 Railway 가 다시 배포하면서 반영된다.
//
// 하는 일 (모두 관리자 비밀번호 또는 꾸아일랜드 관리자 쿠키가 있어야 한다):
//   POST /api/affiliate    글마다 제휴 링크 붙이기 (data/affiliates.json)
//   GET  /api/admin-state  사장님이 할 일 — 설정값 · 검수 대기 글 · 토큰 종류
//   POST /api/settings     서치콘솔 인증값 · 애드센스 켜기 (config/site.config.json)
//   POST /api/draft        검수 대기 글 발행 / 삭제 (content/**/posts/*.md)
//
// 필요한 환경변수 (하나라도 없으면 API 는 꺼진 상태로 동작한다):
//   ADMIN_PASSWORD  관리자 비밀번호
//   GITHUB_TOKEN    kkuisland/trendpick 저장소의 Contents 읽기·쓰기 권한만 가진 세분화 토큰
//                   (github_pat_… — 위 네 가지 모두 Contents API 만 쓴다)
//   (선택) GITHUB_REPO  기본값 kkuisland/trendpick
import crypto from 'node:crypto';
import fs from 'node:fs';
import { adminCookieOk } from './kkuisland.mjs';
import { p, readText, parseFrontMatter } from './util.mjs';
import { renderMarkdown } from './md.mjs';
import { collectDrafts } from '../review-queue.mjs';

const FILE_PATH = 'data/affiliates.json';
const CONFIG_PATH = 'config/site.config.json';
const MAX_BODY = 64 * 1024;

export function adminApiEnabled() {
  return !!(process.env.ADMIN_PASSWORD && process.env.GITHUB_TOKEN);
}

function repoSlug() {
  return process.env.GITHUB_REPO || 'kkuisland/trendpick';
}

/** 토큰 값은 절대 내보내지 않고 종류만 알려 준다 — 어드민이 "좁혀 주세요"를 띄울지 정할 때 쓴다 */
function tokenKind() {
  const t = process.env.GITHUB_TOKEN || '';
  if (!t) return 'none';
  if (t.startsWith('github_pat_')) return 'fine-grained';
  if (t.startsWith('ghp_')) return 'classic';
  return 'other';
}

/** 길이가 달라도 시간이 새지 않도록 해시를 비교한다 */
function passwordOk(given) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// 비밀번호 대입 시도를 늦춘다 (프로세스 메모리 기준, 재시작하면 초기화)
const attempts = new Map();
function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > 10 * 60 * 1000) {
    attempts.delete(ip);
    return false;
  }
  return rec.count >= 10;
}
function noteFailure(ip) {
  const rec = attempts.get(ip) || { count: 0, first: Date.now() };
  rec.count += 1;
  attempts.set(ip, rec);
}

async function gh(path, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${repoSlug()}/${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'ktrend-admin',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 본문이 JSON 이 아닐 수 있다 */ }
  return { ok: res.ok, status: res.status, json, text };
}

/** 사용자에게 그대로 보여 줄 오류 */
class AdminError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** main 의 파일 하나를 읽는다 → { text, sha } */
async function ghReadFile(path) {
  const cur = await gh(`contents/${path}?ref=main`);
  if (cur.status === 404) throw new AdminError(404, `저장소에 ${path} 가 없습니다. 이미 지워졌을 수 있습니다.`);
  if (!cur.ok || typeof cur.json?.content !== 'string') {
    throw new AdminError(502, `저장소를 읽지 못했습니다 (${cur.status})`);
  }
  return { text: Buffer.from(cur.json.content, 'base64').toString('utf8'), sha: cur.json.sha };
}

function ghFailure(status) {
  // 409 는 그 사이 다른 곳(루틴·다른 탭)에서 파일이 바뀐 경우다
  return status === 409
    ? new AdminError(502, '다른 곳에서 파일이 먼저 바뀌었습니다. 새로고침 후 다시 시도해 주세요.')
    : new AdminError(502, `저장하지 못했습니다 (${status})`);
}

async function ghWriteFile(path, text, sha, message) {
  const put = await gh(`contents/${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, content: Buffer.from(text, 'utf8').toString('base64'), sha, branch: 'main' }),
  });
  if (!put.ok) throw ghFailure(put.status);
  return put.json?.commit?.sha?.slice(0, 7) || null;
}

async function ghDeleteFile(path, sha, message) {
  const del = await gh(`contents/${path}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: 'main' }),
  });
  if (!del.ok) throw ghFailure(del.status);
  return del.json?.commit?.sha?.slice(0, 7) || null;
}

/** 링크 항목이 저장해도 되는 모양인지 확인한다 */
function validLink(link) {
  if (link === null) return true; // 삭제
  if (typeof link !== 'object' || Array.isArray(link)) return false;
  if (link.key) return typeof link.key === 'string' && /^[\w:-]{1,80}$/.test(link.key);
  if (typeof link.partner !== 'string' || !/^[\w-]{1,32}$/.test(link.partner)) return false;
  const url = link.url || link.sourceUrl;
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  } catch {
    return false;
  }
  if (link.title != null && (typeof link.title !== 'string' || link.title.length > 120)) return false;
  if (link.afterHeading != null && (typeof link.afterHeading !== 'string' || link.afterHeading.length > 120)) return false;
  return true;
}

/** 저장할 값만 남긴다 — 클라이언트가 보낸 임의 필드를 그대로 쓰지 않는다 */
function sanitize(link) {
  if (!link) return null;
  if (link.key) return { key: link.key };
  const out = { partner: link.partner };
  if (link.title) out.title = String(link.title).slice(0, 120);
  if (link.url) out.url = link.url;
  if (link.sourceUrl) out.sourceUrl = link.sourceUrl;
  if (link.afterHeading) out.afterHeading = String(link.afterHeading).slice(0, 120);
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('본문이 너무 큽니다'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  try {
    return JSON.parse(await readBody(req));
  } catch {
    throw new AdminError(400, '요청을 읽지 못했습니다');
  }
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};

/** API 가 켜져 있고 관리자인지 확인한다. 아니면 응답을 쓰고 false */
function authorize(req, res) {
  if (!adminApiEnabled()) {
    json(res, 503, { error: 'ADMIN_PASSWORD·GITHUB_TOKEN 이 설정되지 않았습니다' });
    return false;
  }
  const ip = (req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '').toString();
  if (tooManyAttempts(ip)) {
    json(res, 429, { error: '시도가 너무 많습니다. 10분 뒤에 다시 시도해 주세요.' });
    return false;
  }
  // 비밀번호 또는 꾸아일랜드가 발급한 관리자 쿠키(서명 · 8시간 · SameSite=Strict)
  if (!passwordOk(req.headers['x-admin-password']) && !adminCookieOk(req)) {
    noteFailure(ip);
    json(res, 401, { error: '비밀번호가 맞지 않습니다' });
    return false;
  }
  return true;
}

// ───────────────────────── 설정 (서치콘솔 · 애드센스) ─────────────────────────

/**
 * 서치콘솔 「HTML 태그」 방식에서 받은 값을 정리한다.
 * 태그를 통째로 붙여 넣어도 content="…" 만 꺼낸다. 빈 문자열은 지우기.
 */
export function normalizeGoogleVerification(input) {
  let v = String(input ?? '').trim();
  const m = v.match(/content\s*=\s*["']([^"']+)["']/i);
  if (m) v = m[1].trim();
  if (v === '') return '';
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(v)) return null;
  return v;
}

/**
 * config/site.config.json 의 필요한 값만 문자열 치환으로 바꾼다.
 * JSON 을 통째로 다시 쓰면 한 줄로 써 둔 카테고리가 여러 줄로 풀려 큰 diff 가 난다.
 * 각 패턴이 정확히 한 번 맞을 때만 바꾸고, 결과가 JSON 으로 읽히는지 확인한다.
 */
export function patchConfigText(text, changes) {
  let out = text;
  const swap = (re, replacement, label) => {
    const hits = out.match(new RegExp(re.source, 'g')) || [];
    if (hits.length !== 1) throw new AdminError(500, `설정 파일에서 ${label} 자리를 찾지 못했습니다 (${hits.length}곳)`);
    out = out.replace(re, replacement);
  };
  if (changes.googleVerification !== undefined) {
    swap(/("google"\s*:\s*)"[^"]*"/, `$1"${changes.googleVerification}"`, '서치콘솔 인증값');
  }
  if (changes.adsenseEnabled !== undefined) {
    swap(/("adsense"\s*:\s*\{\s*"enabled"\s*:\s*)(true|false)/, `$1${changes.adsenseEnabled ? 'true' : 'false'}`, '애드센스 켜기');
  }
  if (changes.adsenseSlot !== undefined) {
    swap(/("inArticle"\s*:\s*)"[^"]*"/, `$1"${changes.adsenseSlot}"`, '애드센스 광고 단위 ID');
  }
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new AdminError(500, '바꾼 설정 파일이 JSON 으로 읽히지 않아 저장하지 않았습니다');
  }
  const ads = parsed.monetization?.adsense || {};
  if (
    (changes.googleVerification !== undefined && parsed.verification?.google !== changes.googleVerification) ||
    (changes.adsenseEnabled !== undefined && ads.enabled !== changes.adsenseEnabled) ||
    (changes.adsenseSlot !== undefined && ads.slots?.inArticle !== changes.adsenseSlot)
  ) {
    throw new AdminError(500, '설정 파일을 바꾼 결과가 예상과 달라 저장하지 않았습니다');
  }
  return out;
}

function settingsFrom(config) {
  const ads = config.monetization?.adsense || {};
  return {
    googleVerification: config.verification?.google || '',
    naverVerified: !!config.verification?.naver,
    adsense: { client: ads.client || '', enabled: !!ads.enabled, slot: ads.slots?.inArticle || '' },
    // Railway 변수가 설정 파일 값을 덮는 경우 — 어드민에서 바꿔도 반영되지 않는다
    overriddenByEnv: {
      googleVerification: !!process.env.GOOGLE_VERIFICATION,
      adsenseClient: !!process.env.ADSENSE_CLIENT,
    },
  };
}

async function saveSettings(body) {
  const changes = {};
  const parts = [];
  if (body.googleVerification !== undefined) {
    const v = normalizeGoogleVerification(body.googleVerification);
    if (v === null) throw new AdminError(400, '서치콘솔 인증값 모양이 아닙니다. 「HTML 태그」의 content="…" 안의 값을 넣어 주세요.');
    changes.googleVerification = v;
    parts.push(v ? '서치콘솔 인증값' : '서치콘솔 인증값 지움');
  }
  if (body.adsenseEnabled !== undefined) {
    if (typeof body.adsenseEnabled !== 'boolean') throw new AdminError(400, '애드센스 켜기 값이 올바르지 않습니다');
    changes.adsenseEnabled = body.adsenseEnabled;
    parts.push(body.adsenseEnabled ? '애드센스 광고 켬' : '애드센스 광고 끔');
  }
  if (body.adsenseSlot !== undefined) {
    const s = String(body.adsenseSlot ?? '').trim();
    if (!/^\d{0,20}$/.test(s)) throw new AdminError(400, '광고 단위 ID 는 숫자만 넣어 주세요 (비워 두면 자동 크기)');
    changes.adsenseSlot = s;
    parts.push('애드센스 광고 단위');
  }
  if (!parts.length) throw new AdminError(400, '바꿀 값이 없습니다');

  const cur = await ghReadFile(CONFIG_PATH);
  const next = patchConfigText(cur.text, changes);
  if (next === cur.text) return { commit: null, unchanged: true };
  const commit = await ghWriteFile(CONFIG_PATH, next, cur.sha, `chore: ${parts.join(' · ')} (어드민)`);
  return { commit };
}

// ───────────────────────── 검수 대기 글 ─────────────────────────

const POST_DIR = { ko: 'content/posts', en: 'content/en/posts' };

function localPost(locale, slug) {
  const file = p(...POST_DIR[locale].split('/'), `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  return parseFrontMatter(readText(file));
}

/**
 * 본문의 내부 글 링크 중 발행되지 않은 글(검수 대기·없음)을 가리키는 것.
 * 이런 글을 발행하면 그 링크가 404 가 된다 (linkcheck.mjs 와 같은 이유).
 */
function unpublishedLinks(body, selfSlug) {
  const bad = [];
  for (const m of body.matchAll(/\]\((\/en)?\/posts\/([a-z0-9-]+)\/?(?:#[^)]*)?\)/g)) {
    const locale = m[1] ? 'en' : 'ko';
    const slug = m[2];
    if (slug === selfSlug) continue;
    const target = localPost(locale, slug);
    if (!target || target.meta.draft === true) bad.push(`${m[1] || ''}/posts/${slug}/`);
  }
  return [...new Set(bad)];
}

function draftList() {
  return collectDrafts().map((d) => {
    const { meta, body } = parseFrontMatter(readText(p(...d.file.split('/'))));
    const { html } = renderMarkdown(body, {
      shortcodes: {
        ad: () => '<p class="ph">[광고 자리]</p>',
        aff: (key) => `<p class="ph">[제휴 링크: ${String(key).replace(/[<>&"]/g, '')}]</p>`,
        coupang: () => '',
        event: () => '',
      },
    });
    return {
      slug: d.slug,
      locale: d.locale,
      title: d.title,
      description: meta.description || '',
      date: d.date,
      ageDays: d.ageDays,
      reason: d.reason,
      // 확정 안 된 사실 표시가 남아 있으면 발행 전에 손봐야 한다
      unconfirmed: (body.match(/\[확인 필요\]/g) || []).length,
      deadLinks: unpublishedLinks(body, d.slug),
      html,
    };
  });
}

async function actOnDraft(body) {
  const { slug, locale, action } = body || {};
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug)) {
    throw new AdminError(400, '글 주소(slug)가 올바르지 않습니다');
  }
  if (!POST_DIR[locale]) throw new AdminError(400, '언어 값이 올바르지 않습니다');
  if (action !== 'publish' && action !== 'delete') throw new AdminError(400, '할 일이 올바르지 않습니다');

  const path = `${POST_DIR[locale]}/${slug}.md`;
  const cur = await ghReadFile(path);
  const { meta, body: md } = parseFrontMatter(cur.text);
  if (meta.draft !== true) throw new AdminError(409, '이미 발행된 글입니다. 검수 대기 글만 여기서 다룹니다.');

  if (action === 'delete') {
    const commit = await ghDeleteFile(path, cur.sha, `chore: 검수 대기 글 삭제 — ${slug} (어드민)`);
    return { commit };
  }

  const dead = unpublishedLinks(md, slug);
  if (dead.length) {
    throw new AdminError(409, `이 글이 아직 발행되지 않은 글을 링크하고 있어, 발행하면 링크가 깨집니다: ${dead.join(', ')}`);
  }
  // 프런트매터 안의 draft 줄만 바꾼다
  const end = cur.text.indexOf('\n---', 4);
  const head = cur.text.slice(0, end).replace(/^draft:\s*true\s*$/m, 'draft: false');
  const next = head + cur.text.slice(end);
  if (next === cur.text) throw new AdminError(500, '프런트매터에서 draft 줄을 찾지 못했습니다');
  const commit = await ghWriteFile(path, next, cur.sha, `chore: 검수 완료 발행 — ${slug} (어드민)`);
  return { commit };
}

// ───────────────────────── 라우팅 ─────────────────────────

async function saveAffiliate(body) {
  const slug = body?.slug;
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug)) {
    throw new AdminError(400, '글 주소(slug)가 올바르지 않습니다');
  }
  if (!validLink(body?.link ?? null)) {
    throw new AdminError(400, '링크 정보가 올바르지 않습니다 (http/https 주소만 가능)');
  }

  // 현재 파일을 읽어 postLinks 만 고친 뒤 커밋한다.
  const cur = await ghReadFile(FILE_PATH);
  let data;
  try {
    data = JSON.parse(cur.text);
  } catch {
    throw new AdminError(500, 'affiliates.json 을 해석하지 못했습니다');
  }

  data.postLinks = data.postLinks || {};
  const link = sanitize(body.link);
  if (link) data.postLinks[slug] = link;
  else delete data.postLinks[slug];

  const commit = await ghWriteFile(
    FILE_PATH,
    JSON.stringify(data, null, 2) + '\n',
    cur.sha,
    `chore: ${slug} 제휴 링크 ${link ? '설정' : '해제'} (어드민)`
  );
  return { commit };
}

const ROUTES = {
  '/api/affiliate': { method: 'POST', run: (req) => readJsonBody(req).then(saveAffiliate) },
  '/api/settings': { method: 'POST', run: (req) => readJsonBody(req).then(saveSettings) },
  '/api/draft': { method: 'POST', run: (req) => readJsonBody(req).then(actOnDraft) },
  '/api/admin-state': {
    method: 'GET',
    run: async () => {
      const raw = JSON.parse(readText(p(...CONFIG_PATH.split('/'))));
      return { settings: settingsFrom(raw), drafts: draftList(), token: tokenKind() };
    },
  },
};

/**
 * /api/* 처리. 이 요청을 처리했으면 true 를 돌려준다.
 */
export async function handleAdminApi(req, res, urlPath) {
  // 꾸아일랜드에서 「관리자 열기」로 들어왔는지 — 어드민 화면이 비밀번호 칸을 건너뛸지 정할 때 씁니다
  if (urlPath === '/api/kk-session') {
    json(res, 200, { ok: adminCookieOk(req) });
    return true;
  }
  const route = ROUTES[urlPath];
  if (!route) return false;

  // 어드민 페이지가 저장 가능 여부를 확인하는 용도
  if (req.method === 'OPTIONS') {
    if (!adminApiEnabled()) json(res, 503, { error: 'API 미설정' });
    else json(res, 200, { ok: true });
    return true;
  }
  if (req.method !== route.method) {
    json(res, 405, { error: '허용되지 않는 메서드' });
    return true;
  }
  if (!authorize(req, res)) return true;

  try {
    json(res, 200, { ok: true, ...(await route.run(req)) });
  } catch (err) {
    if (err instanceof AdminError) json(res, err.code, { error: err.message });
    else throw err;
  }
  return true;
}
