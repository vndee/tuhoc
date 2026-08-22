/**
 * Where a course's bytes come from — and there are now TWO answers.
 *
 * 1. **`db.packages`** (Dexie/IndexedDB): a package this reader imported
 *    from a file, or pulled down from their library on the server. It is
 *    on this device.
 * 2. **`courses/`**: the directory this repo ships, served at
 *    `/courses/<id>/...` by `apps/web/vite-plugins/courseAssets.ts` in dev
 *    and copied into the build output for production.
 *
 * ## The cached package wins, and every read makes the same choice
 *
 * Three reasons, in the order they matter:
 *
 * - **It is the only source that works offline**, which is the entire
 *   reason the table exists. A rule that preferred the network would make
 *   the cache a performance optimisation; it is not one, it is the feature.
 * - **A reader's own copy is not a stale mirror of ours.** If a package
 *   with the same id as a bundled course is in this database, somebody put
 *   it there on purpose. Silently showing them a different course under the
 *   name they imported is the wrong answer, and it is a *quiet* wrong
 *   answer — nothing on screen would say which copy they were reading.
 * - **The choice must be made ONCE, for the whole course.** `loadManifest`
 *   and `loadChapter` resolve the source independently, so if they could
 *   disagree the reader would get one copy's table of contents wrapped
 *   around another copy's prose. They cannot disagree here: a cached
 *   package answers for its course completely — a chapter it is missing is
 *   a `PackageAssetError`, never a quiet fall-through to the network.
 *
 * ## And a third place a course can be, which is not a third source
 *
 * A package sitting in the reader's library ON THE SERVER is not read from
 * over the wire chapter by chapter. It is downloaded once into
 * `db.packages` and read from there — see `pullPackageFromServer`. That
 * keeps "which copy am I reading" a two-valued question no matter how the
 * package arrived.
 */

import { fetchPackage, listCourses, MANIFEST_FILE } from '../api/courses';
import { db, type PackageRow } from '../db/local';
import type { Manifest } from './types';

const REQUIRED_RUNTIME_MAJOR = 1;

/**
 * Thrown when an HTTP fetch for a course asset (manifest or chapter) does
 * not return a 2xx status. Distinct from `ManifestParseError` so callers
 * can tell "the file isn't there" apart from "the file is there but junk".
 */
export class CourseFetchError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`Failed to fetch course asset: HTTP ${status} at ${url}`);
    this.name = 'CourseFetchError';
    this.url = url;
    this.status = status;
  }
}

/**
 * Thrown when a manifest response is not usable as a `Manifest` — either
 * the body isn't valid JSON (a misconfigured static host will happily
 * return an HTML error page with a 200 status) or it parsed fine but is
 * missing fields a manifest requires.
 */
export class ManifestParseError extends Error {
  readonly url: string;

  constructor(url: string, cause: unknown) {
    super(`Manifest at ${url} is not a usable manifest`);
    this.name = 'ManifestParseError';
    this.url = url;
    this.cause = cause;
  }
}

/**
 * Thrown when a cached package does not contain a file its own manifest
 * names.
 *
 * Its own class rather than a `CourseFetchError` with a made-up 404,
 * because the two ask the reader for different things: an HTTP 404 says
 * "the server does not have this, try again later," while this says "the
 * copy on your device is incomplete, import it again." Nothing on the
 * network can fix the second one, and the packing rules make it a
 * should-never-happen — both `packages/course-format`'s validator and the
 * server's own ingest refuse a manifest naming a file the archive lacks —
 * so reaching it means a package was assembled by something that skipped
 * both, and saying so beats retrying forever.
 */
export class PackageAssetError extends Error {
  readonly courseId: string;
  readonly version: string;
  readonly asset: string;

  constructor(courseId: string, version: string, asset: string) {
    super(`Cached package ${courseId}@${version} does not contain "${asset}"`);
    this.name = 'PackageAssetError';
    this.courseId = courseId;
    this.version = version;
    this.asset = asset;
  }
}

/** Thrown when a manifest's `runtime` field's major version isn't the one this app supports. */
export class RuntimeMismatchError extends Error {
  readonly required: string;
  readonly got: string;

  constructor(got: string) {
    super(`This app supports course runtime ^${REQUIRED_RUNTIME_MAJOR}, but the manifest declares "${got}"`);
    this.name = 'RuntimeMismatchError';
    this.required = `^${REQUIRED_RUNTIME_MAJOR}`;
    this.got = got;
  }
}

