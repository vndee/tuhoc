/**
 * The annotation store (P2 Task 4) — where the three previous modules meet
 * each other and the sync pipeline P1 built.
 *
 * `./normalize` turns a rendered chapter into a flat string, `./anchor` turns
 * a quote into a `Range` in that chapter, `./painter` colours the `Range` in,
 * and `../db/local` + `../sync/engine` already know how to carry an
 * `AnnotationRow` to the server and back (`sync/engine.ts` routes
 * `table === 'annotations'` to `POST /sync`, and the Go `annotationItem` in
 * `apps/api/internal/sync/handler.go` matches `AnnotationRow` field for
 * field — ruling P2-F2: no migration, no server change). This file is the
 * only place any of that is wired together, and it is the first code in P2
 * that writes data a reader can lose.
 *
 * ---------------------------------------------------------------------
 * 1. Why there is no `for (a of anns) { paint(resolve(a)) }` here
 * ---------------------------------------------------------------------
 * That loop is the obvious one and it is wrong (ruling P2-F8). Wrapping a
 * highlight calls `mark.appendChild(node)`, and the DOM standard's "remove"
 * steps reset every live `Range` with a boundary inside the removed node — so
 * painting one annotation silently moves the `Range` of any LATER annotation
 * covering the same words, and invalidates the `NormMap` for all of them.
 *
 * The sharp consequence is that the broken loop is GREEN on every fixture
 * where no two notes overlap. It fails the first time a reader highlights over
 * an existing highlight, in a browser, with their own notes.
 *
 * So resolution happens in batches: every `Range` in a batch is produced
 * against one fresh `NormMap`, and every one of them is handed to a single
 * `paintAll` call, which reads them all before it mutates anything. After a
 * batch that created something, the map is rebuilt. `paintAll` returning `0`
 * is a guarantee that nothing moved (see its own doc — `undoCuts` is what
 * makes that true rather than merely likely), which is why the rebuild is
 * conditional rather than unconditional.
 *
 * ---------------------------------------------------------------------
 * 2. Two passes: exact inline, fuzzy deferred (ruling P2-F9)
 * ---------------------------------------------------------------------
 * `anchorToRange`'s verbatim tiers cost about 3 ms for a whole chapter's
 * annotations. Its fuzzy tier costs up to ~334 ms for 200 anchors, and that
 * worst case is not exotic — it is exactly what happens the first time a
 * reader opens a chapter after the course content was rebuilt. Add the ~305 ms
 * `paintAll` + map rebuild measured in Task 3 and a chapter open would visibly
 * stall.
 *
 * So the first pass runs with `{ fuzzy: false }` and every anchor it cannot
 * place verbatim is queued for a pass scheduled AFTER the first paint. The
 * deferred pass is chunked by a wall-clock budget (`DEFERRED_BUDGET_MS`) so no
 * single task blocks the main thread, and it keeps rescheduling until the
 * queue is empty. It is deliberately NOT capped by count: refusing to resolve
 * some of a reader's notes because there were too many of them is silently
 * abandoning their work, which is the one outcome this phase exists to
 * prevent.
 *
 * A note awaiting the deferred pass appears in NEITHER `list` nor `orphans`.
 * Reporting it as an orphan first and moving it a moment later would flash
 * "this note lost its place" at a reader whose note is fine.
 *
 * ---------------------------------------------------------------------
 * 3. Orphans are data
 * ---------------------------------------------------------------------
 * `anchorToRange` returning `null` means "not found in THIS render", not "this
 * note is worthless". Nothing here deletes an orphan, tombstones it, or writes
 * anything at all about it: resolving is a read. It goes into `orphans` for
 * Task 7's panel to offer back to the reader, and a note orphaned today can
 * re-attach on its own tomorrow when the content changes again.
 *
 * The one thing that must NOT be swallowed into an orphan is
 * `StaleNormMapError`. That is a caller bug in this file, not a statement
 * about the reader's note, and catching it would turn an integration mistake
 * into "your note lost its anchor" with nothing anywhere saying why. It is
 * therefore not caught.
 *
 * ---------------------------------------------------------------------
 * 4. Incremental, so re-renders do not re-paint
 * ---------------------------------------------------------------------
 * Every write goes through Dexie, and a `liveQuery` brings it back — including
 * writes made by `sync/engine.ts`'s `pull()` from another device. If each
 * emission re-resolved and re-painted the whole chapter, every new note would
 * add a second `<mark>` layer over every existing one (painting an id twice
 * nests rather than replaces) and `unpaint`-everything-first would cost
 * O(notes × nodes) each time.
 *
 * So the pass reconciles instead: it tracks which ids it has attempted and
 * against which anchor, paints only what is new, and unpaints only ids that
 * disappeared or whose anchor actually changed (`updateNote` therefore does
 * not disturb a single element on the page). That reconciliation is also what
 * makes the effect idempotent under React StrictMode's double-invoke: the
 * second run sees the same rows against the same content revision and has
 * nothing left to do.
 */
