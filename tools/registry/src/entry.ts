/**
 * "Was this module started as a program, or imported by something else?"
 *
 * `validate-pr.ts` is two things at once: a library a test drives in-process,
 * and a command a workflow runs. Without this guard the top-level `main()`
 * fires the moment `vitest` imports the module, and the test run picks up the
 * CLI's exit code and its argv. (Written when `build-index.ts` also used this
 * guard, for the same reason — task 17 of the server-side pivot removed that
 * file; the guard itself is unchanged and general, so it stayed a one-liner
 * rather than being narrowed to a single caller.)
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
