/**
 * The registry as it exists **on disk**: a root with one directory per course.
 *
 * ## What this file is allowed to have an opinion about
 *
 * Everything about whether a package is VALID belongs to `validatePackage` and
 * is asked there — see `course-format.ts` for why there is exactly one copy of
 * that. What is left over is a different kind of question, and it is the same
 * distinction `tools/tuhoc-cli/src/readdir.ts` draws for itself:
 * `validatePackage` takes a `ReadonlyMap<string, Uint8Array>`, so it can have
 * no opinion about directories, symlinks, or which directory a package is
 * sitting in. Those are the only decisions taken here, and each one is named
 * out loud with a `REGISTRY_` prefix so nobody mistakes it for a rule from the
 * rule set.
 *
 * ## Two layouts, on purpose
 *
 * A course directory is either
 *
 *   - `<root>/<id>/manifest.json …`             — one version, or
 *   - `<root>/<id>/<version>/manifest.json …`   — several.
 *
 * The second layout was added for `build-index.ts`'s `RegistryEntry.versions`,
 * which needed every past version enumerable from the filesystem — the old
 * community registry had no database, so a version's only record was its own
 * directory. `build-index.ts` is gone (Task 17 of the 2026-08-25 server-side
 * pivot: the catalog is `/courses`, in Postgres, which tracks versions in
 * `course_versions` instead). Nothing in this file's remaining caller,
 * `validate-pr.ts`, requires the second layout — but a registry root laid out
 * that way is not invalid, only unnecessary now, and `REGISTRY_VERSION_DIR_MISMATCH`
 * is still a real question to ask of a root that happens to use it. Removing
 * the branch outright would be a behavior change with no test pinning it
 * either way; left as a layout the PR gate still tolerates, not one it expects.
 *
 * The first layout is what the two committed sample packages under
 * `fixtures/courses/` actually are, so the tools here run against real bytes
 * rather than against a shape invented for them. Which one a directory is, is
 * decided by whether it holds a `manifest.json`; the two cannot be confused,
 * because a version directory name has to be a semver string and
 * `manifest.json` is not one.
 */

import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

// The directory walker is REUSED from the packaging CLI, not rewritten. It
// already answers the three filesystem questions a course tree raises — hidden
// entries, symlinks, special files — and it answers them the way `tuhoc pack`
// answers them, so a contributor whose package passed locally cannot fail here
// for a reason their own tool never applied. A second walker with its own
// symlink policy is the same failure mode as a second rule set, one layer down.
import { NotADirectoryError, readPackageDir, UnpackableEntryError } from '../../tuhoc-cli/src/readdir.ts';
import { MANIFEST_PATH, parseManifest, validatePackage } from './course-format.ts';
import type { Manifest } from './course-format.ts';

/**
 * A finding, with the course it is about attached.
 *
 * `code`, `path` and `detail` are the rule set's own field names and its own
 * vocabulary of codes (`SCRIPT_TAG`, `JS_FILE_IN_PACKAGE`, …). Renaming them on
 * the way through — the plan sketched `where` and `SCRIPT_IN_CONTENT` — would
 * hand a contributor two names for one fact, which is the small version of the
 * measured *"one rule set, three copies, disagreeing on 7 of 12 rows"*.
 */
export interface RegistryFinding {
  /** A `FindingCode` from `packages/course-format`, or one of {@link REGISTRY_FINDING_CODES}. */
  readonly code: string;
  /** Absolute path of the course directory (`<root>/<id>`). */
  readonly courseDir: string;
  /** Package-relative path, or a manifest JSON pointer, or `.` for the package as a whole. */
  readonly path: string;
  readonly detail: string;
}

/**
 * Codes this file may emit, and the full list of questions `validatePackage`
 * structurally cannot be asked. Every one of them is about the FILESYSTEM or
 * about REGISTRY LAYOUT, never about package content.
 */
export const REGISTRY_FINDING_CODES = [
  /** The course directory is missing, or is not a directory. */
  'REGISTRY_UNREADABLE_DIR',
  /** A symlink or a special file inside the package. `validatePackage` never sees a filesystem. */
  'REGISTRY_UNPACKABLE_ENTRY',
  /** The directory holds neither a `manifest.json` nor any version subdirectory that does. */
  'REGISTRY_NO_PACKAGE',
  /** `manifest.id` disagrees with the directory the package is published under. */
  'REGISTRY_ID_MISMATCH',
  /** A version directory's name disagrees with the `manifest.version` inside it. */
  'REGISTRY_VERSION_DIR_MISMATCH',
] as const;

