// 페이지 템플릿: 모든 HTML 생성을 담당 (ko/en 다국어)
import { escapeHtml, eventStatus, truncate } from './util.mjs';
import { jsonLdScript } from './seo.mjs';
import { formatDate, formatRange, localeCodes } from './i18n.mjs';
import { normalizeClientId } from './adsense.mjs';
import { analyticsHead, analyticsBodyStart, affiliateTracking } from './analytics.mjs';

// 로케일 경로 접두사를 붙인 내부 URL
const u = (config, path) => (config.locale?.prefix || '') + path;
const T = (config) => config.locale.t;

// ---------- 수익화 블록 ----------

/** 광고 슬롯 빌더 (애드센스 → 애드핏 → 자리표시 주석 순) */
export function makeAdSlot(config) {
  const m = config.monetization;
  return function adSlot() {
    const adsClient = normalizeClientId(m.adsense.client);
    if (m.adsense.enabled && adsClient) {
      const slot = m.adsense.slots.inArticle || '';
      return `<div class="ad-slot"><ins class="adsbygoogle" style="display:block; text-align:center;" data-ad-client="${adsClient}"${slot ? ` data-ad-slot="${slot}"` : ''} data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>`;
    }
    if (m.adfit.enabled && (m.adfit.unitPc || m.adfit.unitMobile)) {
      let html = '<div class="ad-slot">';
      if (m.adfit.unitPc)
        html += `<div class="ad-pc"><ins class="kakao_ad_area" style="display:none;" data-ad-unit="${m.adfit.unitPc}" data-ad-width="728" data-ad-height="90"></ins></div>`;
      if (m.adfit.unitMobile)
        html += `<div class="ad-mo"><ins class="kakao_ad_area" style="display:none;" data-ad-unit="${m.adfit.unitMobile}" data-ad-width="320" data-ad-height="100"></ins></div>`;
      html += '<script type="text/javascript" src="//t1.daumcdn.net/kas/static/ba.min.js" async></script></div>';
      return html;
    }
    return '<!-- 광고 슬롯: config/site.config.json 의 monetization 에서 활성화 -->';
  };
}

/** 쿠팡 파트너스 박스 빌더 */
export function makeCoupangBox(config) {
  const cp = config.monetization.coupang;
  const isEn = config.locale?.code === 'en';
  const disclosure = isEn
    ? '<p class="cp-disclosure">This page contains affiliate links. We may earn a commission from qualifying purchases at no extra cost to you.</p>'
    : '<p class="cp-disclosure">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p>';
  return function coupangBox(attrs = {}) {
    if (!cp.enabled) return '<!-- 쿠팡 파트너스 슬롯 (비활성) -->';
    if (attrs.url) {
      const title = escapeHtml(attrs.title || (isEn ? 'Check current price' : '상품 보러 가기'));
      const badge = isEn ? 'Coupang' : '쿠팡 최저가 확인';
      return `<div class="cp-box"><a href="${attrs.url}" target="_blank" rel="sponsored noopener noreferrer"><span class="cp-badge">${badge}</span><span class="cp-title">${title}</span><span class="cp-arrow">→</span></a>${disclosure}</div>`;
    }
    if (cp.dynamicBannerId) {
      return `<div class="cp-box cp-dynamic"><script src="https://ads-partners.coupang.com/g.js"></script><script>new PartnersCoupang.G({"id":${Number(cp.dynamicBannerId)},"template":"carousel","trackingCode":"${cp.trackingCode || ''}","width":"680","height":"140"});</script>${disclosure}</div>`;
    }
    return '';
  };
}

/**
 * 후원 박스 빌더 ({{support}})
 * 모바일에서는 카카오페이 버튼(앱으로 바로 연결), 어디서나 계좌 복사를 제공한다.
 * 계좌 정보는 config.support 에서만 관리하므로 바뀌어도 글은 건드리지 않는다.
 */
