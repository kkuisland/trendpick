// 어드민 저장 API
//
// Railway 컨테이너의 파일시스템은 재배포하면 사라진다. 그래서 저장은 파일을 쓰는 대신
// GitHub 저장소에 커밋한다 — 그러면 Railway 가 다시 배포하면서 반영된다.
//
// 필요한 환경변수 (하나라도 없으면 API 는 꺼진 상태로 동작한다):
//   ADMIN_PASSWORD  관리자 비밀번호
//   GITHUB_TOKEN    저장소 contents 쓰기 권한이 있는 토큰
//   (선택) GITHUB_REPO  기본값 kkuisland/trendpick
import crypto from 'node:crypto';

const FILE_PATH = 'data/affiliates.json';
const MAX_BODY = 64 * 1024;

export function adminApiEnabled() {
  return !!(process.env.ADMIN_PASSWORD && process.env.GITHUB_TOKEN);
}

function repoSlug() {
  return process.env.GITHUB_REPO || 'kkuisland/trendpick';
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

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};

/**
 * /api/affiliate 처리. 이 요청을 처리했으면 true 를 돌려준다.
 */
export async function handleAdminApi(req, res, urlPath) {
  if (urlPath !== '/api/affiliate') return false;

  // 어드민 페이지가 저장 가능 여부를 확인하는 용도
  if (req.method === 'OPTIONS') {
    if (!adminApiEnabled()) {
      json(res, 503, { error: 'API 미설정' });
    } else {
      json(res, 200, { ok: true });
    }
    return true;
  }

  if (req.method !== 'POST') {
    json(res, 405, { error: '허용되지 않는 메서드' });
    return true;
  }
  if (!adminApiEnabled()) {
    json(res, 503, { error: 'ADMIN_PASSWORD·GITHUB_TOKEN 이 설정되지 않았습니다' });
    return true;
  }

  const ip = (req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '').toString();
  if (tooManyAttempts(ip)) {
    json(res, 429, { error: '시도가 너무 많습니다. 10분 뒤에 다시 시도해 주세요.' });
    return true;
  }
  if (!passwordOk(req.headers['x-admin-password'])) {
    noteFailure(ip);
    json(res, 401, { error: '비밀번호가 맞지 않습니다' });
    return true;
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    json(res, 400, { error: '요청을 읽지 못했습니다' });
    return true;
  }

  const slug = body?.slug;
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug)) {
    json(res, 400, { error: '글 주소(slug)가 올바르지 않습니다' });
    return true;
  }
  if (!validLink(body?.link ?? null)) {
    json(res, 400, { error: '링크 정보가 올바르지 않습니다 (http/https 주소만 가능)' });
    return true;
  }

  // 현재 파일을 읽어 postLinks 만 고친 뒤 커밋한다.
  const cur = await gh(`contents/${FILE_PATH}?ref=main`);
  if (!cur.ok || !cur.json?.content) {
    json(res, 502, { error: `저장소를 읽지 못했습니다 (${cur.status})` });
    return true;
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(cur.json.content, 'base64').toString('utf8'));
  } catch {
    json(res, 500, { error: 'affiliates.json 을 해석하지 못했습니다' });
    return true;
  }

  data.postLinks = data.postLinks || {};
  const link = sanitize(body.link);
  if (link) data.postLinks[slug] = link;
  else delete data.postLinks[slug];

  const put = await gh(`contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `chore: ${slug} 제휴 링크 ${link ? '설정' : '해제'} (어드민)`,
      content: Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').toString('base64'),
      sha: cur.json.sha,
      branch: 'main',
    }),
  });

  if (!put.ok) {
    // 409 는 그 사이 다른 곳에서 파일이 바뀐 경우다
    const msg = put.status === 409
      ? '다른 곳에서 파일이 먼저 바뀌었습니다. 새로고침 후 다시 시도해 주세요.'
      : `저장하지 못했습니다 (${put.status})`;
    json(res, 502, { error: msg });
    return true;
  }

  json(res, 200, { ok: true, commit: put.json?.commit?.sha?.slice(0, 7) || null });
  return true;
}
