# 트렌드픽 (TrendPick)

트렌드·이슈 정보를 **수집 → 기획 → 발행 → 수익화**로 회전시키는 자동화 콘텐츠 사이트입니다.

```
┌─ 매일 자동 실행 (GitHub Actions 또는 수동) ─────────────────────────┐
│                                                                      │
│  ① 수집 collect      구글 트렌드 실검 + 뉴스 헤드라인 (+네이버 API) │
│  ② 기획 plan         이벤트 캘린더 D-Day + 트렌드 → 오늘 쓸 주제    │
│  ③ 초안 new          Claude API로 SEO 최적화 글 자동 생성           │
│  ④ 빌드 build        SEO 완비 정적 사이트 생성 (dist/)              │
│  ⑤ 배포 + IndexNow   GitHub Pages 배포 + 검색엔진 즉시 색인 핑      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

수익원: 구글 애드센스 · 카카오 애드핏 · 쿠팡 파트너스 · 트립닷컴 (설정에서 켜면 자동 삽입).

- **[docs/AFFILIATE.md](docs/AFFILIATE.md)** — 쿠팡·트립닷컴 링크 연결 방법 (`{{aff}}` 중앙 관리)
- **[docs/MONETIZE.md](docs/MONETIZE.md)** — 단계별 수익화 절차
- **[docs/STRATEGY.md](docs/STRATEGY.md)** — 경쟁 사이트와 차별화 전략

## 빠른 시작

```bash
npm install
```

```bash
npm run build
```

```bash
npm run serve
```

→ http://localhost:4173 에서 사이트 확인. (외부 의존성은 초안 자동 생성용 `@anthropic-ai/sdk` 하나뿐이며, 수집·빌드·서빙은 의존성 없이 Node 18+만으로 동작합니다.)

## 일일 운영 루틴

### A. 반자동 (권장 시작 방식 — 하루 10~20분)

```bash
npm run collect
```

```bash
npm run plan
```

→ `data/plan/오늘날짜.md` 리포트에서 추천 주제와 실행 명령을 확인한 뒤:

```bash
npm run new -- "주제" --category "카테고리" --event 이벤트키
```

→ 생성된 초안(`draft: true`)의 **날짜·수치·[확인 필요] 표시를 검토**하고 `draft: false`로 변경 →

```bash
npm run build
```

→ git push (Actions가 배포).

### B. 완전 자동 (검증 후 전환)

`config/site.config.json`에서:

```json
"automation": { "autoGenerate": true, "autoPublish": true, "maxPostsPerDay": 2 }
```

GitHub 저장소 Secrets에 `ANTHROPIC_API_KEY` 등록 → 매일 아침 7시(KST) Actions가 수집→생성→발행→배포까지 무인 실행합니다.

> ⚠️ 완전 자동은 반자동으로 2~4주 운영하며 생성 품질을 확인한 뒤 켜는 것을 권장합니다. 검수 없는 대량 발행은 구글 스팸 정책(확장 콘텐츠 남용) 위험이 있습니다. 자세한 내용은 아래 "주의사항".

## 명령어 레퍼런스

| 명령 | 역할 |
|---|---|
| `npm run collect` | 구글 트렌드 실검 + 뉴스 수집 → `data/trends/` |
| `npm run plan` | 이벤트 D-Day + 트렌드 분석 → 오늘의 추천 주제 리포트 |
| `npm run new -- "주제" [옵션]` | SEO 초안 생성. 옵션: `--category` `--event` `--keywords` `--slug` `--publish` `--locale en` |
| `npm run auto` | **자동 루틴**: 수집→선별→생성→빌드 (하루 3회 Actions가 실행) |
| `npm run auto -- --dry --force` | 자동 루틴 시뮬레이션 (파일 생성 없이 어떤 주제를 고르는지 확인) |
| `npm run build` | 정적 사이트 빌드 (`--drafts`로 초안 포함 미리보기) |
| `npm run serve` | 로컬 미리보기 (포트 4173) |
| `npm run pipeline` | 수집→기획→생성→빌드 일괄 (수동용) |
| `npm run indexnow` | 발행 URL을 검색엔진에 즉시 색인 요청 |

## 자동 발행 루틴 (하루 3회)

`.github/workflows/auto.yml`이 **KST 07:00 / 12:30 / 19:00** 세 번 실행됩니다.

| 회차 | 시각(KST) | 노림수 | 언어 |
|---|---|---|---|
| 아침 | 07:00 | 밤사이 이슈 + 이벤트 D-Day 선점 | 한국어 |
| 점심 | 12:30 | 오전 발생 이슈 (검색 피크 직전) | 한국어 |
| 저녁 | 19:00 | 하루 결산 + 글로벌 콘텐츠 | 영어 |

**발행량은 "회당 1개, 하루 최대 3개"가 기본값**입니다 (`config/site.config.json` → `automation`). 카테고리가 많다고 글 수를 늘리는 건 역효과입니다 — 구글은 검수 없는 대량 AI 콘텐츠를 스팸으로 강등하며, 초기 사이트일수록 위험이 큽니다. 하루 2~3개를 6개월 지속하면 400~500개가 쌓입니다.

### 3중 안전장치

1. **일일/회당 한도** — `maxPostsPerDay`(3), `maxPostsPerRun`(1). 오늘 날짜의 글 파일을 직접 세므로 3회 실행돼도, 사람이 직접 글을 써도 총량을 넘지 않습니다.
2. **중복 방지** — 기존 글과 대조해 이미 다룬 주제·이벤트는 후보에서 제외합니다.
3. **점수 하한** — `minScore`(55) 미달이면 **아무것도 쓰지 않습니다.** "쓸 게 없으면 안 쓴다"가 정상 동작입니다.

### 민감 주제 자동 제외

재난·인명 피해, 범죄·수사·재판, 부고, 의료, 국내 정치, 투자 종목, 개인 사생활·논란 키워드는 **자동 생성에서 제외**됩니다 (`scripts/plan.mjs`의 `BLOCKED_PATTERNS`). 기획 리포트에는 🚫 표시와 함께 계속 보이므로, 필요하면 사람이 직접 사실 확인 후 작성하면 됩니다.

### 켜는 방법

```bash
gh secret set ANTHROPIC_API_KEY --repo kkuisland/trendpick
```

그 다음 `config/site.config.json`에서 `automation.autoGenerate: true` (초안만 생성), 품질을 2~4주 확인한 뒤 `autoPublish: true` (자동 발행)로 전환하세요.

## 다국어 (한국어 + English)

| 로케일 | 경로 | 콘텐츠 위치 | 대상 |
|---|---|---|---|
| 한국어 | `/` | `content/posts/`, `content/pages/` | 국내 검색 (네이버·구글) |
| English | `/en/` | `content/en/posts/`, `content/en/pages/` | 해외 검색 (구글) |

- 카테고리·UI 문자열은 `config/site.config.json`의 `i18n.en`과 `scripts/lib/i18n.mjs`에서 관리
- `hreflang`으로 두 버전이 상호 연결되고, 헤더의 언어 전환 버튼이 자동 생성됩니다
- 프런트매터에 같은 `trKey`를 넣으면 **번역본끼리 직접 연결**됩니다 (없으면 상대 언어 홈으로)
- 영문 글은 기계 번역이 아니라 **해외 독자 기준으로 따로 작성**합니다 — 한국인이 궁금한 추석 정보와 외국인이 궁금한 추석 정보는 다르기 때문입니다
- 캘린더는 `data/events.json`에 `nameEn`이 있는 이벤트만 영문에 노출됩니다

## 글 파일 형식

`content/posts/슬러그.md` — 슬러그는 영문 소문자·하이픈 (URL이 됨).

```markdown
---
title: 32자 내외, 핵심 키워드 앞배치
description: 70~110자, 검색결과에 노출될 요약
date: 2026-08-20
updated: 2026-08-25        ← 글을 갱신하면 이 날짜만 바꿔주세요 (회전 전략)
category: 생활 정보         ← config의 categories 중 하나
tags: [태그1, 태그2]
keywords: [노리는 검색어1, 검색어2]
event: chuseok-2026        ← (선택) data/events.json의 키 → D-Day 카드 연동
draft: false               ← true면 빌드에서 제외
---