function assetUrl(courseId: string, relPath: string): string {
  // Absolute URL, not a bare "/courses/..." string: relative URLs aren't
  // guaranteed to resolve consistently across every `fetch` implementation
  // (Node/Bun's global fetch requires an absolute URL and won't consult
  // `window.location` the way a browser's does).
  return new URL(`/courses/${encodeURIComponent(courseId)}/${relPath}`, window.location.origin).toString();
}

// Deliberately not a semver dependency — the manifest only ever needs a
// caret-major comparison ("^1" accepted, "^2" rejected). Five lines.
function assertRuntimeCompatible(range: string): void {
  const major = /^\^(\d+)/.exec(range)?.[1];
  if (major === undefined || Number(major) !== REQUIRED_RUNTIME_MAJOR) {
    throw new RuntimeMismatchError(range);
  }
}

function isManifestShape(value: unknown): value is Manifest {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.title === 'string' &&
    typeof m.runtime === 'string' &&
    Array.isArray(m.parts)
  );
}

/**
 * TanStack Query key for a course's manifest — shared by every place that
 * fetches it (`CourseHome`, `Sidebar`) so they hit the same cache entry
 * instead of double-fetching the same static file.
 */
export function manifestQueryKey(courseId: string): readonly [string, string] {
  return ['course-manifest', courseId] as const;
}

/**
 * Vietnamese, human-readable summary of a course-loading failure, for
 * surfaces that show it directly to a learner (`CourseHome`, `Sidebar`).
 * The error classes' own `.message` is an English technical string (kept
 * on the error/console for debugging, alongside each class's own fields —
 * `url`, `status`, `cause`, `required`/`got`) — not something to put in
 * front of a Vietnamese-language UI.
 */
export function describeCourseError(error: unknown): string {
  if (error instanceof RuntimeMismatchError) {
    return `Không tải được khóa học: phiên bản không tương thích (ứng dụng cần ${error.required}, khóa học khai báo "${error.got}").`;
  }
  if (error instanceof CourseFetchError) {
    return error.status === 404
      ? 'Không tải được khóa học: không tìm thấy trên máy chủ.'
      : `Không tải được khóa học: máy chủ báo lỗi (HTTP ${error.status}).`;
  }
  if (error instanceof ManifestParseError) {
    return 'Không tải được khóa học: dữ liệu khóa học bị lỗi định dạng.';
  }
  if (error instanceof PackageAssetError) {
    return 'Không tải được khóa học: gói đã lưu trên máy thiếu tệp của chương này. Hãy nhập lại gói.';
  }
  return 'Không tải được khóa học: đã xảy ra lỗi không xác định.';
}

/* ------------------------------------------------------------------ *
 * Source 1: the package on this device
 * ------------------------------------------------------------------ */

/**
 * The version of `courseId` this reader should be shown, or `undefined` if
 * they hold none.
 *
 * A reader can hold several versions of one course at once — that is what
 * Task 10's "see what an update would cost before taking it" flow is built
 * on — so "which one" is a real question, and `pinnedAt` is its answer: the
 * moment a version became the one to open. The most recent pin wins.
 *
 * The timestamps are compared as parsed INSTANTS, never as raw strings, for
 * the reason `db/local.ts`'s `mergeRow` sets out at length: an ISO instant
 * that lands on a whole second may be written without its fractional part,
 * and '.' sorts below 'Z', so a string comparison puts ...00.500Z BEFORE
 * ...00Z. Every `pinnedAt` in this table is written by this client today
 * and would compare correctly either way; the rule is followed anyway,
 * because the day one is written by something else is not the day to
 * rediscover this.
 *
 * The version is the tiebreak for two pins in the same millisecond, compared
 * numerically (1.10.0 after 1.9.0, which a plain string sort gets backwards).
 */
const VERSION_ORDER = new Intl.Collator('en', { numeric: true });

/**
 * The pin rule above, as a pure function over anything that carries a
 * `version` and a `pinnedAt`.
 *
 * Exported because the rule has a SECOND reader now: `pages/Library.tsx`
 * prints the version beside each course, and the version it prints has to
 * be the one this module will actually open. A library that computed
 * "which version" by its own similar-looking rule would be free to drift —
 * and the drift would be invisible, because both numbers look plausible.
 * One function, one answer.
 *
 * `rows` must be non-empty; the callers both check first, and returning a
 * sentinel for an empty list would only move that check somewhere it is
 * easier to forget.
 */