export function makeSupportBox(config) {
  const s = config.support || {};
  const isEn = config.locale?.code === 'en';
  return function supportBox() {
    if (!s.enabled) return '<!-- 후원 박스 (비활성) -->';
    const account = `${s.bankName} ${s.accountNumber}`;
    const t = isEn
      ? {
          kakaoTitle: 'Support with KakaoPay',
          kakaoSub: 'Opens in the KakaoTalk app on mobile',
          bankLabel: 'Bank transfer (easier on desktop)',
          holder: 'Account holder',
          copy: 'Copy account number',
          copied: 'Copied',
          note: 'Support is entirely optional and does not affect access to any content.',
        }
      : {
          kakaoTitle: '카카오페이로 후원하기',
          kakaoSub: '모바일에서는 카카오톡 앱으로 바로 열려요',
          bankLabel: '계좌로 직접 후원 (PC에서 편해요)',
          holder: '예금주',
          copy: '계좌번호 복사',
          copied: '복사됨',
          note: '후원은 선택 사항이며, 콘텐츠 이용에 영향을 주지 않습니다.',
        };

    const kakao = s.kakaopayUrl
      ? `<a class="support-kakao" href="${escapeHtml(s.kakaopayUrl)}" target="_blank" rel="noopener noreferrer">
    <span class="support-kakao-title">${t.kakaoTitle}</span>
    <span class="support-kakao-sub">${t.kakaoSub}</span>
  </a>`
      : '';

    return `<section class="support-box">
  ${kakao}
  <div class="support-account">
    <p class="support-account-label">${t.bankLabel}</p>
    <p class="support-account-number" id="support-account">${escapeHtml(account)}</p>
    <p class="support-account-holder">${t.holder}: ${escapeHtml(s.accountHolder || '')}</p>
    <button type="button" class="support-copy" data-account="${escapeHtml(s.accountNumber || '')}" data-copied="${t.copied}">${t.copy}</button>
  </div>
  <p class="support-note">${t.note}</p>
</section>
<script>
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('.support-copy');
  if (!b) return;
  var value = b.getAttribute('data-account') || '';
  var done = function () {
    var original = b.textContent;
    b.textContent = b.getAttribute('data-copied');
    b.classList.add('is-copied');
    setTimeout(function () { b.textContent = original; b.classList.remove('is-copied'); }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(done).catch(fallback);
  } else { fallback(); }
  function fallback() {
    // 구형 브라우저·비보안 컨텍스트 대비
    var ta = document.createElement('textarea');
    ta.value = value; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (_) { /* 무시 */ }
    document.body.removeChild(ta);
  }
}, false);
</script>`;
  };
}

/** 이벤트 카드 빌더 (::event key) */
export function makeEventCard(config, events, today) {
  const byKey = new Map(events.map((e) => [e.key, e]));
  const code = config.locale.code;
  const t = T(config);
  return function eventCard(key) {
    const ev = byKey.get(key);
    if (!ev) return '';
    const st = eventStatus(ev, today);
    const name = (code === 'en' && ev.nameEn) || ev.name;
    return `<aside class="event-card phase-${st.phase}">
  <div class="event-dday">${st.label}</div>
  <div class="event-info">
    <div class="event-name">${escapeHtml(name)}${ev.tentative ? ` <span class="badge-tentative">${t.tentative}</span>` : ''}</div>
    <div class="event-date">${formatRange(ev.start, ev.end, code)}</div>
  </div>
  <a class="event-more" href="${u(config, '/calendar/')}">${t.calendarMore}</a>
</aside>`;
  };
}

// ---------- 공통 셸 ----------

