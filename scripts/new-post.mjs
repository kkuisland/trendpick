// SEO 초안 생성기
// 사용: node scripts/new-post.mjs "주제" [--category "생활 정보"] [--event chuseok-2026]
//       [--keywords "a,b"] [--slug my-slug] [--publish] [--model claude-opus-5]
//
// Claude API 인증(ANTHROPIC_API_KEY 또는 `ant auth login` 프로필)이 있으면 완성 초안을,
// 없으면 채워 넣을 수 있는 구조화 템플릿을 생성합니다.
// 참고: 안전 분류기가 요청을 거절할 경우를 대비해 서버측 폴백(fallbacks: "default")을
// 기본 활성화했습니다 — 거절 시 같은 요청이 폴백 모델로 자동 재시도됩니다.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  p, readConfig, readJson, readText, writeText, listFiles, parseFrontMatter,
  serializeFrontMatter, todayKST, slugify, formatKoRange,
} from './lib/util.mjs';
import { blockReason, reviewReason } from './plan.mjs';

function parseArgs(argv) {
  const args = { topic: '', flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--publish') args.flags.publish = true;
    else if (a.startsWith('--')) {
      args.flags[a.slice(2)] = argv[++i] || '';
    } else if (!args.topic) args.topic = a;
  }
  return args;
}

function buildSystemPromptEn(config) {
  const cats = (config.i18n?.en?.categories || []).map((c) => c.name).join(', ');
  return `You are an expert SEO content writer producing English articles about Korea for an international audience (people who do not speak Korean and have no local contacts).

[OUTPUT FORMAT — follow exactly]
- Output a single markdown document. No preamble, no code fences around it.
- Start with this front matter:
---
title: (under 60 characters, primary keyword near the front)
slug: (lowercase english words with hyphens, 4-6 words)
description: (140-160 characters, states the answer plus a reason to click)
date: (today's date, YYYY-MM-DD)
category: (exactly one of: ${cats})
tags: [tag1, tag2, tag3]
keywords: [target search query 1, query 2, query 3]
draft: true
---

[BODY STRUCTURE]
1. Immediately after the front matter, answer the search intent in 3-4 sentences with no heading and no throat-clearing introduction. This is the featured-snippet target.
2. Next line: {{toc}}
3. Place {{ad}} exactly twice: once after the opening answer, once mid-article.
4. Use 4-7 "## " headings, with "### " where useful. Work the target keywords into headings naturally.
5. Include at least one markdown table (comparison, schedule, price tiers).
6. Keep paragraphs to 2-4 sentences. Use lists generously.
7. If an event key is supplied, place "::event <key>" on its own line under the opening answer.
8. End with 5-6 FAQs in this format:
::faq
Q: Question?
A: Answer.

Q: Question?
A: Answer.
::

[ACCURACY AND STYLE]
- **Use the web search tool to verify facts before writing.** Dates, prices, schedules, rules and anything a reader could act on must be checked, not recalled.
- Verified facts can be stated plainly. Reserve "[confirm before you go]" / "[not yet confirmed]" for things that genuinely are not settled yet.
- Where sources disagree, prefer official ones (government bodies, the company itself) and say why.
- Write for someone who has never been to Korea. Romanise Korean terms and give the Hangul in parentheses on first use, e.g. songpyeon (송편).
- Explain cultural context rather than assuming it. Avoid the tourist-brochure register — be concrete and useful.
- Never invent drama titles, cast names, prices, or schedules. If you do not know, say what varies and how the reader can check.
- No clickbait. Plain, confident English.
- If earlier articles are listed, link to 1-2 relevant ones inline as [Title](/en/posts/slug/).
- Use only affiliate blocks listed below, if any. Never use {{coupang}}.${affiliateKeyHint('en')}`;
}

