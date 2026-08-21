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

/**
 * ONE VERSION of ONE course package, expanded, on this device.
 *
 * This is the table that makes a course readable with the network off, and
 * it is the reason the reader can hold a course at all: a package is not
 * something the server streams on demand, it is something the reader keeps.
 * `course/loader.ts` reads it BEFORE it reads anything else — see that
 * file's two-source comment.
 *
 * `files` is the archive already expanded — package-relative path to
 * contents, exactly the shape `packages/course-format`'s `unpackZip`
 * returns, which is what Task 8's file import hands straight to this table.
 * Stored expanded rather than as the `.zip` because every read is a lookup
 * by name: keeping the archive would mean re-inflating the whole thing to
 * open one chapter, on a device that already paid for the download.
 *
 * `manifest` is `unknown` on purpose — it is carried opaquely, the same way
 * `AnnotationRow.anchor` is, and for the same reason: this store has no
 * business understanding its shape. It is the PARSED form of
 * `files['manifest.json']` and is what `loadManifest` validates and returns;
 * the bytes stay in `files` because a package's own bytes are what a future
 * integrity check or re-export has to work from.
 *
 * **No hash field, deliberately.** If integrity checking is added, it must
 * hash the ARCHIVE BYTES, never the manifest: the server stores the manifest
 * in a `jsonb` column, which does not round-trip bytes — it reorders keys,
 * drops whitespace, and silently collapses duplicate keys (apps/api's
 * repo.go documents all three as measured). A manifest hash computed here
 * and a manifest hash computed there would disagree on packages that are
 * byte-identical, and agree on packages that are not.
 *
 * `key` is `${courseId}@${version}` — a package is identified by both, so
 * holding 1.0.0 and 1.1.0 of one course at once is an ordinary state rather
 * than a collision. Task 10's update flow depends on exactly that.
 *
 * `pinnedAt` is when this version became the one to open, ISO-8601. It is
 * how `loadManifest` picks among the versions a reader holds, and it is what
 * Task 10's `applyUpdate` writes.
 */
export interface PackageRow {
  key: string;
  courseId: string;
  version: string;
  manifest: unknown;
  files: Record<string, Uint8Array>;
  pinnedAt: string;
}

class LocalDB extends Dexie {
  progress!: Table<ProgressRow, [string, string, string]>;
  annotations!: Table<AnnotationRow, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaRow, string>;
  packages!: Table<PackageRow, string>;

  constructor() {
    super('tuhoc');
    this.version(1).stores({
      progress: '[courseId+chapterId+status]',
      annotations: 'id, updatedAt, deletedAt',
      outbox: '++seq, table',
      meta: 'key',
    });
    // Version 2 adds `packages`. The four tables above are not repeated:
    // Dexie carries forward every store a later version does not mention,
    // so listing them again would be a second copy of the schema to keep in
    // step — and a browser that already holds a version-1 database upgrades
    // by gaining one object store, touching none of the existing rows.
    this.version(2).stores({
      packages: 'key, courseId',
    });
  }
}

/** The single Dexie database instance every module in this app shares — one IndexedDB database per browser profile, matching one signed-in user's local mirror. */
export const db = new LocalDB();

/* ------------------------------------------------------------------ *
 * `localStorage` — the OTHER local store, and why it lives in this file
 * ------------------------------------------------------------------ */

/**
 * Keys holding the USER'S OWN WORDS. `clearLocalData()` deletes every one
 * of them, because these are their content, not their settings.
 *
 * Currently one entry, and the reason it exists is worth keeping in view:
 * Chromium discards IndexedDB transactions opened during a same-tab
 * navigation, so the note being typed was measurably lost at 0 ms and at
 * 400 ms after F5. The draft is therefore stamped into `localStorage`
 * synchronously on every keystroke — see `annotations/MarginCards.tsx`'s
 * `DRAFT_KEY` for the measurement. That decision stands. What it also
 * created was a SECOND store of user content, which this list is here to
 * keep attached to the one place that empties them.
 */
export const USER_CONTENT_KEYS = ['itbook-note-draft'] as const;

/**
 * Keys describing this DEVICE, not this person. `clearLocalData()` leaves
 * them alone, deliberately.
 *
 * Signing in as somebody else is not a request to change the lighting: a
 * shared laptop that flipped back to a blinding white page on every
 * handover would be a worse app, and there is nothing private in "dark".
 * The line this list draws is CONTENT vs PREFERENCE, and drawing it
 * explicitly is the point — the alternative, `localStorage.clear()`, is a
 * one-liner that quietly gets the theme wrong and can never be argued
 * with, because it does not know what it is deleting.
 *
 * `index.html` also reads `itbook-theme`, in an inline bootstrap script
 * that runs before any module loads (that is what prevents a flash of the
 * wrong palette). It cannot import this constant; `db/local.test.ts` pins
 * the two together instead.
 */
