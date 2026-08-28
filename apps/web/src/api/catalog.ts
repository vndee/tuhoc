/**
 * The client half of the public course-catalog endpoints (Task 9,
 * `apps/api/internal/catalog`) — the ONE place a course's bytes come from now
 * that the server is the source of truth (spec §2.4,
 * `docs/superpowers/specs/2026-08-25-server-side-pivot.md`). Public, no
 * account required, no local cache, no fallback source: a course is served
 * over the wire or it does not exist.
 *
 * ```
 * GET /courses                            → CatalogCourse[]
 * GET /courses/:slug                      → Manifest                | 404
 * GET /courses/:slug/chapters/:chapterId  → ChapterPayload          | 404
 * GET /courses/:slug/assets/*             → bytes                   | 404
 * ```
 *
 * `course/loader.ts` is the thin layer above this one that keeps the names
 * its callers (`ChapterView`, `Reader`, `CourseHome`, `Sidebar`, ...) already
 * use; this file is the one that knows the URLs and the wire shapes.
 *
 * Plain `fetch`, not `./client.ts`'s `api` object: these four endpoints are
 * public and unauthenticated, so `api`'s cookie/401-redirect policy does not
 * apply, and `CourseFetchError` (below) predates `ApiError` as the name every
 * caller of `course/loader.ts` already imports.
 *
 * `getJson` below DOES reuse three of `client.ts`'s pure, auth-independent
 * pieces — `NotJsonError`, `isJsonContainer`, `jsonBodyPreview` — same
 * precedent as `admin/adminApi.ts`. Final whole-branch review, Important 3:
 * a bare `getJson` calling `res.json()` directly throws an unhandled
 * `SyntaxError` on the exact SPA-fallback body (`200 text/html`) that a
 * `VITE_API_URL`-less local dev server answers `/courses` with (see
 * `.env.example`'s own note on that three-way path collision) — this file
 * had never guarded against it at all, unlike `client.ts`/`adminApi.ts`.
 */

import { isJsonContainer, jsonBodyPreview, NotJsonError } from './client';
import type { Manifest } from '../course/types';

/** Same pattern as `api/client.ts`'s own `BASE_URL` — empty in dev/test, the API's own origin in production. */
const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/** `GET /courses`'s wire shape — one row per published course. */
export interface CatalogCourse {
  slug: string;
  title: string;
  lang: string;
  description: string;
  version: number;
}

/**
 * `GET /courses/:slug/chapters/:chapterId`'s wire shape.
 *
 * `widgets` rides along unused by Task 10 — Task 11 renders each one inside
 * a sandboxed iframe (spec §2.3). Kept on the type and threaded through
 * `loadChapter` regardless, so nothing here has to change shape twice.
 */
export interface ChapterPayload {
  html: string;
  widgets: { name: string; html: string }[];
}

/**
 * Thrown when a catalog request does not come back 2xx: a course, a chapter,
 * or an asset the server does not (or no longer) have. Carries the numeric
 * `status` so callers can distinguish 404 ("this does not exist") from
 * anything else, and `url` for whoever ends up debugging a 500.
 */
export class CourseFetchError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`Failed to fetch course asset: HTTP ${status} at ${url}`);
    this.name = 'CourseFetchError';
    this.url = url;
    this.status = status;
  }
}

/** `${BASE_URL}${path}` — bare, possibly relative. Fine as a DOM attribute (`<img src>`); NOT fine to hand to `fetch` — see `absoluteUrl`. */
function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

function coursePath(slug: string): string {
  return `/courses/${encodeURIComponent(slug)}`;
}

