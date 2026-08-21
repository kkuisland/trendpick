// 애드센스 게시자 ID 정규화
//
// 사용자가 어떤 형태로 붙여넣든(ca-pub-…, pub-…, 숫자만) 올바른 값으로 맞춘다.
//   - ads.txt 에는 "pub-0000000000000000" 형식이 들어간다
//   - <script> 태그의 data-ad-client 에는 "ca-pub-0000000000000000" 형식이 들어간다
// 형식이 어긋난 값은 null 을 돌려 잘못된 ads.txt 가 배포되는 것을 막는다.

/** ads.txt 용: pub-XXXXXXXXXXXXXXXX (실패 시 null) */
export function normalizePubId(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (digits.length !== 16) return null;
  return `pub-${digits}`;
}

/** 스크립트 태그용: ca-pub-XXXXXXXXXXXXXXXX (실패 시 null) */
export function normalizeClientId(raw) {
  const pub = normalizePubId(raw);
  return pub ? `ca-${pub}` : null;
}
