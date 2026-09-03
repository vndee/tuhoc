/**
 * Sinh trọn bộ biểu tượng từ MỘT hình học: `MARK` trong src/shell/Logo.tsx.
 *
 * Chạy:  node scripts/gen-icons.mjs      (từ apps/web)
 * Cần:   rsvg-convert  (brew install librsvg)
 *
 * Vì sao có tệp này thay vì vẽ tay từng icon: trong vòng dựng mark, tệp
 * biểu tượng và component đã trôi khỏi nhau HAI lần — favicon mang một hình,
 * thanh điều hướng mang hình khác, và không gì báo. `Logo.icons.test.ts`
 * canh favicon.svg khớp `MARK`; script này là cách hợp lệ duy nhất để sinh
 * lại bốn tệp PNG. Đừng sửa PNG bằng trình đồ hoạ.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// `ICON_OUT` cho phép sinh ra một thư mục khác — đó là cách `Logo.icons.test.ts`
// sinh lại vào thư mục tạm rồi so từng byte với tệp đã ship, nên "sửa component
// mà quên sinh lại" thành một bài test đỏ thay vì một lỗi không ai thấy.
const PUBLIC = process.env.ICON_OUT ?? path.join(HERE, '..', 'public');
fs.mkdirSync(PUBLIC, { recursive: true });

// Đọc MARK thẳng từ nguồn: script không được giữ bản sao của hình học.
const src = fs.readFileSync(path.join(HERE, '..', 'src', 'shell', 'Logo.tsx'), 'utf8');
const grab = (re, name) => {
  const m = src.match(re);
  if (!m) throw new Error(`gen-icons: khong doc duoc ${name} tu Logo.tsx`);
  return Number(m[1]);
};
const M = {
  fx: grab(/frame: \{ x: ([\d.]+)/, 'frame.x'),
  fy: grab(/frame: \{ x: [\d.]+, y: ([\d.]+)/, 'frame.y'),
  fw: grab(/frame: \{ x: [\d.]+, y: [\d.]+, w: ([\d.]+)/, 'frame.w'),
  fh: grab(/frame: \{ x: [\d.]+, y: [\d.]+, w: [\d.]+, h: ([\d.]+)/, 'frame.h'),
  fo: grab(/opacity: ([\d.]+) \}/, 'frame.opacity'),
  bcx: grab(/bar: \{ cx: ([\d.]+)/, 'bar.cx'),
  by: grab(/bar: \{ cx: [\d.]+, y: ([\d.]+)/, 'bar.y'),
  bh: grab(/bar: \{ cx: [\d.]+, y: [\d.]+, h: ([\d.]+)/, 'bar.h'),
  boxed: grab(/inset: \{ boxed: ([\d.]+)/, 'inset.boxed'),
  icon: grab(/inset: \{ boxed: [\d.]+, icon: ([\d.]+)/, 'inset.icon'),
  maskable: grab(/maskable: ([\d.]+) \}/, 'inset.maskable'),
};
const GROUND = src.match(/MARK_ICON_GROUND = '([^']+)'/)[1];
const INK = src.match(/MARK_ICON_INK = '([^']+)'/)[1];

/** Bề dày phải khớp `weightFor` trong Logo.tsx cho cỡ render tương ứng. */
const svg = (px, inset, bar, frame) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 16 16">` +
  `<rect width="16" height="16" fill="${GROUND}"/>` +
  `<g transform="translate(8,8) scale(${inset}) translate(-8,-8)">` +
  `<rect x="${M.fx}" y="${M.fy}" width="${M.fw}" height="${M.fh}" fill="none" ` +
  `stroke="${INK}" stroke-width="${frame}" opacity="${M.fo}"/>` +
  `<rect x="${+(M.bcx - bar / 2).toFixed(4)}" y="${M.by}" width="${bar}" height="${M.bh}" fill="${INK}"/>` +
  `</g></svg>`;

fs.writeFileSync(path.join(PUBLIC, 'favicon.svg'), svg(16, M.boxed, 2.8, 1.2));
console.log('favicon.svg');

for (const [name, px, inset, bar, frame] of [
  ['apple-touch-icon.png', 180, M.icon, 2.9, 1.4],
  ['icon-192.png', 192, M.icon, 2.9, 1.4],
  ['icon-512.png', 512, M.icon, 2.8, 1.4],
  ['icon-maskable-512.png', 512, M.maskable, 2.8, 1.4],
]) {
  const tmp = path.join(PUBLIC, `.${name}.tmp.svg`);
  fs.writeFileSync(tmp, svg(px, inset, bar, frame));
  execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px), tmp, '-o', path.join(PUBLIC, name)]);
  fs.unlinkSync(tmp);
  console.log(name, `${px}x${px}`);
}