import { liveQuery } from 'dexie';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type AnnotationRow, db } from '../db/local';
import { type Anchor, type AnchorColor, anchorToRange } from './anchor';
import { isMapStale, type NormMap, normalizeContainer, rangeToFlat } from './normalize';
import { type PaintItem, paintAll, unpaint } from './painter';

/** One stored annotation, exactly as it lives in Dexie and on the wire.
 * Aliased rather than redeclared so this module and the sync engine can never
 * disagree about the row shape the server accepts. */
export type Ann = AnnotationRow;

/**
 * The chapter DOM this hook resolves and paints into.
 *
 * `root` is the element the chapter's HTML fragment was set into —
 * `ChapterView`'s `containerRef` div, the one React never gives children to
 * so nothing here fights a reconciliation. `revision` must change every time
 * that element's content is REPLACED (a new chapter, a re-render of the same
 * one): it is how this hook learns that every `<mark>` it painted is gone and
 * every anchor has to be resolved again.
 *
 * A revision counter rather than watching the element itself, because the
 * element identity does not change between chapters — `ChapterView` reuses one
 * `<div>` and swaps its `innerHTML` — so element identity cannot distinguish
 * "same chapter, re-run effect" from "different chapter entirely". Getting
 * that wrong in the optimistic direction paints a chapter's notes over another
 * chapter's text.
 */
export interface ChapterContent {
  readonly root: HTMLElement | null;
  readonly revision: number;
}

export interface UseAnnotationsResult {
  /**
   * Live (not tombstoned) annotations that currently HAVE a place in the
   * rendered chapter, in the order they appear in it. Sorted by flat offset,
   * ties broken by `createdAt` then `id` so the order is stable across
   * renders.
   */
  readonly list: readonly Ann[];
  /**
   * Live annotations whose anchor could not be found in this render, after
   * both the exact and the fuzzy tier have had their turn. Not deleted, not
   * tombstoned — Task 7's panel hands them back to the reader.
   */
  readonly orphans: readonly Ann[];
  /** Stores a new annotation and queues it for sync. Resolves to its id. */
  create(anchor: Anchor, note: string): Promise<string>;
  /** Rewrites the note text. No-op for an unknown id. */
  updateNote(id: string, note: string): Promise<void>;
  /** Tombstones (`deletedAt`), never hard-deletes — the tombstone is what
   * propagates the deletion to the reader's other devices. */
  remove(id: string): Promise<void>;
  /** Points an existing note at a new quote — Task 7's "put it back here". */
  reattach(id: string, anchor: Anchor): Promise<void>;
}

/**
 * Wall-clock budget for one chunk of the deferred fuzzy pass.
 *
 * Sized against the measurement the fuzzy tier's own doc records: ~1,67 ms per
 * anchor for a 900-character quote one edit away. 12 ms is therefore about
 * seven of the worst-case anchors per chunk — long enough that the per-chunk
 * `paintAll` + map rebuild is not the dominant cost, short enough that a chunk
 * plus its rebuild stays inside a frame's worth of work on the main thread.
 *
 * It bounds the size of one task, never the amount of work done: the pass
 * reschedules until every queued anchor has been tried.
 */
