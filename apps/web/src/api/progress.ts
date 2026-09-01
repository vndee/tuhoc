/**
 * The client half of `GET/PUT /progress` — apps/api/internal/userdata/
 * handler.go's `progressItem`/`putProgressRequest`, field for field.
 *
 * ```
 * GET /progress -> 200 {"progress":[{courseId,chapterId,status,done,updatedAt}]}
 * PUT /progress -> 204 no body   body: {courseId,chapterId,status,done}
 * ```
 *
 * `updatedAt` is stamped by the SERVER — see `handler.go`'s `timeLayout`
 * comment — and is never sent back on a `PUT`. That is why `putProgress`
 * below takes `Omit<ProgressRow, 'updatedAt'>` rather than the full row:
 * there is no client-side value that field could honestly hold at write
 * time, and a parameter that exists only to be ignored is worse than no
 * parameter at all.
 *
 * This module is Task 5 of Pha 3 — the client-side API layer only. It has
 * no hook and no component; `useProgress` is rewired onto it by a later
 * task.
 */

import { api, type RequestOptions } from './client';

export interface ProgressRow {
  courseId: string;
  chapterId: string;
  status: string;
  done: boolean;
  updatedAt: string;
}

/**
 * TanStack Query key. No parameter to vary it by: `GET /progress` always
 * answers every course's progress for the signed-in learner in one shot
 * (see the Go handler above), so there is exactly one cache entry to have.
 */
export function progressQueryKey(): readonly ['progress'] {
  return ['progress'] as const;
}

/**
 * A 200 whose body parsed as JSON but is not `{progress: ProgressRow[]}`.
 *
 * Same guard, same reasoning, as `api/stats.ts`'s `MalformedStatsError`:
 * `api.get<T>` names a type nothing on the wire is obliged to honour.
 * Checked HERE, at the boundary, so every present and future reader of
 * `fetchProgress` inherits the guard instead of re-deriving it at each
 * `.map`.
 */
export class MalformedProgressError extends Error {
  // Khai tường minh: `erasableSyntaxOnly` cấm tham số-thuộc tính (TS1294).
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    // Tiếng Anh KỸ THUẬT, có chủ ý — xem chú thích ở đầu lớp `MalformedStatsError`.
    // Câu cho người học thuộc về nơi vẽ lỗi, không phải ở đây.
    super(`/progress response missing or mistyped at: ${missing.join(', ')}`);
    this.name = 'MalformedProgressError';
    this.missing = missing;
  }
}

/** Shape check at the boundary: every row must carry all five fields, at
 *  their coarse runtime type. An empty `progress` array is a valid answer
 *  — a learner with no progress yet — not a malformed one. */
export function assertProgress(body: unknown): ProgressRow[] {
  const rows = (body as { progress?: unknown } | null)?.progress;
  if (typeof body !== 'object' || body === null || !Array.isArray(rows)) {
    throw new MalformedProgressError(['(response body is not {progress: [...]})']);
  }

  const missing: string[] = [];
  const out: ProgressRow[] = [];

  rows.forEach((row: unknown, i) => {
    if (typeof row !== 'object' || row === null) {
      missing.push(`[${i}] (not an object)`);
      return;
    }
    const o = row as Partial<Record<keyof ProgressRow, unknown>>;
    if (typeof o.courseId !== 'string') missing.push(`[${i}].courseId`);
    if (typeof o.chapterId !== 'string') missing.push(`[${i}].chapterId`);
    if (typeof o.status !== 'string') missing.push(`[${i}].status`);
    if (typeof o.done !== 'boolean') missing.push(`[${i}].done`);
    if (typeof o.updatedAt !== 'string') missing.push(`[${i}].updatedAt`);
    out.push(row as ProgressRow);
  });

  if (missing.length > 0) throw new MalformedProgressError(missing);
  return out;
}

export async function fetchProgress(options: RequestOptions = {}): Promise<ProgressRow[]> {
  return assertProgress(await api.get<unknown>('/progress', options));
}

/**
 * Writes one row. Idempotent overwrite, same PUT semantics `ratings.ts`'s
 * `putRating` documents: the server's primary key is `(user, courseId,
 * chapterId)`, so a repeat call is not a second event.
 *
 * `updatedAt` is deliberately excluded from `row`'s type — see this
 * module's header. Building an optimistic cache entry with a provisional
 * timestamp is a later task's problem (Task 6), not this function's.
 */
export async function putProgress(
  row: Omit<ProgressRow, 'updatedAt'>,
  options: RequestOptions = {},
): Promise<void> {
  await api.put('/progress', row, options);
}
