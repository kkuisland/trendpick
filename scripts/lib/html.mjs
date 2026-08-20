// 페이지 템플릿: 모든 HTML 생성을 담당
import { escapeHtml, formatKoDate, formatKoRange, eventStatus, truncate } from './util.mjs';
import { jsonLdScript } from './seo.mjs';

// ---------- 수익화 블록 ----------

/** 광고 슬롯 빌더 (애드센스 → 애드핏 → 자리표시 주석 순) */
export function makeAdSlot(config) {
  const m = config.monetization;
  return function adSlot() {
    if (m.adsense.enabled && m.adsense.client) {
      const slot = m.adsense.slots.inArticle || '';
      return `<div class="ad-slot"><ins class="adsbygoogle" style="display:block; text-align:center;" data-ad-client="${m.adsense.client}"${slot ? ` data-ad-slot="${slot}"` : ''} data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>`;
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
  const disclosure =
    '<p class="cp-disclosure">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p>';
  return function coupangBox(attrs = {}) {
    if (!cp.enabled) return '<!-- 쿠팡 파트너스 슬롯 (비활성) -->';
    if (attrs.url) {
      const title = escapeHtml(attrs.title || '상품 보러 가기');
      return `<div class="cp-box"><a href="${attrs.url}" target="_blank" rel="sponsored noopener noreferrer"><span class="cp-badge">쿠팡 최저가 확인</span><span class="cp-title">${title}</span><span class="cp-arrow">→</span></a>${disclosure}</div>`;
    }
    if (cp.dynamicBannerId) {
      return `<div class="cp-box cp-dynamic"><script src="https://ads-partners.coupang.com/g.js"></script><script>new PartnersCoupang.G({"id":${Number(cp.dynamicBannerId)},"template":"carousel","trackingCode":"${cp.trackingCode || ''}","width":"680","height":"140"});</script>${disclosure}</div>`;
    }
    return '';
  };
}

/** 이벤트 카드 빌더 (::event key) */
export function makeEventCard(events, today) {
  const byKey = new Map(events.map((e) => [e.key, e]));
  return function eventCard(key) {
    const ev = byKey.get(key);
    if (!ev) return '';
    const st = eventStatus(ev, today);
    return `<aside class="event-card phase-${st.phase}">
  <div class="event-dday">${st.label}</div>
  <div class="event-info">
    <div class="event-name">${escapeHtml(ev.name)}${ev.tentative ? ' <span class="badge-tentative">일정 미확정</span>' : ''}</div>
    <div class="event-date">${formatKoRange(ev.start, ev.end)}</div>
  </div>
  <a class="event-more" href="/calendar/">캘린더 →</a>
</aside>`;
  };
}

// ---------- 공통 셸 ----------

export function pageShell(config, page) {
  const site = config.site;
  const fullTitle = page.fullTitle || (page.title ? `${page.title} | ${site.name}` : site.name);
  const canonical = site.url + (page.path || '/');
  const ogImage = site.url + (page.image || '/assets/og-default.svg');
  const m = config.monetization;

  let head = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(page.description || site.description)}">`;
  if (page.keywords && page.keywords.length)
    head += `\n<meta name="keywords" content="${escapeHtml(page.keywords.join(', '))}">`;
  head += `\n<link rel="canonical" href="${canonical}">
<meta name="robots" content="${page.noindex ? 'noindex,follow' : 'index,follow'}">
<meta property="og:type" content="${page.ogType || 'website'}">
<meta property="og:title" content="${escapeHtml(page.title || site.name)}">
<meta property="og:description" content="${escapeHtml(page.description || site.description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImage}">
<meta property="og:site_name" content="${escapeHtml(site.name)}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(page.title || site.name)}">
<meta name="twitter:description" content="${escapeHtml(page.description || site.description)}">
<meta name="twitter:image" content="${ogImage}">`;
  if (config.verification.google)
    head += `\n<meta name="google-site-verification" content="${config.verification.google}">`;
  if (config.verification.naver)
    head += `\n<meta name="naver-site-verification" content="${config.verification.naver}">`;
  head += `\n<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.name)} RSS" href="${site.url}/rss.xml">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/assets/style.css">`;
  if (m.adsense.enabled && m.adsense.client)
    head += `\n<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${m.adsense.client}" crossorigin="anonymous"></script>`;
  if (config.analytics.ga4)
    head += `\n<script async src="https://www.googletagmanager.com/gtag/js?id=${config.analytics.ga4}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${config.analytics.ga4}');</script>`;
  for (const ld of page.jsonld || []) if (ld) head += '\n' + jsonLdScript(ld);

  let doc = `<!doctype html>
<html lang="ko">
<head>
${head}
</head>
<body>
${siteHeader(config, page.active)}
${page.content}
${siteFooter(config)}
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

function siteHeader(config, active) {
  const nav = config.categories
    .map(
      (c) =>
        `<a href="/category/${c.slug}/"${active === c.slug ? ' class="active"' : ''}>${escapeHtml(c.name)}</a>`
    )
    .join('');
  return `<header class="site-header">
  <div class="wrap header-inner">
    <a class="logo" href="/" aria-label="${escapeHtml(config.site.name)} 홈">트렌드<span>픽</span></a>
    <nav class="site-nav">${nav}<a href="/calendar/"${active === 'calendar' ? ' class="active"' : ''}>이벤트 캘린더</a></nav>
  </div>
</header>`;
}

function siteFooter(config) {
  const y = new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="footer-links">
      <a href="/about/">소개</a>
      <a href="/privacy/">개인정보처리방침</a>
      <a href="/contact/">문의</a>
      <a href="/calendar/">이벤트 캘린더</a>
      <a href="/rss.xml">RSS</a>
    </div>
    <p class="footer-note">본 사이트의 콘텐츠는 정보 제공을 목적으로 하며, 투자·법률·의료 등 전문적 판단의 근거로 사용될 수 없습니다. 일정과 제도는 변경될 수 있으니 반드시 공식 발표를 함께 확인해 주세요.</p>
    <p class="footer-copy">© ${y} ${escapeHtml(config.site.name)}. All rights reserved.</p>
  </div>
</footer>`;
}

// ---------- 부품 ----------

export function ddayStrip(events, today, limit = 6) {
  const upcoming = events
    .map((e) => ({ e, st: eventStatus(e, today) }))
    .filter((x) => x.st.phase !== 'past')
    .sort((a, b) => a.e.start.localeCompare(b.e.start))
    .slice(0, limit);
  if (!upcoming.length) return '';
  const chips = upcoming
    .map(
      ({ e, st }) => `<a class="dday-chip phase-${st.phase}" href="/calendar/">
      <span class="dday-label">${st.label}</span>
      <span class="dday-name">${escapeHtml(e.name)}</span>
      <span class="dday-date">${formatKoDate(e.start, { year: false })}</span>
    </a>`
    )
    .join('');
  return `<div class="dday-strip" aria-label="다가오는 이벤트">${chips}</div>`;
}

export function postCard(post) {
  return `<a class="card" href="${post.url}">
  <div class="card-cat cat-${post.categorySlug}">${escapeHtml(post.category)}</div>
  <h3 class="card-title">${escapeHtml(post.title)}</h3>
  <p class="card-desc">${escapeHtml(truncate(post.description, 80))}</p>
  <div class="card-meta"><time datetime="${post.date}">${formatKoDate(post.date)}</time><span>·</span><span>${post.readingMinutes}분</span></div>
</a>`;
}

// ---------- 페이지 ----------

export function renderHome(config, { posts, events, today, websiteJsonLd }) {
  const site = config.site;
  const cards = posts.slice(0, 12).map(postCard).join('\n');
  const content = `<main>
  <section class="hero">
    <div class="wrap">
      <p class="hero-badge">매일 업데이트되는 트렌드 브리핑</p>
      <h1>${escapeHtml(site.tagline)}</h1>
      <p class="hero-sub">${escapeHtml(site.description)}</p>
    </div>
  </section>
  <div class="wrap">
    ${ddayStrip(events, today)}
    <h2 class="section-title">최신 글</h2>
    <div class="card-grid">
${cards || '<p class="empty">아직 발행된 글이 없습니다.</p>'}
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
  });
}

export function renderPost(config, { post, related, jsonld }) {
  const site = config.site;
  const isMoney = post.categorySlug === 'money';
  const moneyDisclaimer = isMoney
    ? `<div class="disclaimer-box">이 글은 일반적인 정보 제공을 위한 것으로, 특정 상품의 매수·매도 추천이나 투자 자문이 아닙니다. 투자의 책임은 투자자 본인에게 있습니다.</div>`
    : '';
  const tags = (post.tags || [])
    .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
    .join('');
  const relatedHtml = related.length
    ? `<section class="related"><h2 class="section-title">함께 보면 좋은 글</h2><div class="card-grid">${related
        .map(postCard)
        .join('\n')}</div></section>`
    : '';
  const updatedNote =
    post.updated && post.updated !== post.date
      ? ` · <span class="updated-note">업데이트 ${formatKoDate(post.updated)}</span>`
      : '';

  const content = `<main class="wrap post-layout">
  <article>
    <nav class="breadcrumb" aria-label="현재 위치"><a href="/">홈</a> › <a href="/category/${post.categorySlug}/">${escapeHtml(post.category)}</a></nav>
    <h1 class="post-title">${escapeHtml(post.title)}</h1>
    <div class="post-meta">
      <span class="card-cat cat-${post.categorySlug}">${escapeHtml(post.category)}</span>
      <time datetime="${post.date}">${formatKoDate(post.date)}</time>${updatedNote}
      <span>·</span><span>${post.readingMinutes}분 읽기</span>
    </div>
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
    path: post.url,
    ogType: 'article',
    image: post.image,
    content,
    jsonld,
    active: post.categorySlug,
  });
}

