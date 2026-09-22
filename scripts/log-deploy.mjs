// 배포 로그 — 배포할 때마다 한 줄씩 한글로 남긴다.
//
// 자동 발행 루틴은 사람이 매번 지켜보지 않으므로, 배포가 실제로 됐는지·
// 라이브 확인이 됐는지가 커밋 메시지만으로는 잘 안 보인다. 그래서 6단계
// (배포 확인) 직후 이 스크립트로 결과를 data/deploy-log.md 에 누적 기록한다.
//
// 사용: node scripts/log-deploy.mjs --live "200" [--note "..."] [--post "슬러그: 상태"]
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { p, readText, writeText, todayKST } from './lib/util.mjs';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function gitInfo() {
  try {
    const hash = execSync('git rev-parse --short HEAD').toString().trim();
    const subject = execSync('git log -1 --format=%s').toString().trim();
    return { hash, subject };
  } catch {
    return { hash: '알수없음', subject: '' };
  }
}

function buildEntry({ date, git, live, note, post }) {
  const L = [];
  L.push(`## ${date}`);
  L.push(`- 커밋: \`${git.hash}\`${git.subject ? ` ${git.subject}` : ''}`);
  if (post) L.push(`- 글: ${post}`);
  L.push(`- 라이브 확인: ${live || '기록 없음'}`);
  if (note) L.push(`- 비고: ${note}`);
  return L.join('\n');
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const date = todayKST();
  const live = arg('live', '확인 안 함');
  const note = arg('note');
  const post = arg('post');
  const git = gitInfo();

  const file = p('data', 'deploy-log.md');
  const prev = fs.existsSync(file)
    ? readText(file)
    : '# 배포 로그\n\n케이트렌드 배포 이력. 최신 항목이 위에 옵니다.\n';
  const [header, ...rest] = prev.split(/\n(?=## )/);
  const entry = buildEntry({ date, git, live, note, post });
  const body = [header.trimEnd(), entry, ...rest].join('\n\n');
  writeText(file, body.trimEnd() + '\n');

  console.log(`📋 배포 로그 기록: ${date} (${git.hash}) · 라이브: ${live}`);
}
