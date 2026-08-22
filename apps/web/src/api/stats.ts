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

export interface Stats {
  totalMinutes: number;
  streakDays: number;
  days: DayStat[];
  courses: CourseStat[];
}

/** TanStack Query key for the study-time summary, shared by every surface that reads it. */
export function statsQueryKey(): readonly ['stats'] {
  return ['stats'] as const;
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
  }
  if (missing.length > 0) throw new MalformedStatsError(missing);
  return body as Stats;
}

export async function fetchStats(options: RequestOptions = {}): Promise<Stats> {
  return assertStats(await api.get<unknown>('/stats', options));
}
