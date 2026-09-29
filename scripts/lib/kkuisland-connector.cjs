// 꾸아일랜드 커넥터 v2 — 각 사이트(Express)에 붙이는 파일 하나. 의존성 없음.
//
// 세션 미들웨어 "뒤", 라우트 "앞"에 끼웁니다:
//
//   const kkuisland = require('./kkuisland-connector');
//   app.use(kkuisland({
//     secret: process.env.KKUISLAND_SECRET,           // 꾸아일랜드 → 사이트 → 연결하기
//     login: (req, res) => { req.session.isAdmin = true; }, // 관리자 로그인 상태 만드는 법
//     stats: async () => ({ 회원: 120 }),              // 카드에 띄울 숫자 (선택)
//     dataFile: path.join(DATA_DIR, 'kkuisland.json'), // 유입 기록 · 캠페인 보관 (선택, 권장)
//     siteName: ['조행일지', '조과']                    // 제목 뒤에 이름을 스스로 붙이는 템플릿이면 (선택, 여럿 가능)
//   }));
//
// 하는 일 넷:
//   1) GET  /__kkuisland/sso?t=…      서명된 1분짜리 1회용 표 → 관리자 로그인
//   2) GET  /__kkuisland/status       서명된 요청에만: 숫자 · 오늘 유입 · 지금 캠페인
//   3) POST /__kkuisland/campaign     서명된 시즌 캠페인(띠 배너 · 첫 화면 검색 문구)을 받아 둠
//   4) 모든 화면 요청: 사람 방문만 세어 둠(봇 · 관리자 화면 · 파일 제외, 개인정보 저장 안 함)
//      그리고 res.locals.kkCampaign(띠) · res.locals.kkSeo(첫 화면 제목 · 설명)를 채움
//
// KKUISLAND_SECRET 이 비어 있으면 1~3 은 404 이고 4 의 집계만 돕니다 (끄려면 변수만 지우면 됨).

const crypto = require('crypto');
const fs = require('fs');

// 검색엔진 · 미리보기 · 감시 도구. 네이버(Yeti) · 다음(Daumoa)은 이름에 "bot" 이 없어서 따로 적습니다.
const BOT = /bot|crawl|spider|slurp|yeti|daumoa|mediapartners|facebookexternalhit|kakaotalk-scrap|preview|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|headless|lighthouse|pingdom|uptime|scrapy|httpclient|kkuisland/i;
const ASSET = /\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|mp4|webm|mp3|pdf|zip|txt|xml|json|webmanifest)$/i;
const DAYS_KEPT = 35;
const TOP = 30;

// 한국 시간 기준 날짜
function kstDay(t = Date.now()) { return new Date(t + 9 * 3600e3).toISOString().slice(0, 10); }

// 어디서 왔나 — 호스트를 사람이 읽는 이름으로
function sourceOf(host) {
  const h = host.replace(/^www\.|^m\./, '');
  const table = [
    [/naver\.com$/, '네이버'], [/google\./, '구글'], [/daum\.net$/, '다음'], [/kakao\.com$|kakao\.co\.kr$/, '카카오'],
    [/bing\.com$/, '빙'], [/instagram\.com$/, '인스타그램'], [/youtube\.com$|youtu\.be$/, '유튜브'],
    [/facebook\.com$|fb\.com$/, '페이스북'], [/(^|\.)t\.co$|twitter\.com$|x\.com$/, 'X(트위터)'], [/threads\.net$/, '스레드'],
    [/band\.us$/, '밴드'], [/tistory\.com$/, '티스토리'], [/zum\.com$/, '줌']
  ];
  for (const [re, name] of table) if (re.test(h)) return name;
  return h;
}

function keywordOf(u) {
  for (const k of ['query', 'q', 'p', 'wd', 'keyword']) {
    const v = u.searchParams.get(k);
    if (v && v.trim()) return v.trim().toLowerCase().slice(0, 40);
  }
  return '';
}

function bump(map, key, n = 1) { if (key) map[key] = (map[key] || 0) + n; }
function top(map, n = TOP) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}
function trim(map, n = 300) {
  const keys = Object.keys(map);
  if (keys.length <= n) return map;
  return Object.fromEntries(top(map, n));
}

