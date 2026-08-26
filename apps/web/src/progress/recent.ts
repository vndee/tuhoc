/**
 * "Chỗ người này đang dở" và "những gì họ vừa viết" — hai câu hỏi mà trang chủ
 * mới (`pages/Dashboard.tsx`, route `/`) đặt ra, tách khỏi React để trả lời
 * được bằng một bài test thuần.
 *
 * Cả hai đọc DEXIE, không đọc mạng, và đó là một quyết định chứ không phải một
 * sự tiện tay. Trang chủ là màn hình đầu tiên mọi phiên mở ra; ruling F5 đã
 * chốt một lần rằng thứ người học thấy ở đây phải đúng khi không có mạng.
 * `GET /stats` biết tổng phút và chuỗi ngày, nhưng nó KHÔNG biết chương nào là
 * chương đang dở — nó chỉ đếm `chaptersDone` theo course. Câu trả lời cho "mở
 * cái gì bây giờ" nằm trong `db.progress`, ngay trên máy.
 *
 * `liveQuery` chứ không phải một lần đọc: một chương được đánh dấu đã đọc ở tab
 * khác, hoặc một ghi chú kéo về từ `sync/engine.ts`'s `pull()`, phải đổi được
 * màn hình này mà không cần tải lại trang — cùng tính chất `course/owned.ts`
 * đã dựa vào cho danh sách khoá học.
 */

import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import type { AnnotationRow, ProgressRow } from '../db/local';
import { db } from '../db/local';

/**
 * Course được chạm tới GẦN ĐÂY NHẤT, theo `updatedAt` của bảng `progress`.
 *
 * So sánh bằng `Date.parse`, không so chuỗi thô — cùng lý do `db/local.ts`'s
 * `mergeRow` viết ra dài dòng: máy chủ định dạng `updatedAt` bằng
 * `time.RFC3339Nano`, thứ BỎ HẲN phần thập phân khi thời điểm rơi đúng giây
 * chẵn, và `'.'` (0x2E) sắp trước `'Z'` (0x5A) nên `...00.500Z` so chuỗi lại
 * NHỎ hơn `...00Z`. Một hàng mới hơn nửa giây sẽ thua, và cái thua ấy im lặng.
 *
 * Hàng có `updatedAt` không parse được bị BỎ QUA thay vì được coi là `NaN`:
 * mọi phép so sánh với `NaN` đều `false`, nên nó sẽ không bao giờ thắng — đúng
 * hướng an toàn, nhưng do tình cờ. Lọc ra trước làm điều ấy thành cố ý.
 */
export function pickLastStudiedCourseId(rows: readonly ProgressRow[]): string | null {
  let bestId: string | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const at = Date.parse(row.updatedAt);
    if (Number.isNaN(at)) continue;
    if (at > bestAt) {
      bestAt = at;
      bestId = row.courseId;
    }
  }
  return bestId;
}

/**
 * `null` = "chưa có hàng nào"; `undefined` = "Dexie chưa trả lời".
 *
 * Hai trạng thái ấy KHÔNG được gộp: lần phát đầu tiên của `liveQuery` là bất
 * đồng bộ, nên coi giá trị khởi tạo là "không có gì" sẽ nháy trạng thái rỗng
 * vào mặt mọi người học đang có dở dang — đúng lỗi mà `course/owned.ts` đã
 * phải tách `settled` ra để tránh, và đúng lỗi mà `Dashboard.test.tsx` có một
 * bài riêng canh ("does not flash the empty-library note").
 */
export interface LastStudied {
  readonly courseId: string | null;
  readonly settled: boolean;
}

export function useLastStudiedCourseId(): LastStudied {
  const [courseId, setCourseId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const subscription = liveQuery(() => db.progress.toArray()).subscribe({
      next: (rows) => setCourseId(pickLastStudiedCourseId(rows)),
      error: (err) => {
        console.error('progress/recent: local progress query failed', err);
        // Một bảng không đọc được không được phép treo trang chủ ở "đang tải"
        // mãi mãi — `course/owned.ts` xử lý cùng một cách, vì cùng một lý do.
        setCourseId(null);
      },
    });
    return () => subscription.unsubscribe();
  }, []);

  return { courseId: courseId ?? null, settled: courseId !== undefined };
}

