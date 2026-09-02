/**
 * The one-time exit ramp for the Dexie era.
 *
 * Task 10 removes `db/local.ts` — the Dexie database, and every local read
 * of progress/annotations along with it (Tasks 6–9 already moved every
 * *reader* onto the server). What Dexie leaves behind on a browser that was
 * running an OLDER build is the `outbox` object store: queued
 * progress/annotation writes nobody has flushed yet. Deleting the database
 * out from under that browser without sending it first would silently eat a
 * learner's unsent progress and notes — see `apps/api/internal/sync/handler.go`'s
 * package comment, which is the server-side half of this exact contract: it
 * keeps `POST /sync` alive *specifically* for this drain.
 *
 * `drainLegacyDataOnce()` is deliberately NOT implemented on top of Dexie —
 * the whole point of this task is that the `dexie` dependency is on its way
 * out of `package.json`. It talks to `indexedDB` directly, the same way any
 * other reader of a database somebody else's code created would have to.
 *
 * The one property this file exists to pin, twice, because it is the entire
 * value of the drain: **flush THEN delete, and a failed flush must leave the
 * database standing.** Deleting first and sending second is a function with
 * nothing left to send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same boundary `sync/engine.test.ts`/`session.test.ts` mock at: this file
// asserts exactly which HTTP calls a drain makes, with no real network
// anywhere near it.
vi.mock('../api/client', () => ({
  api: { post: vi.fn() },
}));

import { api } from '../api/client';
import { announceSessionUser, __resetSessionIdentityForTests, sessionWasSuperseded } from '../auth/sessionIdentity';
import { drainLegacyDataOnce } from './legacyDrain';

const LEGACY_DB_NAME = 'tuhoc';
const LEGACY_OUTBOX_STORE = 'outbox';

/** Whether a database of this name exists in this browser profile, WITHOUT creating one as a side effect — `indexedDB.databases()`, not `indexedDB.open()`. */
async function databaseExists(name: string): Promise<boolean> {
  const all = await indexedDB.databases();
  return all.some((entry) => entry.name === name);
}

/**
 * Puts rows directly into a raw `tuhoc`/`outbox` IndexedDB store — standing
 * in for what an old build's Dexie left behind. Deliberately NOT built on
 * Dexie (it is leaving the dependency tree in this same task) — this is
 * exactly the low-level shape `legacyDrain.ts` itself has to read back.
 */
function seedLegacyOutbox(entries: { table: string; row: unknown }[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(LEGACY_DB_NAME, 1);
    openReq.onupgradeneeded = () => {
      openReq.result.createObjectStore(LEGACY_OUTBOX_STORE, { keyPath: 'seq', autoIncrement: true });
    };
    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction(LEGACY_OUTBOX_STORE, 'readwrite');
      const store = tx.objectStore(LEGACY_OUTBOX_STORE);
      for (const entry of entries) store.add(entry);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    openReq.onerror = () => reject(openReq.error);
  });
}

/** Deletes the legacy database, if any — a clean starting point for every test in this file. */
function deleteLegacyDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue(undefined);
  await deleteLegacyDatabase();
});

// Every test but the supersession one below leaves this module untouched
// (`localUser === undefined`, `superseded === false`), which is exactly the
// state a fresh tab starts in. Resetting anyway keeps the one test that DOES
// announce from colouring whatever runs after it.
afterEach(() => {
  __resetSessionIdentityForTests();
});

describe('drainLegacyDataOnce — flush THEN delete, never the other order', () => {
  // Step 1a. Order is the whole value here: delete-then-send is a function
  // with nothing left to send.
  it('flush hỏng thì database không bị xoá', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('mạng hỏng'));
    await seedLegacyOutbox([
      { table: 'progress', row: { courseId: 'c', chapterId: 'c1', status: 'read', done: true, updatedAt: 'x' } },
    ]);

    await drainLegacyDataOnce();

    expect(await databaseExists(LEGACY_DB_NAME)).toBe(true);
    // Never throws — App.tsx fires this once and must not have a rejection
    // reach it (see App.tsx's own call site).
  });

  it('flush xong thì xoá, và lần chạy sau là no-op không gọi mạng', async () => {
    await seedLegacyOutbox([
      { table: 'progress', row: { courseId: 'c', chapterId: 'c1', status: 'read', done: true, updatedAt: 'x' } },
    ]);

    await drainLegacyDataOnce();

    expect(await databaseExists(LEGACY_DB_NAME)).toBe(false);

    vi.mocked(api.post).mockClear();
    await drainLegacyDataOnce();

    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });
});

describe('drainLegacyDataOnce — a new reader never pays for this', () => {
  // Step 2. New readers are the overwhelming majority of every run of this
  // function. It must be silent and cheap for them.
  it('trình duyệt sạch: không request, không lỗi', async () => {
    await expect(drainLegacyDataOnce()).resolves.toBeUndefined();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });
});

