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
 *
 * ## `resetEventQueue` — the account-handoff hole this module shipped with
 *
 * This queue is a module-level singleton (see the doc on `queue` below),
 * which means it does not belong to any one account any more than
 * `db/local.ts`'s tables did before `clearLocalData()` existed, or the
 * note draft in `localStorage` did before `test/accountHandoff.test.tsx`
 * was written to prove it (see that file's own header). Task 8's first
 * cut of this module left the queue with no reset at all: an event A
 * queued and never flushed survived `useLogout()` untouched, and the next
 * `startEventFlusher()` tick — restarted under B's session the instant B
 * signed in on the same tab — would POST it to `/events/batch` under B's
 * cookie, silently attributing A's study minutes to B (the server has no
 * per-row ownership check of its own; `EventsBatch` writes every row with
 * `auth.UID(c)`, the session's account). `resetEventQueue` exists to be
 * the third half `auth/session.ts`'s `clearSession()` — this codebase's
 * established single truth point for ending a session (ruling P2-F18) —
 * calls unconditionally, alongside the durable and query-cache halves it
 * already cleared. See `test/eventQueueHandoff.test.tsx` for the
 * end-to-end proof and `auth/session.ts`'s own doc for why the clearing
 * happens there and not here, and why a BEST-EFFORT FLUSH has to happen
 * first, in `useLogout.ts`, while the departing account's cookie is still
 * valid — clearing alone would needlessly discard a heartbeat that could
 * have been recorded under its own account.
 *
 * ## `queueGeneration` — the fix above still leaked, one layer down
 *
 * A scoped re-review of the `resetEventQueue` fix caught a residual race
 * `resetEventQueue` alone does not close: `useLogout.ts`'s best-effort
 * flush runs inside `withTimeout(…, LOGOUT_SYNC_TIMEOUT_MS)`, which races
 * the OUTER promise only — it never cancels the underlying request (no
 * `AbortController` anywhere in `api/client.ts`). A flush still pending
 * when that 5s bound elapses is ABANDONED, not cancelled, and keeps
 * running while logout clears everything, `resetEventQueue()` included.
 * If that abandoned request's response arrives LATE, as a FAILURE, the
 * pre-fix `catch` block reinjected its batch into whatever `queue`
 * CURRENTLY held — which, on a same-tab handoff, can already belong to a
 * different, already signed-in account. `queueGeneration` (see its own
 * doc, right below `queue`) closes this the way `sync/engine.ts`'s
 * `syncEpoch` already closes the identical shape of bug for outbox
 * pushes: a flush stamps the current generation before it awaits the
 * network, and only reinjects on failure if that generation is still
 * current — a `resetEventQueue()` in between means the batch is dropped,
 * not written back.
 *
 * ## `queueOwner` — and why both fixes above were about the WRONG TAB
 *
 * Everything written above is about ONE tab: the tab that performs an auth
 * transition, and therefore the tab that runs `clearSession()`. The final
 * whole-branch review found the same leak in the tab that does NOT.
 *
 * `clearSession()` is tab-local by construction. The only thing that
 * crosses to another tab is `auth/sessionIdentity.ts`'s announcement, over
 * a `BroadcastChannel`. Before Task 10 there was exactly one reader of it
 * on the data path — `sync/engine.ts`'s `runCycle`, which opened with
 * `if (sessionWasSuperseded()) { stopSync(); return; }`, the ONLY place in
 * this app that asked *whose data am I about to send* before sending a
 * learner's data. Task 10 deleted that engine. This module took over one
 * half of its job and inherited none of its guard.
 *
 * The path, measured (`test/supersededTabHandoff.test.tsx`): tab 2 sits on
 * `/c/:courseId/:chapterId` — a PUBLIC route, deliberately outside
 * `<RequireAuth>` — with `useMe` cached as A (`staleTime: 60_000`, tab
 * unfocused), so `AuthedReaderExtras` stays mounted and `startHeartbeat`
 * keeps calling `queueEvent` every 30s. In tab 1, A signs out and B signs
 * in. Tab 2 hears `announceSessionUser(null)` and sets `superseded` — and
 * nothing reads it. `startEventFlusher`'s 90s interval fires anyway,
 * `api/client.ts`'s `send()` always sends `credentials: 'include'` — B's
 * cookie now — and `stats.EventsBatch` writes every row with `auth.UID(c)`.
 * A's study minutes land in B's account, repeatedly.
 *
 * TWO windows, not one, which is why the fix is not a single `if`:
 *
 *   - WHILE `superseded` is true, every beat this tab queues (the reader is
 *     still scrolling A's chapter) would go out under B.
 *   - AFTER tab 2 refetches `GET /me` and learns it is B, `superseded` is
 *     cleared — correctly: this tab has just established, first-hand, who
 *     the browser belongs to. But the QUEUE is still A's, and nothing
 *     empties it: `resetEventQueue()` is only ever called from
 *     `clearSession()`, which never runs in this tab.
 *
 * So the queue is STAMPED with the session it was collected under
 * (`queueOwner`, from `establishedSessionUser()`), and `flushEvents` sends
 * only when BOTH facts still hold: this tab has not been superseded, and
 * the browser still belongs to the same account the queue does. Each half
 * answers a window the other cannot see, and each is pinned by its own test
 * in `test/supersededTabHandoff.test.tsx` (both proven able to fail — see
 * the final fix report's mutation section).
 *
 * Read synchronously, at the moment of sending, rather than through a
 * `subscribeToSessionChanges` listener: `sessionIdentity.ts`'s own doc says
 * why — "a guard that only works when its event arrives is a guard whose
 * failure mode is silence. Reading a boolean cannot miss." That was written
 * about `runCycle`, and it is inherited here along with the job.
 */

import { establishedSessionUser, sessionWasSuperseded } from '../auth/sessionIdentity';
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

/**
 * Bumped by `resetEventQueue()`, never anywhere else. `flushEvents`
 * captures the CURRENT value once, at the moment it starts (before its
 * network call), and compares that captured value against the CURRENT
 * `queueGeneration` immediately before writing a failed batch BACK into
 * `queue` — not before the network call itself, which is harmless to let
 * finish. If the two differ, `resetEventQueue()` ran while this flush's
 * request was still in flight, and the failed batch is DROPPED instead
 * of written.
 *
 * This is `sync/engine.ts`'s `syncEpoch` mechanism, verbatim in shape:
 * that module's own doc comment names the exact failure this closes —
 * `stopSync()` (there) / `resetEventQueue()` (here) only stops FUTURE
 * work; neither can un-schedule a network request already in flight, and
 * `api/client.ts`'s `send()` has no `AbortController` to cancel one with.
 * `withTimeout` in `auth/useLogout.ts`'s `bestEffortFinalFlush` only races
 * the OUTER promise — a flush that is still pending when the 5s bound
 * elapses is ABANDONED, not cancelled, and keeps running in the
 * background while logout moves on and clears everything, including this
 * queue. Without a generation check, that abandoned request's eventual
 * FAILURE would reinject A's batch into whatever `queue` holds by the
 * time the `catch` runs — which, on a same-tab handoff, can already be
 * B's own freshly-queued events (see `test/eventQueueHandoff.test.tsx`'s
 * second scenario for the end-to-end proof). A stale generation means
 * those events belong to a session that is gone; dropping them is the
 * correct outcome, not a compromise — A's best-effort chance to flush
 * already happened, while the cookie was still valid, in
 * `bestEffortFinalFlush()`.
 */
let queueGeneration = 0;

/**
 * Which session's data is sitting in `queue` right now — the value
 * `establishedSessionUser()` (`auth/sessionIdentity.ts`) returned at the
 * moment the current batch started collecting.
 *
 * `undefined` means either "the queue is empty, so nobody owns it" or
 * "this tab had not yet learned who the browser belongs to when the first
 * event was queued". The two are the same thing for this module's purposes
 * — in both cases there is no account this batch can be honestly
 * attributed to, and `flushEvents` compares against the CURRENT value, so
 * a batch collected before `GET /me` answered is sent only if the answer,
 * when it arrives, is still `undefined` (it never is: `useMe` announces
 * either an id or `null`).
 *
 * See this module's header for the leak this closes. The short version:
 * `sessionWasSuperseded()` is only true until the superseded tab
 * re-establishes an identity of its own, and the queue outlives that
 * moment.
 */
let queueOwner: string | null | undefined;

/**
 * Empties the queue because what is in it belongs to a session this
 * browser no longer has — never because of an ordinary flush.
 *
 * Bumps `queueGeneration` for exactly the reason `resetEventQueue()` does
 * (see that generation's own doc): a flush of the SAME batch may still be
 * in flight, and if it later fails, its `catch` must drop the batch rather
 * than write a departed session's events into the queue this function just
 * handed to whoever comes next.
 */
function discardOrphanedQueue(reason: string): void {
  if (queue.length > 0) {
    console.error(
      `tuhoc events: ${reason}; dropping ${queue.length} queued study event(s) rather than sending them under whichever account holds this browser's cookie now`,
    );
  }
  queue = [];
  queueGeneration += 1;
  queueOwner = establishedSessionUser();
}

/** Appends one event to the in-memory queue. Synchronous, and never
 * touches the network — batching is entirely `flushEvents`'s job — so a
 * caller (`progress/heartbeat.ts`'s tick) can call this from a plain
 * `setInterval` callback with nothing to await and nothing that can
 * reject.
 *
 * Stamps the batch with whoever this tab currently believes the browser
 * belongs to (`queueOwner`). When that has CHANGED since the batch started
 * — a tab that was superseded and has since learned it is now B — whatever
 * the queue still holds is A's and is discarded here, before B's own first
 * event joins it. Without this the two would travel together and
 * `flushEvents`'s owner check, seeing a batch stamped A, would have to
 * drop B's beat along with A's: correct, but a silent loss of the arriving
 * account's data for no reason. */
export function queueEvent(event: StudyEvent): void {
  if (establishedSessionUser() !== queueOwner) {
    discardOrphanedQueue('the session that queued these study events is no longer the one this browser belongs to');
  }
  queue.push(event);
}

/**
 * Drops every event currently sitting in the queue, unconditionally.
 * Synchronous, like `queueEvent` — there is nothing to await, only an
 * array reference to replace.
 *
 * The ONE caller this is meant for is `auth/session.ts`'s `clearSession()`
 * — see this module's own header for why a departing account's residual
 * queue must never survive into the next account's session. Called from
 * anywhere else, this silently discards whatever a learner's browser was
 * about to report as study time, which is why `session.test.ts`'s
 * "no third way to end a session" tripwire watches this name the same way
 * it already watches `clearLocalData`/`resetSessionScopedQueries`.
 *
 * Deliberately does NOT attempt a flush first. `flushEvents` and
 * `resetEventQueue` are two separate, ordered steps by design (see
 * `auth/session.ts`'s `clearSession()` doc and `auth/useLogout.ts`'s
 * `bestEffortFinalFlush`) — merging them here would make it impossible
 * for a caller to run the flush EARLIER, while a cookie the flush needs
 * is still valid, and reset LATER, after that cookie is already gone.
 *
 * Does NOT cancel a `flushEvents()` call already in flight when this
 * runs — there is no `AbortController` to cancel it with (see
 * `queueGeneration`'s own doc) — and does not affect that call's SUCCESS
 * path: it already took its own snapshot of the queue before this
 * replaces it (see `flushEvents`'s own doc on why), so a request that
 * goes on to succeed still deletes exactly the batch it sent, nothing
 * more. What this DOES affect is that call's FAILURE path: bumping
 * `queueGeneration` here is what makes a batch belonging to an abandoned,
 * still-in-flight request DROPPABLE rather than reinjected into
 * whichever session's queue happens to exist by the time that request's
 * late failure arrives — see `queueGeneration`'s own doc for the full
 * mechanism and why this mirrors `sync/engine.ts`'s `syncEpoch`.
 */
export function resetEventQueue(): void {
  queue = [];
  queueGeneration += 1;
  // The queue is empty, so it has no owner. Not merely tidiness: leaving a
  // departed account's id stamped here would make the NEXT event queued in
  // this tab look, to `queueEvent`'s own comparison, like it arrived after
  // an ownership change that has already been dealt with.
  queueOwner = undefined;
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
 *
 * That reinjection is GATED on `queueGeneration` (see its own doc): if
 * `resetEventQueue()` ran at any point between this call starting and its
 * failure being observed — an account handoff during the network round
 * trip — the captured generation no longer matches, and the batch is
 * DROPPED instead of written back. Those events belong to a session that
 * has already ended; the caller (`auth/useLogout.ts`'s
 * `bestEffortFinalFlush`) already gave them their one best-effort chance
 * to leave while that session's cookie was still valid.
 */
export async function flushEvents(): Promise<void> {
  if (queue.length === 0) return;

  // THE GUARD `runCycle` USED TO OWN — see this module's header for the
  // whole path, and `auth/sessionIdentity.ts` for why it is polled here
  // rather than delivered as an event.
  //
  // Both halves are load-bearing and neither implies the other. While
  // `superseded` is true this tab's own belief about the browser
  // (`establishedSessionUser()`) is UNCHANGED — the flag is the only thing
  // that moved — so the owner comparison alone would happily send. Once
  // this tab re-establishes an identity the flag is cleared, so the flag
  // alone would happily send a queue that is still the previous account's.
  if (sessionWasSuperseded() || queueOwner !== establishedSessionUser()) {
    discardOrphanedQueue(
      sessionWasSuperseded()
        ? 'another tab has taken this browser’s session'
        : 'this browser now belongs to a different account than the one these events were collected under',
    );
    return;
  }

  const batch = queue;
  const generation = queueGeneration;
  queue = [];

  try {
    await api.post('/events/batch', { events: batch });
  } catch (err) {
    if (generation !== queueGeneration) {
      // An account handoff (`resetEventQueue()`) happened while this
      // request was in flight — see `queueGeneration`'s own doc. `queue`
      // may already belong to a completely different, newly signed-in
      // session; reinjecting `batch` into it would be the exact
      // cross-account leak this guard exists to prevent, so the batch is
      // dropped here rather than written back.
      console.error(
        'tuhoc events: a flush failed after an account handoff ran while it was still in flight; dropping the abandoned batch instead of risking it leaking into the next session',
        err,
      );
      return;
    }
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
