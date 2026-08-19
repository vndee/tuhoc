import { api, ApiError } from '../api/client';
import { db, mergeRow, type AnnotationRow, type OutboxEntry, type ProgressRow } from '../db/local';

/** Task brief's binding interval — see engine's own doc comment on `startSync`. */
const SYNC_INTERVAL_MS = 15_000;

/** `db.meta`'s single row key for the opaque cursor `GET /sync` hands back. */
const CURSOR_KEY = 'syncCursor';

/** Shape of `GET /sync`'s response body — see apps/api/internal/sync/handler.go's `pullResponse`. */
interface PullResponse {
  progress: ProgressRow[];
  annotations: AnnotationRow[];
  cursor: string;
}

/** Shape of `POST /sync`'s response body — apps/api/internal/sync/handler.go's `pushResponse`. Only `applied` exists; the engine does not currently act on the count, but the shape is documented here so a future caller doesn't have to rediscover it. */
interface PushResponse {
  applied: number;
}

// ---------------------------------------------------------------------------
// Module-level state for the timer + listener startSync()/stopSync() own,
// and the in-flight guard that prevents two overlapping cycles from
// double-sending the outbox (see runCycle's doc comment). All three are
// intentionally plain module state, not a class: this engine has exactly
// one instance for the whole app (one IndexedDB database, one session),
// so there is nothing a class would buy beyond what a module already
// gives for free.
// ---------------------------------------------------------------------------
let timer: ReturnType<typeof setInterval> | undefined;
let onlineListener: (() => void) | undefined;
let inFlight = false;

function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/**
 * Pushes the outbox's queued mutations to the server and, for each
 * sub-batch that is confirmed applied, deletes exactly those entries.
 *
 * Two separate HTTP calls, because the two write endpoints are separate
 * on the wire (`POST /sync` for progress+annotations, `POST /events/batch`
 * for events — see the task brief's server contract) and are handled
 * independently: a failure in one must not block or roll back the other,
 * since they are unrelated resources server-side with unrelated failure
 * modes (e.g. a malformed event should never block a valid progress
 * write from landing).
 *
 * `rows` is snapshotted via `toArray()` ONCE, before either request goes
 * out, and only the `seq`s present in that snapshot are ever deleted.
 * This matters: `setProgress` (or a future annotation/event write) can
 * add a NEW outbox entry while a flush's `await` is still pending on the
 * network. If deletion instead cleared "whatever is in the outbox right
 * now" after the request resolves, that new entry — never actually
 * sent — would be deleted anyway and its mutation permanently lost. By
 * deleting only the snapshotted `seq`s, a mutation queued mid-flush
 * survives untouched and is picked up by the NEXT cycle instead.
 *
 * Returns `false` the moment a 401 is observed on either call, which
 * tells `runCycle` to abort the rest of this cycle (see its doc comment
 * for why). Any other failure (network error, 5xx, 429) is swallowed
 * here: the corresponding outbox entries are simply left in place to be
 * retried on the next cycle. This is safe to retry unboundedly because
 * the server's conflict rule is idempotent — replaying a batch that was
 * already durably applied (or applying it for the first time after a
 * response got lost in transit) always converges to the same state; see
 * `mergeRow`'s doc comment and apps/api/internal/sync/usecase.go's
 * `Push` for the server-side half of that guarantee.
 */
async function flushOutbox(): Promise<boolean> {
  const rows = await db.outbox.toArray();

  const isProgressOrAnnotation = (r: OutboxEntry) => r.table === 'progress' || r.table === 'annotations';
  const progressRows = rows.filter((r) => r.table === 'progress').map((r) => r.row);
  const annotationRows = rows.filter((r) => r.table === 'annotations').map((r) => r.row);
  const eventRows = rows.filter((r) => r.table === 'events').map((r) => r.row);

  if (progressRows.length > 0 || annotationRows.length > 0) {
    try {
      await api.post<PushResponse>('/sync', { progress: progressRows, annotations: annotationRows });
      const seqs = rows.filter(isProgressOrAnnotation).map((r) => r.seq as number);
      await db.outbox.bulkDelete(seqs);
    } catch (err) {
      if (isAuthError(err)) return false;
      // network failure / 5xx / 429 — leave these entries queued, retry next cycle.
    }
  }

  if (eventRows.length > 0) {
    try {
      await api.post<{ accepted: number }>('/events/batch', { events: eventRows });
      const seqs = rows.filter((r) => r.table === 'events').map((r) => r.seq as number);
      await db.outbox.bulkDelete(seqs);
    } catch (err) {
      if (isAuthError(err)) return false;
    }
  }

  return true;
}

