import { api, ApiError } from '../api/client';
import { sessionWasSuperseded, subscribeToSessionChanges } from '../auth/sessionIdentity';
import { db, mergeRow, type AnnotationRow, type OutboxEntry, type ProgressRow } from '../db/local';

/** Task brief's binding interval — see engine's own doc comment on `startSync`. */
const SYNC_INTERVAL_MS = 15_000;

/** `db.meta`'s single row key for the opaque cursor `GET /sync` hands back. */
const CURSOR_KEY = 'syncCursor';

/**
 * How many queued outbox entries ONE request carries.
 *
 * **This is not a copy of the server's cap, and that is the whole point.**
 * `POST /sync` refuses a body of more than `MaxItemsPerPush` progress +
 * annotation items and `POST /events/batch` more than
 * `MaxEventsPerBatch` events (both 10 000 today,
 * apps/api/internal/sync/handler.go and apps/api/internal/stats/handler.go),
 * and both endpoints ALSO sit behind a 4 MiB body limit that a few very
 * large annotation notes can trip long before any item count does. There
 * is no build step linking Go constants to TypeScript ones, so writing
 * `10000` here would create a second, hand-maintained truth point for a
 * number only the server actually enforces — the failure this codebase has
 * already been bitten by twice (see `icTZOffset`'s doc comment on the Go
 * side, and docs/carried-forward.md's rule about never writing "7" in a
 * second place). Two constants drift, and the drift is silent until a
 * device is stranded.
 *
 * So the client keeps NO copy of the ceiling. It keeps only this: a
 * request size chosen for reasons of its own — small enough that one batch
 * is a few hundred KB rather than tens of MB, large enough that a
 * long-offline device drains in tens of requests rather than thousands —
 * and it treats a **413 as the server's authoritative answer** about what
 * it will accept, halving the batch and retrying rather than assuming it
 * knows better (see `pushBatches`). Correctness therefore does not depend
 * on this number being below the ceiling at all: it converges for any
 * server ceiling down to a single item, including one this file was
 * written before anybody chose. Being comfortably below today's ceiling is
 * a performance property (no wasted discovery round trip), not the safety
 * property.
 *
 * Exported so `engine.test.ts` can assert the exact REQUEST COUNT a drain
 * costs, not merely that it eventually drained — an implementation that
 * posted one entry per request would satisfy "the outbox empties" and be
 * its own kind of broken.
 */
export const OUTBOX_BATCH_SIZE = 1000;

/** Shape of `GET /sync`'s response body — see apps/api/internal/sync/handler.go's `pullResponse`. */
interface PullResponse {
  progress: ProgressRow[];
  annotations: AnnotationRow[];
  cursor: string;
}

// The two write endpoints' response bodies are deliberately NOT modelled
// here: `POST /sync` answers `{applied: number}` and `POST /events/batch`
// answers `{accepted: number}` (apps/api/internal/sync/handler.go's
// `pushResponse` and apps/api/internal/stats/handler.go's
// `eventsBatchResponse`), and this engine reads neither — a batch's
// outcome is its HTTP status, not its count. `applied: 0` is the ORDINARY
// answer to a correct retry of an already-durable batch (see `mergeRow`),
// so treating the count as a success signal would be actively wrong.

// ---------------------------------------------------------------------------
// Module-level state for the timer + listener startSync()/stopSync() own,
// the in-flight guard that prevents two overlapping cycles from
// double-sending the outbox (see runCycle's doc comment), and the epoch
// counter + promise handle that make a cycle's local-database WRITES
// discardable after the fact (see stopSync's, flushOutbox's, and pull's
// own doc comments — this is the fix for the Task 14 fix-round-1 finding
// that stopSync() alone only stops FUTURE ticks: it cannot un-schedule a
// network request a cycle is already awaiting, and that cycle's write
// landing AFTER something like logout has cleared the local database
// would silently repopulate it with the departing user's rows). All of
// this is intentionally plain module state, not a class: this engine has
// exactly one instance for the whole app (one IndexedDB database, one
// session), so there is nothing a class would buy beyond what a module
// already gives for free.
// ---------------------------------------------------------------------------
let timer: ReturnType<typeof setInterval> | undefined;
let onlineListener: (() => void) | undefined;
let inFlight = false;