const DEFERRED_BUDGET_MS = 12;

/**
 * Hard ceiling on how many anchors one deferred chunk may resolve, whatever
 * the clock says.
 *
 * This is NOT a cap on how many anchors get the fuzzy tier — ruling P2-F9
 * forbids that, and the pass reschedules until the queue is empty regardless
 * of this number. It is the opposite: a guarantee that a chunk ENDS, so a page
 * with many cheap-to-resolve anchors publishes them in visible instalments
 * instead of one long task that happens to fit under the time budget, and so
 * "keeps rescheduling until done" is a property with a deterministic test
 * rather than one that depends on how fast the machine running it is.
 *
 * 8 matches what `DEFERRED_BUDGET_MS` buys at the worst measured per-anchor
 * cost (~1,67 ms), so on the path that actually needs a budget the two
 * ceilings bind at roughly the same place. It is also where the measurement
 * puts the knee. Real chapter p1-5 with KaTeX, 200 non-overlapping notes ALL
 * needing the fuzzy tier, jsdom, three runs:
 *
 *     chunk   total          median task   longest task
 *       1     3.4–3.9 s      17 ms         29–85 ms
 *       4     1.0 s          20 ms         34–39 ms
 *       8     0.6–0.9 s      22–25 ms      45–198 ms
 *      16     0.4–0.5 s      31–43 ms      45–64 ms
 *     200     0.19–0.21 s    (one task of 190–210 ms)
 *
 * The shape of that table is the thing to understand before changing this
 * number: a chunk costs ~17 ms before it resolves a single anchor, because it
 * ends by rebuilding the `NormMap` (~12 ms on this chapter). That fixed cost
 * is why chunk=1 is 6× the total work, and why going below 4 is never right.
 * Above 8 the total keeps improving only by making individual tasks longer —
 * which is precisely what this is here to avoid. jsdom overstates DOM mutation
 * cost several-fold against a real browser (Task 3 measured 24–70 ms in jsdom
 * for an `unpaint` that is single-digit ms in Chrome), so treat the absolute
 * numbers as an upper bound and the SHAPE as the finding.
 */
const DEFERRED_CHUNK_MAX = 8;

/** Upper bound on how long the scheduler may sit idle before running a
 * deferred chunk anyway. Without it, `requestIdleCallback` on a busy page can
 * postpone a reader's notes indefinitely. */
const DEFERRED_TIMEOUT_MS = 200;

const COLORS: ReadonlySet<string> = new Set<AnchorColor>(['y', 'g', 'b', 'p']);

/** Stable empty results, so a chapter with no annotations hands back the same
 * array identity on every render and cannot drive a caller's `useEffect` into
 * a loop. */
const NO_ROWS: readonly Ann[] = Object.freeze([]);

/** Where a resolved annotation sits in the chapter, or `null` for an orphan.
 * `undefined` (absent from the map) is the third state: not attempted yet. */
type Placement = { readonly from: number; readonly fuzzy: boolean } | null;

/**
 * How far along the tier ladder one annotation is.
 *
 * `'new'` and `'fuzzy-pending'` are BOTH "no answer yet" and both must stay
 * out of `orphans` — the difference is only which pass owes the answer. An
 * earlier draft collapsed them into "placement is null", which made a note
 * that had merely not been looked at yet indistinguishable from one that had
 * been looked for and not found.
 */
type Stage = 'new' | 'fuzzy-pending' | 'settled';

interface Attempt {
  /** The anchor this attempt was made against; a change here means the
   * annotation has to be unpainted and resolved again. */
  readonly signature: string;
  stage: Stage;
  /** Meaningful only once `stage === 'settled'`. */
  placement: Placement;
  painted: boolean;
}

