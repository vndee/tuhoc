import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type OutboxEntry } from '../db/local';
import { startHeartbeat } from './heartbeat';

/**
 * This suite deliberately never calls `vi.useFakeTimers()`. Same
 * rationale as src/sync/engine.ts's own interval test
 * ("startSync() registers a 15s setInterval...", src/sync/engine.test.ts):
 * fake-indexeddb schedules its internal callbacks through a REAL
 * `setImmediate` specifically so it keeps working alongside an app that
 * fakes timers elsewhere, and faking the clock around a real Dexie
 * write (`startHeartbeat` writes to `db.outbox` on every tick) is a
 * documented deadlock in this codebase — `vi.advanceTimersByTimeAsync`
 * has no way to "advance" a real `setImmediate`.
 *
 * Spying on `setInterval` and invoking the captured callback directly
 * gives the exact same "simulate the next 30s tick, on demand" control
 * without faking anything: every Dexie write below runs against the
 * real event loop, and `clearInterval` (asserted in the teardown test)
 * is the real, native function, so proving it was called with the exact
 * handle `setInterval` returned is itself real proof teardown works —
 * not something a mock could fake.
 *
 * Similarly, `Date.now` is spied directly (not through the fake-timer
 * system) to get deterministic control over the 60s activity window
 * without touching setInterval/setTimeout/setImmediate at all.
 */
function captureTick(setIntervalSpy: ReturnType<typeof vi.spyOn>): () => void {
  return setIntervalSpy.mock.calls[0][0] as () => void;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

async function outboxEvents(): Promise<OutboxEntry[]> {
  return db.outbox.where('table').equals('events').toArray();
}

/** Gives any (incorrect) async write a chance to land before asserting none did — the outbox add is fire-and-forget, so a negative assertion right after `tick()` with no `await` at all could pass for the wrong reason. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(async () => {
  await db.outbox.clear();
  setHidden(false);
});

afterEach(async () => {
  vi.restoreAllMocks();
  setHidden(false);
  await db.outbox.clear();
});

describe('startHeartbeat', () => {
  it('registers a 30s interval', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0][1]).toBe(30_000);

    stop();
  });

  it('visible tab + recent activity -> pushes exactly one heartbeat event into the outbox per tick, shaped exactly like the sync flush expects', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));
    const tick = captureTick(setIntervalSpy);

    window.dispatchEvent(new Event('pointerdown'));
    tick();
    await vi.waitFor(async () => expect(await outboxEvents()).toHaveLength(1));

    const [entry] = await outboxEvents();
    expect(entry.table).toBe('events');
    // Matches src/sync/engine.ts's flushOutbox exactly — it filters
    // `r.table === 'events'` and POSTs `r.row` verbatim to
    // /events/batch, whose contract is
    // {courseId,chapterId,kind,meta,at} (see engine.test.ts's own
    // "flushes queued events via a SEPARATE POST /events/batch call").
    expect(entry.row).toEqual({
      courseId: 'c1',
      chapterId: 'ch1',
      kind: 'heartbeat',
      meta: {},
      at: expect.any(String),
    });
    // `at` must be a real, parseable instant — the server rejects
    // anything that doesn't parse as RFC3339Nano (see
    // apps/api/internal/stats/handler.go's EventsBatch).
    expect(new Date((entry.row as { at: string }).at).toString()).not.toBe('Invalid Date');

    // A second tick (with fresh activity) produces a second, distinct event.
    window.dispatchEvent(new Event('pointerdown'));
    tick();
    await vi.waitFor(async () => expect(await outboxEvents()).toHaveLength(2));

    stop();
  });

  it('a hidden tab produces no events, even with activity right before the tick', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));
    const tick = captureTick(setIntervalSpy);

    setHidden(true);
    window.dispatchEvent(new Event('pointerdown'));
    tick();

    await settle();
    expect(await outboxEvents()).toHaveLength(0);

    stop();
  });

  it('a visible tab with NO activity at all since mount produces no event', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));
    const tick = captureTick(setIntervalSpy);

    // Deliberately no pointerdown/keydown/scroll dispatched.
    tick();

    await settle();
    expect(await outboxEvents()).toHaveLength(0);

    stop();
  });

  it('activity that happened more than 60s before the tick produces no event', async () => {
    let mockNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));
    const tick = captureTick(setIntervalSpy);

    window.dispatchEvent(new Event('scroll')); // activity recorded at mockNow
    mockNow += 61_000; // 61s later — outside the 60s window
    tick();

    await settle();
    expect(await outboxEvents()).toHaveLength(0);

    stop();
  });

  it('activity within the last 60s (just inside the boundary) still produces an event', async () => {
    let mockNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));
    const tick = captureTick(setIntervalSpy);

    window.dispatchEvent(new Event('keydown'));
    mockNow += 59_000; // 59s later — still inside the 60s window
    tick();

    await vi.waitFor(async () => expect(await outboxEvents()).toHaveLength(1));

    stop();
  });

  it('getCtx() returning null (no chapter context) produces no event', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => null);
    const tick = captureTick(setIntervalSpy);

    window.dispatchEvent(new Event('pointerdown'));
    tick();

    await settle();
    expect(await outboxEvents()).toHaveLength(0);

    stop();
  });

  it('attributes each tick to whatever getCtx() returns AT TICK TIME, not whatever it returned when startHeartbeat was called (chapter navigation mid-interval)', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    let currentCtx: { courseId: string; chapterId: string } | null = { courseId: 'c1', chapterId: 'ch1' };
    const stop = startHeartbeat(() => currentCtx);
    const tick = captureTick(setIntervalSpy);

    window.dispatchEvent(new Event('pointerdown'));
    tick();
    await vi.waitFor(async () => expect(await outboxEvents()).toHaveLength(1));

    // Simulate the reader navigating to a different chapter BETWEEN two ticks.
    currentCtx = { courseId: 'c1', chapterId: 'ch2' };
    window.dispatchEvent(new Event('pointerdown'));
    tick();
    await vi.waitFor(async () => expect(await outboxEvents()).toHaveLength(2));

    const events = await outboxEvents();
    expect((events[0].row as { chapterId: string }).chapterId).toBe('ch1');
    expect((events[1].row as { chapterId: string }).chapterId).toBe('ch2');

    stop();
  });

  it('teardown clears the exact interval startHeartbeat created and removes the activity listeners', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));
    const timerHandle = setIntervalSpy.mock.results[0].value;

    const addedTypes = addSpy.mock.calls.map((call) => call[0]);
    expect(addedTypes).toEqual(expect.arrayContaining(['pointerdown', 'keydown', 'scroll']));

    stop();

    // `clearInterval` is the real, native API (the spy delegates through
    // by default) — this is genuine proof the automatically-firing
    // interval is stopped, not just that some function got called.
    expect(clearIntervalSpy).toHaveBeenCalledWith(timerHandle);
    const removedTypes = removeSpy.mock.calls.map((call) => call[0]);
    expect(removedTypes).toEqual(expect.arrayContaining(['pointerdown', 'keydown', 'scroll']));
  });
});
