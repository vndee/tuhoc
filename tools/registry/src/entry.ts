/**
 * "Was this module started as a program, or imported by something else?"
 *
 * Both `validate-pr.ts` and `build-index.ts` are two things at once: a library
 * a test drives in-process, and a command a workflow runs. Without this guard
 * the top-level `main()` fires the moment `vitest` imports the module, and the
 * test run picks up the CLI's exit code and its argv.
 *
 * `import.meta.main` is the one-word version and is what Bun would prefer, but
 * `@types/node@22` does not declare it (it landed in Node 24), so it does not
 * type-check under this project's `tsc -b`. `process.argv[1]` is the portable
 * question and it is one line.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isEntryPoint(moduleUrl: string): boolean {
  const started = process.argv[1];
  if (started === undefined) return false;
  return fileURLToPath(moduleUrl) === resolve(started);
}