module.exports = function kkuisland(opts = {}) {
  const secret = opts.secret || '';
  const excludes = opts.exclude || ['/admin', '/root', '/api', '/uploads', '/static', '/__'];
  const seoPaths = new Set(opts.seoPaths || ['/']);
  const used = new Map(); // SSO nonce -> 만료

  // ── 보관 ──
  let state = { days: {}, campaign: null };
  if (opts.dataFile) {
    try { state = { ...state, ...JSON.parse(fs.readFileSync(opts.dataFile, 'utf8')) }; } catch (_) { /* 처음 */ }
  }
  let dirty = false;
  function save() {
    if (!opts.dataFile || !dirty) return;
    dirty = false;
    try {
      const tmp = opts.dataFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, opts.dataFile);
    } catch (e) { console.warn('[꾸아일랜드] 기록 저장 실패:', e.message); }
  }
  const timer = setInterval(save, 60e3); timer.unref && timer.unref();
  process.once('beforeExit', save);

  // 방문자 수는 "오늘 · 무작위 소금 · IP · 브라우저"의 지문 개수로 셉니다.
  // 지문도 디스크에 쓰지 않고, 소금은 날마다 바뀌어 어제의 방문자와 이어 붙일 수 없습니다.
  let salt = crypto.randomBytes(16); let saltDay = kstDay(); let seen = new Set();

  function day(d) {
    if (!state.days[d]) {
      state.days[d] = { pv: 0, uv: 0, src: {}, kw: {}, path: {}, utm: {} };
      const keep = Object.keys(state.days).sort().slice(-DAYS_KEPT);
      for (const k of Object.keys(state.days)) if (!keep.includes(k)) delete state.days[k];
    }
    return state.days[d];
  }

  function record(req) {
    const d = kstDay();
    if (d !== saltDay) { salt = crypto.randomBytes(16); saltDay = d; seen = new Set(); }
    const rec = day(d);
    rec.pv += 1;
    const fp = crypto.createHmac('sha256', salt).update((req.ip || '') + '|' + (req.get('user-agent') || '')).digest('base64url').slice(0, 16);
    if (!seen.has(fp)) { seen.add(fp); rec.uv += 1; }
    bump(rec.path, req.path.slice(0, 80));
    const ref = req.get('referer') || '';
    let src = '직접 · 북마크';
    if (ref) {
      try {
        const u = new URL(ref);
        if (u.host === req.get('host')) src = null; // 사이트 안에서 옮겨 다닌 것
        else { src = sourceOf(u.hostname); bump(rec.kw, keywordOf(u)); }
      } catch (_) { /* 이상한 referer */ }
    }
    if (src) bump(rec.src, src);
    const utm = req.query && (req.query.utm_campaign || req.query.utm_source);
    if (typeof utm === 'string') bump(rec.utm, utm.slice(0, 40));
    rec.path = trim(rec.path); rec.kw = trim(rec.kw); rec.src = trim(rec.src, 100); rec.utm = trim(rec.utm, 100);
    dirty = true;
  }

  function counts(req) {
    if (req.method !== 'GET') return false;
    if (ASSET.test(req.path)) return false;
    if (excludes.some(p => req.path === p || req.path.startsWith(p.endsWith('/') ? p : p + '/') || (p === '/__' && req.path.startsWith('/__')))) return false;
    if (!/text\/html|\*\/\*/.test(req.get('accept') || '')) return false;
    if (BOT.test(req.get('user-agent') || '')) return false;
    return true;
  }

  // ── 지금 걸린 캠페인 ──
  function activeCampaign() {
    const c = state.campaign;
    if (!c) return null;
    const d = kstDay();
    if ((c.from && d < c.from) || (c.to && d > c.to)) return null;
    return c;
  }

  // 템플릿이 제목 뒤에 사이트 이름을 스스로 붙이는 사이트용: "가을 낚시 | 조행일지" → titleCore "가을 낚시"
  function withCore(seo) {
    const raw = typeof opts.siteName === 'function' ? opts.siteName() : opts.siteName;
    const names = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
    if (!names.length || !seo.title) return seo;
    const alt = names.map(n => String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return { ...seo, titleCore: seo.title.replace(new RegExp('\\s*[|·—–-]\\s*(?:' + alt + ')\\s*$'), '').trim() };
  }

  // ── 서명 ──
  function sign(msg) { return crypto.createHmac('sha256', secret).update(msg).digest('base64url'); }
  function same(a, b) {
    const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }
  function openToken(t, purpose) {
    const [payload, sig] = String(t || '').split('.');
    if (!payload || !sig || !same(sig, sign(purpose + '\n' + payload))) return null;
    try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (_) { return null; }
  }
  function readBody(req) {
    if (req.body && typeof req.body === 'object' && req.body.t) return Promise.resolve(req.body);
    return new Promise((resolve, reject) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', c => { raw += c; if (raw.length > 64e3) { req.destroy(); reject(new Error('too large')); } });
      req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); } });
      req.on('error', reject);
    });
  }

  const CSS = `.kk-banner{position:relative;z-index:50;display:flex;align-items:center;justify-content:center;gap:10px;padding:9px 44px 9px 16px;font:600 14px/1.4 system-ui,-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;text-align:center;background:var(--kk-bg,#111827);color:var(--kk-fg,#fff)}
.kk-banner a{color:inherit;text-decoration:underline;text-underline-offset:3px}
.kk-banner label{position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;padding:4px 8px;opacity:.7}
#kk-x:checked+.kk-banner{display:none}
.kk-warm{--kk-bg:#9A3412}.kk-cool{--kk-bg:#0E7490}.kk-fresh{--kk-bg:#15803D}.kk-festive{--kk-bg:#B91C1C}.kk-calm{--kk-bg:#334155}`;

  return async function kkuislandConnector(req, res, next) {
    // 화면 요청이면 캠페인을 템플릿에 건네고, 끝난 뒤 한 번 셉니다.
    if (!req.path.startsWith('/__kkuisland/')) {
      const c = activeCampaign();
      res.locals.kkCampaign = c && c.banner && c.banner.text ? c : null;
      res.locals.kkSeo = c && c.seo && seoPaths.has(req.path) ? withCore(c.seo) : null;
      if (counts(req)) {
        res.on('finish', () => {
          if (res.statusCode < 400 && /html/.test(String(res.getHeader('content-type') || ''))) record(req);
        });
      }
      return next();
    }

    if (req.path === '/__kkuisland/banner.css') {
      res.set('Cache-Control', 'public, max-age=3600');
      return res.type('text/css').send(CSS);
    }
    if (!secret) return res.status(404).end();
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');

    try {
      if (req.path === '/__kkuisland/sso' && req.method === 'GET') {
        const p = openToken(req.query.t, 'sso');
        if (!p) return res.status(403).send('잘못된 표입니다.');
        if (!p.exp || p.exp < Date.now()) return res.status(403).send('표가 만료되었습니다. 꾸아일랜드에서 다시 눌러 주세요.');
        if (p.aud !== req.get('host')) return res.status(403).send('다른 사이트용 표입니다.');
        const now = Date.now();
        for (const [k, v] of used) if (v < now) used.delete(k);
        if (used.has(p.nonce)) return res.status(403).send('이미 쓴 표입니다.');
        used.set(p.nonce, p.exp + 60e3);

        const to = typeof p.to === 'string' && p.to.startsWith('/') && !p.to.startsWith('//') ? p.to : '/';
        const finish = async () => {
          await opts.login(req, res);
          if (res.headersSent) return;
          if (req.session && req.session.save) req.session.save(() => res.redirect(to)); else res.redirect(to);
        };
        // 세션 고정 방지: express-session 이면 세션 id 를 새로 받습니다.
        if (req.session && req.session.regenerate) {
          return req.session.regenerate(err => err ? next(err) : finish().catch(next));
        }
        return await finish();
      }

      if (req.path === '/__kkuisland/status' && req.method === 'GET') {
        const ts = Number(req.get('x-ki-ts'));
        if (!ts || Math.abs(Date.now() - ts) > 60e3) return res.status(403).end();
        if (!same(req.get('x-ki-sig') || '', sign('status\n' + ts))) return res.status(403).end();
        const metrics = opts.stats ? await opts.stats() : {};
        const d = kstDay();
        const days = Object.keys(state.days).sort().slice(-14).map(k => ({ d: k, pv: state.days[k].pv, uv: state.days[k].uv }));
        const t = state.days[d] || { src: {}, kw: {}, path: {}, utm: {} };
        return res.json({
          ok: true, v: 2, metrics, uptimeSec: Math.round(process.uptime()), node: process.version,
          traffic: { day: d, days, src: top(t.src, 12), kw: top(t.kw, 15), path: top(t.path, 12), utm: top(t.utm, 8) },
          campaign: state.campaign ? { id: state.campaign.id, from: state.campaign.from, to: state.campaign.to, live: !!activeCampaign() } : null
        });
      }

      if (req.path === '/__kkuisland/campaign' && req.method === 'POST') {
        const body = await readBody(req);
        const p = openToken(body.t, 'campaign');
        if (!p || !p.ts || Math.abs(Date.now() - p.ts) > 5 * 60e3) return res.status(403).json({ ok: false });
        const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
        const c = p.campaign;
        state.campaign = c ? {
          id: clean(c.id, 40), name: clean(c.name, 60), from: clean(c.from, 10), to: clean(c.to, 10),
          banner: c.banner ? {
            text: clean(c.banner.text, 120),
            link: /^\/(?!\/)/.test(c.banner.link || '') ? clean(c.banner.link, 200) : '',
            tone: ['warm', 'cool', 'fresh', 'festive', 'calm'].includes(c.banner.tone) ? c.banner.tone : 'calm'
          } : null,
          seo: c.seo ? { title: clean(c.seo.title, 70), description: clean(c.seo.description, 160), keywords: clean(c.seo.keywords, 200) } : null
        } : null;
        dirty = true; save();
        return res.json({ ok: true, live: !!activeCampaign() });
      }
    } catch (e) {
      return next(e);
    }
    res.status(404).end();
  };
};

module.exports.kstDay = kstDay;