export type RegistryFindingCode = (typeof REGISTRY_FINDING_CODES)[number];

/**
 * The scan found no course directory where it was told to look.
 *
 * This is an ERROR, not an empty result, and that is the whole point. This repo
 * has five recorded blind gates, all the same shape: *a gate measures what it
 * can reach and goes quiet exactly where it cannot*. A registry root that has
 * been renamed, a shallow checkout, a workflow pointed one directory too high —
 * every one of them produces "zero courses", and every one of them is green if
 * zero courses is allowed to mean "nothing wrong".
 */
export class EmptyRegistryError extends Error {
  readonly root: string;

  constructor(root: string, detail: string) {
    super(`registry root ${root}: ${detail}`);
    this.name = 'EmptyRegistryError';
    this.root = root;
  }
}

/**
 * `validateChangedCourses` was handed an empty list.
 *
 * Same reasoning as {@link EmptyRegistryError}, one level in: an empty list
 * validates cleanly, and "validated cleanly" is indistinguishable in a CI log
 * from "validated nothing". The caller that legitimately has nothing to do —
 * a PR touching no course — must say so in its own words and never reach here.
 */
export class NothingScannedError extends Error {
  constructor() {
    super(
      'validateChangedCourses được gọi với danh sách rỗng. Quét 0 gói rồi trả "không có vấn đề" là một cổng mù; ' +
        'người gọi phải tự quyết định và NÊU LÝ DO khi bỏ qua.',
    );
    this.name = 'NothingScannedError';
  }
}

/** A course directory holds no package at all. Fatal for the index; a finding for the PR gate. */
export class RegistryLayoutError extends Error {
  readonly courseDir: string;

  constructor(courseDir: string, detail: string) {
    super(`${courseDir}: ${detail}`);
    this.name = 'RegistryLayoutError';
    this.courseDir = courseDir;
  }
}

/**
 * Every course directory directly under `root`, sorted by name.
 *
 * Files directly under the root (a `README.md`, the built `index.json`, the
 * `*.zip` next to the sample packages) are not courses and are skipped.
 *
 * @throws {EmptyRegistryError} the root is missing, is not a directory, or holds no subdirectory.
 */
export async function courseDirsUnder(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    throw new EmptyRegistryError(root, 'không đọc được (không tồn tại, hoặc không phải thư mục)');
  }

  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => join(root, e.name))
    .sort();

  if (dirs.length === 0) {
    throw new EmptyRegistryError(
      root,
      `không có thư mục course nào (${entries.length} mục, toàn tệp). ` +
        'Quét 0 course rồi báo đạt là một cổng mù — kiểm lại đường dẫn root và bản checkout.',
    );
  }
  return dirs;
}

export interface CoursePackage {
  /** Absolute path of the directory that holds `manifest.json`. */
  readonly dir: string;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly manifest: Manifest;
  /** Sum of decoded byte lengths — the same axis `MAX_UNCOMPRESSED_BYTES` budgets. */
  readonly bytes: number;
  /** Entries left out for having a leading dot. Reported, never silent. */
  readonly skipped: readonly string[];
}

export interface CourseInspection {
  readonly courseDir: string;
  /** The directory name, which is the id the course is published under. */
  readonly id: string;
  /** Only the packages that came back clean. A course with findings may have none. */
  readonly packages: readonly CoursePackage[];
  readonly findings: readonly RegistryFinding[];
}

/** `<courseDir>` itself when it holds a manifest, otherwise its version subdirectories. */
async function packageDirsIn(courseDir: string): Promise<string[]> {
  try {
    const info = await stat(join(courseDir, MANIFEST_PATH));
    if (info.isFile()) return [courseDir];
  } catch {
    // No manifest at the course root: this is the multi-version layout, or nothing.
  }

  let entries;
  try {
    entries = await readdir(courseDir, { withFileTypes: true });
  } catch {
    throw new RegistryLayoutError(courseDir, 'không đọc được thư mục course');
  }

  const versionDirs: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = join(courseDir, e.name);
    try {
      const info = await stat(join(dir, MANIFEST_PATH));
      if (info.isFile()) versionDirs.push(dir);
    } catch {
      // A subdirectory with no manifest is not a version; `chapters/` is one.
    }
  }

  if (versionDirs.length === 0) {
    throw new RegistryLayoutError(
      courseDir,
      `không có ${MANIFEST_PATH} ở gốc, và không thư mục con nào có. ` +
        'Bố cục hợp lệ: <root>/<id>/manifest.json hoặc <root>/<id>/<version>/manifest.json.',
    );
  }
  return versionDirs.sort();
}

