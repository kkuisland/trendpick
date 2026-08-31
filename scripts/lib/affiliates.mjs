// 제휴 링크 렌더러
//
// 설계 원칙
//  1) 글에는 {{aff 키}} 만 쓴다 — 실제 URL·추적코드는 data/affiliates.json 한 곳에서만 관리.
//     제휴 캠페인이 바뀌어도 글을 하나도 건드리지 않는다.
//  2) URL 이 비어 있으면 아무것도 렌더링하지 않는다 — 링크가 준비되기 전에 글을 먼저 써도 안전.
//  3) 대가성 고지는 프런트매터 플래그가 아니라 "실제로 제휴 링크가 렌더링됐는가"로 판단한다.
//     법적 의무를 사람의 기억에 의존시키지 않기 위함.
//  4) 모든 제휴 링크에 rel="sponsored" 를 붙인다 (구글 정책 + GA4 클릭 추적의 판별자).
import { escapeHtml } from './util.mjs';
import { buildTripUrl } from './tripcom.mjs';

/**
 * 링크의 최종 목적지를 정한다.
 *  1) url 이 있으면 그대로 (대시보드에서 만든 링크)
 *  2) 없으면 sourceUrl 에 파트너 추적 파라미터를 붙여 자동 생성
 * 트립닷컴처럼 "대상 주소 + 제휴 파라미터" 방식인 곳은 2번으로 대시보드 없이 처리된다.
 */
export function resolveUrl(link, partner, subid = '') {
  if (link.url) return link.url;
  if (!link.sourceUrl) return '';
  const tracking = partner?.tracking;
  if (tracking && Object.keys(tracking).length) {
    const built = buildTripUrl(link.sourceUrl, tracking, subid);
    if (built) return built;
  }
  return '';
}

/** 파트너의 subid 파라미터를 URL 에 덧붙인다 (이미 있으면 덮어쓰지 않음) */
function withSubId(rawUrl, subidParam, subidValue) {
  if (!subidParam || !subidValue) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (!u.searchParams.has(subidParam)) u.searchParams.set(subidParam, subidValue);
    return u.toString();
  } catch {
    return rawUrl; // 상대경로 등 파싱 불가 시 원본 유지
  }
}

/**
 * 글 본문에 제휴 블록을 자동으로 끼워 넣는다.
 *
 * 글마다 마크다운을 고치지 않고 data/affiliates.json 의 postLinks 에
 * 슬러그만 등록하면 되도록 하기 위한 것. 어드민 페이지가 건드리는 것도 이 부분이다.
 *
 * 이미 본문에 {{aff}} 로 직접 넣은 블록이 있으면 건드리지 않는다(수동 배치 우선).
 * 위치는 기본적으로 FAQ 섹션 바로 앞 — 본문을 다 읽은 뒤라 문맥을 깨지 않는다.
 * afterHeading 을 주면 그 문구가 포함된 h2 바로 다음 문단 뒤에 넣는다.
 *
 * @returns {{html: string, injected: boolean}}
 */
