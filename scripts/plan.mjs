// 콘텐츠 기획 리포트: 이벤트 캘린더 + 수집된 트렌드 → 오늘 쓸 주제 추천
// 사용: node scripts/plan.mjs   (먼저 npm run collect 권장)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  p, readConfig, readJson, readText, writeText, listFiles, parseFrontMatter,
  todayKST, eventStatus, daysUntil, formatKoRange,
} from './lib/util.mjs';

const LEAD_WINDOWS = [30, 14, 7, 3, 1];

/**
 * 자동 생성 금지 주제.
 * 사람의 피해·범죄·정치·투자 판단이 걸린 주제는 AI 자동 작성 시
 * 부정확·부적절 위험이 크고 검색엔진의 YMYL 기준에도 걸린다.
 * 기획 리포트에는 계속 보여주되(사람이 직접 쓸 수는 있음) 자동 생성에서만 제외한다.
 */
// 어떤 맥락에서든 걸리면 제외한다. 사건 자체가 위험한 범주라, 관련 뉴스가
// 하나라도 이쪽이면 주제로 삼지 않는 편이 안전하다.
const HARD_PATTERNS = [
  { re: /화재|사고|참사|붕괴|폭발|침몰|추락|지진|태풍 피해|산사태|실종|사망|숨진|부상|사상자|중태/, why: '재난·인명 피해' },
  { re: /살인|폭행|성범죄|성폭행|마약|음주운전|체포|구속|피의자|기소|검찰|경찰 조사|재판|판결|고소|고발|유죄|무죄|학대/, why: '범죄·수사·재판' },
  { re: /별세|부고|빈소|영결|유서|자살|극단적 선택/, why: '부고·자살' },
  { re: /의료과실|오진|확진|감염|집단감염|리콜|식중독|부작용/, why: '의료·안전 (전문 확인 필요)' },
  // 매일 바뀌는 값: 하루만 지나면 틀린 글이 되고, 기상청·포털 같은 원본 제공자를
  // 검색에서 이길 수도 없다. 대비 요령처럼 수명이 긴 주제는 표현이 달라 통과된다.
  { re: /오늘 날씨|내일 날씨|주말 날씨|일기예보|주간 예보|기온 전망|미세먼지 (농도|수치)|오늘의 운세|로또 [0-9]*회|당첨번호|실시간 환율|오늘 환율|금값 시세/, why: '매일 바뀌는 값 (수명 하루)' },
];

// 글의 성격을 규정하는 범주. 키워드 자체가 여기 해당하거나, 관련 뉴스의
// 과반이 이쪽일 때만 제외한다.
// 뉴스 한 건에 '논란' 같은 단어가 스쳤다고 막으면 '국민연금 추납 제도'처럼
// 정보 가치가 큰 주제까지 잃는다.
const SOFT_PATTERNS = [
  { re: /대통령|국회|여당|야당|국민의힘|더불어민주당|탄핵|특검|당대표|공천|선거 유세/, why: '국내 정치 (편향 위험)' },
  { re: /코인|비트코인|도지|주가|급등|급락|상한가|하한가|공모주|유상증자|수익률|투자 추천/, why: '투자 판단 (YMYL)' },
  { re: /열애|결별|이혼|불륜|사생활|논란|해명|사과문|폭로|갑질/, why: '개인 사생활·논란' },
  // 인물 신상 캐기: 수명이 몇 시간이고, 실존 인물의 발언을 검증 없이 인용할
  // 위험이 크다. 연예 주제라도 '드라마 편성' 같은 정보성 훅이면 통과된다.
  { re: /프로필|본명|학력|나이는|재산|가족관계|재혼|근황|심경|고백|눈물|미담/, why: '인물 신상·발언 (정보 가치 낮음)' },
];

/**
 * 자동 발행하지 않고 사람 검수를 거쳐야 하는 주제.
 * 차단(BLOCKED)과는 다르다 — 글은 쓰되 게시만 보류한다.
 *
 * 기준은 "웹 검색으로 사실을 맞춰도, 독자가 그대로 따라 했다가 틀리면 돈·건강·권리를
 * 되돌릴 수 없게 잃는 것"뿐이다. 생성 단계(루틴·new-post)가 웹 검색으로 사실을 확인하고
 * "모르면 쓰지 않는다"를 지키므로, 숫자·일정·인물 이름이 나온다는 이유만으로는 묶지 않는다.
 * (2026-10-02 에 좁혔다. 넓은 기준에서는 대기 글이 15편까지 쌓여 절반이 때를 놓쳤다.)
 * 노동절 글처럼 휴일근로 수당이 걸린 내용은 여전히 걸린다.
 */
