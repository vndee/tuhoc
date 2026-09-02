import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Task 8 (Pha 3): the heartbeat no longer writes to `db.outbox` at all —
// it hands every tick to `../api/events`'s in-memory queue instead (see
// that module's own header for why). Mocked at the module boundary, same
// shape as `sync/engine.test.ts`'s `vi.mock('../api/navigation', ...)`,
// so this suite can assert exactly which events `startHeartbeat` queued
// without a real network or a real IndexedDB write anywhere in it.
vi.mock('../api/events', () => ({
  queueEvent: vi.fn(),
}));

import { queueEvent } from '../api/events';
import { startHeartbeat } from './heartbeat';

/**
 * This suite deliberately never calls `vi.useFakeTimers()`. Spying on
 * `setInterval` and invoking the captured callback directly gives the
 * exact same "simulate the next 30s tick, on demand" control without
 * faking anything, and `clearInterval` (asserted in the teardown test) is
 * the real, native function — proving it was called with the exact handle
 * `setInterval` returned is itself real proof teardown works.
 *
 * `Date.now` is spied directly (not through the fake-timer system) to get
 * deterministic control over the 60s activity window without touching
 * setInterval/setTimeout at all.
 */
function captureTick(setIntervalSpy: ReturnType<typeof vi.spyOn>): () => void {
  return setIntervalSpy.mock.calls[0][0] as () => void;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

beforeEach(() => {
  vi.mocked(queueEvent).mockClear();
  setHidden(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  setHidden(false);
});

describe('startHeartbeat', () => {
  it('registers a 30s interval', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0][1]).toBe(30_000);

    stop();
  });

  it('visible tab + recent activity -> queues exactly one heartbeat event per tick, shaped exactly like POST /events/batch expects', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));
    const tick = captureTick(setIntervalSpy);

    window.dispatchEvent(new Event('pointerdown'));
    tick();
    expect(queueEvent).toHaveBeenCalledTimes(1);

    // `api/events.ts`'s own `StudyEvent` contract, field for field — see
    // that module's doc and apps/api/internal/stats/handler.go's
    // `eventsBatchRequest`.
    expect(vi.mocked(queueEvent).mock.calls[0][0]).toEqual({
      courseId: 'c1',
      chapterId: 'ch1',
      kind: 'heartbeat',
      meta: {},
      at: expect.any(String),
    });
    // `at` must be a real, parseable instant — the server rejects
    // anything that doesn't parse as RFC3339Nano (see
    // apps/api/internal/stats/handler.go's EventsBatch).
    const firstCall = vi.mocked(queueEvent).mock.calls[0][0];
    expect(new Date(firstCall.at).toString()).not.toBe('Invalid Date');

    // A second tick (with fresh activity) produces a second, distinct event.
    window.dispatchEvent(new Event('pointerdown'));
    tick();
    expect(queueEvent).toHaveBeenCalledTimes(2);

    stop();
  });

  it('a hidden tab produces no queued event, even with activity right before the tick', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));
    const tick = captureTick(setIntervalSpy);

    setHidden(true);
    window.dispatchEvent(new Event('pointerdown'));
    tick();

    expect(queueEvent).not.toHaveBeenCalled();

    stop();
  });

  it('a visible tab with NO activity at all since mount queues nothing', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));
    const tick = captureTick(setIntervalSpy);

    // Deliberately no pointerdown/keydown/scroll dispatched.
    tick();

    expect(queueEvent).not.toHaveBeenCalled();

    stop();
  });

  it('activity that happened more than 60s before the tick queues nothing', () => {
    let mockNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));
    const tick = captureTick(setIntervalSpy);

    window.dispatchEvent(new Event('scroll')); // activity recorded at mockNow
    mockNow += 61_000; // 61s later — outside the 60s window
    tick();

    expect(queueEvent).not.toHaveBeenCalled();

    stop();
  });

  it('activity within the last 60s (just inside the boundary) still queues an event', () => {
    let mockNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => ({ courseId: 'c1', chapterId: 'ch1' }));
    const tick = captureTick(setIntervalSpy);

    window.dispatchEvent(new Event('keydown'));
    mockNow += 59_000; // 59s later — still inside the 60s window
    tick();

    expect(queueEvent).toHaveBeenCalledTimes(1);

    stop();
  });

  it('getCtx() returning null (no chapter context) queues nothing', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startHeartbeat(() => null);
    const tick = captureTick(setIntervalSpy);

    window.dispatchEvent(new Event('pointerdown'));
    tick();

    expect(queueEvent).not.toHaveBeenCalled();

    stop();
  });

  it('attributes each tick to whatever getCtx() returns AT TICK TIME, not whatever it returned when startHeartbeat was called (chapter navigation mid-interval)', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    let currentCtx: { courseId: string; chapterId: string } | null = { courseId: 'c1', chapterId: 'ch1' };
    const stop = startHeartbeat(() => currentCtx);
    const tick = captureTick(setIntervalSpy);

    window.dispatchEvent(new Event('pointerdown'));
    tick();
    expect(queueEvent).toHaveBeenCalledTimes(1);

    // Simulate the reader navigating to a different chapter BETWEEN two ticks.
    currentCtx = { courseId: 'c1', chapterId: 'ch2' };
    window.dispatchEvent(new Event('pointerdown'));
    tick();
    expect(queueEvent).toHaveBeenCalledTimes(2);

    expect(vi.mocked(queueEvent).mock.calls[0][0].chapterId).toBe('ch1');
    expect(vi.mocked(queueEvent).mock.calls[1][0].chapterId).toBe('ch2');

    stop();
  });

  it('teardown clears the exact interval startHeartbeat created and removes the activity listeners', () => {
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
