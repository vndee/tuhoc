/**
 * "Chỗ người này đang dở" và "những gì họ vừa viết" — hai câu hỏi mà trang chủ
 * mới (`pages/Dashboard.tsx`, route `/`) đặt ra, tách khỏi React để trả lời
 * được bằng một bài test thuần.
 *
 * ## Task 9, Pha 3: đổi nguồn, KHÔNG đổi câu hỏi
 *
 * Tới hết Task 8, cả hai đọc DEXIE qua `liveQuery` — `db.progress`/
 * `db.annotations` — và đó từng là một quyết định có chủ ý (ruling F5: trang
 * chủ là màn hình đầu tiên mọi phiên mở ra, và nó phải đúng khi không có
 * mạng). Task 9 gỡ tiền đề "không cần mạng" ấy CÓ CHỦ Ý, cùng lý do Task 6 đã
 * gỡ nó khỏi `useProgress`: tên nhánh (`pha3/du-lieu-len-may-chu`) nói đúng
 * việc đang làm — máy chủ là nguồn DUY NHẤT, và biết "chương nào đang dở"
 * không còn free về mạng nữa. Hai hook dưới đây nay đọc `GET /progress` /
 * `GET /annotations` qua TanStack Query (`api/progress.ts`, `api/annotations.ts`,
 * Task 5), đúng `progressQueryKey()`/`annotationsQueryKey()` KHÔNG tham số mà
 * `useProgress`/`useAnnotations` đã dùng — nên bốn nơi gọi (đây, cộng
 * `pages/Progress.tsx`'s `useLocalProgress`, `pages/Settings.tsx`'s đếm ghi
 * chú) chia sẻ đúng MỘT request `GET /progress` và MỘT request
 * `GET /annotations` cho toàn app, không phải bốn.
 *
 * `useQuery` chứ không phải một lần đọc: hai hook này tự động vẽ lại khi cache
 * của `progressQueryKey()`/`annotationsQueryKey()` đổi — một chương được đánh
 * dấu đã đọc (`useProgress`'s optimistic patch) hay một ghi chú mới tạo
 * (`useAnnotations`) đổi được màn hình này ngay, không cần tải lại trang,
 * cùng tính chất `liveQuery` từng cho — chỉ khác nguồn phát.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type Ann, annotationsQueryKey, fetchAnnotations } from '../api/annotations';
import { type ProgressRow, fetchProgress, progressQueryKey } from '../api/progress';

/**
 * Course được chạm tới GẦN ĐÂY NHẤT, theo `updatedAt` của bảng `progress`.
 *
 * So sánh bằng `Date.parse`, không so chuỗi thô — cùng lý do `db/local.ts`'s
 * `mergeRow` viết ra dài dòng (bản Dexie cũ của module này): máy chủ định
 * dạng `updatedAt` bằng `time.RFC3339Nano`, thứ BỎ HẲN phần thập phân khi
 * thời điểm rơi đúng giây chẵn, và `'.'` (0x2E) sắp trước `'Z'` (0x5A) nên
 * `...00.500Z` so chuỗi lại NHỎ hơn `...00Z`. Một hàng mới hơn nửa giây sẽ
 * thua, và cái thua ấy im lặng.
 *
 * Hàng có `updatedAt` không parse được bị BỎ QUA thay vì được coi là `NaN`:
 * mọi phép so sánh với `NaN` đều `false`, nên nó sẽ không bao giờ thắng — đúng
 * hướng an toàn, nhưng do tình cờ. Lọc ra trước làm điều ấy thành cố ý.
 *
 * Nhận `ProgressRow` của `api/progress.ts` (Task 5), không phải bản Dexie —
 * hai kiểu trùng hình dạng byte-for-byte (`courseId`/`chapterId`/`status`/
 * `done`/`updatedAt`), nên hàm THUẦN này không đổi một dòng nào ở Task 9;
 * chỉ nguồn nạp vào nó đổi (`useLastStudiedCourseId` bên dưới).
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
 * `null` = "chưa có hàng nào"; `undefined`/pending = "chưa có câu trả lời".
 *
 * Hai trạng thái ấy KHÔNG được gộp: lần trả lời đầu tiên của `GET /progress`
 * là bất đồng bộ, nên coi giá trị khởi tạo là "không có gì" sẽ nháy trạng
 * thái rỗng vào mặt mọi người học đang có dở dang — đúng lỗi mà
 * `course/owned.ts` từng tách `settled` ra để tránh (module đó đã gỡ ở
 * Task 13), và đúng lỗi mà `Dashboard.test.tsx` có một bài riêng canh ("does
 * not flash the empty-library note").
 */
export interface LastStudied {
  readonly courseId: string | null;
  readonly settled: boolean;
}