export function pageShell(config, page) {
  const site = config.site;
  const loc = config.locale;
  const t = T(config);
  const fullTitle = page.fullTitle || (page.title ? `${page.title} | ${site.name}` : site.name);
  const canonical = site.url + u(config, page.path || '/');
  const ogImage = site.url + (page.image || '/assets/og-default.svg');
  const m = config.monetization;

  let head = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(page.description || site.description)}">`;
  if (page.keywords && page.keywords.length)
    head += `\n<meta name="keywords" content="${escapeHtml(page.keywords.join(', '))}">`;
  head += `\n<link rel="canonical" href="${canonical}">
<meta name="robots" content="${page.noindex ? 'noindex,follow' : 'index,follow'}">`;
  // hreflang: 양쪽 로케일에 모두 존재하는 페이지에만 (홈/카테고리 등 대응 경로가 있을 때)
  for (const alt of page.alternates || []) {
    head += `\n<link rel="alternate" hreflang="${alt.hreflang}" href="${alt.href}">`;
  }
  head += `\n<meta property="og:type" content="${page.ogType || 'website'}">
<meta property="og:title" content="${escapeHtml(page.title || site.name)}">
<meta property="og:description" content="${escapeHtml(page.description || site.description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImage}">
<meta property="og:site_name" content="${escapeHtml(site.name)}">
<meta property="og:locale" content="${loc.ogLocale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(page.title || site.name)}">
<meta name="twitter:description" content="${escapeHtml(page.description || site.description)}">
<meta name="twitter:image" content="${ogImage}">`;
  if (config.verification.google)
    head += `\n<meta name="google-site-verification" content="${config.verification.google}">`;
  if (config.verification.naver)
    head += `\n<meta name="naver-site-verification" content="${config.verification.naver}">`;
  head += `\n<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.name)} RSS" href="${site.url}${u(config, '/rss.xml')}">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/assets/style.css">`;
  // 심사 단계에서도 사이트에 코드가 있어야 하므로 게시자 ID만 있으면 로더를 넣는다.
  // (실제 광고 단위 <ins> 는 승인 후 enabled: true 일 때만 — makeAdSlot 참고)
  const adsClient = normalizeClientId(m.adsense.client);
  if (adsClient)
    head += `\n<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}" crossorigin="anonymous"></script>`;
  head += analyticsHead(config);
  for (const ld of page.jsonld || []) if (ld) head += '\n' + jsonLdScript(ld);

  let doc = `<!doctype html>
<html lang="${loc.lang}">
<head>
${head}
</head>
<body>
${analyticsBodyStart(config)}
${siteHeader(config, page.active, page.langSwitchHref)}
${page.content}
${siteFooter(config)}
${affiliateTracking(config)}
</body>
</html>
`;
  // 서브경로 배포 지원 (예: https://user.github.io/repo): site.url 의 경로를
  // 모든 루트 상대 href/src 앞에 붙인다. (// 로 시작하는 프로토콜 상대 URL 제외)
  let basePath = '';
  try {
    basePath = new URL(site.url).pathname.replace(/\/+$/, '');
  } catch {
    /* url 미설정 */
  }
  if (basePath) doc = doc.replace(/(href|src)="\/(?!\/)/g, `$1="${basePath}/`);
  return doc;
}

function siteHeader(config, active, langSwitchHref) {
  const t = T(config);
  const nav = config.categories
    .map(
      (c) =>
        `<a href="${u(config, `/category/${c.slug}/`)}"${active === c.slug ? ' class="active"' : ''}>${escapeHtml(c.name)}</a>`
    )
    .join('');
  const logo = config.site.logoHtml || escapeHtml(config.site.name);
  const switcher = langSwitchHref
    ? `<a class="lang-switch" href="${langSwitchHref}" aria-label="${t.langSwitchAria}" hreflang="${config.locale.code === 'ko' ? 'en' : 'ko'}">${t.langSwitch}</a>`
    : '';
  return `<header class="site-header">
  <div class="wrap header-inner">
    <a class="logo" href="${u(config, '/')}" aria-label="${escapeHtml(config.site.name)} ${t.home}">${logo}</a>
    <nav class="site-nav">${nav}<a href="${u(config, '/calendar/')}"${active === 'calendar' ? ' class="active"' : ''}>${t.calendar}</a></nav>
    ${switcher}
  </div>
</header>`;
}

function siteFooter(config) {
  const t = T(config);
  const y = new Date().getFullYear();
  const hasContact = config.locale.code === 'ko';
  // 후원 페이지는 국내 계좌 기반이라 한국어 섹션에만 노출한다
  const hasSupport = config.locale.code === 'ko' && config.support?.enabled;
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="footer-links">
      <a href="${u(config, '/about/')}">${t.about}</a>
      <a href="${u(config, '/privacy/')}">${t.privacy}</a>
      ${hasContact ? `<a href="${u(config, '/contact/')}">${t.contact}</a>` : ''}
      <a href="${u(config, '/copyright/')}">${t.copyright}</a>
      <a href="${u(config, '/calendar/')}">${t.calendar}</a>
      ${hasSupport ? `<a class="footer-support" href="${u(config, '/support/')}">${t.support}</a>` : ''}
      <a href="${u(config, '/rss.xml')}">RSS</a>
    </div>
    <p class="footer-note">${t.footerNote}</p>
    <p class="footer-copy">© ${y} ${escapeHtml(config.site.name)}. All rights reserved.</p>
  </div>
</footer>`;
}

// ---------- 부품 ----------

