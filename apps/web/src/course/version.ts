/**
 * "The course has a new version" — turned from something that happens TO a
 * reader into something a reader decides.
 *
 * ## What this is
 *
 * A course package is versioned and a reader pins ONE version (`db.packages`'s
 * `pinnedAt`; see `./loader`'s `pinnedPackage`). When the registry publishes a
 * newer one, taking it means the prose changes underneath every note the
 * reader has written against this course — and P2 spent six tasks building the
 * machinery that survives exactly that: `anchorToRange`'s three tiers (verbatim
 * / fuzzy / nothing), and the orphan panel for what falls off the end.
 *
 * This module points that same machinery at a version the reader has NOT taken
 * yet. `previewUpdate` resolves every note against the NEW content and reports
 * what would happen; `applyUpdate` is the separate, later act of taking it.
 * The result is a sentence the reader can decide on:
 *
 *     v1.0.0 → v1.1.0 · 37/40 ghi chú giữ đúng chỗ · 2 dịch nhẹ ·
 *     1 mất neo (chương 3.4)      [ Cập nhật ]  [ Ở lại v1.0.0 ]
 *
 * ## The three rules this file exists to keep
 *
 * **1. `previewUpdate` writes nothing.** Not Dexie, not the outbox, not the
 * pin. A forecast that commits part of what it is forecasting is not a
 * forecast. This is load-bearing rather than tidy: the whole point is that the
 * reader sees the cost BEFORE paying it, and a preview that quietly cached the
 * new package (the obvious optimisation — see `readVersion`) would already have
 * changed which bytes `loadChapter` serves if anything downstream ever pinned
 * by presence rather than by `pinnedAt`. `version.test.ts` holds this down two
 * ways: a before/after snapshot of every table, and a spy on every mutating
 * method of every table — because a snapshot alone cannot tell "never wrote"
 * apart from "wrote and put it back".
 *
 * **2. Nothing here deletes a note.** Not on preview, not on apply, not for a
 * note that lands nowhere in the new content. `applyUpdate` touches
 * `db.packages` and NOTHING else — it was never handed the ability to do
 * otherwise, the same structural argument `OrphanPanel` makes for itself. A
 * note the new build cannot place shows up in the orphan panel (P2 Task 7),
 * where the reader re-attaches it by hand, with every word still there.
 *
 * **3. A `NormMap` is a snapshot of ONE piece of DOM (ruling P2-F8).** The
 * error this file could make is specific and it has bitten this codebase twice
 * already: resolve the new version's anchors against a map built on the old
 * version's DOM. Every count would be wrong, and wrong in the reassuring
 * direction. The defence here is structural rather than disciplinary —
 * `resolveChapter` builds its own container and its own map per call and lets
 * both go when it returns, so there is no variable anywhere in this module
 * that could hold yesterday's map — with `isMapStale` checked proactively
 * inside the loop as the ruling prescribes.
 */

import { type Anchor, anchorToRange } from '../annotations/anchor';
import { isMapStale, type NormMap, normalizeContainer } from '../annotations/normalize';
import { exactOf } from '../annotations/useAnnotations';
import { fetchPackage, MANIFEST_FILE, UnsafePackageError } from '../api/courses';
import { type AnnotationRow, db } from '../db/local';
import { ensureCourseKitRuntime } from '../reader/useCourseKit';
import { PackageAssetError } from './loader';

/**
 * One note the new content could not place.
 *
 * `exact` is the quote itself, read through `exactOf` — the same defensive read
 * `MarginCards` and `OrphanPanel` use, so the string named here is the string
 * the reader will later be hunting for in the orphan panel. Two surfaces
 * disagreeing about what `exact` even is would send them looking for text that
 * was never stored.
 *
 * `alreadyOrphaned` is the field that keeps this report from lying. A note can
 * be unplaceable on the version the reader is ALREADY on — the commonest cause
 * is the ordinary one, a note synced from a device that held different content
 * — and reporting it as damage this update would do turns "1 mất neo" into a
 * reason to decline an update that costs nothing. It is measured, not guessed:
 * every note the new version orphans is re-resolved against `fromVersion`, and
 * `true` means it does not resolve there either.
 */
