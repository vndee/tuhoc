/**
 * The annotation store (P2 Task 4; rewired onto the server in Task 7, Pha 3)
 * — where the three anchoring/painting modules meet the data layer.
 *
 * `./normalize` turns a rendered chapter into a flat string, `./anchor` turns
 * a quote into a `Range` in that chapter, `./painter` colours the `Range` in,
 * and `../api/annotations` (Task 5, Pha 3) is the client half of
 * `GET/POST /annotations` and `PATCH/DELETE /annotations/:id` — the server is
 * now the single source of truth, read through TanStack Query and written
 * optimistically through a `useMutation`, in the exact shape Task 6 (Pha 3)
 * established for `useProgress.ts`. This file is the only place any of that
 * is wired together, and it is the first code in P2 that writes data a
 * reader can lose — which is why "a failed write must not eat text the
 * learner just typed" (see `draftOf` below) is a first-class concern here,
 * not an afterthought.
 *
 * Annotations are HARD-deleted server-side (`../api/annotations`'s own doc:
 * migration 0009 dropped the tombstone column) — there is no `deletedAt` on
 * an `Ann` any more, on the wire or in the query cache. `remove()` below is a
 * real `DELETE`, and every row this hook ever sees is, by construction, live.
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
 * note is worthless". Nothing here deletes an orphan or writes anything at
 * all about it: resolving is a read. It goes into `orphans` for `OrphanPanel`
 * to offer back to the reader, and a note orphaned today can re-attach on its
 * own tomorrow when the content changes again.
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
 * Every write lands in TanStack Query's cache — optimistically, the instant
 * `create`/`updateNote`/`remove`/`reattach` is called, and again (for real)
 * once the server confirms — and this hook's own `useQuery` subscription is
 * what brings a change back into `rows`, including one written by an entirely
 * different call site sharing the same `annotationsQueryKey(courseId)` cache
 * entry (`queryClient.setQueryData` from anywhere notifies every subscriber).
 * If each emission re-resolved and re-painted the whole chapter, every new
 * note would add a second `<mark>` layer over every existing one (painting an
 * id twice nests rather than replaces) and `unpaint`-everything-first would
 * cost O(notes × nodes) each time.
 *
 * So the pass reconciles instead: it tracks which ids it has attempted and
 * against which anchor, paints only what is new, and unpaints only ids that
 * disappeared or whose anchor actually changed (`updateNote` therefore does
 * not disturb a single element on the page). That reconciliation is also what
 * makes the effect idempotent under React StrictMode's double-invoke: the
 * second run sees the same rows against the same content revision and has
 * nothing left to do.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Ann,
  annotationsQueryKey,
  createAnnotation,
  deleteAnnotation,
  fetchAnnotations,
  patchAnnotation,
} from '../api/annotations';
import { type Anchor, type AnchorColor, anchorToRange } from './anchor';
import { isMapStale, type NormMap, normalizeContainer, rangeToFlat } from './normalize';
import { type PaintItem, paintAll, unpaint } from './painter';

/** Re-exported rather than redeclared so this module and `../api/annotations`
 * can never disagree about the row shape the server accepts — the same
 * aliasing reasoning the pre-Task-7 version of this file used for
 * `AnnotationRow`, now pointed at the API layer instead of Dexie. */