/**
 * Reads the locally stored cursor (empty string if this device has never
 * synced), passes it back to the server VERBATIM as `?since=`, merges
 * every returned row into Dexie via `mergeRow`, and stores the new
 * cursor the server hands back — also verbatim, never derived from the
 * rows themselves.
 *
 * The cursor is treated as opaque everywhere in this function: it is
 * read as a string, sent as a string, and stored as a string. Nothing
 * here parses it, computes a `max(updatedAt)` from the response, or
 * "improves" on what the server sent — see the task brief's cursor rule
 * for why doing so would silently reintroduce the exact data-loss bug
 * the server-side safety lag exists to close (apps/api/internal/sync/
 * usecase.go's `Pull` doc comment has the full mechanism).
 *
 * A consequence of that lag: most polls re-deliver a few rows this
 * device already applied. That is entirely expected, not a bug on
 * either side of the wire — `mergeRow` is idempotent by construction
 * (strictly-greater `updatedAt` wins; a tie changes nothing), so
 * re-applying an already-current row via `.put()` is a no-op in every
 * way that's observable: same primary key, same field values.
 *
 * Swallows a 401 or any other failure the same way `flushOutbox` does —
 * the cursor and local state are simply left as they were, retried next
 * cycle.
 */
async function pull(): Promise<void> {
  const cursorRow = await db.meta.get(CURSOR_KEY);
  const since = cursorRow?.value ?? '';
  const query = since === '' ? '' : `?since=${encodeURIComponent(since)}`;

  let resp: PullResponse;
  try {
    resp = await api.get<PullResponse>(`/sync${query}`);
  } catch {
    return;
  }

  await db.transaction('rw', db.progress, db.annotations, db.meta, async () => {
    for (const incoming of resp.progress) {
      const existing = await db.progress.get([incoming.courseId, incoming.chapterId, incoming.status]);
      await db.progress.put(mergeRow(existing, incoming));
    }
    for (const incoming of resp.annotations) {
      const existing = await db.annotations.get(incoming.id);
      await db.annotations.put(mergeRow(existing, incoming));
    }
    await db.meta.put({ key: CURSOR_KEY, value: resp.cursor });
  });
}

/**
 * Runs exactly one push-then-pull cycle, guarded against overlap.
 *
 * Overlap guard: the 15s timer can fire while a previous cycle is still
 * waiting on a slow network, and the `online` event can fire at the same
 * moment (e.g. the network comes back right as a tick lands) — both call
 * this same function. Without a guard, two concurrent calls would both
 * read the SAME outbox snapshot (the first hasn't deleted anything yet)
 * and both POST it, double-sending every queued mutation. The module-
 * level `inFlight` flag makes a second call, arriving while one is
 * already running, a pure no-op: it returns immediately rather than
 * queuing up behind the first (there is nothing useful to gain from
 * running twice in a row the instant the first cycle finishes — the next
 * scheduled tick or `online` event will pick up whatever changed).
 *
 * Online gating: `navigator.onLine === false` skips the cycle entirely
 * rather than letting `fetch` fail as its own kind of "no-op" — this
 * avoids firing (and immediately failing) pointless requests while the
 * device is known to be offline, though the flush/pull logic is already
 * safe either way (a network failure inside them is swallowed exactly
 * like an explicit offline skip).
 *
 * Ordering: flush always completes before pull begins, matching the
 * task brief's literal ordering. The server's LWW rule makes the reverse
 * order safe too — pulling first, then pushing a locally-queued mutation
 * that a fresher server row has since superseded, would just make that
 * push a no-op (applied:0) rather than corrupt anything — but push-first
 * is still the better choice: it gets this device's own edits visible to
 * other devices sooner, and it means a pull immediately afterward is
 * pulling a server state that already reflects what THIS device just
 * sent, rather than needing yet another cycle to reconcile it.
 *
 * Auth gating: neither `flushOutbox` nor `pull` passes
 * `redirectOn401: false`, so a 401 from either uses the api client's
 * DEFAULT behavior — a hard `window.location` redirect to `/login` (see
 * src/api/navigation.ts's `redirectToLogin`, whose own doc comment
 * explicitly names this engine as its reason for existing). This is a
 * deliberate choice, not an oversight: `startSync` only ever runs inside
 * an already-authenticated app shell (every route that would host it is
 * wrapped in `<RequireAuth>` — see Task 12's ruling in progress.md), so
 * a 401 here means the SAME session that used to work just died — not
 * "nobody was ever logged in" the way GET /me's own 401 is. Continuing
 * to poll every 15s against a dead session forever, silently piling up
 * an ever-growing outbox that can never flush, is worse than the hard
 * reload: the reload is what every other 401 in this codebase already
 * does, and it is what actually gets the user back to a working state
 * (log in again). `flushOutbox` returns `false` the moment it observes a
 * 401, which this function uses to skip `pull` entirely rather than
 * firing (and redirect-triggering) a second, redundant request while
 * navigation is already underway.
 *
 * Unexpected-failure containment: `flushOutbox` and `pull` each catch
 * their own network/HTTP failures internally (see their doc comments) —
 * but neither wraps EVERY line in a try/catch, specifically the Dexie
 * calls that aren't expected to fail in ordinary operation
 * (`db.outbox.toArray()` at the top of `flushOutbox`, and the merge
 * `db.transaction(...)` block in `pull`). IndexedDB can still throw
 * there for reasons this engine's network/auth handling was never meant
 * to anticipate — quota exceeded, a blocked version upgrade, an aborted
 * transaction. The `catch` below exists for exactly that residual case:
 * this function is invoked from a bare `setInterval` callback and a bare
 * `online` listener (see `startSync`), neither of which attaches a
 * `.catch()`, so anything that escapes past this point becomes an
 * unhandled promise rejection in a component whose entire job is to run
 * unattended for hours. Swallowing (and logging) it here is the same
 * defensive posture already applied to the 401 case, generalized to
 * "any" failure instead of just the one this engine specifically knows
 * how to interpret. Crucially, nothing is deleted from the outbox and no
 * cursor is written unless the corresponding network call already
 * succeeded (see `flushOutbox`/`pull`), so a cycle that fails here
 * leaves the outbox and cursor exactly as they were — the next cycle
 * retries cleanly, same as any other failure mode this engine tolerates.
 */