export function pickPinned<T extends { version: string; pinnedAt: string }>(rows: readonly T[]): T {
  return rows.reduce((best, row) => {
    const byPin = Date.parse(row.pinnedAt) - Date.parse(best.pinnedAt);
    if (byPin !== 0) return byPin > 0 ? row : best;
    return VERSION_ORDER.compare(row.version, best.version) > 0 ? row : best;
  });
}

async function pinnedPackage(courseId: string): Promise<PackageRow | undefined> {
  const rows = await db.packages.where('courseId').equals(courseId).toArray();
  if (rows.length === 0) return undefined;
  return pickPinned(rows);
}

/**
 * A cached package's manifest, held to exactly the checks a manifest off
 * the network gets.
 *
 * Not a formality. `db.packages` holds packages that came from strangers —
 * a file the reader was given, a repo they pasted a link to — and the
 * validation on the way IN belongs to whoever wrote the row (Task 8's
 * import, or the server). The reader is the last line either way, and the
 * runtime check in particular has to be applied HERE: a package cached
 * while the app was on runtime ^1 is still sitting there after the app
 * ships ^2.
 *
 * The `url` on a failure names the row rather than a web address, because
 * that is where the bad bytes actually are. `dexie:` is not a scheme
 * anything resolves; it is a label that tells whoever reads the error which
 * store to look in.
 */
function manifestFromPackage(row: PackageRow): Manifest {
  const where = `dexie:packages/${row.key}`;
  if (!isManifestShape(row.manifest)) {
    throw new ManifestParseError(where, new Error('the cached manifest is missing required manifest fields'));
  }
  assertRuntimeCompatible(row.manifest.runtime);
  return row.manifest;
}

/* ------------------------------------------------------------------ *
 * Filling source 1 from the reader's library on the server
 * ------------------------------------------------------------------ */

/**
 * Downloads `courseId` from the reader's server-side library into
 * `db.packages`, or answers `undefined` if it is not there to be had.
 *
 * Every failure is `undefined`, on purpose. This runs only after the static
 * directory has already refused, so the caller is holding a perfectly good
 * error that describes the reader's actual situation ("no such course"),
 * and replacing it with whatever this lookup happened to hit ("HTTP 500",
 * "NetworkError") would describe our plumbing instead of their problem. The
 * reason is logged rather than swallowed silently, so a genuinely broken
 * library is still findable in a console.
 *
 * `redirectOn401: false` for the same reason: this is a SPECULATIVE call
 * about a course that may simply not exist, and a background probe that
 * throws the reader out to /login is a worse answer than the error the
 * caller already had. `RequireAuth` and `useMe` own that transition.
 */