export function renderCategory(config, { category, posts }) {
  const cards = posts.map(postCard).join('\n');
  const content = `<main class="wrap">
  <header class="cat-header">
    <h1>${escapeHtml(category.name)}</h1>
    <p>${escapeHtml(category.description)}</p>
  </header>
  <div class="card-grid">
${cards || '<p class="empty">아직 이 카테고리에 글이 없습니다.</p>'}
  </div>
</main>`;
  return pageShell(config, {
    title: category.name,
    description: `${category.description} ${config.site.name}의 ${category.name} 최신 글 모음.`,
    path: `/category/${category.slug}/`,
    content,
    active: category.slug,
  });
}

export function renderCalendar(config, { events, posts, today }) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const byMonth = new Map();
  for (const ev of sorted) {
    const monthKey = ev.start.slice(0, 7);
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byMonth.get(monthKey).push(ev);
  }
  let body = '';
  for (const [month, evs] of byMonth) {
    const [y, m] = month.split('-');
    body += `<section class="calendar-month"><h2>${y}년 ${Number(m)}월</h2>`;
    for (const ev of evs) {
      const st = eventStatus(ev, today);
      const relatedPosts = posts.filter(
        (post) => post.event === ev.key || (post.tags || []).some((t) => ev.keywords.some((k) => k.includes(t) || t.includes(k)))
      );
      const links = relatedPosts.length
        ? `<div class="event-links">${relatedPosts
            .map((post) => `<a href="${post.url}">${escapeHtml(truncate(post.title, 40))}</a>`)
            .join('')}</div>`
        : '';
      const chips = ev.keywords
        .slice(0, 4)
        .map((k) => `<span class="tag">${escapeHtml(k)}</span>`)
        .join('');
      body += `<div class="event-row phase-${st.phase}">
  <div class="event-dday">${st.label}</div>
  <div class="event-info">
    <div class="event-name">${escapeHtml(ev.name)}${ev.tentative ? ' <span class="badge-tentative">일정 미확정</span>' : ''}</div>
    <div class="event-date">${formatKoRange(ev.start, ev.end)}</div>
    <div class="event-tags">${chips}</div>
    ${links}
  </div>
</div>`;
    }
    body += '</section>';
  }
  const content = `<main class="wrap">
  <header class="cat-header">
    <h1>이벤트 캘린더</h1>
    <p>다가오는 빅 이벤트를 미리 확인하고 준비하세요. 매일 D-Day가 자동으로 갱신됩니다.</p>
  </header>
${body}
</main>`;
  return pageShell(config, {
    title: '이벤트 캘린더 - 다가오는 빅 이벤트 총정리',
    description: `연휴, 스포츠 빅매치, 신제품 발표, 시즌 제도까지. ${config.site.name}이 정리한 다가오는 이벤트 일정과 D-Day.`,
    path: '/calendar/',
    content,
    active: 'calendar',
  });
}

export function renderSimplePage(config, { page }) {
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
    path: page.url,
    content,
  });
}

export function render404(config) {
  const content = `<main class="wrap">
  <div class="not-found">
    <h1>404</h1>
    <p>페이지를 찾을 수 없습니다. 주소가 바뀌었거나 삭제된 페이지예요.</p>
    <a class="btn" href="/">홈으로 가기</a>
  </div>
</main>`;
  return pageShell(config, {
    title: '페이지를 찾을 수 없습니다',
    description: '요청하신 페이지를 찾을 수 없습니다.',
    path: '/404.html',
    content,
    noindex: true,
  });
}
