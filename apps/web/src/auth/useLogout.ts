import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { flushEvents } from '../api/events';
import { meQueryKey } from '../api/useMe';
import { stopSync, syncOnce, waitForInFlight } from '../sync/engine';
import { clearSession } from './session';

/**
 * Bounds how long logout will wait for the best-effort final flush
 * (`bestEffortFinalFlush` below) before giving up and proceeding anyway.
 * The user asked to leave — a hung connection (or a stale in-flight cycle
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
 * One last push+pull WHILE THE SESSION COOKIE IS STILL VALID (this runs
 * before `POST /auth/logout` below invalidates it) — the "optimistic UI"
 * judgment call extended to logout: a click on "mark read" writes locally
 * and enqueues instantly, and the server round trip normally happens
 * within the next 15s tick; logging out immediately afterward would
 * otherwise strand that mutation in an outbox this function's caller is
 * about to clear, silently losing it forever.
 *
 * `waitForInFlight()` runs FIRST, before this function's own `syncOnce()`
 * — fix-round-1 finding: without it, if a cycle from BEFORE logout was
 * clicked happened to still be running, `syncOnce()`'s own call to
 * `runCycle()` would immediately no-op against `inFlight` (see
 * engine.ts's own doc comment), silently skipping the flush entirely
 * rather than narrowing it. Waiting first means this function's own
 * `syncOnce()` either runs for real (nothing was in flight, or the
 * previous cycle already finished by the time we get here) or is
 * "genuinely subsumed" — the cycle we waited for already did a full
 * push+pull, so there is nothing left for a second one to usefully add
 * beyond a fast, empty-outbox no-op.
 *
 * `flushEvents()` (`../api/events`) joined this, LAST, as Task 8's fix
 * round: `api/events.ts`'s in-memory study-event queue is exactly the
 * same "must leave while the cookie is still valid or never leave at
 * all" shape as the outbox push above it, and it was the one review
 * caught this function NOT doing at all — see that module's own header
 * and `auth/session.ts`'s `clearSession()` (the unconditional half of
 * this fix: whatever this call did not manage to send, `clearSession()`
 * drops rather than lets leak into the next signed-in account). Ordered
 * after `syncOnce()`, not interleaved with it: the two touch unrelated
 * server resources (`/sync` vs `/events/batch`, exactly the same
 * independence `sync/engine.ts`'s `flushOutbox` doc comment gives for why
 * THOSE two are separate request sequences), so there is no ordering
 * requirement between them — `flushEvents()` never rejects (its own
 * `catch` either re-queues the failed batch or drops it; see its own
 * doc), so it needs no `try`/`catch` here to keep this function's
 * "failure here must not block logout" contract.
 *
 * `flushEvents()` here is itself wrapped, ONE level up, in
 * `withTimeout(bestEffortFinalFlush(), LOGOUT_SYNC_TIMEOUT_MS)` below —
 * which races the OUTER promise only. A request still pending when that
 * 5s bound elapses is ABANDONED, not cancelled (`api/client.ts` wires no
 * `AbortController`), and keeps running while the rest of this hook moves
 * on and clears local state. A scoped re-review caught that an abandoned
 * flush's eventual FAILURE used to reinject its batch into whatever
 * `api/events.ts`'s queue held by then — which, on a same-tab account
 * handoff, can already belong to whoever signed in next. `api/events.ts`'s
 * `queueGeneration` (mirroring `sync/engine.ts`'s own `syncEpoch`, for the
 * identical reason) is what makes that batch DROPPABLE instead: dropped
 * if `resetEventQueue()` ran while it was in flight, reinjected otherwise.
 * Nothing here has to know which happened — that is the point of the
 * guard living inside `flushEvents()` itself.
 */
