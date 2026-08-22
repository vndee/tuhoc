#!/usr/bin/env bun
/**
 * `index.json` — one file, one request.
 *
 * The platform browses the catalog by fetching exactly this file from GitHub
 * Pages: CDN-cached, no per-IP rate limit the way the GitHub API has, and a
 * self-hosted install reads the same public URL read-only.
 *
 * ## Two invariants, both of them things this project has already got wrong
 *
 * 1. **Versions are ordered by SEMVER, never by string.** `"1.10.0" < "1.9.0"`
 *    is true in JavaScript, and this repo has walked into it twice already
 *    (Go, and `scripts/course_workspace.py:173`, whose comment names the trap).
 *    See `semver.ts`; there is no lexicographic fallback anywhere.
 *
 * 2. **The index carries `schema`.** An older platform meeting a newer index
 *    must break loudly rather than guess. A missing field that a reader treats
 *    as `undefined` and carries on with is how `api.get<T>` handed a chunk of
 *    HTML to `.map` and blanked the page (commit 815a472).
 *
 * ## The index is built from the SAME rule set the PR gate runs
 *
 * `inspectCourse` validates before it reports, and `buildIndex` refuses to emit
 * an index containing a package with findings. Otherwise the gate and the
 * catalog could disagree about what is publishable — the drift this whole
 * subsystem exists to prevent, just with a longer feedback loop.
 */

import { execFile } from 'node:child_process';
import { stat, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { Author, GeneratedBy, Tier } from './course-format.ts';
import { isEntryPoint } from './entry.ts';
import { compareSemver, sortSemverAscending } from './semver.ts';
import { courseDirsUnder, inspectCourse, renderFinding } from './tree.ts';
import type { CoursePackage, RegistryFinding } from './tree.ts';

/**
 * The format version of `index.json`.
 *
 * Bump it when a reader that does not know about the change would misread the
 * file — not for an added optional field, which an old reader ignores safely.
 * `apps/web` must refuse an index whose `schema` it does not know, and say the
 * platform needs updating, rather than reading what it recognises.
 */
export const INDEX_SCHEMA = 1;

export interface RegistryEntry {
  /** The directory the course is published under; equal to `manifest.id`, checked. */
  id: string;
  title: string;
  description: string;
  /** A LABEL, from the manifest. Nothing translates on it; the catalog filters and displays it. */
  lang: string;
  /** Security posture, not a content category. `content` ships no JS; `interactive` may. */
  tier: Tier;
  license: string;
  authors: Author[];
  generatedBy: GeneratedBy;
  /** Every published version, oldest first, ordered by SEMVER PRECEDENCE. */
  versions: string[];
  /** The last element of `versions`. Named separately so a reader never has to re-derive the order. */
  latest: string;
  /** Decoded size of the `latest` package, in bytes — the axis `MAX_UNCOMPRESSED_BYTES` budgets. */
  bytes: number;
  /** ISO-8601. See {@link BuildIndexOptions.updatedAt} for where it comes from. */
  updatedAt: string;
}

export interface RegistryIndex {
  schema: number;
  /** When this index was generated, ISO-8601. */
  generatedAt: string;
  courses: RegistryEntry[];
}

export interface BuildIndexOptions {
  /**
   * When a course last changed, as ISO-8601.
   *
   * Injected because the obvious source — file mtime — is wrong in CI: a fresh
   * `git checkout` stamps every file with the checkout time, so an index built
   * on CI would say every course changed at once, and would differ byte-for-byte
   * between two builds of the same commit. The workflow passes the git commit
   * date instead. The default here is the newest mtime under the course, which
   * is the right answer on a contributor's own machine.
   */
  updatedAt?: (courseDir: string) => Promise<string>;
  /** When this index was generated. Injected for the same determinism reason. */
  generatedAt?: () => string;
}

/** Newest mtime under a course directory. Local default only — see the note above. */
async function newestMtime(pkgs: readonly CoursePackage[]): Promise<string> {
  let newest = 0;
  for (const pkg of pkgs) {
    for (const rel of pkg.files.keys()) {
      const info = await stat(resolve(pkg.dir, rel));
      const ms = info.mtimeMs;
      if (ms > newest) newest = ms;
    }
  }
  return new Date(newest).toISOString();
}

export class InvalidRegistryError extends Error {
  readonly findings: readonly RegistryFinding[];

  constructor(findings: readonly RegistryFinding[]) {
    super(
      `${findings.length} vấn đề — không sinh index từ một cây có gói không hợp lệ:\n` +
        findings.map(renderFinding).join('\n'),
    );
    this.name = 'InvalidRegistryError';
    this.findings = findings;
  }
}

/**
 * Reads the whole registry tree and returns the index.
 *
 * @throws {EmptyRegistryError} the root holds no course. Publishing an empty
 * index over a good one is the loudest possible version of this project's
 * five recorded blind gates, so it is refused rather than written.
 * @throws {InvalidRegistryError} any package in the tree has a finding. The
 * index and the PR gate run the same rules; they may not disagree.
 */
export async function buildIndex(root: string, options: BuildIndexOptions = {}): Promise<RegistryIndex> {
  const courseDirs = await courseDirsUnder(resolve(root));

  const findings: RegistryFinding[] = [];
  const courses: RegistryEntry[] = [];

  for (const dir of courseDirs) {
    const inspection = await inspectCourse(dir);
    if (inspection.findings.length > 0) {
      findings.push(...inspection.findings);
      continue;
    }

    const byVersion = new Map<string, CoursePackage>();
    for (const pkg of inspection.packages) byVersion.set(pkg.manifest.version, pkg);
    const versions = sortSemverAscending([...byVersion.keys()]);
    const latest = versions[versions.length - 1];
    if (latest === undefined) {
      // Unreachable via `inspectCourse`, which reports REGISTRY_NO_PACKAGE
      // rather than returning an empty package list without a finding. Kept
      // because "silently absent from the catalog" is the failure this whole
      // file is written against.
      throw new Error(`${dir}: không có phiên bản nào đọc được`);
    }
    const newest = byVersion.get(latest) as CoursePackage;
    const m = newest.manifest;

    courses.push({
      id: inspection.id,
      title: m.title,
      description: m.description,
      lang: m.lang,
      tier: m.tier,
      license: m.license,
      authors: m.authors,
      generatedBy: m.generatedBy,
      versions,
      latest,
      bytes: newest.bytes,
      updatedAt: options.updatedAt ? await options.updatedAt(dir) : await newestMtime(inspection.packages),
    });
  }

  if (findings.length > 0) throw new InvalidRegistryError(findings);

  // `courseDirsUnder` already sorts by directory name and `id` equals the
  // directory name, so this is a re-assertion rather than a re-sort: the index
  // must not depend on what the filesystem felt like returning.
  courses.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    schema: INDEX_SCHEMA,
    generatedAt: options.generatedAt ? options.generatedAt() : new Date().toISOString(),
    courses,
  };
}

