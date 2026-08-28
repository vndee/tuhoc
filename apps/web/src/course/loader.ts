/**
 * Where a course's bytes come from: the server, and only the server.
 *
 * Through P1/S1/S2 this file resolved a course from up to three sources — a
 * package pinned in this reader's IndexedDB, a directory this repo shipped
 * statically, and a pull from the reader's library on the server into that
 * same IndexedDB — because reading offline was the feature (see this file's
 * own history for the argument). The server-side pivot
 * (`docs/superpowers/specs/2026-08-25-server-side-pivot.md`) retires that
 * promise on purpose: courses now live in Postgres behind a public, anonymous
 * catalog (Task 9's `GET /courses/*`), nobody imports a `.zip` into this
 * browser any more, and "which copy is this reader looking at" — the
 * question the old three-source model spent most of its complexity
 * answering — no longer has more than one honest answer.
 *
 * So this module is now a thin, deliberately dumb adapter: it keeps the
 * names and the query key every caller (`ChapterView`, `Reader`,
 * `CourseHome`, `Sidebar`, `pages/Library`, ...) already imports, and
 * delegates the actual fetching to `api/catalog.ts`, which knows the URLs
 * and the wire shapes.
 */

import { CourseFetchError, fetchChapter, fetchManifest, type ChapterPayload } from '../api/catalog';
import type { Translate } from '../i18n';
import type { Manifest } from './types';

export { CourseFetchError };
export type { ChapterPayload };

/**
 * TanStack Query key for a course's manifest — shared by every place that
 * fetches it (`CourseHome`, `Sidebar`) so they hit the same cache entry
 * instead of double-fetching the same manifest.
 */
export function manifestQueryKey(courseId: string): readonly [string, string] {
  return ['course-manifest', courseId] as const;
}

/** A course's manifest, straight off the public catalog. Rejects with `CourseFetchError` on a non-2xx (404 = no such course). */
export async function loadManifest(courseId: string): Promise<Manifest> {
  return fetchManifest(courseId);
}

/**
 * One chapter's rendered HTML, plus its widgets — `chapterId` is the
 * manifest chapter's `id` field, not its `file` path; the server resolves
 * that itself. Rejects with `CourseFetchError` on a non-2xx (404 = this
 * chapter, or this course, does not exist).
 *
 * Callers that only need the manifest first (every one today: `Reader`
 * finds the chapter in the manifest before rendering it) get that lookup
 * for free out of TanStack Query's cache under `manifestQueryKey` — this
 * function does not re-fetch or re-validate the manifest itself.
 */
export async function loadChapter(courseId: string, chapterId: string): Promise<ChapterPayload> {
  return fetchChapter(courseId, chapterId);
}

/**
 * Vietnamese, human-readable summary of a course-loading failure, for
 * surfaces that show it directly to a learner (`CourseHome`, `Sidebar`,
 * `Reader`, `ChapterView`). `CourseFetchError#message` is an English
 * technical string (kept for the console/bug reports, alongside its own
 * `url`/`status` fields) — not something to put in front of a
 * Vietnamese-language UI.
 *
 * 404 and "no response at all" are deliberately different sentences: a 404
 * says "this course/chapter is gone," while a network failure (a bare
 * `TypeError` from `fetch` — offline, DNS, CORS) says "we could not reach
 * the server." The latter is not a `CourseFetchError` at all (no response
 * ever arrived to build one from), so it falls through to the generic
 * branch below rather than being misreported as "not found."
 */
export function describeCourseError(error: unknown, t: Translate): string {
  if (error instanceof CourseFetchError) {
    return error.status === 404 ? t('course.error.notFound') : t('course.error.http', String(error.status));
  }
  return t('course.error.unknown');
}
