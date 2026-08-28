/**
 * The client half of the admin catalog API — Task 8's write path
 * (`apps/api/internal/catalog/handler.go`), field for field.
 *
 * ```
 * GET    /admin/courses                  → AdminCourseRow[]
 * PUT    /admin/courses/:slug            body = raw .zip bytes, Content-Type: application/zip
 *                                         → 201 PublishResult | 400 {error, findings}
 * DELETE /admin/courses/:slug            → 200 (unpublish)
 * POST   /admin/courses/:slug/rollback   body {"version": N}
 *                                         → 201 PublishResult | 400 {error, findings}
 * ```
 *
 * No React, no TanStack Query — `admin/AdminCourses.tsx` owns the screen and
 * the `useQuery`/`useMutation` wiring; this file only knows URLs and wire
 * shapes, same split as `api/ratings.ts` / `api/discussions.ts` against the
 * components that render them.
 *
 * ## Why this file does not just call `../api/client.ts`'s `api` object
 *
 * `client.ts`'s `Method` union is `'GET' | 'POST' | 'PUT'` (its own doc
 * comment explains the omissions: PUT joined for ratings, "No DELETE:
 * nothing in this app removes a rating"), and every one of its verbs
 * JSON-encodes the body. Two of these four endpoints do not fit that:
 * Publish's body is raw ZIP BYTES under `Content-Type: application/zip`,
 * never JSON, and Unpublish is a DELETE. Rather than widen a file every
 * OTHER feature in this app already depends on for two admin-only routes,
 * `adminRequest` below reimplements the same three-part contract locally —
 * `credentials: 'include'`, the identical 401 → `redirectToLogin` policy,
 * the identical "non-2xx → `ApiError` carrying the parsed body" shape — so
 * `List` and `Rollback`, which ARE plain JSON, still go through the shared
 * `api.get`/`api.post` and only Publish/Unpublish pay for the local copy.
 *
 * **This duplication has already bitten once** (review round 1, finding
 * 2): `client.ts`'s `request<T>` additionally guards against a 2xx whose
 * body is not JSON — the SPA-fallback shape `NotJsonError`'s own doc
 * comment documents from a measured 2026-08-22 incident, where such a
 * response was silently typed as real data and white-screened the app.
 * `adminListCourses`/`adminRollback` inherit that guard for free through
 * `api.get`/`api.post`; `adminPublish`'s hand-rolled parse had quietly
 * dropped it, and would have rendered a non-JSON 200 as a fake publish
 * success. Fixed below by reusing `NotJsonError` itself rather than a
 * second copy of it — but the NEXT defense `client.ts` grows will not
 * propagate here automatically either. Anyone changing `send`/`request` in
 * `client.ts` should check whether `adminRequest`/`adminPublish` below need
 * the identical change, and anyone touching this file should diff its
 * request/parse logic against `client.ts`'s current `send`/`request` while
 * they are here.
 *
 * ## `FindingsError` is the reason this file exists at all
 *
 * A 400 from Publish or Rollback carries EVERY finding pkgcheck produced,
 * not just the first — the same "print every problem in one pass" contract
 * `tuhoc pack` already gives an author at the terminal (see
 * `rejectionResponse`'s own doc comment on the Go side). `FindingsError`
 * carries that array across the boundary so `AdminCourses.tsx` can draw the
 * whole table without knowing `{error, findings}` is the shape of an
 * `ApiError`'s body — it only has to check `instanceof FindingsError`.
 */

import type { Finding } from '@tuhoc/course-format';
import type { Translate } from '../i18n';
import { ApiError, NotJsonError, api, isJsonContainer, jsonBodyPreview } from '../api/client';
import { redirectToLogin } from '../api/navigation';