/** Exported so a caller can order versions without importing `semver.ts` directly. */
export { compareSemver };

interface Args {
  root: string;
  out: string | null;
  commitDates: boolean;
}

function parseArgs(argv: string[]): Args | { error: string } {
  let root: string | null = null;
  let out: string | null = null;
  let commitDates = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--commit-dates') {
      commitDates = true;
      continue;
    }
    if (arg === '--root' || arg === '--out') {
      if (value === undefined || value.startsWith('--')) return { error: `"${arg}" cần một đường dẫn đi kèm` };
      if (arg === '--root') root = value;
      else out = value;
      i++;
      continue;
    }
    return { error: `tuỳ chọn không nhận ra: "${arg}"` };
  }

  if (root === null) return { error: 'thiếu --root <thư-mục-registry>' };
  return { root, out, commitDates };
}

const run = promisify(execFile);

/**
 * `--commit-dates`: take both timestamps from git instead of from the clock and
 * the filesystem, so rebuilding the same commit produces the same bytes and the
 * platform's `ETag` cache is not busted for nothing.
 *
 * It **fails loudly** when git has no answer. Falling back to mtime here would
 * silently restore exactly the nondeterminism the flag was asked for — the
 * shape of every blind gate in this repo.
 */
function gitClocks(root: string, headDate: string): BuildIndexOptions {
  const cwd = resolve(root);
  return {
    updatedAt: async (courseDir: string) => {
      const rel = relative(cwd, courseDir) || '.';
      const { stdout } = await run('git', ['log', '-1', '--format=%cI', '--', rel], { cwd });
      const date = stdout.trim();
      if (date === '') {
        throw new Error(
          `--commit-dates: git không có commit nào cho ${courseDir}. ` +
            'Course chưa được commit, hoặc checkout quá nông (fetch-depth). Không đoán bằng mtime.',
        );
      }
      return new Date(date).toISOString();
    },
    generatedAt: () => headDate,
  };
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    process.stderr.write(`build-index: ${parsed.error}\n`);
    return 1;
  }

  let options: BuildIndexOptions = {};
  if (parsed.commitDates) {
    try {
      const { stdout } = await run('git', ['log', '-1', '--format=%cI'], { cwd: resolve(parsed.root) });
      options = gitClocks(parsed.root, new Date(stdout.trim()).toISOString());
    } catch (e) {
      process.stderr.write(`build-index: --commit-dates nhưng không chạy được git: ${(e as Error).message}\n`);
      return 1;
    }
  }

  let index: RegistryIndex;
  try {
    index = await buildIndex(parsed.root, options);
  } catch (e) {
    process.stderr.write(`build-index: KHÔNG sinh được index — ${(e as Error).message}\n`);
    return 1;
  }

  const json = `${JSON.stringify(index, null, 2)}\n`;
  if (parsed.out === null) {
    process.stdout.write(json);
  } else {
    try {
      await writeFile(parsed.out, json);
    } catch (e) {
      process.stderr.write(`build-index: không ghi được ${parsed.out}: ${(e as Error).message}\n`);
      return 1;
    }
    process.stdout.write(
      `build-index: OK — ${index.courses.length} course, schema ${index.schema} → ${parsed.out}\n`,
    );
  }
  for (const c of index.courses) {
    process.stdout.write(`  ${c.id}  [${c.tier}] [${c.lang}]  latest ${c.latest} (${c.versions.length} bản)\n`);
  }
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
