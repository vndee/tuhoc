import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { flushEvents } from '../api/events';
import { meQueryKey } from '../api/useMe';
import { clearSession } from './session';

/**
 * Bounds how long logout will wait for the best-effort final flush
 * (`bestEffortFinalFlush` below) before giving up and proceeding anyway.
 * The user asked to leave — a hung connection (or an in-flight mutation
 * that itself is waiting on a hung connection) must not hold the logout
 * UI hostage indefinitely. 5s is generous relative to a normal request
 * (low hundreds of ms) without being a noticeable stall for the common
 * case, which resolves almost immediately.
 */
const LOGOUT_SYNC_TIMEOUT_MS = 5_000;

/** Resolves with `promise`'s result, or `undefined` if `ms` elapses first — whichever comes first. Never rejects: `promise` rejecting is treated the same as it timing out (both are "the best-effort flush didn't finish in time," not a reason to block logout). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

/**
 * Resolves once no react-query mutation is in flight on `queryClient` —
 * immediately if none is, otherwise the moment the last one settles — or
 * after `timeoutMs`, whichever comes first. Never rejects.
 *
 * Task 10 replaces the old outbox flush this hook used to do
 * (`sync/engine.ts`'s `syncOnce()`/`waitForInFlight()`) with this: progress
 * and annotation writes are no longer queued locally and flushed on a
 * timer, they are react-query mutations that PUT/PATCH/DELETE the server
 * directly the moment the reader acts (see `progress/useProgress.ts`,
 * `annotations/useAnnotations.ts`). There is no local queue left to drain
 * before logout — the thing that CAN still be genuinely in flight, and
 * that would be silently abandoned by an unconditional `clearSession()`
 * right after `POST /auth/logout`, is exactly one of those mutations
 * mid-request. Waiting for `queryClient.isMutating()` to reach zero is the
 * direct react-query equivalent of the old `waitForInFlight()`: give
 * whatever the user's last action already kicked off a chance to actually
 * reach the server WHILE THE SESSION COOKIE IS STILL VALID, same as the
 * old flush did.
 *
 * Implemented as a bounded subscription rather than a bare
 * `setTimeout`/poll loop so it resolves the INSTANT the last mutation
 * settles rather than on the next poll tick, and — the reason it manages
 * its own timeout instead of relying solely on the outer
 * `withTimeout(bestEffortFinalFlush(...), LOGOUT_SYNC_TIMEOUT_MS)` call
 * site below — so the `MutationCache` subscription is always explicitly
 * torn down on the way out, even in the pathological case where a mutation
 * genuinely never settles. `withTimeout` alone stops AWAITING the inner
 * promise but never cancels it, which would otherwise leak this
 * subscription for the lifetime of the (page-lifetime, singleton)
 * `queryClient`.
 */
