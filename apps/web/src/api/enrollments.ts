/**
 * Client của `GET/POST/DELETE /enrollments` —
 * `apps/api/internal/userdata/handler.go`'s `enrollmentItem` và
 * `createEnrollmentRequest`, từng trường một.
 *
 * ```
 * GET    /enrollments             -> 200 {"enrollments":[{courseId,createdAt}]}
 * POST   /enrollments             -> 201 no body   body: {courseId}
 * DELETE /enrollments/:courseId   -> 204 no body
 * ```
 *
 * Đây là nguồn trả lời câu "khoá nào là CỦA người này", tách hẳn khỏi
 * `api/catalog.ts` vốn trả lời "khoá nào có trên hệ thống". Trước module này
 * `pages/Dashboard.tsx` dùng câu thứ hai để trả lời câu thứ nhất — xem
 * `docs/superpowers/specs/2026-09-03-ghi-danh-khoa-hoc-design.md` §1.
 *
 * `createdAt` do MÁY CHỦ đóng dấu, nên không hàm nào ở đây nhận nó vào.
 */

import { api, type RequestOptions } from './client';

export interface Enrollment {
  courseId: string;
  createdAt: string;
}

/**
 * Khoá cache TanStack Query. Không tham số nào để biến thiên: `GET
 * /enrollments` luôn trả mọi ghi danh của người đang đăng nhập trong một lần,
 * nên chỉ có đúng một mục cache — cùng lập luận như `progressQueryKey`.
 */
export function enrollmentsQueryKey(): readonly ['enrollments'] {
  return ['enrollments'] as const;
}

/** Một 200 parse được nhưng không phải `{enrollments: Enrollment[]}`. Cùng
 *  hàng rào, cùng lý do, như `MalformedProgressError`: `api.get<T>` đặt tên
 *  cho một kiểu mà không gì trên đường truyền buộc phải tôn trọng. Chặn ở
 *  BIÊN, để mọi chỗ đọc sau này thừa hưởng thay vì tự suy lại ở từng `.map`. */
export class MalformedEnrollmentsError extends Error {
  // Khai tường minh: `erasableSyntaxOnly` cấm tham số-thuộc tính (TS1294).
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    // Tiếng Anh KỸ THUẬT, có chủ ý — câu cho người học thuộc về nơi vẽ lỗi.
    super(`/enrollments response missing or mistyped at: ${missing.join(', ')}`);
    this.name = 'MalformedEnrollmentsError';
    this.missing = missing;
  }
}

/** Mảng `enrollments` RỖNG là câu trả lời hợp lệ — một người chưa ghi danh
 *  khoá nào — không phải một thân hỏng. */
export function assertEnrollments(body: unknown): Enrollment[] {
  const rows = (body as { enrollments?: unknown } | null)?.enrollments;
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !Array.isArray(rows)) {
    throw new MalformedEnrollmentsError(['(response body is not {enrollments: [...]})']);
  }

  const missing: string[] = [];
  const out: Enrollment[] = [];

  rows.forEach((row: unknown, i) => {
    if (typeof row !== 'object' || row === null) {
      missing.push(`[${i}] (not an object)`);
      return;
    }
    const o = row as Partial<Record<keyof Enrollment, unknown>>;
    if (typeof o.courseId !== 'string') missing.push(`[${i}].courseId`);
    if (typeof o.createdAt !== 'string') missing.push(`[${i}].createdAt`);
    out.push(row as Enrollment);
  });

  if (missing.length > 0) throw new MalformedEnrollmentsError(missing);
  return out;
}

export async function fetchEnrollments(options: RequestOptions = {}): Promise<Enrollment[]> {
  return assertEnrollments(await api.get<unknown>('/enrollments', options));
}

/** Idempotent: máy chủ dùng `ON CONFLICT DO NOTHING`, nên gọi lại không tạo
 *  hàng thứ hai và KHÔNG dời `createdAt`. Một cú bấm đúp không phải sự kiện
 *  thứ hai. */
export async function createEnrollment(courseId: string, options: RequestOptions = {}): Promise<void> {
  await api.post('/enrollments', { courseId }, options);
}

/** Idempotent như trên: xoá thứ chưa ghi danh cũng trả 204. Chỉ gỡ khỏi danh
 *  sách — tiến độ và ghi chú của khoá ấy KHÔNG bị đụng tới (server-side, xem
 *  `Repo.DeleteEnrollment`). */
export async function deleteEnrollment(courseId: string, options: RequestOptions = {}): Promise<void> {
  await api.del(`/enrollments/${encodeURIComponent(courseId)}`, options);
}