export interface OrphanedNote {
  readonly id: string;
  readonly chapterId: string;
  readonly exact: string;
  /** `true` when this note is unplaceable on `fromVersion` too — so staying put does not save it. */
  readonly alreadyOrphaned: boolean;
}

/**
 * What taking `toVersion` would do to this reader's notes.
 *
 * `exact + fuzzy + orphaned.length === total`, always: every note is in exactly
 * one group, and the groups are `anchorToRange`'s own three answers (verbatim
 * hit / fuzzy hit / `null`) rather than a second opinion about them.
 *
 * `total` counts live notes for this course only — tombstoned rows
 * (`deletedAt !== null`) are already gone as far as the reader is concerned, and
 * counting them would inflate every number in the sentence the dialog shows.
 */
export interface UpdateImpact {
  readonly total: number;
  readonly exact: number;
  readonly fuzzy: number;
  readonly orphaned: readonly OrphanedNote[];
}

/**
 * Thrown when a version's bytes cannot be got at all — not held on this device
 * and not obtainable from the reader's library on the server.
 *
 * Distinct from the `ApiError` underneath it (kept as `cause`) because the two
 * say different things to the reader: an `ApiError` is "the server answered
 * 404/500", while this is "the comparison you asked for cannot be made". The
 * update dialog shows the second and logs the first.
 */
export class PackageVersionUnavailableError extends Error {
  readonly courseId: string;
  readonly version: string;

  constructor(courseId: string, version: string, cause?: unknown) {
    super(`Course package ${courseId}@${version} is neither on this device nor in the library on the server`);
    this.name = 'PackageVersionUnavailableError';
    this.courseId = courseId;
    this.version = version;
    this.cause = cause;
  }
}