/**
 * Một mảng rỗng CHIA SẺ Ở MỨC MODULE, không phải `data: rows = []` của
 * `useQuery` (một mảng MỚI mỗi lần vẽ trong lúc câu hỏi chưa có dữ liệu). Xem
 * `useProgress.ts`'s `EMPTY_ROWS` — cùng bẫy, cùng cách tránh: một tham chiếu
 * mới mỗi lần vẽ sẽ vô hiệu `useMemo` bên dưới trên mọi lần vẽ trong lúc
 * `GET /progress` đang chờ hoặc đang lỗi-rồi-thử-lại.
 */
const EMPTY_PROGRESS_ROWS: ProgressRow[] = [];

export function useLastStudiedCourseId(): LastStudied {
  const { data: rows = EMPTY_PROGRESS_ROWS, isPending } = useQuery({
    queryKey: progressQueryKey(),
    queryFn: () => fetchProgress(),
  });

  const courseId = useMemo(() => pickLastStudiedCourseId(rows), [rows]);

  return { courseId, settled: !isPending };
}

/**
 * Khoá học mà nút "Đọc tiếp" nói về.
 *
 * Thứ tự ưu tiên, mỗi bậc có lý do riêng:
 *
 *  1. **Khoá vừa chạm tới gần nhất** (`GET /progress`, qua
 *     `useLastStudiedCourseId` ở trên). Đúng trong hầu hết mọi phiên, và nó
 *     KHÔNG cần `courseIds` trả lời xong — một hàng progress tự nó đã là
 *     quyền sở hữu, nên chờ nguồn kia chỉ làm chậm màn hình đầu tiên mà
 *     không đổi câu trả lời.
 *  2. **Khoá đầu tiên** trong `courseIds`, theo bất kỳ thứ tự chỗ gọi đã sắp
 *     sẵn — ổn định giữa các lần vẽ nếu chỗ gọi giữ thứ tự ổn định.
 *
 * Từng có một bậc thứ hai riêng — "một khoá thiết bị này ĐANG GIỮ" — cho một
 * course đã nhập vào `db.packages` nhưng chưa có hàng progress nào. Bậc ấy
 * mất đi cùng luồng import (Task 13): không còn "giữ" course nào theo nghĩa
 * đó, mọi course đọc thẳng từ máy chủ.
 *
 * `courseIds` là danh sách khoá NGƯỜI NÀY ĐÃ GHI DANH (`GET /enrollments`),
 * không phải danh mục công khai. Bản trước của chú thích này nói chỗ gọi được
 * hợp "bất kỳ nguồn nào nó cho là hợp lý", và `pages/Dashboard.tsx` đã hợp
 * danh mục chung vào — nên mọi tài khoản đều có một "khoá đang dở" chưa từng
 * mở. Hàm này vẫn không cần biết khoá đến từ đâu; điều đổi là chỗ gọi không
 * còn được phép đưa vào đây thứ không thuộc về người dùng.
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
 * Ghi chú mới nhất trước, cắt còn `limit`.
 *
 * Không còn lọc bia mộ ở đây. `Ann` (`api/annotations.ts`, Task 5) không có
 * `deletedAt`: migration 0009 gỡ hẳn cột tombstone, `DELETE /annotations/:id`
 * là một xoá THẬT, và `GET /annotations` không bao giờ trả một hàng đã xoá —
 * việc lọc mà bản Dexie của hàm này từng làm nay xảy ra Ở MÁY CHỦ, một lần,
 * cho mọi thiết bị, thay vì lặp lại ở từng nơi đọc `AnnotationRow[]`. Hàm này
 * vẫn không dùng chỉ mục `updatedAt` của Dexie (không còn Dexie để dùng) —
 * sắp trong JS như cũ, vì cùng cái bẫy RFC3339Nano mà
 * `pickLastStudiedCourseId` nói ở trên vẫn áp dụng cho so sánh chuỗi thô.
 */
export function pickRecentNotes(rows: readonly Ann[], limit: number): Ann[] {
  return rows
    .map((row) => ({ row, at: Date.parse(row.updatedAt) }))
    .sort((a, b) => {
      const byTime = (Number.isNaN(b.at) ? 0 : b.at) - (Number.isNaN(a.at) ? 0 : a.at);
      // `id` phá hoà: hai ghi chú cùng mili giây phải xếp cùng một thứ tự ở mọi
      // lần vẽ, nếu không danh sách sẽ tự xáo lại sau mỗi lần cache phát lại.
      return byTime !== 0 ? byTime : a.row.id.localeCompare(b.row.id);
    })
    .slice(0, limit)
    .map((entry) => entry.row);
}

export interface RecentNotes {
  readonly notes: readonly Ann[];
  readonly settled: boolean;
}

/** Xem `EMPTY_PROGRESS_ROWS` ở trên — cùng lý do, cho `annotationsQueryKey()`. */
const EMPTY_ANNOTATION_ROWS: Ann[] = [];

export function useRecentNotes(limit: number): RecentNotes {
  const { data: rows = EMPTY_ANNOTATION_ROWS, isPending } = useQuery({
    queryKey: annotationsQueryKey(),
    queryFn: () => fetchAnnotations(),
  });

  const notes = useMemo(() => pickRecentNotes(rows, limit), [rows, limit]);

  return { notes, settled: !isPending };
}
