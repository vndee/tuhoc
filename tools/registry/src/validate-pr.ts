#!/usr/bin/env bun
/**
 * The registry PR gate — **a convenience check, not the safety net anymore**.
 *
 * This file's original header said `apps/api/internal/course/usecase.go:26-34`
 * "deliberately does not run the HTML rule set, and delegates that job to the
 * registry." That package no longer exists. The 2026-08-25 server-side pivot
 * (`docs/superpowers/specs/2026-08-25-server-side-pivot.md` §2.2, §33) moved
 * publishing itself onto the server: `PUT /admin/courses/:slug`
 * (`apps/api/internal/catalog/usecase.go`'s `publishZip`) runs
 * `pkgcheck.Validate` — the same rule set, ported to Go — on **every** publish
 * and **every** rollback, unconditionally, regardless of whether the zip came
 * from `tuhoc publish` or the admin CMS. The spec says so in as many words:
 * *"cổng thật giờ nằm ở server"* — the real gate now lives on the server. No
 * package reaches the catalog without passing there, whether or not this file
 * ever ran.
 *
 * So why does this file still exist? Because "only we publish, the community
 * contributes by PR into the source repo" (spec, decision table) still leaves
 * a real, if smaller, job: catching a bad package **before** it is merged,
 * not after a maintainer has already tried to publish it and gotten a 400.
 * That is a genuine convenience, and the alternative — the eventual course
 * source repo's own CI hand-rolling changed-file detection and anti-blind-gate
 * checks from scratch — is exactly the "second copy that drifts" this
 * subsystem's other files (`tree.ts`, `course-format.ts`) already argue
 * against. Keeping one tested, CI-shaped implementation here, ready to be
 * pointed at whatever root a source repo's workflow checks out, costs less
 * than reinventing it later.
 *
 * What died with the pivot: `build-index.ts` and `pack-site.ts` (Task 17 of
 * the pivot removed both). Both existed to publish a catalog — `index.json`
 * plus per-version `.zip` archives — to GitHub Pages, because the community
 * registry WAS the catalog. The catalog is now `/courses`, served from
 * Postgres by `apps/api`; nothing reads a registry-published `index.json` or
 * pulls a package from a registry-hosted archive any more (`apps/web` brings
 * a package in through exactly one door now: the server). Building either
 * artifact here would be publishing a catalog nobody reads.
 *
 * What runs here is `packages/course-format`'s `validatePackage`, reached
 * through `course-format.ts`, which is the one place the path is written. There
 * is no rule in this file. If you are about to add one, read
 * `course-format.ts`'s header first: the measured cost of the last three copies
 * was disagreement on 7 of 12 rows, with the third copy asserting in a comment
 * that it matched.
 *
 * ## Exit codes — the contract
 *
 *   0 — every changed course passed, OR the PR changed no course at all
 *       (and then it says so, naming the root it looked under and how many
 *       files it saw)
 *   1 — a finding, or the scan could not be trusted
 *
 * ## Usage
 *
 *   bun tools/registry/src/validate-pr.ts --root fixtures/courses [--changed-from <file>]
 *
 * With no `--changed-from`, every course under the root is validated — which is
 * what a scheduled run or a local `make test-registry` wants. With one, only
 * the courses the PR touched are, and the file is the output of
 * `git diff --name-only`.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { isEntryPoint } from './entry.ts';
import { courseDirsUnder, inspectCourse, NothingScannedError, renderFinding } from './tree.ts';
import type { RegistryFinding } from './tree.ts';

/**
 * Runs the rule set over every package in every named course directory.
 *
 * @throws {NothingScannedError} `dirs` is empty — see that class for why this
 * is not an empty result. The caller decides what "nothing to do" means and has
 * to say it out loud.
 */
export async function validateChangedCourses(dirs: readonly string[]): Promise<RegistryFinding[]> {
  if (dirs.length === 0) throw new NothingScannedError();

  const findings: RegistryFinding[] = [];
  for (const dir of dirs) {
    const inspection = await inspectCourse(dir);
    findings.push(...inspection.findings);
  }
  return findings;
}

/**
 * Changed file paths → the course directories they belong to, deduplicated and
 * sorted.
 *
 * Both arguments are repo-relative, `/`-separated, exactly as
 * `git diff --name-only` prints them.
 *
 * Two things it deliberately does:
 *
 *   - a file sitting DIRECTLY in the root (`<root>/README.md`) yields nothing —
 *     it is not a course;
 *   - a deleted file still yields its directory. The directory may be gone, and
 *     that comes back as `REGISTRY_UNREADABLE_DIR` rather than as silence,
 *     because "the course that was there is now unreadable" is exactly the
 *     state a reviewer must be shown.
 */
