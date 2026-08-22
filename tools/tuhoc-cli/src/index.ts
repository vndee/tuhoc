#!/usr/bin/env bun
/**
 * `tuhoc` — the packaging CLI. The command a contributor runs before opening a
 * PR against the course registry.
 *
 * Two commands, one job each: `init` puts a valid skeleton on disk, `pack`
 * checks a directory against `packages/course-format` and writes a zip if it
 * passes. Everything about WHAT is valid lives in that package; this binary is
 * a front door, not a second opinion.
 *
 * Exit codes are the contract, and they are deliberately just two:
 *   0 — it worked
 *   1 — it did not (invalid package, bad arguments, unreadable directory)
 * A third code for "usage error" was considered and dropped: nothing in this
 * repo would branch on it, and `tuhoc pack x && git commit` has to behave the
 * same way whichever kind of failure happened.
 */

import { init } from './init.ts';
import { selfCommand } from './invocation.ts';
import type { Io } from './io.ts';
import { pack } from './pack.ts';

/**
 * `self` is how this program was actually started — see `invocation.ts`. Every
 * line below that a reader could retype is built from it, so the usage block
 * cannot drift back into advertising a `tuhoc` command that does not exist.
 */
function usage(self: string): string[] {
  return [
    'tuhoc — đóng gói course cho nền tảng tuhoc',
    '',
    'Cách dùng:',
    `  ${self} init <thư-mục>              dựng khung một course mới (hạng "content")`,
    `  ${self} pack <thư-mục> [-o out.zip] kiểm theo bộ luật rồi đóng gói thành .zip`,
    '',
    'Tuỳ chọn của pack:',
    '  -o, --out <tệp>   nơi ghi zip. Mặc định: <tên-thư-mục>.zip trong thư mục hiện tại.',
    '',
    'pack thoát 0 khi gói hợp lệ và đã ghi zip, thoát 1 kèm danh sách mọi vấn đề khi không.',
    'Mục ẩn (tên bắt đầu bằng ".") không được đóng gói; symlink bị từ chối.',
    '',
    'Định dạng gói và giải thích từng mã lỗi: docs/course-format.md',
  ];
}

const io: Io = {
  out: (line) => void process.stdout.write(`${line}\n`),
  err: (line) => void process.stderr.write(`${line}\n`),
};

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const self = selfCommand();

  if (command === undefined) {
    for (const line of usage(self)) io.err(line);
    return 1;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    for (const line of usage(self)) io.out(line);
    return 0;
  }
  if (command === 'init') return init(rest, io, self);
  if (command === 'pack') return pack(rest, io, self);

  io.err(`tuhoc: không có lệnh "${command}".`);
  io.err('');
  for (const line of usage(self)) io.err(line);
  return 1;
}

// `process.exitCode`, not `process.exit()`: `process.exit` can truncate a
// pending write to a pipe, which is exactly how a contributor ends up with an
// exit code and no explanation of it. Nothing here holds the loop open, so the
// process still ends immediately.
process.exitCode = await main(process.argv.slice(2));
