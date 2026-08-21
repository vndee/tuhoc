/**
 * The client half of the course-package endpoints Task 6 built:
 * `GET /courses` (the signed-in reader's library) and
 * `GET /courses/:id/@:version/*` (one file out of one stored package).
 *
 * Everything here talks through `api` (./client.ts) rather than `fetch`, so
 * the base URL, the session cookie and the 401 policy stay in one place.
 */

import { api, type RequestOptions } from './client';

/**
 * `GET /courses`'s wire shape — apps/api/internal/course/handler.go's
 * `courseSummary`, field for field.
 *
 * `versions` is every version the reader holds, oldest first by SEMVER
 * precedence (1.9.0 before 1.10.0, which a string sort gets backwards — the
 * server sorts it, this file must not re-sort it). `pinned` is the one a
 * reader should open, and is the last element of `versions`.
 */
export interface CourseSummary {
  id: string;
  title: string;
  lang: string;
  tier: string;
  versions: string[];
  pinned: string;
}

/** TanStack Query key for the catalog, shared by every surface that lists it. */
export function coursesQueryKey(): readonly ['courses'] {
  return ['courses'] as const;
}

/** The file a package's manifest must live at, per docs/course-format.md §2. */
export const MANIFEST_FILE = 'manifest.json';

/**
 * The courses this signed-in reader holds.
 *
 * `redirectOn401` is left at its default (redirect) here: this is called
 * from screens that are showing the reader their own library, where a dead
 * session means there is nothing left to render. `course/loader.ts` passes
 * `redirectOn401: false` for its own, speculative call — see there.
 */
export function listCourses(options: RequestOptions = {}): Promise<CourseSummary[]> {
  return api.get<CourseSummary[]>('/courses', options);
}

/**
 * The URL of one file inside one stored package.
 *
 * Every segment is percent-encoded individually and the separators are
 * kept: `name` is a package-relative PATH ("chapters/c1.html"), so encoding
 * it whole would turn its slashes into `%2F` and address a file that does
 * not exist, while encoding nothing would let an id or a version containing
 * a slash silently address a different package than the one it names — the
 * exact thing the server refuses on its side (usecase.go's `pathSafeParam`).
 */
function assetPath(courseId: string, version: string, name: string): string {
  const segments = name.split('/').map(encodeURIComponent).join('/');
  return `/courses/${encodeURIComponent(courseId)}/@${encodeURIComponent(version)}/${segments}`;
}

/** One file out of a stored package, as the bytes the author packed. */
export function fetchPackageAsset(
  courseId: string,
  version: string,
  name: string,
  options: RequestOptions = {},
): Promise<Uint8Array> {
  return api.bytes(assetPath(courseId, version, name), options);
}

/** The subset of a manifest this module reads: the names of the files to fetch. */
interface ManifestFileList {
  parts?: { chapters?: { file?: unknown }[] }[];
}

/**
 * Every chapter file `manifest` names, de-duplicated, in manifest order.
 *
 * Throws rather than returning an empty list for a manifest it cannot read.
 * The failure this rules out is the quiet one: a manifest that will not
 * parse yields no chapter names, and "manifest plus zero chapters" is
 * indistinguishable from a successfully downloaded empty course — which
 * would then be written into `db.packages` and read offline forever.
 */
function chapterFiles(manifestBytes: Uint8Array, courseId: string, version: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8').decode(manifestBytes));
  } catch (cause) {
    throw new Error(`Stored package ${courseId}@${version}: ${MANIFEST_FILE} is not valid JSON`, { cause });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Stored package ${courseId}@${version}: ${MANIFEST_FILE} is not a JSON object`);
  }

  const files: string[] = [];
  for (const part of (parsed as ManifestFileList).parts ?? []) {
    for (const chapter of part.chapters ?? []) {
      if (typeof chapter.file === 'string' && chapter.file !== '' && !files.includes(chapter.file)) {
        files.push(chapter.file);
      }
    }
  }
  if (files.length === 0) {
    throw new Error(`Stored package ${courseId}@${version}: ${MANIFEST_FILE} names no chapter files`);
  }
  return files;
}

/**
 * Downloads a stored package: its manifest, plus every chapter file the
 * manifest names, keyed by package-relative path — the shape
 * `db.packages`'s `files` column holds, and the same shape
 * `packages/course-format`'s `unpackZip` produces for a package imported
 * from a file.
 *
 * **Why file-by-file rather than one archive.** The API Task 6 built serves
 * a package's files individually; there is no route that hands back the
 * stored `.zip`. That is not an oversight to route around from here — the
 * per-file endpoint is what lets the server label every asset
 * `application/octet-stream` and refuse to let a chapter render on this
 * origin — but it does have a consequence worth stating plainly rather than
 * discovering later: **only files the manifest NAMES are cached.** A chapter
 * that references an image or a stylesheet inside its own package still
 * reaches for the network the first time it is displayed, because nothing
 * in the manifest says that file exists. Task 8's file import does not have
 * this gap (it unpacks the whole archive); closing it for the server path
 * needs a whole-archive route on the API, which is a decision for whoever
 * owns that surface, not a workaround for this one.
 *
 * The chapter files are fetched concurrently: they are independent GETs of
 * a few kilobytes each, and a 40-chapter course fetched in sequence is 40
 * round trips of latency for no reason.
 */
export async function fetchPackage(
  courseId: string,
  version: string,
  options: RequestOptions = {},
): Promise<Record<string, Uint8Array>> {
  const manifestBytes = await fetchPackageAsset(courseId, version, MANIFEST_FILE, options);
  const names = chapterFiles(manifestBytes, courseId, version);

  const fetched = await Promise.all(names.map((name) => fetchPackageAsset(courseId, version, name, options)));

  const files: Record<string, Uint8Array> = { [MANIFEST_FILE]: manifestBytes };
  names.forEach((name, i) => {
    files[name] = fetched[i];
  });
  return files;
}
