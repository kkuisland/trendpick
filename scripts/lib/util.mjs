// 공용 유틸리티: 파일, 날짜(KST), 문자열, HTTP
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const p = (...parts) => path.join(ROOT, ...parts);

// ---------- 파일 ----------
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

export function writeText(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, 'utf8');
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return fallback;
  }
}

export function writeJson(file, obj) {
  writeText(file, JSON.stringify(obj, null, 2) + '\n');
}

export function listFiles(dir, ext = '.md') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f) => path.join(dir, f));
}

export function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true });
}

// ---------- 설정 ----------
export function readConfig() {
  const config = readJson(p('config', 'site.config.json'));
  if (!config) throw new Error('config/site.config.json 을 읽을 수 없습니다.');
  // 환경변수가 있으면 설정 파일보다 우선
  const env = process.env;
  if (env.SITE_URL) config.site.url = env.SITE_URL;
  if (env.NAVER_CLIENT_ID) config.apis.naver.clientId = env.NAVER_CLIENT_ID;
  if (env.NAVER_CLIENT_SECRET) config.apis.naver.clientSecret = env.NAVER_CLIENT_SECRET;
  if (env.INDEXNOW_KEY) config.apis.indexnow.key = env.INDEXNOW_KEY;
  config.site.url = config.site.url.replace(/\/+$/, '');
  return config;
}

// ---------- 날짜 (KST 기준) ----------
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function nowKST() {
  return new Date(Date.now() + KST_OFFSET_MS);
}

export function todayKST() {
  return nowKST().toISOString().slice(0, 10);
}

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function dayOfWeekKo(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return DAY_KO[d.getUTCDay()];
}

export function formatKoDate(dateStr, { weekday = false, year = true } = {}) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  let s = year ? `${y}년 ${m}월 ${d}일` : `${m}월 ${d}일`;
  if (weekday) s += `(${dayOfWeekKo(dateStr)})`;
  return s;
}

export function formatKoRange(start, end) {
  if (!end || end === start) return formatKoDate(start, { weekday: true });
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatKoDate(start, { weekday: true })} ~ ${formatKoDate(end, { weekday: true, year: !sameYear })}`;
}

/** dateStr(YYYY-MM-DD)까지 남은 일수. 오늘이면 0, 지났으면 음수 */
export function daysUntil(dateStr, from = todayKST()) {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(dateStr + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

/** 이벤트 상태: {label: 'D-30' | 'D-Day' | '진행 중' | '종료', phase} */
export function eventStatus(event, today = todayKST()) {
  const start = daysUntil(event.start, today);
  const end = daysUntil(event.end || event.start, today);
  if (end < 0) return { label: '종료', phase: 'past', days: start };
  if (start <= 0) {
    return { label: start === 0 && end === 0 ? 'D-Day' : '진행 중', phase: 'live', days: start };
  }
  return { label: `D-${start}`, phase: 'upcoming', days: start };
}

// ---------- 문자열 ----------
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** ASCII 슬러그 (URL용). 한글 등이 모두 제거되면 빈 문자열 반환 → 호출부에서 대체 */
export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function truncate(s, n) {
  s = String(s).trim();
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

// ---------- 프런트매터 ----------
/**
 * 평면 프런트매터 파서.
 * 지원: 문자열, 숫자, true/false, [a, b] 인라인 배열
 */
export function parseFrontMatter(src) {
  const meta = {};
  if (!src.startsWith('---\n')) return { meta, body: src };
  const endIdx = src.indexOf('\n---', 4);
  if (endIdx === -1) return { meta, body: src };
  const raw = src.slice(4, endIdx);
  const body = src.slice(src.indexOf('\n', endIdx + 1) + 1);
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      value = value.replace(/^["']|["']$/g, '');
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      meta[key] = value;
    }
  }
  return { meta, body };
}

export function serializeFrontMatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) lines.push(`${k}: [${v.join(', ')}]`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push('---');
  return lines.join('\n');
}

// ---------- HTTP ----------
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 TrendPickCollector/1.0';

export async function fetchText(url, { timeoutMs = 15000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: '*/*', ...headers },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts = {}) {
  return JSON.parse(await fetchText(url, opts));
}
