import type { QueryClient } from '@tanstack/react-query';
import { resetEventQueue } from '../api/events';
import { resetSessionScopedQueries } from '../api/useMe';
import { clearUserContent } from '../db/localStorage';
import { announceSessionUser } from './sessionIdentity';

/**
 * The ONE operation that ends a session's hold on this browser (ruling
 * P2-F18).
 *
 * Before this existed there were two of them, and every auth transition had
 * to remember both:
 *
 *   - `clearLocalData()` (originally `../db/local`, now `clearUserContent()`
 *     in `../db/localStorage` — see "Task 10" below) — the durable half:
 *     every `localStorage` key holding the user's own words (Dexie itself,
 *     and the table clear this used to also perform, are gone with Task 10).
 *   - `resetSessionScopedQueries()` (`../api/useMe`) — the in-memory half:
 *     the module-level `queryClient` in `App.tsx`, which really does hold
 *     user data (`['stats']`, `['course', …]`, every progress-derived entry).
 *
 * Task 8's fix round (Pha 3) added a third, after a review caught this
 * function NOT calling it:
 *
 *   - `resetEventQueue()` (`../api/events`) — the queued-but-unflushed half:
 *     `api/events.ts`'s in-memory `queue`, which can hold up to one flush
 *     interval's worth of heartbeats at the exact moment a session ends.
 *     Unlike the other two, this is NOT durable and NOT React state — it
 *     is a plain module-level array — but it is exactly as much "this
 *     account's data left in the browser" as the other two are, and an
 *     unreset queue leaking into the NEXT signed-in account's session is
 *     the identical failure shape ruling P2-F18 names for the other two
 *     (see `api/events.ts`'s own header and
 *     `test/eventQueueHandoff.test.tsx` for the end-to-end proof this
 *     function's own test suite now pins).
 *
 * Task 11's review finding added a fourth, for the identical reason as the
 * third — a review caught a queue this function did not know about:
 *
 *   - `queryClient.getMutationCache().clear()` — the paused-but-unresumed
 *     half: TanStack Query's default `networkMode: 'online'` (this repo
 *     configures nothing else — `App.tsx`'s `new QueryClient()` is bare)
 *     PAUSES a mutation started while offline rather than failing it, and
 *     auto-resumes every paused mutation the instant `onlineManager` next
 *     reports connectivity — see `@tanstack/query-core`'s
 *     `QueryClient.mount()`, which subscribes to `onlineManager` for
 *     exactly this. A resumed mutation replays through `api/client.ts`'s
 *     `send()`, which always sends `credentials: 'include'` — whatever
 *     cookie is valid AT RESUME TIME, not the account that started the
 *     write. On the one `queryClient` this app ever builds, that account
 *     can by then be somebody else entirely: A goes offline mid-write, the
 *     mutation pauses, A logs out, B signs in, connectivity returns — and
 *     without this, A's paused write reaches the server under B's cookie.
 *     Clearing the cache's tracked mutation set is what makes
 *     `resumePausedMutations()` find nothing to resume (it iterates
 *     `getAll()` on that same set); see `session.test.ts`'s own
 *     "the mutation half" describe block for the account-handoff proof.
 *
 * Every call site happened to be correct once it existed. That is not the point.
 * *"Two truth points, remember to call both"* is the exact SHAPE of the
 * cross-account leak fixed in `97a6e02`, one level up: there, a second store
 * of user content (the note draft in `localStorage`) was opened that the
 * truth point had never heard of, and one reader's private words survived
 * into the next reader's session on a shared browser. `docs/carried-forward.md`
 * warns about the same failure in its inlined form ("there used to be eight
 * hand-copied copies, and the one that mattered most was the easiest to
 * forget"). A pair of functions that must always be called together, with
 * nothing anywhere enforcing it, is that warning with the copies moved from
 * inside one function to across two.
 *
 * **Why here and not in `db/localStorage.ts`.** Merging downward would make
 * the persistence layer import react-query — wrong direction, and it would
 * put a UI-cache concern inside a module whose whole job is a handful of
 * `localStorage` keys. `auth/` is the layer where both dependencies are
 * already at hand and where "a session is ending" is the native vocabulary,
 * so the merge goes UP. (Before Task 10 this also argued from IndexedDB —
 * Dexie is gone now, but the direction-of-import argument stands unchanged.)
 *
 * **What it deliberately does NOT do.** It does not stop any background sync
 * (there is none left to stop as of Task 10 — see that task's report) and it
 * does not seed `me`. Both call sites need the seed, but with different
 * values and, in `useLogout`'s case, after a more elaborate wait this
 * function has no business knowing about (a bounded wait for in-flight
 * mutations, `POST /auth/logout`). It also does not attempt to FLUSH
 * `api/events.ts`'s queue before dropping it — a best-effort flush needs the
 * departing account's cookie to still be valid, which is a fact only
 * `useLogout.ts` (not `Login.tsx`'s arriving-account path, and not this
 * function, called from both) can know; see `useLogout.ts`'s
 * `bestEffortFinalFlush` for where that flush happens, strictly BEFORE this
 * function is ever called. This is the clearing step only — the semantics of
 * clearing are unchanged from the calls it replaces, including their order.
 *
 * **Order, which is load-bearing and is the reason this is one function
 * rather than separate exports.** The durable half first, then the query
 * cache, then the event queue, then the mutation cache. The first two: both
 * call sites already did exactly this before this function existed, for
 * reasons written out at each of them — the durable rows must be gone
 * before anything can read or push them, and the cache reset must land
 * before the caller seeds `me` on the very next line, or it would wipe the
 * seed it is supposed to leave behind. The event-queue and mutation-cache
 * resets are placed last and are, unlike the first two, NOT
 * order-dependent on anything else here — one is a bare in-memory array,
 * the other a `Set` inside `queryClient`'s own `MutationCache`, and neither
 * has a reader racing it or a seed for it to clobber — so both are simply
 * appended after the two steps whose order genuinely matters, rather than
 * interleaved among them. Nothing orders the two of them relative to each
 * other either, for the same reason.
 *
 * (Task 10 note, still true after Task 11: every step this function itself
 * performs is synchronous — `clearUserContent()`,
 * `resetSessionScopedQueries`/`resetEventQueue`, and
 * `getMutationCache().clear()` all were, and are. `clearSession` stays
 * declared `async` purely for interface stability with its existing callers
 * (`await clearSession(queryClient)` at both call sites), not because
 * anything inside it still yields to the event loop.)
 *
 * The tripwire that keeps a third call site from quietly appearing — for
 * the three NAMED halves above (`clearUserContent`,
 * `resetSessionScopedQueries`, `resetEventQueue`) — lives in
 * `./session.test.ts`'s `SESSION_CLEARERS`, next to this function's own
 * tests. `getMutationCache().clear()` is deliberately NOT a fourth entry in
 * that list: it is a plain method call on the `QueryClient` this function
 * is already handed, not an importable function authored elsewhere that a
 * future call site could reach for directly instead of going through here
 * (the way the other three could, and the exact shape `SESSION_CLEARERS`
 * exists to catch). There is nothing to name as a second import site of a
 * TanStack Query built-in.
 */
