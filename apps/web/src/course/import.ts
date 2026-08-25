/**
 * How a course package gets INTO this browser — the one door for all three
 * ways a reader can bring one: a `.zip` on their disk, a `.zip` at a URL, and
 * a public GitHub repo.
 *
 * Everything upstream of this file decides what a valid package IS
 * (`packages/course-format`), and everything downstream reads one
 * (`course/loader.ts`, `db/local.ts`'s `packages` table). This module is the
 * seam, and it owes three things to both sides:
 *
 * 1. **It never writes half a package.** A package is checked completely
 *    before a single row is written, and it is written with one `put`. The
 *    failure this rules out is the one nobody notices: a course that opens,
 *    lists forty chapters, and 404s on chapter nine forever.
 * 2. **It reports EVERY problem at once.** `validatePackage` was built to do
 *    that (see its own doc comment); throwing away all but the first finding
 *    here would waste it and send an author back for one rebuild per mistake.
 * 3. **It says things a reader can act on.** Both layers below speak in
 *    English SCREAMING_CODES — that is right for a CLI and for CI. A learner
 *    pasting a link is owed a sentence. {@link describeFinding} is that
 *    translation, and `import.test.ts` fails if a code exists without one.
 *
 * ## Public repos only, and why that is the feature rather than a shortcut
 *
 * A private repo needs an access token, which means this platform would hold
 * a long-lived secret belonging to the reader — the exact thing spec §1.4
 * removed, under a new name. Someone whose course lives in a private repo
 * downloads its `.zip` and imports the file: same result, nobody holding
 * anybody's secret. The UI says so out loud (`pages/ImportCourse.tsx`), and
 * so does the finding a failed repo lookup produces, because GitHub answers
 * **404 for a private repo and for a repo that does not exist alike** — it
 * will not confirm a private repo's existence to an anonymous caller — so a
 * bare "404" would leave the reader guessing between a typo and a permission
 * they cannot grant.
 *
 * ## Why the repo path reads the git tree instead of downloading a zipball
 *
 * MEASURED, not chosen for taste. `codeload.github.com` — where every
 * `/archive/*.zip`, `/zipball` and `/tarball` URL ends up after its redirect
 * — answers with `access-control-allow-origin: https://render.githubusercontent.com`.
 * A browser `fetch` from this app's origin is therefore blocked by CORS, and
 * no amount of URL-shaping changes that: the check applies to the FINAL
 * response of a redirect chain, so `api.github.com/repos/…/zipball`
 * (`access-control-allow-origin: *` on its 302) does not help either.
 *
 * What does answer `*` is `api.github.com/repos/{owner}/{repo}/git/trees/{ref}`
 * and `raw.githubusercontent.com`. So: one API request for the whole tree,
 * then one CDN request per file. That costs more round trips than an archive
 * would, and buys two things back — the tree states every blob's SIZE, so the
 * byte budget is enforced **before** anything is downloaded (a debt
 * `validate.ts` names explicitly), and only ONE of the requests counts
 * against GitHub's 60-per-hour anonymous API limit.
 *
 * ## Cost, and where it is paid — measured in a real browser
 *
 * `validatePackage` tokenizes every byte in the package, binary entries
 * included (an image contains `0x3C` often enough that its "no `<` in here"
 * shortcut never fires), and it is synchronous. Chromium, on a VALID
 * 19.71 MiB / 197-entry package built from this repo's own fixture chapters,
 * ten samples across two sessions:
 *
 *     unpackZip          141 – 189 ms
 *     validatePackage    926 – 983 ms
 *
 * Treat those as an order of magnitude, not a budget: they were taken on a
 * heavily loaded machine (see task-8-report.md for the caveat and for what
 * in this file's design does NOT depend on them).
 *
 * That is the main thread, held. It is **not** removed by anything in this
 * module — {@link stageAnnouncer} only makes the waiting state reach the
 * screen first, which it demonstrably did not before (see that function).
 * Removing the freeze itself needs the scan in a Worker, and that trade is
 * left open rather than taken here: `apps/web` runs its whole suite in jsdom,
 * which has no `Worker`, so a worker path would be a shipped path no test in
 * this repo executes — and this app's own history (docs/carried-forward.md
 * §2) is one of gates that looked green because they ran nothing. A bounded,
 * labelled ~1.2 s stall at the very top of the budget is the smaller cost;
 * the number is written down here so whoever revisits it starts from a
 * measurement.
 */

import {
  LOCAL_NAME_NOT_INDEXED,
  MANIFEST_PATH,
  MAX_UNCOMPRESSED_BYTES,
  UnsafeArchiveError,
  parseManifest,
  unpackZip,
  validatePackage,
  type Finding,
  type FindingCode,
} from '@tuhoc/course-format';

import { db, type PackageRow } from '../db/local';
import type { MessageKey, Translate } from '../i18n';

/* ------------------------------------------------------------------ *
 * The shapes
 * ------------------------------------------------------------------ */

/**
 * Where a package is coming from.
 *
 * `gitUrl` is **public repos only** — see this module's header. It is a
 * separate variant from `zipUrl` rather than a URL sniff on one field
 * because the two fail for completely different reasons and owe the reader
 * completely different sentences.
 */
export type ImportSource =
  | { kind: 'file'; file: File }
  | { kind: 'zipUrl'; url: string }
  | { kind: 'gitUrl'; url: string };

export type ImportResult =
  | {
      ok: true;
      courseId: string;
      version: string;
      /**
       * The directory inside the archive the package was actually found in,
       * when that was not the archive root — see {@link rootPackage}.
       *
       * Present so the transformation can be SAID OUT LOUD. Re-rooting is
       * this module reinterpreting what the reader handed it, and a silent
       * reinterpretation is the kind of helpfulness that is indistinguishable
       * from a bug: a reader whose archive holds two courses, or whose real
       * package sits next to a sample one, has no way to tell which of them
       * they just installed. `undefined` when the archive was already a
       * package, because a note that appears every time is a note nobody
       * reads.
       */
      rerootedFrom?: string;
      /** How many files sat outside that directory and were left behind. */
      droppedFiles?: number;
    }
  | { ok: false; findings: readonly Finding[] };

/** What the importer is doing right now, for an honest waiting state. */
export type ImportStage = 'fetching' | 'unpacking' | 'checking' | 'saving';

