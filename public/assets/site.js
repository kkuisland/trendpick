/* 케이트렌드 공통 스크립트 — 사이트 검색, D-day 다시 계산, 목차 펼치기.
 * 외부 라이브러리 없음. 이 파일이 없어도 글과 계산기는 그대로 쓸 수 있다. */
(function () {
  'use strict';
  var me = document.currentScript;
  var lang = (me && me.getAttribute('data-lang')) || 'ko';
  var indexUrl = (me && me.getAttribute('data-index')) || '/search-index.json';
  var L = lang === 'en'
    ? { today: 'Today', always: 'Anytime', tool: 'Calculator' }
    : { today: '오늘', always: '상시', tool: '계산기' };

  /* ---------- D-day: 빌드한 날이 아니라 보는 날 기준으로 ---------- */
  function todayKST() {
    return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  }
  function daysLeft(date) {
    return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(todayKST() + 'T00:00:00Z')) / 86400000);
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-due]'), function (el) {
    var n = daysLeft(el.getAttribute('data-due'));
    var label = el.querySelector('[data-dday]') || (el.hasAttribute('data-dday') ? el : null);
    if (!label) return;
    var isChip = el.classList.contains('dday-chip');
    if (n < 0) {
      if (isChip) return; // 행사 칩은 빌드가 「진행 중·종료」로 바꾼다
      if (el.classList.contains('due-badge')) { el.hidden = true; return; }
      label.textContent = L.always;
      el.removeAttribute('data-urgent');
      return;
    }
    label.textContent = n === 0 ? (isChip ? 'D-Day' : L.today) : 'D-' + n;
    if (!isChip) {
      if (n <= 14) el.setAttribute('data-urgent', ''); else el.removeAttribute('data-urgent');
    }
  });

  /* ---------- 목차: 넓은 화면에서는 펼쳐 둔다 ---------- */
  if (window.matchMedia && window.matchMedia('(min-width: 900px)').matches) {
    Array.prototype.forEach.call(document.querySelectorAll('details.toc'), function (d) { d.open = true; });
  }

  /* ---------- 사이트 검색 ---------- */
  var dialog = document.getElementById('site-search');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  var input = document.getElementById('site-search-input');
  var list = document.getElementById('site-search-results');
  var empty = dialog.querySelector('.search-empty');
  var items = null;
  var loading = null;
  var active = -1;

  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }

  function load() {
    if (items) return Promise.resolve(items);
    if (!loading) {
      loading = fetch(indexUrl, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (data) {
          items = (data || []).map(function (x) {
            x._t = norm(x.t); x._k = norm(x.k + ' ' + (x.tool || '') + ' ' + x.c); x._d = norm(x.d);
            return x;
          });
          return items;
        })
        .catch(function () { items = []; return items; });
    }
    return loading;
  }

  function search(q) {
    var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).map(norm);
    if (!words.length) {
      // 아무것도 안 썼을 때는 계산기부터 보여 준다 — 이 사이트에서 가장 많이 찾는 것
      return items.filter(function (x) { return x.tool; }).slice(0, 8);
    }
    var out = [];
    items.forEach(function (x) {
      var score = 0;
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        var s = (x._t.indexOf(w) >= 0 ? 3 : 0) + (x._k.indexOf(w) >= 0 ? 2 : 0) + (x._d.indexOf(w) >= 0 ? 1 : 0);
        if (!s) return; // 낱말이 하나라도 없으면 뺀다
        score += s;
      }
      if (x.tool) score += 0.5;
      out.push({ x: x, s: score });
    });
    out.sort(function (a, b) { return b.s - a.s; });
    return out.slice(0, 8).map(function (o) { return o.x; });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function render() {
    if (!items) return;
    var res = search(input.value);
    active = -1;
    list.innerHTML = res.map(function (x, i) {
      var due = '';
      if (x.due) {
        var n = daysLeft(x.due);
        if (n >= 0) due = '<span class="sr-due">' + (n === 0 ? L.today : 'D-' + n) + '</span>';
      }
      return '<li><a class="sr-item" id="sr-' + i + '" href="' + esc(x.u) + '">' +
        '<span class="sr-top">' + (x.tool ? '<span class="sr-tool">' + L.tool + '</span>' : '<span class="sr-cat">' + esc(x.c) + '</span>') + due + '</span>' +
        '<span class="sr-title">' + esc(x.t) + '</span>' +
        '<span class="sr-desc">' + esc(x.d) + '</span></a></li>';
    }).join('');
    empty.hidden = res.length > 0;
  }

  function move(step) {
    var links = list.querySelectorAll('.sr-item');
    if (!links.length) return;
    if (active >= 0) links[active].removeAttribute('aria-current');
    active = (active + step + links.length) % links.length;
    links[active].setAttribute('aria-current', 'true');
    links[active].scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (dialog.open) return;
    dialog.showModal();
    input.focus();
    load().then(render);
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-search-open]'), function (b) {
    b.addEventListener('click', open);
  });
  // 키보드: 「/」 로 열기 (입력 칸에 쓰는 중이면 무시)
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || dialog.open) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || (document.activeElement && document.activeElement.isContentEditable)) return;
    e.preventDefault();
    open();
  });
  input.addEventListener('input', render);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') {
      var links = list.querySelectorAll('.sr-item');
      var target = links[active >= 0 ? active : 0];
      e.preventDefault(); // 결과가 없을 때 Enter 가 창을 닫지 않게
      if (target) window.location.href = target.href;
    }
  });
  // 바깥(어두운 배경)을 누르면 닫는다
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) dialog.close();
  });
})();
