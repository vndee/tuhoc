/**
 * `tuhoc init <thư-mục>` — the scaffold.
 *
 * ## The one thing this file must never get wrong
 *
 * `tuhoc init X && tuhoc pack X` has to exit 0. A template that does not pass
 * the rule set puts an error in front of the very first contributor, on the
 * very first command, about a file they did not write — and that contributor
 * is the difference between a registry with one course in it and a registry
 * with two. `pack.test.ts` runs exactly that sequence, so the templates cannot
 * drift away from the rules without the gate going red.
 *
 * The template is therefore written under the CONTENT tier — the strict one —
 * even though `interactive` would be easier to keep valid. `tier: "content"` is
 * also what the template ships as, because the safe tier is the right default:
 * a contributor who never thinks about tiers ends up with the package that
 * costs a reader the least trust, and the one the registry can merge
 * mechanically.
 *
 * Corollary that is easy to miss: `README.md` is IN the package, and the
 * content-tier rules read every entry, not just `.html`. So the template README
 * contains no `<` at all — a code sample showing a script tag would make the
 * scaffold fail its own gate.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Io } from './io.ts';
import { readPackageDir } from './readdir.ts';

const TEMPLATE_DIR = fileURLToPath(new URL('../templates/course', import.meta.url));

const decoder = new TextDecoder('utf-8');

/**
 * Directory name → manifest `id`.
 *
 * Vietnamese tone marks are combining characters after NFD, so stripping
 * U+0300–U+036F turns "Của" into "Cua"; `đ`/`Đ` have no decomposition and are
 * mapped by hand. Everything else collapses to `-`.
 */
function slug(raw: string): string {
  const ascii = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
    .toLowerCase();
  return ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Directory name → manifest `title`, which is also substituted into HTML.
 *
 * `<`, `>`, `&`, quotes and backslashes are dropped rather than escaped: the
 * same string goes into a JSON string and into an HTML fragment, and a
 * directory called `a"b` or `<script>` must not be able to turn the scaffold
 * into a package that fails its own validation. It is a placeholder the author
 * renames in the first minute anyway.
 */
function displayTitle(raw: string): string {
  const clean = raw
    .replace(/[\u0000-\u001f<>&"'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > 0 ? clean : 'Course mới';
}

function parseArgs(argv: string[]): { dir: string } | { error: string } {
  const positional = argv.filter((a) => !a.startsWith('-'));
  const flag = argv.find((a) => a.startsWith('-'));
  if (flag !== undefined) return { error: `tuỳ chọn không nhận ra: "${flag}"` };
  const dir = positional[0];
  if (dir === undefined) return { error: 'thiếu thư mục đích. Cách dùng: tuhoc init <thư-mục>' };
  if (positional.length > 1) return { error: 'chỉ init được một thư mục mỗi lần' };
  return { dir };
}

export async function init(argv: string[], io: Io): Promise<number> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    io.err(`tuhoc init: ${parsed.error}`);
    return 1;
  }

  const dir = resolve(parsed.dir);
  const name = basename(dir);
  const id = slug(name) || 'course-moi';
  const title = displayTitle(name);

  let template;
  try {
    template = await readPackageDir(TEMPLATE_DIR, null);
  } catch (e) {
    io.err(`tuhoc init: không đọc được khung mẫu ở ${TEMPLATE_DIR}: ${(e as Error).message}`);
    return 1;
  }

  const rendered = new Map<string, string>();
  for (const [rel, bytes] of template.files) {
    rendered.set(rel, decoder.decode(bytes).replaceAll('{{id}}', id).replaceAll('{{title}}', title));
  }

  // Check everything before writing anything: a half-scaffolded directory with
  // one of the author's own files clobbered is a worse outcome than doing
  // nothing, and "nothing was touched" is only true if the check is complete
  // before the first write.
  const existing: string[] = [];
  for (const rel of rendered.keys()) {
    try {
      await stat(join(dir, ...rel.split('/')));
      existing.push(rel);
    } catch {
      /* absent, which is what we want */
    }
  }
  if (existing.length > 0) {
    io.err(`tuhoc init: ${dir} đã có sẵn ${existing.length} tệp mà khung mẫu sẽ ghi đè:`);
    for (const rel of existing) io.err(`  ${rel}`);
    io.err('Không sửa gì cả. Chọn thư mục khác, hoặc xoá/đổi tên các tệp trên rồi chạy lại.');
    return 1;
  }

  try {
    for (const [rel, content] of rendered) {
      const abs = join(dir, ...rel.split('/'));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
    }
  } catch (e) {
    io.err(`tuhoc init: không ghi được vào ${dir}: ${(e as Error).message}`);
    return 1;
  }

  io.out(`tuhoc init: đã dựng khung course "${id}" trong ${dir}`);
  for (const rel of [...rendered.keys()].sort()) io.out(`  ${rel}`);
  io.out('');
  io.out('Tiếp theo:');
  io.out('  1. Sửa manifest.json — title, description, license, authors, generatedBy.');
  io.out('  2. Viết chương trong chapters/, và khai báo từng chương trong "parts".');
  io.out(`  3. Chạy \`tuhoc pack ${parsed.dir}\` để kiểm và đóng gói.`);
  io.out('Định dạng đầy đủ: docs/course-format.md');
  return 0;
}
