/**
 * The client half of the course-package endpoints Task 6 built:
 * `GET /courses` (the signed-in reader's library) and
 * `GET /courses/:id/@:version/*` (one file out of one stored package).
 *
 * Everything here talks through `api` (./client.ts) rather than `fetch`, so
 * the base URL, the session cookie and the 401 policy stay in one place.
 */

import { type Finding, validatePackage } from '@tuhoc/course-format';
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

/* ------------------------------------------------------------------ *
 * The tier rules, applied to bytes that came off the server
 * ------------------------------------------------------------------ */

/**
 * Thrown when a downloaded package breaks a rule about what its markup is
 * allowed to DO in the reader's browser.
 *
 * Separate from `ApiError` because the server behaved perfectly: it answered,
 * with exactly the bytes it was asked for. What is wrong is the package.
 */
export class UnsafePackageError extends Error {
  readonly courseId: string;
  readonly version: string;
  readonly findings: readonly Finding[];

  constructor(courseId: string, version: string, findings: readonly Finding[]) {
    super(
      `Course package ${courseId}@${version} breaks ${findings.length} rule(s) every package must satisfy: ` +
        findings.map((f) => `${f.code} (${f.path})`).join(', '),
    );
    this.name = 'UnsafePackageError';
    this.courseId = courseId;
    this.version = version;
    this.findings = findings;
  }
}

/**
 * The findings this boundary REFUSES on, as opposed to the ones it only
 * reports — and the split is not arbitrary.
 *
 * These are the rules whose subject is what the markup will do once it is
 * parsed in the reader's browser: scripts, `on*` handlers, `javascript:` urls,
 * frames, forms, shipped `.js`, an entry path that climbs out of the package,
 * and a tag carrying enough attributes to be an attack on the scanner itself.
 * `apps/api`'s own `usecase.go` says in as many words that it checks structure
 * and leaves this rule set to `validate.ts` — so before this, NOTHING applied
 * them to a package that arrived down the server route. `course/import.ts`
 * applied them to `/import` and only to `/import`.
 *
 * Everything else `validatePackage` can say — a missing `license`, no
 * `authors`, `generatedBy` unset, a non-semver `version` — is deliberately NOT
 * refused here. Two reasons, and the first is the load-bearing one:
 *
 *  1. **The server accepts those packages today.** `usecase.go` validates
 *     structure and the `tier` column's CHECK, not the registry-facing v2
 *     fields. Refusing them in the client would make a package the server
 *     legitimately stored unreadable on the device that stored it — a format
 *     migration, decided here by accident, in the middle of a security fix.
 *  2. **A download is not the whole package.** `fetchPackage` collects the
 *     manifest and the chapter files the manifest NAMES, nothing else, so a
 *     rule about a file nobody named cannot be evaluated. Which cuts both
 *     ways and is worth being blunt about: `JS_FILE_IN_PACKAGE` is in the list
 *     above but a `viz.js` that the manifest never mentions is not downloaded,
 *     so this boundary would not see it. The refusals below are a floor, not a
 *     proof of safety — the reason `course/version.ts` parses chapters into an
 *     inert document (ruling S1-F30) rather than trusting this check.
 *
 * There used to be a case this check could not touch at all: a manifest that
 * declared `tier: "interactive"` was ENTITLED to every one of these, so
 * `validatePackage` reported nothing for it, and this boundary had nothing to
 * refuse. Format v2 (task 1 of the server-side pivot,
 * `docs/superpowers/specs/2026-08-25-server-side-pivot.md` §2.3) closed that
 * gap by deleting the field it ran on: there is no `tier` any more, honest or
 * dishonest, and `validatePackage` runs the seven rules above on every
 * package unconditionally. A manifest that still sets `tier: "interactive"`
 * buys nothing here — it is refused exactly like any other package that
 * breaks one of these rules.
 *
 * `TIER_REMOVED` — the code `validatePackage` reports for a manifest that
 * still carries the dead field — is deliberately NOT in the set below,
 * alongside the missing-`license`-etc. codes reason 1 above already covers:
 * carrying a stale field is staleness, not danger, the same reasoning that
 * keeps this whole set to what markup will DO rather than what the manifest
 * merely says about itself. The one limit that remains is reason 2 above:
 * what this boundary never downloads, it cannot see.
 */
const REFUSED_CODES: ReadonlySet<string> = new Set([
  'SCRIPT_TAG',
  'EVENT_HANDLER_ATTR',
  'JAVASCRIPT_URL',
  'EMBEDDED_FRAME',
  'FORM_TAG',
  'JS_FILE_IN_PACKAGE',
  'TAG_ATTR_FLOOD',
  'PATH_ESCAPE',
]);

function refuseUnsafePackage(courseId: string, version: string, files: Record<string, Uint8Array>): void {
  const { findings } = validatePackage(new Map(Object.entries(files)));
  const refused = findings.filter((f) => REFUSED_CODES.has(f.code));
  if (refused.length > 0) throw new UnsafePackageError(courseId, version, refused);

  if (findings.length > 0) {
    // Reported rather than refused (see REFUSED_CODES). Logged, not swallowed:
    // a package that is structurally wrong is still worth finding, and a
    // console line is where the next person looks.
    console.warn(
      `api/courses: package ${courseId}@${version} has ${findings.length} non-blocking validation finding(s)`,
      findings.map((f) => `${f.code} ${f.path}`),
    );
  }
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
 *
 * **Every byte that leaves here has been through the content rules.** See
 * {@link REFUSED_CODES} for which ones and why only those — the short version
 * is that this used to be the one way into the app for a package that had
 * never met `validatePackage`, and — before format v2 unconditionally ran
 * these rules on every package (task 1 of the server-side pivot) — a package
 * that declared `tier: "interactive"` could carry `onerror` down this route
 * with nothing to stop it. The scan is synchronous and proportional to the
 * text downloaded (~1 s per 20 MB, measured in `course/import.ts`); it runs
 * on the manifest + chapters, which is the small half of a package.
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

  refuseUnsafePackage(courseId, version, files);
  return files;
}