describe('drainLegacyDataOnce — batching and shape', () => {
  it('gửi progress và annotations cùng một lô qua POST /sync, không đụng /events/batch', async () => {
    await seedLegacyOutbox([
      { table: 'progress', row: { courseId: 'c', chapterId: 'ch1', status: 'read', done: true, updatedAt: 'x' } },
      { table: 'annotations', row: { id: 'a1', courseId: 'c', chapterId: 'ch1', note: 'n' } },
    ]);

    await drainLegacyDataOnce();

    expect(vi.mocked(api.post)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/sync',
      {
        progress: [{ courseId: 'c', chapterId: 'ch1', status: 'read', done: true, updatedAt: 'x' }],
        annotations: [{ id: 'a1', courseId: 'c', chapterId: 'ch1', note: 'n' }],
      },
      // Recorded Minor, fixed in the same round as this file's supersession
      // test below: without `redirectOn401: false`, a 401 here hard-redirects
      // the visitor to /login from `api/client.ts`'s `send()` — including a
      // signed-out visitor sitting on a PUBLIC course page, who never asked
      // this app for anything. Same defect class Task 13 found in
      // `Sidebar.tsx`. Asserted, not merely written: an option object that
      // silently went missing would restore the redirect with no other
      // symptom.
      { redirectOn401: false },
    );
  });

  // Landmine #4: a browser running a build from before Task 8 (Pha 3) queued
  // heartbeats into this very outbox with `table: 'events'`. That push path
  // is unreachable in `sync/engine.ts` today and dies with the file — this
  // drain never re-grows it. An 'events' row is simply not forwarded to
  // anywhere; it is dropped when the database is deleted, same as it would
  // have been if this task did nothing at all (the heartbeat it recorded is
  // long stale by the time anyone ships this drain).
  it('bỏ qua hàng "events" cũ — không gửi đi đâu, không chặn việc xoá', async () => {
    await seedLegacyOutbox([{ table: 'events', row: { kind: 'heartbeat' } }]);

    await drainLegacyDataOnce();

    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    expect(await databaseExists(LEGACY_DB_NAME)).toBe(false);
  });

  it('chia lô 1000: 1500 hàng progress đi thành đúng hai request', async () => {
    const entries = Array.from({ length: 1500 }, (_, i) => ({
      table: 'progress',
      row: { courseId: 'c', chapterId: `ch${i}`, status: 'read', done: true, updatedAt: 'x' },
    }));
    await seedLegacyOutbox(entries);

    await drainLegacyDataOnce();

    expect(vi.mocked(api.post)).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = vi.mocked(api.post).mock.calls;
    expect((firstCall[1] as { progress: unknown[] }).progress).toHaveLength(1000);
    expect((secondCall[1] as { progress: unknown[] }).progress).toHaveLength(500);
    expect(await databaseExists(LEGACY_DB_NAME)).toBe(false);
  });

  it('outbox rỗng nhưng database còn tồn tại: xoá luôn, không gọi mạng', async () => {
    await seedLegacyOutbox([]);

    await drainLegacyDataOnce();

    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    expect(await databaseExists(LEGACY_DB_NAME)).toBe(false);
  });
});

/**
 * The guard `sync/engine.ts`'s `runCycle` used to own — `if
 * (sessionWasSuperseded()) { stopSync(); return; }` — asked here, where
 * Task 10 left a writer with nobody asking it.
 *
 * TWO MODULE GRAPHS, one per tab, the same mechanism
 * `auth/supersededScreen.test.tsx` uses: `BroadcastChannel` never delivers a
 * message back to the object that posted it, so a test that announces from
 * THIS tab's own `sessionIdentity` can never measure what it means to
 * measure. `vi.resetModules()` + a dynamic import gives the other tab its
 * own copy; the channel itself is a jsdom global and is genuinely shared.
 */
describe('drainLegacyDataOnce — whose outbox is this', () => {
  it('một tab khác chiếm phiên ⇒ không đẩy gì, và cơ sở dữ liệu cũ ở lại chờ đúng chủ của nó', async () => {
    await seedLegacyOutbox([
      { table: 'annotations', row: { id: 'a1', courseId: 'c', chapterId: 'ch1', note: 'ghi chú riêng của A' } },
    ]);

    // Tab này đã xác lập: trình duyệt thuộc về A.
    announceSessionUser('u-a');

    vi.resetModules();
    const otherTab = await import('../auth/sessionIdentity');
    // Tab kia: A đăng xuất (`clearSession()` công bố `null`), rồi B đăng nhập.
    otherTab.announceSessionUser(null);
    otherTab.announceSessionUser('u-b');
    await vi.waitFor(() => expect(sessionWasSuperseded()).toBe(true));

    await drainLegacyDataOnce();

    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    // KHÔNG xoá: outbox chưa gửi vẫn là của A, và cửa sổ duy nhất nó còn
    // được gửi đúng chỗ là một lần tải trang mà A thật sự đang đăng nhập.
    expect(await databaseExists(LEGACY_DB_NAME)).toBe(true);

    otherTab.__resetSessionIdentityForTests();
  });
});