/** One version's bytes, whatever they came from. */
interface VersionFiles {
  readonly files: Record<string, Uint8Array>;
  /** `chapterId` → package-relative path, straight off this version's own manifest. */
  readonly chapterFiles: ReadonlyMap<string, string>;
  /** The parsed manifest, for `applyUpdate` to store in `PackageRow.manifest`. */
  readonly manifest: unknown;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * `chapterId` → file, read defensively off a manifest that is `unknown`.
 *
 * Deliberately NOT `api/courses.ts`'s `chapterFiles`, which answers a related
 * but different question ("every file to download", a de-duplicated LIST) and
 * throws for a manifest it cannot read. This one is a LOOKUP, and a chapter
 * missing from it is a real, expected state rather than a failure: a rebuild
 * that drops a chapter is precisely the update this module has to report on,
 * and turning it into a thrown error would replace a reader-visible "1 mất
 * neo" with a screen that says nothing at all.
 */
function chapterFileMap(manifest: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const parts = (manifest as { parts?: unknown } | null | undefined)?.parts;
  if (!Array.isArray(parts)) return out;
  for (const part of parts) {
    const chapters = (part as { chapters?: unknown } | null | undefined)?.chapters;
    if (!Array.isArray(chapters)) continue;
    for (const chapter of chapters) {
      const entry = chapter as { id?: unknown; file?: unknown } | null | undefined;
      if (typeof entry?.id === 'string' && typeof entry.file === 'string' && entry.file !== '') {
        out.set(entry.id, entry.file);
      }
    }
  }
  return out;
}

/**
 * One version's files — from this device if it holds them, otherwise from the
 * reader's library on the server.
 *
 * **`fetchPackage`, not `loadManifest`/`pullPackageFromServer`.** The loader's
 * server path WRITES what it downloads into `db.packages`, which is right for
 * the loader (a course you are about to read should be on your device) and
 * forbidden here (rule 1). `fetchPackage` is the read half on its own: it
 * returns `Record<string, Uint8Array>` and stores nothing.
 *
 * The consequence, stated rather than discovered later: previewing and then
 * accepting downloads the package TWICE. That is the price of rule 1, and it
 * buys something beyond the rule — `applyUpdate` stores the bytes it fetched at
 * apply time, not bytes that have been sitting in a module-level cache since
 * the reader opened the dialog and went to lunch.
 *
 * The manifest is parsed from `files[MANIFEST_FILE]` in BOTH paths, never from
 * a cached row's `manifest` column, so a held package and a downloaded one
 * cannot be read differently. `PackageRow`'s own doc explains why the bytes are
 * the authority: the column is the parsed form, and the server's `jsonb`
 * storage does not round-trip bytes.
 */
async function readVersion(courseId: string, version: string): Promise<VersionFiles> {
  const held = await db.packages.get(`${courseId}@${version}`);
  let files: Record<string, Uint8Array>;
  if (held) {
    files = held.files;
  } else {
    try {
      files = await fetchPackage(courseId, version);
    } catch (cause) {
      // `UnsafePackageError` is re-thrown as itself. It is not "the bytes
      // could not be got" — they were got, in full, and then refused — and
      // flattening the two into one message would tell a reader their network
      // is flaky when what actually happened is that the version on offer
      // declares `content` and ships event handlers.
      if (cause instanceof UnsafePackageError) throw cause;
      throw new PackageVersionUnavailableError(courseId, version, cause);
    }
  }

  const manifestBytes = files[MANIFEST_FILE];
  if (manifestBytes === undefined) throw new PackageAssetError(courseId, version, MANIFEST_FILE);

  let manifest: unknown;
  try {
    manifest = JSON.parse(decodeUtf8(manifestBytes));
  } catch {
    // The parse error is deliberately not carried: `PackageAssetError` already
    // says the one thing a reader can act on — this copy of the package is not
    // usable, import it again — and a JSON syntax offset is not.
    throw new PackageAssetError(courseId, version, MANIFEST_FILE);
  }

  return { files, chapterFiles: chapterFileMap(manifest), manifest };
}

/**
 * Thrown when the chapter renderer (`window.CourseKit`) cannot be got at.
 *
 * A refusal rather than a degraded answer, and the numbers are why. An anchor's
 * stored quote describes the chapter as the READER saw it, which is after
 * `ChapterView`'s pipeline has run `CourseKit.renderKatex` over it: every
 * formula is one `'￼'` in the projection `anchor.ts` searches, not the `$…$`
 * source that is sitting in the package. Measured on one real, formula-dense
 * chapter of a real packed course carrying 30 notes, 29 of which quote a
 * formula — 20 paragraphs untouched, 6 copy-edited, 4 deleted
 * (`version.test.ts`'s last block; the second row is that suite run with
 * this one call removed):
 *
 *     with renderKatex     20 exact ·  6 fuzzy ·  4 orphan   (the truth)
 *     without               1 exact ·  3 fuzzy · 26 orphan
 *
 * Seventeen of those 26 orphans are paragraphs the update does not touch at
 * all. A dialog built on the second row would tell a reader that taking a
 * harmless update costs them nine tenths of their notes — the exact opposite of
 * what this feature is for — so there is no version of "carry on without it"
 * worth shipping.
 */
export class CourseKitUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      'The course-kit runtime (window.CourseKit) is not available, so a chapter cannot be ' +
        'rendered the way the reader saw it when their notes were anchored. Refusing to report ' +
        'an update impact measured against unrendered source.',
    );
    this.name = 'CourseKitUnavailableError';
    this.cause = cause;
  }
}

