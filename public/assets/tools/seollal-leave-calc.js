// 2027 연휴·연차 붙이기 계산기 — content/posts/seollal-2027-leave.md 의 <div id="sl-calc"> 에 렌더링
// 공휴일 출처: 우주항공청 「2027년도 월력요항」 (2026-06-29 발표) — 대체공휴일 포함. 다음 해 갱신 시 YEAR·HOLIDAYS·BLOCKS 를 바꾼다.
(() => {
  const root = document.getElementById('sl-calc');
  if (!root) return;

  const YEAR = 2027;
  // 평일에 걸리는 공휴일(대체공휴일 포함). 토·일은 따로 셈하지 않는다. [월, 일]
  const HOLIDAYS = [[1, 1], [2, 8], [2, 9], [3, 1], [5, 3], [5, 5], [5, 13], [7, 19], [8, 16],
    [9, 14], [9, 15], [9, 16], [10, 4], [10, 11], [12, 27]];
  // 기준이 되는 연휴 (월력요항 「3일 이상 연휴」). anchor = 반드시 포함할 날짜
  const BLOCKS = [
    { id: 'seol', name: '설 연휴 (2/6~9)', anchor: [2, 7] },
    { id: 'sam', name: '삼일절 (2/27~3/1)', anchor: [3, 1] },
    { id: 'may', name: '어린이날 (5/5 수)', anchor: [5, 5] },
    { id: 'bud', name: '부처님오신날 (5/13 목)', anchor: [5, 13] },
    { id: 'jehun', name: '제헌절 (7/17~19)', anchor: [7, 18] },
    { id: 'gwang', name: '광복절 (8/14~16)', anchor: [8, 15] },
    { id: 'chu', name: '추석 연휴 (9/14~16)', anchor: [9, 15] },
    { id: 'gae', name: '개천절 (10/2~4)', anchor: [10, 3] },
    { id: 'han', name: '한글날 (10/9~11)', anchor: [10, 9] },
    { id: 'xmas', name: '성탄절 (12/25~27)', anchor: [12, 25] },
  ];

  const DAY = ['일', '월', '화', '수', '목', '금', '토'];
  const key = (m, d) => m * 100 + d;
  const holidaySet = new Set(HOLIDAYS.map(([m, d]) => key(m, d)));
  // 해당 연도의 모든 날 (0시 기준)
  const days = [];
  for (let t = new Date(YEAR, 0, 1); t.getFullYear() === YEAR; t = new Date(YEAR, t.getMonth(), t.getDate() + 1)) {
    const wd = t.getDay();
    days.push({ m: t.getMonth() + 1, d: t.getDate(), wd, off: wd === 0 || wd === 6 || holidaySet.has(key(t.getMonth() + 1, t.getDate())) });
  }
  const fmt = (x) => `${x.m}/${x.d}(${DAY[x.wd]})`;

  // 연차 N일 이하로 anchor 를 포함하는 가장 긴 연속 휴일. 길이가 같으면 연차를 덜 쓰는 쪽.
  const best = (anchorKey, n) => {
    const ai = days.findIndex((x) => key(x.m, x.d) === anchorKey);
    let top = null;
    for (let s = 0; s <= ai; s++) {
      let used = 0;
      for (let e = s; e < days.length; e++) {
        if (!days[e].off) used++;
        if (used > n) break;
        if (e < ai) continue;
        const len = e - s + 1;
        if (!top || len > top.len || (len === top.len && used < top.used)) top = { s, e, len, used };
      }
    }
    return top;
  };

  root.innerHTML = `
<p class="calc-help">연휴를 고르고 쓸 수 있는 연차 일수를 넣으면, ${YEAR}년 달력에서 그 연휴에 붙여 가장 길게 쉬는 방법을 알려 줍니다. 토·일과 대체공휴일을 모두 반영했습니다.</p>
<div class="calc-grid">
  <label>붙일 연휴<select id="sl-block">${BLOCKS.map((b) => `<option value="${b.id}">${b.name}</option>`).join('')}</select></label>
  <label>쓸 수 있는 연차 (일)<input id="sl-n" type="number" inputmode="numeric" min="0" max="15" step="1" value="3"></label>
</div>
<output class="calc-result" id="sl-out" aria-live="polite"></output>`;

  const $ = (sel) => root.querySelector(sel);
  const run = () => {
    const out = $('#sl-out');
    const raw = $('#sl-n').value.trim();
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < 0 || n > 15) {
      out.dataset.state = 'warn';
      out.innerHTML = '연차는 0~15일 사이의 정수로 넣어 주세요.';
      return;
    }
    const b = BLOCKS.find((x) => x.id === $('#sl-block').value);
    const base = best(key(...b.anchor), 0);
    const r = best(key(...b.anchor), n);
    const leaves = [];
    for (let i = r.s; i <= r.e; i++) if (!days[i].off) leaves.push(fmt(days[i]));
    const lines = [
      `<strong class="calc-grade">연차 ${r.used}일 → ${r.len}일 연속 휴일</strong>`,
      `기간: <strong>${fmt(days[r.s])} ~ ${fmt(days[r.e])}</strong>`,
      `연차를 낼 날: ${leaves.length ? leaves.join(', ') : '없음 (연차 없이 쉬는 구간)'}`,
      `연차 없이 쉬는 기본 연휴: ${base.len}일 (${fmt(days[base.s])} ~ ${fmt(days[base.e])})`,
    ];
    if (r.used < n) lines.push(`<small>연차를 ${n}일까지 쓸 수 있어도 ${r.used}일만 쓰는 것이 가장 효율적입니다. 더 써도 이 연휴에는 붙지 않습니다.</small>`);
    out.dataset.state = 'ok';
    out.innerHTML = lines.join('<br>');
  };
  root.querySelectorAll('select, input').forEach((el) => {
    el.addEventListener('change', run);
    el.addEventListener('input', run);
  });
  run();
})();
