// 동파 방지 열선 전기요금 계산기 — content/posts/pipe-heating-cable-cost.md 의 <div id="heating-cable-calc"> 에 렌더링
// 기준(2026-10-05 확인):
//  - 주택용 전력 저압·고압 기타계절(1.1~6.30, 9.1~12.31) 누진 요금, 적용일자 2023-11-09 — 한전 전기요금표(CYEEHP00101)
//  - 슈퍼유저: 동계(12월~2월) 1,000kWh 초과분 저압 736.2원 / 고압 593.3원 — 같은 표
//  - 기후환경요금 9.0원/kWh (2023-01-01~) — 한전 전기공급약관 별표7
//  - 연료비조정요금 +5.0원/kWh (2026년 4분기, 2026-10~12월분) — 한전 연료비조정단가 공지
//  - 부가가치세 10%, 전력산업기반기금 2.7%(2025-07~) — 정책브리핑. 끝자리 처리(부가세 반올림, 기금·청구액 10원 미만 절사)는 한전 요금 계산 관행을 따른 추정
// 해마다(분기마다) 바꿀 것: FUEL(연료비조정단가), 요금 개편 시 RATES·CLIMATE·FUND.
(() => {
  const root = document.getElementById('heating-cable-calc');
  if (!root) return;

  // [구간 상한 kWh, 기본요금(원/호), 전력량요금(원/kWh)] — 기타계절(동계 포함)
  const RATES = {
    low: [[200, 910, 120.0], [400, 1600, 214.6], [Infinity, 7300, 307.3]],
    high: [[200, 730, 105.0], [400, 1260, 174.0], [Infinity, 6060, 242.3]],
  };
  const SUPER = { low: 736.2, high: 593.3 }; // 동계 1,000kWh 초과분
  const SUPER_FROM = 1000;
  const CLIMATE = 9.0; // 원/kWh
  const FUEL = 5.0; // 원/kWh, 2026년 4분기
  const VAT = 0.1;
  const FUND = 0.027;

  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const num = (el) => (el.value.trim() === '' ? NaN : Number(el.value.replace(/,/g, '')));

  // 한 달 사용량(kWh, 정수)으로 청구 예상액 계산
  const bill = (kwh, type, winter) => {
    const tiers = RATES[type];
    const tier = tiers.find(([max]) => kwh <= max);
    let energy = 0;
    let prev = 0;
    for (const [max, , price] of tiers) {
      const part = Math.min(kwh, max) - prev;
      if (part <= 0) break;
      energy += part * price;
      prev = max;
    }
    if (winter && kwh > SUPER_FROM) {
      // 1,000kWh 초과분은 3단계 단가 대신 슈퍼유저 단가
      energy += (kwh - SUPER_FROM) * (SUPER[type] - tiers[2][2]);
    }
    const base = tier[1];
    const subtotal = base + Math.floor(energy) + Math.floor(kwh * CLIMATE) + Math.floor(kwh * FUEL);
    const vat = Math.round(subtotal * VAT);
    const fund = Math.floor((subtotal * FUND) / 10) * 10;
    return { total: Math.floor((subtotal + vat + fund) / 10) * 10, step: tiers.indexOf(tier) + 1 };
  };

  root.innerHTML = `
<p class="calc-help">전기요금 고지서의 <strong>한 달 사용량(kWh)</strong>과 열선 포장·라벨에 적힌 <strong>소비전력(W)</strong>을 넣으세요. 열선을 켜기 전후의 전기요금을 비교합니다.</p>
<div class="calc-grid">
  <label>계약 종류<select id="hc-type">
    <option value="low">주택용 저압 (단독·다세대·대부분의 가정)</option>
    <option value="high">주택용 고압 (일부 아파트)</option>
  </select></label>
  <label>계산할 달<select id="hc-season">
    <option value="winter">12월~2월 (동계)</option>
    <option value="other">11월·3월</option>
  </select></label>
  <label>평소 한 달 사용량 (kWh)<input id="hc-usage" type="number" inputmode="numeric" min="0" step="1" value="300"></label>
  <label>열선 소비전력 (W)<input id="hc-watt" type="number" inputmode="numeric" min="0" step="1" value="100"></label>
  <label>하루 켜 두는 시간<input id="hc-hours" type="number" inputmode="decimal" min="0" max="24" step="0.5" value="24"></label>
  <label>한 달 사용 일수<input id="hc-days" type="number" inputmode="numeric" min="0" max="31" step="1" value="31"></label>
</div>
<output class="calc-result" id="hc-out" aria-live="polite"></output>`;

  const $ = (s) => root.querySelector(s);
  const out = $('#hc-out');

  const render = () => {
    const type = $('#hc-type').value;
    const winter = $('#hc-season').value === 'winter';
    const usage = num($('#hc-usage'));
    const watt = num($('#hc-watt'));
    const hours = num($('#hc-hours'));
    const days = num($('#hc-days'));
    if ([usage, watt, hours, days].some((v) => Number.isNaN(v) || v < 0) || hours > 24 || days > 31) {
      out.dataset.state = '';
      out.textContent = '사용량·소비전력·시간·일수를 올바르게 입력하세요. (하루 24시간, 한 달 31일 이내)';
      return;
    }
    const added = Math.round((watt * hours * days) / 1000);
    const before = bill(Math.round(usage), type, winter);
    const after = bill(Math.round(usage) + added, type, winter);
    const extra = after.total - before.total;
    const perKwh = added > 0 ? extra / added : 0;

    const lines = [
      `<strong class="calc-grade">한 달 약 ${won(extra)} 더 나옵니다</strong>`,
      `열선 사용량: ${watt.toLocaleString('ko-KR')}W × ${hours}시간 × ${days}일 = <strong>약 ${added.toLocaleString('ko-KR')}kWh</strong>`,
      `전기요금: ${won(before.total)} (${Math.round(usage).toLocaleString('ko-KR')}kWh, ${before.step}단계) → <strong>${won(after.total)}</strong> (${(Math.round(usage) + added).toLocaleString('ko-KR')}kWh, ${after.step}단계)`,
    ];
    if (added > 0) lines.push(`늘어난 1kWh당 약 ${Math.round(perKwh).toLocaleString('ko-KR')}원꼴입니다.`);
    let state = 'ok';
    if (after.step > before.step) {
      state = 'warn';
      lines.push(`열선 때문에 누진 <strong>${before.step}단계 → ${after.step}단계</strong>로 올라가 기본요금도 바뀝니다.`);
    }
    if (winter && Math.round(usage) + added > SUPER_FROM) {
      state = 'bad';
      lines.push(`동계 1,000kWh를 넘어 초과분에 <strong>슈퍼유저 요금</strong>이 붙습니다.`);
    }
    if (hours >= 24) lines.push('온도 감지형(자동 온도조절) 열선은 추울 때만 작동해 실제 사용 시간이 이보다 짧습니다. 하루 시간을 줄여 비교해 보세요.');
    lines.push('<small>※ 2026년 4분기 요금 기준 추정치입니다. 복지할인·대가족할인, 아파트 단일계약(관리비로 나눠 내는 방식)은 반영하지 않았습니다.</small>');
    out.dataset.state = state;
    out.innerHTML = lines.join('<br>');
  };

  root.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  render();
})();