const REVIEW_PATTERNS = [
  // '용량' 만 쓰면 저장 용량(256GB 등)에 걸린다
  { re: /증상|치료법|치료제|복용|처방|투약|투여량|부작용|응급처치|자가진단/, why: '의료·건강 (YMYL)' },
  // '종목' 만 쓰면 스포츠 종목에 걸린다
  { re: /추천 종목|관련주|매수|매도|목표주가|배당주|가상자산|코인 투자|부동산 투자|투자 전략|내 대출|대출 (금리|이자|한도|갈아타기)|주담대|DSR/, why: '투자·대출 판단 (YMYL)' },
  { re: /세금 신고|세액|공제|연말정산|종합소득세|과태료|벌금|위약금|휴일근로|휴일대체|유급휴일|휴일수당|근로기준법|(지원금|보조금|수당|급여) (신청|자격|대상|지급 조건)/, why: '세금·법적 의무·받을 돈의 자격' },
  // 시험 당일 규칙: 입실 시각이나 반입 금지 물품을 틀리면 응시자에게 되돌릴 수 없는 피해가 간다.
  { re: /입실 (시각|시간)|반입 금지|수험표|원서 접수 마감/, why: '시험 당일 규칙·마감' },
  // 실존 인물을 평가하거나 발언을 옮기는 글: 틀리면 명예훼손이 된다. 이름이 나오는 것만으로는 묶지 않는다.
  { re: /발언|인터뷰|의혹|비판|해명|폭로/, why: '실존 인물 발언·평가' },
];

/** 검수가 필요하면 사유, 아니면 null */
export function reviewReason(text) {
  const s = String(text || '');
  for (const r of REVIEW_PATTERNS) if (r.re.test(s)) return r.why;
  return null;
}

/**
 * 자동 생성 금지 대상이면 사유, 아니면 null.
 * @param {string} keyword  검색 키워드
 * @param {string[]} news   관련 뉴스 헤드라인
 */
export function blockReason(keyword, news = []) {
  const kw = String(keyword || '');
  const heads = (Array.isArray(news) ? news : [news]).map(String).filter(Boolean);

  for (const b of HARD_PATTERNS) {
    if (b.re.test(kw) || heads.some((h) => b.re.test(h))) return b.why;
  }
  // 과반 기준 (뉴스가 없으면 키워드만 본다)
  const threshold = heads.length ? Math.ceil(heads.length / 2) : Infinity;
  for (const b of SOFT_PATTERNS) {
    if (b.re.test(kw)) return b.why;
    if (heads.filter((h) => b.re.test(h)).length >= threshold) return b.why;
  }
  return null;
}

function loadAllPosts() {
  return listFiles(p('content', 'posts')).map((file) => {
    const { meta } = parseFrontMatter(readText(file));
    return {
      slug: path.basename(file, '.md'),
      title: meta.title || '',
      tags: meta.tags || [],
      keywords: meta.keywords || [],
      event: meta.event || '',
      draft: meta.draft === true,
    };
  });
}

function isCovered(posts, { keywords = [], event = '' }) {
  return posts.some((post) => {
    if (event && post.event === event) return true;
    const haystack = [post.title, ...post.tags, ...post.keywords].join(' ');
    return keywords.some((k) => k && haystack.includes(k));
  });
}

