// 정적 사이트 빌드: content/ + data/ → dist/  (ko 루트 + en /en/)
// 사용: node scripts/build.mjs [--drafts]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  p, readConfig, readJson, readText, writeText, listFiles, parseFrontMatter,
  todayKST, copyDir, stripTags, truncate, escapeXml,
} from './lib/util.mjs';
import { renderMarkdown } from './lib/md.mjs';
import { websiteLd, articleLd, faqLd, breadcrumbLd } from './lib/seo.mjs';
import { localizedConfig, localeCodes } from './lib/i18n.mjs';
import { normalizePubId } from './lib/adsense.mjs';
import { makeAffBox, disclosureFor } from './lib/affiliates.mjs';
import { normalizeGtmId, normalizeGa4Id } from './lib/analytics.mjs';
import {
  makeAdSlot, makeCoupangBox, makeEventCard,
  renderHome, renderPost, renderCategory, renderCalendar, renderSimplePage, render404,
} from './lib/html.mjs';

export function buildSite({ includeDrafts = false } = {}) {
  const baseConfig = readConfig();
  const events = readJson(p('data', 'events.json'), []);
  const affiliates = readJson(p('data', 'affiliates.json'), { partners: {}, links: {} });
  const today = todayKST();
  const DIST = p('dist');
  const warnings = [];

  fs.rmSync(DIST, { recursive: true, force: true });

  let siteHost = '';
  try { siteHost = new URL(baseConfig.site.url).host; } catch { /* url 미설정 */ }

  const codes = localeCodes(baseConfig);
  const built = {}; // code -> { config, posts, pages }

  // ---------- 1단계: 로케일별 콘텐츠 로드 ----------
  for (const code of codes) {
    const config = localizedConfig(baseConfig, code);
    const prefix = config.locale.prefix;
    const adSlot = makeAdSlot(config);
    const shortcodes = {
      ad: adSlot,
      coupang: makeCoupangBox(config),
      event: makeEventCard(config, events, today),
    };
    const catByName = new Map(config.categories.map((c) => [c.name, c]));
    const catBySlug = new Map(config.categories.map((c) => [c.slug, c]));

    const posts = [];
    let draftCount = 0;
    for (const file of listFiles(p(...config.locale.contentDir))) {
      const slug = path.basename(file, '.md');
      const { meta, body } = parseFrontMatter(readText(file));
      if (meta.draft === true && !includeDrafts) {
        draftCount++;
        continue;
      }
      const cat = catByName.get(meta.category) || catBySlug.get(meta.category) || config.categories[0];
      if (meta.category && !catByName.has(meta.category) && !catBySlug.has(meta.category))
        warnings.push(`[${code}] ${slug}: 알 수 없는 카테고리 "${meta.category}" → "${cat.name}" 처리`);
      // 제휴 숏코드는 글 단위로 만든다 — subid 에 글 슬러그를 넣어 어느 글이
      // 수익을 냈는지 제휴 대시보드에서 바로 확인할 수 있게 하기 위함.
      const affUsage = { partners: new Set() };
      const postShortcodes = {
        ...shortcodes,
        aff: makeAffBox(config, affiliates, { slug }, affUsage),
      };
      const { html, faqs } = renderMarkdown(body, { siteHost, shortcodes: postShortcodes });
      const plain = stripTags(html);
      const postPath = `/posts/${slug}/`;
      const post = {
        slug,
        locale: code,
        path: postPath,
        url: prefix + postPath,
        title: meta.title || slug,
        description: meta.description || truncate(plain, 110),
        date: meta.date || today,
        updated: meta.updated || meta.date || today,
        category: cat.name,
        categorySlug: cat.slug,
        tags: meta.tags || [],
        keywords: meta.keywords || meta.tags || [],
        image: meta.image || '',
        event: meta.event || '',
        trKey: meta.trKey || '',
        // 고지 노출은 "실제로 제휴 링크가 렌더링됐는가"로 판단한다 (법적 의무를 기억에 의존시키지 않음).
        // 프런트매터 affiliate: true 는 쿠팡 다이내믹 배너처럼 {{aff}} 를 거치지 않는 경우의 수동 지정용.
        affiliate: meta.affiliate === true || affUsage.partners.size > 0,
        disclosures: disclosureFor(affiliates, affUsage.partners, code),
        html,
        faqs,
        readingMinutes: Math.max(1, Math.round(plain.length / (code === 'en' ? 1100 : 600))),
        bottomAd: adSlot(),
      };
      // SEO 린트
      if (!meta.title) warnings.push(`[${code}] ${slug}: title 없음`);
      if (!meta.description) warnings.push(`[${code}] ${slug}: description 없음 — 본문 앞부분으로 자동 생성`);
      if (!faqs.length) warnings.push(`[${code}] ${slug}: FAQ 블록 없음 — FAQ 리치결과 기회 활용 권장`);
      posts.push(post);
    }
    posts.sort((a, b) => (b.date + b.slug).localeCompare(a.date + a.slug));

    const pages = [];
    for (const file of listFiles(p(...config.locale.pagesDir))) {
      const slug = path.basename(file, '.md');
      const { meta, body } = parseFrontMatter(readText(file));
      const { html } = renderMarkdown(body, { siteHost, shortcodes });
      const pagePath = `/${slug}/`;
      pages.push({
        slug,
        pagePath,
        url: prefix + pagePath,
        title: meta.title || slug,
        description: meta.description || truncate(stripTags(html), 110),
        html,
      });
    }

    built[code] = { config, posts, pages, draftCount };
  }

  // ---------- 2단계: 렌더링 ----------
  const relScore = (a, b) => {
    let s = 0;
    if (a.categorySlug === b.categorySlug) s += 2;
    if (a.event && a.event === b.event) s += 3;
    s += a.tags.filter((t) => b.tags.includes(t)).length;
    return s;
  };
  const otherCode = (code) => codes.find((c) => c !== code) || null;

  for (const code of codes) {
    const { config, posts, pages } = built[code];
    const prefix = config.locale.prefix;
    const outDir = prefix ? path.join(DIST, prefix.slice(1)) : DIST;
    const other = otherCode(code);
    const otherPrefix = other ? built[other].config.locale.prefix : '';
    const otherHome = other ? (otherPrefix || '/') + (otherPrefix ? '/' : '') : '';

    // 포스트
    for (const post of posts) {
      const url = config.site.url + post.url;
      const related = posts
        .filter((x) => x !== post)
        .map((x) => ({ x, score: relScore(post, x) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((r) => r.x);
      // 번역본이 있으면 그 글로, 없으면 상대 로케일 홈으로
      const twin = post.trKey && other
        ? built[other].posts.find((x) => x.trKey === post.trKey)
        : null;
      const jsonld = [
        articleLd({
          site: config.site,
          post,
          url,
          image: config.site.url + (post.image || '/assets/og-default.svg'),
        }),
        faqLd(post.faqs),
        breadcrumbLd([
          { name: config.locale.t.home, url: config.site.url + (prefix || '') + '/' },
          { name: post.category, url: `${config.site.url}${prefix}/category/${post.categorySlug}/` },
          { name: post.title, url },
        ]),
      ];
      writeText(
        path.join(outDir, 'posts', post.slug, 'index.html'),
        renderPost(config, {
          post,
          related,
          jsonld,
          langSwitchHref: twin ? twin.url : otherHome,
        })
      );
    }

    // 홈 (hreflang 상호 연결)
    const alternates = other
      ? [
          { hreflang: code, href: config.site.url + (prefix || '') + '/' },
          { hreflang: other, href: config.site.url + (otherPrefix || '') + '/' },
          { hreflang: 'x-default', href: config.site.url + '/' },
        ]
      : [];
    writeText(
      path.join(outDir, 'index.html'),
      renderHome(config, {
        posts,
        events,
        today,
        websiteJsonLd: websiteLd(config.site),
        alternates,
        langSwitchHref: otherHome,
      })
    );

    // 카테고리
    for (const cat of config.categories) {
      const catPosts = posts.filter((x) => x.categorySlug === cat.slug);
      writeText(
        path.join(outDir, 'category', cat.slug, 'index.html'),
        renderCategory(config, { category: cat, posts: catPosts, langSwitchHref: otherHome })
      );
    }

    // 캘린더
    writeText(
      path.join(outDir, 'calendar', 'index.html'),
      renderCalendar(config, { events, posts, today, langSwitchHref: otherHome })
    );

    // 고정 페이지
    for (const page of pages) {
      writeText(
        path.join(outDir, page.slug, 'index.html'),
        renderSimplePage(config, { page, langSwitchHref: otherHome })
      );
    }

    // RSS (로케일별)
    const rssItems = posts
      .slice(0, 20)
      .map((post) => {
        const link = config.site.url + post.url;
        return `<item>
<title>${escapeXml(post.title)}</title>
<link>${escapeXml(link)}</link>
<guid isPermaLink="true">${escapeXml(link)}</guid>
<pubDate>${new Date(post.date + 'T00:00:00+09:00').toUTCString()}</pubDate>
<description><![CDATA[${post.description}]]></description>
<category>${escapeXml(post.category)}</category>
</item>`;
      })
      .join('\n');
    writeText(
      path.join(outDir, 'rss.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${escapeXml(config.site.name)}</title>
<link>${escapeXml(config.site.url + (prefix || '') + '/')}</link>
<description>${escapeXml(config.site.description)}</description>
<language>${code}</language>
${rssItems}
</channel>
</rss>
`
    );
  }

  // ---------- 3단계: 사이트 공통 파일 ----------
  const rootConfig = built.ko.config;
  writeText(path.join(DIST, '404.html'), render404(rootConfig));

  // sitemap.xml (모든 로케일)
  const urlEntries = [];
  const addUrl = (loc, { lastmod, changefreq, priority } = {}) => {
    urlEntries.push(
      `<url><loc>${escapeXml(rootConfig.site.url + loc)}</loc>` +
        (lastmod ? `<lastmod>${lastmod}</lastmod>` : '') +
        (changefreq ? `<changefreq>${changefreq}</changefreq>` : '') +
        (priority ? `<priority>${priority}</priority>` : '') +
        '</url>'
    );
  };
  for (const code of codes) {
    const { config, posts, pages } = built[code];
    const prefix = config.locale.prefix;
    addUrl((prefix || '') + '/', { lastmod: today, changefreq: 'daily', priority: code === 'ko' ? '1.0' : '0.9' });
    addUrl(prefix + '/calendar/', { lastmod: today, changefreq: 'daily', priority: '0.8' });
    for (const post of posts) addUrl(post.url, { lastmod: post.updated, changefreq: 'weekly', priority: '0.8' });
    for (const cat of config.categories) addUrl(`${prefix}/category/${cat.slug}/`, { changefreq: 'weekly', priority: '0.5' });
    for (const page of pages) addUrl(page.url, { changefreq: 'monthly', priority: '0.3' });
  }
  writeText(
    path.join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries.join('\n')}\n</urlset>\n`
  );

  writeText(
    path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${rootConfig.site.url}/sitemap.xml\n`
  );
  // ads.txt 는 "승인 여부"가 아니라 "게시자 ID를 아는가"에 달려 있다.
  // 애드센스는 심사 단계에서도 ads.txt 를 확인하므로 client 만 있으면 항상 생성한다.
  const ads = rootConfig.monetization.adsense;
  const pubId = normalizePubId(ads.client);
  if (pubId) {
    writeText(path.join(DIST, 'ads.txt'), `google.com, ${pubId}, DIRECT, f08c47fec0942fa0\n`);
  } else {
    warnings.push(
      'ads.txt 미생성 — monetization.adsense.client 에 게시자 ID(ca-pub-…)를 넣어주세요. ' +
        '애드센스가 "ads.txt 파일을 찾을 수 없음"으로 표시합니다.'
    );
  }

  // 분석 도구 ID 형식 점검 (형식이 틀리면 스니펫이 조용히 빠진다)
  const an = rootConfig.analytics || {};
  if (an.gtm && !normalizeGtmId(an.gtm))
    warnings.push(`analytics.gtm 형식 오류 ("${an.gtm}") — GTM-XXXXXXX 형식이어야 합니다.`);
  if (an.ga4 && !normalizeGa4Id(an.ga4))
    warnings.push(`analytics.ga4 형식 오류 ("${an.ga4}") — G-XXXXXXXXXX 형식이어야 합니다. GTM-… 는 analytics.gtm 에 넣으세요.`);
  if (!normalizeGtmId(an.gtm) && !normalizeGa4Id(an.ga4))
    warnings.push('분석 도구 미설정 — 제휴 클릭 추적이 기록되지 않습니다.');
  else if (normalizeGtmId(an.gtm) && normalizeGa4Id(an.ga4))
    warnings.push('GTM 과 GA4 가 모두 설정됨 — 중복 집계를 막기 위해 GTM 만 사용합니다 (GA4 직접 삽입 생략).');
  if (rootConfig.apis.indexnow.key) {
    writeText(path.join(DIST, `${rootConfig.apis.indexnow.key}.txt`), rootConfig.apis.indexnow.key);
  }
  // GitHub Pages 호스팅일 때만 CNAME 생성 (Railway 등 다른 호스팅에서는 불필요하며,
  // Pages 가 소유하지 않은 도메인을 CNAME 으로 주장하면 도메인 검증이 실패한다)
  if (rootConfig.hosting === 'github-pages') {
    try {
      const host = new URL(rootConfig.site.url).host;
      if (host && !host.endsWith('.github.io')) writeText(path.join(DIST, 'CNAME'), host + '\n');
    } catch {
      /* url 미설정 */
    }
  }

  copyDir(p('public'), DIST);

  // ---------- 리포트 ----------
  const allPosts = codes.flatMap((c) => built[c].posts);
  console.log(`\n✅ 빌드 완료 (${today} KST 기준)`);
  for (const code of codes) {
    const b = built[code];
    console.log(
      `   [${code}] 글 ${b.posts.length}개${b.draftCount ? ` (초안 ${b.draftCount}개 제외)` : ''} · 페이지 ${b.pages.length}개 · 카테고리 ${b.config.categories.length}개`
    );
  }
  if (rootConfig.site.url.includes('example.com'))
    console.log('   ⚠️  config/site.config.json 의 site.url 이 아직 example.com 입니다.');
  if (warnings.length) {
    console.log(`\n⚠️  SEO 점검 (${warnings.length}건)`);
    for (const w of warnings) console.log('   - ' + w);
  }
  return { posts: allPosts, built, config: rootConfig };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  buildSite({ includeDrafts: process.argv.includes('--drafts') });
}