export interface ImportOptions {
  /**
   * Called before each phase begins, after which the import gives the event
   * loop a full turn so the browser can draw whatever this put on screen.
   *
   * A React caller must therefore commit SYNCHRONOUSLY here — `flushSync`,
   * not a bare `setState`. Ending the task lets the browser paint what the
   * DOM says; it does not make React's scheduler have run by then, and
   * measurement in real Chromium showed the commit and the scan landing in
   * one task when it did not. See {@link stageAnnouncer}.
   */
  onStage?: (stage: ImportStage) => void;

  /**
   * How many of a repo's files have been downloaded, out of how many.
   *
   * Only the repo route calls this — it is the only one that makes one
   * request per file — and it is the difference between a truthful wait and
   * a frozen page. Measured in review, real network, real Chromium: 25 files
   * took 3.67 s and 313 files took 20.04 s for 188 KB of data, because the
   * cost is round trips rather than bytes. Nothing here makes that fast.
   * What it can do is stop lying about it.
   *
   * Unlike {@link onStage} this does NOT need `flushSync`: it fires between
   * network round trips, with the main thread idle, so React's ordinary
   * scheduling gets a paint on its own. The `flushSync` rule exists because
   * a stage announcement is immediately followed by a second of synchronous
   * work; this is not.
   */
  onProgress?: (done: number, total: number) => void;

  /**
   * Stops an import in flight.
   *
   * The reason this exists is the same measurement: a repo import can run
   * for a minute, and before this there was no way to stop one — every
   * control on the page is `disabled={busy}`, so the only exit was closing
   * the tab. Note what it can and cannot interrupt: the fetch loop, yes; the
   * `validatePackage` scan, no, because that holds the main thread and
   * nothing else runs while it does. That is the honest boundary and the UI
   * is written to it.
   */
  signal?: AbortSignal;
  /**
   * Chữ cho người đọc. BẮT BUỘC, không mặc định.
   *
   * Module này không phải component và cố ý không có context nào để đọc —
   * nó cũng chạy được ngoài React. Ngôn ngữ vì thế đi vào bằng tham số, và
   * bắt buộc để `tsc` bắt mọi chỗ gọi tự nói ra nó đang nhập hộ ai.
   */
  t: Translate;
}

/**
 * Codes this module can emit, on top of the ones
 * `packages/course-format` defines.
 *
 * Exported for the same reason `FINDING_CODES` is: so
 * {@link describeFinding} can be checked against the complete list rather
 * than against the subset somebody remembered.
 */
export const IMPORT_FINDING_CODES = [
  'BAD_URL',
  'FETCH_FAILED',
  'FILE_READ_FAILED',
  'HTTP_ERROR',
  'NOT_A_ZIP',
  'ZIP64_UNSUPPORTED',
  'ARCHIVE_INDEX_MISMATCH',
  'DUPLICATE_ENTRY',
  'PACKAGE_ROOT_AMBIGUOUS',
  'UNPACKABLE_ENTRY',
  'GIT_HOST_UNSUPPORTED',
  'GIT_REPO_UNREACHABLE',
  'GIT_PATH_NOT_FOUND',
  'GIT_RATE_LIMITED',
  'GIT_BAD_RESPONSE',
  'GIT_TREE_TRUNCATED',
  'GIT_TOO_MANY_FILES',
  'WRITE_FAILED',
  'CANCELLED',
  'UNEXPECTED',
] as const;

export type ImportFindingCode = (typeof IMPORT_FINDING_CODES)[number];

/** Path used by findings about the package as a whole, matching `validate.ts`. */
const PACKAGE_ROOT = '.';

function finding(code: string, path: string, detail: string): Finding {
  return { code, path, detail };
}

function fail(code: string, path: string, detail: string): ImportResult {
  return { ok: false, findings: [finding(code, path, detail)] };
}

/* ------------------------------------------------------------------ *
 * Vietnamese, for a reader
 * ------------------------------------------------------------------ */

/**
 * One finding, as a sentence a learner can act on.
 *
 * The two layers below this one speak English codes and English detail
 * strings on purpose — they serve a CLI and a CI job as well as this app,
 * and `SCRIPT_TAG` is the right thing to print next to a diff. It is not the
 * right thing to put in front of somebody who just dragged a file onto a web
 * page, which is why this exists and why `import.test.ts` walks
 * `FINDING_CODES` + {@link IMPORT_FINDING_CODES} and fails on any code
 * without an entry here.
 *
 * `detail` is appended where it names the specific thing that is wrong (a
 * path, a status, a version string) and dropped where it would only restate
 * the sentence in English.
 */
export function describeFinding(f: Finding, t: Translate): string {
  const where = f.path && f.path !== PACKAGE_ROOT ? ` (${f.path})` : '';
  const key = (FINDING_KEY as Readonly<Record<string, MessageKey | undefined>>)[f.code];
  if (key === undefined) {
    return t('finding.undescribed', where, f.detail);
  }
  // Ba khoá mang tham số là HẰNG SỐ của mã (trần MB, tên tệp manifest), nên
  // chúng được điền ở đây thay vì ở bảng — bảng là hằng ở tầm module và
  // không được chứa chữ đã dịch.
  const text =
    key === 'finding.TOO_LARGE'
      ? t(key, String(Math.round(MAX_UNCOMPRESSED_BYTES / (1024 * 1024))))
      : key === 'finding.MANIFEST_MISSING' || key === 'finding.MANIFEST_PARSE' || key === 'finding.MANIFEST_FIELD'
        ? t(key, MANIFEST_PATH)
        : t(key as Exclude<typeof key, 'finding.TOO_LARGE' | 'finding.MANIFEST_MISSING' | 'finding.MANIFEST_PARSE' | 'finding.MANIFEST_FIELD' | 'finding.undescribed'>);
  return CARRIES_ITS_OWN_DETAIL.has(f.code) ? `${text}${where} ${f.detail}` : `${text}${where}`;
}

/**
 * Codes whose `detail` is written in this file, in Vietnamese, and adds
 * something the headline sentence cannot say — a status code, a repo's
 * declared size, the alternative route to take.
 *
 * Nothing from `packages/course-format` is in here, and that is the point.
 * Its details are English technical strings meant for a CLI diff and a CI
 * log, so appending them produced lines like
 *
 *     Số phiên bản của khóa học không đúng dạng X.Y.Z. (manifest.json#/version)
 *     not a semver version: "khong-phai-semver"
 *
 * — a Vietnamese sentence with an English fragment glued on, which is the
 * same failure as showing the bare code, one step later. Caught by looking
 * at the real screen, not by a test; there is now a test
 * (`import.test.ts`, "không rò một chữ tiếng Anh nào") so it stays caught.
 * What the reader gets instead is the sentence plus `path`, and `path` for
 * these is a JSON Pointer into their own manifest — it locates the bad value
 * exactly, in the file they are about to open anyway.
 */
