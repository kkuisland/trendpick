// 마크다운 서브셋 렌더러 (외부 의존성 없음)
// 지원: h2~h4, 문단, 굵게/기울임/코드, 링크/이미지, ul/ol(1단 중첩), 표,
//       인용, 구분선, 코드펜스, 원시 HTML 블록,
//       확장: ::faq 블록, ::event 카드, {{ad}} {{coupang ...}} {{toc}} 쇼트코드
import { escapeHtml } from './util.mjs';

/**
 * @param {string} body 마크다운 본문 (프런트매터 제외)
 * @param {object} ctx
 *   ctx.siteHost  - 내부/외부 링크 판별용 호스트명
 *   ctx.shortcodes - { ad(), coupang(attrs), event(key), aff(key) } → HTML 문자열 반환
 *   ctx.faqLabel  - FAQ 섹션 제목 (로케일별). 생략 시 한국어 기본값
 * @returns {{ html, toc: [{level,id,text}], faqs: [{q, aHtml, aText}], hasToc }}
 */
export function renderMarkdown(body, ctx = {}) {
  const faqLabel = ctx.faqLabel || '자주 묻는 질문';
  const lines = body.split('\n');
  const out = [];
  const toc = [];
  const faqs = [];
  const idCount = new Map();
  let hasTocPlaceholder = false;

  const sc = ctx.shortcodes || {};

  const headingId = (text) => {
    let id = plainInline(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '');
    if (!id) id = 'section';
    const n = (idCount.get(id) || 0) + 1;
    idCount.set(id, n);
    return n > 1 ? `${id}-${n}` : id;
  };

  const isExternal = (url) => {
    if (!/^https?:\/\//i.test(url)) return false;
    if (!ctx.siteHost) return true;
    try {
      return new URL(url).host !== ctx.siteHost;
    } catch {
      return true;
    }
  };

  function inline(s) {
    let t = escapeHtml(s);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      '<img src="$2" alt="$1" loading="lazy" decoding="async">'
    );
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) =>
      isExternal(url)
        ? `<a href="${url}" target="_blank" rel="nofollow noopener noreferrer">${text}</a>`
        : `<a href="${url}">${text}</a>`
    );
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return t;
  }

  function plainInline(s) {
    return s
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .trim();
  }

  function parseAttrs(str) {
    const attrs = {};
    const re = /(\w+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(str))) attrs[m[1]] = m[2];
    return attrs;
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // 코드펜스
    if (trimmed.startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 닫는 펜스
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // FAQ 블록  ::faq ... ::
    if (trimmed === '::faq') {
      i++;
      const block = [];
      while (i < lines.length && lines[i].trim() !== '::') {
        block.push(lines[i]);
        i++;
      }
      i++; // 닫는 ::
      const items = [];
      let cur = null;
      for (const bl of block) {
        const qm = bl.match(/^Q:\s*(.*)$/);
        const am = bl.match(/^A:\s*(.*)$/);
        if (qm) {
          cur = { q: qm[1].trim(), a: [] };
          items.push(cur);
        } else if (am && cur) {
          cur.a.push(am[1].trim());
        } else if (cur && bl.trim()) {
          cur.a.push(bl.trim());
        } else if (cur && !bl.trim() && cur.a.length) {
          cur.a.push('');
        }
      }
      if (items.length) {
        const id = headingId(faqLabel);
        toc.push({ level: 2, id, text: faqLabel });
        const rendered = items
          .map((it) => {
            const paras = it.a
              .join('\n')
              .split(/\n\n+/)
              .map((p) => `<p>${inline(p.replace(/\n/g, ' '))}</p>`)
              .join('');
            faqs.push({
              q: plainInline(it.q),
              aHtml: paras,
              aText: it.a.filter(Boolean).map((a) => plainInline(a)).join(' '),
            });
            return `<details class="faq-item"><summary>${inline(it.q)}</summary><div class="faq-answer">${paras}</div></details>`;
          })
          .join('\n');
        out.push(`<section class="faq-section"><h2 id="${id}">${escapeHtml(faqLabel)}</h2>\n${rendered}</section>`);
      }
      continue;
    }

    // 이벤트 카드  ::event key
    const evm = trimmed.match(/^::event\s+([\w-]+)\s*$/);
    if (evm) {
      out.push(sc.event ? sc.event(evm[1]) : '');
      i++;
      continue;
    }

    // 쇼트코드  {{ad}} {{toc}} {{coupang ...}}
    const scm = trimmed.match(/^\{\{(\w+)([^}]*)\}\}$/);
    if (scm) {
      const name = scm[1];
      if (name === 'toc') {
        out.push('<!--__TOC__-->');
        hasTocPlaceholder = true;
      } else if (name === 'ad') {
        out.push(sc.ad ? sc.ad() : '<!-- ad slot -->');
      } else if (name === 'coupang') {
        out.push(sc.coupang ? sc.coupang(parseAttrs(scm[2])) : '');
      } else if (name === 'aff') {
        // {{aff 키}} — data/affiliates.json 의 링크를 삽입
        out.push(sc.aff ? sc.aff(scm[2].trim()) : '');
      } else if (name === 'support') {
        out.push(sc.support ? sc.support() : '');
      }
      i++;
      continue;
    }

    // 제목 h2~h4
    const hm = line.match(/^(#{2,4})\s+(.*)$/);
    if (hm) {
      const level = hm[1].length;
      const text = hm[2].trim();
      const id = headingId(text);
      if (level <= 3) toc.push({ level, id, text: plainInline(text) });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    // 구분선
    if (/^-{3,}\s*$/.test(trimmed)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // 인용
    if (/^>\s?/.test(trimmed)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`);
      continue;
    }

    // 표
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const splitRow = (row) =>
        row
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const headers = splitRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${headers.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      out.push(`<div class="table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // 목록 (1단 중첩)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const l = lines[i];
        const indent = l.match(/^\s*/)[0].length;
        const text = l.replace(/^\s*([-*]|\d+\.)\s+/, '');
        if (indent >= 2 && items.length) {
          items[items.length - 1].children.push(text);
        } else {
          items.push({ text, children: [] });
        }
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      const body = items
        .map((it) => {
          const sub = it.children.length
            ? `<ul>${it.children.map((c) => `<li>${inline(c)}</li>`).join('')}</ul>`
            : '';
          return `<li>${inline(it.text)}${sub}</li>`;
        })
        .join('');
      out.push(`<${tag}>${body}</${tag}>`);
      continue;
    }

    // 원시 HTML 블록 (직접 삽입한 iframe 등)
    if (trimmed.startsWith('<')) {
      const buf = [];
      while (i < lines.length && lines[i].trim()) {
        buf.push(lines[i]);
        i++;
      }
      out.push(buf.join('\n'));
      continue;
    }

    // 문단
    {
      const buf = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{2,4}\s|>|\||```|-{3,}\s*$|::|\{\{|\s*[-*]\s|\s*\d+\.\s|<)/.test(lines[i].trim())
      ) {
        buf.push(lines[i].trim());
        i++;
      }
      if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`);
      else i++; // 안전장치: 무한루프 방지
    }
  }

  let html = out.join('\n');

  // 목차 치환
  if (hasTocPlaceholder) {
    const entries = toc.filter((t) => t.level === 2);
    if (entries.length >= 2) {
      const items = entries
        .map((t) => {
          const subs = [];
          const idx = toc.indexOf(t);
          for (let j = idx + 1; j < toc.length && toc[j].level === 3; j++) subs.push(toc[j]);
          const subHtml = subs.length
            ? `<ol>${subs.map((s) => `<li><a href="#${s.id}">${escapeHtml(s.text)}</a></li>`).join('')}</ol>`
            : '';
          return `<li><a href="#${t.id}">${escapeHtml(t.text)}</a>${subHtml}</li>`;
        })
        .join('');
      html = html.replace(
        '<!--__TOC__-->',
        `<nav class="toc" aria-label="목차"><div class="toc-title">목차</div><ol>${items}</ol></nav>`
      );
    } else {
      html = html.replace('<!--__TOC__-->', '');
    }
  }

  return { html, toc, faqs };
}
