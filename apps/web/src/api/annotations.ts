/**
 * The client half of the annotation endpoints — apps/api/internal/userdata/
 * handler.go's `annotationItem`/`createAnnotationRequest`/
 * `patchAnnotationRequest`, field for field.
 *
 * ```
 * GET    /annotations                  -> 200 {"annotations":[{id,courseId,chapterId,anchor,note,createdAt,updatedAt}]}   every course
 * GET    /annotations?course=<slug>    -> 200 same shape, one course
 * POST   /annotations                  -> 201   body: {id,courseId,chapterId,anchor,note}   id is a client-generated uuid
 * PATCH  /annotations/:id              -> 204   body: {note?} and/or {anchor?}
 * DELETE /annotations/:id              -> 204
 * ```
 *
 * Annotations are hard-deleted — migration 0009 dropped the tombstone
 * column, so there is no `deletedAt` on the wire or in the database any
 * more, and `deleteAnnotation` below is a real `DELETE`, not a soft-delete
 * PATCH.
 *
 * A duplicate `POST` id answers 409; a `PATCH`/`DELETE` of a row belonging
 * to another account answers 404, never 403 (see the Go handler's own doc
 * comment) — both surface here as an ordinary `ApiError`, same as every
 * other endpoint in this client.
 *
 * This module is Task 5 of Pha 3 — the client-side API layer only. It has
 * no hook and no component; `useAnnotations` is rewired onto it by a later
 * task.
 */

import { api, type RequestOptions } from './client';

export interface Ann {
  id: string;
  courseId: string;
  chapterId: string;
  /** Opaque to this client — whatever the reader UI anchored the note to.
   *  Never shape-checked past "present", see `assertAnnotations` below. */
  anchor: unknown;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * TanStack Query key. `courseId` is part of the key, not a side parameter:
 * two courses are two answers, and merging them into one cache entry is
 * how a reader opens course B and sees course A's notes for a beat — same
 * reasoning `statsQueryKey` writes down for `year`.
 *
 * `undefined` keeps the `['annotations']` key — "every course" — distinct
 * from any single-course key.
 */
export function annotationsQueryKey(
  courseId?: string,
): readonly ['annotations'] | readonly ['annotations', string] {
  return courseId === undefined ? (['annotations'] as const) : (['annotations', courseId] as const);
}

/**
 * A 200 whose body parsed as JSON but is not `{annotations: Ann[]}`.
 *
 * Same guard, same reasoning, as `api/stats.ts`'s `MalformedStatsError`:
 * `api.get<T>` names a type nothing on the wire is obliged to honour.
 * Checked HERE, at the boundary, once, rather than at each `.map`.
 */
export class MalformedAnnotationsError extends Error {
  // Khai tường minh: `erasableSyntaxOnly` cấm tham số-thuộc tính (TS1294).
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    // Tiếng Anh KỸ THUẬT, có chủ ý — xem chú thích ở đầu lớp `MalformedStatsError`.
    super(`/annotations response missing or mistyped at: ${missing.join(', ')}`);
    this.name = 'MalformedAnnotationsError';
    this.missing = missing;
  }
}

/** Shape check at the boundary. `anchor` is checked only for presence, not
 *  shape — it is opaque to this client by design, see the `Ann` field
 *  comment. An empty `annotations` array is a valid answer, not a
 *  malformed one. */
export function assertAnnotations(body: unknown): Ann[] {
  const rows = (body as { annotations?: unknown } | null)?.annotations;
  if (typeof body !== 'object' || body === null || !Array.isArray(rows)) {
    throw new MalformedAnnotationsError(['(response body is not {annotations: [...]})']);
  }

  const missing: string[] = [];
  const out: Ann[] = [];

  rows.forEach((row: unknown, i) => {
    if (typeof row !== 'object' || row === null) {
      missing.push(`[${i}] (not an object)`);
      return;
    }
    const o = row as Partial<Record<keyof Ann, unknown>>;
    if (typeof o.id !== 'string') missing.push(`[${i}].id`);
    if (typeof o.courseId !== 'string') missing.push(`[${i}].courseId`);
    if (typeof o.chapterId !== 'string') missing.push(`[${i}].chapterId`);
    if (o.anchor === undefined) missing.push(`[${i}].anchor`);
    if (typeof o.note !== 'string') missing.push(`[${i}].note`);
    if (typeof o.createdAt !== 'string') missing.push(`[${i}].createdAt`);
    if (typeof o.updatedAt !== 'string') missing.push(`[${i}].updatedAt`);
    out.push(row as Ann);
  });

  if (missing.length > 0) throw new MalformedAnnotationsError(missing);
  return out;
}

/**
 * `courseId` omitted fetches every course's annotations in one request;
 * passed, it scopes the request to `?course=<slug>` — see
 * `annotationsQueryKey`'s doc comment for why those are two different
 * cache entries and must stay two different requests.
 */
export async function fetchAnnotations(courseId?: string, options: RequestOptions = {}): Promise<Ann[]> {
  const path = courseId === undefined ? '/annotations' : `/annotations?course=${encodeURIComponent(courseId)}`;
  return assertAnnotations(await api.get<unknown>(path, options));
}

/**
 * `id` is CLIENT-generated (a uuid) and supplied up front, unlike
 * `putProgress`'s row — see the Go handler's `createAnnotationRequest`
 * comment. `createdAt`/`updatedAt` are excluded from the parameter type
 * for the identical reason `progress.ts` excludes `updatedAt` from
 * `putProgress`: the server stamps both, so there is no honest client-side
 * value for either at write time.
 */
export async function createAnnotation(
  row: Omit<Ann, 'createdAt' | 'updatedAt'>,
  options: RequestOptions = {},
): Promise<void> {
  await api.post('/annotations', row, options);
}

/**
 * Edits `note` and/or `anchor` in place. Both are optional and independent
 * — sending only `{note}` leaves `anchor` untouched server-side (see the
 * Go handler's `patchAnnotationRequest` comment) — so this signature mirrors
 * that rather than requiring the caller to resend the field it did not
 * change.
 */
export async function patchAnnotation(
  id: string,
  patch: { note?: string; anchor?: unknown },
  options: RequestOptions = {},
): Promise<void> {
  await api.patch(`/annotations/${encodeURIComponent(id)}`, patch, options);
}

/**
 * A REAL delete — see this module's header on why there is no tombstone
 * verb to reach for instead.
 */
export async function deleteAnnotation(id: string, options: RequestOptions = {}): Promise<void> {
  await api.del(`/annotations/${encodeURIComponent(id)}`, options);
}