interface PassState {
  readonly key: string;
  readonly root: HTMLElement;
  readonly revision: number;
  /** Rebuilt after every batch that changed the DOM; `null` means "build it
   * on next use", which is what keeps a chapter with no annotations from
   * walking the DOM at all. */
  map: NormMap | null;
  readonly attempts: Map<string, Attempt>;
  cancel: (() => void) | null;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

/**
 * `AnnotationRow.anchor` is `unknown` all the way from the server's
 * `json.RawMessage`, so every read of it is defensive. An unusable colour
 * falls back to yellow rather than reaching `paintAll` as a class name nobody
 * styled — a highlight in the wrong colour is a cosmetic problem, an unstyled
 * one is invisible.
 *
 * Exported for `./MarginCards`, which needs the SAME answer to colour a card's
 * left border: a card that disagreed with its own highlight about the note's
 * colour would be worse than either choice on its own, and a second private
 * copy of a defensive read is exactly the drift this codebase has already paid
 * to avoid elsewhere.
 */
export function colorOf(anchor: unknown): AnchorColor {
  const value = (anchor as { color?: unknown } | null | undefined)?.color;
  return typeof value === 'string' && COLORS.has(value) ? (value as AnchorColor) : 'y';
}

/**
 * Everything about an anchor that changes where and how it is painted.
 *
 * Deliberately NOT `JSON.stringify(anchor)`: an anchor written here and the
 * same anchor echoed back by the server are equal values whose key order need
 * not match, and a signature that changed on a round trip would unpaint and
 * repaint every note after every pull. Deliberately not `updatedAt` either —
 * that changes when only the NOTE TEXT was edited, which must not disturb the
 * page.
 */
function signatureOf(anchor: unknown): string {
  const raw = anchor as { exact?: unknown; prefix?: unknown; suffix?: unknown } | null | undefined;
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  return `${str(raw?.exact)} ${str(raw?.prefix)} ${str(raw?.suffix)} ${colorOf(anchor)}`;
}

function samePlacements(a: ReadonlyMap<string, Placement>, b: ReadonlyMap<string, Placement>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, left] of a) {
    if (!b.has(id)) return false;
    const right = b.get(id) ?? null;
    if (left === null || right === null) {
      if (left !== right) return false;
      continue;
    }
    if (left.from !== right.from || left.fuzzy !== right.fuzzy) return false;
  }
  return true;
}

/** Sort key for two annotations that share a position (or have none): oldest
 * first, `id` as the final tie-break so the order never depends on Dexie's
 * iteration order. */
function byAge(a: Ann, b: Ann): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Runs the deferred pass "after the first paint", preferring the browser's own
 * idle signal and falling back to a macrotask.
 *
 * `requestIdleCallback` is the right primitive — it yields to anything the
 * reader is actually doing — but it is not universal (no Safari before 17, no
 * jsdom), and it can starve on a busy page, hence the timeout. The
 * `setTimeout` fallback is also what makes this deterministic under test.
 */
function scheduleDeferred(run: () => void): () => void {
  const scope = globalThis as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof scope.requestIdleCallback === 'function' && typeof scope.cancelIdleCallback === 'function') {
    const handle = scope.requestIdleCallback(run, { timeout: DEFERRED_TIMEOUT_MS });
    return () => scope.cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(run, 0);
  return () => clearTimeout(handle);
}

/** One local write: the row and its outbox entry land together or not at all.
 * Mirrors `setProgress` (`../db/local.ts`) exactly — there is no way for the
 * visible local state to change without an outbox entry to propagate it, and
 * no way for a queued mutation to exist whose local counterpart was never
 * written. */
async function commit(row: Ann): Promise<void> {
  await db.transaction('rw', db.annotations, db.outbox, async () => {
    await db.annotations.put(row);
    await db.outbox.add({ table: 'annotations', row });
  });
}

/** Read-modify-write of one existing row, inside the same single transaction.
 * `updatedAt` is stamped by the caller BEFORE the transaction opens, at the
 * instant of the edit — the same reasoning as `setProgress`'s: an edit made
 * offline must not appear to have happened whenever it eventually reached the
 * database, or it beats a genuinely later edit from another device. */
async function commitPatch(id: string, patch: (row: Ann) => Ann): Promise<void> {
  await db.transaction('rw', db.annotations, db.outbox, async () => {
    const existing = await db.annotations.get(id);
    if (!existing) return;
    const row = patch(existing);
    await db.annotations.put(row);
    await db.outbox.add({ table: 'annotations', row });
  });
}

