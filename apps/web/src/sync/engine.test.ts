import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Same rationale as src/api/client.test.ts: the api client's 401 handling
// is a hard `window.location` navigation that jsdom cannot perform for
// real, so it's mocked at the module boundary instead of asserted via
// window.location.
vi.mock('../api/navigation', () => ({
  redirectToLogin: vi.fn(),
}));

import { db, type AnnotationRow, type ProgressRow } from '../db/local';
import { redirectToLogin } from '../api/navigation';
import { startSync, stopSync, syncOnce } from './engine';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.mocked(redirectToLogin).mockClear();
  stopSync();
  vi.useRealTimers();
});
afterAll(() => server.close());

async function clearAll() {
  await Promise.all([db.progress.clear(), db.annotations.clear(), db.outbox.clear(), db.meta.clear()]);
}

beforeEach(async () => {
  await clearAll();
  // Every test runs "online" unless it deliberately overrides this.
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

function emptySyncPull() {
  return http.get('/sync', () => HttpResponse.json({ progress: [], annotations: [], cursor: '' }));
}

describe('syncOnce — flushing the outbox', () => {
  it('POSTs the queued progress+annotation mutations as one /sync batch, then empties the outbox', async () => {
    const annotation: AnnotationRow = {
      id: 'a1',
      courseId: 'c1',
      chapterId: 'ch1',
      anchor: { x: 1 },
      note: 'ghi chú',
      createdAt: '2026-08-20T09:00:00.000Z',
      updatedAt: '2026-08-20T09:00:00.000Z',
      deletedAt: null,
    };
    await db.outbox.bulkAdd([
      { table: 'progress', row: { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' } satisfies ProgressRow },
      { table: 'progress', row: { courseId: 'c1', chapterId: 'ch2', status: 'read', done: false, updatedAt: '2026-08-20T10:00:01.000Z' } satisfies ProgressRow },
      { table: 'annotations', row: annotation },
    ]);

    let receivedBody: unknown;
    server.use(
      http.post('/sync', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ applied: 3 });
      }),
      emptySyncPull(),
    );

    await syncOnce();

    expect(receivedBody).toEqual({
      progress: [
        { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' },
        { courseId: 'c1', chapterId: 'ch2', status: 'read', done: false, updatedAt: '2026-08-20T10:00:01.000Z' },
      ],
      // Proves the 'annotations' outbox rows flow into their own array,
      // not silently dropped or merged into `progress` — a distinct code
      // path (separate filter) from the progress rows above.
      annotations: [annotation],
    });

    expect(await db.outbox.count()).toBe(0);
  });

  it('flushes queued events via a SEPARATE POST /events/batch call', async () => {
    await db.outbox.add({ table: 'events', row: { courseId: 'c1', chapterId: 'ch1', kind: 'heartbeat', meta: {}, at: '2026-08-20T10:00:00.000Z' } });

    let receivedBody: unknown;
    let syncBatchCalled = false;
    server.use(
      http.post('/sync', () => {
        syncBatchCalled = true;
        return HttpResponse.json({ applied: 0 });
      }),
      http.post('/events/batch', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ accepted: 1 });
      }),
      emptySyncPull(),
    );

    await syncOnce();

    // No progress/annotation mutations were queued, so POST /sync must not
    // even be called — only /events/batch carries this batch.
    expect(syncBatchCalled).toBe(false);
    expect(receivedBody).toEqual({ events: [{ courseId: 'c1', chapterId: 'ch1', kind: 'heartbeat', meta: {}, at: '2026-08-20T10:00:00.000Z' }] });
    expect(await db.outbox.count()).toBe(0);
  });

  it('an empty outbox sends no POST /sync and no POST /events/batch at all', async () => {
    let syncPosted = false;
    let eventsPosted = false;
    server.use(
      http.post('/sync', () => {
        syncPosted = true;
        return HttpResponse.json({ applied: 0 });
      }),
      http.post('/events/batch', () => {
        eventsPosted = true;
        return HttpResponse.json({ accepted: 0 });
      }),
      emptySyncPull(),
    );

    await syncOnce();

    expect(syncPosted).toBe(false);
    expect(eventsPosted).toBe(false);
  });
});

