---
name: ktrend-health-check
description: 케이트렌드(ktrend.kr)·AI Wave(aiwave.kr) 두 사이트 건강검진 — scripts/health-check.mjs 실행과 결과 해석, 고칠 것과 보고할 것 나누기. Use when asked "사이트 괜찮아?", "건강검진", "점검해줘", "사이트 확인", "깨진 링크", "ads.txt 확인", or when a routine report says something failed.
---

# 사이트 건강검진

**기준 문서는 `docs/HEALTH-CHECK.md`.** 점검 대상은 `config/health-check.json`.

```bash
node scripts/health-check.mjs              # 매일 점검 (약 15초)
node scripts/health-check.mjs --external   # 본문의 공식 출처 링크까지 (주 1회)
```

종료 코드: `0` 이상 없음 · `1` 주의만 · `2` 문제 있음. **읽기만 한다** — 사이트·저장소를 바꾸지 않는다.

## 결과 읽는 법

- **「ℹ️ 확인 못 함」은 문제가 아니다.** 클라우드 샌드박스의 프록시가 막은 주소다(ktrend.kr·IndexNow 로 나가는 길도 막혀 있다). 사장님 PC 나 브라우저에서 다시 확인한다.
- 루틴 보고의 「라이브 확인 불가(000)」도 같은 이유다. 사이트 장애로 판단하기 전에 로컬에서 `curl -I https://ktrend.kr/` 로 본다.
- 공식 출처 링크가 깨졌으면(`--external`) 해당 글의 출처를 새 주소로 바꾸고 최종 확인일을 갱신한다(`ktrend-fact-check`).
- `ads.txt` 는 내용이 `google.com, pub-9309182113322928, DIRECT, f08c47fec0942fa0` 한 줄이어야 한다. 애드센스 화면의 「찾을 수 없음」은 사이트 추가 직후 며칠은 정상이다.

## 보고

문제(🔴)·주의(🟡)만 한국어로 짧게: 무엇이, 어느 주소에서, 사장님이 할 일인지 제가 고칠 일인지.
고칠 일은 고친 뒤 `ktrend-deploy` 는 사장님 「배포」 지시를 기다린다.
