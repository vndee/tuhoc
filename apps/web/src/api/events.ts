/**
 * The client half of `POST /events/batch` —
 * apps/api/internal/stats/handler.go's `EventsBatch`: request body
 * `{"events":[{courseId,chapterId,kind,meta,at}]}`, 200
 * `{"accepted":number}` (this module never reads `accepted` — nothing
 * here needs to know how many of a batch landed, only that the request as
 * a whole did or didn't).
 *
 * Task 8 of Pha 3. Before this task, `progress/heartbeat.ts` enqueued
 * every heartbeat straight into `db.outbox` (`{table:'events', row:...}`)
 * and let `sync/engine.ts`'s 15s flush cycle carry it to the server
 * alongside progress and annotations. Task 10 deletes that outbox and the
 * sync engine outright — so a heartbeat needs its own, much smaller, path
 * to the server that owes nothing to Dexie.
 *
 * ## Why an in-memory queue and not IndexedDB
 *
 * A heartbeat fires every 30 seconds
 * (`progress/heartbeat.ts`'s `HEARTBEAT_INTERVAL_MS`) for as long as a
 * learner is actively reading. Flushing every single beat as its own
 * request would make the heartbeat alone responsible for roughly three
 * times as many requests as the rest of this app makes combined — so this
 * module gathers events in a plain in-memory array and lets
 * `startEventFlusher` post them in batches on a slower cadence instead
 * (see that function's own doc for the exact number and why).
 *
 * Living in memory, not Dexie, is a deliberate narrowing, not a step back
 * from Task 3/10's outbox: this queue exists for exactly one browser
 * session's worth of batching, never across a reload or across weeks the
 * way the deleted outbox did. Losing it on a hard refresh or a crash is
 * an acceptable, bounded loss (at most one flush interval's worth of
 * heartbeats); nothing here promises the durability the outbox used to.
 *
 * ## Why a failed flush keeps its events, unlike progress/annotations
 *
 * `api/progress.ts`'s `putProgress` and `api/annotations.ts`'s writes are
 * each backed by an optimistic `useMutation` with a rollback: a failed
 * write reverts the UI and the learner can see it and retry. A heartbeat
 * has no such surface — nothing renders "this heartbeat failed to save",
 * and there is nothing for a learner to retry by hand. A lost heartbeat
 * is simply a study minute that never reaches `GET /stats`, silently. So
 * `flushEvents` below, on any failure, puts the whole failed batch back
 * at the front of the queue for the next attempt instead of dropping it —
 * see its own doc comment for how that interacts with events queued
 * while the failed request was still in flight.
 */

import { api } from './client';

/** One study event, exactly as the server's `EventsBatch` parses it.
 * `kind` is narrowed to `'heartbeat'` here — the one kind this app's
 * client ever produces today — even though the server's own type is
 * intentionally more permissive (see `handler.go`'s comment on why `kind`
 * is not restricted server-side). `meta` is typed as an object that can
 * carry no properties, matching what `heartbeat.ts` has always sent
 * (`{}`) rather than `Record<string, unknown>`, which would silently
 * accept a shape nothing here means to produce. */
export interface StudyEvent {
  courseId: string;
  chapterId: string;
  kind: 'heartbeat';
  meta: Record<string, never>;
  at: string;
}

/**
 * The in-memory queue every `queueEvent` call appends to and every
 * `flushEvents` call drains. A module-level singleton on purpose:
 * `progress/heartbeat.ts`'s `startHeartbeat` is explicitly NOT a
 * singleton (its own doc comment: more than one call site can run
 * concurrently), and every one of those independent heartbeats must still
 * land in the SAME batch for `startEventFlusher`'s single flush loop to
 * pick up — a queue that lived on some per-call object would defeat the
 * whole point of batching.
 */
let queue: StudyEvent[] = [];

/** Appends one event to the in-memory queue. Synchronous, and never
 * touches the network — batching is entirely `flushEvents`'s job — so a
 * caller (`progress/heartbeat.ts`'s tick) can call this from a plain
 * `setInterval` callback with nothing to await and nothing that can
 * reject. */