describe('syncOnce — pulling from the server', () => {
  it('a server row newer than the local copy updates Dexie, and the returned cursor is stored', async () => {
    await db.progress.put({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: false, updatedAt: '2026-08-20T09:00:00.000Z' });

    server.use(
      http.post('/sync', () => HttpResponse.json({ applied: 0 })),
      http.get('/sync', () =>
        HttpResponse.json({
          progress: [{ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' }],
          annotations: [],
          cursor: '2026-08-20T09:59:00.000Z',
        }),
      ),
    );

    await syncOnce();

    const row = await db.progress.get(['c1', 'ch1', 'read']);
    expect(row).toEqual({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' });

    const cursorRow = await db.meta.get('syncCursor');
    expect(cursorRow?.value).toBe('2026-08-20T09:59:00.000Z');
  });

  it('sends the stored cursor back to the server VERBATIM as ?since=..., never recomputed', async () => {
    await db.meta.put({ key: 'syncCursor', value: '2026-08-20T09:59:00.000Z' });

    let seenSince: string | null = null;
    server.use(
      http.post('/sync', () => HttpResponse.json({ applied: 0 })),
      http.get('/sync', ({ request }) => {
        seenSince = new URL(request.url).searchParams.get('since');
        return HttpResponse.json({ progress: [], annotations: [], cursor: '2026-08-20T09:59:00.000Z' });
      }),
    );

    await syncOnce();

    expect(seenSince).toBe('2026-08-20T09:59:00.000Z');
  });

  it('re-delivery of an already-applied row (identical updatedAt) is a genuine no-op: no duplicate row, no state change', async () => {
    const settled: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' };
    await db.progress.put(settled);

    server.use(
      http.post('/sync', () => HttpResponse.json({ applied: 0 })),
      // The safety-lagged cursor deliberately re-sends a row already applied.
      http.get('/sync', () => HttpResponse.json({ progress: [settled], annotations: [], cursor: '2026-08-20T09:59:00.000Z' })),
    );

    await syncOnce();

    const rows = await db.progress.where({ courseId: 'c1', chapterId: 'ch1', status: 'read' }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(settled);
  });

  it('re-delivery never resurrects a deleted annotation, even if the redelivered copy is the pre-deletion version', async () => {
    const tombstone: AnnotationRow = {
      id: 'a1',
      courseId: 'c1',
      chapterId: 'ch1',
      anchor: { x: 1 },
      note: 'note',
      createdAt: '2026-08-20T08:00:00.000Z',
      updatedAt: '2026-08-20T09:00:00.000Z',
      deletedAt: '2026-08-20T09:00:00.000Z',
    };
    await db.annotations.put(tombstone);

    const staleUndeletedReplay: AnnotationRow = { ...tombstone, updatedAt: '2026-08-20T08:30:00.000Z', deletedAt: null };
    server.use(
      http.post('/sync', () => HttpResponse.json({ applied: 0 })),
      http.get('/sync', () => HttpResponse.json({ progress: [], annotations: [staleUndeletedReplay], cursor: '2026-08-20T08:59:00.000Z' })),
    );

    await syncOnce();

    const row = await db.annotations.get('a1');
    expect(row?.deletedAt).toBe('2026-08-20T09:00:00.000Z');
  });

  it('does not resurrect/regress even when the redelivered row differs only by the RFC3339Nano whole-second trimming quirk', async () => {
    // Local is genuinely newer (500ms into the second). The server
    // re-delivers what LOOKS like the same window but formatted with no
    // fractional part at all (a distinct, OLDER whole-second instant) —
    // a naive string compare would wrongly treat "no fraction" as "greater".
    const local: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.500Z' };
    await db.progress.put(local);

    const staleIncoming: ProgressRow = { ...local, done: false, updatedAt: '2026-08-20T10:00:00Z' };
    server.use(
      http.post('/sync', () => HttpResponse.json({ applied: 0 })),
      http.get('/sync', () => HttpResponse.json({ progress: [staleIncoming], annotations: [], cursor: '2026-08-20T10:00:00Z' })),
    );

    await syncOnce();

    const row = await db.progress.get(['c1', 'ch1', 'read']);
    expect(row).toEqual(local);
  });
});

describe('failure mode: a failed flush must not lose mutations', () => {
  it('POST /sync failing (500) leaves the outbox intact — nothing is deleted', async () => {
    await db.outbox.add({ table: 'progress', row: { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' } });

    server.use(http.post('/sync', () => HttpResponse.json({ error: 'boom' }, { status: 500 })), emptySyncPull());

    await syncOnce();

    expect(await db.outbox.count()).toBe(1);
  });

  it('a network failure on POST /sync (offline mid-request) leaves the outbox intact', async () => {
    await db.outbox.add({ table: 'progress', row: { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' } });

    server.use(http.post('/sync', () => HttpResponse.error()), emptySyncPull());

    await syncOnce();

    expect(await db.outbox.count()).toBe(1);
  });

  it('a retry after failure re-sends the SAME batch and it is safely idempotent (server LWW no-ops an identical replay)', async () => {
    const mutation = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' };
    await db.outbox.add({ table: 'progress', row: mutation });

    let callCount = 0;
    const receivedBodies: unknown[] = [];
    server.use(
      http.post('/sync', async ({ request }) => {
        callCount += 1;
        receivedBodies.push(await request.json());
        // First attempt: simulate a 500 (server never durably applied it,
        // or the response was lost — either way the client must retry).
        if (callCount === 1) return HttpResponse.json({ error: 'boom' }, { status: 500 });
        // Second attempt (the retry): succeeds, applied:0 because the
        // batch is byte-identical to one already durably applied server
        // side — this is what "safe to retry" looks like on the wire.
        return HttpResponse.json({ applied: 0 });
      }),
      emptySyncPull(),
    );

    await syncOnce(); // fails, outbox retained
    expect(await db.outbox.count()).toBe(1);

    await syncOnce(); // retries — same batch content
    expect(callCount).toBe(2);
    expect(receivedBodies[0]).toEqual(receivedBodies[1]);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('failure mode: a 401 mid-loop', () => {
  it('does not use the default hard-redirect suppression: a 401 on POST /sync fires redirectToLogin, and the outbox is left untouched', async () => {
    await db.outbox.add({ table: 'progress', row: { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' } });

    let pullCalled = false;
    server.use(
      http.post('/sync', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })),
      http.get('/sync', () => {
        pullCalled = true;
        return HttpResponse.json({ progress: [], annotations: [], cursor: '' });
      }),
    );

    await syncOnce();

    expect(redirectToLogin).toHaveBeenCalledTimes(1);
    expect(await db.outbox.count()).toBe(1);
    // The cycle bails out entirely on an auth failure — pull must not run
    // this cycle (there is nothing useful to reconcile with a dead session).
    expect(pullCalled).toBe(false);
  });

  it('does not throw / reject — a 401 must not crash the background timer', async () => {
    await db.outbox.add({ table: 'progress', row: { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' } });
    server.use(http.post('/sync', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));

    await expect(syncOnce()).resolves.toBeUndefined();
  });
});

describe('failure mode: overlapping runs must not double-send', () => {
  it('two concurrent syncOnce() calls result in exactly ONE POST /sync for the same outbox content', async () => {
    await db.outbox.add({ table: 'progress', row: { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' } });

    let callCount = 0;
    server.use(
      http.post('/sync', async () => {
        callCount += 1;
        await delay(50); // hold the "in-flight" window open so the second call can race it
        return HttpResponse.json({ applied: 1 });
      }),
      emptySyncPull(),
    );

    await Promise.all([syncOnce(), syncOnce()]);

    expect(callCount).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('failure mode: ordering — flush completes before pull begins', () => {
  it('POST /sync is observed before GET /sync', async () => {
    await db.outbox.add({ table: 'progress', row: { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' } });

    const callOrder: string[] = [];
    server.use(
      http.post('/sync', () => {
        callOrder.push('push');
        return HttpResponse.json({ applied: 1 });
      }),
      http.get('/sync', () => {
        callOrder.push('pull');
        return HttpResponse.json({ progress: [], annotations: [], cursor: '' });
      }),
    );

    await syncOnce();

    expect(callOrder).toEqual(['push', 'pull']);
  });
});

describe('failure mode: unmount/teardown must be releasable', () => {
  it('startSync() registers a 15s setInterval whose callback runs a real cycle; stopSync() clears that exact interval', async () => {
    // Deliberately NOT vi.useFakeTimers() here: fake-indexeddb schedules
    // its callbacks via a real setImmediate (see its own
    // lib/scheduling.js — it goes out of its way to escape jsdom's
    // sandbox to get a real one, specifically so it keeps working
    // alongside fake timers elsewhere in an app). Faking the clock and
    // then trying to `advanceTimersByTimeAsync` past a real Dexie
    // transaction is a known deadlock: the fake clock has no way to
    // "advance" a real setImmediate. Spying on setInterval/clearInterval
    // instead verifies the exact same wiring (interval length, that
    // teardown clears the exact handle `startSync` created) without
    // needing to fake anything, and lets the real IndexedDB/network
    // promise chain resolve normally.
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    let pullCount = 0;
    server.use(
      http.post('/sync', () => HttpResponse.json({ applied: 0 })),
      http.get('/sync', () => {
        pullCount += 1;
        return HttpResponse.json({ progress: [], annotations: [], cursor: '' });
      }),
    );

    startSync();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0][1]).toBe(15_000);
    const tick = setIntervalSpy.mock.calls[0][0] as () => void;
    const timerHandle = setIntervalSpy.mock.results[0].value;

    tick(); // simulate the interval firing, without waiting 15 real seconds
    await vi.waitFor(() => expect(pullCount).toBe(1));

    tick();
    await vi.waitFor(() => expect(pullCount).toBe(2));

    stopSync();
    // clearInterval is the real, native browser/Node API — calling it
    // with the exact handle setInterval returned is itself the complete,
    // load-bearing proof that the real automatic-firing interval is
    // stopped (unlike calling the captured `tick` function directly,
    // which invokes the callback in-process regardless of whether the
    // underlying interval was ever cleared, and so cannot prove teardown
    // by itself).
    expect(clearIntervalSpy).toHaveBeenCalledWith(timerHandle);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it("startSync() also runs on the window 'online' event; stopSync() removes that listener too", async () => {
    let pullCount = 0;
    server.use(http.post('/sync', () => HttpResponse.json({ applied: 0 })), http.get('/sync', () => {
      pullCount += 1;
      return HttpResponse.json({ progress: [], annotations: [], cursor: '' });
    }));

    startSync();
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(pullCount).toBe(1));

    stopSync();
    window.dispatchEvent(new Event('online'));
    // Give any (undesired) in-flight handler a chance to run before asserting nothing changed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pullCount).toBe(1);
  });
});

describe('failure mode: online gating', () => {
  it('does not attempt any network call while navigator.onLine is false', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    let called = false;
    server.use(
      http.post('/sync', () => {
        called = true;
        return HttpResponse.json({ applied: 0 });
      }),
      http.get('/sync', () => {
        called = true;
        return HttpResponse.json({ progress: [], annotations: [], cursor: '' });
      }),
    );

    await syncOnce();

    expect(called).toBe(false);
  });
});