/**
 * `window.CourseKit`, loading the shared runtime trio first if this page has
 * not needed it yet (the library screen has not).
 *
 * Awaited ONCE per `previewUpdate` rather than per chapter: it is a cached
 * singleton after the first call (`ensureCourseKitRuntime`), and asking once at
 * the top keeps the per-chapter loop synchronous.
 */
async function chapterRenderer(): Promise<(root: ParentNode) => void> {
  if (!window.CourseKit) {
    try {
      await ensureCourseKitRuntime();
    } catch (cause) {
      throw new CourseKitUnavailableError(cause);
    }
  }
  const kit = window.CourseKit;
  if (!kit) throw new CourseKitUnavailableError();
  // Wrapped rather than handed over bare: `runtime.js`'s `renderKatex` happens
  // not to use `this` today, and a detached method that starts to would fail
  // here and nowhere else in the app.
  return (root: ParentNode) => kit.renderKatex(root);
}

/** Which of `anchorToRange`'s three answers a note got. */
type Tier = 'exact' | 'fuzzy' | 'orphan';

/**
 * Parses a chapter fragment from a version the reader has NOT accepted, into a
 * document that cannot run any of it.
 *
 * ## Ruling S1-F30 — what this replaced, and why "detached" was not a defence
 *
 * This used to be `document.createElement('div')` + `innerHTML`, and both this
 * file and the S1-F8 allowlist entry in `db/local.test.ts` stated in words that
 * a detached container meant "no handler on it can ever fire". **That sentence
 * was false, and it was measured false in Chromium**: an `<img>`/`<video>`/SVG
 * `<image>` starts loading because its `src`/`href` attribute was set, not
 * because it is in a rendered tree, and `error` fires on that load with the
 * package's own `on*` attribute attached. A hostile chapter got three handlers
 * run and three requests sent to a host of its choosing — on this app's origin,
 * from a version the reader was only *looking at the price of*, because
 * `UpdateDialog` previews on mount.
 *
 * ## Why `createHTMLDocument` and not `<template>`
 *
 * A `<template>`'s contents genuinely are inert — their owner document has no
 * browsing context — but only while they STAY there. The drop-in shape,
 * `holder.innerHTML = html` then `div.appendChild(holder.content)`, moves every
 * node straight back into this document, and the `img` element's adopting steps
 * re-run "update the image data" on arrival. Measured, same harness, same
 * hostile fragment:
 *
 *     detached div (the old code)      3 handlers · 7 requests left the browser
 *     template + appendChild           3 handlers · 7 requests left the browser
 *     createHTMLDocument (this)        0 handlers · 0 requests
 *
 * The middle row is the trap: it reads as the safe idiom and is not one here.
 * A `<template>` would only work if the nodes were never adopted, and
 * `normalizeContainer` wants an `Element`, not the `DocumentFragment` that
 * would leave us holding.
 *
 * So the container is an inert document's `body`. `defaultView === null` is the
 * property that makes it safe, it is a property of the DOCUMENT rather than of
 * where the node happens to be parked, and it is asserted in `version.test.ts`
 * rather than left as folklore — which is precisely what the old comment was.
 *
 * The cost, stated because it is the one thing this shape asks of its callers:
 * `root` belongs to a DIFFERENT document, so everything downstream crosses a
 * document boundary — `document.createTreeWalker` in `normalizeContainer` and
 * `document.createRange` in `flatToDom`. Both are defined for foreign nodes and
 * both are measured here (same projection, same counts, on the real chapter),
 * but a future reader must not "tidy" this back into the current document.
 */
export function parseChapterInert(html: string): HTMLElement {
  const inert = document.implementation.createHTMLDocument('');
  inert.body.innerHTML = html;
  return inert.body;
}

