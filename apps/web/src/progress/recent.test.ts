import { describe, expect, it } from 'vitest';
import type { AnnotationRow, ProgressRow } from '../db/local';
import { pickFocusCourse, pickLastStudiedCourseId, pickRecentNotes } from './recent';

function progressRow(courseId: string, updatedAt: string): ProgressRow {
  return { courseId, chapterId: 'ch', status: 'read', done: true, updatedAt };
}

function annotation(id: string, updatedAt: string, deletedAt: string | null = null): AnnotationRow {
  return {
    id,
    courseId: 'demo',
    chapterId: 'ch-1',
    anchor: { exact: 'x', color: 'y' },
    note: id,
    createdAt: updatedAt,
    updatedAt,
    deletedAt,
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
   * im lặng. `db/local.ts`'s `mergeRow` viết ra nguyên lập luận này.
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

  it('bia mộ không phải một hàng để hiển thị', () => {
    const rows = [annotation('song', '2026-08-01T00:00:00Z'), annotation('xoa', '2026-08-09T00:00:00Z', '2026-08-09T01:00:00Z')];
    expect(pickRecentNotes(rows, 5).map((row) => row.id)).toEqual(['song']);
  });

  it('hai ghi chú cùng mili giây xếp ỔN ĐỊNH, không xáo lại sau mỗi lần liveQuery phát', () => {
    const same = '2026-08-05T00:00:00Z';
    expect(pickRecentNotes([annotation('b', same), annotation('a', same)], 5).map((row) => row.id)).toEqual(['a', 'b']);
    expect(pickRecentNotes([annotation('a', same), annotation('b', same)], 5).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('`updatedAt` không đọc được vẫn cho ra một danh sách, không phải một NaN lan khắp phép sắp', () => {
    const rows = [annotation('rac', 'không phải ngày'), annotation('that', '2026-08-05T00:00:00Z')];
    expect(pickRecentNotes(rows, 5).map((row) => row.id)).toEqual(['that', 'rac']);
  });
});