/**
 * Live annotations for one chapter, resolved against the rendered DOM and
 * painted into it, plus the four mutations that write them.
 *
 * Call this ONCE per chapter — it owns the painted `<mark>`s. Task 5's
 * toolbar, Task 6's margin cards and Task 7's orphan panel should receive this
 * result as a prop rather than each calling the hook again; two live instances
 * would each paint the same annotations.
 *
 * `content` is optional so the two-argument form in the task brief keeps
 * working for a caller that only needs the mutations. Without a `root` there
 * is no chapter to resolve against, so `list` and `orphans` both stay empty —
 * that is a statement about the absent DOM, not about the stored notes.
 */
export function useAnnotations(
  courseId: string,
  chapterId: string,
  content: ChapterContent = { root: null, revision: 0 },
): UseAnnotationsResult {
  const key = `${courseId} ${chapterId}`;

  // The rows are stored WITH the key they were read for. On a chapter change
  // the new `liveQuery` has not emitted yet, and rendering the previous
  // chapter's rows for one commit would hand the resolve pass a set of
  // annotations that belong to text no longer on the page.
  const [snapshot, setSnapshot] = useState<{ key: string; rows: readonly Ann[] }>({ key, rows: NO_ROWS });
  const rows = snapshot.key === key ? snapshot.rows : NO_ROWS;

  const [placements, setPlacements] = useState<ReadonlyMap<string, Placement>>(() => new Map());
  const stateRef = useRef<PassState | null>(null);

  // `db.annotations` is indexed by `id`/`updatedAt`/`deletedAt` only — there
  // is no `courseId` index and this task adds no migration (ruling P2-F2), so
  // the filter runs in JS over a full local read, exactly as `useProgress`
  // does for `db.progress` and for the same reason: one reader's annotation
  // table is small, and a schema change to save a scan is not worth a
  // migration this phase is not scoped to make.
  useEffect(() => {
    const subscription = liveQuery(() =>
      db.annotations.toArray().then((all) => all.filter((r) => r.courseId === courseId && r.chapterId === chapterId)),
    ).subscribe({
      next: (next) => setSnapshot({ key: `${courseId} ${chapterId}`, rows: next }),
      error: (err) => console.error('useAnnotations: live query failed', err),
    });
    return () => subscription.unsubscribe();
  }, [courseId, chapterId]);

  const root = content.root;
  const revision = content.revision;

  useEffect(() => {
    if (!root) {
      stateRef.current?.cancel?.();
      stateRef.current = null;
      return;
    }

    let state = stateRef.current;
    if (!state || state.root !== root || state.revision !== revision || state.key !== key) {
      // The caller replaced what is under `root` (or handed us a different
      // chapter). Every `<mark>` this hook painted went with it, so there is
      // nothing to unpaint and everything to resolve again.
      state?.cancel?.();
      state = { key, root, revision, map: null, attempts: new Map(), cancel: null };
      stateRef.current = state;
    }
    const pass = state;

    /** Publishes what is settled so far. A fresh Map each time so React sees
     * a change; identical content hands back the previous object, so a
     * re-render caused by something else cannot start a loop. */
    const publish = (): void => {
      const next = new Map<string, Placement>();
      for (const [id, attempt] of pass.attempts) {
        if (attempt.stage === 'settled') next.set(id, attempt.placement);
      }
      setPlacements((prev) => (samePlacements(prev, next) ? prev : next));
    };

    /**
     * The map for this batch, built once and kept until something invalidates
     * it.
     *
     * The `isMapStale` check is there for a mutation this pass did not make.
     * This hook drops its own map after every batch that painted (see
     * `resolveBatch`), so the only way a kept map can be stale is that someone
     * ELSE changed the chapter — and from Task 5 on, someone else does:
     * `./SelectionToolbar` paints the reader's new highlight the instant they
     * click a colour, BEFORE the row it created has travelled through Dexie
     * back to this pass. The map kept from a batch that painted nothing (every
     * annotation an orphan — an ordinary state, with an orphan panel shipping
     * in Task 7) then describes a tree that no longer exists, and
     * `anchorToRange` is documented to THROW rather than answer wrongly. That
     * throw is not caught anywhere in this file, on purpose, so it would leave
     * the reader's page dead in a passive effect. Reproduced as a test in
     * `SelectionToolbar.test.tsx` ("chương đang có ghi chú MỒ CÔI…"), which
     * fails with `StaleNormMapError` without this line.
     *
     * `isMapStale` rather than `try`/`catch` is what ruling P2-F8 prescribes for
     * a caller holding a map across possible mutations. It costs one property
     * read per segment, once per batch: measured in Chromium on the real p1-5
     * (756 segments), 0,016 ms against 0,685 ms to rebuild the map — so asking
     * is ~40× cheaper than rebuilding blindly, and both are far below the ~12 ms
     * this file's `DEFERRED_CHUNK_MAX` doc quotes for the same rebuild in jsdom.
     */
    const mapOf = (): NormMap => {
      if (pass.map && isMapStale(pass.map)) pass.map = null;
      if (!pass.map) pass.map = normalizeContainer(pass.root);
      return pass.map;
    };

    /**
     * Resolves as much of `queue` as the budget allows against one fresh map,
     * and paints the whole result in a single `paintAll`. What it did not get
     * to stays at its current stage; the caller finds it again by asking
     * `atStage`, which is why nothing is returned here.
     *
     * Every position is read off its `Range` BEFORE anything is painted:
     * afterwards the ranges are, by the DOM's own remove steps, no longer
     * describing what they used to.
     */
    const resolveBatch = (queue: readonly Ann[], fuzzy: boolean, budgetMs: number | null, maxCount = Infinity): void => {
      const map = mapOf();
      const items: PaintItem[] = [];
      const started = nowMs();
      let taken = 0;

      for (const row of queue) {
        taken++;
        // A `StaleNormMapError` from here is a bug in THIS file, not a note
        // that lost its anchor — deliberately not caught. See the file doc.
        const hit = anchorToRange(map, row.anchor as Anchor, { fuzzy });
        const attempt = pass.attempts.get(row.id);
        if (!attempt) continue;
        if (hit) {
          // The position has to be read off the live `Range` NOW: `paintAll`
          // below moves text into `<mark>`s, and the DOM's remove steps reset
          // every live range whose boundary was in the moved node.
          const span = rangeToFlat(map, hit.range);
          attempt.stage = 'settled';
          attempt.placement = { from: span ? span.from : Number.MAX_SAFE_INTEGER, fuzzy: hit.fuzzy };
          items.push({ range: hit.range, id: row.id, color: colorOf(row.anchor) });
        } else {
          attempt.stage = fuzzy ? 'settled' : 'fuzzy-pending';
          attempt.placement = null;
        }
        if (taken >= maxCount) break;
        if (budgetMs !== null && nowMs() - started >= budgetMs) break;
      }

      if (items.length > 0) {
        const created = paintAll(items);
        for (const item of items) {
          const attempt = pass.attempts.get(item.id);
          if (attempt) attempt.painted = true;
        }
        // `0` is `paintAll`'s guarantee that the DOM was not touched, which
        // makes the current map still good — see its own doc.
        if (created > 0) pass.map = null;
      }
    };

    const atStage = (candidates: readonly Ann[], stage: Stage): Ann[] =>
      candidates.filter((row) => pass.attempts.get(row.id)?.stage === stage);

    const live = rows.filter((row) => row.deletedAt == null);
    const liveById = new Map(live.map((row) => [row.id, row] as const));

    // Forget — and unpaint — anything that was tombstoned, vanished, or had
    // its anchor changed by `reattach` (or by a pull from another device).
    let unpainted = 0;
    for (const [id, attempt] of Array.from(pass.attempts)) {
      const row = liveById.get(id);
      if (row && signatureOf(row.anchor) === attempt.signature) continue;
      if (attempt.painted) unpainted += unpaint(id, pass.root);
      pass.attempts.delete(id);
    }
    if (unpainted > 0) pass.map = null;

    for (const row of live) {
      if (pass.attempts.has(row.id)) continue;
      pass.attempts.set(row.id, {
        signature: signatureOf(row.anchor),
        stage: 'new',
        placement: null,
        painted: false,
      });
    }

    // Pass 1 — verbatim only, inline with this render. No budget: measured at
    // 5,8–7,2 ms for 200 annotations on a real chapter, and cutting it short
    // would only delay notes that are already ready.
    const firstPass = atStage(live, 'new');
    if (firstPass.length > 0) resolveBatch(firstPass, false, null);
    publish();

    // Pass 2 — everything the exact tiers could not place, after the paint,
    // in chunks, until the queue is empty. Never capped by count.
    pass.cancel?.();
    pass.cancel = null;

    const step = (): void => {
      pass.cancel = null;
      // A pass that has been replaced (chapter change, content re-render) must
      // not paint into a DOM that is no longer the one it resolved against.
      if (stateRef.current !== pass) return;
      const queue = atStage(live, 'fuzzy-pending');
      if (queue.length === 0) return;
      resolveBatch(queue, true, DEFERRED_BUDGET_MS, DEFERRED_CHUNK_MAX);
      publish();
      if (atStage(live, 'fuzzy-pending').length > 0) pass.cancel = scheduleDeferred(step);
    };

    if (atStage(live, 'fuzzy-pending').length > 0) pass.cancel = scheduleDeferred(step);

    return () => {
      // Only the scheduled work is released. The painted DOM and everything
      // this pass knows about it stay exactly as they are: a StrictMode
      // teardown is immediately followed by the same effect running again
      // against the same content, and throwing the record away there would
      // repaint every annotation on top of itself.
      pass.cancel?.();
      pass.cancel = null;
    };
  }, [root, revision, key, rows]);

  const { list, orphans } = useMemo(() => {
    const placed: { row: Ann; from: number }[] = [];
    const lost: Ann[] = [];
    for (const row of rows) {
      if (row.deletedAt != null) continue;
      if (!placements.has(row.id)) continue; // still awaiting the deferred pass
      const placement = placements.get(row.id) ?? null;
      if (placement === null) lost.push(row);
      else placed.push({ row, from: placement.from });
    }
    placed.sort((a, b) => (a.from !== b.from ? a.from - b.from : byAge(a.row, b.row)));
    lost.sort(byAge);
    return {
      list: placed.length === 0 ? NO_ROWS : placed.map((entry) => entry.row),
      orphans: lost.length === 0 ? NO_ROWS : lost,
    };
  }, [rows, placements]);

  const create = useCallback(
    async (anchor: Anchor, note: string): Promise<string> => {
      // A UUID because the server parses this field with `uuid.Parse` (400
      // otherwise) and because `./painter` needs an id with no ASCII
      // whitespace in it to store several ids in one attribute.
      const id = crypto.randomUUID();
      const at = new Date().toISOString();
      await commit({ id, courseId, chapterId, anchor, note, createdAt: at, updatedAt: at, deletedAt: null });
      return id;
    },
    [courseId, chapterId],
  );

  const updateNote = useCallback(async (id: string, note: string): Promise<void> => {
    const at = new Date().toISOString();
    await commitPatch(id, (row) => ({ ...row, note, updatedAt: at }));
  }, []);

  const remove = useCallback(async (id: string): Promise<void> => {
    const at = new Date().toISOString();
    // A tombstone, not a delete: the server keeps it and hands it to every
    // other device (see `Repo.PullAnnotations`, which never filters tombstones
    // out). A hard delete here would come back on the next pull.
    await commitPatch(id, (row) => ({ ...row, updatedAt: at, deletedAt: at }));
  }, []);

  const reattach = useCallback(async (id: string, anchor: Anchor): Promise<void> => {
    const at = new Date().toISOString();
    await commitPatch(id, (row) => ({ ...row, anchor, updatedAt: at }));
  }, []);

  return { list, orphans, create, updateNote, remove, reattach };
}
