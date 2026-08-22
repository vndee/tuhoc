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

import { clearLocalData, db, type AnnotationRow, type OutboxEntry, type ProgressRow } from '../db/local';
import { redirectToLogin } from '../api/navigation';
import { OUTBOX_BATCH_SIZE, startSync, stopSync, syncOnce, waitForInFlight } from './engine';

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
  await clearLocalData();
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

/**
 * The server's own per-request item ceilings, mirrored here as a TEST
 * FIXTURE — deliberately NOT as production configuration.
 *
 * `POST /sync` refuses a body carrying more than 10 000 progress +
 * annotation items counted TOGETHER (apps/api/internal/sync/handler.go's
 * `MaxItemsPerPush`), and `POST /events/batch` refuses more than 10 000
 * events (apps/api/internal/stats/handler.go's `MaxEventsPerBatch`) —
 * both with 413. The handlers in this block enforce that rule for real,
 * so a client that sends its whole outbox in one request fails here the
 * same way it fails against the deployed server, instead of quietly
 * passing because msw will accept any body at all.
 *
 * This number exists in the test and NOWHERE in `src/`. The engine never
 * learns it: it sends batches of a size it chose for its own reasons and
 * treats a 413 as the server's authoritative answer — see
 * `OUTBOX_BATCH_SIZE`'s doc comment in engine.ts. A second hand-copied
 * "10000" under `src/` is exactly the two-points-of-truth drift this task
 * exists to avoid, which is why the second test below runs the very same
 * engine against a ceiling of 300 and still expects a full drain.
 */
const SERVER_ITEM_CEILING = 10_000;

const FIXTURE_EPOCH_MS = Date.UTC(2026, 7, 20, 10, 0, 0);

/** `count` queued progress mutations, each with its own chapter id and its own strictly-increasing `updatedAt` — so a test can tell from the wire exactly which entries arrived, and in what order. */
function progressEntries(count: number): OutboxEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    table: 'progress' as const,
    row: {
      courseId: 'c1',
      chapterId: `ch${i}`,
      status: 'read',
      done: true,
      updatedAt: new Date(FIXTURE_EPOCH_MS + i).toISOString(),
    } satisfies ProgressRow,
  }));
}

/** `count` queued heartbeat events — the other write endpoint, which has its own separate ceiling and must be batched on its own terms. */
function eventEntries(count: number): OutboxEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    table: 'events' as const,
    row: { courseId: 'c1', chapterId: 'ch1', kind: 'heartbeat', meta: {}, at: new Date(FIXTURE_EPOCH_MS + i).toISOString() },
  }));
}

/** The two arrays `POST /sync` carries, as the handlers below read them off the wire. */
interface PushBody {
  progress: ProgressRow[];
  annotations: AnnotationRow[];
}

