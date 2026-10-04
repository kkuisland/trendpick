# 새 시즌 페이지 발행 절차

클라우드 루틴 「케이트렌드 시즌 페이지 발행」이 이 문서대로 움직인다. 한 번 실행에 **최대 1편**만 만든다.

먼저 읽을 것: `CLAUDE.md`(특히 3·4절), `README.md`의 「글 파일 형식」, 이미 만든 시즌 페이지 하나와 그 도구 (예: `content/posts/jongbu-2026-calculator-installment.md` + `public/assets/tools/jongbu-calc.js`).

## 절대 하지 않는 것

- **유료 API 호출 금지.** `scripts/new-post.mjs`, `scripts/auto.mjs`, `scripts/pipeline.mjs` 는 Claude API 를 부르므로 실행하지 않는다. 글과 도구는 루틴이 직접 쓴다.
- 확인하지 못한 수치·날짜·가격을 쓰지 않는다. 핵심 정보를 공식 출처로 확인할 수 없으면 그 후보는 발행하지 않는다.
- 연예인 사생활, 사건사고, 정치, 특정 종목 추천은 다루지 않는다.
- 기존 글을 지우거나 URL 을 바꾸지 않는다.

## 1. 후보 고르기

`data/page-queue.json` 의 `queue` 에서 `status` 가 `"open"` 인 것 중 `publish_by` 가 가장 이른 것부터 본다.

- `publish_by` 가 이미 지났어도 `peak` 달이 아직 오지 않았으면 만든다. `peak` 달이 지났으면 `status` 를 `"skipped"` 로 바꾸고 다음 후보로 넘어간다.
- 같은 주제의 글이 `content/posts/` 에 이미 있으면 `"skipped"` (사유: 중복) 로 바꾼다.

## 2. 사실 확인

`sources_hint` 의 공식 출처(법령, 정부·기관, 주최 측)를 WebSearch·WebFetch 로 직접 열어 확인한다. 언론 기사는 공식 발표를 옮긴 경우에만 쓴다. 블로그·카페·나무위키는 근거로 쓰지 않는다.

- 핵심 정보(도구의 계산 기준, 날짜, 금액)를 확인하지 못하면 `status` 를 `"blocked"` 로 바꾸고 `log` 에 사유와 확인한 곳을 적은 뒤 **다음 후보로 넘어간다.** 다음 후보도 안 되면 아무것도 발행하지 않고 끝낸다.
- 올해 값이 아직 발표되지 않았다면 작년 값을 쓰되 본문·표·도구에 **"작년 기준"** 을 분명히 쓰고, `data/seasonal-updates.json` 에 올해 값 반영 작업을 추가한다 (예: `content/posts/jamsil-christmas-market-2026.md`).

## 3. 페이지 만들기

- 파일: `content/posts/<영문-슬러그>.md`. 슬러그는 소문자·숫자·하이픈.
- 프런트매터: `title`(32자 내외), `description`(70~110자), `date`(오늘), `category`(`config/site.config.json` 의 categories 중 하나), `tags`, `keywords`, `draft: false`. `data/events.json` 에 맞는 이벤트가 있으면 `event`.
- 본문 구조 (CLAUDE.md 4절): 첫 문단에 답 먼저 → `{{toc}}` → 도구 → 표·설명 → `{{ad}}` → 단계별 방법 → `::faq` (4~6개) → 「출처와 업데이트 이력」(공식 출처 링크, **최종 확인일**).
- `{{ad}}` 는 도구 바로 위아래에 두지 않는다.
- 도구: `public/assets/tools/<슬러그>.js`. 기존 도구처럼 외부 의존성 없이 `<div class="calc" id="...">` 에 렌더링하고, 사이트 CSS 클래스(`calc-tabs`, `calc-row`, `calc-grid`, `calc-help`, `calc-result`, `calc-grade`, `data-state="ok|warn|bad"`)를 쓴다. 본문에서는
  ```
  <div class="calc" id="..."><noscript>…</noscript></div>
  <script src="/assets/tools/<슬러그>.js" defer></script>
  ```
  두 줄을 빈 줄 없이 붙여 넣는다.
- 계산 기준값(세율, 요금, 날짜)은 도구 파일 맨 위 상수로 모으고 출처를 주석으로 단다. 다음 해 갱신이 쉬워진다.
- 도구가 의미 없는 주제(예: 개별 날짜 데이터가 없음)라면 체크리스트·D-day 처럼 단순하지만 실제로 쓸 수 있는 도구로 대신한다.

## 4. 검증

```bash
node --check public/assets/tools/<슬러그>.js
node scripts/build.mjs
```

- 빌드가 실패하거나 이 글에 대한 SEO 경고(제목·설명 길이, 죽은 링크)가 나오면 고친다. 못 고치면 커밋하지 않고 보고한다.
- 도구의 계산 로직은 본문의 계산 예시와 같은 값이 나오는지 손으로 대조한다. 예시 2개 이상을 본문에 넣는다.

## 5. 기록과 배포

1. `data/page-queue.json`: 해당 후보 `status` 를 `"done"`, `log` 에 날짜·URL.
2. `content_calendar.md`: 표에 한 줄 추가 (키워드, 피크, 발행일, URL, 갱신 예정, 메모).
3. `data/seasonal-updates.json`: 다음 갱신 작업 추가 (올해 값 발표 반영, 내년 갱신 등). `what` 은 이 글만 보고 실행할 수 있게 구체적으로.
4. 커밋 `content: 시즌 페이지 — <제목>` 후 `git push origin main`. 거절되면 `git pull --rebase origin main` 후 한 번만 재시도. force push 금지.

## 6. 대기열 보충

`open` 후보가 3개 미만이면, 앞으로 4~16주 안에 검색이 몰릴 **날짜가 정해진 생활·제도·행사 주제**를 웹 검색으로 찾아 후보를 추가한다.

- 형식은 기존 항목과 같게. `radar` 에는 `"검색량 미확인 (루틴 추가)"` 라고 쓴다. 검색량은 사람이 로컬 탐지기(`tools/keyword_radar`)로 나중에 채운다.
- 이미 있는 글·후보와 겹치지 않게 하고, 실제로 쓸모 있는 도구 아이디어가 있는 주제만 넣는다.

## 7. 보고

한 줄씩: 발행한 글 제목과 URL (또는 발행 안 한 이유) / 건너뛰거나 막힌 후보와 사유 / 빌드 결과·커밋 해시 / 남은 open 후보 수 / 사람이 확인할 것.