export async function clearSession(queryClient: QueryClient): Promise<void> {
  // Debt C-1 — the OTHER tabs, told first, synchronously, before either
  // half of the local clearing is attempted.
  //
  // This function's own doc comment says what it deliberately does not do,
  // and this is not an exception to that list: it is not stopping sync and
  // it is not seeding `me` — both of which are decisions about THIS tab
  // that the two call sites make differently. It is the one statement that
  // is identical at both of them and true the moment either runs: *this
  // browser's session is no longer the one it was*. `POST /auth/login` has
  // already replaced the cookie by the time `<Login>` gets here, and
  // `POST /auth/logout` is about to invalidate it in `useLogout`; in both
  // directions every other tab is, from this instant, holding a React tree
  // for an account that is not whose cookie its next request will carry.
  //
  // Announcing `null` rather than the arriving user is not a shortcut. The
  // arriving user is not known here (nor should it be — `useLogout` has no
  // arriving user at all), and it is not needed: what another tab has to
  // learn is that the session it established is gone, and `null` says
  // exactly that without this function pretending to know what replaced it.
  // `api/useMe.ts` announces the concrete identity a moment later, from the
  // one place that actually learns it.
  //
  // Earliest, not merely early — kept true even though the durable clear
  // below is synchronous now (Task 10): another tab's own `postMessage`/
  // event delivery is not, so announcing first still narrows the window as
  // much as client-side code can. It cannot be closed entirely from here;
  // see the report for what would.
  announceSessionUser(null);
  clearUserContent();
  resetSessionScopedQueries(queryClient);
  // Unconditional, and never preceded by an attempted flush HERE — see
  // this function's own "What it deliberately does NOT do" above. Whatever
  // a departing account's queue still holds at this point is dropped,
  // whether or not `useLogout.ts`'s own best-effort flush (which runs
  // strictly before this function, while the cookie was still valid)
  // managed to send it.
  resetEventQueue();
  // Task 11 review finding — the mutation half of the same hazard. A
  // mutation PAUSED by `networkMode: 'online'` (the default; see this
  // function's own doc comment) is not "in flight" in any sense
  // `waitForMutationsToSettle` (`useLogout.ts`) can wait out while offline —
  // it never called `fetch` at all — so it is still sitting in
  // `queryClient`'s mutation cache when this line runs. Emptying that cache
  // is what stops TanStack's own `resumePausedMutations()` (fired the next
  // time `onlineManager` reports connectivity — see `@tanstack/query-core`'s
  // `QueryClient.mount()`) from finding it and replaying it under whatever
  // cookie is valid THEN, which may by that point belong to a different
  // account entirely on this same tab's one `queryClient`.
  queryClient.getMutationCache().clear();
}
