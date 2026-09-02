/**
 * Which account this BROWSER belongs to — not which account this TAB thinks
 * it belongs to. Debt C-1 (`docs/carried-forward.md` §1).
 *
 * **The bug this closes, stated as the harm rather than as the mechanism.**
 * Every signal this app had for "who is signed in" was per-tab: `useMe`'s
 * TanStack cache (`staleTime: 60_000`), `<Login>`'s `<Navigate>` guard, and
 * the sync engine's module state (`timer`, `inFlight`, `syncEpoch`). The
 * session cookie is not: it is one value per origin, shared by every tab.
 * So with tab 2 open on A's reader and tab 1 signing in as B, tab 2 kept
 * running its 15-second cycle against a cookie that now belonged to B — and
 * `POST /sync` carried A's queued progress and A's notes into B's server
 * account, while `GET /sync` pulled B's rows down into a local database tab 2
 * still renders as A's. Nothing in the app noticed, and nothing told either
 * person.
 *
 * **What this module is.** One fact — the last session identity this browser
 * announced — plus the bus that carries it between tabs. It holds no user
 * data and nothing durable: see "Why nothing is persisted" below.
 *
 * **Why `BroadcastChannel` and not `localStorage` + the `storage` event.**
 * The `storage` fallback is the textbook answer and it is not available here,
 * for a reason worth writing down rather than rediscovering: `apps/web/src`
 * production code may not touch `localStorage` at all. `db/local.test.ts`'s
 * "no third place for user data to hide" scan walks every non-test source
 * file with the TypeScript AST and fails on any reference to `localStorage`,
 * `sessionStorage`, `indexedDB`, `caches` or `document.cookie` outside
 * `db/local.ts` — because a store `clearLocalData()` has never heard of is
 * precisely how a reader's half-typed note once survived into the next
 * reader's session. Routing a session-identity key through that registry
 * would mean classifying it as user content (so `clearLocalData()` would
 * delete the very fact tabs need to compare against) or as a device
 * preference (so it would outlive every account on the machine). Neither is
 * what this is. `BroadcastChannel` is not persistence — nothing survives the
 * tab — so it sits outside that rule honestly rather than by exemption.
 *
 * **Why nothing is persisted, positively.** The question a tab has to answer
 * is not "who is signed in" — only the server can answer that, and
 * `RequireAuth`/`useMe` already ask it. It is "has the session changed out
 * from under me SINCE I started syncing", which is a statement about this
 * tab's lifetime and needs no storage at all.
 *
 * **The degraded case, named out loud.** Where `BroadcastChannel` does not
 * exist the bus is a no-op and this file buys nothing — the behaviour is
 * exactly today's. Baseline support is Chrome 54, Firefox 38, Safari 15.4
 * (2022), so this is the ancient-browser tail, not a live path; it is stated
 * because a security fix whose failure mode is silence has to say where its
 * silence lives.
 */

/**
 * The bus name. Origin-scoped by the platform, which is exactly the scope
 * wanted: the session cookie is origin-scoped too, so the set of tabs that
 * can hear each other is the same set of tabs that share a cookie jar.
 */
const CHANNEL_NAME = 'tuhoc-session-identity';

/**
 * What travels between tabs. `v` is here so a future shape change can be
 * ignored rather than misread by a tab still running the old bundle — a
 * cross-tab message is the one place in this app where two DIFFERENT
 * versions of the code are genuinely live at the same time (an old tab left
 * open across a deploy).
 */
interface SessionAnnouncement {
  readonly v: 1;
  readonly user: string | null;
}

/**
 * Who THIS tab last established this browser belongs to: a user id, `null`
 * for "nobody", or `undefined` for "this tab has not found out yet".
 *
 * `undefined` is a third state on purpose, not an accident of initialization.
 * A tab that has never learned the identity must not treat the first
 * announcement it overhears as a CHANGE — there was nothing to change from.
 */
let localUser: string | null | undefined;

/**
 * Set when another tab announced a session that is not the one this tab
 * established. It is one-way: nothing but a fresh local announcement (a
 * `GET /me` answering, or an auth transition going through
 * `auth/session.ts`) clears it.
 *
 * A boolean rather than "compare identities on demand" because the comparison
 * has to be made at the moment the announcement ARRIVES, against what this
 * tab believed THEN. Deciding it later, from whatever the two values have
 * drifted to, is how this kind of guard ends up green for a reason nobody
 * chose.
 */
let superseded = false;

type SessionListener = () => void;
const listeners = new Set<SessionListener>();

/**
 * The channel, created on first use. `null` means the platform has none (see
 * the degraded case in this module's own doc comment); `undefined` means it
 * has not been asked for yet.
 */
let bus: BroadcastChannel | null | undefined;

function isAnnouncement(data: unknown): data is SessionAnnouncement {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as { v?: unknown; user?: unknown };
  if (candidate.v !== 1) return false;
  return candidate.user === null || typeof candidate.user === 'string';
}

