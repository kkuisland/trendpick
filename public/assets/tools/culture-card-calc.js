// 문화누리카드 사용 마감 D-day 계산기 — content/posts/culture-card-deadline-2026.md 의 <div id="cc-calc"> 에 렌더링
// 기준값 출처: 문화누리카드 누리집(mnuri.kr) 이용기간 "발급일로부터 2026년 12월 31일(목)까지", 2026년 문화누리카드 안내문(기본지원금 15만 원, 청소년기·준고령기 1만 원 추가).
(() => {
  const root = document.getElementById('cc-calc');
  if (!root) return;

  const DEADLINE = { y: 2026, m: 12, d: 31 }; // 이용기간 마지막 날 (이 날까지 사용 가능)
  const BASE = 150000; // 기본지원금
  const EXTRA = 10000; // 청소년기(13~18세)·준고령기(60~64세) 추가지원금

  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const utc = (y, m, d) => Date.UTC(y, m - 1, d);
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  root.innerHTML = `
<p class="calc-help">카드 잔액은 문화누리카드 누리집·앱의 「카드사용내역 및 잔액확인」에서 볼 수 있습니다. 날짜를 바꾸면 그날 기준으로 계산합니다.</p>
<div class="calc-grid">
  <label>남은 잔액 (원)<input id="cc-bal" type="number" inputmode="numeric" min="0" step="1000" placeholder="예: 80000"></label>
  <label>기준 날짜<input id="cc-date" type="date" value="${todayStr}"></label>
</div>
<div class="calc-tabs">
  <button type="button" id="cc-base">기본 15만 원 넣기</button>
  <button type="button" id="cc-extra">추가지원 16만 원 넣기</button>
</div>
<output class="calc-result" id="cc-out" aria-live="polite">잔액을 넣으면 마감까지 하루·주·월 평균 사용 금액이 표시됩니다.</output>`;

  const $ = (sel) => root.querySelector(sel);
  const show = (html, state) => {
    const el = $('#cc-out');
    el.innerHTML = html;
    el.dataset.state = state || '';
  };

  const calc = () => {
    const raw = $('#cc-bal').value.trim();
    const dv = $('#cc-date').value;
    if (raw === '' || !dv) return show('잔액을 넣으면 마감까지 하루·주·월 평균 사용 금액이 표시됩니다.');
    const bal = Number(raw);
    if (!(bal >= 0)) return show('잔액은 0 이상이어야 합니다.', 'warn');
    const [y, m, d] = dv.split('-').map(Number);
    const left = Math.round((utc(DEADLINE.y, DEADLINE.m, DEADLINE.d) - utc(y, m, d)) / DAY); // D-day
    if (left < 0) return show('2026년 이용기간(12월 31일)이 지났습니다. 2027년 지원금은 새로 발급·충전 여부를 누리집에서 확인하세요.', 'bad');
    if (bal === 0) return show('남은 잔액이 없습니다. 기한 안에 다 쓰셨네요.', 'ok');

    const days = left + 1; // 오늘과 마감일 당일을 모두 쓸 수 있는 날
    const perDay = bal / days;
    const label = left === 0 ? '오늘이 마지막 날 (D-day)' : `마감까지 D-${left}`;
    const state = left <= 14 ? 'bad' : left <= 45 ? 'warn' : 'ok';
    const lines = [
      `<strong class="calc-grade">${label}</strong> · 사용 가능한 날 ${days}일(오늘 포함)`,
      `하루 평균 <strong>${won(perDay)}</strong> · 일주일에 약 <strong>${won(perDay * 7)}</strong>`,
    ];
    if (days > 30) lines.push(`한 달(30일)에 약 <strong>${won(perDay * 30)}</strong>`);
    lines.push('<small>※ 공연·영화·도서 등은 한 번에 쓰는 금액이 크니 평균보다 사용 횟수로 나누어 계획하세요. 이용기간이 지나면 카드로 결제할 수 없습니다.</small>');
    show(lines.join('<br>'), state);
  };

  $('#cc-base').addEventListener('click', () => { $('#cc-bal').value = BASE; calc(); });
  $('#cc-extra').addEventListener('click', () => { $('#cc-bal').value = BASE + EXTRA; calc(); });
  root.querySelectorAll('input').forEach((el) => {
    el.addEventListener('change', calc);
    el.addEventListener('input', calc);
  });
  calc();
})();
