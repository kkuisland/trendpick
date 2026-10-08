// 연금저축·IRP 세액공제 계산기 — content/posts/pension-tax-credit-2026.md 의 <div id="pension-calc"> 에 렌더링
// 2026년 납입분(현행 세법) 기준. 출처: 소득세법 제59조의3(연금계좌세액공제), 국세청 연금계좌 세액공제 안내(공제 한도 및 공제율 표).
(() => {
  const root = document.getElementById('pension-calc');
  if (!root) return;

  const MAN = 10000;
  const TAX_YEAR = 2026;
  const PENSION_CAP = 600 * MAN; // 연금저축계좌 공제 대상 납입 한도
  const TOTAL_CAP = 900 * MAN; // 연금저축(600만 원 이내) + 퇴직연금(IRP 등) 합산 한도
  const RATE_LOW = 0.15; // 총급여 5,500만 원(종합소득금액 4,500만 원) 이하
  const RATE_HIGH = 0.12; // 초과
  const LOCAL_TAX = 0.1; // 지방소득세 = 세액공제액의 10%
  const LIMIT = { salary: 5500 * MAN, income: 4500 * MAN }; // 공제율 구분 기준 (이하이면 15%)

  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const num = (el) => (el.value.trim() === '' ? NaN : Number(el.value.replace(/,/g, '')));

  root.innerHTML = `
<p class="calc-help">2026년 1월 1일부터 12월 31일까지 이미 넣은 금액(앞으로 넣을 계획 금액 포함)을 적으세요. 단위는 만 원입니다.</p>
<div class="calc-grid">
  <label>소득 유형<select id="pc-kind">
    <option value="salary">근로소득만 있음 (총급여)</option>
    <option value="income">사업·프리랜서 등 (종합소득금액)</option>
  </select></label>
  <label><span id="pc-income-label">총급여 (만 원)</span><input id="pc-income" type="number" inputmode="numeric" min="0" step="100" placeholder="예: 5000"></label>
</div>
<div class="calc-grid">
  <label>연금저축 납입액 (만 원)<input id="pc-pension" type="number" inputmode="numeric" min="0" step="10" placeholder="예: 600"></label>
  <label>IRP·퇴직연금 개인 납입액 (만 원)<input id="pc-irp" type="number" inputmode="numeric" min="0" step="10" placeholder="예: 300"></label>
</div>
<div class="calc-row">
  <label>세액공제 전 산출세액 (만 원, 선택)<input id="pc-tax" type="number" inputmode="numeric" min="0" step="10" placeholder="모르면 비워 두세요"></label>
</div>
<output class="calc-result" id="pc-out" aria-live="polite">소득과 납입액을 넣으면 세액공제 예상액이 표시됩니다.</output>`;

  const $ = (sel) => root.querySelector(sel);
  const show = (html, state) => {
    const el = $('#pc-out');
    el.innerHTML = html;
    el.dataset.state = state || '';
  };

  const calc = () => {
    const kind = $('#pc-kind').value;
    $('#pc-income-label').textContent = kind === 'salary' ? '총급여 (만 원)' : '종합소득금액 (만 원)';
    const income = num($('#pc-income')) * MAN;
    const pension = (num($('#pc-pension')) || 0) * MAN;
    const irp = (num($('#pc-irp')) || 0) * MAN;
    if (Number.isNaN(income)) return show('소득과 납입액을 넣으면 세액공제 예상액이 표시됩니다.');
    if (income < 0 || pension < 0 || irp < 0) return show('금액은 0 이상이어야 합니다.', 'warn');

    const pensionOk = Math.min(pension, PENSION_CAP); // 연금저축은 600만 원까지만 인정
    const eligible = Math.min(pensionOk + irp, TOTAL_CAP); // 합산 900만 원까지만 인정
    const rate = income <= LIMIT[kind] ? RATE_LOW : RATE_HIGH;
    let credit = eligible * rate;

    const taxRaw = $('#pc-tax').value.trim();
    let capNote = '';
    if (taxRaw !== '') {
      const tax = num($('#pc-tax')) * MAN;
      if (tax >= 0 && credit > tax) {
        credit = tax;
        capNote = '<br><small>※ 입력한 산출세액이 공제액보다 적어 산출세액까지만 공제된 것으로 계산했습니다. 세액공제는 낸 세금보다 많이 돌려받을 수 없습니다.</small>';
      }
    }
    const withLocal = credit * (1 + LOCAL_TAX);

    const spare = Math.max(0, TOTAL_CAP - eligible); // 합산 한도까지 남은 금액
    const pensionRoom = Math.max(0, PENSION_CAP - pensionOk); // 연금저축으로 더 넣을 수 있는 금액
    const lines = [
      `<strong class="calc-grade">세액공제 예상 ${won(credit)}</strong> (지방소득세 포함 약 <strong>${won(withLocal)}</strong>)`,
      `공제 대상 납입액: <strong>${won(eligible)}</strong> × 공제율 <strong>${Math.round(rate * 100)}%</strong>`,
    ];
    if (pension > PENSION_CAP) lines.push(`연금저축 ${won(pension - PENSION_CAP)}은 600만 원 한도를 넘어 공제되지 않습니다.`);
    if (pensionOk + irp > TOTAL_CAP) lines.push(`합산 900만 원을 넘는 ${won(pensionOk + irp - TOTAL_CAP)}은 공제되지 않습니다.`);

    let state = 'ok';
    if (spare > 0) {
      state = 'warn';
      const extra = spare * rate;
      lines.push(`공제 한도까지 <strong>${won(spare)}</strong> 더 넣을 수 있고, 다 채우면 세액공제가 ${won(extra)}(지방소득세 포함 약 ${won(extra * (1 + LOCAL_TAX))}) 늘어납니다.`);
      if (pensionRoom < spare) lines.push(`그중 연금저축에는 ${won(pensionRoom)}까지, 나머지는 IRP에 넣을 수 있습니다.`);
      const now = new Date();
      if (now.getFullYear() === TAX_YEAR) {
        const months = 12 - now.getMonth();
        lines.push(`12월까지 ${months}개월(이번 달 포함)에 나눠 넣는다면 한 달 약 <strong>${won(Math.ceil(spare / months / 1000) * 1000)}</strong>입니다.`);
      }
    } else {
      lines.push('공제 한도를 모두 채웠습니다. 더 넣어도 세액공제는 늘지 않습니다.');
    }
    lines.push('<small>※ 소득 유형별 공제율 기준만 반영한 예상치입니다. 실제 환급액은 연말정산 결과(결정세액)에 따라 달라지고, 연금계좌 간 이전 금액은 납입액에 포함되지 않습니다.</small>');
    show(lines.join('<br>') + capNote, state);
  };

  root.querySelectorAll('select, input').forEach((el) => {
    el.addEventListener('change', calc);
    el.addEventListener('input', calc);
  });
  calc();
})();