/**
 * Releases this tab's subscription to the cross-tab session bus, or
 * `undefined` when nothing is subscribed. Paired with `timer`/
 * `onlineListener` above: `startSync` registers it, `stopSync` releases it.
 *
 * See `runCycle`'s "Whose session is this?" paragraph for what the
 * subscription is FOR — it is the prompt half of debt C-1's fix, and it is
 * deliberately not the load-bearing half.
 */
let sessionListener: (() => void) | undefined;

/**
 * Bumped by `stopSync()`. A cycle captures the CURRENT value once, at the
 * moment it starts (`runCycle`'s own `const epoch = syncEpoch`), and
 * `flushOutbox`/`pull` compare that captured value against the CURRENT
 * `syncEpoch` immediately before performing a local Dexie write — not
 * before the network call, which is harmless to let finish (idempotent,
 * per those functions' own doc comments). If the two differ, `stopSync()`
 * was called while this cycle's request was still in flight, and the
 * result is discarded rather than written.
 *
 * This is a stronger guarantee than merely awaiting "the" in-flight cycle
 * (see `waitForInFlight` below) would give on its own: it also covers a
 * cycle that resolves late for any other reason — a second `stopSync()`
 * racing the first, a caller that doesn't await `waitForInFlight`, a
 * future call site nobody's written yet — not just the one specific cycle
 * that happened to be running at the exact moment `stopSync()` was
 * called.
 */
let syncEpoch = 0;

/**
 * The currently-running cycle's promise, or `null` when none is in
 * flight. Exposed via `waitForInFlight()` for `src/auth/useLogout.ts`'s
 * best-effort final flush: without this, logout's own `syncOnce()` call
 * would silently no-op against `runCycle`'s `inFlight` guard whenever a
 * cycle from BEFORE logout was clicked happens to still be running —
 * defeating the "flush pending work before clearing" intent entirely,
 * not just narrowing it. `runCycle` itself never lets this promise
 * reject (see its own try/catch), but `waitForInFlight` still guards
 * against it defensively so a caller awaiting it can never hang on an
 * unexpected rejection.
 */
let currentCycle: Promise<void> | null = null;

/**
 * What one attempted batch did, in the only four terms the flush driver
 * below has to act on differently. The distinction that matters most is
 * `retriable` vs `rejected`, because they are the two ends of an
 * asymmetry:
 *
 *  - `retriable` — no answer arrived (offline, DNS, connection refused),
 *    or the answer was "not now" (5xx, 429, 408). The batch is fine; the
 *    moment is not. Leave it queued, say nothing, try again next cycle.
 *    This is the ordinary state of a device on a train, and logging it
 *    would print every 15 seconds for hours.
 *  - `rejected` — the server looked at this exact content and said no
 *    (400, 422, and every other non-401/408/413/429 4xx). Retrying byte-
 *    identical content against a deterministic validator returns the
 *    identical answer forever, so this one is NOT ordinary and must not
 *    pass in silence. See `pushBatches` for what is done with it.
 *  - `too-large` — 413, the one answer that is about the batch's SIZE
 *    rather than its content, and therefore the one the client can fix by
 *    itself. See `OUTBOX_BATCH_SIZE`.
 *  - `auth-failed` — 401, which is about the session, not this request.
 */
type BatchOutcome = 'applied' | 'auth-failed' | 'too-large' | 'rejected' | 'retriable';

/**
 * Maps a thrown failure onto the outcome the driver acts on.
 *
 * Anything that is not an `ApiError` never reached a server at all (see
 * `serverAnswered` in src/api/client.ts for the full four-case argument)
 * and is therefore retriable by definition. A status this function has no
 * opinion about falls to `rejected`, which is the fail-loud side: a new
 * 4xx nobody anticipated gets reported rather than silently retried
 * forever.
 */
function classifyPushFailure(err: unknown): Exclude<BatchOutcome, 'applied'> {
  if (!(err instanceof ApiError)) return 'retriable';
  if (err.status === 401) return 'auth-failed';
  if (err.status === 413) return 'too-large';
  if (err.status === 408 || err.status === 429 || err.status >= 500) return 'retriable';
  return 'rejected';
}

