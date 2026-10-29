// Generates the PWA icons (PNG) with no image dependencies: rasterises a tiny
// procedural design and encodes PNG by hand via zlib.
// Usage: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const BG = [17, 18, 20];
const ROAD = [43, 44, 48];
const LINE = [217, 194, 90];
const CAR = [200, 52, 43];
const GLASS = [29, 39, 51];

/** Draw at size `s`; `pad` shrinks the art for maskable safe zones. */
function draw(s, pad = 0) {
  const px = new Uint8Array(s * s * 3);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= s || y >= s) return;
    px.set(c, (y * s + x) * 3);
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = Math.round(y0 * s); y < Math.round(y1 * s); y++)
      for (let x = Math.round(x0 * s); x < Math.round(x1 * s); x++) set(x, y, c);
  };
  const k = 1 - 2 * pad;
  const r = (x0, y0, x1, y1, c) => rect(pad + x0 * k, pad + y0 * k, pad + x1 * k, pad + y1 * k, c);

  rect(0, 0, 1, 1, BG);
  // Crossroads seen from above
  r(0.36, 0, 0.64, 1, ROAD);
  r(0, 0.36, 1, 0.64, ROAD);
  for (let i = 0; i < 1; i += 0.12) {
    if (i > 0.3 && i < 0.62) continue;
    r(0.495, i, 0.505, i + 0.06, LINE);
    r(i, 0.495, i + 0.06, 0.505, LINE);
  }
  // Car heading up, slightly right of centre line
  r(0.52, 0.3, 0.62, 0.56, CAR);
  r(0.535, 0.36, 0.605, 0.47, GLASS);
  return px;
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(s, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc(s * (s * 3 + 1));
  for (let y = 0; y < s; y++) raw.set(rgb.subarray(y * s * 3, (y + 1) * s * 3), y * (s * 3 + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size, pad] of [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.1],
]) {
  writeFileSync(new URL(name, OUT), png(size, draw(size, pad)));
  console.log('wrote', name);
}

// SVG favicon with the same design.
writeFileSync(
  new URL('icon.svg', OUT),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" fill="#111214"/>
<rect x="36" width="28" height="100" fill="#2b2c30"/><rect y="36" width="100" height="28" fill="#2b2c30"/>
<rect x="52" y="30" width="10" height="26" fill="#c8342b"/><rect x="53.5" y="36" width="7" height="11" fill="#1d2733"/>
</svg>
`,
);
console.log('wrote icon.svg');
