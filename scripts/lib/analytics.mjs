// 분석 도구 ID 검증 및 스니펫 생성
//
// 두 방식을 모두 지원하며, 함께 쓸 수도 있다.
//   - GTM (GTM-XXXXXXX): 태그를 GTM 화면에서 관리. 재배포 없이 태그 추가 가능.
//   - GA4 직접 (G-XXXXXXXXXX): gtag.js 를 직접 삽입해 곧바로 수집을 시작한다.
//
// 둘 다 설정하면 둘 다 삽입한다. GTM 은 빈 그릇이라 그 자체로는 아무것도 수집하지
// 않으므로 중복 집계가 생기지 않는다.
// ⚠️ 단 하나의 주의점: GTM 안에 같은 측정 ID 로 GA4 구성 태그를 또 만들면
//    같은 조회가 두 번 잡힌다. GA4 를 여기서 직접 넣었다면 GTM 에는 넣지 말 것.

/** GTM 컨테이너 ID 검증 (GTM-XXXXXXX) */
export function normalizeGtmId(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return /^GTM-[A-Z0-9]{4,}$/.test(s) ? s : null;
}

/** GA4 측정 ID 검증 (G-XXXXXXXXXX) */
export function normalizeGa4Id(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return /^G-[A-Z0-9]{6,}$/.test(s) ? s : null;
}

/** <head> 에 넣을 스니펫 */
export function analyticsHead(config) {
  const gtm = normalizeGtmId(config.analytics.gtm);
  const ga4 = normalizeGa4Id(config.analytics.ga4);
  let out = '';
  // GA4 를 먼저 넣어 gtag 가 정의된 상태로 GTM 이 로드되게 한다.
  if (ga4) {
    out += `\n<script async src="https://www.googletagmanager.com/gtag/js?id=${ga4}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga4}');</script>`;
  }
  if (gtm) {
    out += `\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');</script>`;
  }
  return out;
}

/** <body> 바로 뒤에 넣을 GTM noscript (자바스크립트 비활성 환경 대응) */
export function analyticsBodyStart(config) {
  const gtm = normalizeGtmId(config.analytics.gtm);
  if (!gtm) return '';
  return `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${gtm}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
}

/**
 * 제휴 링크 클릭 추적 스크립트.
 * GTM 은 dataLayer 커스텀 이벤트로, GA4 직접 설치는 gtag 로 보낸다.
 * (GTM 에서는 gtag() 가 정의되지 않으므로 dataLayer.push 가 정답)
 */
export function affiliateTracking(config) {
  const gtm = normalizeGtmId(config.analytics.gtm);
  const ga4 = normalizeGa4Id(config.analytics.ga4);
  if (!gtm && !ga4) return '';
  // GA4 를 직접 설치했으면 gtag 로 보내는 편이 확실하다(GTM 설정 없이도 바로 잡힘).
  // GTM 만 있으면 dataLayer 커스텀 이벤트로 보내고, GTM 에서 트리거를 걸어 쓴다.
  const send = ga4
    ? `if (typeof gtag === 'function') gtag('event', 'affiliate_click', payload);`
    : `window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: 'affiliate_click' }, payload));`;
  return `<script>
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[rel~="sponsored"]');
  if (!a) return;
  var payload = {
    affiliate_partner: a.getAttribute('data-aff-partner') || 'other',
    affiliate_key: a.getAttribute('data-aff-key') || '',
    link_url: a.href,
    link_domain: (function () { try { return new URL(a.href).hostname; } catch (_) { return ''; } })(),
    link_text: (a.innerText || '').trim().slice(0, 80),
    page_path: location.pathname
  };
  ${send}
}, true);
</script>`;
}