async function pullPackageFromServer(courseId: string): Promise<PackageRow | undefined> {
  try {
    const catalog = await listCourses({ redirectOn401: false });
    const entry = catalog.find((course) => course.id === courseId);
    if (!entry || entry.pinned === '') return undefined;

    const files = await fetchPackage(courseId, entry.pinned, { redirectOn401: false });
    const manifestBytes = files[MANIFEST_FILE];
    if (manifestBytes === undefined) return undefined;

    const row: PackageRow = {
      key: `${courseId}@${entry.pinned}`,
      courseId,
      version: entry.pinned,
      manifest: JSON.parse(decodeUtf8(manifestBytes)) as unknown,
      files,
      // Downloading a version IS pinning it: it is the one the server says
      // to open (`pinned`), and it is now the newest thing this device
      // holds for this course.
      pinnedAt: new Date().toISOString(),
    };
    await db.packages.put(row);
    return row;
  } catch (error) {
    console.warn(`course/loader: could not pull "${courseId}" from the server library`, error);
    return undefined;
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/* ------------------------------------------------------------------ *
 * Source 2: the static courses/ directory
 * ------------------------------------------------------------------ */

async function loadStaticManifest(courseId: string): Promise<Manifest> {
  const url = assetUrl(courseId, 'manifest.json');
  const res = await fetch(url);
  if (!res.ok) {
    throw new CourseFetchError(url, res.status);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (cause) {
    throw new ManifestParseError(url, cause);
  }

  if (!isManifestShape(data)) {
    throw new ManifestParseError(url, new Error('response JSON is missing required manifest fields'));
  }

  assertRuntimeCompatible(data.runtime);
  return data;
}

/* ------------------------------------------------------------------ *
 * The two public reads
 * ------------------------------------------------------------------ */

/**
 * A course's manifest, validated: a non-2xx from the static directory
 * throws `CourseFetchError`, a body that isn't parseable/shaped JSON throws
 * `ManifestParseError`, and a `runtime` whose major version this app
 * doesn't support throws `RuntimeMismatchError` — whichever source the
 * manifest came from.
 *
 * Order, and why:
 *
 *  1. **The cached package**, if this reader holds one. See the file
 *     comment for the argument.
 *  2. **The static `courses/` directory.** Tried before the server library
 *     so that the courses this app SHIPS keep costing exactly one request,
 *     as they always have.
 *  3. **The reader's library on the server**, but only once (2) has
 *     refused — a course id that is not in `courses/` is by elimination
 *     either a package or nothing. What comes back is written into
 *     `db.packages`, so this happens once per course rather than once per
 *     read.
 *
 * A `RuntimeMismatchError` from (2) does NOT fall through to (3): the
 * course was found, and it is the app that is too old. Downloading a
 * different copy of the same version cannot help, and going to the network
 * to answer a question already answered is how a clear error becomes a
 * confusing one.
 *
 * A `ManifestParseError` from (2) DOES fall through, and that is not
 * sloppiness — it is the shape of static hosting. A missing file under an
 * SPA fallback (Vite's dev server, Cloudflare Pages) comes back as
 * `index.html` with status 200, so "this course is not in `courses/`" and
 * "this course's manifest is corrupt" are the same response. `ManifestParseError`'s
 * own doc comment has said so since P1.
 */
export async function loadManifest(courseId: string): Promise<Manifest> {
  const cached = await pinnedPackage(courseId);
  if (cached) return manifestFromPackage(cached);

  try {
    return await loadStaticManifest(courseId);
  } catch (staticError) {
    if (staticError instanceof RuntimeMismatchError) throw staticError;

    const pulled = await pullPackageFromServer(courseId);
    if (pulled) return manifestFromPackage(pulled);
    throw staticError;
  }
}

/**
 * A chapter's HTML fragment as raw text, ready for `ChapterView` to inject
 * into its content node. `file` is the manifest chapter's `file` field
 * (e.g. "chapters/p0-1.html"), relative to the package/course root.
 *
 * Same first source as `loadManifest`, and it does not fall back: if a
 * cached package answers for this course, a chapter it does not contain is
 * a `PackageAssetError`, not a reason to go and get somebody else's copy.
 *
 * There is no step (3) here — no "pull it from the server" — because there
 * is nothing left for it to do. `loadManifest` runs first in every path
 * that reaches a chapter (`Reader` needs the manifest to know the chapter
 * exists), so by the time this is called the package has already been
 * downloaded and step (1) hits.
 */
export async function loadChapter(courseId: string, file: string): Promise<string> {
  const cached = await pinnedPackage(courseId);
  if (cached) {
    const bytes = cached.files[file];
    if (bytes === undefined) throw new PackageAssetError(courseId, cached.version, file);
    return decodeUtf8(bytes);
  }

  const url = assetUrl(courseId, file);
  const res = await fetch(url);
  if (!res.ok) {
    throw new CourseFetchError(url, res.status);
  }
  return res.text();
}

/**
 * The one file name a package uses for its simulations. Fixed, not read from
 * the manifest: `packages/course-kit/runtime.js` is what `defineViz` lives in
 * and `tools/extract.py` is what writes the file, and both spell it this way.
 */
const VIZ_FILE = 'viz.js';

/**
 * Blob URLs handed out for cached packages' `viz.js`, one per course.
 *
 * The cache is not an optimization — it is what makes `useCourseKit` work.
 * That hook dedupes script injection **by URL** (`vizPromisesBySrc`), so a
 * fresh `URL.createObjectURL` per call would inject the same script once per
 * mount: `defineViz` re-run 59 times, and `runtime.js`'s registry growing a
 * duplicate entry for every visit to a chapter. One stable URL per course is
 * the contract that hook is written against.
 *
 * Keyed by `courseId`, holding the version it was made from, so that
 * `applyUpdate` swapping in a new package version revokes the superseded blob
 * instead of serving last version's simulations forever.
 *
 * Known limit, stated rather than hidden: `clearLocalData()` empties
 * `db.packages` without going through here, so a blob for a course cleared
 * that way stays alive until the document goes. That is one ~170 KB object per
 * course per session, and closing it properly would mean `db/local.ts`
 * importing this module, which already imports `db/local.ts`. `revokeVizScriptUrls`
 * is exported for whoever needs to break that tie.
 */
const vizBlobUrls = new Map<string, { version: string; url: string }>();

function vizBlobUrl(courseId: string, version: string, bytes: Uint8Array): string {
  const existing = vizBlobUrls.get(courseId);
  if (existing) {
    if (existing.version === version) return existing.url;
    URL.revokeObjectURL(existing.url);
  }
  // `type` matters: a blob served without a JavaScript MIME type is refused by
  // `<script src>` in browsers that enforce `X-Content-Type-Options`-style
  // checks on blob URLs, and the failure surfaces as a load error rather than
  // as anything that names the cause.
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'text/javascript' }));
  vizBlobUrls.set(courseId, { version, url });
  return url;
}