/**
 * Resolves `notes` against ONE chapter of ONE version, and lets the DOM go.
 *
 * **The container is built the way `ChapterView` builds one**, with one
 * deliberate difference: `innerHTML` — into an INERT document, see
 * `parseChapterInert` — then `CourseKit.renderKatex`. That second step is not a
 * nicety; see `CourseKitUnavailableError` for the measurement that made it
 * mandatory. `initViz` is deliberately NOT run: every node it touches carries
 * `data-viz`, which `normalize.ts`'s `EXCLUDED_SELECTOR` skips whole, so it
 * cannot change a single character of the projection, and running a package's
 * simulations to count its notes would execute course-supplied code for no
 * reason at all.
 *
 * This function is also where ruling P2-F8 is enforced structurally. The
 * container and the map are created here, used here, and unreachable
 * afterwards, so no caller can pass in — or hold on to — a map built on
 * different content. The `isMapStale` check inside the loop is the proactive
 * form the ruling asks for: nothing here paints, so it should never fire, and
 * "should never" is exactly the class of assumption that took a page down twice
 * in P2.
 *
 * The container is never inserted into the reader's page either, which is a
 * second, weaker property worth keeping for its own reason: a preview must not
 * flash a version of the course the reader has not taken through the page they
 * are looking at. It is NOT what makes the markup safe — ruling S1-F30 is the
 * measurement that settled that.
 */
function resolveChapter(
  html: string,
  notes: readonly AnnotationRow[],
  renderKatex: (root: ParentNode) => void,
): Map<string, Tier> {
  const out = new Map<string, Tier>();
  const root = parseChapterInert(html);
  renderKatex(root);

  let map: NormMap | null = null;
  for (const row of notes) {
    if (map && isMapStale(map)) map = null;
    if (!map) map = normalizeContainer(root);
    const hit = anchorToRange(map, row.anchor as Anchor);
    out.set(row.id, hit ? (hit.fuzzy ? 'fuzzy' : 'exact') : 'orphan');
  }
  return out;
}

/** `notes` grouped by the chapter they were written in, preserving order. */
function byChapter(notes: readonly AnnotationRow[]): Map<string, AnnotationRow[]> {
  const out = new Map<string, AnnotationRow[]>();
  for (const row of notes) {
    const bucket = out.get(row.chapterId);
    if (bucket) bucket.push(row);
    else out.set(row.chapterId, [row]);
  }
  return out;
}

/**
 * Every note's tier against one version of the course.
 *
 * Only chapters that actually HAVE notes are read and parsed — a 44-chapter
 * course with four annotated chapters costs four `innerHTML` parses, not 44.
 * A note whose chapter is not in this version's manifest at all (a rebuild
 * dropped it) is an orphan without any DOM being built for it, which is both
 * the right answer and the cheap one.
 */
async function resolveAgainst(
  courseId: string,
  version: string,
  notes: readonly AnnotationRow[],
  renderKatex: (root: ParentNode) => void,
): Promise<Map<string, Tier>> {
  const content = await readVersion(courseId, version);
  const tiers = new Map<string, Tier>();

  for (const [chapterId, rows] of byChapter(notes)) {
    const file = content.chapterFiles.get(chapterId);
    const bytes = file === undefined ? undefined : content.files[file];
    if (bytes === undefined) {
      // The chapter is gone from the manifest, or the package is missing the
      // file its own manifest names. Either way this version has nowhere to
      // put these notes — which is an orphan, not an exception: the reader is
      // asking what an update would cost, and "it would cost you these three"
      // is the answer, not a stack trace.
      for (const row of rows) tiers.set(row.id, 'orphan');
      continue;
    }
    for (const [id, tier] of resolveChapter(decodeUtf8(bytes), rows, renderKatex)) {
      tiers.set(id, tier);
    }
  }
  return tiers;
}

/** This reader's live notes for one course, tombstones and other courses excluded. */
async function liveNotes(courseId: string): Promise<AnnotationRow[]> {
  // No `courseId` index on `db.annotations` (`db/local.ts`'s schema indexes
  // `id, updatedAt, deletedAt`), so this is a scan. It is a scan of ONE
  // reader's own annotations on ONE device, run once when a dialog opens.
  const rows = await db.annotations.toArray();
  return rows.filter((row) => row.courseId === courseId && row.deletedAt === null);
}

