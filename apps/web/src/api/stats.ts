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

export function fetchStats(options: RequestOptions = {}): Promise<Stats> {
  return api.get<Stats>('/stats', options);
}
