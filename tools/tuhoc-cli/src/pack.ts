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
import { basename, dirname, join, resolve } from 'node:path';

import { packZip, validatePackage } from './course-format.ts';
import { renderFindings } from './findings.ts';
import type { Io } from './io.ts';
import { NotADirectoryError, readPackageDir, UnpackableEntryError } from './readdir.ts';

/** How many entry names to name before saying "và N nữa". */
const SKIPPED_SHOWN = 5;

/** `a, b, c, và N nữa` — a list that stays a line however long the tree is. */
function nameSome(paths: readonly string[]): string {
  const shown = paths.slice(0, SKIPPED_SHOWN).join(', ');
  return paths.length > SKIPPED_SHOWN ? `${shown}, và ${paths.length - SKIPPED_SHOWN} nữa` : shown;
}

interface Args {
  dir: string;
  /** `-o` as given, or `null` for the default. */
  out: string | null;
}

function parseArgs(argv: string[], self: string): Args | { error: string } {
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

  if (dir === null) return { error: `thiếu thư mục course. Cách dùng: ${self} pack <thư-mục> [-o out.zip]` };
  return { dir, out };
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function pack(argv: string[], io: Io, self: string): Promise<number> {
  const parsed = parseArgs(argv, self);
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

  // Things that happened to the package on the way in. Stated, never silent —
  // and see below for why they are said twice when the pack fails.
  const notices: string[] = [];

  if (skipped.length > 0) {
    notices.push(`tuhoc pack: bỏ qua ${skipped.length} mục ẩn (tên bắt đầu bằng "."): ${nameSome(skipped)}`);
  }

  // A `.zip` inside the source directory is almost always the OUTPUT OF A
  // PREVIOUS PACK. `readdir.ts` already leaves out the one file this run is
  // about to write, but a zip from an earlier run under any other name is
  // ordinary content: it is packed, the package stays perfectly valid, and the
  // only clue is a file count that grows by one each time — until the package
  // eventually trips the 20 MB ceiling for a reason its author cannot guess.
  //
  // It is NOT dropped. Whether a file belongs in a package is the rule set's
  // question, not this CLI's, and a course that ships a real archive would lose
  // it silently — trading a loud kind of surprise for a quiet one. Saying it
  // out loud is the whole fix: the growth is only dangerous while it is
  // invisible. The scaffold README no longer teaches `pack .` from inside the
  // course directory, which is what put the zip in there to begin with.
  const zipsInside = [...files.keys()].filter((rel) => rel.toLowerCase().endsWith('.zip'));
  if (zipsInside.length > 0) {
    notices.push(`tuhoc pack: gói đang chứa ${zipsInside.length} tệp .zip: ${nameSome(zipsInside)}`);
    notices.push(
      '  Nếu đó là kết quả của lần pack trước thì xoá đi rồi chạy lại — để nguyên thì zip cũ nằm trong zip mới, và gói phình ra sau mỗi lần pack.',
    );
  }

  for (const line of notices) io.out(line);

  const result = validatePackage(files);
  if (!result.ok) {
    // stdout is what happened, stderr is what is wrong — but a notice can BE
    // the reason something is wrong (a chapter file skipped for a leading dot
    // comes back as CHAPTER_FILE_MISSING). Whoever reads only stderr — a CI
    // log, `2>&1 1>/dev/null` — must not get the finding without its cause.
    for (const line of notices) io.err(line);
    // The header and footer around `renderFindings`'s body are written here,
    // not inside that function: they are the two lines specific to PACK's
    // failure ("N problems in this directory", "no zip was written"), and
    // `publish.ts` states two different true things around the identical
    // body for a package the SERVER refused. See `renderFindings`'s own
    // comment for why that split is not duplication.
    io.err('');
    io.err(`tuhoc pack: gói KHÔNG hợp lệ — ${result.findings.length} vấn đề trong ${dir}`);
    io.err('');
    for (const line of renderFindings(result.findings, self)) io.err(line);
    io.err('Không có tệp .zip nào được ghi. Giải thích từng mã lỗi: docs/course-format.md');
    return 1;
  }

  let bytes: Uint8Array;
  try {
    bytes = packZip(files);
  } catch (e) {
    // `packZip` refuses a handful of entry names it cannot write faithfully
    // (`__proto__`). Rare, but a silent wrong archive would be worse than loud.
    // This is an error about a FILE NAME, not about course content, so it says
    // so — otherwise it is the one failure path here with no way out written on
    // it.
    io.err(`tuhoc pack: không ghi được zip: ${(e as Error).message}`);
    io.err(
      '  Cách sửa: đổi tên hoặc xoá tệp mà dòng trên nhắc tới rồi chạy lại. Tên đó không viết được vào một tệp zip đọc lại được an toàn; nội dung course không liên quan.',
    );
    return 1;
  }

  try {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, bytes);
  } catch (e) {
    // `-o dist/` is a natural thing to type and gets a raw EISDIR back, which
    // says nothing about what to do instead.
    if ((e as NodeJS.ErrnoException).code === 'EISDIR') {
      io.err(`tuhoc pack: "-o" cần đường dẫn tới một tệp .zip, nhưng ${out} là một thư mục.`);
      io.err(`  Ví dụ: -o ${join(out, `${basename(dir)}.zip`)}`);
      return 1;
    }
    io.err(`tuhoc pack: không ghi được ${out}: ${(e as Error).message}`);
    return 1;
  }

  io.out(`tuhoc pack: OK — ${files.size} tệp, ${humanBytes(bytes.byteLength)} → ${out}`);
  return 0;
}