/**
 * Handles an announcement made by ANOTHER tab.
 *
 * `BroadcastChannel` never delivers a message back to the channel object
 * that posted it, so "another tab" is guaranteed by the platform rather than
 * by a tab id this module would otherwise have to invent and trust. That is
 * also what makes the tab performing an auth transition immune to its own
 * announcement — it calls `stopSync()`/`startSync()` explicitly and must not
 * be told by this module that its own login was somebody else's.
 */
function receive(data: unknown): void {
  if (!isAnnouncement(data)) return;
  if (localUser === undefined) {
    // Nothing to contradict: adopt it. A tab in this state has no signed-in
    // user yet, so it has no sync loop running either.
    localUser = data.user;
    return;
  }
  if (data.user === localUser) return;
  superseded = true;
  notifyListeners();
}

function notifyListeners(): void {
  // Copied before iterating: a listener may unsubscribe itself in response
  // (the sync engine's does exactly that, via `stopSync()`).
  for (const listener of [...listeners]) listener();
}

function channel(): BroadcastChannel | null {
  if (bus !== undefined) return bus;
  if (typeof BroadcastChannel === 'undefined') {
    bus = null;
    return bus;
  }
  const created = new BroadcastChannel(CHANNEL_NAME);
  created.addEventListener('message', (event) => {
    receive((event as MessageEvent).data);
  });
  bus = created;
  return bus;
}

/**
 * Tells every other tab that this browser's session now belongs to `user`
 * (`null` = nobody).
 *
 * Called from the two places that learn it, and only those:
 *
 *   - `api/useMe.ts` — both when `GET /me` answers (the server's own word,
 *     on every cold load and every refetch) and when a transition seeds the
 *     `me` cache without a request.
 *   - `auth/session.ts`'s `clearSession()` — the one door both auth
 *     transitions already go through, announcing `null` the instant the
 *     previous session stops being this browser's. That is the EARLIEST
 *     honest signal available: it lands between `POST /auth/login` returning
 *     (the moment the cookie is replaced) and the new `me` being seeded, so
 *     the window in which another tab could still push under the wrong
 *     cookie is as narrow as client-side code can make it.
 *
 * A no-op when nothing changed, so the ordinary case — every tab's `useMe`
 * refetching the same user every minute — puts nothing on the bus.
 */
export function announceSessionUser(user: string | null): void {
  if (localUser === user) return;
  localUser = user;
  // This tab has just established, first-hand, who this browser belongs to.
  // Whatever another tab said before is no longer news.
  superseded = false;
  channel()?.postMessage({ v: 1, user } satisfies SessionAnnouncement);
  notifyListeners();
}

/**
 * Has another tab replaced the session this tab established?
 *
 * The sync engine asks this SYNCHRONOUSLY, immediately before every cycle,
 * rather than relying on having been notified. The two are not the same
 * guarantee: a notification is an event that has to be delivered, and a guard
 * that only works when its event arrives is a guard whose failure mode is
 * silence. Reading a boolean cannot miss.
 */
export function sessionWasSuperseded(): boolean {
  return superseded;
}

/**
 * Whose session this tab has ESTABLISHED, first-hand: a user id, `null` for
 * "nobody", or `undefined` for "this tab has not found out yet".
 *
 * Not the same question as `sessionWasSuperseded()`, and the difference is
 * the whole reason both exist. Supersession is a statement about an EVENT
 * (somebody else took the browser while I was collecting); this is a
 * statement about a FACT that outlives that event (who I believe the
 * browser belongs to right now). A tab that is told it was superseded and
 * then re-establishes the identity itself — the ordinary case: an unfocused
 * tab refocuses, `useMe` refetches, `GET /me` answers B — has
 * `sessionWasSuperseded()` back to `false` and this value changed from A to
 * B. Anything that COLLECTED data under A must be able to notice the second
 * thing after the first has stopped being visible; see `api/events.ts`'s
 * `queueOwner`, which stamps its queue with this value for exactly that
 * reason.
 *
 * Deliberately returns the raw three-state value rather than collapsing
 * `undefined` into `null`: "nobody is signed in" and "this tab does not
 * know yet" must not compare equal, or a queue stamped before the first
 * `GET /me` answered would look like it belonged to a logged-out browser.
 */
export function establishedSessionUser(): string | null | undefined {
  return localUser;
}

/**
 * Runs `listener` when another tab announces a session change. Returns the
 * unsubscribe.
 *
 * The listener is told THAT something happened, not what: it is expected to
 * call `sessionWasSuperseded()` itself, so the notified path and the polled
 * path read the identical fact rather than two values that can disagree.
 */
export function subscribeToSessionChanges(listener: SessionListener): () => void {
  channel(); // start listening even if nothing has announced yet
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Test-only reset: drops this tab's belief, its supersession flag and its
 * channel, so one test file can stand up several independent "tabs" without
 * inheriting the previous test's bus.
 *
 * Production code never calls this — there is no moment in a real tab's life
 * when forgetting who this browser belongs to is the right thing to do.
 */
export function __resetSessionIdentityForTests(): void {
  localUser = undefined;
  superseded = false;
  listeners.clear();
  bus?.close();
  bus = undefined;
}
