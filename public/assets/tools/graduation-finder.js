// 대학 졸업식 날짜 찾기 — content/posts/university-graduation-dates-2027.md 에서 사용
// 데이터는 글 본문의 표가 원본이다 (루틴·사람이 표만 고치면 됨). 이 스크립트는 그 표에 검색과 D-day 를 붙인다.
(() => {
  const root = document.getElementById('grad-finder');
  if (!root) return;
  const table = [...document.querySelectorAll('article table, main table, table')].find((t) =>
    /2027년 2월/.test(t.querySelector('thead')?.textContent || '')
  );
  if (!table) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = [...table.querySelectorAll('tbody tr')];

  // 2번째 열(2027년 2월 학위수여식)의 YYYY-MM-DD 로 D-day 표시
  rows.forEach((tr) => {
    const cell = tr.cells[1];
    const m = cell && cell.textContent.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const diff = Math.round((d - today) / 86400000);
    const badge = document.createElement('span');
    badge.className = 'grad-dday';
    badge.textContent = diff > 0 ? `D-${diff}` : diff === 0 ? 'D-DAY' : '종료';
    cell.append(' ', badge);
  });

  root.innerHTML = `
<label>학교 이름으로 찾기<input id="grad-q" type="search" placeholder="예: 연세, 부산" autocomplete="off"></label>
<output class="calc-result" id="grad-out" aria-live="polite">전체 ${rows.length}개 대학. 학교 이름 일부만 입력해도 찾아집니다.</output>`;

  const out = root.querySelector('#grad-out');
  root.querySelector('#grad-q').addEventListener('input', (e) => {
    const q = e.target.value.replace(/\s/g, '');
    let shown = 0;
    rows.forEach((tr) => {
      const hit = !q || tr.cells[0].textContent.replace(/\s/g, '').includes(q);
      tr.hidden = !hit;
      if (hit) shown++;
    });
    if (!q) {
      out.textContent = `전체 ${rows.length}개 대학. 학교 이름 일부만 입력해도 찾아집니다.`;
      out.dataset.state = '';
      return;
    }
    if (!shown) {
      out.textContent = `'${e.target.value}' 에 해당하는 학교가 아직 표에 없습니다.`;
      out.dataset.state = 'warn';
      return;
    }
    const first = rows.find((tr) => !tr.hidden);
    out.textContent = `${shown}개 학교 · ${first.cells[0].textContent.trim()}: ${first.cells[1].textContent.trim()}`;
    out.dataset.state = 'ok';
  });
})();
