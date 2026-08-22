/**
 * How this CLI names itself when it tells a contributor to type something.
 *
 * ## Why this file exists
 *
 * There is no `tuhoc` executable. `package.json` declares a `bin`, but the
 * package is `private`, the repo has no npm workspaces and no root
 * `package.json` (ruling S1-F1), and nothing anywhere runs an install or a link
 * step — so `tuhoc pack my-course` is a line that exits 127 in every checkout of
 * this repo. Printing it at the end of a successful `init` sent a first-time
 * contributor to `command not found` on the very next thing they typed, using
 * the very tool that had just told them to type it.
 *
 * So the CLI stops guessing its own name and reads it off `process.argv[1]`,
 * which is by construction the thing that just worked. Run it as
 * `bun tools/tuhoc-cli/src/index.ts …` from the repo root and it says
 * `bun tools/tuhoc-cli/src/index.ts …` back; run it from somewhere else and it
 * says the absolute path, which is equally paste-able; link it onto `$PATH` some
 * day and it says `tuhoc`. Every one of those is copy-paste-runnable from the
 * cwd the message was printed in, which is the only property that matters.
 *
 * The alternative — hard-coding `make pack DIR=…` — was rejected because it is
 * only true from the repo root and only for course directories inside the repo,
 * and a message that is conditionally true is the same bug one step further on.
 */

import { basename, relative } from 'node:path';

/**
 * Used when `process.argv[1]` is missing or unusable. This is the form
 * `docs/course-format.md` documents, and it is correct from the repo root.
 */
export const DOCUMENTED_INVOCATION = 'bun tools/tuhoc-cli/src/index.ts';

/** Characters a POSIX shell passes through untouched. */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Entry points a runtime has to be named in front of. */
const SCRIPT_EXT = /\.[cm]?[jt]sx?$/;

/**
 * One shell word, quoted so that pasting it is the same as passing it as argv.
 *
 * Course directories are named by people, and people use spaces, quotes and
 * parentheses. An unquoted `Course Của Tôi` in a printed command is a command
 * that silently means something else.
 */
export function shellQuote(word: string): string {
  if (word.length > 0 && SHELL_SAFE.test(word)) return word;
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/**
 * The command prefix a contributor can retype to get this program back.
 *
 * @param argv1 normally `process.argv[1]` — the entry point the runtime loaded.
 * @param cwd   the directory the message will be printed in, and therefore the
 *              directory the printed path has to be valid from.
 */
export function selfCommand(argv1: string | undefined = process.argv[1], cwd: string = process.cwd()): string {
  if (argv1 === undefined || argv1 === '') return DOCUMENTED_INVOCATION;

  // Not a script file: this is an installed executable (a `bin` shim on $PATH),
  // and its own name is exactly what the user typed to get here.
  if (!SCRIPT_EXT.test(argv1)) return shellQuote(basename(argv1));

  // A relative path when that stays inside the tree — `bun
  // tools/tuhoc-cli/src/index.ts` is the form the docs use and the form a
  // contributor recognises. `..` chains are worse than an absolute path, so
  // those fall back to absolute.
  const rel = relative(cwd, argv1);
  const shown = rel !== '' && !rel.startsWith('..') ? rel : argv1;
  return `bun ${shellQuote(shown)}`;
}
