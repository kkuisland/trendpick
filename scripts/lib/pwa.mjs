// PWA — 설치 권장 배너, 매니페스트, 서비스워커
//
// 요구사항은 "접속하면 앱으로 보라고 권하되, 이미 설치한 사람에게는 띄우지 말 것".
// 설치 여부를 아는 방법이 플랫폼마다 달라서 감지 경로를 셋으로 나눈다.
//
//  1) 앱 안에서 열렸는가 — display-mode: standalone (안드로이드·데스크탑),
//     navigator.standalone (iOS). 켜져 있으면 이미 설치한 사람이다.
//  2) beforeinstallprompt 가 오는가 — 크롬 계열은 "설치 안 된 상태"에서만 이 이벤트를
//     쏜다. 즉 이벤트가 왔다는 사실 자체가 미설치 신호다. 안 오면 배너를 띄우지 않는다.
//  3) iOS 사파리 — 설치 API 자체가 없다. 홈 화면에서 열기 전에는 설치 여부를 알 길이
//     없으므로, 방문 2회차부터 한 번만 안내하고 닫으면 오래 재우는 쪽으로 절충한다.
//
// 어느 경로든 "닫기"를 누르면 로컬에 재움 시각을 남겨 다시 조르지 않는다.

const ICONS = [
  { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/assets/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/** 배포 경로가 서브디렉터리일 때도 절대경로가 맞도록 site.url 의 pathname 을 앞에 붙인다 */
export function basePathOf(config) {
  try {
    return new URL(config.site.url).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * 로케일별 매니페스트. scope 는 양쪽 다 루트로 두어 한 번 설치하면 사이트 전체가
 * 앱 안에서 열리게 하고, start_url 만 달리해 한국어·영문 앱을 구분한다.
 */
export function manifestJson(config) {
  const base = basePathOf(config);
  const prefix = config.locale.prefix || '';
  const start = `${base}${prefix}/`;
  const isEn = config.locale.code === 'en';
  return {
    id: start,
    name: config.site.name,
    short_name: config.site.brand || config.site.name,
    description: config.site.description,
    lang: config.locale.lang,
    dir: 'ltr',
    start_url: start,
    scope: `${base}/`,
    display: 'standalone',
    orientation: 'portrait-primary',
    theme_color: '#ffffff',
    background_color: '#f6f7f9',
    categories: isEn ? ['news', 'travel', 'entertainment'] : ['news', 'lifestyle'],
    icons: ICONS.map((i) => ({ ...i, src: base + i.src })),
  };
}

/** <head> 에 들어가는 매니페스트·아이콘·테마색 + beforeinstallprompt 조기 수신기 */
export function pwaHead(config) {
  const prefix = config.locale.prefix || '';
  const name = config.site.brand || config.site.name;
  // 이벤트가 본문 끝 스크립트보다 먼저 올 수 있으므로 head 에서 먼저 붙잡아 둔다.
  // 여기서 preventDefault 를 하지 않으면 크롬이 제 배너를 띄워 우리 UI 와 겹친다.
  const early =
    '<script>window.__ktBip=null;addEventListener("beforeinstallprompt",function(e){' +
    'e.preventDefault();window.__ktBip=e;dispatchEvent(new Event("kt-installable"))});' +
    'addEventListener("appinstalled",function(){window.__ktBip=null;' +
    'dispatchEvent(new Event("kt-installed"))});</script>';
  return `
<link rel="manifest" href="${prefix}/manifest.webmanifest">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#161a22" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${name}">
${early}`;
}

/** 설치 권장 배너 (마크업 + 동작). 이미 설치한 사람에게는 끝까지 나타나지 않는다. */
export function installPrompt(config) {
  const t = config.locale.t;
  const base = basePathOf(config);
  const esc = (s) => String(s).replace(/'/g, "\\'");
  return `<div class="pwa-prompt" id="pwa-prompt" role="dialog" aria-modal="false" aria-labelledby="pwa-prompt-title" hidden>
  <img class="pwa-prompt-icon" src="/assets/icon-192.png" width="44" height="44" alt="" loading="lazy" decoding="async">
  <div class="pwa-prompt-text">
    <strong id="pwa-prompt-title">${t.pwaTitle}</strong>
    <span class="pwa-prompt-body" data-body="${esc(t.pwaBody)}" data-ios="${esc(t.pwaIosBody)}">${t.pwaBody}</span>
  </div>
  <div class="pwa-prompt-actions">
    <button type="button" class="pwa-prompt-later">${t.pwaLater}</button>
    <button type="button" class="pwa-prompt-go" data-done="${esc(t.pwaIosDone)}">${t.pwaInstall}</button>
  </div>
</div>
<script>
(function () {
  var el = document.getElementById('pwa-prompt');
  if (!el) return;
  var KEY = 'ktrend.pwa';
  var DAY = 86400000;

  // 시크릿 모드나 저장소를 막아 둔 브라우저에서는 접근만 해도 예외가 난다.
  // 배너 하나 때문에 페이지가 멈추면 안 되므로 전부 감싸고, 실패하면 빈 상태로 본다.
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 무시 */ }
  }

  var state = load();

  // (1) 앱 안에서 열렸다 = 이미 설치했다. 표시해 두고 다시는 묻지 않는다.
  var standalone =
    (window.matchMedia && matchMedia('(display-mode: standalone)').matches) ||
    (window.matchMedia && matchMedia('(display-mode: window-controls-overlay)').matches) ||
    navigator.standalone === true;
  if (standalone) {
    if (!state.installed) { state.installed = true; save(state); }
    return;
  }
  if (state.installed) return;
  if (state.snooze && Date.now() < state.snooze) return;

  // 검색으로 처음 들어온 사람을 곧바로 막아서지 않는다. 두 번째 방문부터 권한다.
  state.visits = (state.visits || 0) + 1;
  save(state);
  if (state.visits < 2) return;

  var ios = /iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ''));
  var bodyEl = el.querySelector('.pwa-prompt-body');
  var goBtn = el.querySelector('.pwa-prompt-go');
  var shown = false;

  function show(mode) {
    if (shown) return;
    shown = true;
    el.dataset.mode = mode;
    if (mode === 'ios') {
      bodyEl.innerHTML = bodyEl.dataset.ios;
      goBtn.textContent = goBtn.dataset.done;
    }
    el.hidden = false;
    // 트랜지션을 재생하려면 처음 상태가 한 번 반영된 뒤에 클래스를 붙여야 한다.
    // 여기서 requestAnimationFrame 을 쓰면 안 된다 — 배경 탭에서는 콜백이 실행되지
    // 않아 배너가 opacity: 0 인 채로 남고, 보이지도 않으면서 화면 아래쪽 클릭만
    // 가로챈다. setTimeout 은 탭이 그려지든 말든 반드시 돈다.
    setTimeout(function () { el.classList.add('is-open'); }, 30);
    document.body.classList.add('pwa-prompt-open');
  }

  function hide(days) {
    el.classList.remove('is-open');
    document.body.classList.remove('pwa-prompt-open');
    setTimeout(function () { el.hidden = true; }, 250);
    if (days) { state.snooze = Date.now() + days * DAY; save(state); }
  }

  el.querySelector('.pwa-prompt-later').addEventListener('click', function () { hide(30); });

  goBtn.addEventListener('click', function () {
    // iOS 는 설치를 부를 API 가 없다. 안내를 읽었다는 뜻이므로 닫고 오래 재운다.
    if (el.dataset.mode === 'ios') { hide(90); return; }
    var e = window.__ktBip;
    if (!e) { hide(7); return; }
    window.__ktBip = null;
    e.prompt();
    e.userChoice.then(function (r) {
      if (r && r.outcome === 'accepted') { state.installed = true; save(state); hide(0); }
      else hide(30);
    }).catch(function () { hide(7); });
  });

  window.addEventListener('kt-installed', function () {
    state.installed = true; save(state); hide(0);
  });

  // (2) 크롬 계열: 이벤트가 온다 = 아직 설치되지 않았다는 브라우저의 확답
  if (window.__ktBip) show('install');
  else window.addEventListener('kt-installable', function () { show('install'); });

  // (3) iOS 사파리: 설치 API 가 없어 확인할 방법이 없다. 잠깐 읽은 뒤에만 권한다.
  if (ios && !window.__ktBip) setTimeout(function () { show('ios'); }, 6000);

  // 크롬은 fetch 핸들러가 있는 서비스워커가 자리를 잡아야 설치 가능으로 판정한다.
  // 즉 등록이 늦으면 설치 배너도 그만큼 늦게 뜬다. load 이벤트만 믿으면 안 된다 —
  // 애드센스·GTM·웹폰트가 늦게 끝나면 load 가 몇 초씩 밀리고, 그 전에 떠난 사람에게는
  // 워커가 영영 등록되지 않는다. load 와 2.5초 타이머 중 먼저 오는 쪽을 쓴다.
  if ('serviceWorker' in navigator) {
    var swDone = false;
    var registerSw = function () {
      if (swDone) return;
      swDone = true;
      navigator.serviceWorker.register('${base}/sw.js', { scope: '${base}/' }).catch(function () { /* 무시 */ });
    };
    if (document.readyState === 'complete') registerSw();
    else {
      setTimeout(registerSw, 2500);
      addEventListener('load', registerSw);
    }
  }
})();
</script>`;
}

/**
 * 서비스워커. 크롬이 설치 가능으로 판정하려면 fetch 핸들러가 있어야 한다.
 *
 * 하루에 여러 번 글이 올라오는 사이트라 캐시가 본문을 덮으면 안 된다.
 * HTML 은 항상 네트워크 우선, 캐시는 오프라인 대비용으로만 쓴다.
 */
export function serviceWorkerSource(config) {
  const base = basePathOf(config);
  const ver = config.assetVersion || 'v1';
  return `// 자동 생성 파일 — scripts/lib/pwa.mjs 에서 만든다. 직접 고치지 말 것.
var CACHE = 'ktrend-${ver}';
var HOME = '${base}/';
var OFFLINE_HTML =
  '<!doctype html><html lang="ko"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>오프라인</title>' +
  '<body style="margin:0;display:grid;place-items:center;min-height:100vh;' +
  'font:16px/1.6 system-ui,-apple-system,sans-serif;color:#16181d;background:#f6f7f9">' +
  '<div style="text-align:center;padding:2rem">' +
  '<p style="margin:0 0 4px">인터넷에 연결되어 있지 않아 이 글을 열 수 없습니다.</p>' +
  '<p style="margin:0 0 20px;color:#667085;font-size:14px">' +
  'You are offline, so this page could not be loaded.</p>' +
  '<a href="' + HOME + '" style="display:inline-block;padding:10px 18px;border-radius:9px;' +
  'background:#2f6bff;color:#fff;text-decoration:none;font-weight:600;font-size:14px">' +
  '홈으로 / Home</a></div>';

self.addEventListener('install', function (e) {
  // 새 워커가 곧바로 일하도록 한다. HTML 을 네트워크 우선으로 다루므로
  // 예전 문서를 덮어쓸 위험이 없다.
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.add(HOME); }).catch(function () {}));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  // 광고·애널리틱스·폰트는 건드리지 않는다. 가로채면 CORS 만 복잡해진다.
  if (url.origin !== self.location.origin) return;
  // 어드민과 저장 API 는 캐시 대상이 아니다 — 낡은 응답이 저장을 망친다.
  if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/admin') === 0) return;

  // 문서: 네트워크 우선. 실패했을 때만 캐시를 꺼내 오프라인 화면을 만든다.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
          }
          return res;
        })
        .catch(function () {
          // 캐시에 없으면 홈으로 돌리지 않는다. 주소는 그대로인데 다른 글이 뜨면
          // 읽는 사람은 그 글이 이 주소의 내용이라고 오해한다. 오프라인이라고 말한다.
          return caches.match(req).then(function (hit) {
            return hit || new Response(OFFLINE_HTML, {
              status: 503,
              headers: { 'content-type': 'text/html; charset=utf-8' },
            });
          });
        })
    );
    return;
  }

  // 정적 자산: 캐시를 먼저 주고 뒤에서 조용히 갱신한다.
  // CSS 는 ?v=해시가 붙어 있어 내용이 바뀌면 주소가 바뀌므로 낡을 일이 없다.
  if (url.pathname.indexOf('/assets/') === 0) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        var net = fetch(req)
          .then(function (res) {
            if (res && res.ok) {
              var copy = res.clone();
              caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
            }
            return res;
          })
          .catch(function () { return hit; });
        return hit || net;
      })
    );
  }
});
`;
}
