import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProgress, putProgress, type ProgressRow } from '../api/progress';
import { useProgress } from './useProgress';

// Task 6: the hook's data layer moved from Dexie's `liveQuery` (this
// file's pre-Task-6 version drove everything off `db.progress`/`db.outbox`
// — see git history) to TanStack Query over Task 5's `api/progress.ts`.
// Every wire-level shape/error-handling concern (`assertProgress`,
// `MalformedProgressError`, the exact PUT/GET bytes) is already covered by
// `api/progress.test.ts` via MSW; this file mocks `putProgress`/
// `fetchProgress` directly at the module boundary instead, because it is
// testing the HOOK's own logic — optimistic patch, rollback, stable
// identities — not the HTTP contract underneath it.
vi.mock('../api/progress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/progress')>();
  return {
    ...actual,
    fetchProgress: vi.fn(),
    putProgress: vi.fn(),
  };
});

function row(over: Partial<ProgressRow> = {}): ProgressRow {
  return {
    courseId: 'c',
    chapterId: 'c1',
    status: 'read',
    done: true,
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

// Plain `React.createElement` (no JSX) — this file stays `.ts`, per the
// task brief's own file list, and `.ts` cannot parse JSX syntax.
let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

/**
 * `serverRows` is a tiny in-memory stand-in for the backend `putProgress`
 * writes to and `fetchProgress` reads from. `onSettled` (see useProgress.ts)
 * always invalidates and refetches after a mutation, real backend or not —
 * a `fetchProgress` mock that always resolves `[]`, independent of what
 * was just PUT, would make every test that toggles-then-awaits-settling
 * flake: the refetch would clobber the very row the test just wrote, for a
 * reason that has nothing to do with the hook (an unrealistic double). Mirroring
 * the two functions against one shared array is what a real server does for
 * free and keeps these tests honest about what "settled" means.
 */
let serverRows: ProgressRow[];

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  serverRows = [];
  vi.mocked(fetchProgress)
    .mockReset()
    .mockImplementation(async () => serverRows.map((r) => ({ ...r })));
  vi.mocked(putProgress)
    .mockReset()
    .mockImplementation(async (put) => {
      const idx = serverRows.findIndex(
        (r) => r.courseId === put.courseId && r.chapterId === put.chapterId && r.status === put.status,
      );
      const saved: ProgressRow = { ...put, updatedAt: new Date().toISOString() };
      if (idx === -1) serverRows.push(saved);
      else serverRows[idx] = saved;
    });
});

/* ========================================================================
 * GHI LẠC QUAN — ba kịch bản bắt buộc của brief (Step 1–3), verbatim.
 * ======================================================================== */

