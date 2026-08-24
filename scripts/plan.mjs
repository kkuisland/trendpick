// 콘텐츠 기획 리포트: 이벤트 캘린더 + 수집된 트렌드 → 오늘 쓸 주제 추천
// 사용: node scripts/plan.mjs   (먼저 npm run collect 권장)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  p, readConfig, readJson, readText, writeText, listFiles, parseFrontMatter,
  todayKST, eventStatus, daysUntil, formatKoRange,
} from './lib/util.mjs';

const LEAD_WINDOWS = [30, 14, 7, 3, 1];

// 실제 인명·재산 피해를 가리키는 말. 하나라도 있으면 과장 표현이 아니다.
const REAL_HARM = /사망|숨진|숨져|추락사|익사|압사|질식|사상자|중태|부상|인명|피해자|유족|구조|대피|이재민|참변|화재|붕괴|침몰|지진|산사태/;

// 경기 결과·화제성 기사임을 알려주는 신호.
// 스코어 표기('0-3')도 신호로 쓰되, 날짜(2026-08-24)나 시각(8:10)이 스코어로
// 오인되지 않도록 앞뒤에 숫자·구분자가 붙지 않은 한 자리~두 자리만 인정한다.
const FIGURATIVE_CONTEXT = /(?<![\d\-–:])\d{1,2}\s*[-–]\s*\d{1,2}(?![\d\-–:])|경기|개막전|리그|우승|준우승|패배|완패|대승|승점|득점|타선|순위|시즌|팬들|흥행|시청률/;

/**
 * 재난 어휘가 과장 표현으로 쓰였는지 판정한다.
 * 스포츠·연예 기사는 '0-3 개막전 대참사', '타선 폭발'처럼 재난 어휘를 비유로 쓴다.
 * 실제 피해를 가리키는 말이 없고 경기·화제성 문맥일 때만 비유로 본다 —
 * 판단이 서지 않으면 막는 쪽이 기본이다.
 */
function isFigurative(text) {
  const s = String(text);
  if (REAL_HARM.test(s)) return false;
  return FIGURATIVE_CONTEXT.test(s);
}

/**
 * 자동 생성 금지 주제.
 * 사람의 피해·범죄·정치·투자 판단이 걸린 주제는 AI 자동 작성 시
 * 부정확·부적절 위험이 크고 검색엔진의 YMYL 기준에도 걸린다.
 * 기획 리포트에는 계속 보여주되(사람이 직접 쓸 수는 있음) 자동 생성에서만 제외한다.
 */
// 어떤 맥락에서든 걸리면 제외한다. 사건 자체가 위험한 범주라, 관련 뉴스가
// 하나라도 이쪽이면 주제로 삼지 않는 편이 안전하다.
const HARD_PATTERNS = [
  { re: /화재|사고|붕괴|침몰|지진|태풍 피해|산사태|실종|사망|숨진|부상|사상자|중태/, why: '재난·인명 피해' },
  // 재난 어휘지만 스포츠·연예 기사가 과장 표현으로도 쓰는 말. 비유로 판정되면 막지 않는다.
  // (2026-08-24 아침 회차가 "토트넘 '0-3 개막전 대참사'" 기사 하나 때문에 빈손으로 끝났다.)
  { re: /참사|폭발|추락/, why: '재난·인명 피해', figurative: true },
  { re: /살인|폭행|성범죄|성폭행|마약|음주운전|체포|구속|피의자|기소|검찰|경찰 조사|재판|판결|고소|고발|유죄|무죄|학대/, why: '범죄·수사·재판' },
  { re: /별세|부고|빈소|영결|유서|자살|극단적 선택/, why: '부고·자살' },
  { re: /의료과실|오진|확진|감염|집단감염|리콜|식중독|부작용/, why: '의료·안전 (전문 확인 필요)' },
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
 * 선정 기준은 "틀렸을 때 피해가 크고, 생성 단계에서 검증할 수단이 없는 것"이다.
 * 생성 파이프라인에는 웹 검색이 없어 모델의 기억에만 의존하므로,
 * 제도·수치·실존 인물처럼 사실이 바뀌거나 확인이 필요한 영역은 사람이 봐야 한다.
 * (실제로 노동절 글은 휴일대체 가능/불가가 정반대로 생성된 적이 있다.)
 */
const REVIEW_PATTERNS = [
  { re: /법률|법 개정|제도|시행일|개정|공휴일|대체휴일|수당|급여|세금|세액|공제|연말정산|연금|보험료|지원금|보조금|과태료|벌금|규정|조례|정책|자격 요건|신청 방법|접수 기간/, why: '제도·법률·행정' },
  // 시험·입시: 입실 시각이나 반입 금지 물품을 틀리면 응시자에게 직접적인 피해가 간다.
  // 매년 공고로 확정되는 정보라 모델의 기억만으로는 위험하다.
  { re: /수능|모의고사|입시|정시|수시|원서 접수|시험 일정|시간표|응시|합격자 발표|자격증|공무원 시험|면허 시험/, why: '시험·입시 (공고 확인 필요)' },
  // 예매·판매 일정: 오픈 시각을 틀리면 표를 놓친다
  { re: /예매 (일정|오픈|시작)|티켓 오픈|사전예약 (일정|시작)|판매 개시/, why: '예매·오픈 일정 (공지 확인 필요)' },
  { re: /감독|선수|배우|가수|의원|장관|회장|대표이사|아나운서|셰프|인터뷰|발언|선임|사임|취임|복귀|은퇴/, why: '실존 인물' },
  { re: /증상|치료|복용|처방|부작용|병원|응급|진료|건강|다이어트|영양제/, why: '의료·건강 (YMYL)' },
  { re: /주가|주식|우선주|배당|금리|환율|시세|수익률|투자|펀드|코인|부동산|청약/, why: '금융·투자 (YMYL)' },
  { re: /시청률|순위|집계|통계|점유율|매출액|판매량/, why: '통계·수치 (출처 확인 필요)' },
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
    const hit = (s) => b.re.test(s) && !(b.figurative && isFigurative(s));
    if (hit(kw) || heads.some(hit)) return b.why;
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
