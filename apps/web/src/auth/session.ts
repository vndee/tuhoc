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
 * cache, then the event queue. The first two: both call sites already did
 * exactly this before this function existed, for reasons written out at
 * each of them — the durable rows must be gone before anything can read or
 * push them, and the cache reset must land before the caller seeds `me` on
 * the very next line, or it would wipe the seed it is supposed to leave
 * behind. The event-queue reset is placed last and is, unlike the first two,
 * NOT order-dependent on anything else here — it is a bare in-memory array
 * with no reader racing it and no seed for it to clobber — so it is simply
 * appended after the two steps whose order genuinely matters, rather than
 * interleaved among them.
 *
 * (Task 10 note: every step this function itself performs is now
 * synchronous — `clearUserContent()`, the offline marker's own clear below,
 * and `resetSessionScopedQueries`/`resetEventQueue` were always synchronous.
 * `clearSession` stays declared `async` purely for interface stability with
 * its existing callers (`await clearSession(queryClient)` at both call
 * sites), not because anything inside it still yields to the event loop.
 * See the offline-marker section below for why that is a safety property,
 * not just a simplification.)
 *
 * The tripwire that keeps a third call site from quietly appearing — for
 * ANY of the three halves above, `resetEventQueue()` included — lives in
 * `./session.test.ts`, next to this function's own tests.
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
  clearSessionVerifiedMarker();
  resetSessionScopedQueries(queryClient);
  // Unconditional, and never preceded by an attempted flush HERE — see
  // this function's own "What it deliberately does NOT do" above. Whatever
  // a departing account's queue still holds at this point is dropped,
  // whether or not `useLogout.ts`'s own best-effort flush (which runs
  // strictly before this function, while the cookie was still valid)
  // managed to send it.
  resetEventQueue();
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
 * only whatever this session already has, on-screen or in this tab's own
 * caches, which anybody with the browser profile can already see regardless.
 * A device whose clock is moved backwards can also make a stale marker look
 * fresh; that is acceptable for the same reason, and worth saying out loud
 * rather than pretending the timestamp is doing more than it is.
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
 * marker is a `localStorage` key that `clearSession()` (this file) erases
 * on both auth transitions — see `SESSION_VERIFIED_KEY` below.
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

/* ------------------------------------------------------------------ *
 * The offline-read marker — moved here from `db/local.ts` by Task 10
 * ------------------------------------------------------------------ */

/**
 * `localStorage` key holding the last instant `GET /me` confirmed a
 * signed-in user ON THIS DEVICE, ISO-8601.
 *
 * Task 10 (Dexie removal) moved this here from `db/local.ts`'s Dexie
 * `db.meta` table — the table, and Dexie itself, are gone. `localStorage`
 * is the only durable store this app still has.
 *
 * **Why this lives here, in `auth/session.ts`, and NOT as a fourth
 * classified key in `db/localStorage.ts`.** `USER_CONTENT_KEYS` and
 * `DEVICE_PREFERENCE_KEYS` are a closed, two-way classification for exactly
 * two questions: "is this the user's own words" and "does this describe the
 * device, not the person" (see that file's own doc comments). This marker
 * answers NEITHER — it holds no content and describes no lasting
 * preference; it is per-SESSION state that must be erased at the exact same
 * moment `clearUserContent()` runs, by the exact same caller
 * (`clearSession()`, below). Bolting a third category onto that union would
 * either misclassify it (surviving a logout it must not survive, or being
 * wiped alongside notes it has nothing to do with) or force
 * `db/localStorage.ts` to learn about session lifecycle, which is a UI/auth
 * concern, not a persistence concern — the same "merge goes UP, not DOWN"
 * argument `clearSession()`'s own doc comment makes for why IT lives here
 * and not in the persistence layer. `localStorage.test.ts`'s `PERSISTENCE`
 * scan documents this file as the one allowed exception to "only
 * `db/localStorage.ts` touches `localStorage` directly", by name, with this
 * same reasoning.
 *
 * It exists for exactly one reader: `<RequireAuth>`, on a COLD page load
 * with no network. The session cookie is `HttpOnly`, so `GET /me` is the
 * only way this app can learn whether anybody is signed in — and when that
 * request never reaches a server, the honest answer is "unknown", not
 * "logged out".
 *
 * **It holds NO identity — an instant, nothing else.** Not a user id, not
 * an email, not a name. That is what keeps the worst case cheap: even a row
 * that somehow outlived its session can only say *somebody* was signed in
 * here at T, so there is nothing in it to render at the next person.
 */
