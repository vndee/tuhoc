import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same shape as sync/engine.test.ts's `vi.mock('../api/navigation', ...)`:
// the network boundary is mocked at the module level, not through msw —
// `flushEvents` cares about exactly which body reached `api.post` and how
// many times, which a mock spy answers directly.
vi.mock('./client', () => ({
  api: { post: vi.fn() },
}));

import { api } from './client';
import { flushEvents, queueEvent, startEventFlusher, type StudyEvent } from './events';

function ev(courseId: string): StudyEvent {
  return { courseId, chapterId: 'ch1', kind: 'heartbeat', meta: {}, at: '2026-09-01T00:00:00.000Z' };
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

beforeEach(() => {
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue(undefined);
  setHidden(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  setHidden(false);
});

describe('queueEvent / flushEvents', () => {
  it('ba heartbeat thành một POST /events/batch', async () => {
    queueEvent(ev('c1'));
    queueEvent(ev('c2'));
    queueEvent(ev('c3'));
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();

    await flushEvents();
    expect(vi.mocked(api.post)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe('/events/batch');
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ events: [ev('c1'), ev('c2'), ev('c3')] });
  });

  it('flush hỏng: sự kiện còn nguyên cho lần sau', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('mạng hỏng'));
    queueEvent(ev('c1'));
    await flushEvents();

    vi.mocked(api.post).mockResolvedValueOnce(undefined);
    await flushEvents();
    expect(vi.mocked(api.post).mock.calls[1][1]).toEqual({ events: [ev('c1')] });
  });

  it('hàng đợi rỗng: flushEvents không gọi mạng', async () => {
    await flushEvents();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('sự kiện tới trong lúc flush đang bay không bị gộp vào lô đang gửi, cũng không mất', async () => {
    let resolvePost!: () => void;
    vi.mocked(api.post).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePost = () => resolve(undefined);
        }),
    );

    queueEvent(ev('c1'));
    const flushing = flushEvents();
    // Queued while the first flush's request is still in flight.
    queueEvent(ev('c2'));
    resolvePost();
    await flushing;

    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ events: [ev('c1')] });

    await flushEvents();
    expect(vi.mocked(api.post)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.post).mock.calls[1][1]).toEqual({ events: [ev('c2')] });
  });
});

describe('startEventFlusher', () => {
  it('đăng ký một interval theo nhịp thưa hơn 30s của nhịp tim', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startEventFlusher();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const [, ms] = setIntervalSpy.mock.calls[0];
    expect(ms).toBeGreaterThan(30_000);

    stop();
  });

  it('tick của interval gọi flushEvents — sự kiện đang chờ được gửi đi', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startEventFlusher();
    const tick = setIntervalSpy.mock.calls[0][0] as () => void;

    queueEvent(ev('c1'));
    tick();
    await vi.waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ events: [ev('c1')] });

    stop();
  });

  it('tab chuyển sang hidden flush ngay — không đợi nhịp interval kế tiếp', async () => {
    const stop = startEventFlusher();
    queueEvent(ev('c1'));

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ events: [ev('c1')] });

    stop();
  });

  it('visibilitychange KHÔNG sang hidden (vẫn visible) thì không flush', async () => {
    const stop = startEventFlusher();
    queueEvent(ev('c1'));

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();

    stop();
  });

  it('dừng: xoá interval và gỡ listener visibilitychange', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const stop = startEventFlusher();
    const timerHandle = setIntervalSpy.mock.results[0].value;
    expect(addSpy.mock.calls.map((call) => call[0])).toContain('visibilitychange');

    stop();

    expect(clearIntervalSpy).toHaveBeenCalledWith(timerHandle);
    expect(removeSpy.mock.calls.map((call) => call[0])).toContain('visibilitychange');
  });
});
