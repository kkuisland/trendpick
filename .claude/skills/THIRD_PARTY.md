# 외부에서 가져온 스킬

| 스킬 | 출처 | 가져온 커밋 | 라이선스 |
|---|---|---|---|
| `free-tools` | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) `skills/free-tools` | `55ff469422c3592dac45bcad08dfb40221981c02` (2026-10-15) | MIT (각 폴더 `LICENSE`) |
| `programmatic-seo` | 같은 저장소 `skills/programmatic-seo` | 같음 | MIT |
| `schema` | 같은 저장소 `skills/schema` | 같음 | MIT |
| `site-architecture` | 같은 저장소 `skills/site-architecture` | 같음 | MIT |

**고른 이유:** 별 5.4만 개·MIT·매일 관리되는 저장소. 케이트렌드의 「도구 + 시즌 선점 + 허브 구조 + 공공데이터 페이지」 방향과 직접 맞는 네 개만 골랐다.
`seo-audit` 는 이미 설치된 marketing 플러그인에 같은 것이 있고, `ai-seo`·`content-strategy` 는 분량에 비해 겹치는 부분이 많아 뺐다.

**뺀 파일:** `programmatic-seo/references/implementation-platforms.md`, `site-architecture/references/platforms-and-migration.md` —
CMS·호스팅 선택 안내로, 저장소의 후원(「Verified Partner」) 제품을 소개하는 내용이 들어 있다. 이 사이트는 자작 생성기를 쓰므로 필요 없다. SKILL.md 에 그 파일로 가는 링크가 남아 있지만 없어도 동작한다.
`evals/` 폴더(스킬 평가용 데이터)도 가져오지 않았다.

**검토:** 가져올 때 전문을 읽었다. 실행 코드·외부 다운로드·키 요구·숨은 지시는 없었다. 업데이트할 때도 같은 방식으로 새 커밋을 읽고 바꾼다 — 자동으로 받아 오지 않는다.

**이 사이트와 맞지 않는 부분:** 리드 수집(이메일 게이팅), SaaS 가정. 사이트 사정은 `.claude/product-marketing.md` 에 요약해 두었다(스킬이 처음에 읽는 파일).