/** 사용 가능한 제휴 링크 키 목록을 프롬프트용 문자열로 (URL 이 채워진 것만) */
function affiliateKeyHint(locale = 'ko') {
  const reg = readJson(p('data', 'affiliates.json'), null);
  if (!reg) return '';
  const items = [];
  for (const [key, g] of Object.entries(reg.groups || {})) {
    if ((g.items || []).some((it) => it.url)) items.push(`{{aff ${key}}} — ${g.title}`);
  }
  for (const [key, l] of Object.entries(reg.links || {})) {
    if (l.url) items.push(`{{aff ${key}}} — ${l.title}`);
  }
  if (!items.length) return '';
  return locale === 'en'
    ? `\n\n[AVAILABLE AFFILIATE BLOCKS — use at most one, only where a reader would genuinely be deciding what to buy or book. Place it after you have given the selection criteria, never as a bare recommendation.]\n${items.map((s) => '- ' + s).join('\n')}`
    : `\n\n[사용 가능한 제휴 블록 — 최대 1개만, 독자가 실제로 "뭘 사지/예약하지"를 고민하는 지점에만 배치합니다. 선택 기준을 먼저 설명한 뒤에 넣고, 근거 없는 추천은 하지 않습니다.]\n${items.map((s) => '- ' + s).join('\n')}`;
}

function buildSystemPrompt(config) {
  const cats = config.categories.map((c) => c.name).join(', ');
  return `당신은 한국어 SEO 콘텐츠 전문 작가입니다. 네이버와 구글 검색 상위 노출을 목표로 하는 정보성 글을 작성합니다.

[출력 형식 — 반드시 지킬 것]
- 마크다운 문서 하나만 출력합니다. 문서 앞뒤에 다른 말이나 코드펜스를 붙이지 마세요.
- 문서는 아래 프런트매터로 시작합니다:
---
title: (32자 내외, 핵심 검색 키워드를 문장 앞쪽에)
slug: (영문 소문자·하이픈만, 4~6단어, 예: chuseok-2026-train-booking)
description: (70~110자, 검색결과에 노출될 요약 — 핵심 답 + 클릭 이유)
date: (오늘 날짜, YYYY-MM-DD)
category: (다음 중 하나만: ${cats})
tags: [태그1, 태그2, 태그3]
keywords: [노리는 검색어1, 검색어2, 검색어3]
draft: true
---

[본문 구조 규칙]
1. 프런트매터 직후, 소제목 없이 3~4문장으로 검색 의도에 대한 핵심 답변을 바로 제시합니다 (추천 스니펫 노출용). 뻔한 인사말·서론 금지.
2. 그 다음 줄에 {{toc}} 를 배치합니다.
3. {{ad}} 를 정확히 2회 배치합니다: 핵심 답변 바로 뒤 1회, 본문 중간 1회.
4. ## 소제목 4~7개로 구성하고 필요하면 ### 을 씁니다. 소제목에도 검색 키워드를 자연스럽게 포함합니다.
5. 마크다운 표를 최소 1개 포함합니다 (일정표, 비교표, 요금표 등 구조화 정보).
6. 문단은 2~4문장으로 짧게, 목록을 적극 활용합니다.
7. 이벤트 키가 주어진 경우, 핵심 답변 바로 아래에 ::event 키 를 한 줄로 배치합니다.
8. 제휴 블록은 아래 [사용 가능한 제휴 블록] 목록에 있는 키만 사용합니다. 목록이 비어 있으면 넣지 않습니다. {{coupang}} 은 사용하지 마세요.
   - **주제와 링크 대상이 실제로 맞을 때만** 넣습니다. 예: 선물세트 링크는 선물 이야기에만 넣고, 상비약·용품 이야기에는 넣지 않습니다.
   - **건강·의료·안전·재난 주제에는 제휴 링크를 넣지 않습니다.** 신뢰도가 우선입니다.
9. 글 마지막에 자주 묻는 질문 4~6개를 아래 형식으로 넣습니다:
::faq
Q: 질문?
A: 답변.

Q: 질문?
A: 답변.
::

[정확성·품질 규칙]
- **웹 검색 도구를 반드시 사용해 사실을 확인한 뒤 씁니다.** 특히 날짜, 금액, 시행일, 제도 내용, 일정처럼 틀리면 독자에게 피해가 가는 항목은 검색으로 확인합니다.
- 검색으로 확인한 내용은 단정적으로 써도 됩니다. 검색해도 확정되지 않았거나 향후 공지 예정인 사항만 문장 끝에 [확인 필요] 를 붙입니다.
- 검색 결과가 서로 어긋나면 더 공신력 있는 출처(정부·공공기관·해당 기업 공식 발표)를 따르고, 그렇게 판단한 근거를 본문에 밝힙니다.
- 제공된 컨텍스트의 날짜·수치도 검색으로 교차 확인합니다.
- 검색자가 실제로 궁금해할 정보(날짜, 방법, 비용, 절차, 비교)를 우선합니다.
- 과장·낚시성 표현 금지. 존댓말 사용.
- 경제·투자 주제라면 "특정 상품의 매수·매도 추천이나 투자 자문이 아닙니다"를 본문에 명시합니다.
- 건강·의료 주제라면 전문의 상담 권고를 명시합니다.
- 기존 글 목록이 주어지면 관련 있는 글 1~2개를 본문에 [제목](/posts/슬러그/) 형태로 자연스럽게 링크합니다.${affiliateKeyHint('ko')}`;
}

