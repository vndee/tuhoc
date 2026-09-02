import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ann } from '../api/annotations';
import type { ProgressRow } from '../api/progress';
import { fetchAnnotations } from '../api/annotations';
import { fetchProgress } from '../api/progress';
import { pickFocusCourse, pickLastStudiedCourseId, pickRecentNotes, useLastStudiedCourseId, useRecentNotes } from './recent';

// Task 9: this file's data layer moved from Dexie's `liveQuery`
// (`db.progress.toArray()`/`db.annotations.toArray()`) to TanStack Query
// over `api/progress.ts`/`api/annotations.ts` (Task 5) — the same shift
// `useProgress.test.ts` (Task 6) and `useAnnotations.test.tsx` (Task 7) made
// for their own hooks. Wire-level shape/error concerns are already covered
// by `api/progress.test.ts`/`api/annotations.test.ts` via MSW; this file
// mocks `fetchProgress`/`fetchAnnotations` directly at the module boundary
// to test the HOOKS' own logic (which course/notes win, `settled` timing)
// without depending on either Dexie or a real HTTP layer.
vi.mock('../api/progress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/progress')>();
  return { ...actual, fetchProgress: vi.fn() };
});
vi.mock('../api/annotations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/annotations')>();
  return { ...actual, fetchAnnotations: vi.fn() };
});

function progressRow(courseId: string, updatedAt: string): ProgressRow {
  return { courseId, chapterId: 'ch', status: 'read', done: true, updatedAt };
}

function annotation(id: string, updatedAt: string, overrides: Partial<Ann> = {}): Ann {
  return {
    id,
    courseId: 'demo',
    chapterId: 'ch-1',
    anchor: { exact: 'x', color: 'y' },
    note: id,
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  };
}

describe('pickLastStudiedCourseId', () => {
  it('lấy course của hàng có `updatedAt` mới nhất', () => {
    expect(
      pickLastStudiedCourseId([
        progressRow('cu', '2026-08-01T10:00:00Z'),
        progressRow('moi', '2026-08-20T10:00:00Z'),
        progressRow('giua', '2026-08-10T10:00:00Z'),
      ]),
    ).toBe('moi');
  });

  /**
   * BẪY RFC3339Nano, và nó không phải giả định: máy chủ định dạng `updatedAt`
   * bằng `time.RFC3339Nano`, thứ BỎ HẲN phần thập phân khi thời điểm rơi đúng
   * giây chẵn. `'.'` (0x2E) sắp trước `'Z'` (0x5A), nên so CHUỖI thô thì
   * `...00.500Z` nhỏ hơn `...00Z` — hàng mới hơn nửa giây thua, và cái thua ấy
   * im lặng.
   */
  it('so bằng THỜI ĐIỂM, không so chuỗi', () => {
    expect(
      pickLastStudiedCourseId([
        progressRow('cu', '2026-08-20T10:00:00Z'),
        progressRow('moi', '2026-08-20T10:00:00.500Z'),
      ]),
    ).toBe('moi');
  });

  it('hàng có `updatedAt` không đọc được bị bỏ qua, không thắng bằng NaN', () => {
    expect(pickLastStudiedCourseId([progressRow('rac', 'hôm qua'), progressRow('that', '2026-01-01T00:00:00Z')])).toBe(
      'that',
    );
    expect(pickLastStudiedCourseId([progressRow('rac', 'hôm qua')])).toBeNull();
    expect(pickLastStudiedCourseId([])).toBeNull();
  });
});

describe('pickFocusCourse', () => {
  it('khoá vừa đọc gần nhất thắng mọi thứ khác — kể cả khi courseIds rỗng', () => {
    // Một hàng progress TỰ NÓ đã là quyền sở hữu, nên chờ một danh sách
    // course khác chỉ làm chậm màn hình đầu tiên mà không đổi câu trả lời.
    expect(pickFocusCourse([], 'dang-doc')).toBe('dang-doc');
    expect(pickFocusCourse(['khac'], 'dang-doc')).toBe('dang-doc');
  });

  // Bậc "khoá thiết bị này ĐANG GIỮ" đã rời đi cùng luồng import (Task 13):
  // không còn "giữ" course nào theo nghĩa `db.packages` nữa, nên bài kiểm cũ
  // canh bậc ấy (ưu tiên một course "held" giữa hai course "không held") đã
  // xoá — không phải nới ra, mà là khái niệm nó canh không còn tồn tại.

  it('chưa đọc gì thì lấy khoá ĐẦU TIÊN của courseIds, theo thứ tự chỗ gọi đã sắp', () => {
    expect(pickFocusCourse(['a', 'b'], null)).toBe('a');
  });

  it('không có gì để tiếp tục ⇒ undefined (chỗ gọi phân biệt với "chưa biết" bằng settled)', () => {
    expect(pickFocusCourse([], null)).toBeUndefined();
    expect(pickFocusCourse([], '')).toBeUndefined();
  });
});

