// 수능 등급·최저 계산기 — content/posts/suneung-2027-grade-calculator.md 의 <div id="suneung-calc"> 에 렌더링
// 외부 의존성 없음. 계산 기준 출처는 글 본문 '출처' 절 참고.
(() => {
  const root = document.getElementById('suneung-calc');
  if (!root) return;

  // 절대평가 영역: 1~8등급 하한 원점수 (그 미만은 9등급)
  const ABSOLUTE = {
    english: { label: '영어', max: 100, cuts: [90, 80, 70, 60, 50, 40, 30, 20] },
    history: { label: '한국사', max: 50, cuts: [40, 35, 30, 25, 20, 15, 10, 5] },
    lang2: { label: '제2외국어/한문', max: 50, cuts: [45, 40, 35, 30, 25, 20, 15, 10] },
  };
  // 상대평가 영역: 1~8등급 상위 누적 비율(%)
  const STANINE = [4, 11, 23, 40, 60, 77, 89, 96];

  const gradeByCuts = (score, cuts) => {
    const i = cuts.findIndex((c) => score >= c);
    return i === -1 ? 9 : i + 1;
  };
  const gradeByPercentile = (p) => {
    const top = 100 - p;
    const i = STANINE.findIndex((s) => top <= s);
    return i === -1 ? 9 : i + 1;
  };
  const num = (el) => (el.value.trim() === '' ? NaN : Number(el.value));
  const gradeOptions = (withNone) =>
    (withNone ? '<option value="">미응시</option>' : '') +
    Array.from({ length: 9 }, (_, i) => `<option value="${i + 1}">${i + 1}등급</option>`).join('');

  root.innerHTML = `
<div class="calc-tabs" role="tablist" aria-label="계산기 종류">
  <button type="button" role="tab" aria-selected="true" aria-controls="calc-abs" id="tab-abs">절대평가 등급</button>
  <button type="button" role="tab" aria-selected="false" aria-controls="calc-rel" id="tab-rel" tabindex="-1">상대평가 등급</button>
  <button type="button" role="tab" aria-selected="false" aria-controls="calc-min" id="tab-min" tabindex="-1">수능 최저 확인</button>
</div>

<div class="calc-panel" role="tabpanel" id="calc-abs" aria-labelledby="tab-abs">
  <p class="calc-help">영어·한국사·제2외국어/한문은 정해진 점수만 넘으면 등급이 나옵니다. 원점수를 넣어 보세요.</p>
  <div class="calc-row">
    <label>영역<select id="abs-subject">
      <option value="english">영어 (100점 만점)</option>
      <option value="history">한국사 (50점 만점)</option>
      <option value="lang2">제2외국어/한문 (50점 만점)</option>
    </select></label>
    <label>원점수<input id="abs-score" type="number" inputmode="numeric" min="0" max="100" placeholder="예: 87"></label>
  </div>
  <output class="calc-result" id="abs-out" aria-live="polite">원점수를 입력하면 등급이 바로 표시됩니다.</output>
</div>

<div class="calc-panel" role="tabpanel" id="calc-rel" aria-labelledby="tab-rel" hidden>
  <h4>① 백분위로 등급 확인</h4>
  <p class="calc-help">성적표(12월 11일 통지)의 백분위를 넣으면 등급 구간을 알려줍니다. 실제 등급은 표준점수로 정해지므로 경계 부근은 1등급 차이가 날 수 있습니다.</p>
  <div class="calc-row">
    <label>백분위<input id="rel-pct" type="number" inputmode="decimal" min="0" max="100" step="0.1" placeholder="예: 93"></label>
  </div>
  <output class="calc-result" id="rel-pct-out" aria-live="polite">백분위를 입력하세요.</output>

  <h4>② 등급컷을 넣고 원점수로 예상 등급 확인</h4>
  <p class="calc-help">수능 당일 저녁 입시기관이 발표하는 가채점 등급컷(원점수 기준)을 옮겨 적으면 내 예상 등급이 나옵니다. 1등급컷부터 순서대로 입력하세요.</p>
  <div class="calc-cuts" id="rel-cuts">
    ${Array.from({ length: 8 }, (_, i) => `<label>${i + 1}등급컷<input type="number" inputmode="numeric" min="0" max="100" data-cut="${i}"></label>`).join('')}
  </div>
  <div class="calc-row">
    <label>내 원점수<input id="rel-score" type="number" inputmode="numeric" min="0" max="100" placeholder="예: 84"></label>
  </div>
  <output class="calc-result" id="rel-cut-out" aria-live="polite">등급컷과 원점수를 입력하세요.</output>
</div>

<div class="calc-panel" role="tabpanel" id="calc-min" aria-labelledby="tab-min" hidden>
  <p class="calc-help">지원 대학의 최저 기준(예: "국·수·영·탐 중 3개 영역 등급 합 6 이내")을 입력하고 내 등급을 고르세요.</p>
  <div class="calc-grid">
    <label>국어<select data-area="국어">${gradeOptions(true)}</select></label>
    <label>수학<select data-area="수학">${gradeOptions(true)}</select></label>
    <label>영어<select data-area="영어">${gradeOptions(true)}</select></label>
    <label>탐구 1<select id="min-t1">${gradeOptions(true)}</select></label>
    <label>탐구 2<select id="min-t2">${gradeOptions(true)}</select></label>
    <label>한국사<select id="min-hist">${gradeOptions(true)}</select></label>
  </div>
  <div class="calc-grid">
    <label>반영 영역 수<select id="min-n"><option>2</option><option selected>3</option><option>4</option></select></label>
    <label>등급 합 이내<input id="min-sum" type="number" inputmode="numeric" min="2" max="36" value="6"></label>
    <label>탐구 반영<select id="min-tam">
      <option value="best">상위 1과목</option>
      <option value="floor">2과목 평균 (소수점 버림)</option>
      <option value="avg">2과목 평균 (소수점 그대로)</option>
    </select></label>
    <label>한국사 기준<select id="min-hist-req"><option value="">없음</option>${Array.from({ length: 8 }, (_, i) => `<option value="${i + 1}">${i + 1}등급 이내</option>`).join('')}</select></label>
  </div>
  <label class="calc-check"><input type="checkbox" id="min-eng" checked> 영어를 반영 영역에 포함</label>
  <output class="calc-result" id="min-out" aria-live="polite">등급을 고르면 충족 여부가 표시됩니다.</output>
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

  // ① 절대평가
  const absCalc = () => {
    const s = ABSOLUTE[$('#abs-subject').value];
    const score = num($('#abs-score'));
    $('#abs-score').max = s.max;
    if (Number.isNaN(score)) return show($('#abs-out'), '원점수를 입력하면 등급이 바로 표시됩니다.');
    if (score < 0 || score > s.max) return show($('#abs-out'), `${s.label}은(는) 0~${s.max}점 사이로 입력하세요.`, 'warn');
    const g = gradeByCuts(score, s.cuts);
    const next = g > 1 ? ` · ${g - 1}등급까지 <strong>${s.cuts[g - 2] - score}점</strong>` : '';
    show($('#abs-out'), `${s.label} ${score}점 → <strong class="calc-grade">${g}등급</strong>${next}`, 'ok');
  };
  $('#abs-subject').addEventListener('change', absCalc);
  $('#abs-score').addEventListener('input', absCalc);

  // ② 상대평가: 백분위
  $('#rel-pct').addEventListener('input', () => {
    const p = num($('#rel-pct'));
    if (Number.isNaN(p)) return show($('#rel-pct-out'), '백분위를 입력하세요.');
    if (p < 0 || p > 100) return show($('#rel-pct-out'), '백분위는 0~100 사이입니다.', 'warn');
    const g = gradeByPercentile(p);
    const top = Math.max(0, 100 - p).toFixed(1).replace(/\.0$/, '');
    show($('#rel-pct-out'), `백분위 ${p} (상위 약 ${top}%) → <strong class="calc-grade">${g}등급</strong> 구간`, 'ok');
  });

  // ② 상대평가: 등급컷 입력
  const relCutCalc = () => {
    const cuts = [...root.querySelectorAll('[data-cut]')].map(num);
    const score = num($('#rel-score'));
    const filled = cuts.filter((c) => !Number.isNaN(c));
    if (!filled.length || Number.isNaN(score)) return show($('#rel-cut-out'), '등급컷과 원점수를 입력하세요.');
    for (let i = 1; i < cuts.length; i++) {
      if (!Number.isNaN(cuts[i]) && !Number.isNaN(cuts[i - 1]) && cuts[i] >= cuts[i - 1]) {
        return show($('#rel-cut-out'), `${i + 1}등급컷은 ${i}등급컷보다 낮아야 합니다.`, 'warn');
      }
    }
    // 비어 있는 칸 이후는 판단하지 않는다
    const known = [];
    for (const c of cuts) {
      if (Number.isNaN(c)) break;
      known.push(c);
    }
    const i = known.findIndex((c) => score >= c);
    if (i === -1 && known.length < 8) {
      return show($('#rel-cut-out'), `${known.length}등급컷보다 낮습니다. 아래 등급컷도 입력하면 정확한 등급이 나옵니다.`, 'warn');
    }
    const g = i === -1 ? 9 : i + 1;
    const next = g > 1 ? ` · ${g - 1}등급컷까지 <strong>${known[g - 2] - score}점</strong>` : '';
    show($('#rel-cut-out'), `원점수 ${score}점 → 예상 <strong class="calc-grade">${g}등급</strong>${next}`, 'ok');
  };
  root.querySelectorAll('[data-cut], #rel-score').forEach((el) => el.addEventListener('input', relCutCalc));

  // ③ 수능 최저
  const minCalc = () => {
    const areas = [];
    root.querySelectorAll('[data-area]').forEach((sel) => {
      if (sel.dataset.area === '영어' && !$('#min-eng').checked) return;
      if (sel.value) areas.push({ name: sel.dataset.area, g: Number(sel.value) });
    });
    const t1 = Number($('#min-t1').value) || 0;
    const t2 = Number($('#min-t2').value) || 0;
    const mode = $('#min-tam').value;
    if (mode === 'best' && (t1 || t2)) {
      areas.push({ name: '탐구(상위 1과목)', g: Math.min(...[t1, t2].filter(Boolean)) });
    } else if (mode !== 'best' && t1 && t2) {
      const avg = (t1 + t2) / 2;
      areas.push({ name: '탐구(2과목 평균)', g: mode === 'floor' ? Math.floor(avg) : avg });
    }

    const n = Number($('#min-n').value);
    const limit = num($('#min-sum'));
    const histReq = Number($('#min-hist-req').value) || 0;
    const hist = Number($('#min-hist').value) || 0;

    if (areas.length < n || Number.isNaN(limit)) {
      const tamNote = mode !== 'best' && (t1 || t2) && !(t1 && t2) ? ' (2과목 평균 방식은 탐구 두 과목이 모두 필요합니다)' : '';
      return show($('#min-out'), `반영할 영역이 ${n}개 이상 필요합니다. 지금 ${areas.length}개 입력됨${tamNote}.`, areas.length ? 'warn' : '');
    }

    const best = [...areas].sort((a, b) => a.g - b.g).slice(0, n);
    const sum = Math.round(best.reduce((s, a) => s + a.g, 0) * 10) / 10;
    const combo = best.map((a) => `${a.name} ${a.g}`).join(' + ');
    const histOk = !histReq || (hist && hist <= histReq);
    const sumOk = sum <= limit;

    let html = `가장 유리한 조합: ${combo} = <strong>${sum}</strong> (기준 ${limit} 이내)`;
    if (histReq) html += `<br>한국사: ${hist ? hist + '등급' : '미입력'} (기준 ${histReq}등급 이내)`;
    if (sumOk && histOk) {
      html = `<strong class="calc-grade">충족</strong> · ` + html;
    } else {
      const why = [];
      if (!sumOk) why.push(`등급 합이 ${Math.round((sum - limit) * 10) / 10} 초과`);
      if (!histOk) why.push('한국사 기준 미달');
      html = `<strong class="calc-grade">미충족</strong> (${why.join(', ')}) · ` + html;
    }
    show($('#min-out'), html, sumOk && histOk ? 'ok' : 'bad');
  };
  root.querySelectorAll('#calc-min select, #calc-min input').forEach((el) => {
    el.addEventListener('change', minCalc);
    el.addEventListener('input', minCalc);
  });
})();