/** Same pattern as `api/client.ts`'s own `BASE_URL` — empty in dev/test, the API's own origin in production. */
const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * `GET /admin/courses`'s wire shape — one row per currently-published
 * course. Field names kept VERBATIM off the wire (including
 * `published_at`'s snake_case), matching `api/catalog.ts`'s own "no
 * client-side reshaping" convention — there is exactly one reader of this
 * type (`AdminCourses.tsx`) and nothing here needs a second name.
 */
export interface AdminCourseRow {
  readonly slug: string;
  readonly title: string;
  /** The server's own publish-sequence integer — NOT the manifest's semver. */
  readonly version: number;
  readonly published_at: string;
  /** Every version this slug has ever published, for the rollback picker. */
  readonly versions: readonly number[];
}

/** PUT and POST .../rollback's 201 body — `publishedResponse` on the Go side. */
export interface PublishResult {
  readonly slug: string;
  readonly version: number;
}

/**
 * Thrown by {@link adminPublish}/{@link adminRollback} in place of a plain
 * `ApiError` when the 400 body carries a non-empty `findings` array — see
 * this module's own header for why that distinction exists. A 400 with NO
 * findings (a malformed slug, a slug/manifest mismatch — real cases in
 * `catalog/handler.go`, both `c.Status(400).JSON(fiber.Map{"error": ...})`
 * with no `findings` key at all) stays a plain `ApiError`, and
 * `describeAdminError` gives THAT its own generic sentence.
 */
export class FindingsError extends Error {
  readonly findings: readonly Finding[];

  constructor(findings: readonly Finding[]) {
    // Tiếng Anh KỸ THUẬT: `.message` chỉ tới console/bug report, không màn
    // hình nào vẽ nó — câu cho người dùng đọc là bảng findings do
    // `AdminCourses.tsx` dựng, mỗi dòng dịch qua `finding.<CODE>`.
    super(`Course package rejected: ${findings.length} finding(s)`);
    this.name = 'FindingsError';
    this.findings = findings;
  }
}

/** `body` is `{error, findings}` with a non-empty `findings` array — the ONE 400 shape that becomes a {@link FindingsError}. */
function findingsIn(body: unknown): readonly Finding[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const findings = (body as Record<string, unknown>).findings;
  return Array.isArray(findings) && findings.length > 0 ? (findings as Finding[]) : null;
}

/**
 * Reshapes an admin-route rejection into the error the screen should
 * actually catch: a 400 carrying findings becomes `FindingsError`; anything
 * else (a 401 already redirected, a 404, a 500, a network failure) passes
 * through unchanged. Every one of the four exported calls below funnels its
 * catch clause through this so the "is this a findings 400" check lives in
 * exactly one place.
 */
function toAdminError(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 400) {
    const findings = findingsIn(error.body);
    if (findings !== null) return new FindingsError(findings);
  }
  return error;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The two verbs `api/client.ts` does not carry — see this module's header.
 * `body`/`contentType` are omitted for DELETE, which sends neither.
 */
async function adminRequest(
  method: 'PUT' | 'DELETE',
  path: string,
  body?: BodyInit,
  contentType?: string,
): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: contentType === undefined ? undefined : { 'Content-Type': contentType },
    body,
  });

  // Identical policy to `client.ts`'s `send()`: a 401 here means the same
  // thing it means everywhere else in this app — the session died — so it
  // gets the same hard redirect, never the "expected 401" treatment
  // `useMe`/`Login` carve out for themselves.
  if (res.status === 401) {
    redirectToLogin();
  }

  if (!res.ok) {
    throw new ApiError(res.status, await parseBody(res));
  }

  return res;
}

function coursePath(slug: string): string {
  return `/admin/courses/${encodeURIComponent(slug)}`;
}

/**
 * Every currently-published course, with its full version history.
 *
 * `allowArray: true`: `GET /admin/courses` answers a JSON ARRAY, not an
 * object — `client.ts`'s `request<T>` requires an object by default
 * since Important 3 of the final whole-branch review (a caller expecting
 * one is the common case, and `T` is erased at runtime so nothing else
 * could tell "array expected" from "server sent the wrong shape"); this
 * is the one call in this app that genuinely does expect an array, and
 * says so explicitly rather than the guard silently widening for
 * everyone.
 */
export async function adminListCourses(): Promise<AdminCourseRow[]> {
  return api.get<AdminCourseRow[]>('/admin/courses', { allowArray: true });
}