/**
 * Deletes exactly the outbox rows a confirmed batch carried — never a row
 * queued while that request was in flight, and never a row belonging to
 * the endpoint this batch did not go to.
 *
 * Two spellings of the identical delete, and the branch is a proof, not a
 * heuristic. `batch` is a contiguous slice of a `toArray()` snapshot, so
 * its `seq`s are strictly ascending; when the span they cover equals their
 * count (`last - first + 1 === batch.length`) the seqs are exactly
 * `first…last` with no gaps, so every row the store holds in that key
 * range is a row this batch sent. Under that condition — and only under
 * it — a bounded primary-key range delete removes precisely the same rows
 * as naming each key, with no way for either to reach a row the other
 * would not. When entries of both endpoints interleave in the outbox (the
 * ordinary case once heartbeats are queuing alongside progress), the span
 * is wider than the batch, the condition is false, and the keys are named
 * individually.
 *
 * The range form is one bounded cursor sweep instead of `batch.length`
 * point deletes. What made this worth writing down at all is the test
 * harness rather than the browser: `fake-indexeddb`'s per-key delete is
 * O(rows in the store), so draining 25 000 entries a thousand keys at a
 * time measured 157 s of pure test-double bookkeeping, against 0.2 s for
 * the same rows swept by cursor (see engine.test.ts's own measurements).
 * A real IndexedDB is a B-tree and shows nothing like that gap — but a
 * cursor sweep is not slower there either, and the mandated 25 000-entry
 * acceptance test is not worth a three-minute gate.
 */
async function deleteSentEntries(batch: OutboxEntry[]): Promise<void> {
  const first = batch[0].seq as number;
  const last = batch[batch.length - 1].seq as number;

  if (last - first + 1 === batch.length) {
    await db.outbox.where('seq').between(first, last, true, true).delete();
    return;
  }

  await db.outbox.bulkDelete(batch.map((entry) => entry.seq as number));
}

/**
 * Posts `entries` to `path` in batches, deleting each batch's outbox rows
 * as soon as that batch is confirmed applied, and returns `false` only if
 * a 401 was observed (which aborts the whole cycle — see `runCycle`).
 *
 * **Why batching exists at all.** Before this, `flushOutbox` posted the
 * WHOLE outbox in one request. Both write endpoints cap a single request
 * (see `OUTBOX_BATCH_SIZE`), so an outbox that grew past that cap — a
 * device offline long enough, at one heartbeat per 30 s plus ordinary
 * writes — produced the same over-cap body every cycle, got the same 413
 * every cycle, and never shrank. Not slow: LOST. Every note queued behind
 * that wall stayed on the device forever with nothing shown to the user.
 * A smaller server cap would only have moved the wall closer.
 *
 * **The batch boundary is the entry, not the array.** `POST /sync` counts
 * `progress` and `annotations` TOGETHER against one cap (they are written
 * in one transaction server-side), so batching each array independently
 * would let a mixed outbox exceed the cap while both halves looked
 * innocent. Slicing the interleaved entry list and splitting each SLICE
 * into the two arrays makes the client's unit of accounting the same as
 * the server's.
 *
 * **Per-batch deletion, per-batch failure.** Each batch's `seq`s are
 * deleted the moment that batch is confirmed, so a flush interrupted at
 * batch 17 keeps the 16 batches of progress it already made instead of
 * re-sending them next cycle. A failed batch never aborts the flush: the
 * loop keeps going. That is not tidiness — it is the same finding one
 * level down. If one bad batch stopped the flush, a single permanently
 * unacceptable entry near the front of the queue would strand everything
 * behind it forever, which is precisely the shape of failure this
 * function was written to end.
 *
 * **A `rejected` batch is kept, and said out loud.** The two choices for
 * content the server will never accept are to drop it or to keep it. This
 * keeps it: every item here is something the user did (a note, a chapter
 * marked read), and every field the server validates — RFC3339Nano
 * instants, UUIDs — is generated by this client, so a 400 means OUR bug,
 * not their input. Deleting the evidence would turn a fixable client bug
 * into permanent, invisible data loss, and "invisible" is the property
 * this whole task is about. Keeping it costs one wasted request per cycle
 * for that one batch, and `console.error` is what stops it from being
 * silent. Batching already shrank the blast radius from "the entire
 * outbox" to "one batch"; narrowing it further (bisecting a poisoned
 * batch down to the single offending entry) would spend O(log n) requests
 * every 15 s forever to isolate something that still cannot be sent, so
 * it is deliberately not done here.
 *
 * **413 is the server's answer, not the client's guess.** On `too-large`
 * the batch size is halved and the SAME entries are retried, down to a
 * single entry. This is what lets `OUTBOX_BATCH_SIZE` be an independent
 * preference rather than a copy of a Go constant: whatever the real
 * ceiling is — an item count, a byte limit tripped by a few very long
 * notes, or a number changed server-side years from now — the client
 * converges on it within a few requests instead of being stranded by it.
 * If even a single entry comes back 413, no batch size can ever carry it,
 * so it is treated exactly like `rejected` (kept, reported, stepped over)
 * and the size is restored: it was that entry, not the ceiling.
 *
 * **`epoch`** — see `syncEpoch`'s doc comment. Checked immediately before
 * each batch's deletion, exactly as the single-request version did, and
 * additionally at the top of each iteration so a `stopSync()` landing
 * mid-flush (a logout) stops the REMAINING batches rather than spending
 * another two dozen requests on a session being torn down. Stopping early
 * is never lossy: undeleted entries stay queued for the next cycle, or
 * are cleared by whatever ended the session.
 */
