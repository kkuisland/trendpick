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
    const items = (group.items || []).filter((it) => it.url);
    if (!items.length) return `<!-- aff: URL 미설정 그룹 (${escapeHtml(key)}) -->`;

    usage.partners.add(group.partner);
    const title = (isEn && group.titleEn) || group.title || partner.name;
    const buttons = items
      .map((it) => {
        const href = withSubId(it.url, partner.subidParam, ctx.slug);
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
    if (!link.url) return `<!-- aff: URL 미설정 (${escapeHtml(key)}) — data/affiliates.json 에서 채우세요 -->`;

    const href = withSubId(link.url, partner.subidParam, ctx.slug);
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
