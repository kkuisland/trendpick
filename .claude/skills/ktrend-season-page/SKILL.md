---
name: ktrend-season-page
description: 케이트렌드의 시즌 선점 페이지(계산기·판별기·D-day 도구가 들어간 글)를 새로 만드는 절차. docs/NEW-PAGE.md 를 따르고, 대화형 세션에서는 브라우저로 도구를 직접 확인한다. Use when asked to make a new season page, a calculator/D-day/checklist tool page, "시즌 페이지", "선점 페이지", "계산기 만들어", or to work the next item in data/page-queue.json.
---

# 시즌 선점 페이지 만들기

**기준 문서는 `docs/NEW-PAGE.md` 하나다.** 클라우드 루틴도 같은 문서를 따르므로, 절차를 바꿀 일이 있으면 이 스킬이 아니라 그 문서를 고친다.
시작 전에 `CLAUDE.md` 3절(콘텐츠 원칙)·4절(페이지 구조)·6절(광고 배치)을 읽는다.

## 순서

1. **주제 고르기** — `data/page-queue.json` 의 `open` 후보, 또는 사장님이 정한 주제. 같은 주제 글이 이미 있으면 새로 만들지 않고 기존 URL 을 갱신한다(`ktrend-seasonal-update`).
2. **사실 확인** — `ktrend-fact-check` 스킬의 기준대로 공식 출처를 직접 연다. 도구의 계산 기준값(세율·요금·날짜·금액)을 확인 못 하면 만들지 않는다.
3. **도구** — `public/assets/tools/<슬러그>.js`. 외부 의존성 없이, 기준값은 파일 맨 위 상수 + 출처 주석. 기존 도구 하나를 먼저 읽고 같은 CSS 클래스(`calc-*`)를 쓴다.
   - 도구를 기획할 때는 `free-tools` 스킬의 평가표(검색 수요·독창성·유지보수 부담)를 참고한다. 단, 이 사이트는 광고 수익 모델이라 **이메일 수집·게이팅은 하지 않는다.**
4. **글** — `content/posts/<슬러그>.md`. 답 먼저 → `{{toc}}` → 도구 → 표 → `{{ad}}` → 단계별 방법 → FAQ → 「출처와 업데이트 이력」(공식 링크, **최종 확인일**).
   - `{{ad}}` 를 도구 바로 위아래에 두지 않는다(실수 클릭은 정책 위반).
   - 본문 계산 예시 2개 이상이 도구 결과와 같은지 손으로 대조한다.
   - 프런트매터에 `tool`(짧은 이름)·`deadline`(확인한 핵심 날짜)·`deadlineLabel` 을 넣어 첫 화면 「계산기·판별기」 D-day 목록에 오르게 한다(NEW-PAGE.md 3절).
5. **검증**
   ```bash
   node --check public/assets/tools/<슬러그>.js
   node scripts/build.mjs --strict
   ```
   대화형 세션이면 미리보기 서버(`.claude/launch.json` 의 `site`, 포트 4173)로 글을 열어 **휴대폰 폭(375)과 데스크톱(1280)** 에서 도구를 직접 눌러 본다. 입력 → 결과가 본문 예시와 같은지, 가로 스크롤이 없는지.
6. **기록** — `data/page-queue.json`(status `done`), `content_calendar.md`(한 줄 추가), `data/seasonal-updates.json`(다음 갱신 작업). NEW-PAGE.md 5절 형식 그대로.
7. **커밋** — `content: 시즌 페이지 — <제목>`. 메시지는 파일로(`git commit -F`) — PowerShell 이 한글을 깨뜨린다.
8. **배포** — 사장님이 「배포」라고 하면 `ktrend-deploy`. (클라우드 루틴은 NEW-PAGE.md 대로 바로 푸시한다.)

## 참고

- 구조화 데이터를 손볼 때는 `schema` 스킬. 2026-05 부터 구글은 FAQ 리치 결과를 보여 주지 않는다 — FAQPage 는 의미 표시로만 남기고, 리치 결과를 기대하고 새로 늘리지 않는다.
- 지역×항목처럼 같은 틀로 여러 페이지를 찍어 낼 때는(3단계 공공데이터) `programmatic-seo` 스킬. 데이터가 빈 페이지는 만들지 않는다.
