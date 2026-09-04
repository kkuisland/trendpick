// PWA 아이콘 생성기 (일회성 도구)
//
// 왜 빌드에 넣지 않는가: 이 프로젝트는 의존성이 없다. 래스터라이저를 직접
// 들고 있으므로 매 빌드마다 돌릴 이유가 없다. 아이콘 디자인(favicon.svg)이
// 바뀔 때만 `node scripts/tools/make-icons.mjs` 로 다시 만들고 커밋한다.
//
// 왜 SVG 로 끝내지 않는가: 크롬은 매니페스트에서 SVG 아이콘을 받지만,
// iOS 사파리의 apple-touch-icon 은 PNG 만 인식한다. PNG 가 없으면 홈 화면에
// 페이지 스크린샷이 박힌다.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'assets');

// ---------- PNG 인코더 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 10~12: compression / filter / interlace = 0
  // 스캔라인마다 필터 바이트(0 = None)를 앞에 붙인다 — PNG 명세 요구사항
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 도형 (favicon.svg 와 같은 64 단위 좌표계) ----------
const R = 3; // stroke-width 6 의 반지름
const STROKES = [
  [[14, 42], [27, 29]], [[27, 29], [35, 36]], [[35, 36], [50, 20]],
  [[39, 18], [50, 20]], [[50, 20], [48, 31]],
];

// 선분까지의 거리 — 둥근 캡·조인이 공짜로 따라온다
function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return Math.hypot(cx, cy);
}

function inRoundedRect(x, y, radius) {
  if (radius <= 0) return x >= 0 && x <= 64 && y >= 0 && y <= 64;
  const qx = Math.abs(x - 32) - (32 - radius);
  const qy = Math.abs(y - 32) - (32 - radius);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius <= 0;
}

// linearGradient x1=0 y1=1 x2=1 y2=0 → (0,64) 에서 (64,0) 방향
function gradient(x, y) {
  let t = (x - y + 64) / 128;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [
    Math.round(0x2f + (0x7b - 0x2f) * t),
    Math.round(0x6b + (0x4d - 0x6b) * t),
    0xff,
  ];
}

// 4x4 슈퍼샘플링. 아이콘은 한 번만 만들면 되므로 속도보다 가장자리 품질을 택한다.
function render(size, { radius, artScale }) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4, step = 1 / (size * SS);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0, fgHits = 0, gr = 0, gg = 0, gb = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px * SS + sx + 0.5) * step, v = (py * SS + sy + 0.5) * step;
          const x = u * 64, y = v * 64;
          if (!inRoundedRect(x, y, radius)) continue;
          bgHits++;
          const [r, g, b] = gradient(x, y);
          gr += r; gg += g; gb += b;
          // 아트워크를 축소하려면 좌표를 반대로 확대해서 검사한다
          const ax = (x - 32) / artScale + 32, ay = (y - 32) / artScale + 32;
          if (STROKES.some((s) => distToSegment(ax, ay, s[0], s[1]) <= R)) fgHits++;
        }
      }
      const total = SS * SS, i = (py * size + px) * 4;
      if (!bgHits) continue;
      const fg = fgHits / bgHits; // 배경 안에서 흰 획이 차지하는 비율
      buf[i] = Math.round((gr / bgHits) * (1 - fg) + 255 * fg);
      buf[i + 1] = Math.round((gg / bgHits) * (1 - fg) + 255 * fg);
      buf[i + 2] = Math.round((gb / bgHits) * (1 - fg) + 255 * fg);
      buf[i + 3] = Math.round((bgHits / total) * 255);
    }
  }
  return buf;
}

const JOBS = [
  // purpose: any — 파비콘과 같은 둥근 사각형
  { file: 'icon-192.png', size: 192, radius: 14, artScale: 1 },
  { file: 'icon-512.png', size: 512, radius: 14, artScale: 1 },
  // purpose: maskable — 런처가 제 모양대로 잘라내므로 배경은 꽉 채우고
  // 아트워크는 안전 영역(가운데 80%) 안으로 넣는다
  { file: 'icon-maskable-512.png', size: 512, radius: 0, artScale: 0.66 },
  // iOS 는 스스로 모서리를 둥글게 깎으므로 정사각형 원본을 준다
  { file: 'apple-touch-icon.png', size: 180, radius: 0, artScale: 0.84 },
];

for (const job of JOBS) {
  const png = encodePng(job.size, render(job.size, job));
  fs.writeFileSync(path.join(OUT, job.file), png);
  console.log(`  ${job.file}  ${job.size}x${job.size}  ${(png.length / 1024).toFixed(1)}KB`);
}
console.log('아이콘 생성 완료');
