/**
 * Client của `GET /search` — `apps/api/internal/search/handler.go`'s
 * `resultsJSON`, từng trường một.
 *
 * ```
 * GET /search?q=<chuỗi>&limit=<n>
 *   -> 200 {"courses":[…],"chapters":[…],"truncated":bool}
 *   -> 400 truy vấn ngắn hơn hai ký tự, hoặc dài quá 128 byte
 * ```
 *
 * ── VÌ SAO ĐOẠN TRÍCH LÀ BA TRƯỜNG, KHÔNG PHẢI MỘT CHUỖI KÈM CHỈ SỐ ──────
 * Máy chủ trả `before` / `match` / `after` đã cắt sẵn. Cách kia — một chuỗi
 * kèm vị trí khớp — bắt hai bên đồng ý về ĐƠN VỊ đếm: Go đếm rune, JavaScript
 * đếm đơn vị UTF-16. Tiếng Việt nằm gọn trong BMP nên hai cách đếm trùng nhau
 * và mọi bài test viết bằng tiếng Việt sẽ xanh — cho tới khi một emoji trong
 * bài làm chỗ tô sáng trượt đi, ở production, không ai bắt được.
 *
 * Hệ quả cho nơi vẽ: KHÔNG tự tìm lại chuỗi trong đoạn trích để tô sáng. Chỗ
 * khớp máy chủ tìm được là chỗ khớp duy nhất đúng — nó tìm trong văn bản đã
 * gỡ thẻ, không phải trong ba mảnh đã cắt rời.
 *
 * Đi qua `./client.ts` chứ không phải `fetch` trần như `./catalog.ts`: lý do
 * tệp kia dùng `fetch` trần là chính sách chuyển hướng-khi-401 của `api` không
 * hợp với những route công khai NÓ gọi. Route này cũng công khai, nhưng nó
 * không bao giờ trả 401 — nó trả 200 hoặc 400 — nên chính sách ấy không có
 * dịp chạm vào, và đổi lại ta thừa hưởng hàng rào JSON của `client.ts`.
 */

import { api, type RequestOptions } from './client';

/** Một khoá khớp ở tiêu đề hoặc mô tả. */
export interface CourseHit {
  slug: string;
  title: string;
  description: string;
}

/** Một chương khớp, kèm đoạn trích đã chia ba mảnh. `before`/`after` có thể
 *  mang sẵn dấu "…" ở đầu/cuối khi đoạn trích bị cắt — nơi vẽ không tự thêm. */
export interface ChapterHit {
  slug: string;
  courseTitle: string;
  chapterId: string;
  chapterTitle: string;
  before: string;
  match: string;
  after: string;
}

export interface SearchResults {
  courses: CourseHit[];
  chapters: ChapterHit[];
  /** Còn kết quả chưa trả về. Đây là thứ nút "Xem tất cả" dựa vào — và ở
   *  trang `/search` nó vẫn có thể `true`: `limit` có trần thật (30). */
  truncated: boolean;
}

/** Số ký tự tối thiểu để GỌI. Trùng `MinQueryRunes` phía máy chủ, và trùng có
 *  chủ đích: dưới ngưỡng này máy chủ trả 400, nên gọi là gọi để nhận một lỗi.
 *  Đếm bằng `Array.from`, không phải `.length` — `.length` đếm đơn vị UTF-16
 *  và sẽ nhận một emoji đơn lẻ như thể nó là hai ký tự. */
export const MIN_QUERY_LENGTH = 2;

/** Trần BYTE, trùng `MaxQueryBytes` phía máy chủ.
 *
 *  Không có bản sao này thì một chuỗi quá dài đi ra mạng, nhận về 400, và cả
 *  hai màn đều vẽ nó bằng câu "Thử lại sau một lát" — một lời khuyên SAI: chờ
 *  bao lâu cũng không đổi được gì, chỉ rút ngắn mới đổi. Ngưỡng tối thiểu đã
 *  có bản sao ngay trên; ngưỡng tối đa thì không, và đó là chỗ hở. */
export const MAX_QUERY_BYTES = 128;

/** Truy vấn đã cắt khoảng trắng có đủ dài để gửi đi không. */
export function isQueryLongEnough(raw: string): boolean {
  return Array.from(raw.trim()).length >= MIN_QUERY_LENGTH;
}

/** Quá dài so với thứ máy chủ nhận. Đếm BYTE UTF-8 như máy chủ đếm — một
 *  chuỗi tiếng Việt 128 ký tự nặng hơn 128 byte, và đếm ký tự ở đây sẽ để nó
 *  lọt ra mạng rồi nhận 400. */
export function isQueryTooLong(raw: string): boolean {
  return new TextEncoder().encode(raw.trim()).length > MAX_QUERY_BYTES;
}