describe('useProgress — ghi lạc quan (Query + mutation, không còn outbox)', () => {
  it('toggleRead lật trạng thái ngay lập tức, không chờ server', async () => {
    let resolvePut: () => void = () => {};
    vi.mocked(putProgress).mockReturnValueOnce(
      new Promise<void>((r) => {
        resolvePut = r;
      }),
    );

    const { result } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(result.current.isRead('c1')).toBe(false));

    act(() => result.current.toggleRead('c1'));
    expect(result.current.isRead('c1')).toBe(true); // chưa resolve — đây là phần "lạc quan"

    await act(async () => {
      resolvePut();
    });
  });

  it('put hỏng thì trạng thái quay về giá trị cũ', async () => {
    vi.mocked(putProgress).mockRejectedValueOnce(new Error('mạng hỏng'));
    const { result } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(result.current.isRead('c1')).toBe(false));

    act(() => result.current.toggleRead('c1'));
    await waitFor(() => expect(result.current.isRead('c1')).toBe(false));
  });

  it('lật hai lần nhanh kết thúc ở trạng thái cuối — không bị một GET /progress đang bay đè lên', async () => {
    // Dựng ĐÚNG cái đua `onMutate`'s `cancelQueries` phải thắng, tách khỏi
    // hiệu ứng "rồi cũng đúng thôi" của `onSettled`'s invalidate+refetch:
    // giữ CẢ BA request (GET /progress lần mount, và cả hai PUT) treo lơ
    // lửng, có kiểm soát — không cái nào trong chúng được phép tự resolve
    // và làm nhòe thời điểm ta thực sự muốn quan sát.
    let resolveInitialFetch: (rows: ProgressRow[]) => void = () => {};
    vi.mocked(fetchProgress).mockReturnValueOnce(
      new Promise<ProgressRow[]>((resolve) => {
        resolveInitialFetch = resolve;
      }),
    );
    let resolvePut1: () => void = () => {};
    let resolvePut2: () => void = () => {};
    vi.mocked(putProgress)
      .mockReturnValueOnce(new Promise<void>((r) => (resolvePut1 = r)))
      .mockReturnValueOnce(new Promise<void>((r) => (resolvePut2 = r)));

    const { result } = renderHook(() => useProgress('c'), { wrapper });
    // Đúng false ngay từ đầu — `rows` mặc định rỗng khi query còn pending,
    // không cần chờ lần fetch đầu tiên trả lời để bắt đầu lật.
    expect(result.current.isRead('c1')).toBe(false);

    act(() => {
      result.current.toggleRead('c1');
      result.current.toggleRead('c1');
    });
    // Cả hai PUT đã lên đường (đang treo), và bản vá lạc quan trong cache
    // đã đúng — nhưng CHƯA mutation nào settle, nên `onSettled`'s
    // invalidate+refetch chưa hề chạy. Đây là khoảnh khắc DUY NHẤT nơi
    // hiệu ứng của `cancelQueries` (có hay không) còn quan sát được trước
    // khi cơ chế tự-sửa của `onSettled` xoá dấu vết của nó.
    //
    // `waitFor`, không phải một khẳng định đồng bộ ngay sau `act()`: gọi
    // `mutationFn` (nên `putProgress`) là việc `onMutate` — một hàm `async`
    // — làm SAU khi promise của chính nó resolve, tức trễ ít nhất một
    // microtask so với việc gọi `mutate()`, bất kể `cancelQueries` có mặt
    // hay không. Đây là độ trễ CỦA REACT QUERY, không phải điều bài này
    // đang đo.
    await waitFor(() => expect(vi.mocked(putProgress)).toHaveBeenCalledTimes(2));

    // GET /progress lần đầu GIỜ MỚI trả lời — với dữ liệu MÂU THUẪN với kết
    // quả đúng của hai cú lật (nó nói "đã đọc"), y hệt một response cũ tới
    // muộn sau khi hai cú lật đã chạy. Nếu `onMutate` không `cancelQueries`
    // request này TRƯỚC khi vá cache, dispatch 'success' của nó sẽ đè lên
    // cả hai bản vá lạc quan NGAY BÂY GIỜ — trước khi bất cứ PUT nào kịp
    // settle để tự sửa lại. Đây là bài kiểm tra thật của ruling đó.
    await act(async () => {
      resolveInitialFetch([row({ chapterId: 'c1', done: true })]);
    });
    expect(result.current.isRead('c1')).toBe(false);

    // Dọn dẹp: để cả hai PUT settle bình thường, không rơi vào "unhandled
    // rejection"/promise treo mãi khi test kết thúc.
    await act(async () => {
      resolvePut1();
      resolvePut2();
    });
    await waitFor(() => expect(result.current.isRead('c1')).toBe(false));
  });

  it('R2: cache lạc quan có updatedAt tạm, nhưng putProgress KHÔNG bao giờ nhận nó', async () => {
    const { result } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(result.current.isRead('c1')).toBe(false));

    act(() => result.current.toggleRead('c1'));

    // Bản vá lạc quan trong cache có updatedAt — đó là điều làm `isRead` đúng
    // NGAY LẬP TỨC, không cần chờ mutationFn (đồng bộ, kiểm tra được ngay).
    const cached = queryClient.getQueryData<ProgressRow[]>(['progress']);
    expect(cached?.find((r) => r.chapterId === 'c1')?.updatedAt).toEqual(expect.any(String));

    // Nhưng thứ THỰC SỰ gửi lên máy chủ (mutationFn, chạy sau một microtask)
    // thì đúng bốn trường, không updatedAt — putProgress's own variables
    // argument is the ONLY thing that reaches the wire (`api/progress.ts`'s
    // `putProgress` param type is `Omit<ProgressRow, 'updatedAt'>`).
    await waitFor(() => expect(vi.mocked(putProgress)).toHaveBeenCalled());
    const sent = vi.mocked(putProgress).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).toEqual({ courseId: 'c', chapterId: 'c1', status: 'read', done: true });
    expect(sent).not.toHaveProperty('updatedAt');
  });

  it('saveError bật lên khi put hỏng, và tắt lại ở lần lật kế tiếp', async () => {
    vi.mocked(putProgress).mockRejectedValueOnce(new Error('mạng hỏng'));
    const { result } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(result.current.saveError).toBe(false));

    act(() => result.current.toggleRead('c1'));
    await waitFor(() => expect(result.current.saveError).toBe(true));

    vi.mocked(putProgress).mockResolvedValueOnce(undefined);
    act(() => result.current.toggleRead('c1'));
    await waitFor(() => expect(result.current.saveError).toBe(false));
  });
});