/**
 * DRY RUN. Resolves every note against `toVersion` and reports the damage.
 * **Writes nothing** — see rule 1 in this file's header.
 *
 * `fromVersion` is not decoration and it is not just a label for the dialog: it
 * is the baseline that makes `orphaned` honest. Only the notes `toVersion`
 * could not place are re-resolved against it, so a healthy update never reads
 * the old version at all, and the reader is never told that an update would
 * cost them a note that was already unreachable.
 *
 * Throws `PackageVersionUnavailableError` when a version's bytes cannot be got
 * — including `fromVersion`, in the case where there is something to check. The
 * reader is by construction holding `fromVersion` (it is the version they are
 * reading), so that is a broken-install signal rather than an ordinary path,
 * and answering with a confident-looking count computed without a baseline
 * would be worse than saying so.
 */
export async function previewUpdate(
  courseId: string,
  fromVersion: string,
  toVersion: string,
): Promise<UpdateImpact> {
  const notes = await liveNotes(courseId);
  if (notes.length === 0) {
    return { total: 0, exact: 0, fuzzy: 0, orphaned: [] };
  }

  const renderKatex = await chapterRenderer();
  const after = await resolveAgainst(courseId, toVersion, notes, renderKatex);
  const lost = notes.filter((row) => after.get(row.id) === 'orphan');
  const before =
    lost.length > 0 ? await resolveAgainst(courseId, fromVersion, lost, renderKatex) : new Map<string, Tier>();

  let exact = 0;
  let fuzzy = 0;
  const orphaned: OrphanedNote[] = [];
  for (const row of notes) {
    switch (after.get(row.id)) {
      case 'exact':
        exact++;
        break;
      case 'fuzzy':
        fuzzy++;
        break;
      default:
        orphaned.push({
          id: row.id,
          chapterId: row.chapterId,
          exact: exactOf(row.anchor),
          alreadyOrphaned: before.get(row.id) === 'orphan',
        });
    }
  }

  return { total: notes.length, exact, fuzzy, orphaned };
}

/**
 * Takes `toVersion`: makes it the version this device opens.
 *
 * Touches `db.packages` and nothing else. In particular it does not read, write
 * or tombstone a single annotation — a note the new content cannot place is
 * still a note, and the orphan panel is where it surfaces (rule 2).
 *
 * **The old version is kept.** Pinning is not deleting: a reader who took an
 * update is one `pinnedAt` away from the copy they had, and throwing that away
 * to reclaim space is a storage-quota decision that belongs to whoever builds
 * eviction, with the reader in the loop. `./loader`'s `pinnedPackage` picks the
 * most recent pin, so holding both is an ordinary state.
 *
 * **Nothing is queued to the outbox.** Which version this DEVICE opens is a
 * device-local choice — `db.outbox` carries `progress`, `annotations` and
 * `events`, and there is no packages shape for it to carry — and the server's
 * own `pinned` (Task 6's `GET /courses`) is a statement about the library, not
 * about this browser. A phone that has not taken the update yet must keep
 * reading what it has.
 *
 * Re-downloads the package if the device does not already hold it, which is the
 * ordinary case after a preview (see `readVersion` on why the preview cannot
 * leave it lying around).
 */
export async function applyUpdate(courseId: string, toVersion: string): Promise<void> {
  const key = `${courseId}@${toVersion}`;
  const pinnedAt = new Date().toISOString();

  const held = await db.packages.get(key);
  if (held) {
    await db.packages.put({ ...held, pinnedAt });
    return;
  }

  const content = await readVersion(courseId, toVersion);
  await db.packages.put({
    key,
    courseId,
    version: toVersion,
    manifest: content.manifest,
    files: content.files,
    pinnedAt,
  });
}
