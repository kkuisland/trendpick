// 빌드 결과물 안의 죽은 내부 링크 찾기
//
// 이 사이트는 글끼리 서로 링크한다. 그런데 검수 보류(draft: true)에 걸린 글은
// 빌드에서 빠지므로, 그 글을 가리키던 링크가 조용히 404 가 된다. 실제로
// 추석 기차표 글이 아직 발행되지 않은 선물세트 글을 링크한 채로 나갈 뻔했다.
// 사람이 눈으로 잡을 수 있는 종류가 아니라서 빌드가 대신 본다.

import fs from 'node:fs';
import path from 'node:path';

/** dist 안의 .html 을 모두 모은다 (어드민은 색인 대상이 아니라 제외) */
function htmlFiles(dir, root = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      if (name === 'admin') continue;
      htmlFiles(full, root, out);
    } else if (name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

/** 루트 상대 주소를 dist 안의 실제 파일 경로 후보로 바꾼다 */
function candidates(distDir, urlPath) {
  const clean = urlPath.replace(/[?#].*$/, '');
  const rel = clean.replace(/^\/+/, '');
  const base = path.join(distDir, rel);
  // 디렉터리 주소(/posts/x/)와 파일 주소(/rss.xml)를 모두 받아준다.
  // 확장자가 없으면 슬래시가 빠진 주소일 수 있으므로 index.html 도 함께 본다.
  if (clean.endsWith('/')) return [path.join(base, 'index.html')];
  return path.extname(clean) ? [base] : [base, path.join(base, 'index.html')];
}

/**
 * @returns {{page: string, href: string}[]} 가리키는 대상이 없는 링크들
 */
export function deadInternalLinks(distDir, basePath = '') {
  if (!fs.existsSync(distDir)) return [];
  const dead = [];
  const seen = new Set();
  for (const file of htmlFiles(distDir)) {
    const page = '/' + path.relative(distDir, file).split(path.sep).join('/');
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(/(?:href|src)="(\/[^"\/][^"]*|\/)"/g)) {
      let href = m[1];
      // 서브경로 배포에서는 모든 주소 앞에 basePath 가 붙어 있다
      if (basePath && href.startsWith(basePath + '/')) href = href.slice(basePath.length);
      const key = page + ' ' + href;
      if (seen.has(key)) continue;
      seen.add(key);
      if (candidates(distDir, href).some((c) => fs.existsSync(c))) continue;
      dead.push({ page, href });
    }
  }
  return dead;
}
