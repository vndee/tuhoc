/**
 * viz-to-widgets — chuyển một course format v1 (một `viz.js` chạy toàn khoá,
 * chương đặt chỗ bằng `<div data-viz="tên">`) sang format v2 (mỗi hình là một
 * widget tự chứa `widgets/<tên>/index.html`, chương đặt chỗ bằng
 * `<div data-widget="tên">`). Xem `docs/course-format.md` §4 cho luật widget.
 *
 * Cách dùng (từ gốc repo):
 *   bun tools/viz-to-widgets/convert.ts <thư-mục-course>
 *
 * Việc nó làm, và vì sao:
 * - Tách `viz.js` bằng parser của TypeScript (không regex): mỗi lời gọi
 *   `defineViz('tên', …)` cấp cao nhất là một hình; mọi câu lệnh cấp cao nhất
 *   khác (helper, bảng dữ liệu) là phần DÙNG CHUNG và được nhúng vào MỌI
 *   widget. Không phân tích phụ thuộc: đo trên khoá đầu tiên được chuyển
 *   (44 chương, 58 hình), runtime 22 KB + dùng chung 14 KB + hình ≤ 5 KB
 *   ≈ 45 KB, dưới trần 128 KiB
 *   gần ba lần, nên độ phức tạp ấy không mua được gì.
 * - Nhúng `packages/course-kit/runtime.js` (Plot, cssv, PAL, defineViz,
 *   initViz…) nguyên văn: viz.js được viết dựa trên nó và reader v1 nạp nó
 *   bằng `<script src>`; trong sandbox không có gì để nạp, nên nó phải ở trong.
 * - Bảng biến CSS của reader.css (`--s1..s8`, `--seq-*`, `--axis`, `--good`…)
 *   được khai báo lại trong widget, sáng và tối. Iframe `sandbox="allow-scripts"`
 *   có origin mờ, KHÔNG đọc được `html[data-theme]` của trang chứa, nên tối
 *   theo `prefers-color-scheme` của hệ — đây là giới hạn đã biết (xem README
 *   cạnh tệp này), không phải sơ suất.
 * - Chỉ sinh widget cho tên mà một chương THAM CHIẾU (luật WIDGET_ORPHAN);
 *   hình không chương nào dùng (vd. `home-hero` của trang chủ v1) được liệt kê
 *   và bỏ qua.
 * - `viz.js` gốc chuyển vào `.v1/viz.js` (thư mục ẩn, `tuhoc pack` bỏ qua) để
 *   còn nguồn sinh lại; `tier` bị xoá khỏi manifest (TIER_REMOVED).
 * - Kiểm trước khi ghi: ≤ 131072 byte, không dòng nào > 500 byte, không
 *   `http://`/`https://`, không bốn API cấm — đúng bốn luật mà máy chủ sẽ đo.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// `typescript` nằm trong node_modules của apps/web (nó là devDependency của web).
import ts from '../../apps/web/node_modules/typescript/lib/typescript.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const WIDGET_MAX_BYTES = 131072;
const WIDGET_MAX_LINE_BYTES = 500;
const FORBIDDEN = ['document.cookie', 'localStorage', 'sessionStorage', 'indexedDB'];

const courseDir = process.argv[2];
if (!courseDir) {
  console.error('cách dùng: bun tools/viz-to-widgets/convert.ts <thư-mục-course>');
  process.exit(2);
}
const vizPath = join(courseDir, 'viz.js');
const legacyPath = join(courseDir, '.v1', 'viz.js');
const vizSrc = readFileSync(existsSync(vizPath) ? vizPath : legacyPath, 'utf8');
const runtime = readFileSync(join(ROOT, 'packages/course-kit/runtime.js'), 'utf8');
const css = readFileSync(join(HERE, 'widget.css'), 'utf8');

// ── 1. Tách viz.js ────────────────────────────────────────────────────────
const sf = ts.createSourceFile('viz.js', vizSrc, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
const viz = new Map<string, string>();
const shared: string[] = [];
for (const st of sf.statements) {
  const text = vizSrc.slice(st.getFullStart(), st.getEnd());
  if (
    ts.isExpressionStatement(st) &&
    ts.isCallExpression(st.expression) &&
    ts.isIdentifier(st.expression.expression) &&
    st.expression.expression.text === 'defineViz' &&
    st.expression.arguments.length > 0 &&
    ts.isStringLiteral(st.expression.arguments[0])
  ) {
    viz.set(st.expression.arguments[0].text, text);
  } else {
    shared.push(text);
  }
}
const sharedText = shared.join('\n');

// ── 2. Tên nào được chương tham chiếu ─────────────────────────────────────
const chaptersDir = join(courseDir, 'chapters');
const chapterFiles = readdirSync(chaptersDir).filter((f) => f.endsWith('.html'));
const referenced = new Set<string>();
const placeholderRe = /<div data-viz="([a-z0-9-]+)">\s*<\/div>/g;
// Chạy lại trên một course ĐÃ chuyển: chỗ đặt khi ấy là data-widget, và vẫn
// phải được tính là "chương tham chiếu" để widget không bị coi là mồ côi.
const convertedRe = /<div data-widget="([a-z0-9-]+)">\s*<\/div>/g;
for (const f of chapterFiles) {
  const html = readFileSync(join(chaptersDir, f), 'utf8');
  for (const m of html.matchAll(placeholderRe)) referenced.add(m[1]);
  for (const m of html.matchAll(convertedRe)) referenced.add(m[1]);
  const leftovers = html.replace(placeholderRe, '').match(/data-viz=/g);
  if (leftovers) throw new Error(`${f}: có ${leftovers.length} thẻ data-viz không đúng khuôn <div data-viz="…"></div>`);
}
const missing = [...referenced].filter((n) => !viz.has(n));
if (missing.length) throw new Error('chương tham chiếu hình không có trong viz.js: ' + missing.join(', '));
const orphans = [...viz.keys()].filter((n) => !referenced.has(n));

// ── 3. Sinh widget ────────────────────────────────────────────────────────
function widgetHtml(name: string, body: string): string {
  return [
    '<!doctype html>',
    '<html lang="vi">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Hình: ${name}</title>`,
    '<style>',
    css.trimEnd(),
    '</style>',
    '</head>',
    '<body>',
    `<div id="host" data-viz="${name}"></div>`,
    '<script>',
    '/* packages/course-kit/runtime.js — runtime vẽ của course-kit v1, nhúng nguyên văn. */',
    runtime.trimEnd(),
    '</script>',
    '<script>',
    '/* Phần dùng chung của viz.js (helper, bảng dữ liệu). */',
    sharedText.trim(),
    '',
    `/* Hình "${name}". */`,
    body.trim(),
    '</script>',
    '<script>',
    '/* Mount đúng một hình vào #host. Chữ báo lỗi là của gói (tiếng Việt), không của reader. */',
    'CourseKit.initViz(document.body, {',
    "  vizMissing: function (n) { return 'Gói không có hình \"' + n + '\".'; },",
    "  vizFailed: 'Hình này không chạy được trên trình duyệt của bạn.'",
    '});',
    '/* Báo chiều cao cho khung: WidgetFrame.tsx nghe tuhoc:widget-height, kẹp 160–1400px. */',
    'function reportHeight() {',
    "  parent.postMessage({ type: 'tuhoc:widget-height', height: document.documentElement.scrollHeight }, '*');",
    '}',
    'reportHeight();',
    'new ResizeObserver(reportHeight).observe(document.body);',
    '/* Vẽ lại khi hệ đổi sáng/tối: Plot đăng ký vào CourseKit.REDRAWS. */',
    "matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {",
    '  CourseKit.REDRAWS.forEach(function (r) {',
    "    if (typeof r === 'function') r(); else if (r && typeof r.render === 'function') r.render();",
    '  });',
    '});',
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function check(name: string, html: string): void {
  const bytes = Buffer.byteLength(html);
  if (bytes > WIDGET_MAX_BYTES) throw new Error(`${name}: ${bytes} byte > ${WIDGET_MAX_BYTES}`);
  html.split('\n').forEach((line, i) => {
    if (Buffer.byteLength(line) > WIDGET_MAX_LINE_BYTES) throw new Error(`${name}: dòng ${i + 1} dài ${Buffer.byteLength(line)} byte`);
  });
  if (/https?:\/\//.test(html)) throw new Error(`${name}: chứa http(s)://`);
  for (const api of FORBIDDEN) if (html.includes(api)) throw new Error(`${name}: chứa API cấm ${api}`);
}

const sizes: [string, number][] = [];
for (const name of referenced) {
  const html = widgetHtml(name, viz.get(name)!);
  check(name, html);
  const dir = join(courseDir, 'widgets', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  sizes.push([name, Buffer.byteLength(html)]);
}

// ── 4. Chương: data-viz → data-widget ─────────────────────────────────────
let replaced = 0;
for (const f of chapterFiles) {
  const p = join(chaptersDir, f);
  const html = readFileSync(p, 'utf8');
  const out = html.replace(placeholderRe, (_m, n: string) => {
    replaced++;
    return `<div data-widget="${n}"></div>`;
  });
  if (out !== html) writeFileSync(p, out);
}

// ── 5. manifest.json: bỏ tier; viz.js → .v1/ ────────────────────────────
const manifestPath = join(courseDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
const hadTier = 'tier' in manifest;
delete manifest.tier;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
if (existsSync(vizPath)) {
  mkdirSync(join(courseDir, '.v1'), { recursive: true });
  renameSync(vizPath, legacyPath);
}

sizes.sort((a, b) => b[1] - a[1]);
console.log(`widgets: ${sizes.length} (lớn nhất ${sizes[0][0]} ${sizes[0][1]} B, nhỏ nhất ${sizes.at(-1)![0]} ${sizes.at(-1)![1]} B)`);
console.log(`chương: ${chapterFiles.length}, chỗ đặt đã đổi: ${replaced}`);
console.log(`bỏ qua (không chương nào dùng): ${orphans.join(', ') || 'không'}`);
console.log(`manifest: ${hadTier ? 'đã xoá tier' : 'không có tier'}; viz.js → .v1/viz.js`);