export function injectPostLink(html, box, { afterHeading = '' } = {}) {
  if (!box) return { html, injected: false };
  if (html.includes('class="aff-box"') || html.includes('class="aff-group"')) {
    return { html, injected: false }; // 이미 수동 배치됨
  }

  if (afterHeading) {
    // 지정한 소제목 다음 섹션의 끝(다음 h2 직전)에 삽입
    const re = new RegExp(`(<h2 id="[^"]*">(?:(?!</h2>).)*${escapeRegex(afterHeading)}(?:(?!</h2>).)*</h2>)`, 'i');
    const m = html.match(re);
    if (m) {
      const start = html.indexOf(m[1]) + m[1].length;
      const nextH2 = html.indexOf('<h2 ', start);
      const at = nextH2 === -1 ? html.length : nextH2;
      return { html: html.slice(0, at) + '\n' + box + '\n' + html.slice(at), injected: true };
    }
  }

  const faqAt = html.indexOf('<section class="faq-section">');
  if (faqAt !== -1) {
    return { html: html.slice(0, faqAt) + box + '\n' + html.slice(faqAt), injected: true };
  }
  return { html: html + '\n' + box, injected: true };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * {{aff 키}} 렌더러를 만든다.
 * @param {object} config      로케일이 적용된 config
 * @param {object} registry    data/affiliates.json 내용
 * @param {object} ctx         { slug } — subid 에 쓰이는 글 식별자
 * @param {object} usage       렌더링 결과가 기록되는 객체 (usage.partners: Set)
 */
export function makeAffBox(config, registry, ctx, usage) {
  const isEn = config.locale?.code === 'en';
  const partners = registry?.partners || {};
  const links = registry?.links || {};

  const groups = registry?.groups || {};

  /** 여러 선택지를 한 블록으로 (예: 출발 도시별 항공권) */
  function renderGroup(key, group) {
    const partner = partners[group.partner];
    if (!partner || !partner.enabled) return `<!-- aff: 파트너 비활성 (${escapeHtml(group.partner)}) -->`;
    const items = (group.items || [])
      .map((it) => ({ ...it, resolved: resolveUrl(it, partner, ctx.slug) }))
      .filter((it) => it.resolved);
    if (!items.length) return `<!-- aff: URL 미설정 그룹 (${escapeHtml(key)}) -->`;

    usage.partners.add(group.partner);
    const title = (isEn && group.titleEn) || group.title || partner.name;
    const buttons = items
      .map((it) => {
        const href = withSubId(it.resolved, partner.subidParam, ctx.slug);
        const label = (isEn && it.labelEn) || it.label;
        return `<a href="${escapeHtml(href)}" target="_blank" rel="sponsored noopener noreferrer" data-aff-partner="${escapeHtml(group.partner)}" data-aff-key="${escapeHtml(key)}:${escapeHtml(it.label)}">${escapeHtml(label)}<span class="aff-arrow">→</span></a>`;
      })
      .join('');
    return `<div class="aff-group">
  <div class="aff-group-head"><span class="aff-badge">${escapeHtml(partner.name)}</span><span class="aff-group-title">${escapeHtml(title)}</span></div>
  <div class="aff-group-items">${buttons}</div>
</div>`;
  }

  return function affBox(arg) {
    const key = String(arg || '').trim();
    if (groups[key]) return renderGroup(key, groups[key]);
    const link = links[key];
    if (!link) return `<!-- aff: 알 수 없는 키 "${escapeHtml(key)}" -->`;

    const partner = partners[link.partner];
    if (!partner || !partner.enabled) return `<!-- aff: 파트너 비활성 (${escapeHtml(link.partner)}) -->`;
    const target = resolveUrl(link, partner, ctx.slug);
    if (!target) return `<!-- aff: URL 미설정 (${escapeHtml(key)}) — data/affiliates.json 에서 채우세요 -->`;

    const href = withSubId(target, partner.subidParam, ctx.slug);
    const label = (isEn && partner.labelEn) || partner.label || partner.name;
    const title = (isEn && link.titleEn) || link.title || label;

    usage.partners.add(link.partner);

    return `<div class="aff-box"><a href="${escapeHtml(href)}" target="_blank" rel="sponsored noopener noreferrer" data-aff-partner="${escapeHtml(link.partner)}" data-aff-key="${escapeHtml(key)}">
  <span class="aff-badge">${escapeHtml(label)}</span>
  <span class="aff-title">${escapeHtml(title)}</span>
  <span class="aff-arrow">→</span>
</a></div>`;
  };
}

/**
 * 글에서 실제 사용된 파트너들의 대가성 고지 문구를 모은다.
 * 여러 파트너를 썼으면 각각의 문구를 함께 노출한다.
 */
export function disclosureFor(registry, usedPartners, localeCode) {
  const isEn = localeCode === 'en';
  const out = [];
  for (const key of usedPartners) {
    const partner = registry?.partners?.[key];
    if (!partner) continue;
    const text = (isEn && partner.disclosureEn) || partner.disclosure;
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}