export function ddayStrip(config, events, today, limit = 6) {
  const code = config.locale.code;
  const t = T(config);
  const upcoming = events
    .map((e) => ({ e, st: eventStatus(e, today) }))
    .filter((x) => x.st.phase !== 'past')
    .filter((x) => code !== 'en' || x.e.nameEn) // 영문은 번역된 이벤트만
    .sort((a, b) => a.e.start.localeCompare(b.e.start))
    .slice(0, limit);
  if (!upcoming.length) return '';
  const chips = upcoming
    .map(
      ({ e, st }) => `<a class="dday-chip phase-${st.phase}" href="${u(config, '/calendar/')}">
      <span class="dday-label">${st.label}</span>
      <span class="dday-name">${escapeHtml((code === 'en' && e.nameEn) || e.name)}</span>
      <span class="dday-date">${formatDate(e.start, code, { year: false })}</span>
    </a>`
    )
    .join('');
  return `<div class="dday-strip" aria-label="${t.upcomingEvents}">${chips}</div>`;
}

export function postCard(config, post) {
  const code = config.locale.code;
  const t = T(config);
  return `<a class="card" href="${post.url}">
  <div class="card-cat cat-${post.categorySlug}">${escapeHtml(post.category)}</div>
  <h3 class="card-title">${escapeHtml(post.title)}</h3>
  <p class="card-desc">${escapeHtml(truncate(post.description, 80))}</p>
  <div class="card-meta"><time datetime="${post.date}">${formatDate(post.date, code)}</time><span>·</span><span>${post.readingMinutes}${t.readingSuffix}</span></div>
</a>`;
}

// ---------- 페이지 ----------

export function renderHome(config, { posts, events, today, websiteJsonLd, alternates, langSwitchHref }) {
  const site = config.site;
  const t = T(config);
  const cards = posts.slice(0, 12).map((post) => postCard(config, post)).join('\n');
  const content = `<main>
  <section class="hero">
    <div class="wrap">
      <p class="hero-badge">${t.heroBadge}</p>
      <h1>${escapeHtml(site.tagline)}</h1>
      <p class="hero-sub">${escapeHtml(site.description)}</p>
    </div>
  </section>
  <div class="wrap">
    ${ddayStrip(config, events, today)}
    <h2 class="section-title">${t.latest}</h2>
    <div class="card-grid">
${cards || `<p class="empty">${t.empty}</p>`}
    </div>
  </div>
</main>`;
  return pageShell(config, {
    fullTitle: `${site.name} - ${site.tagline}`,
    title: site.name,
    description: site.description,
    path: '/',
    content,
    jsonld: [websiteJsonLd],
    active: 'home',
    alternates,
    langSwitchHref,
  });
}

