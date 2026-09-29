// 꾸아일랜드 커넥터 점검 — 빌드된 dist 를 실제 serve.mjs 로 띄워서 봅니다.
//   node --test scripts/tools/kkuisland.test.mjs     (먼저 npm run build)
//
// 못박는 것:
//   · 서명된 1분짜리 1회용 표로만 관리자 쿠키를 받는다 (위조 · 재사용 · 다른 사이트용 거절)
//   · 그 쿠키로 /api/kk-session 이 ok — 어드민 화면이 비밀번호 없이 저장 가능 상태가 된다
//   · 숫자 · 유입은 서명된 요청에만. 사람 방문만 센다
//   · 시즌 캠페인: 한국어 화면에 띠, 첫 화면만 제목 · 설명 교체, /en/ 은 그대로
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 4100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'kk-trendpick-test-secret';
const sign = (m) => crypto.createHmac('sha256', SECRET).update(m).digest('base64url');
const ticket = (extra = {}) => {
  const p = Buffer.from(JSON.stringify({ aud: `127.0.0.1:${PORT}`, exp: Date.now() + 60e3, nonce: crypto.randomBytes(9).toString('base64url'), to: '/admin/', ...extra })).toString('base64url');
  return p + '.' + sign('sso\n' + p);
};
const HUMAN = { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1', 'accept-language': 'ko-KR,ko;q=0.9' };
let child;

before(async () => {
  child = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), KKUISLAND_SECRET: SECRET }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/robots.txt')).status < 500) return; } catch { /* 아직 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('서버가 뜨지 않았습니다');
});
after(() => child && child.kill());

test('표로만 관리자 쿠키 — 위조 · 재사용 · 다른 사이트용 거절', async () => {
  assert.equal((await fetch(BASE + '/__kkuisland/sso?t=' + ticket().replace(/\.[^.]+$/, '.AAAA'), { redirect: 'manual' })).status, 403);
  assert.equal((await fetch(BASE + '/__kkuisland/sso?t=' + ticket({ aud: 'jogwa.kr' }), { redirect: 'manual' })).status, 403);
  const t = ticket();
  const r = await fetch(BASE + '/__kkuisland/sso?t=' + t, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/admin/');
  const cookie = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
  assert.match(cookie, /^kk_admin=/);
  assert.match(r.headers.getSetCookie()[0], /HttpOnly; SameSite=Strict/);
  assert.deepEqual(await (await fetch(BASE + '/api/kk-session', { headers: { cookie } })).json(), { ok: true });
  assert.deepEqual(await (await fetch(BASE + '/api/kk-session')).json(), { ok: false }, '쿠키 없으면 아님');
  assert.deepEqual(await (await fetch(BASE + '/api/kk-session', { headers: { cookie: 'kk_admin=9999999999999.forged' } })).json(), { ok: false }, '위조 쿠키');
  assert.equal((await fetch(BASE + '/__kkuisland/sso?t=' + t, { redirect: 'manual' })).status, 403, '재사용');
});

test('숫자 · 유입은 서명된 요청에만, 사람 방문만', async () => {
  assert.equal((await fetch(BASE + '/__kkuisland/status')).status, 403);
  await fetch(BASE + '/', { headers: HUMAN });
  await fetch(BASE + '/', { headers: HUMAN });
  await fetch(BASE + '/', { headers: { ...HUMAN, 'user-agent': 'Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)' } });
  await fetch(BASE + '/admin/', { headers: HUMAN });
  const ts = String(Date.now());
  const j = await (await fetch(BASE + '/__kkuisland/status', { headers: { 'x-ki-ts': ts, 'x-ki-sig': sign('status\n' + ts) } })).json();
  const day = j.traffic.days.find((d) => d.d === j.traffic.day);
  assert.equal(day.pv, 2, JSON.stringify(day));
  assert.equal(day.uv, 1);
  assert.ok(j.metrics['글'] > 0, JSON.stringify(j.metrics));
});

test('캠페인: 한국어 띠 · 첫 화면 제목 교체 · /en/ 그대로', async () => {
  const send = (campaign) => {
    const p = Buffer.from(JSON.stringify({ ts: Date.now(), campaign })).toString('base64url');
    return fetch(BASE + '/__kkuisland/campaign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: p + '.' + sign('campaign\n' + p) }) });
  };
  assert.equal((await send({ id: 'c', name: '가을', from: '2000-01-01', to: '2999-12-31', banner: { text: '가을 트렌드 한눈에 <b>', link: '/', tone: 'warm' }, seo: { title: '가을 트렌드 정리 | 트렌드픽', description: '이번 가을 뜨는 이슈를 한곳에.' } })).status, 200);
  const home = await (await fetch(BASE + '/', { headers: HUMAN })).text();
  assert.match(home, /class="kk-banner kk-warm"/);
  assert.ok(home.includes('가을 트렌드 한눈에 b') || home.includes('가을 트렌드 한눈에 &lt;b&gt;'), '문구의 꺾쇠는 지워지거나 이스케이프');
  assert.match(home, /<title>가을 트렌드 정리 \| 트렌드픽<\/title>/);
  assert.match(home, /content="이번 가을 뜨는 이슈를 한곳에\."/);
  const en = await (await fetch(BASE + '/en/', { headers: { ...HUMAN, 'accept-language': 'en' } })).text();
  assert.doesNotMatch(en, /kk-banner/);
  const css = await fetch(BASE + '/__kkuisland/banner.css');
  assert.equal(css.status, 200);
  await send(null);
  assert.doesNotMatch(await (await fetch(BASE + '/', { headers: HUMAN })).text(), /kk-banner/);
});

test('기존 동작 그대로: 404 · 관리자 화면 · 저장 API 확인', async () => {
  assert.equal((await fetch(BASE + '/no-such-page-xyz/', { headers: HUMAN })).status, 404);
  assert.equal((await fetch(BASE + '/admin/', { headers: HUMAN })).status, 200);
  const opt = await fetch(BASE + '/api/affiliate', { method: 'OPTIONS' });
  assert.ok([200, 503].includes(opt.status));
});
