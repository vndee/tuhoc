/**
 * `tuhoc publish <tệp.zip> --server <url>`
 *
 * The author's road onto our own server. `pack` proves a package passes the
 * rule set on THIS machine; `publish` is the one command that puts it
 * somewhere anyone else can read it. The server re-runs the identical rule
 * set before it stores anything (Task 8 of the server-side pivot), so this
 * file does not validate — it is a transport, the same way `pack` is a front
 * door onto `validatePackage` and not a second opinion of its own.
 *
 * ## The slug
 *
 * There is no `slug` field anywhere in a manifest. The identifier a course
 * ships under is `manifest.id`; the server names its URL and its own column
 * `slug`, and the rule the server enforces is `slug === manifest.id`, always
 * (a mismatch is a 400). So the slug in the URL below is read out of the zip
 * itself, never typed on the command line — there is nowhere left for the two
 * to disagree.
 *
 * ## Two things named "version"
 *
 * The manifest's `version` is the author's own semver (`"1.0.0"`). The
 * `version` in a 201 response is a different number the SERVER owns — a
 * publish sequence starting at 1 and incrementing on every publish after.
 * This file prints the server's integer, never the manifest's semver: the
 * question this command answers is "which publish was this", not "what does
 * the author call it".
 *
 * ## The token
 *
 * Read from `TUHOC_ADMIN_TOKEN` in the environment, never from a flag: a flag
 * lands in shell history and in `ps` output for as long as this process
 * runs, an environment variable set in the same shell does neither. Never
 * printed, in any message, not even in the ones about the token itself.
 *
 * ## The error report
 *
 * A 400 response carries the exact `{code, path, detail}` shape
 * `validatePackage` produces locally (the server runs the same rule set), so
 * it is rendered through the same `renderFindings` body `pack.ts` uses — see
 * that function's own comment for why the header and footer around it live
 * in each caller instead of in `findings.ts`: "no zip was written" and "no
 * package was stored on the server" are two different true things about two
 * different failures, and printing whichever one did not happen would not be
 * reuse, it would be a wrong sentence borrowed from a neighbour.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { type Finding, MANIFEST_PATH, parseManifest, unpackZip } from './course-format.ts';
import { renderFindings } from './findings.ts';
import type { Io } from './io.ts';

const decoder = new TextDecoder('utf-8');

interface Args {
  zipPath: string;
  server: string;
}

function parseArgs(argv: string[], self: string): Args | { error: string } {
  let zipPath: string | null = null;
  let server: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--server') {
      // Checked against `undefined` even though the type says it cannot be —
      // same reasoning as `pack.ts`'s identical guard on `-o`:
      // `noUncheckedIndexedAccess` is off, so the compiler is more optimistic
      // about `argv[i + 1]` than `process.argv` actually is.
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { error: '"--server" cần một địa chỉ đi kèm, ví dụ: --server https://tuhoc.example.com' };
      }
      server = value;
      i++;
      continue;
    }
    if (arg.startsWith('-')) return { error: `tuỳ chọn không nhận ra: "${arg}"` };
    if (zipPath !== null) return { error: `chỉ publish được một tệp mỗi lần; nhận được cả "${zipPath}" và "${arg}"` };
    zipPath = arg;
  }

  if (zipPath === null) {
    return { error: `thiếu tệp .zip. Cách dùng: ${self} publish <tệp.zip> --server <url>` };
  }
  if (server === null) {
    return { error: `thiếu "--server <url>". Cách dùng: ${self} publish <tệp.zip> --server <url>` };
  }
  return { zipPath, server };
}

interface PublishSuccess {
  slug?: unknown;
  version?: unknown;
}

interface PublishRejection {
  error?: unknown;
  findings?: unknown;
}

/** A `Finding`-shaped value from JSON the server sent — checked, not trusted, before it is printed. */
function isFinding(v: unknown): v is Finding {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['code'] === 'string' &&
    typeof (v as Record<string, unknown>)['path'] === 'string' &&
    typeof (v as Record<string, unknown>)['detail'] === 'string'
  );
}

