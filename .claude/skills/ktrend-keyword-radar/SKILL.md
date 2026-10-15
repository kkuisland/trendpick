---
name: ktrend-keyword-radar
description: 키워드 탐지기(tools/keyword_radar/radar.py)로 다가오는 피크 키워드를 찾고, 시즌 페이지 후보를 data/page-queue.json·content_calendar.md 에 올리는 주간 루틴. Use when asked to "탐지기 돌려", "키워드 찾아", "다음 주제 골라", "seeds 갱신", find upcoming peak keywords, or plan which season pages to build next.
---

# 키워드 탐지기 주간 루틴

검색 수요는 있는데 상위 결과가 낡았거나 빈 키워드를, 피크 3~10주 전에 찾는 도구다. CLAUDE.md 7절 「매주」 루틴.

## 준비 (한 번)

- `tools/keyword_radar/.env.example` 를 `.env` 로 복사해 **사장님이 직접** 키를 넣는다. 키를 대화창에 받지 않는다. `.env` 와 `output/` 은 커밋하지 않는다(.gitignore 에 있음).
  - `NAVER_AD_*` — 네이버 검색광고 API → 월 검색수·광고경쟁
  - `NAVER_CLIENT_*` — 네이버 클라우드 API HUB(블로그 검색 + 검색어 트렌드) → 빈자리(새 글 수·상위글 나이)·시즌(피크 월, 피크까지 주)
- 키가 없으면 자동완성 단계만 돌아 점수가 거의 다 같다. 그 결과로 우선순위를 정하지 않는다.
- 클라우드 샌드박스에서는 네이버 API 로 나가는 길이 막힐 수 있다 — **사장님 PC(로컬)에서 돌린다.**

## 실행

```bash
cd tools/keyword_radar
python radar.py --seeds seeds.txt --max 200 --per-seed 20
```

- `--per-seed N`: 씨앗마다 상위 N개만 — 씨앗이 많을 때 앞쪽 씨앗이 자리를 다 차지하지 않게 한다. 씨앗이 5개 이상이면 꼭 쓴다.
- `--related N`: 검색광고 연관 키워드 중 검색량 상위 N개 추가(기본 5).
- 결과: `output/radar_<날짜>.csv` · `.html` (상위 10개 노란색).

## 고르는 기준

1. 기회점수 상위이면서 **피크까지 3~10주**.
2. 날짜가 정해진 생활·제도·시험·행사 주제(CLAUDE.md 1절). 연예·사건·정치·종목은 제외.
3. **AI 요약이 대신 못 하는 도구**(계산기·판별기·D-day·체크리스트)를 붙일 수 있다.
4. 이미 있는 글·후보와 겹치지 않는다 — 겹치면 기존 URL 갱신 작업으로 돌린다.
5. 핵심 정보를 공식 출처로 확인할 수 있어 보인다.

## 기록

- `data/page-queue.json` 의 `queue` 에 기존 항목과 같은 형식으로 추가: `id`, `title_idea`, `keywords`, `radar`(검색량·피크 근거 한 줄), `peak`(YYYY-MM), `publish_by`(피크 4~8주 전), `tool_idea`, `sources_hint`, `status: "open"`, `log`.
- `content_calendar.md` 는 **발행할 때** 한 줄 추가한다(후보 단계에서는 page-queue 에만).
- 매월: 다음 달 피크 키워드로 `seeds.txt` 갱신.

실제 페이지 제작은 `ktrend-season-page`.
