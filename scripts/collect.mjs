// 트렌드·뉴스 수집기
// 소스: 구글 트렌드 RSS(실시간 인기 검색어), 구글 뉴스 섹션별 RSS,
//       (선택) 네이버 뉴스 검색 API — config 또는 환경변수에 키 설정 시
// 사용: node scripts/collect.mjs
import { pathToFileURL } from 'node:url';
import {
  p, readConfig, writeJson, todayKST, nowKST, fetchText, decodeEntities, stripTags,
} from './lib/util.mjs';

const FEEDS = [
  { name: '구글 트렌드', url: 'https://trends.google.co.kr/trending/rss?geo=KR', type: 'gtrends' },
  { name: '주요 뉴스', url: 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko', type: 'news' },
  { name: '경제', url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ko&gl=KR&ceid=KR:ko', type: 'news' },
  { name: '스포츠', url: 'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=ko&gl=KR&ceid=KR:ko', type: 'news' },
  { name: 'IT·과학', url: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=ko&gl=KR&ceid=KR:ko', type: 'news' },
  { name: '연예', url: 'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=ko&gl=KR&ceid=KR:ko', type: 'news' },
];

function pickTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return '';
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1];
  return decodeEntities(stripTags(v)).trim();
}

function pickAllTags(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    let v = m[1].trim();
    const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
    if (cdata) v = cdata[1];
    out.push(decodeEntities(stripTags(v)).trim());
  }
  return out;
}

function parseItems(xml) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/g)].map((m) => m[0]);
}

async function fetchNaverNews(config, query) {
  const { clientId, clientSecret } = config.apis.naver;
  if (!clientId || !clientSecret) return null;
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=5&sort=sim`;
  const body = await fetchText(url, {
    headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
  });
  const json = JSON.parse(body);
  return (json.items || []).map((it) => decodeEntities(stripTags(it.title)));
}

export async function collect() {
  const config = readConfig();
  const date = todayKST();
  const result = {
    date,
    collectedAt: nowKST().toISOString().replace('Z', '+09:00'),
    trends: [],
    headlines: {},
    sources: [],
  };

  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const items = parseItems(xml);
      if (feed.type === 'gtrends') {
        for (const item of items) {
          const keyword = pickTag(item, 'title');
          const traffic = pickTag(item, 'ht:approx_traffic');
          const news = pickAllTags(item, 'ht:news_item_title').slice(0, 3);
          if (!keyword) continue;
          // 한국 피드에 섞여 오는 외국어 노이즈 제거: 키워드나 관련 뉴스에 한글이 있어야 채택
          if (!/[가-힣]/.test(keyword + news.join(''))) continue;
          result.trends.push({
            keyword,
            traffic,
            trafficNum: parseInt(traffic.replace(/[^0-9]/g, ''), 10) || 0,
            news,
          });
        }
        result.trends.sort((a, b) => b.trafficNum - a.trafficNum);
      } else {
        result.headlines[feed.name] = items.slice(0, 10).map((item) => ({
          title: pickTag(item, 'title'),
          source: pickTag(item, 'source'),
          pubDate: pickTag(item, 'pubDate'),
          link: pickTag(item, 'link'),
        }));
      }
      result.sources.push({ name: feed.name, ok: true, count: items.length });
    } catch (err) {
      result.sources.push({ name: feed.name, ok: false, error: String(err.message || err) });
    }
  }

  // (선택) 네이버 뉴스 API로 상위 트렌드 보강
  if (config.apis.naver.clientId && config.apis.naver.clientSecret) {
    for (const t of result.trends.slice(0, 5)) {
      try {
        t.naverNews = await fetchNaverNews(config, t.keyword);
      } catch {
        /* 개별 실패 무시 */
      }
    }
  }

  writeJson(p('data', 'trends', `${date}.json`), result);
  writeJson(p('data', 'trends', 'latest.json'), result);

  // 콘솔 리포트
  console.log(`\n📡 수집 완료 — ${date} (KST)`);
  for (const s of result.sources) {
    console.log(s.ok ? `   ✅ ${s.name}: ${s.count}건` : `   ❌ ${s.name}: ${s.error}`);
  }
  if (result.trends.length) {
    console.log('\n🔥 실시간 인기 검색어 TOP 10');
    for (const t of result.trends.slice(0, 10)) {
      console.log(`   ${String(t.traffic).padStart(8)}  ${t.keyword}${t.news[0] ? `  ← ${t.news[0].slice(0, 40)}` : ''}`);
    }
  }
  console.log(`\n   저장: data/trends/${date}.json (+ latest.json)`);
  return result;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  collect().catch((err) => {
    console.error('수집 실패:', err);
    process.exit(1);
  });
}