export async function publish(argv: string[], io: Io, self: string): Promise<number> {
  const parsed = parseArgs(argv, self);
  if ('error' in parsed) {
    io.err(`tuhoc publish: ${parsed.error}`);
    return 1;
  }

  // Checked BEFORE anything that touches the network or even the zip file:
  // the one promise this branch makes is that a missing token never gets as
  // far as `fetch`.
  const token = process.env['TUHOC_ADMIN_TOKEN'];
  if (token === undefined || token === '') {
    io.err('tuhoc publish: thiếu biến môi trường TUHOC_ADMIN_TOKEN.');
    io.err('  Lấy token quản trị của bạn rồi chạy lại, ví dụ:');
    io.err(`    TUHOC_ADMIN_TOKEN=... ${self} publish ${parsed.zipPath} --server ${parsed.server}`);
    io.err('  Không đặt token trực tiếp trên dòng lệnh dưới dạng tham số — nó sẽ lộ ra lịch sử shell.');
    return 1;
  }

  const zipPath = resolve(parsed.zipPath);
  let zipBytes: Uint8Array;
  try {
    zipBytes = await readFile(zipPath);
  } catch (e) {
    io.err(`tuhoc publish: không đọc được ${zipPath}: ${(e as Error).message}`);
    return 1;
  }

  let files: Map<string, Uint8Array>;
  try {
    files = unpackZip(zipBytes);
  } catch (e) {
    io.err(`tuhoc publish: ${zipPath} không phải một gói .zip đọc được: ${(e as Error).message}`);
    io.err(`  Đóng gói lại bằng \`${self} pack <thư-mục>\` rồi thử lại.`);
    return 1;
  }

  const manifestBytes = files.get(MANIFEST_PATH);
  if (manifestBytes === undefined) {
    io.err(`tuhoc publish: ${zipPath} không có ${MANIFEST_PATH} ở gốc gói.`);
    return 1;
  }
  const manifestResult = parseManifest(decoder.decode(manifestBytes));
  if ('error' in manifestResult) {
    io.err(`tuhoc publish: ${MANIFEST_PATH} trong ${zipPath} không hợp lệ: ${manifestResult.error.detail}`);
    io.err(`  Đóng gói lại bằng \`${self} pack <thư-mục>\` — lệnh đó kiểm manifest trước khi ghi zip.`);
    return 1;
  }
  // The slug the URL below addresses — read out of the package, never off the
  // command line. See this file's header: there is nowhere for the two to
  // disagree because there is only ever one value.
  const slug = manifestResult.manifest.id;

  const url = `${parsed.server.replace(/\/+$/, '')}/admin/courses/${encodeURIComponent(slug)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/zip',
      },
      body: zipBytes,
    });
  } catch (e) {
    io.err(`tuhoc publish: không kết nối được tới ${parsed.server}: ${(e as Error).message}`);
    return 1;
  }

  if (res.status === 201) {
    let body: PublishSuccess;
    try {
      body = (await res.json()) as PublishSuccess;
    } catch (e) {
      io.err(`tuhoc publish: máy chủ báo đã lưu (201) nhưng phản hồi không đọc được: ${(e as Error).message}`);
      return 1;
    }
    if (typeof body.version !== 'number') {
      io.err('tuhoc publish: máy chủ báo đã lưu (201) nhưng phản hồi không có "version" dạng số.');
      return 1;
    }
    const reportedSlug = typeof body.slug === 'string' ? body.slug : slug;
    io.out(`tuhoc publish: đã publish ${reportedSlug} v${body.version}`);
    return 0;
  }

  if (res.status === 401 || res.status === 403) {
    io.err(`tuhoc publish: máy chủ từ chối token quản trị (mã ${res.status}).`);
    io.err('  Kiểm tra biến môi trường TUHOC_ADMIN_TOKEN đúng và còn hiệu lực — token không được in ra ở đây.');
    return 1;
  }

  if (res.status === 400) {
    let body: PublishRejection;
    try {
      body = (await res.json()) as PublishRejection;
    } catch (e) {
      io.err(`tuhoc publish: máy chủ từ chối gói (mã 400) nhưng phản hồi không đọc được: ${(e as Error).message}`);
      return 1;
    }
    const findings = Array.isArray(body.findings) ? body.findings.filter(isFinding) : [];
    const reason = typeof body.error === 'string' ? ` — ${body.error}` : '';
    const count = findings.length > 0 ? ` — ${findings.length} vấn đề` : '';

    io.err('');
    io.err(`tuhoc publish: máy chủ từ chối gói "${slug}"${reason}${count}`);
    if (findings.length > 0) {
      io.err('');
      for (const line of renderFindings(findings, self)) io.err(line);
    }
    io.err('Chưa gói nào được lưu trên máy chủ. Giải thích từng mã lỗi: docs/course-format.md');
    return 1;
  }

  io.err(`tuhoc publish: máy chủ trả về mã không mong đợi: ${res.status}`);
  return 1;
}
