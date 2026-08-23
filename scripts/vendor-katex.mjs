#!/usr/bin/env node
/**
 * Sinh `packages/course-kit/vendor/katex.css` từ gói `katex` trên npm.
 *
 * VÌ SAO TỒN TẠI: bản vendor được commit vào git nhưng trước đây không có
 * script sinh, nên nó mục mà không cổng nào phát hiện — cả 20 khối
 * `@font-face` bị dồn thành MỘT khối (chỉ `KaTeX_AMS` sống sót, vì trong một
 * khối khai báo thì thuộc tính trùng lấy cái sau cùng), và luật gốc
 * `.katex{font:… KaTeX_Main …}` bị nuốt mất. Hệ quả: mọi công thức dựng bằng
 * phông dự phòng của trang. Đo được bằng cách so bề rộng canvas của
 * `KaTeX_Math` với một họ phông không tồn tại — chúng bằng nhau tuyệt đối.
 *
 * Phông được nhúng base64 (không phải tệp rời) vì gói khoá học xuất ra phải
 * đọc được ngoại tuyến từ một thư mục tĩnh, không qua bundler.
 * Chỉ giữ woff2; bỏ woff/ttf dự phòng để không nhân ba kích thước.
 *
 *   node scripts/vendor-katex.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps/web/node_modules/katex/dist');
const OUT = join(ROOT, 'packages/course-kit/vendor/katex.css');

const css = readFileSync(join(DIST, 'katex.min.css'), 'utf8');

let inlined = 0;
const out = css.replace(
  /src:url\(fonts\/([^)]+\.woff2)\) format\("woff2"\)(?:,url\(fonts\/[^)]+\) format\("[^"]+"\))*/g,
  (_all, file) => {
    const b64 = readFileSync(join(DIST, 'fonts', file)).toString('base64');
    inlined++;
    return `src:url(data:font/woff2;base64,${b64}) format('woff2')`;
  },
);

// ── Kiểm tra trước khi ghi: đúng những bất biến mà bản cũ vi phạm ──────────
const faces = (out.match(/@font-face/g) || []).length;
const fams = new Set([...out.matchAll(/@font-face\{font-family:"?(KaTeX_[A-Za-z0-9]+)"?/g)].map((m) => m[1]));
const hasBaseRule = /\.katex\{font:normal [^}]*KaTeX_Main/.test(out);
const version = (out.match(/\.katex-version:after\{content:"([^"]+)"\}/) || [])[1];

const problems = [];
if (faces !== 20) problems.push(`cần 20 @font-face, có ${faces}`);
if (inlined !== 20) problems.push(`cần nhúng 20 woff2, đã nhúng ${inlined}`);
if (fams.size !== 12) problems.push(`cần 12 họ phông, có ${fams.size}: ${[...fams].join(',')}`);
if (!hasBaseRule) problems.push('thiếu luật gốc `.katex{font:… KaTeX_Main …}`');
if (/url\(fonts\//.test(out)) problems.push('còn sót url(fonts/…) chưa nhúng');
if (problems.length) {
  console.error('KHÔNG ghi tệp — vi phạm bất biến:\n  ' + problems.join('\n  '));
  process.exit(1);
}

writeFileSync(OUT, out);
console.log(`đã ghi ${OUT}`);
console.log(`  katex ${version} · ${faces} @font-face · ${fams.size} họ · ${(out.length / 1024).toFixed(1)} KB`);