export function renderPost(config, { post, related, jsonld, langSwitchHref }) {
  const code = config.locale.code;
  const t = T(config);
  const moneyDisclaimer =
    post.categorySlug === 'money'
      ? `<div class="disclaimer-box">${t.moneyDisclaimer}</div>`
      : '';
  // 대가성 고지: 실제 사용된 제휴사의 문구를 우선하고, 없으면 일반 문구로 대체한다.
  const generalDisclosure =
    code === 'en'
      ? 'Disclosure: this article contains affiliate links. If you book or buy through them we may earn a commission, at no additional cost to you. This does not affect our recommendations.'
      : '이 글에는 제휴 링크가 포함되어 있으며, 링크를 통한 구매·예약 시 판매자로부터 일정액의 수수료를 받을 수 있습니다. 구매자에게 추가 비용은 발생하지 않으며, 수수료 여부가 글의 내용에 영향을 주지 않습니다.';
  const lines = post.disclosures && post.disclosures.length ? post.disclosures : [generalDisclosure];
  const affNotice = post.affiliate
    ? `<div class="aff-notice">${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}</div>`
    : '';
  const tags = (post.tags || [])
    .map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`)
    .join('');
  const relatedHtml = related.length
    ? `<section class="related"><h2 class="section-title">${t.related}</h2><div class="card-grid">${related
        .map((r) => postCard(config, r))
        .join('\n')}</div></section>`
    : '';
  const updatedNote =
    post.updated && post.updated !== post.date
      ? ` · <span class="updated-note">${t.updated} ${formatDate(post.updated, code)}</span>`
      : '';

  const content = `<main class="wrap post-layout">
  <article>
    <nav class="breadcrumb" aria-label="${t.breadcrumbAria}"><a href="${u(config, '/')}">${t.home}</a> › <a href="${u(config, `/category/${post.categorySlug}/`)}">${escapeHtml(post.category)}</a></nav>
    <h1 class="post-title">${escapeHtml(post.title)}</h1>
    <div class="post-meta">
      <span class="card-cat cat-${post.categorySlug}">${escapeHtml(post.category)}</span>
      <time datetime="${post.date}">${formatDate(post.date, code)}</time>${updatedNote}
      <span>·</span><span>${post.readingMinutes}${t.readingLong}</span>
    </div>
    ${affNotice}
    <div class="post-body">
${post.html}
    </div>
    ${moneyDisclaimer}
    <div class="tags">${tags}</div>
    ${post.bottomAd || ''}
    ${relatedHtml}
  </article>
</main>`;

  return pageShell(config, {
    title: post.title,
    description: post.description,
    keywords: post.keywords,
    path: post.path,
    ogType: 'article',
    image: post.image,
    content,
    jsonld,
    active: post.categorySlug,
    langSwitchHref,
  });
}

export function renderCategory(config, { category, posts, langSwitchHref }) {
  const t = T(config);
  const cards = posts.map((post) => postCard(config, post)).join('\n');
  const content = `<main class="wrap">
  <header class="cat-header">
    <h1>${escapeHtml(category.name)}</h1>
    <p>${escapeHtml(category.description)}</p>
  </header>
  <div class="card-grid">
${cards || `<p class="empty">${t.emptyCategory}</p>`}
  </div>
</main>`;
  return pageShell(config, {
    title: category.name,
    description: `${category.description} ${config.site.name}`,
    path: `/category/${category.slug}/`,
    content,
    active: category.slug,
    langSwitchHref,
  });
}

export function renderCalendar(config, { events, posts, today, langSwitchHref }) {
  const code = config.locale.code;
  const t = T(config);
  const visible = events.filter((ev) => code !== 'en' || ev.nameEn);
  const sorted = [...visible].sort((a, b) => a.start.localeCompare(b.start));
  const byMonth = new Map();
  for (const ev of sorted) {
    const monthKey = ev.start.slice(0, 7);
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byMonth.get(monthKey).push(ev);
  }
  let body = '';
  for (const [month, evs] of byMonth) {
    const [y, m] = month.split('-');
    const heading = code === 'en'
      ? formatDate(`${month}-01`, 'en').replace(/ \d+,/, '')
      : `${y}년 ${Number(m)}월`;
    body += `<section class="calendar-month"><h2>${heading}</h2>`;
    for (const ev of evs) {
      const st = eventStatus(ev, today);
      const relatedPosts = posts.filter((post) => post.event === ev.key);
      const links = relatedPosts.length
        ? `<div class="event-links">${relatedPosts
            .map((post) => `<a href="${post.url}">${escapeHtml(truncate(post.title, 40))}</a>`)
            .join('')}</div>`
        : '';
      const kws = (code === 'en' && ev.keywordsEn) || ev.keywords || [];
      const chips = kws.slice(0, 4).map((k) => `<span class="tag">${escapeHtml(k)}</span>`).join('');
      body += `<div class="event-row phase-${st.phase}">
  <div class="event-dday">${st.label}</div>
  <div class="event-info">
    <div class="event-name">${escapeHtml((code === 'en' && ev.nameEn) || ev.name)}${ev.tentative ? ` <span class="badge-tentative">${t.tentative}</span>` : ''}</div>
    <div class="event-date">${formatRange(ev.start, ev.end, code)}</div>
    <div class="event-tags">${chips}</div>
    ${links}
  </div>
</div>`;
    }
    body += '</section>';
  }
  const content = `<main class="wrap">
  <header class="cat-header">
    <h1>${t.calendarHeading}</h1>
    <p>${t.calendarSub}</p>
  </header>
${body}
</main>`;
  return pageShell(config, {
    title: t.calendarTitle,
    description: t.calendarSub,
    path: '/calendar/',
    content,
    active: 'calendar',
    langSwitchHref,
  });
}

export function renderSimplePage(config, { page, langSwitchHref }) {
  const content = `<main class="wrap post-layout">
  <article>
    <h1 class="post-title">${escapeHtml(page.title)}</h1>
    <div class="post-body">
${page.html}
    </div>
  </article>
</main>`;
  return pageShell(config, {
    title: page.title,
    description: page.description,
    path: page.pagePath,
    content,
    langSwitchHref,
  });
}

export function render404(config) {
  const t = T(config);
  const content = `<main class="wrap">
  <div class="not-found">
    <h1>404</h1>
    <p>${t.notFound}</p>
    <a class="btn" href="${u(config, '/')}">${t.goHome}</a>
  </div>
</main>`;
  return pageShell(config, {
    title: t.notFoundTitle,
    description: t.notFound,
    path: '/404.html',
    content,
    noindex: true,
  });
}