function buildUserPromptEn({ topic, category, event, keywords, events, posts }) {
  const lines = [];
  lines.push(`Today's date: ${todayKST()} (KST)`);
  lines.push(`Topic to write about: ${topic}`);
  if (category) lines.push(`Category: ${category}`);
  if (keywords?.length) lines.push(`Target search keywords: ${keywords.join(', ')}`);
  if (event) {
    const ev = events.find((e) => e.key === event);
    if (ev) {
      lines.push(`\n[EVENT — place "::event ${ev.key}" near the top of the body]`);
      lines.push(`- Name: ${ev.nameEn || ev.name}`);
      lines.push(`- Dates: ${ev.start} to ${ev.end || ev.start}${ev.tentative ? ' (NOT yet officially confirmed — say so in the body)' : ''}`);
      if (ev.keywordsEn) lines.push(`- Keywords: ${ev.keywordsEn.join(', ')}`);
    }
  }
  if (posts.length) {
    lines.push('\n[EXISTING ENGLISH ARTICLES — link 1-2 if genuinely relevant]');
    for (const post of posts.slice(0, 20)) lines.push(`- [${post.title}](/en/posts/${post.slug}/)`);
  }
  lines.push('\nWrite one complete, genuinely useful SEO article following the rules above.');
  return lines.join('\n');
}

function buildUserPrompt({ topic, category, event, keywords, config, trends, events, posts }) {
  const lines = [];
  lines.push(`오늘 날짜: ${todayKST()}`);
  lines.push(`작성 주제: ${topic}`);
  if (category) lines.push(`지정 카테고리: ${category}`);
  if (keywords?.length) lines.push(`반드시 포함할 검색 키워드: ${keywords.join(', ')}`);

  if (event) {
    const ev = events.find((e) => e.key === event);
    if (ev) {
      lines.push(`\n[이벤트 정보 — ::event ${ev.key} 카드를 본문 상단에 배치]`);
      lines.push(`- 이름: ${ev.name}`);
      lines.push(`- 기간: ${formatKoRange(ev.start, ev.end)}${ev.tentative ? ' (일정 미확정 — 본문에 명시)' : ''}`);
      lines.push(`- 핵심 키워드: ${ev.keywords.join(', ')}`);
    }
  }

  const related = (trends?.trends || []).filter(
    (t) => topic.includes(t.keyword) || t.keyword.includes(topic.split(' ')[0])
  );
  const pool = related.length ? related : [];
  if (pool.length) {
    lines.push('\n[관련 실시간 트렌드·뉴스 컨텍스트]');
    for (const t of pool.slice(0, 3)) {
      lines.push(`- 검색어 "${t.keyword}" (${t.traffic})`);
      for (const n of t.news || []) lines.push(`  - 뉴스: ${n}`);
      for (const n of t.naverNews || []) lines.push(`  - 네이버 뉴스: ${n}`);
    }
  }
  const headlines = trends?.headlines || {};
  const allHeads = Object.values(headlines).flat().map((h) => h.title);
  const matchedHeads = allHeads.filter((h) => topic.split(/\s+/).some((w) => w.length >= 2 && h.includes(w))).slice(0, 8);
  if (matchedHeads.length) {
    lines.push('\n[주제 관련 최신 헤드라인]');
    for (const h of matchedHeads) lines.push(`- ${h}`);
  }

  if (posts.length) {
    lines.push('\n[기존 글 목록 — 관련 있으면 내부 링크]');
    for (const post of posts.slice(0, 20)) lines.push(`- [${post.title}](/posts/${post.slug}/)`);
  }

  lines.push('\n위 규칙에 따라 완성도 높은 SEO 글 한 편을 작성해 주세요.');
  return lines.join('\n');
}

