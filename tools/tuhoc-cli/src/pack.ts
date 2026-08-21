/**
 * `tuhoc pack <thư-mục> [-o out.zip]`
 *
 * Read the directory → hand it to `validatePackage` → write a zip if it said
 * yes, print every finding and exit 1 if it said no.
 *
 * The middle step is the whole point of this command. Nothing in this file
 * decides whether a package is valid; it asks, and then it does a good job of
 * repeating the answer. See `findings.ts` for the repeating half.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { packZip, validatePackage } from './course-format.ts';
import { renderFindings } from './findings.ts';
import type { Io } from './io.ts';
import { NotADirectoryError, readPackageDir, UnpackableEntryError } from './readdir.ts';

/** How many skipped entry names to name before saying "và N nữa". */
const SKIPPED_SHOWN = 5;

interface Args {
  dir: string;
  /** `-o` as given, or `null` for the default. */
  out: string | null;
}

function parseArgs(argv: string[]): Args | { error: string } {
  let dir: string | null = null;
  let out: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--out') {
      // Checked against `undefined` even though the type says it cannot be:
      // `noUncheckedIndexedAccess` is off, so the compiler's view of `argv[i+1]`
      // is more optimistic than `process.argv` actually is.
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { error: `"${arg}" cần một đường dẫn tệp đi kèm, ví dụ: -o course.zip` };
      }
      out = value;
      i++;
      continue;
    }
    if (arg.startsWith('-')) return { error: `tuỳ chọn không nhận ra: "${arg}"` };
    if (dir !== null) return { error: `chỉ pack được một thư mục mỗi lần; nhận được cả "${dir}" và "${arg}"` };
    dir = arg;
  }

  if (dir === null) return { error: 'thiếu thư mục course. Cách dùng: tuhoc pack <thư-mục> [-o out.zip]' };
  return { dir, out };
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function pack(argv: string[], io: Io): Promise<number> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    io.err(`tuhoc pack: ${parsed.error}`);
    return 1;
  }

  const dir = resolve(parsed.dir);
  // Resolved BEFORE the directory is read, so the walk can leave it out. That
  // is why the default name is the directory's, not the manifest's `id`: the
  // manifest is not readable yet at this point, and a default that depended on
  // it would either have to read the manifest twice or pack a stale zip from a
  // previous run.
  const out = resolve(parsed.out ?? `${basename(dir)}.zip`);

  let files: ReadonlyMap<string, Uint8Array>;
  let skipped: string[];
  try {
    ({ files, skipped } = await readPackageDir(dir, out));
  } catch (e) {
    if (e instanceof NotADirectoryError) {
      io.err(`tuhoc pack: ${e.message}: ${e.path}`);
      return 1;
    }
    if (e instanceof UnpackableEntryError) {
      io.err(`tuhoc pack: KHÔNG đóng gói được — ${e.entries.length} mục trong ${dir} không phải tệp thường:`);
      for (const entry of e.entries) io.err(`  ${entry.path} — ${entry.reason}`);
      io.err('Xoá hoặc thay chúng bằng tệp thật rồi chạy lại.');
      return 1;
    }
    io.err(`tuhoc pack: không đọc được ${dir}: ${(e as Error).message}`);
    return 1;
  }

  if (skipped.length > 0) {
    const shown = skipped.slice(0, SKIPPED_SHOWN).join(', ');
    const more = skipped.length > SKIPPED_SHOWN ? `, và ${skipped.length - SKIPPED_SHOWN} nữa` : '';
    io.out(`tuhoc pack: bỏ qua ${skipped.length} mục ẩn (tên bắt đầu bằng "."): ${shown}${more}`);
  }

  const result = validatePackage(files);
  if (!result.ok) {
    for (const line of renderFindings(dir, result.findings)) io.err(line);
    return 1;
  }

  let bytes: Uint8Array;
  try {
    bytes = packZip(files);
  } catch (e) {
    // `packZip` refuses a handful of entry names it cannot write faithfully
    // (`__proto__`). Rare, but a silent wrong archive would be worse than loud.
    io.err(`tuhoc pack: không ghi được zip: ${(e as Error).message}`);
    return 1;
  }

  try {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, bytes);
  } catch (e) {
    io.err(`tuhoc pack: không ghi được ${out}: ${(e as Error).message}`);
    return 1;
  }

  io.out(`tuhoc pack: OK — ${files.size} tệp, ${humanBytes(bytes.byteLength)} → ${out}`);
  return 0;
}
