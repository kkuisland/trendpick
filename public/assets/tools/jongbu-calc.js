// 종부세(주택분) 계산기 — content/posts/jongbu-2026-calculator-installment.md 의 <div id="jongbu-calc"> 에 렌더링
// 2026년 귀속분(현행 세법) 기준. 출처: 국세청 종합부동산세 세액계산 흐름도·납부기한 안내.
(() => {
  const root = document.getElementById('jongbu-calc');
  if (!root) return;

  const EOK = 100000000;
  const MAN = 10000;
  const FAIR_RATIO = 0.6; // 주택분 공정시장가액비율
  const RURAL_TAX = 0.2; // 농어촌특별세 = 종부세액의 20%
  // [과세표준 상한(원), 세율, 누진공제(원)]
  const RATES = {
    normal: [[3 * EOK, 0.005, 0], [6 * EOK, 0.007, 60 * MAN], [12 * EOK, 0.01, 240 * MAN], [25 * EOK, 0.013, 600 * MAN],
      [50 * EOK, 0.015, 1100 * MAN], [94 * EOK, 0.02, 3600 * MAN], [Infinity, 0.027, 10180 * MAN]],
    multi: [[3 * EOK, 0.005, 0], [6 * EOK, 0.007, 60 * MAN], [12 * EOK, 0.01, 240 * MAN], [25 * EOK, 0.02, 1440 * MAN],
      [50 * EOK, 0.03, 3940 * MAN], [94 * EOK, 0.04, 8940 * MAN], [Infinity, 0.05, 18340 * MAN]],
  };

  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const eokText = (n) => {
    const e = Math.floor(n / EOK);
    const m = Math.round((n % EOK) / MAN);
    const text = [e ? `${e}억` : '', m ? `${m.toLocaleString('ko-KR')}만` : ''].join(' ').trim();
    return text ? text + '원' : '0원';
  };
  const num = (el) => (el.value.trim() === '' ? NaN : Number(el.value.replace(/,/g, '')));

  root.innerHTML = `
<div class="calc-tabs" role="tablist" aria-label="계산기 종류">
  <button type="button" role="tab" aria-selected="true" aria-controls="jb-tax" id="tab-jb-tax">대상 판별·예상 세액</button>
  <button type="button" role="tab" aria-selected="false" aria-controls="jb-split" id="tab-jb-split" tabindex="-1">분납 계산</button>
</div>

<div class="calc-panel" role="tabpanel" id="jb-tax" aria-labelledby="tab-jb-tax">
  <p class="calc-help">2026년 6월 1일 기준으로 보유한 주택의 공시가격 합계를 넣으세요. 공시가격은 부동산 공시가격 알리미에서 확인할 수 있습니다.</p>
  <div class="calc-grid">
    <label>보유 유형<select id="jb-type">
      <option value="one">1세대 1주택 (단독 명의)</option>
      <option value="normal">2주택 이하 (1세대 1주택 아님)</option>
      <option value="multi">3주택 이상</option>
    </select></label>
    <label>공시가격 합계 (만 원)<input id="jb-price" type="number" inputmode="numeric" min="0" step="100" placeholder="예: 150000 (15억)"></label>
  </div>
  <div class="calc-grid" id="jb-one-opts">
    <label>만 나이 (6월 1일 기준)<select id="jb-age">
      <option value="0">60세 미만</option><option value="0.2">60~64세</option><option value="0.3">65~69세</option><option value="0.4">70세 이상</option>
    </select></label>
    <label>보유 기간<select id="jb-hold">
      <option value="0">5년 미만</option><option value="0.2">5~9년</option><option value="0.4">10~14년</option><option value="0.5">15년 이상</option>
    </select></label>
  </div>
  <output class="calc-result" id="jb-tax-out" aria-live="polite">공시가격 합계를 입력하면 종부세 대상 여부가 표시됩니다.</output>
</div>

<div class="calc-panel" role="tabpanel" id="jb-split" aria-labelledby="tab-jb-split" hidden>
  <p class="calc-help">고지서에 적힌 <strong>총 납부세액(종합부동산세 + 농어촌특별세)</strong>을 넣으세요. 300만 원을 넘으면 일부를 이자 없이 6개월 뒤에 낼 수 있습니다.</p>
  <div class="calc-row">
    <label>고지서 총 납부세액 (원)<input id="jb-bill" type="number" inputmode="numeric" min="0" step="1000" placeholder="예: 4500000"></label>
  </div>
  <output class="calc-result" id="jb-split-out" aria-live="polite">고지 금액을 입력하면 분납 가능 금액이 표시됩니다.</output>
</div>`;

  // 탭 전환 (화살표 키 지원)
  const tabs = [...root.querySelectorAll('[role=tab]')];
  const select = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      root.querySelector('#' + t.getAttribute('aria-controls')).hidden = !on;
    });
    tab.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') select(tabs[(i + 1) % tabs.length]);
      if (e.key === 'ArrowLeft') select(tabs[(i - 1 + tabs.length) % tabs.length]);
    });
  });

  const $ = (sel) => root.querySelector(sel);
  const show = (el, html, state) => {
    el.innerHTML = html;
    el.dataset.state = state || '';
  };

  // ① 대상 판별·예상 세액
  const taxCalc = () => {
    const type = $('#jb-type').value;
    $('#jb-one-opts').hidden = type !== 'one';
    const price = num($('#jb-price')) * MAN;
    if (Number.isNaN(price)) return show($('#jb-tax-out'), '공시가격 합계를 입력하면 종부세 대상 여부가 표시됩니다.');
    if (price < 0) return show($('#jb-tax-out'), '공시가격은 0 이상이어야 합니다.', 'warn');

    const deduction = (type === 'one' ? 12 : 9) * EOK;
    if (price <= deduction) {
      return show($('#jb-tax-out'),
        `공시가격 ${eokText(price)} ≤ 공제금액 ${eokText(deduction)} → <strong class="calc-grade">종부세 대상 아님</strong>`, 'ok');
    }
    const base = (price - deduction) * FAIR_RATIO; // 과세표준
    const [, rate, progressive] = RATES[type === 'multi' ? 'multi' : 'normal'].find(([cap]) => base <= cap);
    const gross = base * rate - progressive;

    let credit = 0;
    if (type === 'one') credit = Math.min(Number($('#jb-age').value) + Number($('#jb-hold').value), 0.8);
    const tax = gross * (1 - credit);
    const total = tax * (1 + RURAL_TAX);

    const lines = [
      `<strong class="calc-grade">종부세 대상</strong> · 공제금액 ${eokText(deduction)} 초과`,
      `과세표준: (${eokText(price)} − ${eokText(deduction)}) × 60% = <strong>${eokText(base)}</strong>`,
      `적용 세율: <strong>${(rate * 100).toFixed(1)}%</strong> (누진공제 ${eokText(progressive)})`,
      `산출세액: <strong>${won(gross)}</strong>`,
    ];
    if (credit) lines.push(`1세대 1주택 세액공제 ${Math.round(credit * 100)}% 적용: ${won(tax)}`);
    lines.push(`농어촌특별세 20% 포함: <strong>약 ${won(total)}</strong>`);
    lines.push('<small>※ 재산세 중복분 공제와 세부담 상한(전년 대비 150%) 적용 <em>전</em> 금액입니다. 실제 고지액은 이보다 적습니다. 정확한 세액은 홈택스 모의계산으로 확인하세요.</small>');
    show($('#jb-tax-out'), lines.join('<br>'), 'bad');
  };
  root.querySelectorAll('#jb-tax select, #jb-tax input').forEach((el) => {
    el.addEventListener('change', taxCalc);
    el.addEventListener('input', taxCalc);
  });
  taxCalc();

  // ② 분납: 총 납부세액(농특세 포함) 300만 원 초과 시
  // 300만~600만 원 이하: 300만 원 초과분 / 600만 원 초과: 50% 이하
  $('#jb-bill').addEventListener('input', () => {
    const bill = num($('#jb-bill'));
    if (Number.isNaN(bill)) return show($('#jb-split-out'), '고지 금액을 입력하면 분납 가능 금액이 표시됩니다.');
    if (bill <= 300 * MAN) {
      return show($('#jb-split-out'), `${won(bill)} → 300만 원 이하라 <strong class="calc-grade">분납 대상 아님</strong>. 12월 15일까지 전액 납부합니다.`, 'warn');
    }
    const later = bill <= 600 * MAN ? bill - 300 * MAN : Math.floor(bill / 2);
    show($('#jb-split-out'),
      `<strong class="calc-grade">분납 가능</strong><br>` +
      `12월 15일(화)까지: <strong>${won(bill - later)}</strong><br>` +
      `2027년 6월 15일(화)까지: 최대 <strong>${won(later)}</strong> (이자 없음)<br>` +
      `<small>분납은 홈택스·손택스에서 납부기한 안에 신청합니다.</small>`, 'ok');
  });
})();