function writeTemplate({ topic, category, event, slug, config, locale = 'ko' }) {
  const today = todayKST();
  const finalSlug = slug || slugify(topic) || `post-${today.replace(/-/g, '')}`;
  const file = uniquePath(finalSlug, locale);
  if (locale === 'en') {
    const enBody = `---
title: ${topic}
description: (140-160 characters: the answer plus a reason to click)
date: ${today}
category: ${category || 'Culture'}
tags: []
keywords: []
${event ? `event: ${event}\n` : ''}draft: true
---

(Answer the search intent here in 3-4 sentences. No introduction — lead with the answer.)

${event ? `::event ${event}\n` : ''}{{toc}}

{{ad}}

## Heading 1

(content)

## Heading 2

(include a table here)

| Item | Detail |
|---|---|
| Example | Example |

{{ad}}

## Heading 3

(content)

::faq
Q: Question 1?
A: Answer.

Q: Question 2?
A: Answer.
::
`;
    writeText(file, enBody);
    return file;
  }
  const body = `---
title: ${topic}
description: (70~110자 요약을 채워주세요 — 핵심 답 + 클릭할 이유)
date: ${today}
category: ${category || '트렌드 이슈'}
tags: []
keywords: []
${event ? `event: ${event}\n` : ''}draft: true
---

(여기에 3~4문장으로 검색 의도에 대한 핵심 답변을 먼저 쓰세요. 서론 없이 바로 답부터.)

${event ? `::event ${event}\n` : ''}{{toc}}

{{ad}}

## 소제목 1

(내용)

## 소제목 2

(내용 — 표를 하나 포함하세요)

| 항목 | 내용 |
|---|---|
| 예시 | 예시 |

{{ad}}

## 소제목 3

(내용)

::faq
Q: 자주 묻는 질문 1?
A: 답변.

Q: 자주 묻는 질문 2?
A: 답변.
::
`;
  writeText(file, body);
  return file;
}

function postsDir(locale) {
  return locale === 'en' ? ['content', 'en', 'posts'] : ['content', 'posts'];
}

function uniquePath(slug, locale = 'ko') {
  const dir = postsDir(locale);
  let file = p(...dir, `${slug}.md`);
  let n = 2;
  while (fs.existsSync(file)) {
    file = p(...dir, `${slug}-${n}.md`);
    n++;
  }
  return file;
}