export type { Ann };

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
   * Live annotations that currently HAVE a place in the rendered chapter, in
   * the order they appear in it. Sorted by flat offset, ties broken by
   * `createdAt` then `id` so the order is stable across renders.
   */
  readonly list: readonly Ann[];
  /**
   * Live annotations whose anchor could not be found in this render, after
   * both the exact and the fuzzy tier have had their turn. Not deleted —
   * `OrphanPanel` hands them back to the reader.
   */
  readonly orphans: readonly Ann[];
  /** Writes a new annotation OPTIMISTICALLY (it appears in `list`/`orphans`
   * the instant this is called, before `POST /annotations` answers) and
   * resolves to its id. The id is generated HERE, client-side, before the
   * request is sent — so a retry of a request whose response was lost hits
   * the server with the SAME id and gets back a 409 (already exists) rather
   * than creating a duplicate note. */
  create(anchor: Anchor, note: string): Promise<string>;
  /** Rewrites the note text OPTIMISTICALLY. No-op for an unknown id. A
   * failed save rolls the cache back to the previous text — see `draftOf`
   * for why that rollback never erases what the learner was typing. */
  updateNote(id: string, note: string): Promise<void>;
  /** A real delete (the server hard-deletes — see this module's header), sent
   * OPTIMISTICALLY: the row leaves `list`/`orphans` immediately and comes
   * back if `DELETE /annotations/:id` fails. No-op for an unknown id. */
  remove(id: string): Promise<void>;
  /** Points an existing note at a new quote via `PATCH /annotations/:id`
   * (never delete-then-create — that would hand the note a NEW id, and the
   * id is what `./painter` and `MarginCards` use to tie a card to its
   * highlight). No-op for an unknown id. */
  reattach(id: string, anchor: Anchor): Promise<void>;
  /**
   * The text to show in a compose box editing this note's `note` field:
   * whatever was last passed to `updateNote` for this id, for as long as
   * that write is in flight OR has failed and not yet been retried
   * successfully; otherwise the CONFIRMED text from `list`/`orphans`; `''`
   * for an id this hook does not know about.
   *
   * Exists because `updateNote`'s optimistic-with-rollback means a failed
   * save reverts the cache to the pre-edit note — and a compose box that
   * simply rendered `list[i].note` would have the text the learner just
   * wrote yanked out from under them the moment the network call failed.
   * The draft is tracked independently of the cache row for exactly that
   * reason: it survives a rollback because rolling the CACHE back is not the
   * same operation as erasing the DRAFT, and this hook never conflates them.
   */
  draftOf(id: string): string;
  /**
   * True while the MOST RECENT `updateNote`/`remove`/`reattach`/`create` is
   * sitting on a failed write — i.e. the optimistic change this hook showed
   * was rolled back. Additive, same contract as `useProgress.saveError`:
   * cleared the moment another write starts (`useMutation` resets `isError`
   * on every new `mutate`/`mutateAsync` call), so it never lingers past the
   * next attempt. `SelectionToolbar` already has its own inline alert for a
   * failed `create` (`ann.saveFailed`, next to the toolbar) — this field is
   * for the writes that had NO such surface before Task 7:  editing or
   * deleting a note, or re-attaching an orphan, all previously failed
   * silently into `console.error`. `reader/ChapterView.tsx` is the one place
   * that renders it (`notes.saveFailed`, `role="alert"`), the same
   * "additive field, one render site" shape Task 6 used for progress.
   */
  readonly saveError: boolean;
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
 * puts the knee.
 */
const DEFERRED_CHUNK_MAX = 8;

/** Upper bound on how long the scheduler may sit idle before running a
 * deferred chunk anyway. Without it, `requestIdleCallback` on a busy page can
 * postpone a reader's notes indefinitely. */
const DEFERRED_TIMEOUT_MS = 200;

const COLORS: ReadonlySet<string> = new Set<AnchorColor>(['y', 'g', 'b', 'p']);

/**
 * One shared, module-level empty array. Used both as `useQuery`'s default
 * (NOT `data: rows = []`, which builds a fresh `[]` on every render while the
 * query has no data — see `useProgress.ts`'s identical ruling, whose
 * measured failure mode was a `useEffect` that fired on every render and
 * drove React into "Maximum update depth exceeded") and as the empty
 * `list`/`orphans` result, so a chapter with nothing to show hands back the
 * same array identity on every render.
 */
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
 * `Ann.anchor` is `unknown` all the way from the server's `json.RawMessage`,
 * so every read of it is defensive. An unusable colour falls back to yellow
 * rather than reaching `paintAll` as a class name nobody styled — a highlight
 * in the wrong colour is a cosmetic problem, an unstyled one is invisible.
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
 * `Anchor.exact` — the words the note was written about — read with the same
 * defensiveness as `colorOf`, and for the same reason: this field arrives as
 * `unknown` from the server's `json.RawMessage`, so a row whose anchor is a
 * number, `null`, or a shape from a future version must render as an empty
 * quote rather than take a chapter's render down.
 *
 * Exported because two very different surfaces show it and MUST agree:
 * `./MarginCards` puts a 120-character version above a note, and
 * `./OrphanPanel` puts an 80-character version in the orphan list AND the
 * untruncated original in the "Xem exact gốc" box — where the reader copies it
 * to go hunting through the rebuilt chapter themselves. If those two disagreed
 * about what `exact` even is, the string the reader searches for would not be
 * the string that was stored.
 */
