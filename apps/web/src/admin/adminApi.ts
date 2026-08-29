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

/**
 * ══════════════════════════════════════════════════════════════════════
 * Task 17 — the AI half of the CMS: `AdminCredits.tsx`
 * ("Người dùng & credit") and `AdminPricing.tsx` ("Bảng giá & prompt nền"),
 * both talking to the seven `/admin/ai/*` routes
 * (`apps/api/internal/ai/admin_handler.go`).
 *
 * Every wire shape below is copied field-for-field off that Go file's own
 * `*Payload`/`settingsPayload` structs — same "no client-side reshaping"
 * discipline `AdminCourseRow` above already keeps, and the same reason:
 * there is exactly one reader of each type, so there is nothing to gain
 * from inventing a second name for a field the server already named.
 *
 * These calls do NOT go through `toAdminError`: that helper exists for
 * ONE specific 400 shape — `{error, findings}` from course-package
 * validation — and none of these seven routes ever answers with a
 * `findings` array. A plain `ApiError` is already the right, sufficient
 * error type here; `describeAdminAIError` below reads its `code` instead
 * of pretending a findings table might show up.
 * ══════════════════════════════════════════════════════════════════════
 */

/** One row of `GET /admin/ai/users` — `adminUserPayload` on the Go side. */
export interface AdminAIUserRow {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly balance_micro: number;
}

/** One row of `AdminAIUserDetail.recent_usage` — `usageEntryPayload` (handler.go), reused verbatim. */
export interface AdminAIUsageEntry {
  readonly at: string;
  readonly model: string;
  readonly in_tokens: number;
  readonly cached_in_tokens: number;
  readonly out_tokens: number;
  readonly tool_calls: number;
  readonly web_searches: number;
  readonly credits_charged: number;
}

/**
 * One row of `AdminAIUserDetail.recent_adjustments` — `creditAdjustmentPayload`.
 * `note` already carries the signed micro-credit amount AND the operator's
 * own words (`AdminAdjustCredit`'s doc comment on the Go side spells out
 * the exact format) — this screen renders it as ONE column, it does not
 * re-parse the amount back out of it.
 */
export interface AdminCreditAdjustment {
  readonly at: string;
  readonly who: string | null;
  readonly note: string;
}

/** `GET /admin/ai/users/:id` — `adminUserDetailPayload`. */
export interface AdminAIUserDetail extends AdminAIUserRow {
  readonly recent_usage: readonly AdminAIUsageEntry[];
  readonly recent_adjustments: readonly AdminCreditAdjustment[];
}

/** `GET`/`PUT .../pricing/:model` — `pricingPayload`. */
export interface AdminPricingRow {
  readonly model: string;
  readonly cost_micro_per_1k_in: number;
  readonly cost_micro_per_1k_cached_in: number;
  readonly cost_micro_per_1k_out: number;
  readonly credits_per_1k_in: number;
  readonly credits_per_1k_cached_in: number;
  readonly credits_per_1k_out: number;
  readonly updated_at: string;
}

/**
 * `GET`/`PUT /admin/ai/settings` — `settingsPayload`. `max_base_prompt_chars`
 * is the number `AdminPricing.tsx`'s base-prompt textarea ACTUALLY caps at
 * — same "server is the source of truth, even client-side" rule
 * `AgentConfigPanel.tsx` already keeps for `max_system_prompt_chars`.
 */
export interface AdminAISettings {
  readonly base_system_prompt: string;
  readonly credits_per_web_search: number;
  readonly cost_micro_per_web_search: number;
  readonly signup_grant_micro: number;
  readonly max_tokens_per_turn: number;
  readonly max_tool_rounds_per_turn: number;
  readonly max_base_prompt_chars: number;
}

/**
 * `PUT .../pricing/:model`'s body — `updatePricingRequest` on the Go side,
 * minus `Note` being spelled `note` here already (this file is the ONLY
 * reader, no JSON-tag translation needed). All six rates are REQUIRED —
 * `AdminUpdatePricing` (Go) refuses a body missing any one of them, the
 * same "PUT replaces the whole row" rule `configRequest` keeps for
 * `PUT /ai/config`.
 */
export interface UpdatePricingInput {
  readonly cost_micro_per_1k_in: number;
  readonly cost_micro_per_1k_cached_in: number;
  readonly cost_micro_per_1k_out: number;
  readonly credits_per_1k_in: number;
  readonly credits_per_1k_cached_in: number;
  readonly credits_per_1k_out: number;
  readonly note?: string;
}

/**
 * `putJSON` exists because `api.put` (`../api/client.ts`) deliberately
 * returns `Promise<void>` — its own doc comment names the ONE endpoint
 * that shape was built for (`PUT /ratings/:registryId`, which answers 204
 * with no body) and says plainly: "a future PUT that does answer with a
 * body should get its own entry rather than widening this one." Both
 * `PUT /admin/ai/pricing/:model` and `PUT /admin/ai/settings` answer with
 * the updated row/settings — this file's `adminRequest` (defined above,
 * for `adminPublish`/`adminUnpublish`) already knows how to send a PUT and
 * hand back the raw `Response`; this just adds the JSON encode on the way
 * in and the SAME parse-and-shape-guard on the way out that `api.get`/
 * `api.post` give every other call in this file (`isJsonContainer` /
 * `NotJsonError` — see `client.ts`'s own doc comment on why a 2xx body
 * that is not a usable object must never be cast to `T` silently).
 */