/**
 * Khoá học mà nút "Đọc tiếp" nói về.
 *
 * Thứ tự ưu tiên, mỗi bậc có lý do riêng:
 *
 *  1. **Khoá vừa chạm tới gần nhất** (`db.progress`). Đúng trong hầu hết mọi
 *     phiên, và nó KHÔNG cần `courseIds` trả lời xong — một hàng progress tự
 *     nó đã là quyền sở hữu, nên chờ nguồn kia chỉ làm chậm màn hình đầu tiên
 *     mà không đổi câu trả lời.
 *  2. **Khoá đầu tiên** trong `courseIds`, theo bất kỳ thứ tự chỗ gọi đã sắp
 *     sẵn — ổn định giữa các lần vẽ nếu chỗ gọi giữ thứ tự ổn định.
 *
 * Từng có một bậc thứ hai riêng — "một khoá thiết bị này ĐANG GIỮ" — cho một
 * course đã nhập vào `db.packages` nhưng chưa có hàng progress nào. Bậc ấy
 * mất đi cùng luồng import (Task 13): không còn "giữ" course nào theo nghĩa
 * đó, mọi course đọc thẳng từ máy chủ. `courseIds` giờ do chỗ gọi tự hợp từ
 * bất kỳ nguồn nào nó cho là hợp lý làm gợi ý (`pages/Dashboard.tsx` hợp danh
 * mục công khai với `stats.courses[]`) — hàm này không còn biết, và không cần
 * biết, course đến từ đâu.
 *
 * `undefined` = "chưa có gì để tiếp tục". Chỗ gọi phân biệt nó với "chưa biết"
 * bằng `settled`, KHÔNG bằng giá trị này.
 */
export function pickFocusCourse(courseIds: readonly string[], lastStudiedCourseId: string | null): string | undefined {
  if (lastStudiedCourseId !== null && lastStudiedCourseId !== '') return lastStudiedCourseId;
  return courseIds[0];
}

/* ------------------------------------------------------------------ *
 * Ghi chú gần đây
 * ------------------------------------------------------------------ */

/**
 * Ghi chú CÒN SỐNG, mới nhất trước, cắt còn `limit`.
 *
 * `deletedAt != null` là BIA MỘ, không phải một hàng đã biến mất
 * (`db/local.ts`'s `AnnotationRow`): nó phải còn nằm đó để lan sang thiết bị
 * khác. Lọc ở đây, chứ không xoá, là cách duy nhất đúng — và là lý do hàm này
 * không dùng thẳng chỉ mục `updatedAt` của Dexie mà sắp trong JS: một
 * `orderBy('updatedAt')` vẫn phải lọc bia mộ sau đó, nên nó không tiết kiệm
 * được lượt duyệt nào, trong khi so chuỗi thô của chỉ mục lại vấp đúng cái bẫy
 * RFC3339Nano mà `pickLastStudiedCourseId` vừa nói ở trên.
 */
export function pickRecentNotes(rows: readonly AnnotationRow[], limit: number): AnnotationRow[] {
  return rows
    .filter((row) => row.deletedAt === null || row.deletedAt === undefined)
    .map((row) => ({ row, at: Date.parse(row.updatedAt) }))
    .sort((a, b) => {
      const byTime = (Number.isNaN(b.at) ? 0 : b.at) - (Number.isNaN(a.at) ? 0 : a.at);
      // `id` phá hoà: hai ghi chú cùng mili giây phải xếp cùng một thứ tự ở mọi
      // lần vẽ, nếu không danh sách sẽ tự xáo lại sau mỗi lần `liveQuery` phát.
      return byTime !== 0 ? byTime : a.row.id.localeCompare(b.row.id);
    })
    .slice(0, limit)
    .map((entry) => entry.row);
}

export interface RecentNotes {
  readonly notes: readonly AnnotationRow[];
  readonly settled: boolean;
}

export function useRecentNotes(limit: number): RecentNotes {
  const [notes, setNotes] = useState<AnnotationRow[] | null>(null);

  useEffect(() => {
    const subscription = liveQuery(() => db.annotations.toArray()).subscribe({
      next: (rows) => setNotes(pickRecentNotes(rows, limit)),
      error: (err) => {
        console.error('progress/recent: local annotation query failed', err);
        setNotes([]);
      },
    });
    return () => subscription.unsubscribe();
  }, [limit]);

  return { notes: notes ?? [], settled: notes !== null };
}