/* ========================================================================
 * HỢP ĐỒNG CŨ — isRead/exDone/doneChapterIds/partStats/nhận diện hàm ổn
 * định, giữ nguyên qua kiến trúc mới (CourseNav/Dashboard/ChapterView
 * không phải sửa).
 * ======================================================================== */

describe('useProgress — đọc chương', () => {
  it('isRead false khi chưa có hàng tiến độ nào', async () => {
    const { result } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(result.current.isRead('ch1')).toBe(false));
  });

  it('toggleRead rồi toggleRead lần nữa quay lại false, gửi hai PUT khác `done`', async () => {
    const { result } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(result.current.isRead('ch1')).toBe(false));

    act(() => result.current.toggleRead('ch1'));
    await waitFor(() => expect(result.current.isRead('ch1')).toBe(true));
    // Để mutation đầu SETTLE hẳn (mutationFn + onSettled's invalidate/refetch)
    // trước khi lật lần hai — nếu không, `isRead` (đã đúng, lạc quan) và
    // trạng thái máy chủ giả lập có thể tạm thời lệch nhau một nhịp.
    await waitFor(() => expect(serverRows).toHaveLength(1));

    act(() => result.current.toggleRead('ch1'));
    await waitFor(() => expect(result.current.isRead('ch1')).toBe(false));

    expect(vi.mocked(putProgress).mock.calls.map((c) => c[0].done)).toEqual([true, false]);
  });

  it('doneChapterIds phản ánh đúng các chương đã đọc của KHOÁ NÀY, không hơn không kém', async () => {
    const { result } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(result.current.isRead).toBeDefined());

    act(() => result.current.toggleRead('ch1'));
    act(() => result.current.toggleRead('ch2'));
    await waitFor(() => expect(result.current.doneChapterIds.has('ch1')).toBe(true));
    await waitFor(() => expect(result.current.doneChapterIds.has('ch2')).toBe(true));
    expect(result.current.doneChapterIds.size).toBe(2);
  });

  it('dữ liệu tách theo courseId: một hàng của khoá KHÁC không lọt vào isRead/doneChapterIds', async () => {
    serverRows.push(row({ courseId: 'other-course', chapterId: 'ch1' }));

    const { result } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(vi.mocked(fetchProgress)).toHaveBeenCalled());

    expect(result.current.isRead('ch1')).toBe(false);
    expect(result.current.doneChapterIds.has('ch1')).toBe(false);
  });

  it('phản ứng với một hàng tiến độ tới từ NGOÀI hook (một GET /progress khác vừa trả về)', async () => {
    const { result } = renderHook(() => useProgress('c'), { wrapper });
    expect(result.current.isRead('ch1')).toBe(false);

    queryClient.setQueryData<ProgressRow[]>(['progress'], [row({ chapterId: 'ch1' })]);

    await waitFor(() => expect(result.current.isRead('ch1')).toBe(true));
  });
});

