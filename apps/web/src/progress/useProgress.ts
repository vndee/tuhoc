import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { type ProgressRow, fetchProgress, progressQueryKey, putProgress } from '../api/progress';

/**
 * Aggregate counts over a single course's progress — the hook's own answer
 * to "how much has this learner done," independent of any manifest (the
 * hook takes only `courseId`, per the task brief's literal signature; a
 * denominator like "out of how many chapters total" requires the manifest,
 * which callers already load separately via `loadManifest`/`useQuery` —
 * see Dashboard.tsx, which divides `partStats.chaptersRead` by the
 * manifest's own chapter count to build the completion ring).
 */
export interface PartStats {
  /** Distinct chapters marked `read` for this course. */
  chaptersRead: number;
  /** Distinct exercise checkboxes (`ex:<n>`) marked done for this course, across every chapter. */
  exercisesDone: number;
}

export interface UseProgressResult {
  isRead: (chapterId: string) => boolean;
  toggleRead: (chapterId: string) => void;
  exDone: (chapterId: string, n: number) => boolean;
  toggleEx: (chapterId: string, n: number) => void;
  partStats: PartStats;
  /**
   * Chapter ids currently marked read, for `CourseNav`'s `doneChapterIds`
   * prop (Ruling F4 / debt #1 — `CourseNav` already applies the `done`
   * class, this is the real data instead of the empty set it was fed
   * before this task).
   */
  doneChapterIds: ReadonlySet<string>;
  /**
   * True while the MOST RECENT `toggleRead`/`toggleEx` write is sitting on
   * a failed `PUT /progress` — i.e. the optimistic flip this hook showed
   * was rolled back, and the learner's tap did not actually reach the
   * server. Additive to the pre-Task-6 contract: existing consumers that
   * don't read it behave exactly as before. Named for what it measures —
   * the SAVE failed, not "there is progress" or "a load failed" (that is
   * `pages/Progress.tsx`'s own `progress.error`, a completely different
   * failure). Cleared back to `false` the moment another `toggleRead`/
   * `toggleEx` call starts (`useMutation` resets `isError` on every new
   * `mutate()`), so it never lingers past the next attempt.
   */
  saveError: boolean;
}

const EX_STATUS_PREFIX = 'ex:';
function exStatus(n: number): string {
  return `${EX_STATUS_PREFIX}${n}`;
}

/**
 * One shared, module-level empty array — NOT `useQuery`'s own
 * `data: rows = []` default-parameter syntax, which would build a fresh
 * `[]` on every single render for as long as the query has no data yet
 * (pending, or erroring and retrying). A fresh array is a fresh
 * REFERENCE, and `courseRows`/`doneChapterIds`/`partStats` below are all
 * `useMemo`d off `rows` — so a fresh reference every render defeats every
 * one of those memos, handing a brand-new `Set` to `doneChapterIds` on
 * every render too. `ChapterView.tsx`'s `AuthedReaderExtras` feeds exactly
 * that `Set` to a `useEffect([progress.doneChapterIds, ...])` that calls
 * `onDoneChapterIdsChange` (a parent `setState`) — a `Set` that is
 * "equal" but never `===` from one render to the next makes that effect
 * fire on EVERY render, which sets state, which re-renders, which builds
 * another fresh `[]` while the query is still unsettled, forever. Measured
 * directly: `GET /progress` failing/pending for more than an instant
 * produced React's "Maximum update depth exceeded" in exactly this
 * component. One stable singleton is the whole fix.
 */
const EMPTY_ROWS: ProgressRow[] = [];

/**
 * R2 (a ruling, not in the brief): builds the row `onMutate` writes into
 * the query cache. `putProgress`'s own parameter type is deliberately
 * `Omit<ProgressRow, 'updatedAt'>` — the server stamps that field, so
 * there is no honest client-side value for it on the way OUT (see
 * `api/progress.ts`'s header). But the CACHE holds full `ProgressRow`s
 * (that is what `fetchProgress` resolves to, and what `isRead`/`exDone`/
 * `doneChapterIds` below all read), so the optimistic entry needs
 * *something* in that field until the server's real answer lands via
 * `onSettled`'s invalidate — a provisional client-side timestamp, stamped
 * fresh on every call so a second rapid toggle's patch always sorts after
 * the first's. `row` (the mutation's actual variables, sent to
 * `putProgress` unchanged) never carries this — only the cache entry does.
 *
 * Upserts by `(courseId, chapterId, status)`, the same compound key
 * `db/local.ts`'s Dexie schema used (`[courseId+chapterId+status]`) and
 * the server's own primary key (`api/progress.ts`'s `putProgress` doc) —
 * one row per checkbox, replaced in place rather than duplicated.
 */