/**
 * Publishes `zip` under `slug`. `Content-Type` is set explicitly to
 * `application/zip` rather than left to the `File`'s own `.type`, which a
 * browser or OS may report as anything (`application/x-zip-compressed`,
 * empty) depending on how the file was produced — Task 8's contract names
 * one value and this is the one place that promise is kept.
 *
 * Read into an `ArrayBuffer` before the request rather than handed to
 * `fetch` as the `File`/`Blob` itself — the two are equivalent bytes on the
 * wire in a real browser, but this repo's test environment is jsdom, and
 * `msw`'s interception (`new Request(url, {body: <Blob>})`) measurably
 * drops a `Blob` body's content there: `adminApi.test.ts`'s own PUT
 * assertion received nine bytes reading "undefined" — `String(undefined)`
 * — instead of the four real ones, before this line existed. An
 * `ArrayBuffer` body round-trips correctly in both environments, so this is
 * the one shape that is honestly identical in production and under test
 * rather than "works in the browser, trust the test environment less".
 *
 * The parsed body is checked for "is this actually a usable JSON object"
 * before the cast to `PublishResult` — the same guard `client.ts`'s
 * `request<T>` applies to every call through `api.get`/`api.post`, reused
 * HERE via `isJsonContainer`/`jsonBodyPreview`/`NotJsonError` rather than a
 * second copy of them. `PublishResult` is always a single object, never an
 * array, so this call site does not (and must not) opt into
 * `isJsonContainer`'s `allowArray`. Without this check, a 200 whose body is
 * a string (a misconfigured `VITE_API_URL`, a CORS/DNS failure that lands
 * the PUT on a host answering `200 text/html`) — or, per the final
 * whole-branch review's Important 3, a 200 whose body is valid JSON but is
 * `null`, a bare primitive, or an ARRAY — parses fine and gets cast to
 * `PublishResult` anyway, and `{slug: undefined, version: undefined}` reads
 * out of it — `AdminCourses.tsx` would render "Published undefined,
 * version undefined" as an apparent SUCCESS, and an operator would believe
 * a course went live when nothing did.
 */
export async function adminPublish(slug: string, zip: File): Promise<PublishResult> {
  try {
    const bytes = await zip.arrayBuffer();
    const res = await adminRequest('PUT', coursePath(slug), bytes, 'application/zip');
    const parsed = await parseBody(res);
    if (!isJsonContainer(parsed)) {
      throw new NotJsonError(res.status, res.headers.get('content-type'), jsonBodyPreview(parsed));
    }
    return parsed as PublishResult;
  } catch (error) {
    throw toAdminError(error);
  }
}

/** Unpublishes `slug`. Resolves on 200; the response body (`{"slug"}`) carries nothing this caller does not already know. */
export async function adminUnpublish(slug: string): Promise<void> {
  try {
    await adminRequest('DELETE', coursePath(slug));
  } catch (error) {
    throw toAdminError(error);
  }
}

/** Rolls `slug` back to `version` — one of the integers `adminListCourses` already returned in that row's `versions`. */
export async function adminRollback(slug: string, version: number): Promise<PublishResult> {
  try {
    return await api.post<PublishResult>(`${coursePath(slug)}/rollback`, { version });
  } catch (error) {
    throw toAdminError(error);
  }
}

/**
 * Vietnamese/English sentence for an admin action that did not land —
 * mirrors `describeAuthError`/`describeRatingError`. Deliberately NOT
 * called for a `FindingsError`: that one gets the findings TABLE
 * (`AdminCourses.tsx`), not a single sentence, because a course author
 * fixing a rejected package needs every problem at once, not a summary.
 */
export function describeAdminError(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return t('admin.error.badRequest');
      case 404:
        return t('admin.error.notFound');
      default:
        return t(error.status >= 500 ? 'admin.error.serverDown' : 'admin.error.unknown');
    }
  }
  // No response ever arrived — offline, DNS, a CORS refusal. Same wording
  // discipline as `describeAuthError`'s own last branch: the browser will
  // not say which, so neither does this.
  return t('admin.error.unreachable');
}