const CARRIES_ITS_OWN_DETAIL = new Set<string>([
  'BAD_URL',
  'FETCH_FAILED',
  'FILE_READ_FAILED',
  'HTTP_ERROR',
  'ZIP64_UNSUPPORTED',
  'ARCHIVE_INDEX_MISMATCH',
  'PACKAGE_ROOT_AMBIGUOUS',
  'UNPACKABLE_ENTRY',
  'GIT_HOST_UNSUPPORTED',
  'GIT_REPO_UNREACHABLE',
  'GIT_PATH_NOT_FOUND',
  'GIT_RATE_LIMITED',
  'GIT_BAD_RESPONSE',
  'GIT_TOO_MANY_FILES',
  'WRITE_FAILED',
  'UNEXPECTED',
]);

/**
 * Typed as the EXHAUSTIVE map of both code sets, not as
 * `Record<string, string>`: that makes a missing entry a red `tsc -b` rather
 * than a code leaking to a reader as `TAG_ATTR_FLOOD`. The lookup in
 * {@link describeFinding} widens it back, because `Finding.code` is a plain
 * string and a package built against a newer rule set can carry a code this
 * build has never heard of.
 */
/**
 * Mã phát hiện → KHOÁ trong catalog. Chữ sống ở `packages/i18n`, không ở đây:
 * bảng này là hằng ở tầm module, dựng MỘT LẦN lúc nạp — trước khi có ngôn ngữ
 * nào được chọn — nên nó không được phép chứa chữ đã dịch.
 *
 * `MessageKey` làm `tsc` kiểm rằng từng khoá tồn tại thật, và `import.test.ts`
 * đi hết `FINDING_CODES` + {@link IMPORT_FINDING_CODES} rồi đỏ ở bất kỳ mã nào
 * không có mục — nên một mã mới không lặng lẽ rơi xuống câu "chưa được mô tả".
 */
const FINDING_KEY: Readonly<Record<ImportFindingCode | FindingCode, MessageKey>> = {
  EMPTY_PACKAGE: 'finding.EMPTY_PACKAGE',
  TOO_LARGE: 'finding.TOO_LARGE',
  PATH_ESCAPE: 'finding.PATH_ESCAPE',
  MANIFEST_MISSING: 'finding.MANIFEST_MISSING',
  MANIFEST_PARSE: 'finding.MANIFEST_PARSE',
  MANIFEST_FIELD: 'finding.MANIFEST_FIELD',
  TIER_REMOVED: 'finding.TIER_REMOVED',
  SEMVER: 'finding.SEMVER',
  RUNTIME_RANGE: 'finding.RUNTIME_RANGE',
  DUPLICATE_CHAPTER_ID: 'finding.DUPLICATE_CHAPTER_ID',
  CHAPTER_FILE_MISSING: 'finding.CHAPTER_FILE_MISSING',
  SCRIPT_TAG: 'finding.SCRIPT_TAG',
  EVENT_HANDLER_ATTR: 'finding.EVENT_HANDLER_ATTR',
  JAVASCRIPT_URL: 'finding.JAVASCRIPT_URL',
  EMBEDDED_FRAME: 'finding.EMBEDDED_FRAME',
  FORM_TAG: 'finding.FORM_TAG',
  JS_FILE_IN_PACKAGE: 'finding.JS_FILE_IN_PACKAGE',
  TAG_ATTR_FLOOD: 'finding.TAG_ATTR_FLOOD',
  BAD_URL: 'finding.BAD_URL',
  FETCH_FAILED: 'finding.FETCH_FAILED',
  FILE_READ_FAILED: 'finding.FILE_READ_FAILED',
  HTTP_ERROR: 'finding.HTTP_ERROR',
  NOT_A_ZIP: 'finding.NOT_A_ZIP',
  ZIP64_UNSUPPORTED: 'finding.ZIP64_UNSUPPORTED',
  ARCHIVE_INDEX_MISMATCH: 'finding.ARCHIVE_INDEX_MISMATCH',
  DUPLICATE_ENTRY: 'finding.DUPLICATE_ENTRY',
  PACKAGE_ROOT_AMBIGUOUS: 'finding.PACKAGE_ROOT_AMBIGUOUS',
  UNPACKABLE_ENTRY: 'finding.UNPACKABLE_ENTRY',
  GIT_HOST_UNSUPPORTED: 'finding.GIT_HOST_UNSUPPORTED',
  GIT_REPO_UNREACHABLE: 'finding.GIT_REPO_UNREACHABLE',
  GIT_PATH_NOT_FOUND: 'finding.GIT_PATH_NOT_FOUND',
  GIT_RATE_LIMITED: 'finding.GIT_RATE_LIMITED',
  GIT_BAD_RESPONSE: 'finding.GIT_BAD_RESPONSE',
  GIT_TREE_TRUNCATED: 'finding.GIT_TREE_TRUNCATED',
  GIT_TOO_MANY_FILES: 'finding.GIT_TOO_MANY_FILES',
  WRITE_FAILED: 'finding.WRITE_FAILED',
  CANCELLED: 'finding.CANCELLED',
  UNEXPECTED: 'finding.UNEXPECTED',
};

/* ------------------------------------------------------------------ *
 * Finding the package root
 * ------------------------------------------------------------------ */

