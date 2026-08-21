// 트립닷컴 제휴 추적 링크 생성
//
// 트립닷컴 제휴는 대상 URL 에 제휴사 식별 파라미터(Allianceid·SID)를 붙이는 방식이다.
// 즉 대시보드에 들어가지 않아도, 평범한 trip.com 주소만 있으면 추적 링크를 만들 수 있다.
// → data/affiliates.json 에 sourceUrl(일반 주소)만 넣으면 빌드가 알아서 추적 링크로 바꾼다.
//
// 파라미터 값은 파트너 계정마다 다르므로 affiliates.json 의 partners.tripcom.tracking 에서 관리한다.
// 이미 추적 파라미터가 붙어 있는 URL(대시보드에서 직접 만든 단축 링크 등)은 건드리지 않는다.

const TRIP_HOST_RE = /(^|\.)trip\.com$/i;

/** trip.com 계열 주소인지 */
export function isTripUrl(url) {
  try {
    return TRIP_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * 일반 trip.com 주소에 제휴 추적 파라미터를 붙인다.
 * @param {string} rawUrl   대상 주소 (예: https://kr.trip.com/hotels/list?city=...)
 * @param {object} tracking { Allianceid, SID, ... } — 그대로 쿼리에 붙는다
 * @param {string} subid    글 단위 구분값 (trip_sub1 로 전달)
 * @returns {string|null}   trip.com 주소가 아니거나 추적정보가 없으면 null
 */
export function buildTripUrl(rawUrl, tracking = {}, subid = '') {
  if (!rawUrl || !isTripUrl(rawUrl)) return null;
  const entries = Object.entries(tracking).filter(([, v]) => v !== '' && v != null);
  if (!entries.length) return null;
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  // 이미 붙어 있는 값은 덮어쓰지 않는다 (대시보드가 만든 링크를 존중)
  for (const [k, v] of entries) {
    if (!u.searchParams.has(k)) u.searchParams.set(k, String(v));
  }
  if (subid && !u.searchParams.has('trip_sub1')) u.searchParams.set('trip_sub1', subid);
  return u.toString();
}