async function pushBatches(
  path: string,
  entries: OutboxEntry[],
  buildBody: (batch: OutboxEntry[]) => unknown,
  epoch: number,
): Promise<boolean> {
  let size = OUTBOX_BATCH_SIZE;
  let index = 0;

  while (index < entries.length) {
    if (epoch !== syncEpoch) return true;

    const batch = entries.slice(index, index + size);

    let outcome: BatchOutcome;
    try {
      await api.post(path, buildBody(batch));
      outcome = 'applied';
    } catch (err) {
      outcome = classifyPushFailure(err);
    }

    if (outcome === 'auth-failed') return false;

    if (outcome === 'too-large' && size > 1) {
      size = Math.max(1, Math.floor(size / 2));
      continue; // same entries, smaller request — nothing consumed, nothing lost
    }

    if (outcome === 'applied') {
      if (epoch === syncEpoch) await deleteSentEntries(batch);
    } else if (outcome === 'too-large') {
      console.error(`tuhoc sync: the server refuses a single queued entry as too large for ${path}; it stays queued and is skipped for now`);
      size = OUTBOX_BATCH_SIZE; // the ceiling was never the problem — that one entry was
    } else if (outcome === 'rejected') {
      console.error(`tuhoc sync: the server permanently rejected ${batch.length} queued entr${batch.length === 1 ? 'y' : 'ies'} for ${path}; they stay queued and cannot be sent as-is`);
    }

    index += batch.length;
  }

  return true;
}

/**
 * Pushes the outbox's queued mutations to the server and, for each batch
 * that is confirmed applied, deletes exactly those entries.
 *
 * Two separate sequences of HTTP calls, because the two write endpoints
 * are separate on the wire (`POST /sync` for progress+annotations,
 * `POST /events/batch` for events — see the task brief's server contract)
 * and are handled independently: a failure in one must not block or roll
 * back the other, since they are unrelated resources server-side with
 * unrelated failure modes (e.g. a malformed event should never block a
 * valid progress write from landing). Each sequence is batched — see
 * `pushBatches`, which is where the interesting decisions live.
 *
 * `rows` is snapshotted via `toArray()` ONCE, before any request goes
 * out, and only the `seq`s present in that snapshot are ever deleted.
 * This matters: `setProgress` (or a future annotation/event write) can
 * add a NEW outbox entry while a flush's `await` is still pending on the
 * network. If deletion instead cleared "whatever is in the outbox right
 * now" after the request resolves, that new entry — never actually
 * sent — would be deleted anyway and its mutation permanently lost. By
 * deleting only the snapshotted `seq`s, a mutation queued mid-flush
 * survives untouched and is picked up by the NEXT cycle instead.
 *
 * Returns `false` the moment a 401 is observed on either endpoint, which
 * tells `runCycle` to abort the rest of this cycle (see its doc comment
 * for why). Every other failure leaves the corresponding entries queued
 * for the next cycle. That is safe to repeat unboundedly because the
 * server's conflict rule is idempotent — replaying a batch that was
 * already durably applied (or applying it for the first time after a
 * response got lost in transit) always converges to the same state; see
 * `mergeRow`'s doc comment and apps/api/internal/sync/usecase.go's
 * `Push` for the server-side half of that guarantee.
 *
 * **Splitting one request into many does not change where the data ends
 * up.** The server resolves every conflict per ROW by strictly-greater
 * `updatedAt` (repo.go's `WHERE EXCLUDED.updated_at > ...`), and
 * `updatedAt` is stamped at the moment of the edit, on this device, by
 * `setProgress` — never at flush time. That rule is commutative: two
 * writes to the same key converge on the one with the later stamp no
 * matter which request carried it or which arrived first, so batch order
 * is not part of the answer. (Batches here are issued strictly
 * sequentially — each `await`ed before the next is built — so they cannot
 * even overlap on the wire; the commutativity is what makes a batch
 * failing, being retried a cycle later, or arriving out of order against
 * ANOTHER device's push harmless rather than merely unlikely.) Events are
 * inserted with their own dedup (repo.go's `insertEventSQL`), so a
 * replayed event batch reports `accepted: 0` rather than double-counting
 * study minutes.
 */
