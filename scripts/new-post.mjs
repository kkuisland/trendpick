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
8. 상품·쇼핑 연계가 자연스러운 주제라면 {{coupang}} 을 1회 배치합니다 (억지로 넣지 않기).
9. 글 마지막에 자주 묻는 질문 4~6개를 아래 형식으로 넣습니다:
::faq
Q: 질문?
A: 답변.

Q: 질문?
A: 답변.
::

[정확성·품질 규칙]
- 제공된 컨텍스트에 있는 날짜·수치만 단정적으로 쓰고, 그 외 확실하지 않은 사실은 문장 끝에 [확인 필요] 를 붙입니다.
- 검색자가 실제로 궁금해할 정보(날짜, 방법, 비용, 절차, 비교)를 우선합니다.
- 과장·낚시성 표현 금지. 존댓말 사용.
- 경제·투자 주제라면 "특정 상품의 매수·매도 추천이나 투자 자문이 아닙니다"를 본문에 명시합니다.
- 건강·의료 주제라면 전문의 상담 권고를 명시합니다.
- 기존 글 목록이 주어지면 관련 있는 글 1~2개를 본문에 [제목](/posts/슬러그/) 형태로 자연스럽게 링크합니다.`;
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

function writeTemplate({ topic, category, event, slug, config }) {
  const today = todayKST();
  const finalSlug = slug || slugify(topic) || `post-${today.replace(/-/g, '')}`;
  const file = uniquePath(finalSlug);
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

function uniquePath(slug) {
  let file = p('content', 'posts', `${slug}.md`);
  let n = 2;
  while (fs.existsSync(file)) {
    file = p('content', 'posts', `${slug}-${n}.md`);
    n++;
  }
  return file;
}

/** Claude API로 초안 생성. 성공 시 파일 경로 반환 */
export async function generatePost({ topic, category = '', event = '', keywords = [], slug = '', publish = false, model = '' }) {
  const config = readConfig();
  const trends = readJson(p('data', 'trends', 'latest.json'), null);
  const events = readJson(p('data', 'events.json'), []);
  const posts = listFiles(p('content', 'posts')).map((file) => {
    const { meta } = parseFrontMatter(readText(file));
    return { slug: path.basename(file, '.md'), title: meta.title || '' };
  });

  let Anthropic;
  try {
    Anthropic = (await import('@anthropic-ai/sdk')).default;
  } catch {
    const file = writeTemplate({ topic, category, event, slug, config });
    console.log(`\n📄 SDK(@anthropic-ai/sdk)가 설치되어 있지 않아 템플릿을 생성했습니다:`);
    console.log(`   ${path.relative(process.cwd(), file)}`);
    console.log('   → npm install 후 다시 실행하면 자동 초안이 생성됩니다.');
    console.log('   → 또는 Claude Code에게 "이 템플릿 채워줘"라고 요청하세요.');
    return { file, mode: 'template' };
  }

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
    // 인증 수단이 전혀 없으면 생성자에서 실패 → 템플릿 폴백
    const file = writeTemplate({ topic, category, event, slug, config });
    authGuide(file);
    return { file, mode: 'template' };
  }
  const useModel = model || config.apis.anthropic.model || 'claude-opus-5';
  console.log(`\n✍️  초안 생성 중... (모델: ${useModel})`);

  let msg;
  try {
    const stream = client.beta.messages.stream({
      model: useModel,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: buildSystemPrompt(config),
      messages: [
        { role: 'user', content: buildUserPrompt({ topic, category, event, keywords, config, trends, events, posts }) },
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
      const file = writeTemplate({ topic, category, event, slug, config });
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

  let text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  // 코드펜스로 감싼 경우 제거
  text = text.replace(/^```(?:md|markdown)?\n([\s\S]*?)\n```$/m, '$1').trim();
  const fmStart = text.indexOf('---');
  if (fmStart > 0) text = text.slice(fmStart);
  if (!text.startsWith('---')) throw new Error('출력이 프런트매터로 시작하지 않습니다. 다시 실행해 주세요.');

  const { meta, body } = parseFrontMatter(text.endsWith('\n') ? text : text + '\n');
  meta.title = meta.title || topic;
  meta.date = /^\d{4}-\d{2}-\d{2}$/.test(String(meta.date)) ? meta.date : todayKST();
  if (category) meta.category = category;
  if (event) meta.event = event;
  meta.draft = publish ? false : true;
  const modelSlug = typeof meta.slug === 'string' ? slugify(meta.slug) : '';
  delete meta.slug;
  const finalSlug = slug || modelSlug || slugify(meta.title) || `post-${todayKST().replace(/-/g, '')}`;
  const file = uniquePath(finalSlug);
  writeText(file, `${serializeFrontMatter(meta)}\n\n${body.trim()}\n`);

  console.log(`✅ 초안 생성: ${path.relative(process.cwd(), file)} ${publish ? '(발행 상태)' : '(draft: true)'}`);
  console.log(`   토큰: 입력 ${msg.usage.input_tokens} / 출력 ${msg.usage.output_tokens}${msg.model !== useModel ? ` · 폴백 모델 사용됨(${msg.model})` : ''}`);
  if (!publish) {
    console.log('   → 내용(특히 날짜·수치·[확인 필요] 표시)을 검토한 뒤 draft: false 로 바꾸고 npm run build 하세요.');
  }
  return { file, mode: 'generated', slug: finalSlug, title: meta.title, published: publish };
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
  }).catch((err) => {
    console.error('실패:', err.message || err);
    process.exit(1);
  });
}