export const DEVICE_PREFERENCE_KEYS = ['itbook-theme'] as const;

/**
 * Every `localStorage` key this app is allowed to touch.
 *
 * This union is the compile-time half of the "no third store" guard:
 * `readLocalStorage`/`writeLocalStorage` accept nothing else, so a new key
 * cannot be written without first being classified as content or
 * preference above — and classifying it as content wires it into
 * `clearLocalData()` in the same edit. `bunx tsc -b` is a gate, so this is
 * enforced, not advisory.
 *
 * The runtime half (nothing may bypass these functions and reach
 * `localStorage` directly) is pinned by `db/local.test.ts`.
 */
export type LocalStorageKey = (typeof USER_CONTENT_KEYS)[number] | (typeof DEVICE_PREFERENCE_KEYS)[number];

/**
 * `localStorage` throws in private mode and wherever storage is disabled,
 * and a reader whose browser refuses it should still get a working app —
 * just without the persistence. Both accessors swallow that, which is what
 * every call site used to do for itself.
 */
export function readLocalStorage(key: LocalStorageKey): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Writes `value`, or removes the key when `value` is `null`. */
export function writeLocalStorage(key: LocalStorageKey, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Best-effort: see `readLocalStorage`.
  }
}

/**
 * Empties EVERY local table AND every `localStorage` key holding the
 * user's own content — the single, authoritative "this browser now
 * belongs to nobody / to somebody else" operation.
 *
 * Why this exists as a function rather than as the four-`clear()`
 * `Promise.all` it replaces: that literal appeared verbatim in eight
 * places (one production call site in `src/auth/useLogout.ts`, seven test
 * fixtures). This database is scoped to the BROWSER, not to a user — its
 * name is the constant `'tuhoc'` (see `LocalDB`'s constructor) and
 * IndexedDB never expires — so "no row of one account's data survives
 * into another account's session" is a security invariant, not a tidiness
 * one, and it was being maintained by eight hand-copied lists that a
 * fifth table would silently fall out of. The one copy that matters most
 * (useLogout's) is precisely the one whose omission fails silently.
 *
 * Enumerating `db.tables` rather than naming the four tables is the whole
 * point: a table added to `LocalDB`'s schema is cleared here
 * automatically, with nothing to remember to update. Dexie populates
 * `db.tables` synchronously from `version().stores()`, so this is safe to
 * call before the database has ever been opened (Dexie opens it lazily on
 * the first operation).
 *
 * That has now been collected on. Task 7's `packages` table — a reader's
 * imported courses, which are their content and no less private than their
 * notes — is emptied here without a line being written for it. What was
 * still needed was a test SAYING SO (`db/local.test.ts`'s "signing out
 * deletes cached course packages too"), because "it happens to be true"
 * and "it is guaranteed" look identical right up until the moment they
 * differ, and the way P2 learned that was a store of user content that
 * leaked from one account's session into the next one's.
 *
 * Call sites — both auth transitions, in both directions:
 *   - `src/auth/useLogout.ts` (sign-out): the departing user's rows must
 *     not outlive their session.
 *   - `src/pages/Login.tsx` (sign-in / register): the ARRIVING user must
 *     not inherit whatever the previous one left behind — a session
 *     cookie can expire (30 days) or simply be replaced by a second
 *     person signing in, while this database persists indefinitely
 *     either way. Ordering there is load-bearing; see that call site.
 *
 * **Why `localStorage` is cleared HERE and not at the call sites.** Task
 * 6's fix (the note draft, see `USER_CONTENT_KEYS` above) added a second
 * local store of user content, and neither call site knew about it — so
 * one reader's half-typed note sat in a shared browser, inside the next
 * reader's session, for as long as that browser lived. `DRAFT_KEY` is a
 * constant, not a per-user key, and `localStorage` never expires. The
 * error was not "somebody forgot a line at the call sites"; it was that
 * the truth point stopped being the truth. Sprinkling `removeItem` into
 * `useLogout` and `Login` would recreate exactly the eight-hand-copied-
 * lists problem this function was extracted to end, with the copy that
 * matters most being the one whose omission fails silently.
 *
 * The keys are removed BEFORE the tables are emptied: removal is
 * synchronous and cannot fail (see `writeLocalStorage`), while the Dexie
 * clear is asynchronous and can reject (quota, a blocked upgrade — a
 * known, accepted gap recorded in `docs/carried-forward.md`). Doing the
 * part that cannot fail first means a rejection leaves LESS behind, not
 * more.
 */