async function runCycle(): Promise<void> {
  if (inFlight) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  inFlight = true;
  try {
    const flushedWithoutAuthFailure = await flushOutbox();
    if (!flushedWithoutAuthFailure) return;
    await pull();
  } catch (err) {
    console.error('tuhoc sync: cycle failed unexpectedly', err);
  } finally {
    inFlight = false;
  }
}

/**
 * Runs one full sync cycle (flush outbox, then pull) on demand. This is
 * the same function `startSync`'s timer and `online` listener both call
 * — exported directly so callers (and tests) can trigger a deterministic
 * cycle without waiting on a 15s timer or synthesizing a browser event.
 */
export async function syncOnce(): Promise<void> {
  await runCycle();
}

/**
 * Starts the background sync loop: one cycle immediately-scheduled every
 * 15 seconds, plus one on every `online` event (the moment connectivity
 * returns is exactly when queued-while-offline mutations should flush,
 * without waiting up to 15s for the next tick).
 *
 * Idempotent: calling this again while already running is a no-op rather
 * than stacking a second interval/listener — that would silently double
 * every cycle's request rate without any caller-visible signal that it
 * happened (e.g. React's StrictMode double-invoking an effect in dev, or
 * a caller that doesn't carefully track whether it already started this
 * once).
 *
 * Registers exactly one `setInterval` and one `window` `online` listener,
 * both of which `stopSync` releases — see its doc comment for why this
 * pairing exists despite the task brief only naming `startSync`.
 */
export function startSync(): void {
  if (timer !== undefined) return;
  timer = setInterval(() => {
    void runCycle();
  }, SYNC_INTERVAL_MS);
  onlineListener = () => {
    void runCycle();
  };
  window.addEventListener('online', onlineListener);
}

/**
 * Releases everything `startSync` registered: the interval timer and the
 * `online` listener. Not part of the task brief's literal interface list
 * (which only names `startSync(): void`), but required by the task's own
 * teardown requirement — without a way to release them, every test that
 * calls `startSync` leaks a live timer + listener into every subsequent
 * test in the same process (jsdom's `window` is shared per test FILE,
 * not per test), and a real app hot-reloading this module would
 * accumulate one more of each on every reload. Safe to call when nothing
 * is running (both branches are no-ops if their target is already
 * unset), so callers never need to track whether `startSync` actually
 * ran first.
 */
export function stopSync(): void {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
  if (onlineListener !== undefined) {
    window.removeEventListener('online', onlineListener);
    onlineListener = undefined;
  }
}
