// 글마다 어떤 제휴를 붙이면 좋을지 추천한다.
//
// 어드민 페이지에서 "이 글엔 뭘 넣지?"를 고민하지 않도록 하는 것이 목적이다.
// 판단 근거는 세 가지 — 이벤트의 수익화 메모(data/events.json 의 monetize),
// 제목·키워드에 드러난 구매 의도, 그리고 넣으면 안 되는 주제인지 여부.

/** 제휴 링크를 넣으면 안 되는 주제 (docs/WRITING.md 와 같은 기준) */
const BLOCK = [
  { re: /병원|약국|응급|진료|증상|치료|복용|처방|건강|의료|hospital|pharmacy|symptom/i, why: '의료·건강 주제 — 신뢰도가 우선입니다' },
  { re: /재난|사고|화재|지진|태풍 피해|참사|안전 점검|disaster|earthquake/i, why: '재난·안전 주제 — 제휴 링크는 부적절합니다' },
  { re: /과태료|벌금|법 개정|시행일|공제|세금|연말정산|지원금/, why: '제도 안내 — 상업 링크가 어울리지 않습니다' },
];

/** 구매 의도 신호 → 파트너와 아이디어. 영문 글도 잡히도록 영어 표현을 함께 넣는다. */
const SIGNALS = [
  {
    partner: 'tripcom',
    re: /여행|숙소|호텔|항공|비행기|직관|관광|현지|해외|나고야|도쿄|오사카|일본|제주|왕복|travel|trip|hotel|stay|accommodation|flight|visit|itinerary|tourist/i,
    ideas: ['현지 숙소 요금 비교', '출발 도시별 항공권'],
  },
  {
    partner: 'coupang',
    re: /선물|세트|용품|준비물|구매|쇼핑|세일|할인|특가|직구|블랙프라이데이|가전|액세서리|사전예약|gift|shopping|deal|discount/i,
    ideas: ['관련 상품 검색 링크'],
  },
];

/**
 * 본문에서 검색어로 쓸 만한 말을 뽑는다.
 * 문맥 없이 아무 명사나 뽑으면 엉뚱한 상품이 걸리므로,
 * "구매·예약과 실제로 이어지는 말"만 사전으로 좁혀서 찾는다.
 */
const PRODUCT_TERMS = [
  // 쇼핑
  '선물세트', '선물', '상비약', '준비물', '용품', '가전', '노트북', '이어폰', '헤드폰',
  '충전기', '보조배터리', '케이스', '필름', '모니터', '키보드', '마우스', '카메라',
  '캐리어', '여행가방', '텀블러', '담요', '목베개', '멀미약', '체온계', '해열제',
  '한우', '굴비', '홍삼', '과일', '견과류', '커피', '건강식품', '방한용품', '난방',
  // 여행
  '숙소', '호텔', '항공권', '비행기', '기차표', '패키지', '렌터카', '입장권', '투어',
];

const CITY_HINTS = [
  { re: /나고야|아이치/, city: '나고야', tripCity: '347' },
  { re: /도쿄/, city: '도쿄', tripCity: '228' },
  { re: /오사카/, city: '오사카', tripCity: '292' },
  { re: /서울/, city: '서울', tripCity: '232' },
  { re: /부산/, city: '부산', tripCity: '253' },
  { re: /제주/, city: '제주', tripCity: '336' },
];

/** 본문에서 상품·여행 키워드와 도시를 뽑는다 */
export function extractTerms(text = '') {
  const s = String(text);
  const terms = PRODUCT_TERMS.filter((t) => s.includes(t));
  const city = CITY_HINTS.find((c) => c.re.test(s)) || null;
  return {
    terms: Array.from(new Set(terms)).slice(0, 6),
    city: city ? { name: city.city, tripCity: city.tripCity } : null,
  };
}