describe('pickRecentNotes', () => {
  it('mới nhất trước, cắt đúng `limit`', () => {
    const rows = [annotation('a', '2026-08-01T00:00:00Z'), annotation('c', '2026-08-03T00:00:00Z'), annotation('b', '2026-08-02T00:00:00Z')];
    expect(pickRecentNotes(rows, 2).map((row) => row.id)).toEqual(['c', 'b']);
  });

  // Bài "bia mộ không phải một hàng để hiển thị" đã xoá: `Ann` (Task 5) không
  // còn `deletedAt` — migration 0009 gỡ hẳn cột tombstone, và `GET
  // /annotations` không bao giờ trả một hàng đã xoá. Việc lọc bia mộ mà bản
  // Dexie của `pickRecentNotes` từng làm nay là một bất biến của máy chủ,
  // không phải một nhánh mà hàm THUẦN này còn cần canh.

  it('hai ghi chú cùng mili giây xếp ỔN ĐỊNH, không xáo lại sau mỗi lần cache phát', () => {
    const same = '2026-08-05T00:00:00Z';
    expect(pickRecentNotes([annotation('b', same), annotation('a', same)], 5).map((row) => row.id)).toEqual(['a', 'b']);
    expect(pickRecentNotes([annotation('a', same), annotation('b', same)], 5).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('`updatedAt` không đọc được vẫn cho ra một danh sách, không phải một NaN lan khắp phép sắp', () => {
    const rows = [annotation('rac', 'không phải ngày'), annotation('that', '2026-08-05T00:00:00Z')];
    expect(pickRecentNotes(rows, 5).map((row) => row.id)).toEqual(['that', 'rac']);
  });
});

/* ========================================================================
 * HAI HOOK — brief's Step 1: chứng minh chúng đọc từ MÁY CHỦ (mocked
 * `fetchProgress`/`fetchAnnotations`), không phải Dexie. Trước Task 9, cả
 * hai hook gọi `liveQuery(() => db.progress.toArray())`/
 * `liveQuery(() => db.annotations.toArray())` trực tiếp — mock hai hàm dưới
 * đây không hề chạm vào code path đó, nên những bài này ĐỎ trên bản Dexie cũ
 * (xem báo cáo Task 9, mục TDD) đúng vì lý do brief muốn: hành vi còn thiếu,
 * không phải một lỗi đánh máy trong bài test.
 * ======================================================================== */

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(fetchProgress).mockReset();
  vi.mocked(fetchAnnotations).mockReset();
});

describe('useLastStudiedCourseId — đọc từ máy chủ (GET /progress), không Dexie', () => {
  it('trả khoá của hàng `GET /progress` có `updatedAt` mới nhất', async () => {
    vi.mocked(fetchProgress).mockResolvedValue([
      progressRow('cu', '2026-08-01T10:00:00Z'),
      progressRow('moi', '2026-08-20T10:00:00Z'),
    ]);

    const { result } = renderHook(() => useLastStudiedCourseId(), { wrapper });

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.courseId).toBe('moi');
    expect(vi.mocked(fetchProgress)).toHaveBeenCalled();
  });

  it('`settled` là false trong lúc `GET /progress` chưa trả lời, và courseId là null — không nháy trạng thái rỗng', async () => {
    let resolveFetch: (rows: ProgressRow[]) => void = () => {};
    vi.mocked(fetchProgress).mockReturnValueOnce(
      new Promise<ProgressRow[]>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result } = renderHook(() => useLastStudiedCourseId(), { wrapper });

    expect(result.current.settled).toBe(false);
    expect(result.current.courseId).toBeNull();

    resolveFetch([progressRow('demo', '2026-08-01T00:00:00Z')]);
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.courseId).toBe('demo');
  });
});

describe('useRecentNotes — đọc từ máy chủ (GET /annotations), không Dexie', () => {
  it('trả ghi chú của `GET /annotations`, mới nhất trước, cắt theo limit', async () => {
    vi.mocked(fetchAnnotations).mockResolvedValue([
      annotation('a', '2026-08-01T00:00:00Z'),
      annotation('c', '2026-08-03T00:00:00Z'),
      annotation('b', '2026-08-02T00:00:00Z'),
    ]);

    const { result } = renderHook(() => useRecentNotes(2), { wrapper });

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.notes.map((row) => row.id)).toEqual(['c', 'b']);
    expect(vi.mocked(fetchAnnotations)).toHaveBeenCalled();
  });
});
