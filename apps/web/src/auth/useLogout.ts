import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { meQueryKey } from '../api/useMe';
import { db } from '../db/local';
import { stopSync, syncOnce } from '../sync/engine';

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
 *     with the flush/clear below and race it.
 *  2. `syncOnce()`, best-effort — one last push+pull WHILE THE SESSION
 *     COOKIE IS STILL VALID (this runs BEFORE step 3 clears it server-side).
 *     This is the "optimistic UI" judgment call extended to logout: a
 *     click on "mark read" writes locally and enqueues instantly, and the
 *     server round trip normally happens within the next 15s tick — but
 *     logging out immediately afterward would otherwise strand that
 *     mutation in an outbox this function is about to clear, silently
 *     losing it forever. Giving it one real chance to reach the server
 *     first — a normal `syncOnce()` failure (network down, 5xx) is
 *     swallowed here exactly like everywhere else this engine's failures
 *     are swallowed (see engine.ts's own doc comments): local state is
 *     still cleared unconditionally afterward.
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
 * data-loss risk in exchange for the hard guarantee that no local row
 * ever survives a logout to leak into the next signed-in session.
 */
export function useLogout(): () => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useCallback(async () => {
    stopSync();

    try {
      await syncOnce();
    } catch {
      // Best-effort — see this hook's own doc comment. Local tables are
      // cleared unconditionally below regardless of the outcome here.
    }

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