/** 이벤트별 수익화 메모에서 파트너를 유추 */
function partnerFromMonetize(memo) {
  if (!memo) return null;
  if (/여행|항공|숙소|호텔/.test(memo)) return 'tripcom';
  if (/쿠팡|선물|용품|상품/.test(memo)) return 'coupang';
  return null;
}

/**
 * @param {object} post   { slug, title, description, category, tags, keywords, event, hasAff }
 * @param {object[]} events data/events.json
 * @param {object} registry data/affiliates.json
 * @returns {{verdict:'blocked'|'suggest'|'none', reason:string, partner:string|null,
 *            ideas:string[], keys:{key:string,title:string}[]}}
 */
export function recommendAffiliate(post, events = [], registry = {}) {
  const text = [post.title, post.description, (post.tags || []).join(' '), (post.keywords || []).join(' ')]
    .filter(Boolean)
    .join(' ');
  // 본문까지 훑어 실제로 언급된 상품·도시를 찾는다 (검색어 후보로 쓴다)
  const found = extractTerms(`${text} ${post.plain || ''}`);

  for (const b of BLOCK) {
    if (b.re.test(text)) {
      return { verdict: 'blocked', reason: b.why, partner: null, ideas: [], keys: [], terms: [], city: null };
    }
  }

  const ev = post.event ? events.find((e) => e.key === post.event) : null;
  const ideas = [];
  let partner = null;
  let reason = '';

  if (ev?.monetize) {
    partner = partnerFromMonetize(ev.monetize);
    ideas.push(ev.monetize);
    reason = `${ev.name} 연계`;
  }

  for (const s of SIGNALS) {
    if (!s.re.test(text)) continue;
    if (!partner) partner = s.partner;
    for (const i of s.ideas) if (!ideas.includes(i)) ideas.push(i);
    if (!reason) reason = '본문에 구매 의도 신호가 있습니다';
  }

  if (!partner) {
    return {
      verdict: 'none',
      reason: '구매로 이어질 만한 맥락이 뚜렷하지 않습니다. 억지로 넣지 않는 편이 낫습니다.',
      partner: null,
      ideas: [],
      keys: [],
      terms: found.terms,
      city: found.city,
    };
  }

  // 바로 쓸 수 있는 기존 링크를 고른다.
  // 짧은 토막 단어로 매칭하면 "11월" 하나로 수능 글에 블프 링크가 붙는 식의
  // 엉뚱한 추천이 나온다. 그래서 의미가 뚜렷한 단어(한글 3자·영문 5자 이상)만 쓰고,
  // 겹치는 단어 수로 점수를 매겨 상위 2개만 남긴다.
  const isEn = post.locale === 'en';
  const words = Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^가-힣a-z0-9]+/)
        .filter((w) => (/[가-힣]/.test(w) ? w.length >= 3 : w.length >= 5))
    )
  );

  const score = (key, node) => {
    // 영문 글에는 영문 표기가 준비된 링크만 (한국어 버튼이 섞이면 어색하다)
    if (isEn && !node.titleEn && !node.labelEn && !(node.items || []).some((i) => i.labelEn)) return 0;
    const hay = `${key} ${node.title || ''} ${node.titleEn || ''} ${node.note || ''}`.toLowerCase();
    return words.filter((w) => hay.includes(w)).length;
  };

  const scored = [];
  for (const [key, l] of Object.entries(registry.links || {})) {
    if (l.partner !== partner || (!l.url && !l.sourceUrl)) continue;
    const s = score(key, l);
    if (s > 0) scored.push({ key, title: l.title || key, s });
  }
  for (const [key, g] of Object.entries(registry.groups || {})) {
    if (g.partner !== partner) continue;
    const s = score(key, g);
    if (s > 0) scored.push({ key, title: g.title || key, s });
  }
  const keys = scored
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map(({ key, title }) => ({ key, title }));

  return { verdict: 'suggest', reason, partner, ideas, keys, terms: found.terms, city: found.city };
}