/**
 * The package root, re-rooted if it is not the archive root.
 *
 * A package is defined by having `manifest.json` at its top, and almost
 * nothing in the world hands you an archive shaped that way:
 *
 * - **Every GitHub zipball** puts the whole tree under `{repo}-{ref}/`. There
 *   is no option to turn that off.
 * - **Finder's "Compress"** (`ditto -c -k --sequesterRsrc --keepParent`) puts
 *   it under the folder's own name, and parks AppleDouble sidecars under a
 *   SECOND top-level directory, `__MACOSX/`. Measured: the fixture package
 *   compressed that way fails `MANIFEST_MISSING`, which is a true statement
 *   about the wrong thing.
 *
 * So "strip the single common top-level directory" is not the rule — there
 * are two of them. The rule is the definition itself: the package root is the
 * directory that has a `manifest.json` directly in it. That is decidable, it
 * is checkable, and when more than one directory qualifies this refuses
 * instead of picking one, which is the same discipline `zip.ts` applies to an
 * index it cannot read.
 *
 * Entries outside the chosen root are dropped, and that is the point rather
 * than a side effect: `__MACOSX/` is macOS metadata, it is never named by a
 * manifest, and carrying it into `db.packages` would store junk on a
 * reader's device forever. How many were dropped is REPORTED rather than
 * assumed harmless — see {@link ImportResult}.
 *
 * ## Three levels, shallowest wins, and neither hidden nor `__MACOSX`
 *
 * The first version looked exactly one level down, which covered a zipball
 * and Finder and nothing else. Measured in review: a repo that keeps its
 * course in a subdirectory (`repo-main/khoa/manifest.json` after zipballing)
 * failed `MANIFEST_MISSING` — "the package has no manifest.json at its root"
 * — a true sentence about entirely the wrong thing. Each level is one more
 * level of guessing, so the search stops at three, which is what the real
 * world actually produces: a zipball prefix, a Finder wrapper, one
 * subdirectory. Past that, `MANIFEST_MISSING` is the honest answer.
 *
 * Searching deeper makes ambiguity cheap in a way one level never did — a
 * package that ships a sample course underneath itself now has two
 * candidates — so the SHALLOWEST depth with any candidate is the one that
 * decides, and only a tie THERE is ambiguous. Anything below the package
 * root is content, not a rival.
 *
 * And two kinds of directory are never candidates, whatever they contain:
 * dot-prefixed ones, because `fetchGitHubRepo` and `tuhoc pack` both drop
 * every hidden entry and two doors into the same library must not disagree
 * about what a package is (`.pkg/manifest.json` imported happily before
 * this); and `__MACOSX`, because Finder mirrors the package's own tree
 * inside it, so a package with `manifest.json` at its root arrives with a
 * `__MACOSX/manifest.json` beside it and was refused as "2 khóa học".
 */

/** How many directory levels down the search for a package root will go. */
const MAX_ROOT_DEPTH = 3;

/** Directory names that are never a package root, whatever is inside them. */
function neverARoot(segment: string): boolean {
  return segment === '' || segment.startsWith('.') || segment === '__MACOSX';
}

interface Rooted {
  files: Map<string, Uint8Array>;
  rerootedFrom?: string;
  droppedFiles?: number;
}

function rootPackage(files: ReadonlyMap<string, Uint8Array>, t: Translate): Rooted | { error: Finding } {
  if (files.has(MANIFEST_PATH)) return { files: new Map(files) };

  const suffix = `/${MANIFEST_PATH}`;
  /** Candidate roots, keyed by how many directory levels deep they are. */
  const byDepth = new Map<number, Set<string>>();
  for (const name of files.keys()) {
    if (!name.endsWith(suffix)) continue;
    const dir = name.slice(0, name.length - suffix.length);
    const segments = dir.split('/');
    if (segments.length > MAX_ROOT_DEPTH || segments.some(neverARoot)) continue;
    const atDepth = byDepth.get(segments.length) ?? new Set<string>();
    atDepth.add(dir);
    byDepth.set(segments.length, atDepth);
  }

  // None: leave the archive exactly as it is and let `validatePackage` say
  // `MANIFEST_MISSING`. Inventing a different message here would just be a
  // second, worse copy of a rule that already has one.
  if (byDepth.size === 0) return { files: new Map(files) };

  const roots = [...(byDepth.get(Math.min(...byDepth.keys())) ?? [])].sort();
  if (roots.length > 1) {
    return {
      error: finding(
        'PACKAGE_ROOT_AMBIGUOUS',
        PACKAGE_ROOT,
        t('import.detail.manyRoots', String(roots.length), roots.join(', ')),
      ),
    };
  }

  const only = roots[0];
  const prefix = `${only}/`;
  const out = new Map<string, Uint8Array>();
  for (const [name, bytes] of files) {
    if (name.startsWith(prefix)) out.set(name.slice(prefix.length), bytes);
  }
  const dropped = files.size - out.size;
  return { files: out, rerootedFrom: only, droppedFiles: dropped > 0 ? dropped : undefined };
}

/* ------------------------------------------------------------------ *
 * Getting the bytes
 * ------------------------------------------------------------------ */

/** `http:`/`https:` only — anything else never reaches `fetch`. */
function httpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
}

/**
 * The bytes at a URL, or a finding.
 *
 * **`arrayBuffer()` is inside the `try`, and that is the whole point of this
 * shape.** The first version of this function wrapped only `fetch(url)`,
 * which reads as "the network call is the risky part" and is wrong: `fetch`
 * resolves as soon as the HEADERS arrive, and the body streams in afterwards.
 * A connection that dies halfway through — the commonest network failure
 * there is — therefore rejects at `arrayBuffer()`, several lines below where
 * anybody was looking. Measured in review against a server answering
 * `HTTP/1.1 200` with a correct `Content-Length` and then resetting at
 * 200 000 bytes of an 18.6 MiB package: the rejection escaped `importCourse`,
 * reached the page as an `unhandledrejection`, and drew NOTHING. The reader
 * pressed the button and the page went back to how it was.
 */