/** Claude API로 초안 생성. 성공 시 파일 경로 반환 */
export async function generatePost({ topic, category = '', event = '', keywords = [], slug = '', publish = false, model = '', locale = 'ko', templateFallback = true }) {
  const config = readConfig();
  const trends = readJson(p('data', 'trends', 'latest.json'), null);
  const events = readJson(p('data', 'events.json'), []);
  const posts = listFiles(p(...postsDir(locale))).map((file) => {
    const { meta } = parseFrontMatter(readText(file));
    return { slug: path.basename(file, '.md'), title: meta.title || '' };
  });

  let Anthropic;
  try {
    Anthropic = (await import('@anthropic-ai/sdk')).default;
  } catch {
    const file = writeTemplate({ topic, category, event, slug, config, locale });
    console.log(`\n📄 SDK(@anthropic-ai/sdk)가 설치되어 있지 않아 템플릿을 생성했습니다:`);
    console.log(`   ${path.relative(process.cwd(), file)}`);
    console.log('   → npm install 후 다시 실행하면 자동 초안이 생성됩니다.');
    console.log('   → 또는 Claude Code에게 "이 템플릿 채워줘"라고 요청하세요.');
    return { file, mode: 'template' };
  }

  // 자동 루틴(templateFallback: false)에서는 빈 템플릿을 만들지 않는다.
  // 하루 3회 실행되므로 인증이 없으면 껍데기 파일만 계속 쌓이기 때문.
  const noAuthResult = () => {
    console.log('\n🔑 API 인증이 없어 생성을 건너뜁니다.');
    console.log('   gh secret set ANTHROPIC_API_KEY --repo kkuisland/trendpick');
    return { mode: 'no-auth' };
  };

  const authGuide = (file) => {
    console.log('\n🔑 API 인증이 없어 템플릿을 생성했습니다:');
    console.log(`   ${path.relative(process.cwd(), file)}`);
    console.log('   자동 생성을 쓰려면 둘 중 하나:');
    console.log('   1) 환경변수 ANTHROPIC_API_KEY 설정 (https://console.anthropic.com)');
    console.log('   2) ant auth login (Anthropic CLI 프로필)');
    console.log('   또는 이 템플릿을 Claude Code에게 채워달라고 요청하세요.');
  };

  let client;
  try {
    client = new Anthropic();
  } catch {
    // 인증 수단이 전혀 없으면 생성자에서 실패
    if (!templateFallback) return noAuthResult();
    const file = writeTemplate({ topic, category, event, slug, config, locale });
    authGuide(file);
    return { file, mode: 'template' };
  }
  const isEn = locale === 'en';
  const useModel = model || config.apis.anthropic.model || 'claude-opus-5';
  console.log(`\n✍️  초안 생성 중... (모델: ${useModel}, 언어: ${locale})`);

  let msg;
  try {
    const stream = client.beta.messages.stream({
      model: useModel,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // 웹 검색을 붙여 날짜·수치·제도 내용을 모델이 직접 확인하게 한다.
      // 이게 없으면 모델의 기억에만 의존해, 노동절 글처럼 사실이 정반대로
      // 생성되는 일이 생긴다. 검수 병목의 근본 원인이기도 하다.
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
      system: isEn ? buildSystemPromptEn(config) : buildSystemPrompt(config),
      messages: [
        {
          role: 'user',
          content: isEn
            ? buildUserPromptEn({ topic, category, event, keywords, events, posts })
            : buildUserPrompt({ topic, category, event, keywords, config, trends, events, posts }),
        },
      ],
    });
    let dots = 0;
    stream.on('text', () => {
      if (++dots % 20 === 0) process.stdout.write('.');
    });
    msg = await stream.finalMessage();
    process.stdout.write('\n');
  } catch (err) {
    const noCreds =
      err instanceof Anthropic.AuthenticationError ||
      /Could not resolve authentication/i.test(String(err.message || ''));
    if (noCreds) {
      if (!templateFallback) return noAuthResult();
      const file = writeTemplate({ topic, category, event, slug, config, locale });
      authGuide(file);
      return { file, mode: 'template' };
    }
    if (err instanceof Anthropic.RateLimitError) throw new Error('요청 한도 초과 — 잠시 후 다시 실행하세요.');
    throw err;
  }

  if (msg.stop_reason === 'refusal') {
    const why = msg.stop_details?.explanation || msg.stop_details?.category || '사유 미상';
    throw new Error(`모델이 이 주제의 생성을 거절했습니다 (${why}). 주제를 바꿔보세요.`);
  }

  // 웹 검색이 길어지면 턴이 중간에 끊길 수 있다. 반쪽짜리 글을 쓰지 않도록 막는다.
  if (msg.stop_reason === 'pause_turn' || msg.stop_reason === 'max_tokens') {
    throw new Error(`생성이 완료되지 않았습니다 (stop_reason: ${msg.stop_reason}). 다시 실행해 주세요.`);
  }
  const searches = msg.content.filter((b) => b.type === 'web_search_tool_result').length;
  if (searches) console.log(`   🔎 웹 검색 ${searches}회로 사실 확인`);

  let text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  // 코드펜스로 감싼 경우 제거
  text = text.replace(/^```(?:md|markdown)?\n([\s\S]*?)\n```$/m, '$1').trim();
  const fmStart = text.indexOf('---');
  if (fmStart > 0) text = text.slice(fmStart);
  if (!text.startsWith('---')) throw new Error('출력이 프런트매터로 시작하지 않습니다. 다시 실행해 주세요.');

  const { meta, body } = parseFrontMatter(text.endsWith('\n') ? text : text + '\n');
  meta.title = meta.title || topic;

  // 출력 검사: 주제 선정은 트렌드 키워드·헤드라인으로만 판단하므로,
  // 중립적인 키워드("승리")에 중립적인 헤드라인("행사 포착")이 붙어 통과됐다가
  // 모델이 글을 쓰면서 범죄·재판 맥락을 끌어오는 경우를 잡지 못한다.
  // 그래서 생성된 글의 제목·요약(= 글의 실제 주제)을 한 번 더 검사한다.
  // 본문 전체가 아니라 제목·요약만 보는 이유는, 본문에는 부수적 언급이 섞여
  // 정상적인 글까지 걸러낼 수 있기 때문이다.
  const subject = `${meta.title} ${meta.description || ''}`;
  const rejected = blockReason(subject);
  if (rejected) {
    console.log(`\n🚫 생성 결과 폐기 — ${rejected}`);
    console.log(`   제목: ${meta.title}`);
    console.log('   주제 선정 단계에서는 걸러지지 않았지만, 완성된 글의 주제가 부적합합니다.');
    return { mode: 'rejected', reason: rejected, title: meta.title };
  }

  meta.date = /^\d{4}-\d{2}-\d{2}$/.test(String(meta.date)) ? meta.date : todayKST();
  if (category) meta.category = category;
  if (event) meta.event = event;

  // 자동 발행이 켜져 있어도, 틀리면 피해가 큰 주제는 초안으로 남겨 사람이 보게 한다.
  const needsReview = publish ? reviewReason(subject) : null;
  meta.draft = publish && !needsReview ? false : true;
  if (needsReview) meta.reviewReason = needsReview;
  const modelSlug = typeof meta.slug === 'string' ? slugify(meta.slug) : '';
  delete meta.slug;
  const finalSlug = slug || modelSlug || slugify(meta.title) || `post-${todayKST().replace(/-/g, '')}`;
  const file = uniquePath(finalSlug, locale);
  writeText(file, `${serializeFrontMatter(meta)}\n\n${body.trim()}\n`);

  const stateLabel = needsReview
    ? `⏸ 검수 대기 — ${needsReview}`
    : publish
      ? '🟢 자동 발행'
      : '(draft: true)';
  console.log(`✅ 글 생성: ${path.relative(process.cwd(), file)} ${stateLabel}`);
  console.log(`   토큰: 입력 ${msg.usage.input_tokens} / 출력 ${msg.usage.output_tokens}${msg.model !== useModel ? ` · 폴백 모델 사용됨(${msg.model})` : ''}`);
  if (meta.draft) {
    console.log('   → 내용(특히 날짜·수치·[확인 필요] 표시)을 검토한 뒤 draft: false 로 바꾸고 npm run build 하세요.');
  }
  return {
    file,
    mode: 'generated',
    slug: finalSlug,
    title: meta.title,
    published: !meta.draft,
    heldForReview: needsReview || null,
    locale,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { topic, flags } = parseArgs(process.argv.slice(2));
  if (!topic) {
    console.log('사용법: npm run new -- "주제" [--category "생활 정보"] [--event 이벤트키] [--keywords "a,b"] [--slug my-slug] [--publish]');
    process.exit(1);
  }
  generatePost({
    topic,
    category: flags.category || '',
    event: flags.event || '',
    keywords: flags.keywords ? flags.keywords.split(',').map((s) => s.trim()) : [],
    slug: flags.slug || '',
    publish: !!flags.publish,
    model: flags.model || '',
    locale: flags.locale || 'ko',
  }).catch((err) => {
    console.error('실패:', err.message || err);
    process.exit(1);
  });
}
