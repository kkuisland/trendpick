// 쿠팡 파트너스 Open API — 딥링크 자동 생성
//
// ⚠️ 이 API 는 파트너스 누적 판매액이 일정 금액(15만 원)을 넘어야 활성화된다.
//    그전까지는 대시보드에서 수동으로 링크를 만들어야 하므로, 키가 없거나 권한이 없으면
//    조용히 null 을 돌려주고 호출부가 "수동 생성 요청"으로 넘어가게 한다.
//
// 사용법: 환경변수 COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 설정
//    (쿠팡 파트너스 → 도구 → 파트너스 API 에서 발급)
import crypto from 'node:crypto';

const HOST = 'https://api-gateway.coupang.com';
const PATH = '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';

/** 쿠팡 HMAC 서명 헤더 (CEA algorithm=HmacSHA256) */
function authorization(method, urlPath, accessKey, secretKey) {
  // 형식: yyMMdd'T'HHmmss'Z' (GMT)
  const datetime = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2);
  const [pathOnly, query = ''] = urlPath.split('?');
  const message = datetime + method + pathOnly + query;
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

export function hasCoupangKeys() {
  return !!(process.env.COUPANG_ACCESS_KEY && process.env.COUPANG_SECRET_KEY);
}

/**
 * 쿠팡 URL 들을 제휴 딥링크로 변환한다.
 * @param {string[]} urls  변환할 쿠팡 주소 (상품·검색 페이지 등)
 * @param {string} subId   글 단위 구분값
 * @returns {Promise<{ok: true, links: string[]} | {ok: false, reason: string}>}
 */
export async function createDeeplinks(urls, subId = '') {
  const accessKey = process.env.COUPANG_ACCESS_KEY;
  const secretKey = process.env.COUPANG_SECRET_KEY;
  if (!accessKey || !secretKey) return { ok: false, reason: 'API 키 미설정' };
  if (!urls?.length) return { ok: false, reason: '변환할 URL 없음' };

  const body = JSON.stringify({ coupangUrls: urls, ...(subId ? { subId } : {}) });
  let res;
  try {
    res = await fetch(HOST + PATH, {
      method: 'POST',
      headers: {
        Authorization: authorization('POST', PATH, accessKey, secretKey),
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body,
    });
  } catch (err) {
    return { ok: false, reason: `네트워크 오류: ${err.message}` };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: 'API 권한 없음 (누적 판매액 요건 미달이거나 키가 잘못됨)' };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

  let json;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: '응답 파싱 실패' };
  }
  const links = (json?.data || [])
    .map((d) => d?.shortenUrl || d?.landingUrl)
    .filter(Boolean);
  if (!links.length) return { ok: false, reason: '응답에 링크 없음' };
  return { ok: true, links };
}