export function changedCourseDirs(changedFiles: readonly string[], registryRoot: string): string[] {
  const root = registryRoot.replace(/\/+$/, '');
  const prefix = `${root}/`;
  const dirs = new Set<string>();

  for (const file of changedFiles) {
    const path = file.trim();
    if (path === '' || !path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    // No slash left ⇒ the file is directly in the root, not inside a course.
    if (slash <= 0) continue;
    dirs.add(`${root}/${rest.slice(0, slash)}`);
  }

  return [...dirs].sort();
}

interface Args {
  root: string;
  changedFrom: string | null;
}

function parseArgs(argv: string[]): Args | { error: string } {
  let root: string | null = null;
  let changedFrom: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--root') {
      if (value === undefined || value.startsWith('--')) return { error: '"--root" cần một đường dẫn đi kèm' };
      root = value;
      i++;
      continue;
    }
    if (arg === '--changed-from') {
      if (value === undefined || value.startsWith('--')) return { error: '"--changed-from" cần một đường dẫn tệp đi kèm' };
      changedFrom = value;
      i++;
      continue;
    }
    return { error: `tuỳ chọn không nhận ra: "${arg}"` };
  }

  if (root === null) return { error: 'thiếu --root <thư-mục-registry>' };
  return { root, changedFrom };
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    process.stderr.write(`validate-pr: ${parsed.error}\n`);
    return 1;
  }
  const { root, changedFrom } = parsed;

  // ── Anti-blind-gate check #1, and it runs on EVERY invocation ────────────
  // Even when the PR touched no course, the root itself must be a populated
  // registry. A workflow pointed one directory too high, a renamed root, a
  // checkout that did not fetch the tree — all of them look identical to "this
  // PR changed nothing relevant", and all of them would otherwise be green
  // forever. `courseDirsUnder` throws instead of returning `[]`.
  let allCourses: string[];
  try {
    allCourses = await courseDirsUnder(resolve(root));
  } catch (e) {
    process.stderr.write(`validate-pr: KHÔNG kiểm được — ${(e as Error).message}\n`);
    return 1;
  }
  process.stdout.write(`validate-pr: registry root ${root} có ${allCourses.length} course.\n`);

  let dirs: string[];
  if (changedFrom === null) {
    dirs = allCourses;
    process.stdout.write(`validate-pr: không có --changed-from → kiểm TOÀN BỘ ${dirs.length} course.\n`);
  } else {
    let raw: string;
    try {
      raw = await readFile(changedFrom, 'utf8');
    } catch (e) {
      process.stderr.write(`validate-pr: không đọc được ${changedFrom}: ${(e as Error).message}\n`);
      return 1;
    }
    const changedFiles = raw.split('\n').map((l) => l.trim()).filter((l) => l !== '');

    // ── Anti-blind-gate check #2 ──────────────────────────────────────────
    // A pull request changes at least one file. An empty list means the diff
    // plumbing failed — wrong base ref, `fetch-depth: 1`, a merge commit
    // compared against itself — and every one of those ends with "0 courses to
    // check" and a green tick.
    if (changedFiles.length === 0) {
      process.stderr.write(
        `validate-pr: ${changedFrom} rỗng. Một PR luôn đổi ít nhất một tệp, nên đây là lỗi của chính phép lấy diff ` +
          '(sai base ref, hoặc checkout nông), không phải "không có gì để kiểm".\n',
      );
      return 1;
    }

    dirs = changedCourseDirs(changedFiles, root).map((d) => resolve(d));

    if (dirs.length === 0) {
      // A stated skip, not a pass. It names the root, the count, and a sample,
      // so a misconfigured root is visible in the log instead of invisible.
      process.stdout.write(
        `validate-pr: BỎ QUA — PR đổi ${changedFiles.length} tệp, không tệp nào nằm dưới ${root}/<id>/.\n`,
      );
      for (const f of changedFiles.slice(0, 10)) process.stdout.write(`  đã đổi: ${f}\n`);
      if (changedFiles.length > 10) process.stdout.write(`  … và ${changedFiles.length - 10} tệp nữa\n`);
      return 0;
    }
    process.stdout.write(`validate-pr: PR đụng ${dirs.length} course:\n`);
    for (const d of dirs) process.stdout.write(`  ${d}\n`);
  }

  let findings: RegistryFinding[];
  try {
    findings = await validateChangedCourses(dirs);
  } catch (e) {
    if (e instanceof NothingScannedError) {
      process.stderr.write(`validate-pr: ${e.message}\n`);
      return 1;
    }
    throw e;
  }

  if (findings.length > 0) {
    process.stderr.write(`validate-pr: TỪ CHỐI — ${findings.length} vấn đề:\n`);
    for (const f of findings) process.stderr.write(`${renderFinding(f)}\n`);
    process.stderr.write('Giải thích từng mã: docs/course-format.md\n');
    return 1;
  }

  process.stdout.write(`validate-pr: OK — ${dirs.length} course đạt bộ luật packages/course-format.\n`);
  return 0;
}

// Only when run as a program, never when imported by a test.
//
// `process.exitCode`, not `process.exit()`: `process.exit` can truncate a
// pending write to a pipe, which is how a CI job ends up with a red tick and an
// empty log — see `tools/tuhoc-cli/src/index.ts`, same reasoning.
//
// `import.meta.main` would be shorter and is a Bun/Node-24 global that
// `@types/node@22` does not declare, so it would not type-check.
if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