function toFinding(courseDir: string, code: string, path: string, detail: string): RegistryFinding {
  return { code, courseDir, path, detail };
}

/**
 * Reads one course directory and runs the rule set over every package in it.
 *
 * Never throws for anything a contributor can fix in their PR — those come back
 * as findings, so a job can report all of them at once instead of stopping at
 * the first. A course directory that holds no package at all is the one
 * exception in kind, and it is reported as `REGISTRY_NO_PACKAGE` rather than
 * thrown, for the same reason.
 */
export async function inspectCourse(courseDir: string): Promise<CourseInspection> {
  const id = basename(courseDir);
  const findings: RegistryFinding[] = [];
  const packages: CoursePackage[] = [];

  let packageDirs: string[];
  try {
    packageDirs = await packageDirsIn(courseDir);
  } catch (e) {
    if (e instanceof RegistryLayoutError) {
      // A directory that is simply absent is a different story to tell than one
      // that is present and shaped wrong; `git diff` names deleted files too.
      let exists = true;
      try {
        exists = (await stat(courseDir)).isDirectory();
      } catch {
        exists = false;
      }
      const code = exists ? 'REGISTRY_NO_PACKAGE' : 'REGISTRY_UNREADABLE_DIR';
      return { courseDir, id, packages: [], findings: [toFinding(courseDir, code, '.', e.message)] };
    }
    throw e;
  }

  for (const dir of packageDirs) {
    const rel = dir === courseDir ? '.' : basename(dir);

    let files: ReadonlyMap<string, Uint8Array>;
    let skipped: string[];
    try {
      ({ files, skipped } = await readPackageDir(dir, null));
    } catch (e) {
      if (e instanceof NotADirectoryError) {
        findings.push(toFinding(courseDir, 'REGISTRY_UNREADABLE_DIR', rel, e.message));
        continue;
      }
      if (e instanceof UnpackableEntryError) {
        for (const entry of e.entries) {
          findings.push(toFinding(courseDir, 'REGISTRY_UNPACKABLE_ENTRY', entry.path, entry.reason));
        }
        continue;
      }
      throw e;
    }

    const result = validatePackage(files);
    for (const f of result.findings) findings.push(toFinding(courseDir, f.code, f.path, f.detail));
    if (!result.ok) continue;

    // From here on the manifest is known to parse and to carry every required
    // field, because `validatePackage` said so. These two checks are about
    // WHERE the package sits, which it cannot see.
    const manifestBytes = files.get(MANIFEST_PATH);
    if (manifestBytes === undefined) continue; // unreachable: MANIFEST_MISSING would have failed above
    const parsed = parseManifest(new TextDecoder().decode(manifestBytes));
    if ('error' in parsed) continue; // likewise unreachable: MANIFEST_PARSE
    const manifest = parsed.manifest;

    if (manifest.id !== id) {
      findings.push(
        toFinding(
          courseDir,
          'REGISTRY_ID_MISMATCH',
          MANIFEST_PATH,
          `manifest.id là "${manifest.id}" nhưng gói nằm trong thư mục "${id}". ` +
            'Người học kéo course về theo tên thư mục; hai tên phải là một.',
        ),
      );
      continue;
    }

    if (rel !== '.' && rel !== manifest.version) {
      findings.push(
        toFinding(
          courseDir,
          'REGISTRY_VERSION_DIR_MISMATCH',
          `${rel}/${MANIFEST_PATH}`,
          `thư mục phiên bản tên "${rel}" nhưng manifest.version là "${manifest.version}".`,
        ),
      );
      continue;
    }

    let bytes = 0;
    for (const b of files.values()) bytes += b.byteLength;
    packages.push({ dir, files, manifest, bytes, skipped });
  }

  return { courseDir, id, packages, findings };
}

/** One line per finding, for a CI log. Always names the file. */
export function renderFinding(f: RegistryFinding): string {
  const where = f.path === '.' ? f.courseDir : `${f.courseDir}/${f.path}`;
  return `  ${f.code}  ${where}  — ${f.detail}`;
}
