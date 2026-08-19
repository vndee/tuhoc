import Dexie, { type Table } from 'dexie';

/**
 * Local (per-device) mirror of the `progress` table on the server — see
 * apps/api/migrations/0001_init.up.sql's `CREATE TABLE progress` and
 * apps/api/internal/sync/repo.go's `upsertProgressSQL`. The primary key is
 * `[courseId+chapterId+status]`, matching the server's own primary key
 * `(user_id, course_id, chapter_id, status)` minus `user_id` — this store
 * belongs to exactly one signed-in user at a time (the session cookie),
 * so there is nothing local to disambiguate by.
 *
 * `status` is part of the key, not a fixed field, on purpose: the server
 * schema allows more than one status row per chapter (e.g. distinguishing
 * "started" from "read"), and the local store must mirror that shape
 * exactly or a legitimate second status row would collide with and
 * overwrite the first.
 *
 * `updatedAt` is an ISO-8601 / RFC3339 instant string. It is always
 * compared as an instant (`Date.parse`), never as a raw string — see
 * `mergeRow`'s doc comment for why raw string comparison is unsafe here.
 */
export interface ProgressRow {
  courseId: string;
  chapterId: string;
  status: string;
  done: boolean;
  updatedAt: string;
}

/**
 * Local mirror of the `annotations` table — see the same migration's
 * `CREATE TABLE annotations` and apps/api/internal/sync/repo.go's
 * `AnnotationRow`. `deletedAt` is a tombstone, not a delete: a non-null
 * value means "deleted on some device, must still propagate to every
 * other device," exactly like the server-side row it mirrors (see
 * `Repo.PullAnnotations`'s doc comment, which never filters tombstones
 * out). `anchor` is carried opaquely (`unknown`), matching the server's
 * own `json.RawMessage` handling — this store has no reason to understand
 * its shape.
 */
export interface AnnotationRow {
  id: string;
  courseId: string;
  chapterId: string;
  anchor: unknown;
  note: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** The three wire shapes an outbox entry's `row` can hold, mirroring the three write endpoints (`POST /sync`'s two arrays, and `POST /events/batch`). */
export type OutboxTableName = 'progress' | 'annotations' | 'events';

/** A single queued, not-yet-confirmed-applied mutation. `seq` is Dexie's auto-increment primary key and is also what the sync engine uses to delete exactly the entries a given flush actually sent — see src/sync/engine.ts's `flushOutbox`. */
export interface OutboxEntry {
  seq?: number;
  table: OutboxTableName;
  row: unknown;
}

/** `db.meta`'s only current row is keyed `'syncCursor'` — the opaque cursor string handed back by `GET /sync`'s `cursor` field. Generic `{key,value}` shape so future settings can reuse the same table without a schema migration. */
export interface MetaRow {
  key: string;
  value: string;
}

class LocalDB extends Dexie {
  progress!: Table<ProgressRow, [string, string, string]>;
  annotations!: Table<AnnotationRow, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('tuhoc');
    this.version(1).stores({
      progress: '[courseId+chapterId+status]',
      annotations: 'id, updatedAt, deletedAt',
      outbox: '++seq, table',
      meta: 'key',
    });
  }
}

/** The single Dexie database instance every module in this app shares — one IndexedDB database per browser profile, matching one signed-in user's local mirror. */
export const db = new LocalDB();

/**
 * Any row this store's LWW rule applies to. Both `ProgressRow` and
 * `AnnotationRow` satisfy this structurally, which is what lets
 * `mergeRow` be a single generic function instead of one copy per table
 * — the server applies the identical rule to both (see
 * `upsertProgressSQL` and `upsertAnnotationSQL`'s matching
 * `WHERE EXCLUDED.updated_at > ...updated_at` guards), so duplicating the
 * comparison per-table would just be two copies of the same rule to keep
 * in sync by hand.
 */
export interface Timestamped {
  updatedAt: string;
}

/**
 * Pure last-write-wins merge: the row with the strictly greater
 * `updatedAt` wins; a tie keeps `local` unchanged. This mirrors the
 * server's own upsert guards byte-for-byte
 * (`WHERE EXCLUDED.updated_at > progress.updated_at` /
 * `> annotations.updated_at` — see apps/api/internal/sync/repo.go) on
 * purpose: the whole point of last-write-wins is that every participant
 * — server and every client — applies the *same* rule to the *same*
 * data and therefore converges on the *same* answer regardless of what
 * order rows arrive in. If the client used a looser or stricter rule
 * than the server (e.g. `>=` instead of `>`), a client and the server
 * could permanently disagree about which of two rows "won."
 *
 * `local === undefined` (the row has never been seen on this device)
 * always resolves to `incoming` — there is nothing to compare against.
 *
 * Timestamps are compared as parsed instants (`Date.parse`), never as
 * raw strings. This matters concretely, not just in theory: the server
 * formats `updatedAt` with Go's `time.RFC3339Nano`
 * (apps/api/internal/sync/handler.go's `timeLayout`), which trims
 * trailing-zero fractional digits and omits the fractional part (and its
 * leading '.') ENTIRELY when a timestamp lands on an exact whole second
 * — e.g. "2026-08-20T10:00:00Z" carries no ".000000". A raw
 * `incoming.updatedAt > local.updatedAt` string comparison breaks
 * exactly there: '.' (0x2E) sorts below 'Z' (0x5A) in ASCII, so
 * "...:00.500Z" (500ms into the second) would compare as LESS than
 * "...:00Z" (the exact second boundary, i.e. 0ms) even though 500ms is
 * chronologically later — silently applying a stale row as if it were
 * newer. See local.test.ts's dedicated regression test for this exact
 * scenario.
 *
 * Exported specifically so it can be unit-tested as a pure function,
 * independent of Dexie/IndexedDB or the network — per the task brief.
 */
export function mergeRow<T extends Timestamped>(local: T | undefined, incoming: T): T {
  if (local === undefined) return incoming;
  return Date.parse(incoming.updatedAt) > Date.parse(local.updatedAt) ? incoming : local;
}

/**
 * Records a chapter's progress locally and queues it for the next sync
 * cycle. `updatedAt` is generated HERE, at the moment of the edit — not
 * by the server, and not lazily when the outbox is eventually flushed —
 * because it is this exact instant that last-write-wins conflict
 * resolution keys on: if it were assigned later (e.g. at flush time), a
 * device that made an edit while offline for an hour would have that
 * edit dishonestly appear to have happened just now, potentially beating
 * a genuinely more recent edit made on another device in the interim.
 *
 * The local write and the outbox enqueue happen inside one Dexie
 * transaction so they can never diverge: there is no way for the visible
 * local state to change without a corresponding outbox entry existing to
 * eventually propagate that change (which would silently strand an edit
 * on one device forever), and no way for a phantom outbox entry to exist
 * whose local counterpart was never actually written.
 */
export async function setProgress(courseId: string, chapterId: string, status: string, done: boolean): Promise<void> {
  const updatedAt = new Date().toISOString();
  const row: ProgressRow = { courseId, chapterId, status, done, updatedAt };
  await db.transaction('rw', db.progress, db.outbox, async () => {
    await db.progress.put(row);
    await db.outbox.add({ table: 'progress', row });
  });
}