describe('useProgress — bài tập', () => {
  it('exDone/toggleEx dùng chuỗi "ex:<n>", độc lập theo từng chỉ số bài tập', async () => {
    const { result } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(result.current.isRead).toBeDefined());

    act(() => result.current.toggleEx('ch1', 0));
    await waitFor(() => expect(result.current.exDone('ch1', 0)).toBe(true));
    expect(result.current.exDone('ch1', 1)).toBe(false);

    await waitFor(() => expect(vi.mocked(putProgress)).toHaveBeenCalled());
    expect(vi.mocked(putProgress).mock.calls[0]?.[0]).toEqual({
      courseId: 'c',
      chapterId: 'ch1',
      status: 'ex:0',
      done: true,
    });
  });

  it('lật bài tập n không ảnh hưởng isRead của chương, và ngược lại', async () => {
    const { result } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(result.current.isRead).toBeDefined());

    act(() => result.current.toggleEx('ch1', 0));
    await waitFor(() => expect(result.current.exDone('ch1', 0)).toBe(true));
    expect(result.current.isRead('ch1')).toBe(false);

    act(() => result.current.toggleRead('ch1'));
    await waitFor(() => expect(result.current.isRead('ch1')).toBe(true));
    expect(result.current.exDone('ch1', 0)).toBe(true);
  });
});

describe('useProgress — partStats', () => {
  it('đếm đúng số chương đã đọc và số bài tập đã xong, kể cả khi bỏ đánh dấu', async () => {
    const { result } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(result.current.partStats).toEqual({ chaptersRead: 0, exercisesDone: 0 }));

    act(() => result.current.toggleRead('ch1'));
    act(() => result.current.toggleRead('ch2'));
    act(() => result.current.toggleEx('ch1', 0));
    act(() => result.current.toggleEx('ch1', 1));

    await waitFor(() => expect(result.current.partStats).toEqual({ chaptersRead: 2, exercisesDone: 2 }));

    // Un-mark one chapter and one exercise — counts must go back down, not just up.
    act(() => result.current.toggleRead('ch2'));
    act(() => result.current.toggleEx('ch1', 0));

    await waitFor(() => expect(result.current.partStats).toEqual({ chaptersRead: 1, exercisesDone: 1 }));
  });

  it('không đếm hàng của khoá khác vào partStats của instance này', async () => {
    serverRows.push(row({ courseId: 'other-course', chapterId: 'chX' }));

    const { result } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(vi.mocked(fetchProgress)).toHaveBeenCalled());

    act(() => result.current.toggleRead('ch1'));
    await waitFor(() => expect(result.current.partStats.chaptersRead).toBe(1));
  });
});

describe('useProgress — nhận diện hàm ổn định', () => {
  it('toggleRead/toggleEx/isRead/exDone giữ cùng identity qua các lần render lại (an toàn làm dependency của effect)', async () => {
    const { result, rerender } = renderHook(() => useProgress('c'), { wrapper });
    await waitFor(() => expect(result.current.isRead).toBeDefined());

    const first = result.current;
    rerender();
    const second = result.current;

    expect(second.toggleRead).toBe(first.toggleRead);
    expect(second.toggleEx).toBe(first.toggleEx);
    expect(second.isRead).toBe(first.isRead);
    expect(second.exDone).toBe(first.exDone);
  });
});