/**
 * Release every blob URL this module is holding.
 *
 * Called by tests between cases; also the hook for any caller that knows the
 * cached packages have gone away (see the note on `vizBlobUrls`). Safe to call
 * when there is nothing to release.
 */
export function revokeVizScriptUrls(): void {
  for (const { url } of vizBlobUrls.values()) URL.revokeObjectURL(url);
  vizBlobUrls.clear();
}

/**
 * Where `courseId`'s own `viz.js` lives, or `null` when this course has
 * none — the same two-source question as the manifest and the chapters,
 * asked about the one file that is loaded as a `<script src>` rather than
 * fetched (see `reader/useCourseKit.ts`).
 *
 * **Ruling S1-F14, which this exists to close.** `useCourseKit` used to
 * request `/courses/<id>/viz.js` unconditionally and only report
 * `ready: true` once it had loaded. A `content`-tier package has no viz.js
 * BY DEFINITION — the tier means "prose, no JavaScript", and it is the tier
 * the registry recommends — so every imported content course either parked
 * on `ready: false` behind "Đang tải chương…" forever, or, where the host
 * answers a missing file with an SPA fallback, "loaded" an HTML page as
 * JavaScript. Either way the reader never saw the chapter.
 *
 * Returned as a RELATIVE url, unlike `assetUrl`'s absolute ones: this is
 * consumed as a `<script src>`, which the browser resolves against the
 * document, and `fetch` is the only thing here that needs an origin.
 *
 * **The question is "does this package HAVE a viz.js", not "is this package
 * local"** — and the difference between those two is a bug this function
 * shipped with. The first version answered `null` for every cached package,
 * `interactive` ones included, which closed S1-F14 and opened a hole the
 * same size: an imported `interactive` course rendered its prose and ran
 * zero of its simulations, `viz.js` never requested. Measured on the real
 * 46-file textbook after task 11 took it out of the repo — 0 canvases, 0
 * registered viz — which is precisely the path the whole subsystem was
 * built to serve. What S1-F14 actually needed was "a content package must
 * not hang waiting for a file it does not have by definition", and that is
 * the `files[VIZ_FILE] === undefined` branch below, kept exactly.
 *
 * `/courses/<id>/viz.js` is still wrong for a cached package — it serves
 * the directory this app ships, so for an imported course it is a 404 or,
 * worse, a DIFFERENT course's script. The package's own bytes are right
 * there in `files`, so they are served from there, as a blob URL.
 *
 * **On trust.** A blob URL inherits the origin of the document that created
 * it, so this script runs same-origin — exactly the trust
 * `/courses/<id>/viz.js` already carries, not a widening of it. And it only
 * ever happens for `tier: 'interactive'`, the tier spec §1.2 defines as
 * "may ship JavaScript, and the guarantee comes from human review at the
 * registry rather than from the validator". A `content` package cannot
 * reach this line: `validate.ts`'s `JS_FILE_IN_PACKAGE` rejects a `.js`
 * file at that tier, so `files['viz.js']` is absent and the branch above
 * returns `null`.
 */
export async function resolveVizScriptUrl(courseId: string): Promise<string | null> {
  const cached = await pinnedPackage(courseId);
  if (!cached) return `/courses/${encodeURIComponent(courseId)}/viz.js`;

  const bytes = cached.files[VIZ_FILE];
  // No viz.js in the package — a `content` course, which is most of them.
  // This is ruling S1-F14's case and its answer is unchanged: `null`, so
  // `useCourseKit` reports `ready: true` off the shared trio alone instead
  // of parking forever on a file that does not exist.
  if (bytes === undefined) return null;

  return vizBlobUrl(courseId, cached.version, bytes);
}
