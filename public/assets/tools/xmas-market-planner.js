// 잠실 크리스마스 마켓 방문 플래너 — content/posts/jamsil-christmas-market-2026.md 의 <div id="xmas-planner"> 에 렌더링
// 2025년 운영 기준값. 2026년 공지가 나오면 PRICES·SHOWS 를 갱신한다.
(() => {
  const root = document.getElementById('xmas-planner');
  if (!root) return;

  const NIGHT_FROM = 16 * 60; // 오후 4시부터 유료(나이트) 입장
  const PRICES = { day: 0, night: 5000, fast: 10000 };
  const SHOWS = [
    { name: '스노우 샤워', times: ['13:00', '15:00', '17:30', '19:00', '20:30'] },
    { name: '하트 라이트쇼', times: ['17:30', '19:00', '20:30'] },
  ];
  const OPEN = 11 * 60 + 30;
  const CLOSE = 22 * 60;

  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const toText = (min) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h < 12 ? '오전' : '오후'} ${h > 12 ? h - 12 : h}시${m ? ` ${m}분` : ''}`;
  };
  const won = (n) => (n ? n.toLocaleString('ko-KR') + '원' : '무료');

  const slots = [];
  for (let t = OPEN; t <= CLOSE - 60; t += 30) slots.push(t);

  root.innerHTML = `
<p class="calc-help">입장 시간과 인원을 고르면 필요한 입장권과 비용, 입장 후 볼 수 있는 공연 시간을 알려드립니다. <strong>2025년 운영 기준</strong>이며 올해 공지가 나오면 갱신합니다.</p>
<div class="calc-grid">
  <label>입장 시간<select id="xp-time">${slots.map((t) => `<option value="${t}"${t === 15 * 60 ? ' selected' : ''}>${toText(t)}</option>`).join('')}</select></label>
  <label>인원<input id="xp-people" type="number" inputmode="numeric" min="1" max="20" value="2"></label>
  <label>입장권<select id="xp-ticket">
    <option value="normal">일반 입장권</option>
    <option value="fast">패스트패스 (줄 없이 입장)</option>
  </select></label>
</div>
<output class="calc-result" id="xp-out" aria-live="polite"></output>`;

  const $ = (sel) => root.querySelector(sel);
  const calc = () => {
    const t = Number($('#xp-time').value);
    const people = Math.max(1, Math.min(20, Number($('#xp-people').value) || 1));
    const fast = $('#xp-ticket').value === 'fast';
    const kind = fast ? '패스트패스' : t < NIGHT_FROM ? 'DAY 입장권 (오후 4시 전)' : 'NIGHT 입장권 (오후 4시 이후)';
    const unit = fast ? PRICES.fast : t < NIGHT_FROM ? PRICES.day : PRICES.night;

    const lines = [
      `입장권: <strong>${kind}</strong> · 1인 ${won(unit)} × ${people}명 = <strong class="calc-grade">${won(unit * people)}</strong>`,
    ];
    for (const show of SHOWS) {
      const next = show.times.filter((s) => toMin(s) >= t);
      lines.push(`${show.name}: ${next.length ? next.map((s) => toText(toMin(s))).join(', ') : '입장 후 남은 회차 없음'}`);
    }
    if (!fast && t < NIGHT_FROM && NIGHT_FROM - t <= 60) {
      lines.push('<small>오후 4시 전 무료 입장 시간대입니다. 무료 입장권도 네이버 예약이 필요할 수 있으니 공지를 확인하세요.</small>');
    }
    if (!fast && t >= NIGHT_FROM && t <= 18 * 60) {
      lines.push(`<small>오후 4시 전에 입장하면 같은 인원이 ${won(PRICES.night * people)} 아낄 수 있습니다.</small>`);
    }
    lines.push('<small>2층 회전목마: 입장객 1인 1회 무료 (낮 12시~밤 10시, 2025년 기준)</small>');
    $('#xp-out').innerHTML = lines.join('<br>');
    $('#xp-out').dataset.state = 'ok';
  };
  root.querySelectorAll('select, input').forEach((el) => {
    el.addEventListener('change', calc);
    el.addEventListener('input', calc);
  });
  calc();
})();
