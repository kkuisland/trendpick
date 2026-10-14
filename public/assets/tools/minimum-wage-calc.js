// 2027 최저임금 월급·주휴수당 계산기 — content/posts/minimum-wage-2027-calc.md 의 <div id="mw-calc"> 에 렌더링
// 기준값 출처: 고용노동부 고시 제2026-60호 「2027년 적용 최저임금 고시」(2026-08-05), 시간급 10,700원, 월 환산액 2,236,300원(주 40시간·월 209시간).
// 주휴수당: 근로기준법 제55조, 시행령 제30조 (주 소정근로 15시간 이상, 개근 시 1주 평균 1일 유급휴일).
(() => {
  const root = document.getElementById('mw-calc');
  if (!root) return;

  const MIN_WAGE = 10700; // 2027년 적용 시간급
  const WEEKS_PER_MONTH = 365 / 7 / 12; // 월 환산 주수
  const FULL_WEEK = 40; // 법정 소정근로 상한 (주)
  const HOLIDAY_MIN = 15; // 주휴수당 발생 최소 주 소정근로시간

  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';

  root.innerHTML = `
<p class="calc-help">세전 금액 기준입니다. 주휴수당은 한 주를 개근했다는 가정이며, 연장·야간·휴일 가산수당은 포함하지 않습니다.</p>
<div class="calc-tabs">
  <button type="button" id="mw-t1" aria-pressed="true">시급 → 월급</button>
  <button type="button" id="mw-t2" aria-pressed="false">월급 → 시급 판별</button>
</div>
<div class="calc-grid">
  <label id="mw-l1">시급 (원)<input id="mw-wage" type="number" inputmode="numeric" min="0" step="10" value="${MIN_WAGE}"></label>
  <label id="mw-l2" hidden>월급 (세전, 원)<input id="mw-sal" type="number" inputmode="numeric" min="0" step="1000" placeholder="예: 2200000"></label>
  <label>주 소정근로시간<input id="mw-hours" type="number" inputmode="decimal" min="1" max="${FULL_WEEK}" step="0.5" value="40"></label>
</div>
<output class="calc-result" id="mw-out" aria-live="polite"></output>`;

  const $ = (sel) => root.querySelector(sel);
  let mode = 1;
  const show = (html, state) => {
    const el = $('#mw-out');
    el.innerHTML = html;
    el.dataset.state = state || '';
  };

  const setMode = (m) => {
    mode = m;
    $('#mw-t1').setAttribute('aria-pressed', String(m === 1));
    $('#mw-t2').setAttribute('aria-pressed', String(m === 2));
    $('#mw-l1').hidden = m !== 1;
    $('#mw-l2').hidden = m !== 2;
    calc();
  };

  const calc = () => {
    const hours = Number($('#mw-hours').value);
    if (!(hours >= 1 && hours <= FULL_WEEK)) return show(`주 소정근로시간은 1~${FULL_WEEK}시간 사이로 넣어 주세요.`, 'warn');
    const holiday = hours >= HOLIDAY_MIN ? (hours / FULL_WEEK) * 8 : 0; // 주휴시간
    const monthHours = Math.round((hours + holiday) * WEEKS_PER_MONTH); // 월 환산시간
    const minMonth = MIN_WAGE * monthHours;
    const holidayNote = holiday > 0
      ? `주휴 ${+holiday.toFixed(1)}시간 포함 월 환산 <strong>${monthHours}시간</strong>`
      : `주 ${HOLIDAY_MIN}시간 미만이라 <strong>주휴수당 없음</strong> · 월 환산 ${monthHours}시간`;

    if (mode === 1) {
      const wage = Number($('#mw-wage').value);
      if (!(wage > 0)) return show('시급을 넣어 주세요.');
      const month = wage * monthHours;
      const ok = wage >= MIN_WAGE;
      const lines = [
        `<strong class="calc-grade">${ok ? '2027년 최저임금 이상' : '2027년 최저임금 미달'}</strong> (기준 ${won(MIN_WAGE)})`,
        `월 환산 임금 <strong>${won(month)}</strong> · ${holidayNote}`,
      ];
      if (holiday > 0) lines.push(`주휴수당 주 ${won(wage * holiday)} (월 환산액에 이미 포함)`);
      lines.push(ok ? `2027년 최저 월 환산액 ${won(minMonth)}보다 ${won(month - minMonth)} 많음` : `시간당 ${won(MIN_WAGE - wage)}, 월 ${won(minMonth - month)} 부족`);
      return show(lines.join('<br>'), ok ? 'ok' : 'bad');
    }

    const sal = Number($('#mw-sal').value);
    if (!(sal > 0)) return show('월급(세전)을 넣으면 시급으로 환산해 최저임금과 비교합니다.');
    const hourly = sal / monthHours;
    const ok = hourly >= MIN_WAGE;
    const lines = [
      `<strong class="calc-grade">${ok ? '2027년 최저임금 이상' : '2027년 최저임금 미달'}</strong> (기준 ${won(MIN_WAGE)})`,
      `환산 시급 <strong>${won(hourly)}</strong> · ${holidayNote}`,
      ok ? `최저 월 환산액 ${won(minMonth)}보다 ${won(sal - minMonth)} 많음` : `최저 월 환산액 ${won(minMonth)}에 ${won(minMonth - sal)} 모자람`,
      '<small>※ 월급에 식대·상여금 등이 섞여 있으면 어떤 항목이 최저임금에 들어가는지 따로 확인하세요(고용노동부).</small>',
    ];
    show(lines.join('<br>'), ok ? 'ok' : 'bad');
  };

  $('#mw-t1').addEventListener('click', () => setMode(1));
  $('#mw-t2').addEventListener('click', () => setMode(2));
  ['#mw-wage', '#mw-sal', '#mw-hours'].forEach((s) => $(s).addEventListener('input', calc));
  calc();
})();