export function queueEvent(event: StudyEvent): void {
  queue.push(event);
}

/**
 * Sends every event currently sitting in the queue as ONE
 * `POST /events/batch` request, then clears exactly those events.
 *
 * A no-op — no request at all — when the queue is empty, which matters
 * for `startEventFlusher`'s interval: most ticks of a slower flush
 * cadence land between heartbeats with nothing new to send, and a flush
 * loop that POSTed an empty `{events: []}` every tick regardless would
 * undo the whole reason batching exists.
 *
 * The queue is swapped out for a fresh empty array BEFORE the request is
 * sent (not filtered/cleared after), so any event `queueEvent` adds while
 * this request is still in flight lands in the NEW array untouched — it
 * is neither sent early (in a batch that already left) nor lost.
 *
 * On failure, the batch that was in flight is put back at the FRONT of
 * whatever is in the queue now (i.e. before anything that arrived during
 * the failed attempt) — see this module's header for why losing a
 * heartbeat silently is worse here than for progress/annotations. This
 * also means a heartbeat is never resent out of order and never
 * duplicated: the next successful flush sends the old batch followed by
 * whatever queued since, in the order each was recorded.
 */
export async function flushEvents(): Promise<void> {
  if (queue.length === 0) return;

  const batch = queue;
  queue = [];

  try {
    await api.post('/events/batch', { events: batch });
  } catch (err) {
    queue = [...batch, ...queue];
    // Same defensive posture as `progress/heartbeat.ts`'s own tick: this
    // runs off a bare `setInterval` callback (see `startEventFlusher`)
    // with no caller to propagate a rejection to, so the failure is
    // logged and swallowed rather than thrown — the events themselves
    // are the real record of the failure, kept queued above.
    console.error('tuhoc events: failed to flush study events, kept queued for retry', err);
  }
}

/**
 * How often `startEventFlusher`'s interval calls `flushEvents`.
 *
 * Three times `progress/heartbeat.ts`'s own 30s tick — chosen to directly
 * undo the ratio this task's brief states as the reason batching exists
 * at all: one request per heartbeat tick would run the heartbeat alone at
 * roughly three times the request rate of the rest of this app combined.
 * Batching three ticks into one request brings the heartbeat's own
 * request rate down to about the same order as everything else, not an
 * arbitrarily smaller one — a much longer interval would trade request
 * volume for staler data with no stated requirement asking for that
 * trade, and the `visibilitychange` flush below is what keeps a learner
 * closing a tab mid-interval from losing more than the two ticks a
 * shorter interval would also have left unflushed.
 */
const FLUSH_INTERVAL_MS = 90_000;

/**
 * Starts the periodic flush loop: `flushEvents` on the cadence above, plus
 * one extra flush the instant the tab becomes hidden (`visibilitychange`)
 * — closing or backgrounding a tab is exactly when a beat sitting in the
 * queue is most likely to never get another chance to flush. Returns a
 * teardown function that releases both.
 *
 * Not gated on `document.hidden` becoming `false` again — only the
 * hidden transition flushes; a tab coming back into view has nothing
 * urgent to send that the next interval tick wouldn't send anyway.
 *
 * Mirrors `progress/heartbeat.ts`'s `startHeartbeat`: NOT a module-level
 * singleton. `App.tsx` has exactly one call site for this today (right
 * next to `startSync()`), but nothing here assumes that — each call's
 * interval handle and listener reference live in its own closure, so two
 * concurrent calls (or React StrictMode's mount→cleanup→mount
 * double-invoke) would each release exactly what they, individually,
 * registered.
 */
export function startEventFlusher(): () => void {
  const interval = setInterval(() => {
    void flushEvents();
  }, FLUSH_INTERVAL_MS);

  const onVisibilityChange = (): void => {
    if (document.hidden) {
      void flushEvents();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
