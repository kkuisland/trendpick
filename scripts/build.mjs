// 정적 사이트 빌드: content/ + data/ → dist/
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
import {
  makeAdSlot, makeCoupangBox, makeEventCard,
  renderHome, renderPost, renderCategory, renderCalendar, renderSimplePage, render404,
} from './lib/html.mjs';

export function buildSite({ includeDrafts = false } = {}) {
  const config = readConfig();
  const events = readJson(p('data', 'events.json'), []);
  const today = todayKST();
  const DIST = p('dist');
  const warnings = [];

  fs.rmSync(DIST, { recursive: true, force: true });

  let siteHost = '';
  try { siteHost = new URL(config.site.url).host; } catch { /* url 미설정 */ }

  const adSlot = makeAdSlot(config);
  const coupang = makeCoupangBox(config);
  const eventCard = makeEventCard(events, today);
  const shortcodes = { ad: adSlot, coupang, event: eventCard };
  const catByName = new Map(config.categories.map((c) => [c.name, c]));

  // ---------- 포스트 로드 ----------
  const posts = [];
  let draftCount = 0;
  for (const file of listFiles(p('content', 'posts'))) {
    const slug = path.basename(file, '.md');
    const { meta, body } = parseFrontMatter(readText(file));
    if (meta.draft === true && !includeDrafts) {
      draftCount++;
      continue;
    }
    const cat = catByName.get(meta.category) || config.categories[0];
    if (meta.category && !catByName.has(meta.category))
      warnings.push(`${slug}: 알 수 없는 카테고리 "${meta.category}" → "${cat.name}" 처리`);
    const { html, faqs } = renderMarkdown(body, { siteHost, shortcodes });
    const plain = stripTags(html);
    const post = {
      slug,
      url: `/posts/${slug}/`,
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
      html,
      faqs,
      readingMinutes: Math.max(1, Math.round(plain.length / 600)),
      bottomAd: adSlot(),
    };
    // SEO 린트
    if (!meta.title) warnings.push(`${slug}: title 없음`);
    if (post.title.length > 40) warnings.push(`${slug}: 제목 ${post.title.length}자 — 32자 내외 권장`);
    if (!meta.description) warnings.push(`${slug}: description 없음 — 본문 앞부분으로 자동 생성`);
    else if (meta.description.length < 40 || meta.description.length > 130)
      warnings.push(`${slug}: description ${meta.description.length}자 — 70~110자 권장`);
    if (!faqs.length) warnings.push(`${slug}: FAQ 블록 없음 — FAQ 리치결과 기회 활용 권장`);
    posts.push(post);
  }
  posts.sort((a, b) => (b.date + b.slug).localeCompare(a.date + a.slug));

  // ---------- 포스트 페이지 ----------
  const relScore = (a, b) => {
    let s = 0;
    if (a.categorySlug === b.categorySlug) s += 2;
    if (a.event && a.event === b.event) s += 3;
    s += a.tags.filter((t) => b.tags.includes(t)).length;
    return s;
  };
  for (const post of posts) {
    const url = config.site.url + post.url;
    const related = posts
      .filter((x) => x !== post)
      .map((x) => ({ x, score: relScore(post, x) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r) => r.x);
    const jsonld = [
      articleLd({
        site: config.site,
        post,
        url,
        image: config.site.url + (post.image || '/assets/og-default.svg'),
      }),
      faqLd(post.faqs),
      breadcrumbLd([
        { name: '홈', url: config.site.url + '/' },
        { name: post.category, url: `${config.site.url}/category/${post.categorySlug}/` },
        { name: post.title, url },
      ]),
    ];
    writeText(path.join(DIST, 'posts', post.slug, 'index.html'), renderPost(config, { post, related, jsonld }));
  }

  // ---------- 홈 / 카테고리 / 캘린더 ----------
  writeText(
    path.join(DIST, 'index.html'),
    renderHome(config, { posts, events, today, websiteJsonLd: websiteLd(config.site) })
  );
  for (const cat of config.categories) {
    const catPosts = posts.filter((x) => x.categorySlug === cat.slug);
    writeText(path.join(DIST, 'category', cat.slug, 'index.html'), renderCategory(config, { category: cat, posts: catPosts }));
  }
  writeText(path.join(DIST, 'calendar', 'index.html'), renderCalendar(config, { events, posts, today }));

  // ---------- 고정 페이지 ----------
  const pages = [];
  for (const file of listFiles(p('content', 'pages'))) {
    const slug = path.basename(file, '.md');
    const { meta, body } = parseFrontMatter(readText(file));
    const { html } = renderMarkdown(body, { siteHost, shortcodes });
    const page = {
      slug,
      url: `/${slug}/`,
      title: meta.title || slug,
      description: meta.description || truncate(stripTags(html), 110),
      html,
    };
    pages.push(page);
    writeText(path.join(DIST, slug, 'index.html'), renderSimplePage(config, { page }));
  }

  writeText(path.join(DIST, '404.html'), render404(config));

  // ---------- sitemap.xml ----------
  const urlEntries = [];
  const addUrl = (loc, { lastmod, changefreq, priority } = {}) => {
    urlEntries.push(
      `<url><loc>${escapeXml(config.site.url + loc)}</loc>` +
        (lastmod ? `<lastmod>${lastmod}</lastmod>` : '') +
        (changefreq ? `<changefreq>${changefreq}</changefreq>` : '') +
        (priority ? `<priority>${priority}</priority>` : '') +
        '</url>'
    );
  };
  addUrl('/', { lastmod: today, changefreq: 'daily', priority: '1.0' });
  addUrl('/calendar/', { lastmod: today, changefreq: 'daily', priority: '0.9' });
  for (const post of posts) addUrl(post.url, { lastmod: post.updated, changefreq: 'weekly', priority: '0.8' });
  for (const cat of config.categories) addUrl(`/category/${cat.slug}/`, { changefreq: 'weekly', priority: '0.5' });
  for (const page of pages) addUrl(page.url, { changefreq: 'monthly', priority: '0.3' });
  writeText(
    path.join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries.join('\n')}\n</urlset>\n`
  );

  // ---------- rss.xml ----------
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
    path.join(DIST, 'rss.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${escapeXml(config.site.name)}</title>
<link>${escapeXml(config.site.url + '/')}</link>
<description>${escapeXml(config.site.description)}</description>
<language>ko</language>
${rssItems}
</channel>
</rss>
`
  );

  // ---------- robots.txt / ads.txt / IndexNow 키 파일 ----------
  writeText(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${config.site.url}/sitemap.xml\n`);
  const ads = config.monetization.adsense;
  if (ads.enabled && ads.client) {
    const pub = ads.client.replace(/^ca-/, '');
    writeText(path.join(DIST, 'ads.txt'), `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
  }
  if (config.apis.indexnow.key) {
    writeText(path.join(DIST, `${config.apis.indexnow.key}.txt`), config.apis.indexnow.key);
  }

  // ---------- 정적 파일 복사 ----------
  copyDir(p('public'), DIST);

  // ---------- 리포트 ----------
  console.log(`\n✅ 빌드 완료 (${today} KST 기준)`);
  console.log(`   발행 글 ${posts.length}개${draftCount ? ` (초안 ${draftCount}개 제외)` : ''} · 고정 페이지 ${pages.length}개 · 카테고리 ${config.categories.length}개`);
  if (config.site.url.includes('example.com'))
    console.log('   ⚠️  config/site.config.json 의 site.url 이 아직 example.com 입니다. 실제 도메인으로 바꿔주세요.');
  if (warnings.length) {
    console.log(`\n⚠️  SEO 점검 (${warnings.length}건)`);
    for (const w of warnings) console.log('   - ' + w);
  }
  return { posts, pages, config };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  buildSite({ includeDrafts: process.argv.includes('--drafts') });
}