핵심 답변 3~4문장 (서론 없이 바로).

::event chuseok-2026       ← 이벤트 D-Day 카드
{{toc}}                    ← 목차 자동 생성
{{ad}}                     ← 광고 슬롯 (설정에서 켜면 렌더링)
{{aff 링크키}}              ← 제휴 링크 (data/affiliates.json 에서 관리, 고지 자동)
{{coupang}}                ← 쿠팡 다이내믹 배너 (자동 상품 추천 위젯)

::faq                      ← FAQ 블록 (FAQPage 구조화 데이터 자동 생성)
Q: 질문?
A: 답변.
::
```

빌드 시 SEO 린트가 제목 길이, description 길이, FAQ 유무를 자동 점검해 경고합니다.

## 설정 (`config/site.config.json`)

| 항목 | 설명 |
|---|---|
| `site.url` | **가장 먼저 실제 도메인으로 변경** (canonical, sitemap의 기준) |
| `site.name/tagline/description` | 사이트 브랜딩 |
| `verification.google/naver` | 서치콘솔·서치어드바이저 소유 확인 메타태그 값 |
| `analytics.ga4` | GA4 측정 ID (G-XXXX) |
| `monetization.adsense` | 승인 후 `enabled: true` + `client`(ca-pub-…) → 광고·ads.txt 자동 |
| `monetization.adfit` | 애드핏 유닛 ID (PC/모바일) |
| `monetization.coupang` | 쿠팡 파트너스 (dynamicBannerId 또는 글 안에서 url 지정) |
| `apis.anthropic.model` | 초안 생성 모델 (기본 claude-opus-5) |
| `apis.naver` | 네이버 개발자센터 앱 키 → 수집 시 네이버 뉴스 보강 |
| `apis.indexnow.key` | 임의의 32자 키 → 즉시 색인 핑 활성화 |
| `automation` | 자동 생성/발행/일일 최대 글 수 |

이벤트 캘린더는 `data/events.json`에서 관리합니다. 새 이벤트(빅매치, 발표회, 제도 시행일 등)를 추가하면 홈 D-Day 스트립·캘린더 페이지·기획 리포트에 자동 반영됩니다.

## 배포 (GitHub Pages — 무료)

1. GitHub에 새 저장소 생성 후 이 폴더를 push (main 브랜치)
2. 저장소 **Settings → Pages → Source: "GitHub Actions"** 선택
3. push하면 `.github/workflows/daily.yml`이 빌드·배포 + 이후 매일 아침 7시(KST) 자동 실행
4. 커스텀 도메인 연결(Settings → Pages → Custom domain) — **애드센스 승인에 사실상 필수** (연 1~2만 원)
5. `config/site.config.json`의 `site.url`을 도메인으로 변경 후 다시 push

Secrets (Settings → Secrets and variables → Actions):

| Secret | 용도 | 필수 여부 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 초안 자동 생성 | 자동 생성 사용 시 |
| `NAVER_CLIENT_ID/SECRET` | 네이버 뉴스 보강 | 선택 |
| `INDEXNOW_KEY` | 즉시 색인 | 선택 (config로도 가능) |

## 주의사항 (수익의 지속성을 지키는 규칙)

1. **사실 검증**: 자동 생성 초안의 날짜·수치·`[확인 필요]` 표시는 발행 전 반드시 확인하세요. 틀린 정보는 신뢰도·순위 하락으로 직결됩니다.
2. **스팸 정책**: 구글은 검수 없는 대량 AI 콘텐츠(확장 콘텐츠 남용)를 스팸으로 강등합니다. 이 사이트의 방어책은 ① 하루 발행량 제한 ② 이벤트 기반의 실제 수요 있는 주제 선정 ③ 표·FAQ·업데이트 등 실질 가치 — 이 구조를 유지하세요.
3. **YMYL 주의**: 주식·투자·건강 주제는 "정보 제공"으로 한정하고 면책 문구를 유지하세요 (경제·머니 카테고리에는 자동 삽입됨). 특정 종목 매수 추천 같은 콘텐츠는 만들지 않습니다.
4. **저작권**: 뉴스 본문·이미지를 그대로 복사하지 않습니다. 수집된 헤드라인은 "주제 파악용"이며, 글은 사실 정보를 자체 정리한 것이어야 합니다.
5. **광고 고지**: 쿠팡 파트너스 수수료 고지 문구는 자동 삽입되며 제거하지 마세요 (법적 의무).
