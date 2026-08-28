import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('useCourseKit', () => {
  beforeEach(async () => {
    __resetCourseKitForTests();
  });

  /**
   * XẢ HẾT VIỆC ĐANG BAY TRƯỚC KHI GỠ MOCK — và đây là một bài học đo được,
   * không phải một phép dọn dẹp cho gọn.
   *
   * Effect của hook là một chuỗi bất đồng bộ: `ensureCourseKitRuntime()` rồi
   * mới tiêm script. Gỡ component chỉ bật cờ `cancelled`; chuỗi vẫn chạy nốt.
   * Nếu `vi.restoreAllMocks()` chạy trước khi nó tới bước tiêm,
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
      // Hai nhịp macrotask: một cho `ensureCourseKitRuntime()`, một cho bước
      // tiêm script ngay sau nó.
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

  it('surfaces an error instead of hanging on ready:false forever when a script fails to load', async () => {
    mockScriptLoading((src) => src.endsWith('runtime.js'));

    const { result } = renderHook(() => useCourseKit('demo'));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.ready).toBe(false);
    expect(result.current.error?.message).toContain('runtime.js');
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
