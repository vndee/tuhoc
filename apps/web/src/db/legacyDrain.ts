import { api } from '../api/client';
import { sessionWasSuperseded } from '../auth/sessionIdentity';

/**
 * The one-time exit ramp for the Dexie era (Task 10).
 *
 * `db/local.ts`'s Dexie database — `'tuhoc'`, with an `outbox` object store
 * of queued-but-unsent progress/annotation writes — is gone from this
 * codebase as of this task. A browser that was still running an OLDER build
 * when this one shipped can have that database sitting in its profile,
 * holding real unsent work: a chapter marked read, a note nobody's other
 * device has seen. `apps/api/internal/sync/handler.go`'s package comment
 * records the server-side half of this contract — `POST /sync` stays alive
 * specifically so this drain has somewhere to send that outbox — and the
 * whole value of this function is in NOT reordering the two halves: flush,
 * THEN delete. Deleting first and sending second is a function with
 * nothing left to send, and it would silently eat that learner's work.
 *
 * Deliberately not built on Dexie: the whole point of this task is that the
 * `dexie` dependency is leaving `package.json`. This talks to `indexedDB`
 * directly, exactly the way anything reading a database it doesn't own has
 * to.
 *
 * Idempotent by construction, with no separate "already ran" flag: once a
 * drain succeeds, `deleteLegacyDatabase()` removes the database itself, and
 * a database that does not exist is this function's OWN definition of
 * "nothing left to do" — the next call (next page load, in the SAME tab
 * later, doesn't matter) sees no database and returns immediately, without
 * touching the network. A fresh install — the overwhelming majority of
 * every call this function ever gets — never had the database to begin
 * with, so it pays the identical cheap, silent no-op cost.
 *
 * Every failure (existence check, open, read, flush, or even the deletion
 * itself) is caught here and logged rather than thrown: this function is
 * meant to be fired once from `App.tsx` without blocking render (see that
 * call site), and a rejection reaching an unguarded `useEffect` callback
 * would be an unhandled promise rejection, not a blank page — but "not a
 * blank page" is not the same guarantee as "definitely logged and visible",
 * so this still surfaces the failure. Crucially, a failure ANYWHERE in the
 * flush stops the function before `deleteLegacyDatabase()` ever runs: the
 * try/catch is one block, not several, so there is exactly one path that
 * reaches the delete call, and it is the path where every batch already
 * landed.
 *
 * ## WHOSE outbox is this? (final whole-branch review, Critical 2)
 *
 * The first cut of this function asked "is there anything to send" and
 * never "may THIS session send it". `App.tsx` fired it once per page load
 * with `[]` deps and documented the ungating as deliberate: *a browser that
 * has since signed out, or whose cookie has since expired, still needs its
 * old outbox flushed*. That reasoning is what produced a cross-account
 * leak, because `api/client.ts`'s `send()` always sends
 * `credentials: 'include'` and `apps/api/internal/sync/handler.go` binds
 * every incoming row to `auth.UID(c)` — the SESSION's account, not the
 * account that wrote the row.
 *
 * The server's own owner-scoping cannot save this, and it is worth being
 * precise about why: `upsertAnnotationSQL`'s
 * `AND annotations.user_id = EXCLUDED.user_id` guard (sync/repo.go) only
 * fires on a PRIMARY-KEY COLLISION, and an UNSENT outbox row by definition
 * has no server-side row to collide with. It INSERTs — A's note text under
 * B's `user_id`. Progress rows land the same way.
 *
 * Three things now stand where `runCycle`'s single `if` used to:
 *
 *  1. `App.tsx`'s `useLegacyDrain` runs this only for a SETTLED, SIGNED-IN
 *     `useMe`, and decides once per page load (see that hook).
 *  2. this function re-asks `sessionWasSuperseded()` before every batch
 *     (see the loop below).
 *  3. `clearLegacyLocalData()` (below) puts this database back inside
 *     `auth/session.ts`'s `clearSession()`, where the Dexie table-clear
 *     used to live before Task 10 removed Dexie.
 *
 * Nothing is stranded that was not already stranded. An outbox belongs to
 * exactly one account, and sending it to a different one is strictly worse
 * than not sending it: the rows are not merely misfiled, they are a
 * learner's private notes appearing in a stranger's account.
 */
