---
name: ktrend-deploy
description: 케이트렌드(ktrend.kr) 배포 표준 절차. 사장님이 「배포」라고 하면 묻지 않고 이 순서로 진행한다 — 최신 main 합치기, 엄격 빌드(죽은 링크 0), main 푸시, Railway 반영 후 라이브 확인, 색인. Use when the owner says "배포", "올려줘", "deploy", "push to main", or after finishing a change that should go live on ktrend.kr.
---

# 케이트렌드 배포

`main` 에 푸시하면 Railway 가 자동 배포한다(1~2분). **푸시가 곧 배포**이므로 사장님이 「배포」라고 했을 때만 한다.
클라우드 루틴이 매일 main 에 커밋하므로 로컬은 늘 뒤처져 있다고 가정한다.

## 순서

1. **최신 main 받기**
   ```bash
   git fetch origin
   git status --short          # 커밋 안 한 변경이 있으면 먼저 커밋하거나 사장님께 묻는다
   git merge --no-edit origin/main   # 워크트리라면 앱의 sync_with_base_branch 를 먼저 시도
   ```
   충돌이 나면 해결하고 무엇을 어떻게 합쳤는지 보고에 적는다.

2. **엄격 빌드** — 실패하면 푸시하지 않는다.
   ```bash
   node scripts/build.mjs --strict
   ```
   - 「죽은 내부 링크」가 1건이라도 있으면 고친다. 검수 대기(`draft: true`) 글을 가리키는 링크가 흔한 원인이다.
   - 새로 생긴 SEO 경고(제목·설명 길이 등)는 고친다. 이미 알려진 경고(GTM+GA4 안내 등)는 그대로 둔다.
   - 도구 JS 를 고쳤다면 `node --check public/assets/tools/<파일>.js`.

3. **푸시** — 직전에 한 번 더 `git fetch`.
   ```bash
   git push origin HEAD:main
   ```
   거절되면 `git pull --rebase origin main` 후 **한 번만** 재시도. `--force` 는 쓰지 않는다.

4. **라이브 확인** — Railway 반영까지 1~2분. 바뀐 내용이 보일 때까지 짧게 확인한다(긴 sleep 대신 Monitor 의 until 루프).
   ```bash
   for p in / /sitemap.xml /ads.txt /admin/ /en/; do curl -s -o /dev/null -w "$p %{http_code}\n" https://ktrend.kr$p; done
   ```
   이번에 바뀐 글·도구 주소도 200 인지, 바뀐 문구가 실제로 나오는지(`curl … | grep`) 본다.

5. **색인** — 사장님 PC 예약 작업 「KTrend IndexNow」가 매일 09:00 에 최근 3일 바뀐 주소를 보낸다(`scripts/daily-index.cmd`, 기록은 `logs/`).
   새 글을 바로 알리고 싶으면: `node scripts/indexnow.mjs https://ktrend.kr/posts/<슬러그>/`

## 보고 (한국어, 짧게)

- 배포한 커밋 범위(`이전..이후`)와 무엇이 올라갔는지
- 빌드 결과(경고 수, 죽은 링크 0)
- 라이브 확인 결과
- 사장님이 할 일이 있으면 그것만

## 하지 않는 것

- 「배포」 지시 없이 main 에 푸시
- 빌드 실패·죽은 링크가 있는 상태로 푸시
- 토큰·키를 대화창이나 저장소에 넣기 (Railway 변수는 사장님이 직접)