describe('flushing an outbox bigger than one request may carry', () => {
  // This whole block is the reason Task 6b exists. The server-side cap
  // added in Task 6's fix round is correct and stays; what it exposed is
  // that a client which posts its ENTIRE outbox in one request can cross
  // that cap and then never uncross it — every cycle sends the same
  // over-cap body, every cycle gets the same 413, the outbox never
  // shrinks, and the user is never told. At one heartbeat per 30s plus
  // ordinary progress writes, that is a device offline long enough to
  // queue 10 000 entries losing every note it queued, silently.

  it('an outbox of 25 000 entries drains COMPLETELY, in batches the server accepts, and in a bounded number of requests', async () => {
    const TOTAL = 25_000;
    await db.outbox.bulkAdd(progressEntries(TOTAL));

    let requests = 0;
    let largestBatch = 0;
    let overCeiling = 0;
    const seen: string[] = [];
    server.use(
      http.post('/sync', async ({ request }) => {
        requests += 1;
        const body = (await request.json()) as PushBody;
        const items = body.progress.length + body.annotations.length;
        largestBatch = Math.max(largestBatch, items);
        if (items > SERVER_ITEM_CEILING) {
          overCeiling += 1;
          return HttpResponse.json({ error: `a push carries at most ${SERVER_ITEM_CEILING} items; this one has ${items}` }, { status: 413 });
        }
        for (const p of body.progress) seen.push(p.chapterId);
        return HttpResponse.json({ applied: items });
      }),
      emptySyncPull(),
    );

    await syncOnce();

    // The whole point: ONE cycle empties it. Not "eventually", not "after
    // the user reinstalls" — the outbox is at zero when the cycle returns.
    expect(await db.outbox.count()).toBe(0);
    // Nothing was ever offered to the server above its cap, so nothing was
    // rejected: the batching is deliberate, not 413-driven damage control.
    expect(overCeiling).toBe(0);
    expect(largestBatch).toBeLessThanOrEqual(SERVER_ITEM_CEILING);

    // The request COUNT is measured, not just the end state. An
    // implementation that posted one entry per request would also drain
    // this outbox — in 25 000 requests, which is its own kind of broken.
    expect(requests).toBe(Math.ceil(TOTAL / OUTBOX_BATCH_SIZE));
    expect(requests).toBeLessThanOrEqual(50);

    // Every entry arrived, exactly once, in outbox order — batching moved
    // where the request boundaries fall, nothing else. (Order does not
    // change the server's final state, which is per-row last-write-wins on
    // `updatedAt`, but a batching bug that dropped or duplicated a slice
    // would show up here and nowhere else.)
    expect(seen).toHaveLength(TOTAL);
    expect(seen[0]).toBe('ch0');
    expect(seen[OUTBOX_BATCH_SIZE]).toBe(`ch${OUTBOX_BATCH_SIZE}`);
    expect(seen[TOTAL - 1]).toBe(`ch${TOTAL - 1}`);
    // ---------------------------------------------------------------
    // Why this test gets a budget of its own, and why it is nonetheless
    // fast — measured, not guessed.
    //
    // Nothing here waits on a timer. The one thing that can make a 25 000
    // entry drain expensive is `fake-indexeddb`'s per-key `delete`, which
    // is O(rows in the store) and therefore O(n²) to empty a store — in
    // this harness, and only in this harness. Measured on an idle machine,
    // `bulkDelete` of every row:
    //
    //     n =    500 →      87 ms
    //     n =  1 000 →     235 ms
    //     n =  2 000 →     875 ms
    //     n =  4 000 →   3 514 ms      (4× per doubling — quadratic)
    //     n = 25 000 → ~157 000 ms     (this test, before the change below)
    //
    // Nothing the ENGINE does is what costs that: `bulkAdd` of 25 000 =
    // 912 ms, `toArray` = 62 ms, and all 25 msw round trips together =
    // 52 ms. Splitting the deletes across 25 batches is not what costs it
    // either — the same 25 000 keys cost the same deleted in one call
    // (measured both ways). It is the test double, and a real browser's
    // B-tree IndexedDB shows nothing like it.
    //
    // `deleteSentEntries` (engine.ts) closes the gap where it is provably
    // safe to, sweeping a bounded primary-key range with one cursor
    // instead of naming a thousand keys: the same 25 000 rows then cost
    // ~240 ms. The budget below stays anyway, because it is a HARNESS
    // BUDGET in exactly the sense `vite.config.ts` and `src/test/setup.ts`
    // already argue at length — it cannot mask a hang (every wait in this
    // test is an `await` on work that must complete or an assertion that
    // must hold), it can only stop the runner from killing a test doing
    // real, slow work on a loaded machine. It is scoped to this one test
    // rather than raised globally.
  }, 120_000);

  it("a server ceiling BELOW the client's own batch size still drains — the limit is learned from the 413, never hard-coded", async () => {
    // The engine holds no copy of the server's number, so this is not a
    // hypothetical: lowering the cap server-side (or one oversized note
    // tripping the byte limit instead of the item limit) must not strand
    // the device. The client finds the boundary and keeps going.
    const TOTAL = 2_000;
    const LOW_CEILING = 300;
    await db.outbox.bulkAdd(progressEntries(TOTAL));

    let requests = 0;
    let rejections = 0;
    let accepted = 0;
    server.use(
      http.post('/sync', async ({ request }) => {
        requests += 1;
        const body = (await request.json()) as PushBody;
        const items = body.progress.length + body.annotations.length;
        if (items > LOW_CEILING) {
          rejections += 1;
          return HttpResponse.json({ error: 'too many items' }, { status: 413 });
        }
        accepted += items;
        return HttpResponse.json({ applied: items });
      }),
      emptySyncPull(),
    );

    await syncOnce();

    expect(rejections).toBeGreaterThan(0); // the ceiling really was hit — this is not a vacuous pass
    expect(accepted).toBe(TOTAL);
    expect(await db.outbox.count()).toBe(0);
    // Exactly, and measured: 1 000 → 413, 500 → 413, then eight accepted
    // batches of 250. Two requests of discovery and eight of work — the
    // discovery is bounded by halving, not paid per entry.
    expect(rejections).toBe(2);
    expect(requests).toBe(10);
  });

  it('the events outbox is batched the same way, against its own endpoint and its own ceiling', async () => {
    // Deliberately far smaller than the 25 000 above: what this test adds
    // is that the SECOND endpoint is batched at all (it is a separate code
    // path with its own body shape and its own server-side cap), and three
    // batches prove that as completely as twenty-five would. The expensive
    // over-the-real-ceiling proof is paid once, in the test above — see its
    // own note on why draining costs what it costs in this harness.
    const TOTAL = 3_000;
    await db.outbox.bulkAdd(eventEntries(TOTAL));

    let requests = 0;
    let largestBatch = 0;
    let accepted = 0;
    server.use(
      http.post('/events/batch', async ({ request }) => {
        requests += 1;
        const body = (await request.json()) as { events: unknown[] };
        largestBatch = Math.max(largestBatch, body.events.length);
        if (body.events.length > SERVER_ITEM_CEILING) {
          return HttpResponse.json({ error: 'too many events' }, { status: 413 });
        }
        accepted += body.events.length;
        return HttpResponse.json({ accepted: body.events.length });
      }),
      emptySyncPull(),
    );

    await syncOnce();

    expect(await db.outbox.count()).toBe(0);
    expect(accepted).toBe(TOTAL);
    expect(largestBatch).toBeLessThanOrEqual(SERVER_ITEM_CEILING);
    expect(requests).toBe(Math.ceil(TOTAL / OUTBOX_BATCH_SIZE));
  });

  it('an outbox whose two endpoints INTERLEAVE drains both, and each batch deletes only its own entries', async () => {
    // The realistic shape once heartbeats are queuing alongside progress:
    // the outbox alternates tables, so a `/sync` batch's `seq`s are not a
    // contiguous run and the entries sitting between them belong to
    // `/events/batch`. A batch that deleted "everything between my first
    // and last entry" would silently eat every heartbeat it stepped over —
    // which is why `deleteSentEntries` only takes that shortcut when the
    // span it covers provably contains nothing else.
    const EACH = 1_500; // more than one batch of each, so the interleaving spans batch boundaries too
    const queuedProgress = progressEntries(EACH);
    const queuedEvents = eventEntries(EACH);
    const interleaved: OutboxEntry[] = [];
    for (let i = 0; i < EACH; i += 1) {
      interleaved.push(queuedProgress[i], queuedEvents[i]);
    }
    await db.outbox.bulkAdd(interleaved);

    const pushedChapters: string[] = [];
    let pushedEvents = 0;
    server.use(
      http.post('/sync', async ({ request }) => {
        const body = (await request.json()) as PushBody;
        for (const p of body.progress) pushedChapters.push(p.chapterId);
        return HttpResponse.json({ applied: body.progress.length });
      }),
      http.post('/events/batch', async ({ request }) => {
        const body = (await request.json()) as { events: unknown[] };
        pushedEvents += body.events.length;
        return HttpResponse.json({ accepted: body.events.length });
      }),
      emptySyncPull(),
    );

    await syncOnce();

    expect(pushedChapters).toHaveLength(EACH);
    expect(pushedChapters[0]).toBe('ch0');
    expect(pushedChapters[EACH - 1]).toBe(`ch${EACH - 1}`);
    expect(pushedEvents).toBe(EACH);
    expect(await db.outbox.count()).toBe(0);
  });

  it('a batch that fails does not block the batches behind it — the rest drain, and only the failed batch stays queued', async () => {
    // Once the outbox is split, a failure has to be contained to its own
    // batch. If a failed batch aborted the flush, a single permanently
    // poisonous entry near the front would strand everything behind it —
    // the same "never drains" shape as the 413 loop, moved one level down.
    const TOTAL = OUTBOX_BATCH_SIZE * 3;
    await db.outbox.bulkAdd(progressEntries(TOTAL));

    let requests = 0;
    server.use(
      http.post('/sync', async ({ request }) => {
        requests += 1;
        const body = (await request.json()) as PushBody;
        if (requests === 2) return HttpResponse.json({ error: 'boom' }, { status: 500 });
        return HttpResponse.json({ applied: body.progress.length });
      }),
      emptySyncPull(),
    );

    await syncOnce();

    expect(requests).toBe(3); // the third batch was still attempted after the second failed
    const left = await db.outbox.toArray();
    expect(left).toHaveLength(OUTBOX_BATCH_SIZE);
    // Exactly the failed batch's own entries, still queued for the next
    // cycle — neither the batch before it nor the batch after it.
    expect((left[0].row as ProgressRow).chapterId).toBe(`ch${OUTBOX_BATCH_SIZE}`);
    expect((left[left.length - 1].row as ProgressRow).chapterId).toBe(`ch${OUTBOX_BATCH_SIZE * 2 - 1}`);
  });

  it('a batch the server rejects PERMANENTLY (400) is left queued and REPORTED — never silently skipped', async () => {
    await db.outbox.bulkAdd(progressEntries(5));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    server.use(http.post('/sync', () => HttpResponse.json({ error: 'invalid batch item' }, { status: 400 })), emptySyncPull());

    await syncOnce();

    // Not dropped: these are the user's own writes, and a 400 from this
    // endpoint means the CLIENT built something the server cannot parse.
    expect(await db.outbox.count()).toBe(5);
    // And not silent: "the outbox stopped draining" must be visible
    // somewhere, which is the only reason this endpoint's 413 loop went
    // unnoticed long enough to become this task.
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('an ORDINARY retriable failure (500) stays quiet — an offline device must not fill the console every 15 seconds', async () => {
    await db.outbox.bulkAdd(progressEntries(5));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    server.use(http.post('/sync', () => HttpResponse.json({ error: 'boom' }, { status: 500 })), emptySyncPull());

    await syncOnce();

    expect(await db.outbox.count()).toBe(5);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('stopSync() landing mid-flush stops the REMAINING batches instead of firing them at a session that just ended', async () => {
    // `useLogout` calls stopSync() and then clears the local database. A
    // 25-batch flush that kept going would spend 24 more requests on a
    // session that is being torn down, and (without the epoch check the
    // single-request version already had, now applied per batch) delete
    // entries out from under it.
    const TOTAL = OUTBOX_BATCH_SIZE * 3;
    await db.outbox.bulkAdd(progressEntries(TOTAL));

    let requests = 0;
    server.use(
      http.post('/sync', async ({ request }) => {
        requests += 1;
        const body = (await request.json()) as PushBody;
        if (requests === 1) stopSync(); // logout lands while batch 1 is on the wire
        return HttpResponse.json({ applied: body.progress.length });
      }),
      emptySyncPull(),
    );

    await syncOnce();

    expect(requests).toBe(1);
    expect(await db.outbox.count()).toBe(TOTAL); // stale epoch: nothing deleted, nothing lost
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

  it('the very first sync (no stored cursor) sends GET /sync with the `since` param OMITTED entirely — not an empty string', async () => {
    // db.meta is intentionally left empty here (fresh device / never synced before).
    let seenUrl = '';
    server.use(
      http.post('/sync', () => HttpResponse.json({ applied: 0 })),
      http.get('/sync', ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({ progress: [], annotations: [], cursor: '2026-08-20T09:59:00.000Z' });
      }),
    );

    await syncOnce();

    // The server treats an absent `since` as "beginning of time" but
    // rejects a present-but-unparseable one with 400 (see
    // apps/api/internal/sync/handler.go's Pull) — an empty string would
    // fail to parse as RFC3339Nano, so omitting the param entirely (not
    // sending `?since=`) is the only correct wire shape for a first sync.
    expect(new URL(seenUrl).searchParams.has('since')).toBe(false);
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

describe('failure mode: an unexpected local-storage failure must not crash the loop', () => {
  it('an IndexedDB failure (e.g. db.outbox.toArray() rejecting) does not reject syncOnce(), releases inFlight, and leaves the outbox/cursor untouched', async () => {
    await db.outbox.add({ table: 'progress', row: { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' } });
    await db.meta.put({ key: 'syncCursor', value: '2026-08-20T09:59:00.000Z' });

    let syncPosted = false;
    server.use(
      http.post('/sync', () => {
        syncPosted = true;
        return HttpResponse.json({ applied: 1 });
      }),
      emptySyncPull(),
    );

    // Simulates the class of failure this finding is about: not a
    // network/HTTP error (those are already handled inside
    // flushOutbox/pull), but IndexedDB itself throwing — quota exceeded,
    // a blocked version upgrade, an aborted transaction, etc. — from a
    // call site neither of those functions wraps in its own try/catch.
    const toArraySpy = vi.spyOn(db.outbox, 'toArray').mockRejectedValueOnce(new Error('simulated IndexedDB failure'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(syncOnce()).resolves.toBeUndefined();
    toArraySpy.mockRestore();

    // The failure happened before any request could even be built — no
    // network call went out this cycle.
    expect(syncPosted).toBe(false);
    // Nothing changed: the outbox entry and the stored cursor are exactly
    // as they were before the failed cycle — safe to retry next time.
    expect(await db.outbox.count()).toBe(1);
    expect((await db.meta.get('syncCursor'))?.value).toBe('2026-08-20T09:59:00.000Z');
    // The failure was not silently discarded — it was logged.
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();

    // inFlight was released in the `finally`, so the NEXT cycle runs
    // normally rather than being permanently blocked by the failed one.
    await syncOnce();
    expect(syncPosted).toBe(true);
    expect(await db.outbox.count()).toBe(0);
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

    // Each tick is followed by `waitForInFlight()` before the NEXT one is
    // fired, and that pairing is load-bearing rather than tidy.
    //
    // `vi.waitFor` resolves as soon as its condition holds, and `pullCount` is
    // incremented by the msw handler — i.e. while the cycle that caused it is
    // still running: the response body has yet to be parsed, `pull()` has yet
    // to run its epoch check and its Dexie merge transaction, and `runCycle`'s
    // `finally` has yet to clear `inFlight`. Firing the second `tick()` inside
    // that window makes it a pure no-op — `runCycle`'s FIRST line is
    // `if (inFlight) return`, which is deliberate production behaviour (see its
    // doc comment: a 15s tick landing on a slow cycle must not double-send the
    // outbox), not a bug. `pullCount` then never reaches 2 and the assertion
    // below times out.
    //
    // Measured, rather than assumed: a probe around this exact sequence found
    // a cycle still in flight at the moment `vi.waitFor` returned in 0/20
    // attempts on an idle machine and 1/60 with all 8 cores saturated — which
    // is why this failed roughly 1 full-suite run in 12 and never in isolation.
    // Forcing the window open (polling for `pullCount === 1` with no interval
    // at all, then ticking) reproduces it 1/1: the second tick is swallowed and
    // `pullCount` stays at 1.
    //
    // `waitForInFlight()` awaits the cycle's own promise, whose `finally` has
    // already cleared `inFlight` by the time it resolves, so the next tick is
    // guaranteed to start a real cycle. It weakens nothing: the assertions are
    // still exactly `toBe(1)` and `toBe(2)`.
    tick(); // simulate the interval firing, without waiting 15 real seconds
    await vi.waitFor(() => expect(pullCount).toBe(1));
    await waitForInFlight();

    tick();
    await vi.waitFor(() => expect(pullCount).toBe(2));
    await waitForInFlight();

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

describe('failure mode: a stale cycle must not write after stopSync() (Task 14 fix-round-1)', () => {
  // Reproduces the exact scenario the finding named: `stopSync()` only
  // prevents FUTURE ticks — it cannot un-schedule a `GET /sync` request a
  // cycle already sent. `useLogout` (src/auth/useLogout.ts) calls
  // `stopSync()` and then unconditionally clears the local database; if a
  // cycle from BEFORE that call is still awaiting its response, its write
  // landing afterward would silently repopulate a database that's
  // supposed to be clean for whoever signs in next.
  //
  // The `GET /sync` response is gated behind a manually-controlled
  // promise (not a real-time `delay()`) so this test can deterministically
  // put the cycle in a known "request sent, response not yet received"
  // state, call `stopSync()` at exactly that point, and only THEN let the
  // response resolve — no timing guesswork.
  it('a pull() already in flight when stopSync() is called does not write to db.progress or db.meta once its late response arrives', async () => {
    let releasePull: (() => void) | undefined;
    const pullGate = new Promise<void>((resolve) => {
      releasePull = resolve;
    });
    let pullRequested = false;

    server.use(
      http.post('/sync', () => HttpResponse.json({ applied: 0 })),
      http.get('/sync', async () => {
        pullRequested = true;
        await pullGate;
        return HttpResponse.json({
          progress: [{ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' }],
          annotations: [],
          cursor: 'sometoken',
        });
      }),
    );

    const cyclePromise = syncOnce(); // empty outbox -> flushOutbox is a fast no-op -> pull() issues GET /sync

    await vi.waitFor(() => expect(pullRequested).toBe(true));

    // Simulate what useLogout.ts does: stop the engine WHILE the request
    // above is still in flight, awaiting `pullGate`.
    stopSync();

    releasePull!(); // now let the stale response resolve
    await cyclePromise;

    expect(await db.progress.get(['c1', 'ch1', 'read'])).toBeUndefined();
    expect(await db.meta.get('syncCursor')).toBeUndefined();
  });

  it('a flushOutbox() push already in flight when stopSync() is called does not delete the outbox entries once its late response arrives', async () => {
    await db.outbox.add({ table: 'progress', row: { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' } });

    let releasePush: (() => void) | undefined;
    const pushGate = new Promise<void>((resolve) => {
      releasePush = resolve;
    });
    let pushRequested = false;

    server.use(
      http.post('/sync', async () => {
        pushRequested = true;
        await pushGate;
        return HttpResponse.json({ applied: 1 });
      }),
      emptySyncPull(),
    );

    const cyclePromise = syncOnce();

    await vi.waitFor(() => expect(pushRequested).toBe(true));

    stopSync();

    releasePush!();
    await cyclePromise;

    // The push itself succeeded server-side (applied:1), but the LOCAL
    // deletion must be skipped for a stale epoch — the entry stays
    // queued (harmless: the server call is idempotent, a later cycle's
    // retry just re-confirms applied:0).
    expect(await db.outbox.count()).toBe(1);
  });

  describe('waitForInFlight()', () => {
    it('resolves immediately when nothing is in flight', async () => {
      await expect(waitForInFlight()).resolves.toBeUndefined();
    });

    it('resolves only once the currently-running cycle has settled', async () => {
      let releasePull: (() => void) | undefined;
      const pullGate = new Promise<void>((resolve) => {
        releasePull = resolve;
      });
      let pullRequested = false;

      server.use(
        http.post('/sync', () => HttpResponse.json({ applied: 0 })),
        http.get('/sync', async () => {
          pullRequested = true;
          await pullGate;
          return HttpResponse.json({ progress: [], annotations: [], cursor: '' });
        }),
      );

      const cyclePromise = syncOnce();
      await vi.waitFor(() => expect(pullRequested).toBe(true));

      let waitResolved = false;
      const waitPromise = waitForInFlight().then(() => {
        waitResolved = true;
      });

      // Give the microtask queue a chance to settle prematurely if it were
      // going to — it must not, the cycle is still gated on `pullGate`.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(waitResolved).toBe(false);

      releasePull!();
      await Promise.all([cyclePromise, waitPromise]);
      expect(waitResolved).toBe(true);
    });
  });
});
