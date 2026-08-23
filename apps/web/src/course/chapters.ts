/**
 * Một manifest → danh sách chương PHẲNG, theo đúng thứ tự đọc.
 *
 * Tồn tại vì hai màn hình mới cùng cần đúng một con số và đúng một thứ tự:
 * `/` phải trả lời "chương kế tiếp là chương nào", `/progress` phải trả lời
 * "khoá này có bao nhiêu chương cả thảy". Hai phép duyệt riêng trên cùng một
 * cây là chỗ trôi dạt mà repo này đã trả giá nhiều lần (S1-F31), và ở đây nó
 * còn tệ hơn bình thường: hai màn hình sẽ hiển thị hai mẫu số khác nhau cho
 * cùng một khoá học, cạnh nhau, trong cùng một phiên.
 *
 * **Nhận `unknown`, không nhận `Manifest`.** `course/loader.ts`'s
 * `isManifestShape` chỉ kiểm `Array.isArray(m.parts)` — nó KHÔNG hứa gì về
 * `part.chapters`, cũng không hứa gì về từng chương. Mã cũ của trang chủ viết
 * `manifest.parts.reduce((sum, part) => sum + part.chapters.length, 0)`, và
 * một gói có một `part` không mang `chapters` sẽ ném `TypeError` giữa lúc vẽ —
 * đúng hình dạng sự cố trang trắng mà `api/stats.ts`'s `assertStats` được viết
 * ra để chặn ở phía kia. Một manifest tới từ `db.packages` (gói người dùng tự
 * nhập, không đi qua registry nào) là đường thật cho hình dạng ấy.
 *
 * Chương thiếu `id` bị BỎ QUA chứ không được cấp id giả: `id` là thứ đường dẫn
 * `/c/:courseId/:chapterId` mang đi, và một liên kết tới một chương không tồn
 * tại là một ngõ cụt có vẻ ngoài của một hành động.
 */

import type { Chapter } from './types';

export function flatChapters(manifest: unknown): Chapter[] {
  const out: Chapter[] = [];
  const parts = (manifest as { parts?: unknown } | null | undefined)?.parts;
  if (!Array.isArray(parts)) return out;

  for (const part of parts as readonly unknown[]) {
    const chapters = (part as { chapters?: unknown } | null | undefined)?.chapters;
    if (!Array.isArray(chapters)) continue;

    for (const entry of chapters as readonly unknown[]) {
      if (typeof entry !== 'object' || entry === null) continue;
      const raw = entry as Partial<Record<keyof Chapter, unknown>>;
      if (typeof raw.id !== 'string' || raw.id === '') continue;
      const title = typeof raw.title === 'string' && raw.title !== '' ? raw.title : raw.id;
      out.push({
        id: raw.id,
        num: typeof raw.num === 'string' ? raw.num : '',
        title,
        short: typeof raw.short === 'string' && raw.short !== '' ? raw.short : title,
        file: typeof raw.file === 'string' ? raw.file : '',
      });
    }
  }
  return out;
}

/** Số chương của một khoá — mẫu số của mọi thanh tiến độ trong ứng dụng. */
export function countChapters(manifest: unknown): number {
  return flatChapters(manifest).length;
}

/**
 * Chương ĐẦU TIÊN chưa đánh dấu đã đọc — thứ mà nút "Đọc tiếp" mở ra.
 *
 * Không phải "chương ngay sau chương vừa đọc": một người nhảy cóc xuống chương
 * 9 rồi quay lại sẽ bị luật ấy đẩy tới chương 10, bỏ lại đúng cái hổng mà họ
 * quay về để lấp. Luật này đưa họ về chỗ hổng đầu tiên.
 *
 * `undefined` = mọi chương đều đã đọc. Đó là một TRẠNG THÁI, không phải một
 * lỗi, và chỗ gọi vẫn phải cho ra một nút bấm được.
 */
export function nextChapter(chapters: readonly Chapter[], done: ReadonlySet<string>): Chapter | undefined {
  return chapters.find((chapter) => !done.has(chapter.id));
}
