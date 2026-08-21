import type { QueryClient } from '@tanstack/react-query';
import { resetSessionScopedQueries } from '../api/useMe';
import { clearLocalData } from '../db/local';

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