export async function drainLegacyDataOnce(): Promise<void> {
  try {
    if (!(await legacyDatabaseExists())) return;

    const rows = await readLegacyOutbox();
    const syncRows = rows.filter((row): row is LegacyOutboxRow => row.table === 'progress' || row.table === 'annotations');

    // `table === 'events'` rows are a real possibility on a browser old
    // enough (pre-Task-8, this phase) to have queued heartbeats into this
    // very outbox — and are dropped here on purpose. `sync/engine.ts`'s own
    // events-push path is already unreachable in the build this ships
    // alongside and dies with that file; this drain does not resurrect it.
    // See this task's report for the trade this accepts.
    for (let start = 0; start < syncRows.length; start += LEGACY_BATCH_SIZE) {
      const batch = syncRows.slice(start, start + LEGACY_BATCH_SIZE);

      // THE GUARD `sync/engine.ts`'s `runCycle` USED TO OWN, re-asked
      // before EVERY batch rather than once at the top — see this
      // function's own doc comment for the whole reasoning. A drain is a
      // sequence of awaits (an existence check, an open, a read, then one
      // round trip per batch), and another tab can take this browser's
      // session in any of the gaps between them. Asking once at the start
      // would leave every gap after the first unguarded.
      //
      // Returning WITHOUT reaching `deleteLegacyDatabase()` below is the
      // load-bearing half: the outbox stays on disk, still owned by
      // nobody, for the one account that could legitimately send it. The
      // single try/catch this sits inside is what guarantees no path
      // reaches the delete except the one where every batch landed; this
      // is that property used deliberately.
      if (sessionWasSuperseded()) {
        console.error(
          'tuhoc: another tab took this browser’s session mid-drain; leaving the legacy outbox in place rather than pushing it under whoever holds the cookie now',
        );
        return;
      }

      // `redirectOn401: false` — see `api/client.ts`'s `RequestOptions`.
      // This runs in the background of whatever page happens to be open,
      // including a PUBLIC course page with no session at all, and a
      // background best-effort migration must never yank a reader off the
      // chapter they are reading. Same defect class Task 13 found in
      // `Sidebar.tsx` and fixed with an `enabled` gate; here the drain's
      // own auth gate (`App.tsx`'s `useLegacyDrain`) makes a 401 unlikely,
      // but "unlikely" is not the same as "cannot" — the cookie can expire
      // between `GET /me` answering and this request leaving.
      await api.post(
        '/sync',
        {
          progress: batch.filter((row) => row.table === 'progress').map((row) => row.row),
          annotations: batch.filter((row) => row.table === 'annotations').map((row) => row.row),
        },
        { redirectOn401: false },
      );
    }

    await deleteLegacyDatabase();
  } catch (err) {
    console.error('tuhoc: draining the legacy local database failed; leaving it in place to retry on the next load', err);
  }
}

/**
 * Deletes the legacy database because THIS BROWSER'S SESSION IS ENDING —
 * not because a drain finished with it.
 *
 * Only `auth/session.ts`'s `clearSession()` may call this, and
 * `session.test.ts`'s `SESSION_CLEARERS` tripwire enforces that, for the
 * same reason it already enforces it for `clearUserContent`,
 * `resetSessionScopedQueries` and `resetEventQueue`: this is a store of the
 * departing learner's own words, and a store the one truth point has never
 * heard of is precisely how a reader's private note survives into the next
 * reader's session.
 *
 * **This restores behaviour Task 10 removed without noticing.** The old
 * build's `clearLocalData()` ended with
 * `await Promise.all(db.tables.map((table) => table.clear()))` — `outbox`
 * included — so BOTH auth transitions already emptied this exact store.
 * Task 10 deleted Dexie and the table-clear went with it, leaving the
 * database itself behind and readable by whoever signed in next. So the
 * account whose unsent work this deletes had exactly the same deal under
 * the build that wrote it, and every page load in between — while its own
 * cookie was valid — was a chance for the drain to send it properly.
 *
 * Returns a promise, and `clearSession()` deliberately does NOT await it:
 * `indexedDB.deleteDatabase` fires `blocked` (and neither succeeds nor
 * errors) for as long as ANY connection to that database is still open,
 * and a tab still running the OLD Dexie build holds one open for its whole
 * lifetime. Awaiting would hand that tab the power to hang this tab's
 * logout indefinitely. The deletion is queued the moment this is called
 * and completes whenever the last connection closes; nothing in this app
 * needs it to have finished before the session ends — the drain's own
 * gates (see this module's header) are what keep the interval in between
 * safe, not the deletion's timing.
 *
 * Never rejects: a browser that refuses IndexedDB entirely must still be
 * able to sign out.
 */