export function buildPlanReport() {
  const config = readConfig();
  const today = todayKST();
  const events = readJson(p('data', 'events.json'), []);
  const trends = readJson(p('data', 'trends', 'latest.json'), null);
  const posts = loadAllPosts();

  const alerts = [];
  for (const ev of events) {
    const st = eventStatus(ev, today);
    const covered = isCovered(posts, { keywords: ev.keywords, event: ev.key });
    if (st.phase === 'upcoming' && st.days <= 30) {
      const window = LEAD_WINDOWS.find((w) => st.days <= w);
      alerts.push({
        type: 'lead',
        event: ev,
        st,
        covered,
        note: `D-${st.days} — 검색량 급증 전 선점 타이밍${window ? ` (D-${window} 윈도우)` : ''}`,
      });
    } else if (st.phase === 'live') {
      alerts.push({ type: 'live', event: ev, st, covered, note: '진행 중 — 기존 글 업데이트(회전) + 속보성 글 타이밍' });
    } else if (st.phase === 'past' && daysUntil(ev.end || ev.start, today) >= -3) {
      alerts.push({ type: 'recap', event: ev, st, covered, note: '막 종료 — 결과·결산 글 타이밍 (결과 검색 급증)' });
    }
  }

  const trendCands = (trends?.trends || []).slice(0, 10).map((t) => ({
    ...t,
    covered: isCovered(posts, { keywords: [t.keyword] }),
  }));

  // 추천 점수 산정
  const recs = [];
  for (const a of alerts) {
    let score = 0;
    if (a.type === 'live') score = 90;
    else if (a.type === 'recap') score = 85;
    else if (a.st.days <= 1) score = 85;
    else if (a.st.days <= 3) score = 80;
    else if (a.st.days <= 7) score = 70;
    else if (a.st.days <= 14) score = 55;
    else score = 40;
    if (a.covered && a.type === 'lead') score -= 100; // 이미 선점 글 있음
    if (score > 0) {
      const idea = a.type === 'recap' ? `${a.event.name} 최종 결과·결산 총정리` : a.event.ideas?.[0] || `${a.event.name} 총정리`;
      recs.push({
        type: 'event',
        topic: `${a.event.name} — ${idea}`,
        category: a.event.category,
        event: a.event.key,
        score,
        why: a.note,
        command: `npm run new -- "${a.event.name} ${a.type === 'recap' ? '결과 총정리' : '총정리'}" --category "${a.event.category}" --event ${a.event.key}`,
      });
    }
  }
  for (const t of trendCands) {
    if (t.covered) continue;
    let score = t.trafficNum >= 10000 ? 75 : t.trafficNum >= 2000 ? 55 : 35;
    const blocked = blockReason(t.keyword, t.news || []);
    recs.push({
      type: 'trend',
      topic: t.keyword,
      category: '트렌드 이슈',
      event: '',
      score,
      blocked: !!blocked,
      blockReason: blocked,
      why: `실시간 검색 ${t.traffic}${t.news[0] ? ` · 관련 뉴스: ${t.news[0].slice(0, 50)}` : ''}`,
      command: `npm run new -- "${t.keyword}" --category "트렌드 이슈"`,
    });
  }
  recs.sort((a, b) => b.score - a.score);
  const top = recs.slice(0, 6);

  // 리포트 작성
  const lines = [];
  lines.push(`# 콘텐츠 기획 리포트 — ${today}`);
  lines.push('');
  lines.push('## ① 이벤트 알림 (사전 포지셔닝·회전 타이밍)');
  if (!alerts.length) lines.push('- 30일 내 이벤트 없음');
  for (const a of alerts) {
    lines.push(`- **[${a.st.label}] ${a.event.name}** (${formatKoRange(a.event.start, a.event.end)})${a.covered ? ' ✅ 커버됨' : ' ⬜ 미커버'}`);
    lines.push(`  - ${a.note}`);
    for (const idea of a.event.ideas || []) lines.push(`  - 아이디어: ${idea}`);
  }
  lines.push('');
  lines.push('## ② 실시간 트렌드 후보');
  if (!trendCands.length) lines.push('- 수집 데이터 없음 → `npm run collect` 먼저 실행');
  for (const t of trendCands) {
    lines.push(`- **${t.keyword}** (${t.traffic})${t.covered ? ' ✅ 커버됨' : ''}${t.news[0] ? ` — ${t.news[0]}` : ''}`);
  }
  lines.push('');
  lines.push('## ③ 오늘의 추천 (우선순위 순)');
  top.forEach((r, i) => {
    const flag = r.blocked ? ` 🚫 자동 생성 제외 — ${r.blockReason}` : '';
    lines.push(`${i + 1}. **${r.topic}** [${r.category}] (점수 ${r.score})${flag}`);
    lines.push(`   - 이유: ${r.why}`);
    if (r.blocked) lines.push('   - ⚠️ 이 주제는 사람이 직접 사실 확인 후 작성해야 합니다.');
    else lines.push(`   - 실행: \`${r.command}\``);
  });
  lines.push('');
  const report = lines.join('\n');
  const reportPath = p('data', 'plan', `${today}.md`);
  writeText(reportPath, report);

  return { alerts, trendCands, recommendations: top, report, reportPath, config };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { report, reportPath } = buildPlanReport();
  console.log('\n' + report);
  console.log(`저장: ${path.relative(process.cwd(), reportPath)}`);
}