export async function clearLocalData(): Promise<void> {
  clearGeneration += 1;
  for (const key of USER_CONTENT_KEYS) writeLocalStorage(key, null);
  await Promise.all(db.tables.map((table) => table.clear()));
}

/* ------------------------------------------------------------------ *
 * The offline-read marker
 * ------------------------------------------------------------------ */

/**
 * `db.meta` key holding the last instant `GET /me` confirmed a signed-in
 * user ON THIS DEVICE, ISO-8601.
 *
 * It exists for exactly one reader: `<RequireAuth>`, on a COLD page load
 * with no network. The session cookie is `HttpOnly`, so `GET /me` is the
 * only way this app can learn whether anybody is signed in — and when that
 * request never reaches a server, the honest answer is "unknown", not
 * "logged out". Task 7 made a pinned course readable offline; without
 * something durable saying "somebody WAS signed in here", the reader could
 * only ever be opened by a tab that was already open when the network
 * died, which is half a promise (spec §2.6).
 *
 * **It lives in `db.meta` on purpose, and that is the whole safety
 * argument.** `clearLocalData()` empties `db.tables`, so this row is erased
 * by both auth transitions with no line written for it and nothing to
 * remember — the failure P2 fell into was a store of user state that the
 * clearing function had never heard of. This is deliberately not a new
 * table and emphatically not a new `localStorage` key.
 *
 * **It holds NO identity — an instant, nothing else.** Not a user id, not
 * an email, not a name. That is what keeps the worst case cheap: even a row
 * that somehow outlived its session can only say *somebody* was signed in
 * here at T, so there is nothing in it to render at the next person. What
 * it unlocks is the rest of THIS browser's database, which the same
 * `clearLocalData()` empties in the same call — so an offline render can
 * only ever show the current local session's own data.
 */
export const SESSION_VERIFIED_KEY = 'sessionVerifiedAt';

/**
 * Bumped by every `clearLocalData()`, before it touches anything.
 *
 * `rememberSessionVerified` is the only durable write in this app that can
 * be in flight while a session ends — `GET /me` can settle at any moment,
 * including the moment after `useLogout` cleared the browser. This is the
 * same shape of guard `sync/engine.ts` uses for exactly the same reason
 * (`syncEpoch`: a response that arrives after the clear must discard its
 * write rather than land it), and the same failure it prevents: a row of
 * the departing session re-created a tick after the browser was declared
 * clean.
 *
 * Module-level, therefore per-tab. That is a real limit and it is the same
 * one `docs/carried-forward.md` records as C-1 for the sync engine's own
 * epoch — a SECOND tab's in-flight write is not covered here either. What
 * makes it survivable in this particular case is what the row holds: an
 * instant and no identity, in a database the arriving session clears again
 * on its own way in.
 */
let clearGeneration = 0;

/**
 * Records that `GET /me` just confirmed a signed-in user here.
 *
 * `at` is injectable for tests only; production always means "now".
 *
 * The generation check after the write is the point, not bookkeeping: if a
 * `clearLocalData()` ran at any moment during the `put`, this row is a
 * leftover of a session that has ended, and it deletes itself. Checking
 * only BEFORE the write would leave the exact window the check exists to
 * close.
 */
export async function rememberSessionVerified(at: Date = new Date()): Promise<void> {
  const generation = clearGeneration;
  await db.meta.put({ key: SESSION_VERIFIED_KEY, value: at.toISOString() });
  if (clearGeneration !== generation) await db.meta.delete(SESSION_VERIFIED_KEY);
}

/**
 * The marker as a parsed instant, or `null` for "this device has no such
 * marker" — which includes a row whose value does not parse.
 *
 * Unparseable reads as absent rather than as `NaN`: every comparison
 * against `NaN` is `false`, so the caller would still fail closed, but by
 * accident. `null` makes the safe answer the deliberate one, and it is the
 * same choice `mergeRow` makes about never comparing these strings raw.
 */
export async function readSessionVerifiedAt(): Promise<number | null> {
  const row = await db.meta.get(SESSION_VERIFIED_KEY);
  if (row === undefined) return null;
  const at = Date.parse(row.value);
  return Number.isNaN(at) ? null : at;
}

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