export function exactOf(anchor: unknown): string {
  const value = (anchor as { exact?: unknown } | null | undefined)?.exact;
  return typeof value === 'string' ? value : '';
}

/**
 * `exactOf`, collapsed to one line and cut to `max` characters (ellipsis
 * included in the count, so the result is never longer than `max`).
 *
 * `max` is a parameter rather than a constant here because the two callers
 * have genuinely different budgets — a margin card is 260px wide and a rail
 * list row is narrower still — while the whitespace rule and the cut must stay
 * identical. That is the split this codebase has already paid for twice: one
 * shared answer, per-caller sizing.
 */
export function quoteOf(anchor: unknown, max: number): string {
  const flat = exactOf(anchor).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Everything about an anchor that changes where and how it is painted.
 *
 * Deliberately NOT `JSON.stringify(anchor)`: an anchor written here and the
 * same anchor echoed back by the server are equal values whose key order need
 * not match, and a signature that changed on a round trip would unpaint and
 * repaint every note after every refetch. Deliberately not `updatedAt` either
 * — that changes when only the NOTE TEXT was edited, which must not disturb
 * the page.
 */
function signatureOf(anchor: unknown): string {
  const raw = anchor as { exact?: unknown; prefix?: unknown; suffix?: unknown } | null | undefined;
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  return `${str(raw?.exact)} ${str(raw?.prefix)} ${str(raw?.suffix)} ${colorOf(anchor)}`;
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
 * first, `id` as the final tie-break so the order never depends on the
 * server's own row order. */
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

/** The four writes this hook makes, folded into one `useMutation` — the exact
 * shape `useProgress.ts` uses for its single write, extended to a
 * discriminated union because annotations have four distinct server calls
 * instead of `putProgress`'s one. One mutation, not four, so `saveError`
 * below is a single flag with the same "cleared by the next write, whichever
 * kind" semantics Task 6 established, rather than four flags a caller would
 * have to OR together by hand. */
type MutationVars =
  | { readonly kind: 'create'; readonly row: Ann }
  | { readonly kind: 'updateNote'; readonly id: string; readonly note: string }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'reattach'; readonly id: string; readonly anchor: Anchor };

/** Builds the row `onMutate` writes into the query cache — the optimistic
 * half of each of the four writes above. `at` is stamped once by the caller
 * (one instant for the whole `onMutate` call), the same reasoning
 * `useProgress.ts`'s R2 ruling gives: the cache needs SOME `updatedAt` until
 * the server's real one lands via `onSettled`'s invalidate, and a fresh
 * per-call timestamp is what makes two rapid edits to the same note sort in
 * the order they actually happened. */
function applyOptimistic(rows: readonly Ann[], vars: MutationVars, at: string): Ann[] {
  switch (vars.kind) {
    case 'create':
      return [...rows, vars.row];
    case 'updateNote':
      return rows.map((row) => (row.id === vars.id ? { ...row, note: vars.note, updatedAt: at } : row));
    case 'remove':
      return rows.filter((row) => row.id !== vars.id);
    case 'reattach':
      return rows.map((row) => (row.id === vars.id ? { ...row, anchor: vars.anchor, updatedAt: at } : row));
  }
}

/**
 * Live annotations for one chapter, resolved against the rendered DOM and
 * painted into it, plus the four mutations that write them.
 *
 * Call this ONCE per chapter — it owns the painted `<mark>`s. `SelectionToolbar`,
 * `MarginCards` and `OrphanPanel` should receive this result as a prop rather
 * than each calling the hook again; two live instances would each paint the
 * same annotations.
 *
 * `content` is optional so the two-argument form callers that only need the
 * mutations (no chapter to resolve against) keep working. Without a `root`
 * there is no chapter to resolve against, so `list` and `orphans` both stay
 * empty — that is a statement about the absent DOM, not about the stored
 * notes.
 *
 * ## One cache entry per course, filtered to this chapter client-side
 *
 * `annotationsQueryKey(courseId)` is what `useQuery` reads and what every
 * mutation below patches — so every `useAnnotations(courseId, ...)` call
 * site for the SAME course, whatever chapter it names, shares one cache
 * entry (`fetchAnnotations(courseId)` answers every chapter of that course in
 * one request — see `../api/annotations`'s own doc). `chapterId` filtering
 * happens here, in JS, over that one shared array — the same split
 * `useProgress.ts` makes for `courseId` over its own single global cache
 * entry.
 *
 * ## Why `onMutate` cancels in-flight queries FIRST, and why `cancelQueries`
 * ## is not awaited before the patch
 *
 * Both reasons are `useProgress.ts`'s own, verbatim: without cancelling, a
 * `GET /annotations` still in flight when a write fires can resolve AFTER
 * this write's optimistic patch and silently overwrite it with pre-write
 * data. And `Query#cancel` aborts the in-flight retryer SYNCHRONOUSLY
 * (`@tanstack/query-core`'s `query.ts`) — the Promise it returns only signals
 * when that abort has fully settled, not when the abort itself takes effect.
 * Gating the patch behind that `await` would push it a full microtask tick
 * after the call that triggered it, which is one tick too late for "the
 * change is visible before the network answers".
 */
export function useAnnotations(
  courseId: string,
  chapterId: string,
  content: ChapterContent = { root: null, revision: 0 },
): UseAnnotationsResult {
  const key = `${courseId} ${chapterId}`;
  const queryClient = useQueryClient();

  const { data: courseRows = NO_ROWS } = useQuery({
    queryKey: annotationsQueryKey(courseId),
    queryFn: () => fetchAnnotations(courseId),
  });
  const rows = useMemo(() => courseRows.filter((row) => row.chapterId === chapterId), [courseRows, chapterId]);

  const [placements, setPlacements] = useState<ReadonlyMap<string, Placement>>(() => new Map());
  const stateRef = useRef<PassState | null>(null);

  /** The text last handed to `updateNote`, per id, for as long as that write
   * has not yet been CONFIRMED — see `draftOf`'s own doc on `UseAnnotationsResult`.
   * A ref, not state: writing it must never itself trigger a render (nothing
   * here reads it reactively — every reader calls `draftOf(id)` imperatively,
   * same as `useProgress.ts`'s `isRead`/`exDone` read the query cache
   * directly instead of through render-derived state, and for the identical
   * reason: a ref/cache read is available in the SAME tick as the call that
   * set it, a state update is not. */
  const draftsRef = useRef<Map<string, string>>(new Map());

  const mutation = useMutation({
    mutationFn: (vars: MutationVars): Promise<void> => {
      switch (vars.kind) {
        case 'create':
          return createAnnotation({
            id: vars.row.id,
            courseId: vars.row.courseId,
            chapterId: vars.row.chapterId,
            anchor: vars.row.anchor,
            note: vars.row.note,
          });
        case 'updateNote':
          return patchAnnotation(vars.id, { note: vars.note });
        case 'remove':
          return deleteAnnotation(vars.id);
        case 'reattach':
          return patchAnnotation(vars.id, { anchor: vars.anchor });
      }
    },
    onMutate: async (vars: MutationVars) => {
      const queryKey = annotationsQueryKey(courseId);
      const cancelled = queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Ann[]>(queryKey);
      const at = new Date().toISOString();
      queryClient.setQueryData<Ann[]>(queryKey, (old = []) => applyOptimistic(old, vars, at));
      // Not needed for the patch above (already applied, synchronously) —
      // awaited here only so this mutation's lifecycle doesn't move on to
      // `mutationFn` until the cancellation itself has fully settled.
      await cancelled;
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(annotationsQueryKey(courseId), ctx.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: annotationsQueryKey(courseId) });
    },
  });
  const mutateAsync = mutation.mutateAsync;

  /** `updateNote`/`remove`/`reattach` are documented no-ops for an id this
   * hook does not currently know about — reads the cache directly (not
   * `rows`, which is chapter-scoped) so an id from any chapter of this
   * course is recognised, matching the pre-Task-7 behaviour of a single
   * unscoped local table. */
  const annotationExists = useCallback(
    (id: string): boolean =>
      (queryClient.getQueryData<Ann[]>(annotationsQueryKey(courseId)) ?? []).some((row) => row.id === id),
    [queryClient, courseId],
  );

  // `fetchAnnotations` already scopes to `courseId` (server-side), so the
  // only client-side filtering left is `chapterId` — see this function's own
  // "one cache entry per course" doc above.
  useEffect(() => {
    const root = content.root;
    if (!root) {
      stateRef.current?.cancel?.();
      stateRef.current = null;
      return;
    }
    const revision = content.revision;

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
     * ELSE changed the chapter — and from Task 5 (P2) on, someone else does:
     * `./SelectionToolbar` paints the reader's new highlight the instant they
     * click a colour, BEFORE the row it created has travelled through the
     * query cache back to this pass. The map kept from a batch that painted
     * nothing (every annotation an orphan — an ordinary state) then describes
     * a tree that no longer exists, and `anchorToRange` is documented to
     * THROW rather than answer wrongly. That throw is not caught anywhere in
     * this file, on purpose, so it would leave the reader's page dead in a
     * passive effect. Reproduced as a test in `SelectionToolbar.test.tsx`
     * ("chương đang có ghi chú MỒ CÔI…"), which fails with `StaleNormMapError`
     * without this line.
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

    const live = rows;
    const liveById = new Map(live.map((row) => [row.id, row] as const));

    // Forget — and unpaint — anything that was deleted, vanished from this
    // chapter, or had its anchor changed by `reattach` (or by a fresher
    // fetch landing from elsewhere).
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
  }, [content.root, content.revision, key, rows]);

  const { list, orphans } = useMemo(() => {
    const placed: { row: Ann; from: number }[] = [];
    const lost: Ann[] = [];
    for (const row of rows) {
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
      // otherwise), because `./painter` needs an id with no ASCII whitespace
      // in it to store several ids in one attribute, and — generated HERE,
      // before the request — because it is what makes a retry after a lost
      // response a 409 instead of a duplicate note (see `create`'s own doc
      // on `UseAnnotationsResult`).
      const id = crypto.randomUUID();
      const at = new Date().toISOString();
      const row: Ann = { id, courseId, chapterId, anchor, note, createdAt: at, updatedAt: at };
      await mutateAsync({ kind: 'create', row });
      return id;
    },
    [courseId, chapterId, mutateAsync],
  );

  const updateNote = useCallback(
    async (id: string, note: string): Promise<void> => {
      if (!annotationExists(id)) return;
      // Stamped BEFORE the write, unconditionally — this is the draft, and it
      // must survive a rollback. See `draftOf`'s doc on `UseAnnotationsResult`.
      draftsRef.current.set(id, note);
      await mutateAsync({ kind: 'updateNote', id, note });
      // Reached only on SUCCESS (a throw from the line above skips past
      // this). The cache row now equals what was just written, so the draft
      // is no longer "ahead of" it — dropped so a LATER externally-arriving
      // update (another tab, another device) is not masked by stale draft
      // text forever.
      if (draftsRef.current.get(id) === note) draftsRef.current.delete(id);
    },
    [annotationExists, mutateAsync],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (!annotationExists(id)) return;
      await mutateAsync({ kind: 'remove', id });
    },
    [annotationExists, mutateAsync],
  );

  const reattach = useCallback(
    async (id: string, anchor: Anchor): Promise<void> => {
      if (!annotationExists(id)) return;
      await mutateAsync({ kind: 'reattach', id, anchor });
    },
    [annotationExists, mutateAsync],
  );

  const draftOf = useCallback(
    (id: string): string => {
      const pending = draftsRef.current.get(id);
      if (pending !== undefined) return pending;
      return rows.find((row) => row.id === id)?.note ?? '';
    },
    [rows],
  );

  return { list, orphans, create, updateNote, remove, reattach, draftOf, saveError: mutation.isError };
}
