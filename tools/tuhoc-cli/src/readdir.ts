/**
 * Filesystem → the `ReadonlyMap<string, Uint8Array>` that
 * `validatePackage`/`packZip` take.
 *
 * ## Why this file is allowed to refuse things
 *
 * Everything about whether a package is VALID belongs to `validatePackage` and
 * is asked there. What is left over is a different kind of question: a
 * directory is not a Map, and the conversion has cases a Map cannot express.
 * `validatePackage` never sees a filesystem, so it cannot have an opinion about
 * symlinks, sockets or `.git/`. Those are the only decisions taken here, and
 * each one is stated out loud rather than applied silently.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface PackageDir {
  /** Package-relative path (always `/`-separated) → file contents. */
  files: Map<string, Uint8Array>;
  /** Package-relative paths left out for being hidden. Reported, never silent. */
  skipped: string[];
}

/**
 * Entries that are neither an ordinary file nor a directory.
 *
 * A symlink is the one that matters. Following it would pack whatever it points
 * at under a path that looks like it is inside the package — the file-system
 * twin of the `PATH_ESCAPE` that `zip.ts` refuses on the way in, except no
 * amount of path checking catches it, because the path really is inside. Not
 * following it would pack a link that means nothing once unzipped. Neither is
 * a good answer, so this refuses and says which entries are the problem.
 */
export class UnpackableEntryError extends Error {
  readonly entries: readonly { path: string; reason: string }[];

  constructor(entries: readonly { path: string; reason: string }[]) {
    super(`${entries.length} mục không đóng gói được`);
    this.name = 'UnpackableEntryError';
    this.entries = entries;
  }
}

/** Thrown when the path given on the command line is not a directory at all. */
export class NotADirectoryError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(detail);
    this.name = 'NotADirectoryError';
    this.path = path;
  }
}

interface Walk {
  files: Map<string, Uint8Array>;
  skipped: string[];
  refused: { path: string; reason: string }[];
  /** Absolute path of the zip about to be written, when it lands inside `dir`. */
  excluded: string | null;
}

async function walk(absDir: string, prefix: string, w: Walk): Promise<void> {
  const entries = await readdir(absDir, { withFileTypes: true });
  // Sorted so the Map's iteration order — and therefore any message built from
  // it — does not depend on what the filesystem felt like returning.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const abs = join(absDir, entry.name);

    // Hidden entries, at any depth. This is what keeps `.git/` (which would
    // blow the 20 MB budget and report it as TOO_LARGE, a finding about the
    // wrong thing) and macOS's `.DS_Store` out of a course package. A course is
    // HTML, CSS and images; nothing it ships is named with a leading dot. The
    // count is printed by the caller, so this is a stated omission, not a
    // silent one.
    if (entry.name.startsWith('.')) {
      w.skipped.push(rel);
      continue;
    }

    // `readdir(withFileTypes)` reports the entry itself, not its target — a
    // symlink is a symlink here even when it points at a real file.
    if (entry.isSymbolicLink()) {
      w.refused.push({ path: rel, reason: 'là symlink; gói course chỉ chứa tệp thường' });
      continue;
    }

    if (entry.isDirectory()) {
      await walk(abs, rel, w);
      continue;
    }

    if (!entry.isFile()) {
      w.refused.push({ path: rel, reason: 'không phải tệp thường (socket, fifo, thiết bị…)' });
      continue;
    }

    // Do not pack the zip we are on our way to writing. Without this, a second
    // `tuhoc pack -o ./out.zip .` in the same directory packs the first run's
    // output into the second run's output, and a third packs both.
    if (w.excluded !== null && resolve(abs) === w.excluded) continue;

    w.files.set(rel, new Uint8Array(await readFile(abs)));
  }
}

/**
 * Reads every packable file under `dir`.
 *
 * `outputPath` is the zip this run is about to write, or `null` when there is
 * none yet; it is excluded from the result if it happens to live inside `dir`.
 *
 * @throws {NotADirectoryError} `dir` is missing or is not a directory.
 * @throws {UnpackableEntryError} the tree contains a symlink or a special file.
 */
export async function readPackageDir(dir: string, outputPath: string | null): Promise<PackageDir> {
  const root = resolve(dir);

  let info;
  try {
    info = await stat(root);
  } catch {
    throw new NotADirectoryError(root, 'không có thư mục này');
  }
  if (!info.isDirectory()) {
    throw new NotADirectoryError(root, 'đường dẫn này không phải thư mục');
  }

  const w: Walk = {
    files: new Map<string, Uint8Array>(),
    skipped: [],
    refused: [],
    excluded: outputPath === null ? null : resolve(outputPath),
  };
  await walk(root, '', w);

  if (w.refused.length > 0) throw new UnpackableEntryError(w.refused);

  return { files: w.files, skipped: w.skipped };
}
