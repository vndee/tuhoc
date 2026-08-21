import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type PackageRow } from '../db/local';
import { __resetCourseKitForTests, useCourseKit } from './useCourseKit';

const RUNTIME_TRIO = [
  '/course-kit/vendor/katex.js',
  '/course-kit/vendor/auto-render.js',
  '/course-kit/runtime.js',
] as const;

/** A cached `content`-tier package: prose and nothing else, which is what that tier means. */
function contentPackage(courseId: string): PackageRow {
  const manifest = {
    id: courseId,
    title: 'Gói chỉ có nội dung',
    description: '',
    lang: 'vi',
    version: '1.0.0',
    runtime: '^1',
    tier: 'content',
    parts: [{ title: 'Phần 1', chapters: [{ id: 'c1', num: '1.1', title: 'Một', short: 'Một', file: 'chapters/c1.html' }] }],
  };
  const encode = (text: string) => new TextEncoder().encode(text);
  return {
    key: `${courseId}@1.0.0`,
    courseId,
    version: '1.0.0',
    manifest,
    files: {
      'manifest.json': encode(JSON.stringify(manifest)),
      'chapters/c1.html': encode('<h1 class="ch-title">Một</h1>'),
    },
    pinnedAt: '2026-08-21T10:00:00.000Z',
  };
}

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
  beforeEach(async () => {
    __resetCourseKitForTests();
    // Which scripts a course needs is now answered by `course/loader.ts`'s
    // two-source rule, so a cached package left behind by another test
    // would change what this one requests.
    await db.packages.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Ruling S1-F14. This hook used to request `/courses/<id>/viz.js`
   * unconditionally and only report `ready: true` once it had loaded — so
   * a course with no viz.js either parked on `ready: false` forever or,
   * where the host answered the 404 with an SPA fallback, "loaded" an HTML
   * page as JavaScript. A `content`-tier package has no viz.js BY
   * DEFINITION, and `content` is the tier the registry recommends: every
   * imported content course would have been unreadable.
   */
  it('loads only the shared trio for a cached package that ships no viz.js, and still reports ready', async () => {
    await db.packages.put(contentPackage('demo'));
    const { requestedSrcs } = mockScriptLoading();

    const { result } = renderHook(() => useCourseKit('demo'));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toBeNull();
    expect(requestedSrcs).toEqual([...RUNTIME_TRIO]);
  });

  it('still requires the shared trio for a package course — a failure there is a real failure, not an absent viz.js', async () => {
    await db.packages.put(contentPackage('demo'));
    mockScriptLoading((src) => src.endsWith('runtime.js'));

    const { result } = renderHook(() => useCourseKit('demo'));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.ready).toBe(false);
    expect(result.current.error?.message).toContain('runtime.js');
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

  // Regression coverage for the bug a review caught: the singleton used to
  // be a single bare `injectPromise` that ignored `courseId` entirely, so
  // once ONE course's viz.js had loaded, useCourseKit('some-other-course')
  // resolved ready:true immediately without ever requesting that course's
  // own viz.js — silently wiring up the wrong (or no) visualizations, with
  // no error surfaced. These mount sequentially and concurrently to prove
  // that can't happen anymore.
  it('mounting for a second, different course requests that course own viz.js, without re-requesting the shared runtime trio', async () => {
    const { requestedSrcs } = mockScriptLoading();

    const courseA = renderHook(() => useCourseKit('course-a'));
    await waitFor(() => expect(courseA.result.current.ready).toBe(true));
    expect(requestedSrcs).toEqual([
      '/course-kit/vendor/katex.js',
      '/course-kit/vendor/auto-render.js',
      '/course-kit/runtime.js',
      '/courses/course-a/viz.js',
    ]);

    const courseB = renderHook(() => useCourseKit('course-b'));
    await waitFor(() => expect(courseB.result.current.ready).toBe(true));

    // Exactly one new request — course-b's own viz.js. The shared trio,
    // already loaded for course A, is not re-requested.
    expect(requestedSrcs).toEqual([
      '/course-kit/vendor/katex.js',
      '/course-kit/vendor/auto-render.js',
      '/course-kit/runtime.js',
      '/courses/course-a/viz.js',
      '/courses/course-b/viz.js',
    ]);
  });

  it('two different courses mounted concurrently (before the shared trio has even loaded) both still get their own viz.js, and the trio loads exactly once and first', async () => {
    const { requestedSrcs } = mockScriptLoading();

    const courseA = renderHook(() => useCourseKit('course-a'));
    const courseB = renderHook(() => useCourseKit('course-b'));

    await waitFor(() => expect(courseA.result.current.ready).toBe(true));
    await waitFor(() => expect(courseB.result.current.ready).toBe(true));

    expect(requestedSrcs.slice(0, 3)).toEqual([
      '/course-kit/vendor/katex.js',
      '/course-kit/vendor/auto-render.js',
      '/course-kit/runtime.js',
    ]);
    // Each course's viz.js was requested exactly once, both after the trio.
    expect(requestedSrcs.slice(3).sort()).toEqual(['/courses/course-a/viz.js', '/courses/course-b/viz.js']);
  });

  it('a courseId-specific viz.js failure does not force the shared (already-succeeded) runtime trio to reload, and only that course retries', async () => {
    const { requestedSrcs: attempt1 } = mockScriptLoading((src) => src.endsWith('viz.js'));
    const failing = renderHook(() => useCourseKit('course-a'));
    await waitFor(() => expect(failing.result.current.error).not.toBeNull());
    expect(attempt1).toEqual([
      '/course-kit/vendor/katex.js',
      '/course-kit/vendor/auto-render.js',
      '/course-kit/runtime.js',
      '/courses/course-a/viz.js',
    ]);

    vi.restoreAllMocks();
    const { requestedSrcs: attempt2 } = mockScriptLoading();
    const retry = renderHook(() => useCourseKit('course-a'));
    await waitFor(() => expect(retry.result.current.ready).toBe(true));

    // Only the failed viz.js is re-requested — the trio, which succeeded
    // on the first attempt, is not reloaded.
    expect(attempt2).toEqual(['/courses/course-a/viz.js']);
  });
});
