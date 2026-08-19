import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { meQueryKey } from '../api/useMe';
import { db } from '../db/local';
import { stopSync, syncOnce, waitForInFlight } from '../sync/engine';

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
 */
async function bestEffortFinalFlush(): Promise<void> {
  await waitForInFlight();
  await syncOnce();
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
 *     still in flight at this exact moment (see step 2) discard its
 *     eventual local write rather than apply it — see the paragraph below
 *     ("The race this hook used to have") for why that matters on its own,
 *     independent of step 2's best-effort wait.
 *  2. `bestEffortFinalFlush()` — waits for anything already in flight, then
 *     attempts its own push+pull, bounded to `LOGOUT_SYNC_TIMEOUT_MS` total
 *     (Minor finding: a hung connection must not hold the logout UI
 *     hostage). A normal failure (network down, 5xx, or simply timing out)
 *     is swallowed by `withTimeout`/`syncOnce`'s own existing swallowing —
 *     local state is still cleared unconditionally afterward regardless.
 *  3. `POST /auth/logout` — invalidates the session server-side and clears
 *     the cookie. A failure here (network error; the endpoint itself is
 *     designed to always return 200 even for an already-dead session — see
 *     `Logout`'s own doc comment) does NOT stop the steps below: the one
 *     outcome this function must never allow is leaving another account's
 *     data behind in this browser's IndexedDB just because the network
 *     blipped on the way out.
 *  4. Clear every local table (`progress`, `annotations`, `outbox`,
 *     `meta`) — unconditionally, regardless of whether steps 2 or 3
 *     succeeded. See the paragraph below for why this is the right
 *     trade-off, not just the safe-looking one.
 *  5. Reset the shared `me` query to `null` and navigate to `/login`.
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

    try {
      await api.post('/auth/logout', undefined, { redirectOn401: false });
    } catch {
      // Network failure or an already-dead session — either way, the end
      // state the caller wants (logged out, clean local state) still
      // happens via the steps below.
    }

    await Promise.all([db.progress.clear(), db.annotations.clear(), db.outbox.clear(), db.meta.clear()]);

    queryClient.setQueryData(meQueryKey, null);
    navigate('/login', { replace: true });
  }, [queryClient, navigate]);
}