function upsertOptimistic(rows: ProgressRow[], row: Omit<ProgressRow, 'updatedAt'>): ProgressRow[] {
  const optimistic: ProgressRow = { ...row, updatedAt: new Date().toISOString() };
  const idx = rows.findIndex(
    (r) => r.courseId === row.courseId && r.chapterId === row.chapterId && r.status === row.status,
  );
  if (idx === -1) return [...rows, optimistic];
  const next = rows.slice();
  next[idx] = optimistic;
  return next;
}

/**
 * Reads one course's progress from TanStack Query (Task 5's `api/progress`
 * — `GET`/`PUT /progress`, the server as the single source of truth) and
 * exposes read/exercise status plus mutators that write OPTIMISTICALLY:
 * `toggleRead`/`toggleEx` flip the cache synchronously, before the network
 * answers, and roll back to the pre-toggle value if the `PUT` fails (see
 * `saveError` above for how that failure surfaces to the learner).
 *
 * This replaces the pre-Task-6 version's Dexie `liveQuery` +
 * `setProgress`-onto-an-outbox pair (`src/db/local.ts` / `src/sync/`) —
 * neither is imported here any more. `UseProgressResult`'s pre-existing
 * members keep their exact names/shapes (`CourseNav`, `Dashboard`,
 * `ChapterView` all consume this hook and are out of this task's blast
 * radius); `saveError` is the one addition.
 *
 * ## One shared cache entry, filtered client-side
 *
 * `progressQueryKey()` takes no `courseId` — `GET /progress` always
 * answers every course's rows for the signed-in learner in one shot (see
 * `api/progress.ts`'s own doc comment) — so every `useProgress(...)` call
 * site, whatever course it names, reads and patches the SAME cache entry,
 * and TanStack Query's subscription model is what keeps them all in sync
 * (a `Sidebar` instance and a `ChapterView` instance for the same course
 * both see a toggle the instant either one's mutation settles, with no
 * cross-component wiring needed). Filtering by `courseId` happens here,
 * in JS, over that one shared array.
 *
 * ## Why `onMutate` cancels in-flight queries FIRST
 *
 * Without `queryClient.cancelQueries(...)`, a `GET /progress` that is
 * still in flight when a toggle fires (the mount fetch, or a previous
 * mutation's own `onSettled` refetch) can resolve AFTER this toggle's
 * optimistic patch and silently overwrite it with pre-toggle data — the
 * classic query-vs-mutation race the TanStack Query docs' own optimistic-
 * update recipe guards against the same way. This matters concretely for
 * two rapid toggles on the same chapter: without the cancel, the first
 * toggle's patch can be clobbered by a stale response arriving between the
 * two, and the UI gets stuck on a value neither toggle actually asked for.
 *
 * `cancelQueries` is invoked before `setQueryData` (matching the order the
 * cancellation needs to visibly take effect against a concurrent fetch),
 * but is not `await`-ed before the patch: `Query#cancel` aborts the
 * in-flight retryer SYNCHRONOUSLY (see `@tanstack/query-core`'s
 * `query.ts`) — the Promise it returns only signals when that abort has
 * fully settled, not when the abort itself takes effect. Gating the patch
 * behind that `await` would push it a full microtask tick after the
 * `toggleRead`/`toggleEx` call that triggered it, which is one tick too
 * late for the "flips before the network answers" contract this hook
 * promises: a caller that reads `isRead` synchronously, right after
 * calling `toggleRead` in the same tick, must already see the new value.
 */