export const SESSION_VERIFIED_KEY = 'sessionVerifiedAt';

/**
 * Records that `GET /me` just confirmed a signed-in user here.
 *
 * `at` is injectable for tests only; production always means "now".
 *
 * Declared `async` and returning `Promise<void>` for interface stability
 * with its one caller (`RequireAuth.tsx`'s `void rememberSessionVerified()`)
 * and its tests (`await rememberSessionVerified(...)`) — the write itself is
 * a single synchronous `localStorage.setItem`, with no `await` anywhere in
 * this function's own body. That is not incidental. `db/local.ts`'s
 * original version of this function carried a generation-counter guard
 * (`clearGeneration`) specifically because `db.meta.put(...)` was an
 * asynchronous Dexie transaction: a `clearLocalData()` call could start and
 * finish WHILE that transaction was still committing, and the write would
 * land after the clear had already declared the browser empty, resurrecting
 * a stale marker. That guard is deliberately NOT carried over here — not
 * dropped for tidiness, but because the exact race it defended against is
 * now structurally impossible: a synchronous `localStorage.setItem` call
 * cannot be interrupted mid-write by anything else on this single thread,
 * and `clearSessionVerifiedMarker()` below is equally synchronous, so
 * neither can ever observe the other mid-flight. See this task's report for
 * the fuller argument and for the one race this does NOT close (the
 * ordering between two independent event-loop callbacks — "GET /me's effect
 * fires" versus "the user clicked logout" — which no storage backend can
 * close from inside either callback alone, and which the OLD guard did not
 * close either).
 */
export async function rememberSessionVerified(at: Date = new Date()): Promise<void> {
  writeSessionVerifiedMarker(at.toISOString());
}

/**
 * The marker as a parsed instant, or `null` for "this device has no such
 * marker" — which includes a row whose value does not parse.
 *
 * Unparseable reads as absent rather than as `NaN`: every comparison
 * against `NaN` is `false`, so the caller would still fail closed, but by
 * accident. `null` makes the safe answer the deliberate one.
 *
 * Declared `async` for the same interface-stability reason as
 * `rememberSessionVerified` above (its one caller, `offlineSessionIsUsable`,
 * already `await`s it, as does `RequireAuth.test.tsx`) — the read itself is
 * synchronous.
 */
export async function readSessionVerifiedAt(): Promise<number | null> {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SESSION_VERIFIED_KEY);
  } catch {
    // Best-effort, same as `db/localStorage.ts`'s `readLocalStorage`: a
    // browser that refuses storage entirely reads back as "no marker",
    // which is the fail-closed answer anyway.
    raw = null;
  }
  if (raw === null) return null;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : at;
}

/** The one write path both `rememberSessionVerified` and `clearSessionVerifiedMarker` funnel through — kept as one place so both share the identical best-effort try/catch. */
function writeSessionVerifiedMarker(value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(SESSION_VERIFIED_KEY);
    else window.localStorage.setItem(SESSION_VERIFIED_KEY, value);
  } catch {
    // Best-effort: a browser that refuses storage never had offline reading
    // to begin with, and never had anything of this marker to clear either.
  }
}

/**
 * Erases the marker — called from `clearSession()` above, unconditionally,
 * on both auth transitions. Not exported: nothing outside this file's own
 * `clearSession()` needs to clear it in isolation, and exporting it would
 * be a second, unenforced way for a future call site to bypass the one
 * door — the exact shape `SESSION_CLEARERS`' tripwire (`session.test.ts`)
 * exists to close for the other three halves.
 */
function clearSessionVerifiedMarker(): void {
  writeSessionVerifiedMarker(null);
}
