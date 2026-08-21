import type { QueryClient } from '@tanstack/react-query';
import { resetSessionScopedQueries } from '../api/useMe';
import { clearLocalData, readSessionVerifiedAt } from '../db/local';

/**
 * The ONE operation that ends a session's hold on this browser (ruling
 * P2-F18).
 *
 * Before this existed there were two of them, and every auth transition had
 * to remember both:
 *
 *   - `clearLocalData()` (`../db/local`) — the durable half: every Dexie
 *     table plus every `localStorage` key holding the user's own words.
 *   - `resetSessionScopedQueries()` (`../api/useMe`) — the in-memory half:
 *     the module-level `queryClient` in `App.tsx`, which really does hold
 *     user data (`['stats']`, `['course', …]`, every progress-derived entry).
 *
 * Both call sites happened to be correct. That is not the point.
 * *"Two truth points, remember to call both"* is the exact SHAPE of the
 * cross-account leak fixed in `b708620`, one level up: there, a second store
 * of user content (the note draft in `localStorage`) was opened that the
 * truth point had never heard of, and one reader's private words survived
 * into the next reader's session on a shared browser. `docs/carried-forward.md`
 * warns about the same failure in its inlined form ("there used to be eight
 * hand-copied copies, and the one that mattered most was the easiest to
 * forget"). A pair of functions that must always be called together, with
 * nothing anywhere enforcing it, is that warning with the copies moved from
 * inside one function to across two.
 *
 * **Why here and not in `db/local.ts`.** Merging downward would make the
 * persistence layer import react-query — wrong direction, and it would put a
 * UI-cache concern inside the module whose whole job is IndexedDB. `auth/` is
 * the layer where both dependencies are already at hand and where "a session
 * is ending" is the native vocabulary, so the merge goes UP.
 *
 * **What it deliberately does NOT do.** It does not `stopSync()` and it does
 * not seed `me`. Both call sites need those, but they need them with
 * different values and, in `useLogout`'s case, in a more elaborate order that
 * this function has no business knowing (a bounded final flush, two epoch
 * bumps, `POST /auth/logout`). This is the clearing step only — the semantics
 * of clearing are unchanged from the two calls it replaces, including their
 * order.
 *
 * **Order, which is load-bearing and is the reason this is one function
 * rather than two exports.** `clearLocalData()` first and awaited, then the
 * query cache. Both call sites already did exactly this, for reasons written
 * out at each of them: the durable rows must be gone before anything can read
 * or push them, and the cache reset must land before the caller seeds `me` on
 * the very next line, or it would wipe the seed it is supposed to leave
 * behind.
 *
 * The tripwire that keeps a third call site from quietly appearing lives in
 * `./session.test.ts`, next to this function's own tests.
 */
export async function clearSession(queryClient: QueryClient): Promise<void> {
  await clearLocalData();
  resetSessionScopedQueries(queryClient);
}

/**
 * How long after the last confirmed `GET /me` this device may still open a
 * protected page **while the server cannot be reached at all**. Seven days.
 *
 * Where the number comes from, and what it is not:
 *
 *  - **The ceiling.** `apps/api/internal/auth/usecase.go`'s
 *    `SessionTTL = 30 * 24 * time.Hour`, and it does NOT slide —
 *    `Repo.FindValidSession` filters on `expires_at > now()` and never
 *    moves it. So the cookie this device is standing in for is worthless
 *    at most 30 days after the login that created it. A window anywhere
 *    near that would let a device keep opening the reader long after the
 *    session it is impersonating had died, which is the one thing an
 *    optimistic render must not be allowed to do indefinitely.
 *  - **The floor.** The feature has to survive a real stretch of no
 *    network: a long flight, a trip, a week of bad connectivity. A window
 *    of hours would make "reading offline" a promise the app breaks
 *    exactly when it is needed.
 *
 * **It is a decay policy, not a security boundary, and it must not be read
 * as one.** The real boundary is the server: nothing behind this door is
 * fetched — every API call is failing, which is the precondition for being
 * here at all — so what an expired-but-unexpired-looking device can open is
 * only what is already on its own disk, which anybody with the browser
 * profile can read out of IndexedDB regardless. A device whose clock is
 * moved backwards can also make a stale marker look fresh; that is
 * acceptable for the same reason, and worth saying out loud rather than
 * pretending the timestamp is doing more than it is.
 *
 * The window is also not the usual way this ends. The normal end is the
 * next HTTP response of any kind: a 401 sends the reader to `/login`
 * immediately, whatever the marker says (see `RequireAuth`).
 */
export const OFFLINE_READ_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * May this device render a protected page on its own authority, right now?
 *
 * True only when `GET /me` confirmed a signed-in user here recently enough
 * — where "here" means this browser's current local session, because the
 * marker is a `db.meta` row that `clearLocalData()` empties on both auth
 * transitions (see `SESSION_VERIFIED_KEY` in `db/local.ts`).
 *
 * `now` is injectable for tests only.
 *
 * A marker stamped in the FUTURE is refused rather than trusted: it means
 * the clock moved between the write and this read, and the only two
 * readings of that are "the clock is wrong now" and "it was wrong then".
 * Neither is a reason to open a door, and refusing is the direction that
 * fails closed.
 *
 * The caller must have established that no HTTP response arrived before
 * asking — see `serverAnswered` in `api/client.ts`. This function answers
 * "what does the device believe", never "is the session valid"; only the
 * server can answer the second, and when it does, its answer wins.
 */
export async function offlineSessionIsUsable(now: number = Date.now()): Promise<boolean> {
  const verifiedAt = await readSessionVerifiedAt();
  if (verifiedAt === null) return false;
  const age = now - verifiedAt;
  return age >= 0 && age < OFFLINE_READ_MAX_AGE_MS;
}