export function clearLegacyLocalData(): Promise<void> {
  return deleteLegacyDatabase().catch((err: unknown) => {
    console.error('tuhoc: could not delete the legacy local database while ending this session', err);
  });
}

/** The Dexie database's own name — see `db/local.ts`'s (now removed) `LocalDB` constructor. Not derived from anywhere; there is nothing left in this codebase that still declares it. */
const LEGACY_DB_NAME = 'tuhoc';

/** The Dexie database's outbox store name — see `db/local.ts`'s (now removed) `OutboxEntry`/`db.outbox`. */
const LEGACY_OUTBOX_STORE = 'outbox';

/** Matches `sync/engine.ts`'s (now removed) `OUTBOX_BATCH_SIZE` — see that constant's own doc comment for why this number is a client preference, not a copy of the server's real cap. This drain does not need the adaptive 413-triggered halving `pushBatches` had: it is a one-time, best-effort exit ramp, not a permanent background loop, and a batch this size has never come close to the server's cap in that engine's own lifetime. */
const LEGACY_BATCH_SIZE = 1000;

/** One row of the legacy outbox, narrowed to the two tables this drain forwards. */
interface LegacyOutboxRow {
  table: 'progress' | 'annotations';
  row: unknown;
}

/** One row of the legacy outbox, as read back with no narrowing yet — `table` could in principle be `'events'` too (or, on a sufficiently old/corrupt profile, garbage this drain has never heard of), which is exactly why the caller filters before trusting `table`. */
interface RawLegacyOutboxRow {
  table?: unknown;
  row?: unknown;
}

/**
 * Whether the legacy database exists, WITHOUT creating it as a side effect.
 *
 * `indexedDB.open(name)` with no explicit version is not a safe existence
 * check: called on a browser that never had this database, it CREATES one
 * (an empty, schemaless version-1 database) purely by being called — which
 * would permanently defeat this function's own "absence of the database is
 * the 'already ran' marker" design the moment it ran once on a fresh
 * install. `indexedDB.databases()` enumerates existing databases without
 * opening or creating any of them, which is the only correct tool here.
 */
async function legacyDatabaseExists(): Promise<boolean> {
  const all = await indexedDB.databases();
  return all.some((entry) => entry.name === LEGACY_DB_NAME);
}

/**
 * Opens the legacy database (already confirmed to exist by the caller — see
 * `legacyDatabaseExists`) and reads back every row of its `outbox` store, if
 * any. Opened with no explicit version, so this never triggers
 * `onupgradeneeded` and never writes a byte of schema — it only ever reads.
 *
 * A database that exists but has no `outbox` store (never realistically
 * happens for a genuine Dexie-created `'tuhoc'` database, but is not ruled
 * out for anything else that might happen to share the name) reads back as
 * "nothing to send" rather than throwing.
 */
async function readLegacyOutbox(): Promise<RawLegacyOutboxRow[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(LEGACY_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('failed to open the legacy local database'));
  });

  try {
    if (!db.objectStoreNames.contains(LEGACY_OUTBOX_STORE)) return [];

    return await new Promise<RawLegacyOutboxRow[]>((resolve, reject) => {
      const tx = db.transaction(LEGACY_OUTBOX_STORE, 'readonly');
      const req = tx.objectStore(LEGACY_OUTBOX_STORE).getAll();
      req.onsuccess = () => resolve(req.result as RawLegacyOutboxRow[]);
      req.onerror = () => reject(req.error ?? new Error('failed to read the legacy outbox'));
    });
  } finally {
    db.close();
  }
}

/** Deletes the legacy database outright — the last step, reached only once every batch above has been confirmed applied. */
async function deleteLegacyDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('failed to delete the legacy local database'));
  });
}