export function useProgress(courseId: string): UseProgressResult {
  const queryClient = useQueryClient();

  const { data: rows = EMPTY_ROWS } = useQuery({
    queryKey: progressQueryKey(),
    queryFn: () => fetchProgress(),
  });

  const courseRows = useMemo(() => rows.filter((r) => r.courseId === courseId), [rows, courseId]);

  const mutation = useMutation({
    // A one-arg wrapper, not `mutationFn: putProgress` directly: `putProgress`'s
    // own second parameter (`RequestOptions`) and `MutationFunction`'s
    // (`MutationFunctionContext`) share no overlapping property names, and
    // TS's weak-type check rejects that pairing even though, structurally,
    // an all-optional `RequestOptions` would otherwise accept it.
    mutationFn: (row: Omit<ProgressRow, 'updatedAt'>) => putProgress(row),
    onMutate: async (row) => {
      const cancelled = queryClient.cancelQueries({ queryKey: progressQueryKey() });
      const previous = queryClient.getQueryData<ProgressRow[]>(progressQueryKey());
      queryClient.setQueryData<ProgressRow[]>(progressQueryKey(), (old = []) => upsertOptimistic(old, row));
      // Not needed for the patch above (already applied, synchronously) —
      // awaited here only so this mutation's lifecycle doesn't move on to
      // `mutationFn` until the cancellation itself has fully settled.
      await cancelled;
      return { previous };
    },
    onError: (_err, _row, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(progressQueryKey(), ctx.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: progressQueryKey() });
    },
  });
  const mutate = mutation.mutate;

  // `isRead`/`exDone` read the query cache DIRECTLY (`queryClient.getQueryData`),
  // not the `rows`/`courseRows` this render committed. That is deliberate,
  // not a style choice: `queryClient.setQueryData` inside `onMutate` above
  // writes the cache SYNCHRONOUSLY, but the re-render that would update
  // `rows` is scheduled through TanStack Query's `notifyManager` (a
  // `setTimeout(…, 0)`, i.e. a macrotask) — strictly later than "this
  // synchronous call". A caller of `toggleRead` that checks `isRead` right
  // after, in the same tick (this hook's own "flips before the network
  // answers" contract — see this file's module doc), would still see the
  // PRE-toggle value if `isRead` read anything render-derived. Reading the
  // cache directly sidesteps that lag entirely, and is also what makes two
  // rapid `toggleRead` calls in the same tick resolve correctly: the
  // second call's `isRead` sees the first call's SYNCHRONOUS patch, not a
  // stale snapshot from before either of them ran.
  const isRead = useCallback(
    (chapterId: string) => {
      const current = queryClient.getQueryData<ProgressRow[]>(progressQueryKey()) ?? [];
      return current.some(
        (r) => r.courseId === courseId && r.chapterId === chapterId && r.status === 'read' && r.done,
      );
    },
    [queryClient, courseId],
  );

  const exDone = useCallback(
    (chapterId: string, n: number) => {
      const current = queryClient.getQueryData<ProgressRow[]>(progressQueryKey()) ?? [];
      return current.some(
        (r) => r.courseId === courseId && r.chapterId === chapterId && r.status === exStatus(n) && r.done,
      );
    },
    [queryClient, courseId],
  );

  const toggleRead = useCallback(
    (chapterId: string) => {
      mutate({ courseId, chapterId, status: 'read', done: !isRead(chapterId) });
    },
    [courseId, isRead, mutate],
  );

  const toggleEx = useCallback(
    (chapterId: string, n: number) => {
      mutate({ courseId, chapterId, status: exStatus(n), done: !exDone(chapterId, n) });
    },
    [courseId, exDone, mutate],
  );

  const doneChapterIds = useMemo(
    () => new Set(courseRows.filter((r) => r.status === 'read' && r.done).map((r) => r.chapterId)),
    [courseRows],
  );

  const partStats = useMemo<PartStats>(
    () => ({
      chaptersRead: doneChapterIds.size,
      exercisesDone: courseRows.filter((r) => r.status.startsWith(EX_STATUS_PREFIX) && r.done).length,
    }),
    [courseRows, doneChapterIds],
  );

  return { isRead, toggleRead, exDone, toggleEx, partStats, doneChapterIds, saveError: mutation.isError };
}
