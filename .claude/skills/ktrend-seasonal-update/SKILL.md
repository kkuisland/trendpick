---
name: ktrend-seasonal-update
description: 이미 있는 케이트렌드 시즌 페이지를 같은 URL 에서 갱신하는 절차 — 올해 값 발표 반영, 다음 해로 연도·금액·일정 바꾸기, 미발표 칸 채우기. docs/SEASONAL-UPDATE.md 와 data/seasonal-updates.json 을 따른다. Use when asked to update/refresh an existing season page, "갱신", "올해 값 반영", "내년으로 바꿔", "연도 바꾸기", or to run today's tasks from data/seasonal-updates.json.
---

# 시즌 페이지 갱신

**기준 문서는 `docs/SEASONAL-UPDATE.md`.** 작업 목록은 `data/seasonal-updates.json`, 페이지별 갱신 시기는 `content_calendar.md`.

## 원칙

- **새 글을 만들지 않고 같은 URL 을 고친다.** 슬러그에 연도가 있어도 주소는 바꾸지 않는다(주소 변경은 사장님께 먼저 묻는다).
- 도구의 기준값은 도구 파일 맨 위 상수에 있다(`content_calendar.md` 메모 칸에 어떤 상수인지 적혀 있다). 본문 표·예시·FAQ 의 같은 숫자도 함께 바꾼다 — 도구와 본문이 다르면 안 된다.
- 바꾼 값은 `ktrend-fact-check` 기준으로 공식 출처를 직접 열어 확인한다. 아직 발표 전이면 바꾸지 않고, 작년 값임을 분명히 적은 채로 둔다.
- 글 끝 「출처와 업데이트 이력」에 날짜와 무엇을 바꿨는지 한 줄, **최종 확인일**을 오늘로. 프런트매터 `updated:` 도 오늘로.
- 프런트매터 `deadline:`(첫 화면 D-day 목록의 날짜)이 있으면 새 해의 날짜로 바꾼다. 그대로 두면 날짜가 지나 「상시」로 내려간다.

## 순서

1. `data/seasonal-updates.json` 에서 오늘 할 작업을 고른다(SEASONAL-UPDATE.md 1절 조건). 없으면 아무것도 바꾸지 않는다 — 정상이다.
2. 공식 출처 확인 → 도구 상수·본문 수정.
3. `node --check public/assets/tools/<파일>.js` · `node scripts/build.mjs --strict`
4. 작업의 `last_checked`·`status`·`log` 갱신, 다음 갱신 작업이 필요하면 추가.
5. 커밋 후, 사장님 「배포」 지시가 있으면 `ktrend-deploy`.