/**
 * Đường dẫn tới một khoá và tới một chương.
 *
 * Hai hàm này ở ĐÂY, cạnh `ChapterHit`, vì cả hai màn tìm kiếm đều đã import
 * tệp này. Trước khi có chúng, cùng một chuỗi được gõ tay ở bốn chỗ, và bốn
 * chỗ ấy đã kịp lệch nhau một lần: hai chỗ dựng `/search?q=` với `.trim()`,
 * hai chỗ không.
 *
 * `encodeURIComponent` chứ không phải `encodeURI`: nó thoát cả `/`, nên một
 * slug thù địch `//evil.com` thành `/c/%2F%2Fevil.com` — vẫn là một đường
 * dẫn trong ứng dụng, không phải một origin khác.
 */
export function courseHref(slug: string): string {
  return `/c/${encodeURIComponent(slug)}`;
}

export function chapterHref(slug: string, chapterId: string): string {
  return `/c/${encodeURIComponent(slug)}/${encodeURIComponent(chapterId)}`;
}

/** Trang kết quả đầy đủ cho một truy vấn. */
export function searchPageHref(q: string): string {
  return `/search?q=${encodeURIComponent(q.trim())}`;
}

/**
 * Khoá cache TanStack Query. CÓ tham số — khác `enrollmentsQueryKey()` — vì
 * mỗi truy vấn là một câu trả lời riêng, và `limit` đổi nội dung câu trả lời
 * (số hit, và cả cờ `truncated`), nên nó thuộc về khoá chứ không phải một chi
 * tiết của lần gọi.
 */
export function searchQueryKey(q: string, limit: number): readonly ['search', string, number] {
  return ['search', q.trim(), limit] as const;
}

/** Một 200 parse được nhưng không phải hình dạng `SearchResults`. Cùng hàng
 *  rào, cùng lý do, như `MalformedEnrollmentsError`. */
export class MalformedSearchError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    // Tiếng Anh KỸ THUẬT, có chủ ý — câu cho người học thuộc về nơi vẽ lỗi.
    super(`/search response missing or mistyped at: ${missing.join(', ')}`);
    this.name = 'MalformedSearchError';
    this.missing = missing;
  }
}

function assertStringFields<T>(
  rows: unknown[],
  fields: readonly string[],
  label: string,
  missing: string[],
): T[] {
  const out: T[] = [];
  rows.forEach((row: unknown, i) => {
    if (typeof row !== 'object' || row === null) {
      missing.push(`${label}[${i}] (not an object)`);
      return;
    }
    const o = row as Record<string, unknown>;
    fields.forEach((f) => {
      if (typeof o[f] !== 'string') missing.push(`${label}[${i}].${f}`);
    });
    out.push(row as T);
  });
  return out;
}

/** Hai mảng RỖNG là câu trả lời hợp lệ — không tìm thấy gì — không phải một
 *  thân hỏng. Máy chủ dựng chúng bằng `make(..., len)` đúng để không gửi
 *  `null` về đây. */
export function assertSearchResults(body: unknown): SearchResults {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MalformedSearchError(['(response body is not an object)']);
  }
  const o = body as { courses?: unknown; chapters?: unknown; truncated?: unknown };
  const missing: string[] = [];
  if (!Array.isArray(o.courses)) missing.push('courses (not an array)');
  if (!Array.isArray(o.chapters)) missing.push('chapters (not an array)');
  if (typeof o.truncated !== 'boolean') missing.push('truncated');
  if (missing.length > 0) throw new MalformedSearchError(missing);

  const courses = assertStringFields<CourseHit>(
    o.courses as unknown[],
    ['slug', 'title', 'description'],
    'courses',
    missing,
  );
  const chapters = assertStringFields<ChapterHit>(
    o.chapters as unknown[],
    ['slug', 'courseTitle', 'chapterId', 'chapterTitle', 'before', 'match', 'after'],
    'chapters',
    missing,
  );

  if (missing.length > 0) throw new MalformedSearchError(missing);
  return { courses, chapters, truncated: o.truncated as boolean };
}

/**
 * `encodeURIComponent` trên truy vấn, không phải `URLSearchParams`: người dùng
 * gõ `&`, `#` và `+` trong ô tìm kiếm là chuyện thường, và cả ba đều có nghĩa
 * riêng trong một chuỗi truy vấn.
 */
export async function fetchSearch(
  q: string,
  limit: number,
  options: RequestOptions = {},
): Promise<SearchResults> {
  const path = `/search?q=${encodeURIComponent(q.trim())}&limit=${limit}`;
  return assertSearchResults(await api.get<unknown>(path, options));
}