async function flushOutbox(epoch: number): Promise<boolean> {
  const rows = await db.outbox.toArray();

  const syncEntries = rows.filter((r) => r.table === 'progress' || r.table === 'annotations');
  const eventEntries = rows.filter((r) => r.table === 'events');

  if (syncEntries.length > 0) {
    const buildPushBody = (batch: OutboxEntry[]) => ({
      progress: batch.filter((r) => r.table === 'progress').map((r) => r.row),
      annotations: batch.filter((r) => r.table === 'annotations').map((r) => r.row),
    });
    if (!(await pushBatches('/sync', syncEntries, buildPushBody, epoch))) return false;
  }

  if (eventEntries.length > 0) {
    const buildEventsBody = (batch: OutboxEntry[]) => ({ events: batch.map((r) => r.row) });
    if (!(await pushBatches('/events/batch', eventEntries, buildEventsBody, epoch))) return false;
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
 *
 * `epoch` — see `flushOutbox`'s matching doc comment for the general
 * mechanism. Here the check gates the ENTIRE merge transaction (progress
 * + annotations + cursor), immediately after the network response
 * arrives and before any of it is written: a `GET /sync` response that
 * arrives after `stopSync()` bumped `syncEpoch` (e.g. logout mid-flight)
 * is discarded in full rather than partially or fully applied to a local
 * database something else (logout's own clear) has already declared
 * clean for whoever's signed in next. This is the fix for the Task 14
 * fix-round-1 finding: without it, a `pull()` that was already awaiting
 * this fetch when logout ran would land its write AFTER logout's
 * `Promise.all([db.progress.clear(), ...])`, silently repopulating the
 * departing user's rows.
 */
async function pull(epoch: number): Promise<void> {
  const cursorRow = await db.meta.get(CURSOR_KEY);
  const since = cursorRow?.value ?? '';
  const query = since === '' ? '' : `?since=${encodeURIComponent(since)}`;

  let resp: PullResponse;
  try {
    resp = await api.get<PullResponse>(`/sync${query}`);
  } catch {
    return;
  }

  if (epoch !== syncEpoch) return;

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
 *
 * Epoch capture: `syncEpoch` is read into a local `epoch` constant HERE,
 * once, before either `flushOutbox`/`pull` runs — that captured value,
 * not a live read of `syncEpoch`, is what those two functions compare
 * against immediately before their own local writes (see `syncEpoch`'s
 * own doc comment for why this exists). `currentCycle` is set to this
 * whole cycle's promise for the same span `inFlight` is true, so
 * `waitForInFlight()` always has an accurate handle on "the cycle
 * running right now, if any."
 */
async function runCycle(): Promise<void> {
  // Whose session is this? — debt C-1 (docs/carried-forward.md §1).
  //
  // FIRST, before the `inFlight` and offline guards and before anything is
  // read out of the local database, because this is the only check here that
  // is about WHOSE data is about to be sent rather than about whether sending
  // is convenient.
  //
  // The session cookie is one value shared by every tab of this origin; every
  // signal this engine had for "who is signed in" was per-tab. So a second tab
  // left open on A's reader went on running this cycle after somebody signed
  // in as B in another tab, and `POST /sync` carried A's queued progress and
  // A's notes into B's account under B's cookie — while `GET /sync` pulled B's
  // rows down into a database this tab renders as A's. `src/auth/
  // sessionIdentity.ts` is the cross-tab fact that makes that answerable.
  //
  // This is a synchronous READ, not a reaction to an event, and that is the
  // point. `startSync` also subscribes to the bus so the timer is released
  // promptly, but a guard that only works when its notification is delivered
  // is a guard whose failure mode is silence. This line holds whether or not
  // the listener ever ran.
  //
  // `stopSync()` rather than a bare `return`: the session is not coming back
  // in this tab, so the interval and the `online` listener should go too — and
  // its epoch bump is what makes a cycle that is ALREADY in flight (its
  // request out, its response not yet back) discard its local write instead of
  // landing B's rows in A's database. See `syncEpoch`'s own doc comment.
  if (sessionWasSuperseded()) {
    stopSync();
    return;
  }

  if (inFlight) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const epoch = syncEpoch;
  inFlight = true;
  currentCycle = (async () => {
    try {
      const flushedWithoutAuthFailure = await flushOutbox(epoch);
      if (!flushedWithoutAuthFailure) return;
      await pull(epoch);
    } catch (err) {
      console.error('tuhoc sync: cycle failed unexpectedly', err);
    } finally {
      inFlight = false;
      currentCycle = null;
    }
  })();
  await currentCycle;
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
 * Resolves once whatever cycle is CURRENTLY in flight (if any) has
 * settled — immediately if none is running. See `currentCycle`'s own doc
 * comment for why this exists: `src/auth/useLogout.ts`'s best-effort
 * final flush calls this BEFORE its own `syncOnce()`, so that flush is
 * never silently skipped by `runCycle`'s `inFlight` guard just because a
 * cycle from before logout was clicked happened to still be running.
 *
 * Never rejects — `runCycle` itself already contains every failure it
 * can produce (see its own doc comment), and the `.catch(() => {})` here
 * is a second, defensive line against that invariant ever being
 * violated, so a caller awaiting this can never hang on an unexpected
 * rejection.
 */
export async function waitForInFlight(): Promise<void> {
  await currentCycle?.catch(() => {});
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
  // Debt C-1. The prompt half: another tab signing in (or out) tears this
  // loop down within a task, instead of at some point in the next 15
  // seconds. The load-bearing half is `runCycle`'s own synchronous check —
  // see its "Whose session is this?" paragraph for why both exist.
  sessionListener = subscribeToSessionChanges(() => {
    if (sessionWasSuperseded()) stopSync();
  });
}

/**
 * Releases everything `startSync` registered: the interval timer, the
 * `online` listener, and the cross-tab session subscription (debt C-1 —
 * leaving that one attached to a stopped engine would keep a torn-down
 * loop reachable from a bus that outlives it). Not part of the task brief's literal interface list
 * (which only names `startSync(): void`), but required by the task's own
 * teardown requirement — without a way to release them, every test that
 * calls `startSync` leaks a live timer + listener into every subsequent
 * test in the same process (jsdom's `window` is shared per test FILE,
 * not per test), and a real app hot-reloading this module would
 * accumulate one more of each on every reload. Safe to call when nothing
 * is running (both branches are no-ops if their target is already
 * unset), so callers never need to track whether `startSync` actually
 * ran first.
 *
 * Also bumps `syncEpoch` (Task 14 fix-round-1) — unconditionally, even
 * when `timer`/`onlineListener` are already unset: this is what stops a
 * cycle that is CURRENTLY in flight (started before this call) from
 * writing to the local database once it eventually resolves. Clearing
 * the timer/listener only prevents FUTURE ticks; it cannot un-schedule a
 * network request a cycle is already awaiting. Bumping the epoch here
 * unconditionally is safe in the ordinary case too (nothing in flight,
 * or a caller who genuinely wants to keep syncing again right after —
 * e.g. `useLogout`'s own follow-up `waitForInFlight()` + `syncOnce()`):
 * the NEXT cycle to start simply captures whatever `syncEpoch` is at
 * that moment, so there is nothing for a fresh, legitimate cycle to
 * collide with.
 */
export function stopSync(): void {
  syncEpoch++;
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
  if (onlineListener !== undefined) {
    window.removeEventListener('online', onlineListener);
    onlineListener = undefined;
  }
  if (sessionListener !== undefined) {
    sessionListener();
    sessionListener = undefined;
  }
}