async function putJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await adminRequest('PUT', path, JSON.stringify(body), 'application/json');
  const parsed = await parseBody(res);
  if (!isJsonContainer(parsed)) {
    throw new NotJsonError(res.status, res.headers.get('content-type'), jsonBodyPreview(parsed));
  }
  return parsed as T;
}

function aiUsersPath(query: string): string {
  const q = query.trim();
  return q === '' ? '/admin/ai/users' : `/admin/ai/users?q=${encodeURIComponent(q)}`;
}

/**
 * The "tìm user" half of spec §7's "Người dùng & credit" screen. `query`
 * is an email substring, matched server-side (`ai.Service.ListUsers`,
 * `LIKE '%'||$1||'%'` against `users.email`); `''` returns the first page
 * of accounts, alphabetically, capped server-side at 50 rows
 * (`adminUserListLimit`, credits.go) — this is a search box, not an export.
 */
export async function adminListAIUsers(query: string): Promise<AdminAIUserRow[]> {
  return api.get<AdminAIUserRow[]>(aiUsersPath(query), { allowArray: true });
}

/** One learner's balance, spend ledger, and manual-adjustment history. */
export async function adminGetAIUser(id: string): Promise<AdminAIUserDetail> {
  return api.get<AdminAIUserDetail>(`/admin/ai/users/${encodeURIComponent(id)}`);
}

/**
 * Spec §7's "cộng/trừ credit tay" — `deltaMicro` positive credits the
 * account, negative debits it; `note` is BINDING on the server (an empty
 * one, after trimming, is refused with `FieldRequired` — see
 * `AdminAdjustCredit`'s own doc comment on the Go side for the full
 * reasoning, including why this call is NOT deduplicated against a
 * double submit at this layer: `AdminCredits.tsx`'s own submit control is
 * where that gets mitigated, by disabling itself while a request is
 * in flight).
 */
export async function adminAdjustCredit(
  id: string,
  deltaMicro: number,
  note: string,
): Promise<{ balance_micro: number }> {
  return api.post<{ balance_micro: number }>(`/admin/ai/users/${encodeURIComponent(id)}/credit`, {
    delta_micro: deltaMicro,
    note,
  });
}

/** Every `ai_pricing` row — the whole "bảng quy đổi credit" this screen edits. */
export async function adminListPricing(): Promise<AdminPricingRow[]> {
  return api.get<AdminPricingRow[]>('/admin/ai/pricing', { allowArray: true });
}

/** Overwrites `model`'s six rates. Takes effect on the very next turn — no deploy, no restart (spec §3.4). */
export async function adminUpdatePricing(model: string, input: UpdatePricingInput): Promise<AdminPricingRow> {
  return putJSON<AdminPricingRow>(`/admin/ai/pricing/${encodeURIComponent(model)}`, input);
}

/** Every `ai_settings` column, for display — only `base_system_prompt` is writable through this file (see `adminUpdateBasePrompt`). */
export async function adminGetAISettings(): Promise<AdminAISettings> {
  return api.get<AdminAISettings>('/admin/ai/settings');
}

/**
 * Spec §7's "sửa system prompt nền của agent". The server refuses an empty
 * (or whitespace-only) `basePrompt` with `FieldRequired` — it is the
 * platform's tutor persona AND its safety boundary, appended-BEFORE, never
 * replaced by, a learner's own personal prompt (spec §3.3) — see
 * `AdminUpdateSettings`'s own doc comment on the Go side.
 */
export async function adminUpdateBasePrompt(basePrompt: string, note?: string): Promise<AdminAISettings> {
  return putJSON<AdminAISettings>('/admin/ai/settings', { base_system_prompt: basePrompt, note });
}

/**
 * `aiErrorCode` extracts the machine-readable `code` field
 * (`{code, error}`, `ai.fail`'s own wire shape — handler.go) off an
 * `ApiError`'s body, or `null` when there is none to read (a non-`ApiError`
 * failure, or a body some OTHER route on this server writes in a different
 * shape). This file's status-code-only `describeAdminError` above cannot
 * distinguish the AI admin routes' several different 400 causes (an empty
 * note, a zero delta, an out-of-range amount, an empty base prompt all
 * answer 400) — `code` is the one field that can.
 */
function aiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || typeof error.body !== 'object' || error.body === null) return null;
  const code = (error.body as Record<string, unknown>).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Vietnamese/English sentence for a failure from one of the seven
 * `/admin/ai/*` routes — reads `error.body.code` FIRST (the four codes
 * these routes can answer with that `describeAdminError` has no concept
 * of), and falls back to `describeAdminError`'s own status-based mapping
 * for everything else (a 401 that somehow reaches here, a 5xx, no response
 * at all).
 */
export function describeAdminAIError(error: unknown, t: Translate): string {
  switch (aiErrorCode(error)) {
    case 'FieldRequired':
      return t('admin.ai.error.fieldRequired');
    case 'AmountOutOfRange':
      return t('admin.ai.error.amountOutOfRange');
    case 'FieldTooLong':
      return t('admin.ai.error.fieldTooLong');
    case 'NotFound':
      return t('admin.ai.error.notFound');
    default:
      return describeAdminError(error, t);
  }
}
