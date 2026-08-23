// 검수 대기 글 목록 — 자동 발행이 켜진 뒤에도 사람이 봐야 하는 글을 모아 알린다.
//
// 자동 발행으로 전환하면 사람이 저장소를 들여다보지 않게 되므로,
// 보류된 초안이 조용히 쌓이다 시의성을 잃는다. 그래서 목록을 만들어
// GitHub 이슈로 띄우고(= 메일 알림), 비었으면 이슈를 닫는다.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  p, readConfig, readText, writeText, listFiles, parseFrontMatter, todayKST, daysUntil,
} from './lib/util.mjs';
import { reviewReason } from './plan.mjs';

const DIRS = [
  { locale: 'ko', dir: ['content', 'posts'] },
  { locale: 'en', dir: ['content', 'en', 'posts'] },
];

export function collectDrafts() {
  const out = [];
  for (const d of DIRS) {
    for (const file of listFiles(p(...d.dir))) {
      const { meta } = parseFrontMatter(readText(file));
      if (meta.draft !== true) continue;
      const date = meta.date || todayKST();
      out.push({
        slug: path.basename(file, '.md'),
        locale: d.locale,
        file: [...d.dir, path.basename(file)].join('/'),
        title: meta.title || path.basename(file, '.md'),
        date,
        // 프런트매터에 사유가 없으면(수동 생성 등) 제목으로 다시 판정
        reason: meta.reviewReason || reviewReason(`${meta.title || ''} ${meta.description || ''}`) || '미분류',
        ageDays: -daysUntil(date),
      });
    }
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

function buildBody(config, drafts) {
  const L = [];
  L.push(`> 자동 점검: ${todayKST()} (KST) · 사이트: ${config.site.url}`);
  L.push('');
  L.push(`자동 발행이 켜져 있지만, 아래 글은 **틀리면 피해가 큰 주제**라 게시를 보류했습니다.`);
  L.push('내용을 확인하신 뒤 프런트매터의 `draft: true` 를 `false` 로 바꾸면 다음 배포에 올라갑니다.');
  L.push('');
  const stale = drafts.filter((d) => d.ageDays >= 2);
  if (stale.length) {
    L.push(`⏰ **${stale.length}건은 2일 이상 대기 중입니다.** 시의성 있는 주제라면 지금 처리하거나 정리해 주세요.`);
    L.push('');
  }
  const byReason = new Map();
  for (const d of drafts) {
    if (!byReason.has(d.reason)) byReason.set(d.reason, []);
    byReason.get(d.reason).push(d);
  }
  for (const [reason, items] of byReason) {
    L.push(`### ${reason}`);
    L.push('');
    for (const d of items) {
      const age = d.ageDays > 0 ? ` · ${d.ageDays}일 대기` : ' · 오늘';
      L.push(`- [ ] **${d.title}** (${d.locale})${age}`);
      L.push(`  - \`${d.file}\``);
    }
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push('**확인 포인트**: 날짜·수치·제도 내용이 맞는지, `[확인 필요]` 표시가 남아 있는지, 실존 인물 관련 서술이 정확한지.');
  L.push('');
  L.push('검수 대상 분류 기준은 `scripts/plan.mjs` 의 `REVIEW_PATTERNS` 에서 조정할 수 있습니다.');
  return L.join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const config = readConfig();
  const drafts = collectDrafts();
  const outFile = p('data', 'review-queue.md');
  writeText(outFile, (drafts.length ? buildBody(config, drafts) : '검수 대기 중인 글이 없습니다.') + '\n');

  console.log(`\n📝 검수 대기 — ${drafts.length}건`);
  for (const d of drafts) {
    console.log(`   [${d.reason}] ${d.title} (${d.locale}, ${d.ageDays}일 대기)`);
  }
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('node:fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_drafts=${drafts.length > 0}\n`);
  }
}
