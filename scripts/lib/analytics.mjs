// 분석 도구 ID 검증 및 스니펫 생성
//
// 두 방식을 모두 지원한다.
//   - GTM (GTM-XXXXXXX): 태그를 GTM 화면에서 관리. 재배포 없이 태그 추가 가능.
//   - GA4 직접 (G-XXXXXXXXXX): gtag.js 를 직접 삽입.
// 둘 다 설정하면 GA4 가 두 번 집계될 수 있으므로 GTM 을 우선하고 GA4 직접 삽입은 생략한다.

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
  if (gtm) {
    return `\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');</script>`;
  }
  const ga4 = normalizeGa4Id(config.analytics.ga4);
  if (ga4) {
    return `\n<script async src="https://www.googletagmanager.com/gtag/js?id=${ga4}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga4}');</script>`;
  }
  return '';
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
  const send = gtm
    ? `window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: 'affiliate_click' }, payload));`
    : `if (typeof gtag === 'function') gtag('event', 'affiliate_click', payload);`;
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