async function fetchBytes(
  url: string,
  t: Translate,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array } | { error: Finding }> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (cause) {
    if (aborted(cause)) return { error: cancelled() };
    return { error: finding('FETCH_FAILED', url, fetchFailedDetail(cause, t)) };
  }
  if (!res.ok) {
    return { error: finding('HTTP_ERROR', url, t('import.detail.httpStatus', String(res.status))) };
  }
  try {
    return { bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch (cause) {
    if (aborted(cause)) return { error: cancelled() };
    return { error: finding('FETCH_FAILED', url, bodyCutOffDetail(cause, t)) };
  }
}

/** What `fetch` throws when its signal fires — not a failure to report as one. */
function aborted(cause: unknown): boolean {
  return (cause as { name?: unknown } | null)?.name === 'AbortError';
}

function cancelled(): Finding {
  return finding('CANCELLED', PACKAGE_ROOT, '');
}

/** A thrown value as a short parenthetical — never the whole stack. */
function describeThrown(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * What a rejected `fetch` means, said out loud.
 *
 * The browser will not tell the page which of these happened — a CORS
 * refusal and a dead network are the same opaque `TypeError: Failed to
 * fetch`, deliberately, so that a page cannot use fetch failures to probe a
 * network it cannot otherwise see. Listing both beats printing the
 * `TypeError`, which names neither. CORS is first because it is the one a
 * reader will actually hit: most static hosts do not send
 * `access-control-allow-origin`, and neither does GitHub's own
 * `codeload.github.com` — see this module's header.
 */
function fetchFailedDetail(cause: unknown, t: Translate): string {
  return t('import.detail.fetchFailed', describeThrown(cause));
}

/**
 * A body that started arriving and then stopped — a DIFFERENT sentence from
 * {@link fetchFailedDetail} on purpose.
 *
 * By the time this fires the server has already answered, so CORS and "you
 * are offline" are both ruled out and repeating them would send the reader
 * to check two things that are fine. What is left is a connection that broke
 * mid-download, and the useful advice is the one that fits it: try again.
 */
function bodyCutOffDetail(cause: unknown, t: Translate): string {
  return t('import.detail.bodyCutOff', describeThrown(cause));
}

/* ------------------------------------------------------------------ *
 * A public GitHub repo
 * ------------------------------------------------------------------ */

/**
 * Ceiling on how many files a repo import will fetch.
 *
 * The byte budget is the real fence and it is applied first; this is about
 * REQUESTS. A repo of ten thousand one-byte files fits inside 20 MB and would
 * still be ten thousand round trips at somebody else's CDN.
 *
 * **300, and the number comes from a stopwatch.** It was 1000, chosen as
 * "twenty times the only real datapoint" (this repo's own 46-file course)
 * when nobody had timed the loop. Timed in review, real network, real
 * Chromium, this exact shape at `GIT_FETCH_CONCURRENCY = 8`:
 *
 *     git-lfs/lfs-test-server    25 files  →   3.67 s
 *     github/gitignore          313 files  →  20.04 s   (188 KB of data)
 *
 * Round trips, not bytes: about 64 ms per file amortised. 1000 files is
 * therefore a minute of somebody's afternoon, and a ceiling of a minute is
 * not a ceiling, it is a place where people give up. Twenty seconds is
 * already at the edge of what a progress counter can carry, so that is where
 * this stops. 300 is still six times the only real course anybody has, and
 * the finding names the way out — download the `.zip`, import the file —
 * which has no such limit because it is one request.
 *
 * Firing a thousand consecutive requests at `raw.githubusercontent.com` was
 * also never a polite thing to do; that CDN has limits of its own.
 */
export const MAX_GIT_FILES = 300;

/** How many blob fetches are in flight at once. */
const GIT_FETCH_CONCURRENCY = 8;

/**
 * Extra attempts for a blob whose fetch was REJECTED, before giving up.
 *
 * Across three hundred requests a transient failure stops being an edge case
 * and becomes the expected case, and the loop's old behaviour was to return
 * on the first one — so a single hiccup at file 300 threw away the other
 * 299 and the nineteen seconds they cost. Two retries turn the common
 * version of that into a delay instead of a restart.
 *
 * Only a rejected `fetch` is retried. An HTTP status is a DECISION: a 404 is
 * 404 again a moment later, and retrying it would just triple the wait
 * before the same message. The cancel signal is checked between batches, so
 * a reader who is done waiting is not held by retries either.
 */
const GIT_BLOB_RETRIES = 2;

export interface GitTarget {
  owner: string;
  repo: string;
  ref: string;
  /** The directory inside the repo holding the course; `''` for all of it. */
  subdir: string;
}

/**
 * What a GitHub URL could mean, likeliest first — empty if it is not one.
 *
 * `HEAD` as the default ref, not `main`: it is what GitHub resolves to the
 * repo's own default branch, so a repo still on `master` — or on anything
 * else — works without a second probe. Both the trees API and
 * `raw.githubusercontent.com` accept it.
 *
 * ## Why a LIST, and not one answer
 *
 * `/tree/a/b/c` is genuinely ambiguous and GitHub's URL does not resolve it:
 * `a/b/c` can be one branch whose name contains slashes, or branch `a` and
 * the directory `b/c` inside it. Only the repo knows. The first version
 * assumed the first reading always, which is correct for `release/2026` and
 * catastrophic for the URL GitHub's own "copy link" button hands you while
 * you are looking at a folder. Measured in review on the real public repo
 * `github/gitignore`:
 *
 *     https://github.com/github/gitignore/tree/main/Global
 *     → ref "main/Global" → git/trees/main%2FGlobal → 404
 *     → "tuhoc chỉ nhập được từ repo Git CÔNG KHAI. Repo riêng tư cần token…"
 *
 * A public repo, told to its owner's face that it is private — and the
 * layout that URL describes, a course living in a subdirectory, could not be
 * imported by this route at all.
 *
 * So: both readings, whole-ref first. Whole-ref first and not the other way
 * round because it is what works today, and a fallback that only runs after
 * a 404 cannot make a working case worse. The cost is one extra request out
 * of GitHub's 60-per-hour anonymous budget, paid only when the first reading
 * turns out to be wrong.
 */
export function parseGitHubUrl(raw: string): GitTarget[] {
  const url = httpUrl(raw);
  if (url === null) return [];
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return [];

  const segments = url.pathname.split('/').filter((s) => s !== '');
  const [owner, repoRaw, kind, ...rest] = segments;
  if (owner === undefined || repoRaw === undefined) return [];

  const repo = repoRaw.endsWith('.git') ? repoRaw.slice(0, -'.git'.length) : repoRaw;
  if (repo === '') return [];

  // `/tree/<ref>` and `/blob/<ref>` are what the "copy link" button in
  // GitHub's own UI produces while looking at a branch or a tag.
  if ((kind !== 'tree' && kind !== 'blob') || rest.length === 0) {
    return [{ owner, repo, ref: 'HEAD', subdir: '' }];
  }
  const both: GitTarget[] = [{ owner, repo, ref: rest.join('/'), subdir: '' }];
  if (rest.length > 1) {
    both.push({ owner, repo, ref: rest[0], subdir: rest.slice(1).join('/') });
  }
  return both;
}

interface TreeEntry {
  path: string;
  type: string;
  mode: string;
  size?: number;
}

/**
 * Every packable file in a public repo, keyed by repo-relative path.
 *
 * Hidden entries are skipped at any depth, exactly as
 * `tools/tuhoc-cli/src/readdir.ts` skips them when packing a directory: a
 * course repo has a `.github/`, a `.gitignore` and often a `.DS_Store`, none
 * of which are part of the course, and `.git/` alone would blow the byte
 * budget and report `TOO_LARGE` — a true finding about entirely the wrong
 * thing. The CLI made that call for the same tree read off a disk; this is
 * the same tree read over HTTP.
 */
async function fetchGitHubRepo(
  repo: GitTarget,
  announce: (stage: ImportStage) => Promise<void>,
  options: ImportOptions,
): Promise<{ files: Map<string, Uint8Array>; rerootedFrom?: string } | { error: Finding }> {
  const treeUrl = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/trees/${encodeURIComponent(repo.ref)}?recursive=1`;
  const at = `${repo.owner}/${repo.repo}`;
  const { signal, t } = options;

  await announce('fetching');

  let res: Response;
  try {
    res = await fetch(treeUrl, { headers: { Accept: 'application/vnd.github+json' }, signal });
  } catch (cause) {
    if (aborted(cause)) return { error: cancelled() };
    return { error: finding('FETCH_FAILED', at, fetchFailedDetail(cause, t)) };
  }

  if (res.status === 404) {
    return {
      error: finding(
        'GIT_REPO_UNREACHABLE',
        at,
        t('import.detail.privateRepo'),
      ),
    };
  }
  if (res.status === 403 || res.status === 429) {
    return {
      error: finding('GIT_RATE_LIMITED', at, t('import.detail.rateLimited')),
    };
  }
  if (!res.ok) {
    return { error: finding('HTTP_ERROR', at, t('import.detail.githubStatus', String(res.status))) };
  }

  // Inside a `try` for the same reason `arrayBuffer()` is in `fetchBytes`:
  // `res.ok` says the response arrived, not that it is the response that was
  // asked for. A Wi-Fi captive portal answers 200 with its own login page for
  // EVERY request — `content-type` and all — and `res.json()` on that rejects
  // with a SyntaxError, from a line nobody was guarding.
  let body: { truncated?: boolean; tree?: TreeEntry[] };
  try {
    body = (await res.json()) as { truncated?: boolean; tree?: TreeEntry[] };
  } catch (cause) {
    return {
      error: finding(
        'GIT_BAD_RESPONSE',
        at,
        t('import.detail.captivePortal', describeThrown(cause)),
      ),
    };
  }
  if (body.truncated === true) {
    return { error: finding('GIT_TREE_TRUNCATED', at, '') };
  }

  const prefix = repo.subdir === '' ? '' : `${repo.subdir}/`;
  const inScope = (body.tree ?? []).filter((e) => e.path.startsWith(prefix) && !isHidden(e.path));

  if (prefix !== '' && inScope.length === 0) {
    return {
      error: finding(
        'GIT_PATH_NOT_FOUND',
        at,
        t('import.detail.subdirMissing', repo.ref, repo.subdir),
      ),
    };
  }

  // A symlink or a submodule is a path that means one thing inside the repo
  // and nothing at all inside a package — the same reason the CLI throws
  // `UnpackableEntryError` rather than following or dropping it.
  //
  // **`type === 'commit'` is tested BEFORE the blob filter, and that ordering
  // is the whole fix.** A submodule is not a blob: `git/trees` gives it
  // `type: "commit"`, so filtering to blobs first threw it away and the
  // `160000` test below could never fire — the rejection was dead code, and
  // what actually happened to a repo with submodules was that their contents
  // vanished without a word. Measured on `WebAssembly/wabt` (7 submodules):
  // `byType { blob: 1877, commit: 7, tree: 82 }`, and the import answered
  // `GIT_TOO_MANY_FILES`. Silent is the dangerous half: `validatePackage`
  // checks the chapter files a manifest names, not assets, so a course
  // keeping its images in a submodule imported clean and 404s forever.
  const blobs = inScope.filter((e) => e.type === 'blob');
  const unpackable = [
    ...inScope.filter((e) => e.type === 'commit' || e.mode === '160000'),
    ...blobs.filter((e) => e.mode !== '100644' && e.mode !== '100755'),
  ];
  const firstBad = unpackable[0];
  if (firstBad !== undefined) {
    return {
      error: finding(
        'UNPACKABLE_ENTRY',
        firstBad.path,
        // This one fires on somebody ELSE's repo — measured on the real
        // public `github/gitignore`, which has three symlinks — so the
        // reader usually cannot fix the cause. Every other repo-route
        // finding names the way out; this one did not, and the catalog
        // entry carries that second sentence.
        t('import.detail.unpackable', String(unpackable.length)),
      ),
    };
  }

  if (blobs.length > MAX_GIT_FILES) {
    return {
      error: finding(
        'GIT_TOO_MANY_FILES',
        at,
        t('import.detail.tooManyFiles', String(blobs.length), String(MAX_GIT_FILES)),
      ),
    };
  }

  // The budget, applied BEFORE a byte is downloaded — the tree states every
  // blob's size, so this is free here, and it is the debt `validate.ts`'s
  // own comment leaves to its caller.
  const declared = blobs.reduce((sum, e) => sum + (e.size ?? 0), 0);
  if (declared > MAX_UNCOMPRESSED_BYTES) {
    return {
      error: finding(
        'TOO_LARGE',
        PACKAGE_ROOT,
        t('import.detail.repoDeclaredBytes', String(declared)),
      ),
    };
  }

  const rawBase = `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${repo.ref.split('/').map(encodeURIComponent).join('/')}`;
  const files = new Map<string, Uint8Array>();

  for (let i = 0; i < blobs.length; i += GIT_FETCH_CONCURRENCY) {
    // Between batches, not inside one: a batch already in flight is eight
    // requests that will resolve on their own, and tearing them down halfway
    // buys nothing a reader can perceive.
    if (signal?.aborted === true) return { error: cancelled() };

    const batch = blobs.slice(i, i + GIT_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map((entry) =>
        fetchBlob(`${rawBase}/${entry.path.split('/').map(encodeURIComponent).join('/')}`, t, signal),
      ),
    );
    for (const [n, result] of results.entries()) {
      if ('error' in result) return { error: result.error };
      files.set(batch[n].path.slice(prefix.length), result.bytes);
    }
    options.onProgress?.(files.size, blobs.length);
  }

  return { files, rerootedFrom: repo.subdir === '' ? undefined : repo.subdir };
}

/** One blob, with {@link GIT_BLOB_RETRIES} more goes if the network drops it. */
async function fetchBlob(
  url: string,
  t: Translate,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array } | { error: Finding }> {
  let last = await fetchBytes(url, t, signal);
  for (let attempt = 0; attempt < GIT_BLOB_RETRIES; attempt++) {
    if (!('error' in last) || last.error.code !== 'FETCH_FAILED') return last;
    if (signal?.aborted === true) return { error: cancelled() };
    last = await fetchBytes(url, t, signal);
  }
  return last;
}

/** True for a path with any dot-prefixed segment — `.github/workflows/ci.yml` included. */
function isHidden(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith('.'));
}

/* ------------------------------------------------------------------ *
 * Reading an archive
 * ------------------------------------------------------------------ */

/** `PK\x06\x07` — the zip64 end-of-central-directory locator. */
const ZIP64_LOCATOR = [0x50, 0x4b, 0x06, 0x07] as const;

/**
 * Whether an archive carries a zip64 locator near its end.
 *
 * Only ever used to IMPROVE A MESSAGE, and the message it improves is
 * narrower than it once was. At the commit Task 8 was built on, `unpackZip`
 * refused every zip64 archive including the ordinary `zip -fz` one, and this
 * existed so that reader read "this .zip uses zip64" instead of "archive
 * index is not readable". **That is no longer the situation.** Task 2's
 * `0273c88` is not an ancestor of the commit this file was written on; both
 * are ancestors of HEAD, and at HEAD `centralDirectoryNames` reads the zip64
 * record. Re-measured against a real `zip -r -fz` archive of this repo's own
 * fixture course: it IMPORTS (`apps/web/fixtures/zip64-forced-package.zip`,
 * pinned by `import.test.ts`).
 *
 * What still reaches this branch is the zip64 that `unpackZip` refuses to
 * GUESS at: over 65,535 entries, an index starting past 4 GiB, or a v2
 * record with an extensible data sector. The advice therefore no longer says
 * "do not use `-fz`" — that would be a confident sentence about entirely the
 * wrong cause, which is the failure mode this module keeps having to fix.
 *
 * Scoped to the last 64 KiB + the two zip64 records, because that is the only
 * region the footer can be in (the archive comment is at most 0xFFFF bytes)
 * and because scanning a 20 MB buffer for a 4-byte pattern to phrase an error
 * message would be the wrong trade.
 */
function hasZip64Locator(zip: Uint8Array): boolean {
  const from = Math.max(0, zip.length - (0xffff + 98));
  for (let at = zip.length - 4; at >= from; at--) {
    if (
      zip[at] === ZIP64_LOCATOR[0] &&
      zip[at + 1] === ZIP64_LOCATOR[1] &&
      zip[at + 2] === ZIP64_LOCATOR[2] &&
      zip[at + 3] === ZIP64_LOCATOR[3]
    ) {
      return true;
    }
  }
  return false;
}

function readArchive(zip: Uint8Array, t: Translate): { files: Map<string, Uint8Array> } | { error: Finding } {
  try {
    return { files: unpackZip(zip) };
  } catch (cause) {
    if (!(cause instanceof UnsafeArchiveError)) throw cause;

    // A nested archive, said out loud — ruling S1-F26. The fence stays
    // exactly where it was; only the sentence changes, and it had to: what
    // the reader was shown was "this is not a readable .zip file" for an
    // archive `unzip -t`, `python zipfile` and Finder all open happily,
    // followed by `([Content_Types].xml)` — a path from inside their own
    // Word document, which is not in their package at all. One false
    // statement and one wild goose chase. See {@link LOCAL_NAME_NOT_INDEXED}
    // for why this is the honest reading of that refusal, and note the path:
    // `PACKAGE_ROOT`, never `cause.entry`, because `cause.entry` is exactly
    // the name that does not exist in the package.
    if (cause.code === 'MALFORMED' && cause.detail === LOCAL_NAME_NOT_INDEXED) {
      return {
        error: finding(
          'ARCHIVE_INDEX_MISMATCH',
          PACKAGE_ROOT,
          t('import.detail.nestedArchive'),
        ),
      };
    }
    if (cause.code === 'MALFORMED' && hasZip64Locator(zip)) {
      return {
        error: finding(
          'ZIP64_UNSUPPORTED',
          PACKAGE_ROOT,
          t('import.detail.zip64'),
        ),
      };
    }
    if (cause.code === 'MALFORMED') return { error: finding('NOT_A_ZIP', cause.entry, '') };
    if (cause.code === 'TOO_LARGE') {
      return { error: finding('TOO_LARGE', cause.entry, t('import.detail.bytesRead', String(cause.bytesRead))) };
    }
    // PATH_ESCAPE and DUPLICATE_ENTRY carry the same names `validate.ts` uses.
    return { error: finding(cause.code, cause.entry, '') };
  }
}

/* ------------------------------------------------------------------ *
 * The one public entry point
 * ------------------------------------------------------------------ */

/**
 * Brings one course package into this browser's library.
 *
 * **Resolves — it does not throw. Ever.** Not only for the failures a reader
 * can cause (a wrong file, a dead link, a private repo, a package with
 * mistakes in it) but for anything at all, including a bug in here: see the
 * `catch` below for why the narrower promise was not enough, and
 * `import.test.ts`'s "kết nối chết giữa chừng" block for the five cases that
 * pin it. `findings` is the complete list, so one pass shows an author
 * everything there is to fix.
 *
 * On success the package is in `db.packages` and `course/loader.ts` will
 * answer for it immediately, offline, in the same tick.
 */
export async function importCourse(src: ImportSource, options: ImportOptions): Promise<ImportResult> {
  try {
    return await runImport(src, options);
  } catch (cause) {
    // The net under the whole thing, and it is not decoration: the sentence
    // above is a CONTRACT, and every caller in this app trusts it by having
    // no `catch` of its own. Three specific escapes were found and closed one
    // by one (a cut response body, a captive portal's HTML where JSON was
    // expected, a File whose bytes are gone) — each of them was a blank
    // screen in a real browser, and each was invisible to the suite because
    // no test asserted the contract itself. Closing only those three would
    // leave the fourth to be found the same way, by somebody who is not
    // being paid to look. A reader is owed a sentence for ANY failure,
    // including one nobody predicted, so this returns the thrown message
    // rather than swallowing it: a bug report that quotes a real error is
    // worth more than a page that stayed silent.
    return fail('UNEXPECTED', PACKAGE_ROOT, options.t('import.detail.parenthetical', describeThrown(cause)));
  }
}

async function runImport(src: ImportSource, options: ImportOptions): Promise<ImportResult> {
  const announce = stageAnnouncer(options.onStage);

  const collected = await collect(src, announce, options);
  if ('error' in collected) return { ok: false, findings: [collected.error] };

  const rooted = rootPackage(collected.files, options.t);
  if ('error' in rooted) return { ok: false, findings: [rooted.error] };

  await announce('checking');
  const result = validatePackage(rooted.files);
  if (!result.ok) return { ok: false, findings: result.findings };

  const manifestBytes = rooted.files.get(MANIFEST_PATH);
  /* istanbul ignore next — validatePackage already refused a package without one. */
  if (manifestBytes === undefined) {
    return fail('MANIFEST_MISSING', MANIFEST_PATH, '');
  }
  const parsed = parseManifest(new TextDecoder('utf-8').decode(manifestBytes));
  if ('error' in parsed) return { ok: false, findings: [parsed.error] };
  const { manifest } = parsed;

  await announce('saving');
  const row: PackageRow = {
    key: `${manifest.id}@${manifest.version}`,
    courseId: manifest.id,
    version: manifest.version,
    manifest,
    files: Object.fromEntries(rooted.files),
    // Importing a version IS pinning it: the reader asked for this one, just
    // now. `course/loader.ts` reads the most recent pin.
    pinnedAt: new Date().toISOString(),
  };

  try {
    // ONE write. There is no earlier partial write to undo, which is why this
    // module reads and checks everything before it touches Dexie at all —
    // a half-written course is one that opens and then 404s forever.
    await db.packages.put(row);
  } catch (cause) {
    return fail('WRITE_FAILED', PACKAGE_ROOT, options.t('import.detail.parenthetical', describeThrown(cause)));
  }

  return {
    ok: true,
    courseId: manifest.id,
    version: manifest.version,
    // Two things can re-root a package and both are worth saying: the repo
    // route was pointed at a subdirectory, and/or the archive held the
    // package one or more levels down. Joined, so what the reader is told is
    // the path they would have to walk themselves.
    rerootedFrom: [collected.rerootedFrom, rooted.rerootedFrom].filter((p) => p !== undefined).join('/') || undefined,
    droppedFiles: rooted.droppedFiles,
  };
}

/** Everything up to and including "we now hold the package's files". */
async function collect(
  src: ImportSource,
  announce: (stage: ImportStage) => Promise<void>,
  options: ImportOptions,
): Promise<{ files: Map<string, Uint8Array>; rerootedFrom?: string } | { error: Finding }> {
  if (src.kind === 'gitUrl') {
    const targets = parseGitHubUrl(src.url);
    const first = targets[0];
    if (first === undefined) {
      return {
        error: finding(
          'GIT_HOST_UNSUPPORTED',
          src.url,
          options.t('import.detail.otherHost'),
        ),
      };
    }
    // Each reading of the URL is tried in turn, and only a 404 moves on:
    // that is the one answer meaning "this ref does not exist", which is
    // precisely the question the next candidate asks differently. Anything
    // else — rate limit, symlink, too many files — is a real answer about a
    // real ref and re-asking would only produce a second, worse message.
    let last = await fetchGitHubRepo(first, announce, options);
    for (const next of targets.slice(1)) {
      if (!('error' in last) || last.error.code !== 'GIT_REPO_UNREACHABLE') break;
      last = await fetchGitHubRepo(next, announce, options);
    }
    return last;
  }

  await announce('fetching');
  let zip: Uint8Array;
  if (src.kind === 'file') {
    // A picked `File` is a HANDLE, not bytes: the read happens here, and by
    // here the USB stick can be gone, the file can have been replaced, or the
    // sandbox can have lost permission to it. Chromium rejects with a
    // `NotReadableError`, which used to leave the page blank.
    try {
      zip = new Uint8Array(await src.file.arrayBuffer());
    } catch (cause) {
      return {
        error: finding(
          'FILE_READ_FAILED',
          src.file.name,
          options.t('import.detail.fileGone', describeThrown(cause)),
        ),
      };
    }
  } else {
    if (httpUrl(src.url) === null) {
      return { error: finding('BAD_URL', src.url, options.t('import.detail.schemeOnly')) };
    }
    const fetched = await fetchBytes(src.url, options.t, options.signal);
    if ('error' in fetched) return { error: fetched.error };
    zip = fetched.bytes;
  }

  await announce('unpacking');
  return readArchive(zip, options.t);
}

/**
 * Says what is about to happen, and then ENDS THE TASK so the browser can
 * draw it before the next phase takes the thread.
 *
 * ## Measured, because the obvious version does not work
 *
 * The first draft called `onStage(...)` and carried straight on into
 * `validatePackage`. Driven in real Chromium against a valid 19.71 MiB
 * package, a `MessageChannel` heartbeat — one macrotask per hop, so every
 * gap in it is one long task — recorded this:
 *
 *     ONE task, 266949 → 268416
 *     the "Đang kiểm tra nội dung gói…" DOM mutation lands INSIDE it, at 266950
 *     "Đang giải nén…" never appeared at all — overwritten before it committed
 *
 * The React commit and the scan were the SAME TASK, so the waiting state
 * never reached the screen: the reader got a frozen page still showing the
 * previous line. This is an ORDERING fact rather than a timing one, so it
 * does not depend on how loaded the machine was. And no test in the suite
 * could see it: jsdom has no compositor and no long tasks, which is exactly
 * why the brief asks for a real browser. After the fix, same probe, same
 * package:
 *
 *     "Đang giải nén…" commits at 49806.3, heartbeat hop at 49806.4,
 *                      THEN the unpack task
 *     "Đang kiểm tra…" commits at 50024.0, heartbeat hop at 50024.0,
 *                      THEN the scan task
 *
 * A heartbeat hop between the commit and the work is a task boundary, and a
 * task boundary is where the browser gets to draw.
 *
 * Two things had to change:
 *
 * 1. **A macrotask boundary after every stage, not just before the scan.**
 *    A promise microtask is not enough — a resolved promise's continuation
 *    runs inside the same task, before any rendering opportunity — so this
 *    is `setTimeout(…, 0)`. The unpack phase gets one too: it was measured
 *    at 146–207 ms on the same package, which is its own visible stall, and
 *    without a boundary "Đang giải nén…" was overwritten by the next stage
 *    before it was ever committed.
 * 2. **The caller has to commit synchronously.** Ending the task lets the
 *    browser paint whatever the DOM says; it does not make React's own
 *    scheduler have run by then. `pages/ImportCourse.tsx` therefore wraps
 *    its `setStage` in `flushSync`, and says so at the call site.
 *
 * The residual freeze is the scan itself and is not removed by any of this —
 * see this module's header on what that costs and what would remove it.
 */
function stageAnnouncer(onStage: ((stage: ImportStage) => void) | undefined): (stage: ImportStage) => Promise<void> {
  return async (stage) => {
    onStage?.(stage);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
}
