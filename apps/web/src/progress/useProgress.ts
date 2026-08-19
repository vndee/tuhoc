import { liveQuery } from 'dexie';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db, setProgress, type ProgressRow } from '../db/local';

/**
 * Aggregate counts over a single course's local progress rows — the
 * hook's own answer to "how much has this learner done," independent of
 * any manifest (the hook takes only `courseId`, per the task brief's
 * literal signature; a denominator like "out of how many chapters total"
 * requires the manifest, which callers already load separately via
 * `loadManifest`/`useQuery` — see Dashboard.tsx, which divides
 * `partStats.chaptersRead` by the manifest's own chapter count to build
 * the completion ring).
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
}

const EX_STATUS_PREFIX = 'ex:';
function exStatus(n: number): string {
  return `${EX_STATUS_PREFIX}${n}`;
}

/**
 * Live-subscribes to one course's rows in the local `progress` table
 * (Task 13's `src/db/local.ts`) and exposes read/exercise status plus
 * mutators that write through `setProgress` — which, in one Dexie
 * transaction, both updates local state and enqueues the mutation onto
 * the sync outbox (see `setProgress`'s own doc comment). This hook adds
 * no separate "pending sync" state of its own: the local write IS the
 * answer the whole app treats as current (Ruling F5 — completion %, and
 * everything this hook exposes, comes from local progress, not a round
 * trip to the server), so there is nothing to roll back if the outbox
 * later fails to flush — `src/sync/engine.ts` retries indefinitely and
 * this hook's next `liveQuery` emission will simply reflect whatever
 * local state exists at any given moment, exactly as it does today.
 *
 * `db.progress` has no per-`courseId` index of its own (its only index is
 * the compound primary key `[courseId+chapterId+status]` — see
 * `local.ts`'s schema) and this task does not touch that schema, so
 * filtering happens in JS after a full-table `toArray()` rather than an
 * indexed range query. This is a full local-table scan on every write to
 * ANY course's progress, not just this hook's own `courseId` — acceptable
 * because a single user's local progress table is small (at most a few
 * hundred rows: one row per chapter marked read, plus one per exercise
 * checkbox, across however many courses this browser profile has ever
 * touched), and correctness (never needing a schema migration this task
 * wasn't scoped to make) is worth more here than the micro-optimization.
 *
 * Multiple independent call sites (`Sidebar`, `CourseHome`, `ChapterView`
 * all call this for the same `courseId` on a chapter route) each run
 * their own `liveQuery` subscription rather than sharing one through a
 * context — deliberately: Dexie's `liveQuery` already guarantees every
 * subscriber converges on the same data after any write (it re-runs the
 * querier whenever a write touches a table it read from), so independent
 * subscriptions are simply idiomatic here, the same way multiple
 * `useQuery(manifestQueryKey(...))` call sites already share a cache
 * without any of *them* needing to coordinate directly either.
 *
 * `isRead`/`exDone`/`toggleRead`/`toggleEx` are all stable function
 * identities across re-renders (reading current data through a ref, not a
 * render-time closure) — this matters concretely for `ChapterView`, which
 * uses `toggleRead` inside an imperative `#mark-btn` click listener
 * wired up in a `useEffect`; a stable reference means that effect does
 * not need to tear down and re-attach its listener on every progress
 * change, only on an actual chapter change.
 */
export function useProgress(courseId: string): UseProgressResult {
  const [rows, setRows] = useState<ProgressRow[]>([]);
  // Deliberately assigned during render, not in a `useEffect` — the
  // "latest ref" pattern. Syncing this in an effect instead would leave a
  // one-render window where `rowsRef.current` still holds the PREVIOUS
  // `rows` while `isRead`/`exDone` (below) are already being called
  // against the just-rendered output elsewhere (e.g. `ChapterView`'s
  // `#mark-btn` effect reads `progress.isRead(chapter.id)` synchronously
  // during render, then this ref is what `toggleRead`'s LATER click
  // handler call reads) — writing it here keeps the ref exactly in sync
  // with whatever `rows` this render just committed, with no lag. The
  // write is idempotent (same value assigned again under, e.g., React
  // StrictMode's double-render), so it carries none of the risks the
  // "don't mutate during render" rule exists to prevent.
  const rowsRef = useRef<ProgressRow[]>(rows);
  rowsRef.current = rows;

  useEffect(() => {
    const subscription = liveQuery(() =>
      db.progress.toArray().then((all) => all.filter((r) => r.courseId === courseId)),
    ).subscribe({
      next: (next) => setRows(next),
      error: (err) => console.error('useProgress: live query failed', err),
    });
    return () => subscription.unsubscribe();
  }, [courseId]);

  const isRead = useCallback(
    (chapterId: string) => rowsRef.current.some((r) => r.chapterId === chapterId && r.status === 'read' && r.done),
    [],
  );

  const exDone = useCallback(
    (chapterId: string, n: number) =>
      rowsRef.current.some((r) => r.chapterId === chapterId && r.status === exStatus(n) && r.done),
    [],
  );

  const toggleRead = useCallback(
    (chapterId: string) => {
      void setProgress(courseId, chapterId, 'read', !isRead(chapterId));
    },
    [courseId, isRead],
  );

  const toggleEx = useCallback(
    (chapterId: string, n: number) => {
      void setProgress(courseId, chapterId, exStatus(n), !exDone(chapterId, n));
    },
    [courseId, exDone],
  );

  const doneChapterIds = useMemo(
    () => new Set(rows.filter((r) => r.status === 'read' && r.done).map((r) => r.chapterId)),
    [rows],
  );

  const partStats = useMemo<PartStats>(
    () => ({
      chaptersRead: doneChapterIds.size,
      exercisesDone: rows.filter((r) => r.status.startsWith(EX_STATUS_PREFIX) && r.done).length,
    }),
    [rows, doneChapterIds],
  );

  return { isRead, toggleRead, exDone, toggleEx, partStats, doneChapterIds };
}