async function bestEffortFinalFlush(): Promise<void> {
  await waitForInFlight();
  await syncOnce();
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
 *  1. `stopSync()` — stop the interval/listener FIRST, before anything
 *     else touches local state, so a scheduled tick can't fire concurrently
 *     with the flush/clear below and race it. As of fix-round-1, this ALSO
 *     bumps a module-level epoch in `sync/engine.ts` that makes any cycle
 *     already in flight at this exact moment (see step 2) discard its
 *     eventual local write rather than apply it — see "The race this hook
 *     used to have" below for why that matters on its own, independent of
 *     step 2's best-effort wait.
 *  2. `bestEffortFinalFlush()` — waits for anything already in flight, then
 *     attempts its own push+pull PLUS a flush of `api/events.ts`'s queued
 *     study events (Task 8's fix round), bounded to `LOGOUT_SYNC_TIMEOUT_MS`
 *     total (Minor finding: a hung connection must not hold the logout UI
 *     hostage). A normal failure (network down, 5xx, or simply timing out)
 *     is swallowed by `withTimeout`/`syncOnce`/`flushEvents`'s own existing
 *     swallowing — local state (including the event queue — see step 5's
 *     `clearSession()`) is still cleared unconditionally afterward
 *     regardless.
 *  3. `stopSync()` AGAIN — fix-round-2, see "The abandoned-cycle gap"
 *     below. This is not a redundant repeat of step 1 (`stopSync` is
 *     idempotent w.r.t. its timer/listener side, but its epoch bump is
 *     NOT a no-op the second time): it exists specifically to invalidate
 *     step 2's OWN cycle if `withTimeout` gave up on it before it
 *     finished — that cycle is abandoned, not cancelled (there is no
 *     `AbortController` wired through `api/client.ts`), so it is still
 *     running and still holds the epoch from step 1 unless something
 *     bumps it again.
 *  4. `POST /auth/logout` — invalidates the session server-side and clears
 *     the cookie. A failure here (network error; the endpoint itself is
 *     designed to always return 200 even for an already-dead session — see
 *     `Logout`'s own doc comment) does NOT stop the steps below: the one
 *     outcome this function must never allow is leaving another account's
 *     data behind in this browser's IndexedDB just because the network
 *     blipped on the way out.
 *  5. `clearSession()` (./session.ts) — unconditionally, regardless of
 *     whether steps 2 or 4 succeeded. See the paragraph below for why that
 *     is the right trade-off, not just the safe-looking one. It clears ALL
 *     THREE halves of what this session left on the machine — every local
 *     table and user-content `localStorage` key via `clearLocalData()`, the
 *     session-scoped query cache, and (Task 8's fix round) whatever
 *     `api/events.ts`'s queue still held after step 2's best-effort flush —
 *     through one call, so no half can be forgotten here, at the one call
 *     site where forgetting one fails silently (ruling P2-F18). It calls
 *     the shared helpers rather than spelling out a table list, so a table
 *     added to `LocalDB`'s schema is covered automatically.
 *  6. Reset the shared `me` query to `null` and navigate to `/login`.
 *     `src/pages/Login.tsx` goes through the same door on the way IN — the
 *     two together are what make "this browser shows one user at a time"
 *     true across an in-app logout→login.
 *
 * **The race this hook used to have (fix-round-1, Finding 2):** `stopSync()`
 * on its own only prevents FUTURE ticks — it cannot un-schedule a network
 * request a cycle is already awaiting. Before this fix, a cycle that was
 * already mid-`pull()` when logout was clicked would have its `runCycle`'s
 * `inFlight` guard make THIS hook's own `syncOnce()` a silent no-op, and
 * then, once that stale cycle's `GET /sync` response eventually arrived —
 * potentially AFTER step 4's `Promise.all([...clear()])` had already run —
 * it would write the departing user's rows straight back into a database
 * this function had just promised was clean. `sync/engine.ts`'s
 * `syncEpoch`/`waitForInFlight()` close this: `stopSync()` bumps the
 * epoch, `flushOutbox`/`pull` check it immediately before their own local
 * writes and discard themselves if it moved, and `waitForInFlight()` lets
 * this hook's own flush genuinely run (or be genuinely subsumed) instead
 * of silently skipping. See `engine.ts`'s own doc comments for the full
 * mechanism.
 *
 * **The abandoned-cycle gap (fix-round-2):** the `LOGOUT_SYNC_TIMEOUT_MS`
 * bound (step 2) only stops THIS function from waiting any longer — it
 * does not cancel the underlying `fetch` (no `AbortController` is wired
 * through `api/client.ts`'s `request()`), so a flush cycle that times out
 * keeps running in the background. That cycle captured the epoch step 1
 * set, and nothing bumps the epoch again between the timeout firing and
 * step 5's clear — so if its response lands in that window, its epoch
 * check would still pass, and it would write straight into the database
 * step 5 is about to declare clean, the exact failure mode fix-round-1
 * closed, reopened through a different door. Step 3's second `stopSync()`
 * call closes it BY CONSTRUCTION: it bumps the epoch again regardless of
 * whether step 2 finished, finished late, or is still abandoned and
 * running, so an abandoned cycle's captured epoch can never match by the
 * time step 5 runs — independent of what any other part of the app
 * happens to do. (Before this fix, the gap was closed only as an
 * INCIDENTAL side effect of `App.tsx`'s `useSyncLifecycle`, which
 * reactively calls `stopSync()` again once `useMe()`'s cached user
 * becomes `null` — which THIS hook's own `setQueryData(meQueryKey, null)`
 * triggers. That happened to work, but it was another task's wiring
 * accidentally providing a guarantee this hook never established or
 * documented itself — a future refactor of that lifecycle effect could
 * have silently reopened the hole with nothing failing to say so.)
 *
 * **The core judgment call (debt #3's "think about it carefully" ask):**
 * `src/db/local.ts`'s own doc comment already states the local database
 * "belongs to exactly one signed-in user at a time" — this hook is what
 * makes that literally true instead of merely aspirational. The
 * alternative to clearing unconditionally would be clearing only after a
 * confirmed-successful final flush, to minimize data loss for the user
 * who is leaving. That is the WRONG trade-off here: an outbox entry
 * belongs to whichever account was signed in when it was created, and if
 * it survives a logout, the sync engine will — once a SECOND, DIFFERENT
 * user signs in on the same browser and `startSync()` runs again — push
 * the FIRST user's queued mutations under the second user's session
 * cookie, silently corrupting a stranger's server-side progress with the
 * first user's reading history (a real, concrete failure mode on any
 * shared/family computer, not a hypothetical one). Losing a few seconds
 * of the departing user's own unsynced edits (they can just re-click
 * "mark read" next time they sign in) is a minor, recoverable annoyance;
 * silently mixing two different people's data is not. Given that
 * asymmetry, this hook accepts the (already-minimized-by-step-2) small
 * data-loss risk in exchange for the hard guarantee — now enforced at the
 * engine level, not merely by ordering — that no local row ever survives
 * a logout to leak into the next signed-in session.
 */
export function useLogout(): () => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useCallback(async () => {
    stopSync();

    await withTimeout(bestEffortFinalFlush(), LOGOUT_SYNC_TIMEOUT_MS);

    // Second call, not a redundant repeat of the one above — see "The
    // abandoned-cycle gap" in this hook's own doc comment. If
    // `withTimeout` gave up on `bestEffortFinalFlush()` above, that
    // flush's OWN cycle is still running (abandoned, not cancelled) and
    // still holds the epoch the first `stopSync()` call set. Bumping the
    // epoch again HERE, unconditionally, invalidates that straggler by
    // construction — regardless of whether it actually finished, is still
    // running, or never gets a response at all.
    stopSync();

    try {
      await api.post('/auth/logout', undefined, { redirectOn401: false });
    } catch {
      // Network failure or an already-dead session — either way, the end
      // state the caller wants (logged out, clean local state) still
      // happens via the steps below.
    }

    // All three halves of "this browser no longer belongs to that session",
    // through the one door at `./session.ts` (ruling P2-F18) — the durable
    // tables and `localStorage` keys, the query cache, and (Task 8's fix
    // round) whatever `api/events.ts`'s queue still held.
    //
    // The cache reset is not decoration, and it is why the clearing is one
    // call rather than `clearLocalData()` alone. The `me` entry is not the
    // only thing in that cache scoped to the session that is ending:
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
