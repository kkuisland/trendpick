// 방문자 언어에 따른 진입 페이지 라우팅
//
// 구글은 IP 기반 자동 리디렉션을 권장하지 않는다. Googlebot 은 주로 미국 IP 로
// 크롤링하므로, IP 로 판단해 영문으로 보내버리면 한국어 페이지가 영문의 중복으로
// 취급되어 색인에서 빠질 수 있다. 그래서 아래 안전장치를 모두 건다.
//
//   1) 루트("/") 로 들어온 요청만 분기한다. 개별 글 URL 은 절대 건드리지 않는다.
//   2) 크롤러는 절대 리디렉션하지 않는다 → 양쪽 언어 모두 정상 색인된다.
//   3) 301 이 아니라 302 를 쓴다 (사용자마다 목적지가 다르므로 영구 이동이 아니다).
//   4) 판단 근거는 IP 가 아니라 Accept-Language 를 우선한다.
//      해외 거주 한국인·국내 거주 외국인을 IP 보다 정확히 맞춘다.
//   5) 사용자가 언어를 직접 고르면(?lang=) 쿠키로 기억해 다시 튕기지 않는다.

const BOT_RE =
  /bot\b|bot[/_-]|crawl|spider|slurp|scrape|fetcher|monitor|lighthouse|headless|preview|googlebot|bingbot|yeti|daum|baidu|yandex|duckduck|applebot|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|discord|slack|ahrefs|semrush|petal|gptbot|claude|ccbot|perplexity|pingdom|uptime/i;

export function isBot(userAgent) {
  return BOT_RE.test(String(userAgent || ''));
}

/**
 * Accept-Language 헤더에서 ko / en 중 더 선호하는 쪽을 고른다.
 * 예: "ko-KR,ko;q=0.9,en-US;q=0.8" → 'ko'
 * @returns {'ko'|'en'|null} 둘 다 없으면 null
 */
export function preferredLanguage(header) {
  const raw = String(header || '').trim();
  if (!raw) return null;
  const items = raw
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((s) => s.trim().startsWith('q='));
      const q = qParam ? parseFloat(qParam.split('=')[1]) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q);
  for (const it of items) {
    if (it.tag === 'ko' || it.tag.startsWith('ko-')) return 'ko';
    if (it.tag === 'en' || it.tag.startsWith('en-')) return 'en';
  }
  return null;
}

/** 쿠키 문자열에서 저장된 언어 선택을 읽는다 */
export function cookieLanguage(cookieHeader) {
  const m = String(cookieHeader || '').match(/(?:^|;\s*)ktlang=(ko|en)\b/);
  return m ? m[1] : null;
}

/**
 * 이 요청을 어떻게 처리할지 결정한다.
 * @returns {{ action: 'redirect', to: string, setLang?: string }
 *          | { action: 'serve', setLang?: string }}
 */
export function routeLanguage({ urlPath, query = '', headers = {} }) {
  const explicit = /(?:^|&)lang=(ko|en)(?:&|$)/.exec(query)?.[1] || null;

  // 사용자가 직접 고른 언어는 최우선 — 쿠키에 기억시키고 그대로 서빙한다.
  if (explicit) return { action: 'serve', setLang: explicit };

  // 루트 외의 경로는 손대지 않는다 (개별 글은 검색에서 직접 들어오는 입구다).
  if (urlPath !== '/') return { action: 'serve' };

  // 크롤러는 그대로 한국어 루트를 보게 둔다 (양쪽 언어 정상 색인 보장).
  if (isBot(headers['user-agent'])) return { action: 'serve' };

  // 이전에 고른 언어가 있으면 존중한다.
  const saved = cookieLanguage(headers.cookie);
  if (saved) return saved === 'en' ? { action: 'redirect', to: '/en/' } : { action: 'serve' };

  // 브라우저 언어가 1순위 판단 근거다.
  const accept = String(headers['accept-language'] || '').trim();
  const pref = preferredLanguage(accept);
  if (pref === 'ko') return { action: 'serve' };
  if (pref === 'en') return { action: 'redirect', to: '/en/' };

  // 언어 설정은 있는데 ko·en 이 둘 다 없는 경우(예: 일본어·중국어·스페인어 브라우저).
  // 이 방문자는 한국어를 읽지 못하므로 영문이 더 쓸모 있다. IP 설정에 의존하지 않는다.
  if (accept) return { action: 'redirect', to: '/en/' };

  // Accept-Language 자체가 없는 드문 경우에만 국가 코드로 보조 판단한다.
  const country = String(headers['cf-ipcountry'] || '').toUpperCase();
  if (country && country !== 'KR' && country !== 'XX') {
    return { action: 'redirect', to: '/en/' };
  }
  // 아무 신호도 없으면 기본값(한국어)을 유지한다.
  return { action: 'serve' };
}

/** 언어 선택 쿠키 헤더 값 */
export function langCookie(lang) {
  return `ktlang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