function waitForMutationsToSettle(queryClient: QueryClient, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (queryClient.isMutating() === 0) {
      resolve();
      return;
    }

    const finish = (): void => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };

    const unsubscribe = queryClient.getMutationCache().subscribe(() => {
      if (queryClient.isMutating() === 0) finish();
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * Gives whatever the reader's last action already kicked off a chance to
 * actually reach the server WHILE THE SESSION COOKIE IS STILL VALID (this
 * runs before `POST /auth/logout` below invalidates it) — the "optimistic
 * UI" judgment call extended to logout: a click on "mark read" or a note
 * edit fires a react-query mutation immediately, and logging out a moment
 * later must not abandon a request that was already on the wire.
 *
 * Task 10 rewrite. Before this task, the thing that could be "in flight"
 * was `sync/engine.ts`'s outbox push cycle (`waitForInFlight()` +
 * `syncOnce()`) — a local queue flushed on a 15s timer. That engine and its
 * outbox are gone: progress/annotation writes are react-query mutations
 * now, sent the instant the reader acts, with no local queue to drain.
 * `waitForMutationsToSettle()` (above) is the direct replacement — it is
 * this function's own `waitForInFlight()` + `syncOnce()` collapsed into
 * one wait, because react-query's mutation cache already tracks exactly
 * the thing the old two-step dance had to reconstruct by hand (whether
 * something is currently sending, and being notified the moment it
 * settles).
 *
 * `flushEvents()` (`../api/events`) is unrelated to any of the above and
 * unchanged by this task — `api/events.ts`'s in-memory study-event queue
 * was already off the Dexie outbox before Task 10 (Task 8, this phase).
 * It stays LAST, ordered after the mutation wait rather than interleaved
 * with it: the two touch unrelated server resources (react-query's PUT/
 * PATCH/DELETE endpoints vs `/events/batch`), so there is no ordering
 * requirement between them — `flushEvents()` never rejects (its own
 * `catch` either re-queues the failed batch or drops it; see its own
 * doc), so it needs no `try`/`catch` here to keep this function's
 * "failure here must not block logout" contract.
 *
 * `flushEvents()` here is itself wrapped, ONE level up, in
 * `withTimeout(bestEffortFinalFlush(queryClient), LOGOUT_SYNC_TIMEOUT_MS)`
 * below — which races the OUTER promise only. A request still pending
 * when that 5s bound elapses is ABANDONED, not cancelled (`api/client.ts`
 * wires no `AbortController`), and keeps running while the rest of this
 * hook moves on and clears local state. A scoped re-review (Task 8) caught
 * that an abandoned flush's eventual FAILURE used to reinject its batch
 * into whatever `api/events.ts`'s queue held by then — which, on a
 * same-tab account handoff, can already belong to whoever signed in next.
 * `api/events.ts`'s `queueGeneration` is what makes that batch DROPPABLE
 * instead: dropped if `resetEventQueue()` ran while it was in flight,
 * reinjected otherwise. Nothing here has to know which happened — that is
 * the point of the guard living inside `flushEvents()` itself. (A react-
 * query mutation abandoned the same way is not this hook's problem to
 * guard: TanStack Query's own retry/cache semantics own that request once
 * it is in flight, same as any other page unload would leave it.)
 */
async function bestEffortFinalFlush(queryClient: QueryClient): Promise<void> {
  await waitForMutationsToSettle(queryClient, LOGOUT_SYNC_TIMEOUT_MS);
  await flushEvents();
}

/**
 * Debt #3 — before this task there was NO way to log out anywhere in the
 * app: `POST /auth/logout` worked (apps/api/internal/auth/handler.go's
 * `Logout`) but nothing called it. This hook is that call site, plus
 * everything logging out needs to leave client state in a sane place for
 * whoever uses this browser next.
 *
 * Steps, and why this exact order:
 *
 *  1. `bestEffortFinalFlush()` — waits for any in-flight react-query
 *     mutation to settle, then attempts a flush of `api/events.ts`'s
 *     queued study events, bounded to `LOGOUT_SYNC_TIMEOUT_MS` total
 *     (Minor finding, Task 8: a hung connection must not hold the logout
 *     UI hostage). A normal failure (network down, 5xx, or simply timing
 *     out) is swallowed by `withTimeout`/`waitForMutationsToSettle`/
 *     `flushEvents`'s own existing swallowing — local state (including
 *     the event queue — see step 3's `clearSession()`) is still cleared
 *     unconditionally afterward regardless.
 *  2. `POST /auth/logout` — invalidates the session server-side and clears
 *     the cookie. A failure here (network error; the endpoint itself is
 *     designed to always return 200 even for an already-dead session — see
 *     `Logout`'s own doc comment) does NOT stop the steps below: the one
 *     outcome this function must never allow is leaving another account's
 *     data behind in this browser's `localStorage` just because the
 *     network blipped on the way out.
 *  3. `clearSession()` (./session.ts) — unconditionally, regardless of
 *     whether steps 1 or 2 succeeded. See the paragraph below for why that
 *     is the right trade-off, not just the safe-looking one. It clears
 *     every half of what this session left on the machine — the durable
 *     `localStorage` half (every user-content key) via `clearUserContent()`,
 *     the session-scoped query cache, (Task 8's fix round) whatever
 *     `api/events.ts`'s queue still held after step 1's best-effort flush,
 *     and (Task 11's fix round) whatever TanStack Query's own mutation
 *     cache still held — a mutation PAUSED by the default
 *     `networkMode: 'online'` while this reader was offline is not
 *     something step 1's wait can settle, and would otherwise auto-resume
 *     and replay under whichever cookie is valid once connectivity returns,
 *     which by then may belong to whoever signs in next on this browser —
 *     through one call, so no half can be forgotten here, at the one call
 *     site where forgetting one fails silently (ruling P2-F18). (Task 11
 *     also removed the offline-read marker this comment used to mention
 *     here — `<RequireAuth>`'s offline branch, its only reader, is gone;
 *     see `session.ts`'s own doc comment for what `clearSession()` clears
 *     today.)
 *  4. Reset the shared `me` query to `null` and navigate to `/login`.
 *     `src/pages/Login.tsx` goes through the same door on the way IN — the
 *     two together are what make "this browser shows one user at a time"
 *     true across an in-app logout→login.
 *
 * **Task 10 removed two steps that used to live here: `stopSync()`, called
 * TWICE, once before the flush and once after (fix-round-1 and
 * fix-round-2).** Both existed for one reason — `sync/engine.ts`'s
 * background push/pull cycle could have a request already on the wire when
 * logout ran, and its eventual (possibly LATE) response could write the
 * departing user's rows back into a local database this hook had just
 * promised was clean. That engine, its outbox, and everything it could
 * write to are gone: progress/annotation reads and writes go straight
 * through react-query and the server now, with no local table for a late
 * response to repopulate. There is nothing left for either `stopSync()`
 * call to protect. See this task's report for the fuller argument (and for
 * `session.ts`'s parallel note on why its own durable clear no longer
 * needs the analogous generation-counter guard it used to carry for a
 * structurally identical reason).
 *
 * **The core judgment call (debt #3's "think about it carefully" ask,
 * still true post-Task-10).** This hook clears local state
 * UNCONDITIONALLY, never only after a confirmed-successful final flush,
 * even though that would minimize data loss for the user who is leaving.
 * That is the WRONG trade-off here: a `localStorage` note draft belongs to
 * whichever account was typing it, and if it survives a logout, the next
 * person to sign in on the same browser inherits a stranger's half-written
 * words — a real, concrete failure mode on any shared/family computer, not
 * a hypothetical one (see `test/accountHandoff.test.tsx`). Losing a few
 * seconds of the departing user's own unsent mutation (they can just
 * re-click "mark read" or retype their note next time they sign in) is a
 * minor, recoverable annoyance; silently mixing two different people's
 * data is not. Given that asymmetry, this hook accepts the
 * (already-minimized-by-step-1) small data-loss risk in exchange for the
 * hard guarantee that no local content ever survives a logout to leak into
 * the next signed-in session.
 */
export function useLogout(): () => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useCallback(async () => {
    await withTimeout(bestEffortFinalFlush(queryClient), LOGOUT_SYNC_TIMEOUT_MS);

    try {
      await api.post('/auth/logout', undefined, { redirectOn401: false });
    } catch {
      // Network failure or an already-dead session — either way, the end
      // state the caller wants (logged out, clean local state) still
      // happens via the steps below.
    }

    // Every half of "this browser no longer belongs to that session",
    // through the one door at `./session.ts` (ruling P2-F18) — the
    // `localStorage` content, the query cache, and (Task 8's fix round)
    // whatever `api/events.ts`'s queue still held.
    //
    // The cache reset is not decoration, and it is why the clearing is one
    // call rather than `clearUserContent()` alone. The `me` entry is not
    // the only thing in that cache scoped to the session that is ending:
    // `['stats']` (Dashboard's streak, total minutes and 30-day chart),
    // `['course', ...]`, and every progress-derived entry are all the
    // departing user's. Overwriting only `me` left the rest in place, so an
    // in-app logout→login on the same browser rendered the PREVIOUS user's
    // numbers to the new one for as long as the refetch took — or
    // indefinitely if that refetch failed. Clearing before seeding `me`
    // matters too: it would otherwise wipe the seed it is supposed to leave
    // behind, which is why `clearSession` is awaited on the line above the
    // seed rather than beside it.
    await clearSession(queryClient);
    queryClient.setQueryData(meQueryKey, null);
    navigate('/login', { replace: true });
  }, [queryClient, navigate]);
}
