import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCourseKitForTests, useCourseKit } from './useCourseKit';

const RUNTIME_TRIO = [
  '/course-kit/vendor/katex.js',
  '/course-kit/vendor/auto-render.js',
  '/course-kit/runtime.js',
] as const;

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

/**
 * MANIFEST TĨNH khai `tier: 'interactive'`, phục vụ cho MỌI courseId trong tệp
 * này.
 *
 * Các bài dưới đây xoá `db.packages` để mô phỏng khoá do app phục vụ TĨNH, và
 * chúng đo bộ máy tiêm script — thứ tự, singleton, thử lại — nên chúng cần một
 * khoá THỰC SỰ CÓ `viz.js`.
 *
 * Trước đây điều đó là mặc định: `resolveVizScriptUrl` trả đường dẫn viz.js cho
 * mọi khoá tĩnh, không hỏi gì. Đó chính là lỗi vừa sửa (xem
 * `course/loader.test.ts` — mở một khoá hạng `content` phục vụ tĩnh làm hỏng cả
 * trang đọc vì một tệp 404). Nay câu trả lời phụ thuộc HẠNG, nên hạng phải được
 * nói ra ở đây.
 *
 * Phục vụ manifest thật thay vì mock `resolveVizScriptUrl`: các bài này vẫn đi
 * qua đúng đường mà app đi, nên chúng còn bắt được một thay đổi ở loader làm
 * đứt dây giữa hai bên.
 */
const server = setupServer(
  http.get('/courses/:courseId/manifest.json', ({ params }) =>
    HttpResponse.json({
      id: String(params.courseId),
      title: 'Khoá tương tác',
      description: 'Có viz.js',
      lang: 'vi',
      version: '1.0.0',
      runtime: '^1',
      tier: 'interactive',
      parts: [
        {
          title: 'Phần 1',
          chapters: [{ id: 'c1', num: '1.1', title: 'Một', short: 'Một', file: 'chapters/c1.html' }],
        },
      ],
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useCourseKit', () => {
  beforeEach(async () => {
    __resetCourseKitForTests();
  });

  /**
   * XẢ HẾT VIỆC ĐANG BAY TRƯỚC KHI GỠ MOCK — và đây là một bài học đo được,
   * không phải một phép dọn dẹp cho gọn.
   *
   * Effect của hook là một chuỗi bất đồng bộ: đọc `db.packages`, rồi `fetch`
   * manifest, rồi mới tiêm script. Gỡ component chỉ bật cờ `cancelled`; chuỗi
   * vẫn chạy nốt. Nếu `vi.restoreAllMocks()` chạy trước khi nó tới bước tiêm,
   * `document.head.appendChild` đã là bản THẬT của jsdom — mà jsdom không tải
   * `<script src>` và không bao giờ bắn `load`, nên `runtimeTrioPromise` mà
   * chuỗi ấy vừa dựng lên KHÔNG BAO GIỜ settle. Bài kế tiếp gọi
   * `ensureCourseKitRuntime()` và nhận đúng cái promise chết đó.
   *
   * Triệu chứng đúng như thế: một bài mới thêm vào làm bài NGAY SAU nó hết
   * giờ với `requestedSrcs` rỗng — không phải bài mới sai, mà là bài mới để
   * lại một chuỗi đang bay.
   */
  afterEach(async () => {
    await act(async () => {
      // Ba nhịp macrotask: một cho Dexie, một cho `fetch` của msw, một cho
      // bước tiêm script ngay sau chúng.
      for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    });
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
    const { requestedSrcs } = mockScriptLoading();

    const { result } = renderHook(() => useCourseKit('demo'));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toBeNull();
    expect(requestedSrcs).toEqual([...RUNTIME_TRIO]);
  });

  it('still requires the shared trio for a package course — a failure there is a real failure, not an absent viz.js', async () => {
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
  /* ────────────────────────────────────────────────────────────────────────
     DỰNG LẠI KHÔNG ĐƯỢC LÀM TRẮNG MỘT CHƯƠNG ĐÃ CÓ SẴN
     ──────────────────────────────────────────────────────────────────────── */

  /**
   * Nửa còn lại của một bài e2e chập chờn — nửa kia ở
   * `auth/RequireAuth.test.tsx`.
   *
   * `e2e/s3.spec.ts` mở một chương, khẳng định tiêu đề đã hiện, rồi đọc
   * `#content` ngay sau và thỉnh thoảng nhận đúng 16 ký tự: "Đang tải
   * chương…". `<ChapterView>` in câu ấy khi `!courseKit.ready`, và hook này
   * giữ `ready` trong state của component — nên MỘT lần dựng lại đưa nó về
   * `false`, dù ba script của bộ chạy đã gắn global vào `window` từ lâu và
   * không còn gì để tải.
   *
   * `renderHook` thứ hai dưới đây LÀ một lần dựng lại. Phép đo là `ready` ở
   * NGAY LẦN RENDER ĐẦU — không `waitFor`, vì `waitFor` sẽ xanh y nguyên với
   * bản cũ (nó cũng ready, chỉ là một vòng IndexedDB sau) và để lọt đúng cái
   * khoảng trắng mà bài này tồn tại để bắt.
   */
  it('lần dựng lại của một khoá đã nạp xong runtime là ready NGAY, không có khoảng trắng nào', async () => {
    mockScriptLoading();

    const first = renderHook(() => useCourseKit('remount-a'));
    expect(first.result.current.ready, 'lần đầu thì chưa thể ready — chưa có script nào').toBe(false);
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    first.unmount();

    const second = renderHook(() => useCourseKit('remount-a'));
    expect(
      second.result.current.ready,
      'dựng lại một khoá đã nạp xong mà vẫn báo "chưa sẵn sàng" — trang đọc sẽ in "Đang tải chương…" đè lên chương nó đã có',
    ).toBe(true);
    expect(second.result.current.error).toBeNull();
  });

  /**
   * Và lời hứa ấy chỉ dành cho khoá ĐÃ nạp. Không có bài này thì một bản cài
   * `ready: true` vô điều kiện cũng xanh ở bài trên — và nó sẽ để
   * `<ChapterView>` gọi `initViz` trước khi `viz.js` của khoá mới chạy.
   */
  it('không hứa nhầm cho một khoá khác chưa nạp gì', async () => {
    mockScriptLoading();

    const a = renderHook(() => useCourseKit('promise-a'));
    await waitFor(() => expect(a.result.current.ready).toBe(true));

    const b = renderHook(() => useCourseKit('promise-b'));
    expect(b.result.current.ready, 'khoá-b chưa nạp viz.js của nó mà đã báo sẵn sàng').toBe(false);
    await waitFor(() => expect(b.result.current.ready).toBe(true));
  });

  /**
   * Đổi khoá GIỮA một lần mount — `<Reader>` không bị dựng lại khi chỉ đổi
   * tham số route, nên đây là đường thật, không phải một ca bịa ra.
   */
  it('đổi courseId giữa một lần mount thì thôi báo ready cho tới khi khoá MỚI nạp xong', async () => {
    mockScriptLoading();

    const view = renderHook(({ id }) => useCourseKit(id), { initialProps: { id: 'switch-a' } });
    await waitFor(() => expect(view.result.current.ready).toBe(true));

    view.rerender({ id: 'switch-b' });
    expect(
      view.result.current.ready,
      'vẫn mang câu trả lời của khoá cũ sang khoá mới — initViz sẽ chạy trên một sổ đăng ký chưa có mô phỏng nào của khoá mới',
    ).toBe(false);

    await waitFor(() => expect(view.result.current.ready).toBe(true));
  });
});
