import { useQuery } from '@tanstack/react-query';
/**
 * The client half of `GET /stats` — apps/api/internal/stats/handler.go's
 * `statsResponse`, field for field.
 *
 * Lifted out of `pages/Dashboard.tsx` for the reason that file's own
 * `useCourses` doc gives for `GET /courses`: this is no longer the only reader
 * of the endpoint. `course/owned.ts` consults `stats.courses` to answer "which
 * courses does this reader have", and two hand-copied declarations of one
 * endpoint's response is one declaration too many — the second copy is where
 * the drift lives.
 */

import { api, type RequestOptions } from './client';

export interface DayStat {
  date: string;
  minutes: number;
}

export interface CourseStat {
  courseId: string;
  minutes: number;
  chaptersDone: number;
}

/** Một khoá và phần của nó trong MỘT năm — `?year=` mới có. */
export interface CourseYearStat {
  courseId: string;
  minutes: number;
  /** Phần của khoá này trong tổng số phút của năm, 0..1. Máy chủ tính. */
  share: number;
}

export interface Stats {
  totalMinutes: number;
  streakDays: number;
  days: DayStat[];
  courses: CourseStat[];
  /** Mọi năm có hoạt động, mới nhất trước, luôn kèm năm hiện tại. */
  years: number[];
  /** Chỉ có nội dung khi hỏi kèm `?year=`; rỗng nếu không. */
  yearCourses: CourseYearStat[];
}

/**
 * TanStack Query key. `year` là MỘT PHẦN của khoá, không phải một tham số bên
 * lề: hai năm là hai câu trả lời khác nhau, và gộp chúng vào một khoá là cách
 * chắc chắn để bấm sang 2025 rồi thấy dữ liệu 2026 trong một nhịp.
 *
 * `undefined` giữ nguyên khoá `['stats']` cũ — Bảng điều khiển và
 * `course/owned.ts` vẫn dùng chung đúng một request như trước.
 */
export function statsQueryKey(year?: number): readonly ['stats'] | readonly ['stats', number] {
  return year === undefined ? (['stats'] as const) : (['stats', year] as const);
}

/**
 * A 200 whose body parsed as JSON but is not a `Stats`.
 *
 * `api.get<Stats>` names the type; nothing on the wire is obliged to honour
 * it. Measured 2026-08-22: a body missing `days` reached `DayChart`, where
 * `days.map` threw during render and — with no error boundary at the time —
 * blanked the whole page.
 *
 * Checked HERE and not at each `.map` on purpose. Guarding call sites fixes
 * the sites you thought of: the first pass through this bug guarded
 * `stats.courses` in `course/owned.ts` and the very next test found
 * `stats.days` in `Dashboard.tsx:171` still unguarded. One check at the
 * boundary covers all four fields and every present and future consumer, and
 * it converts a render crash into the error state the callers already handle.
 */
export class MalformedStatsError extends Error {
  // Khai tường minh: `erasableSyntaxOnly` cấm tham số-thuộc tính (TS1294).
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    // Tiếng Anh KỸ THUẬT, có chủ ý — xem chú thích ở đầu lớp. Câu cho người
    // học là `dashboard.stats.error`, do `Dashboard` vẽ.
    super(`/stats response missing or mistyped at: ${missing.join(', ')}`);
    this.name = 'MalformedStatsError';
    this.missing = missing;
  }
}

/** Shape check, not schema validation: the four fields this app reads, and
 *  their coarse runtime types. Anything deeper belongs to whoever adds a
 *  field that needs it. */
export function assertStats(body: unknown): Stats {
  const missing: string[] = [];
  const o = (body ?? {}) as Partial<Record<keyof Stats, unknown>>;
  if (typeof body !== 'object' || body === null) missing.push('(response body is not an object)');
  else {
    if (typeof o.totalMinutes !== 'number') missing.push('totalMinutes');
    if (typeof o.streakDays !== 'number') missing.push('streakDays');
    if (!Array.isArray(o.days)) missing.push('days');
    if (!Array.isArray(o.courses)) missing.push('courses');
    // `years`/`yearCourses` KHÔNG vào danh sách bắt buộc, và đó là một quyết
    // định về khả năng tương thích: một máy chủ cũ hơn (chưa có lịch năm) vẫn
    // phải phục vụ được Bảng điều khiển. Chúng được chuẩn hoá bên dưới thay vì
    // bị coi là dị dạng.
  }
  if (missing.length > 0) throw new MalformedStatsError(missing);

  // Chuẩn hoá hai trường mới về mảng: mọi chỗ vẽ đều `.map` thẳng lên chúng,
  // và một `undefined` từ máy chủ cũ sẽ ném đúng kiểu lỗi mà `MalformedStatsError`
  // sinh ra để chấm dứt.
  const normalized = body as Stats;
  return {
    ...normalized,
    years: Array.isArray(o.years) ? (o.years as number[]) : [],
    yearCourses: Array.isArray(o.yearCourses) ? (o.yearCourses as CourseYearStat[]) : [],
  };
}

export async function fetchStats(year?: number, options: RequestOptions = {}): Promise<Stats> {
  const path = year === undefined ? '/stats' : `/stats?year=${year}`;
  return assertStats(await api.get<unknown>(path, options));
}

/**
 * Truy vấn thống kê học tập, dùng chung cho MỌI màn hình đọc nó.
 *
 * Trước đây hàm này là hàm riêng bên trong `pages/Dashboard.tsx`. Khi thiết kế
 * lại thứ bậc tách `/progress` ra thành một nơi chốn riêng, hai trang cùng cần
 * nó — và bản chép thứ hai là đúng chỗ trôi dạt mà dự án này đã trả giá nhiều
 * lần để tránh. Cùng `queryKey`, nên hai trang là MỘT request, không phải hai.
 */
export function useStats(year?: number) {
  return useQuery({
    queryKey: statsQueryKey(year),
    queryFn: () => fetchStats(year),
    retry: false,
  });
}
