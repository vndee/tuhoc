import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCourseKitForTests, useCourseKit } from './useCourseKit';

/**
 * jsdom does not actually fetch `<script src>` resources or fire load/error
 * events for them (no network stack), so real script injection can't be
 * exercised here — this is exactly the case the task brief calls out
 * (mock the runtime rather than trying to load it for real in jsdom).
 * Instead we spy on `document.head.appendChild` to capture what would have
 * been requested, and simulate load/error ourselves.
 */
function mockScriptLoading(shouldFail: (src: string) => boolean = () => false) {
  const requestedSrcs: string[] = [];
  const spy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
    const script = node as HTMLScriptElement;
    const src = script.getAttribute('src') ?? '';
    requestedSrcs.push(src);
    queueMicrotask(() => {
      script.dispatchEvent(new Event(shouldFail(src) ? 'error' : 'load'));
    });
    return node;
  });
  return { requestedSrcs, spy };
}

describe('useCourseKit', () => {
  beforeEach(() => {
    __resetCourseKitForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('injects katex, auto-render, runtime, then the course viz.js, in that exact order', async () => {
    const { requestedSrcs } = mockScriptLoading();

    const { result } = renderHook(() => useCourseKit('demo'));
    expect(result.current).toEqual({ ready: false, error: null });

    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(requestedSrcs).toEqual([
      '/course-kit/vendor/katex.js',
      '/course-kit/vendor/auto-render.js',
      '/course-kit/runtime.js',
      '/courses/demo/viz.js',
    ]);
  });

  it('injects the four scripts only once across two mounts (a second mount reuses the singleton)', async () => {
    const { requestedSrcs } = mockScriptLoading();

    const first = renderHook(() => useCourseKit('demo'));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    expect(requestedSrcs).toHaveLength(4);

    const second = renderHook(() => useCourseKit('demo'));
    await waitFor(() => expect(second.result.current.ready).toBe(true));

    // No new <script> tags from the second mount — same 4, not 8.
    expect(requestedSrcs).toHaveLength(4);
  });

  it('surfaces an error instead of hanging on ready:false forever when a script fails to load', async () => {
    mockScriptLoading((src) => src.endsWith('runtime.js'));

    const { result } = renderHook(() => useCourseKit('demo'));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.ready).toBe(false);
    expect(result.current.error?.message).toContain('runtime.js');
  });

  it('allows a later mount to retry after a failure, instead of replaying the same rejection forever', async () => {
    const { requestedSrcs: firstAttempt } = mockScriptLoading((src) => src.endsWith('runtime.js'));
    const failing = renderHook(() => useCourseKit('demo'));
    await waitFor(() => expect(failing.result.current.error).not.toBeNull());
    expect(firstAttempt).toHaveLength(3); // katex, auto-render, runtime (which failed) — never reached viz.js

    vi.restoreAllMocks();
    const { requestedSrcs: secondAttempt } = mockScriptLoading();
    const retry = renderHook(() => useCourseKit('demo'));
    await waitFor(() => expect(retry.result.current.ready).toBe(true));
    expect(secondAttempt).toHaveLength(4);
  });
});