/**
 * `apiUrl(path)`, forced absolute.
 *
 * `fetch` needs this even though a browser's own `<img src>`/`<script src>`
 * do not: a RELATIVE url is not guaranteed to resolve consistently across
 * every `fetch` implementation this app runs under, and that is a measured
 * fact, not a theoretical one — dropping this step here reproduced a real
 * failure, `TypeError: Failed to parse URL from /courses/demo` thrown by
 * Node's fetch before the request ever reached MSW, which silently broke
 * `UpdateDialog`'s chapter-name lookup. `course/loader.ts`'s old `assetUrl`
 * carried the identical fix for the identical reason.
 *
 * `window.location.origin` is only ever the FALLBACK base for a relative
 * `path`; when `BASE_URL` is itself a full origin (production, a
 * different-origin API), `new URL` parses `path` directly and the base goes
 * unused.
 */
function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

/**
 * `allowArray`: `fetchCatalog` (below) is the one caller of this function
 * whose success shape is genuinely an array (`CatalogCourse[]`) — every
 * other caller (`fetchManifest`, `fetchChapter`) expects a single object,
 * so the default requires one. See `client.ts`'s `isJsonContainer` for why
 * this cannot be inferred from `T` at runtime.
 */
async function getJson<T>(path: string, options: { allowArray?: boolean } = {}): Promise<T> {
  const url = absoluteUrl(path);
  const res = await fetch(url);
  if (!res.ok) throw new CourseFetchError(url, res.status);

  // Not a bare `res.json()`: that throws a raw, unhandled `SyntaxError` on
  // a 200 whose body isn't JSON at all (the SPA-fallback `text/html` this
  // file's own header now documents), and would silently accept `null`/a
  // primitive/an unwanted array as `T` even when it IS valid JSON. Mirrors
  // `client.ts`'s `parseBody` + `isJsonContainer` guard exactly, reusing
  // both rather than a third copy of the same two checks.
  const text = await res.text();
  let parsed: unknown;
  if (text === '') {
    parsed = undefined;
  } else {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!isJsonContainer(parsed, { allowArray: options.allowArray })) {
    throw new NotJsonError(res.status, res.headers.get('content-type'), jsonBodyPreview(parsed));
  }
  return parsed as T;
}

/** The public catalog: every published course, free to read. */
export function fetchCatalog(): Promise<CatalogCourse[]> {
  return getJson<CatalogCourse[]>(apiUrl('/courses'), { allowArray: true });
}

/**
 * TanStack Query key for the catalog listing, shared by every screen that
 * reads it (`pages/Courses.tsx` today) — same convention as
 * `manifestQueryKey` below and `api/stats.ts`'s `statsQueryKey`, so two
 * screens asking the same question share one cache entry instead of two
 * requests.
 */
export function catalogQueryKey(): readonly ['catalog'] {
  return ['catalog'] as const;
}

/** `slug`'s manifest, verbatim off the server — no client-side shape/runtime check any more (see `course/loader.ts`'s doc comment for why). */
export function fetchManifest(slug: string): Promise<Manifest> {
  return getJson<Manifest>(apiUrl(coursePath(slug)));
}

/** One chapter's rendered HTML plus its widgets, or a rejected `CourseFetchError` (404 when the chapter — or the course — does not exist). */
export function fetchChapter(slug: string, chapterId: string): Promise<ChapterPayload> {
  return getJson<ChapterPayload>(apiUrl(`${coursePath(slug)}/chapters/${encodeURIComponent(chapterId)}`));
}

/**
 * One asset's URL inside `slug`'s package — an `<img src>`/similar target,
 * never fetched from here (never routed through `absoluteUrl`, unlike the
 * three functions above: a DOM attribute is resolved by the browser against
 * the document, so a bare relative path is exactly what should be handed
 * back). Every path segment is percent-encoded individually and the
 * separators are kept, matching `api/courses.ts`'s `assetPath`: `relPath` is
 * a package-relative PATH ("images/fig1.png"), so encoding it whole would
 * turn its slashes into `%2F` and address a file that does not exist.
 */
export function assetUrl(slug: string, relPath: string): string {
  const segments = relPath
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  return apiUrl(`${coursePath(slug)}/assets/${segments}`);
}
