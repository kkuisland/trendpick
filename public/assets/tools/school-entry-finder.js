// 초등학교 입학 시기 판별기 — content/posts/school-entry-2027.md 의 <div id="school-entry"> 에 렌더링
// 기준: 초·중등교육법 제13조(만 6세가 되는 해의 다음 해 입학), 시행령 제15조(명부 10/31, 조기입학·입학연기 10/1~12/31)·제17조(취학통지 12/20),
// 경기도교육청 「초등 학적 길라잡이」(취학아동명부 10/31, 조기입학·입학연기 신청 10/1~12/31, 취학유예 1/1~입학기일 전).
// 해마다 바꿀 것: TARGET_YEAR(안내할 입학 연도). 법령 날짜가 바뀌면 DEADLINES 를 고친다.
(() => {
  const root = document.getElementById('school-entry');
  if (!root) return;

  const TARGET_YEAR = 2027; // 이 글이 안내하는 입학 연도
  // [월, 일, 이름] — 입학 전해(만 6세가 되는 해) 기준
  const DEADLINES = [
    [10, 31, '취학아동명부 작성 마감 (이 날 이후 이사 와도 명부에 올려 줌)'],
    [12, 20, '취학통지서 발송 기한 (읍·면·동)'],
    [12, 31, '입학연기 신청 마감 (읍·면·동)'],
  ];
  const EARLY_START = [10, 1];
  const EARLY_END = [12, 31];

  const today = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); })();
  const dayDiff = (y, m, d) => Math.round((new Date(y, m - 1, d) - today) / 86400000);
  const dText = (n) => (n > 0 ? `D-${n}` : n === 0 ? 'D-day' : `${-n}일 지남`);

  root.innerHTML = `
<p class="calc-help">자녀의 생년월일을 넣으면 정상 입학 연도, 조기입학·입학연기 가능 여부, 신청 마감까지 남은 날을 알려 줍니다.</p>
<div class="calc-row">
  <label>자녀 생년월일<input id="se-birth" type="date" min="2015-01-01" max="2026-12-31" value="2020-01-01"></label>
</div>
<output class="calc-result" id="se-out" aria-live="polite"></output>`;

  const out = root.querySelector('#se-out');
  const input = root.querySelector('#se-birth');

  const render = () => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.value);
    if (!m) { out.dataset.state = ''; out.textContent = '생년월일을 입력하세요.'; return; }
    const birth = Number(m[1]);
    const entry = birth + 7; // 만 6세가 되는 해(birth+6)의 다음 해
    const lines = [];
    let state = 'ok';

    if (entry < TARGET_YEAR) {
      state = 'warn';
      lines.push(`<strong class="calc-grade">${entry}년 입학 대상이었습니다</strong>`);
      lines.push(`${birth}년생의 정상 입학은 ${entry}년 3월입니다. 아직 입학하지 않았다면 주민센터나 해당 지역 교육지원청에 문의하세요.`);
    } else {
      lines.push(`<strong class="calc-grade">${entry}년 3월 초등학교 입학 대상</strong> (${birth}년생, ${birth + 6}년에 만 6세)`);
      if (entry === TARGET_YEAR) {
        lines.push(`올해(${TARGET_YEAR - 1}년) 취학통지서를 받는 대상입니다.`);
      } else if (entry === TARGET_YEAR + 1) {
        state = 'warn';
        lines.push(`${TARGET_YEAR}년으로 <strong>1년 앞당기는 조기입학</strong>을 올해 ${EARLY_START[0]}월 ${EARLY_START[1]}일~${EARLY_END[0]}월 ${EARLY_END[1]}일에 신청할 수 있습니다 (${birth}년에 태어나 올해 만 5세가 되는 아이).`);
      } else {
        lines.push(`${TARGET_YEAR}년 입학 대상이 아닙니다. 취학통지서는 ${entry - 1}년 12월에 받습니다.`);
      }
      const noticeYear = entry - 1;
      lines.push('');
      lines.push(`<strong>${noticeYear}년 일정 (정상 입학 기준)</strong>`);
      DEADLINES.forEach(([mm, dd, name]) => {
        lines.push(`${noticeYear}.${mm}.${dd}. ${name} — <strong>${dText(dayDiff(noticeYear, mm, dd))}</strong>`);
      });
      lines.push(`${entry}.1.1. ~ 입학기일 전: 취학유예·면제 신청 (학교장)`);
      lines.push(`<strong>입학연기</strong>: ${noticeYear}년 10.1~12.31 신청 → ${entry + 1}년 입학 (1회만 가능).`);
      if (entry > TARGET_YEAR) {
        lines.push(`<strong>조기입학</strong>: ${noticeYear - 1}년 10.1~12.31 신청 → ${entry - 1}년 입학 (1년만 가능).`);
      }
    }
    lines.push('<small>※ 학교·지역별 예비소집일과 올해 취학통지서 발급일은 교육부·교육지원청 발표와 취학통지서에서 확인하세요.</small>');
    out.dataset.state = state;
    out.innerHTML = lines.join('<br>');
  };
  input.addEventListener('input', render);
  input.addEventListener('change', render);
  render();
})();
