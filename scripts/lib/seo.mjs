// JSON-LD 구조화 데이터 빌더
// 참고: Event JSON-LD는 location 등 필수 필드가 까다로워 Search Console 경고를
// 유발하기 쉬우므로 의도적으로 넣지 않는다 (시각적 카드로만 표시).

export function jsonLdScript(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

export function websiteLd(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    url: site.url + '/',
    description: site.description,
    inLanguage: 'ko',
  };
}

export function articleLd({ site, post, url, image }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated || post.date,
    inLanguage: 'ko',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    image: image ? [image] : undefined,
    author: { '@type': 'Organization', name: site.author, url: site.url + '/' },
    publisher: { '@type': 'Organization', name: site.name, url: site.url + '/' },
  };
}

export function faqLd(faqs) {
  if (!faqs || !faqs.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.aText },
    })),
  };
}

export function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: it.name,
      item: it.url,
    })),
  };
}
