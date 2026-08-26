import type { Translate } from '../i18n';
import { redirectToLogin } from './navigation';

/**
 * Prefixed onto every request path. Empty in dev/test — requests resolve
 * against the current origin, which is what MSW and a same-origin dev
 * setup both expect. Set to the API's own origin in production, where the
 * static site (Pages) and the API (Fly/Render) are deployed to different
 * origins — see docs/deploy.md's VITE_API_URL.
 */
const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * Thrown by `api.get`/`api.post` for any non-2xx response. Carries the
 * numeric `status` and the parsed response `body` (usually
 * `{error: string}` per the backend's convention — see
 * apps/api/internal/auth/handler.go) so callers can distinguish, in
 * particular, 401 from 500: collapsing those would make "your session
 * died" indistinguishable from "the server is broken," a distinction the
 * backend itself deliberately preserves (see
 * auth.RequireWithUsecase's doc comment on the Go side).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  /**
   * Whether a 401 response triggers the automatic hard redirect to
   * /login (see ./navigation.ts). Defaults to true: for almost every
   * call, a 401 means "the session that used to work just died," and
   * there is nothing useful left to render, so bouncing to the login
   * screen is correct.
   *
   * The deliberate exceptions in this codebase are GET /me (`useMe`,
   * src/api/useMe.ts) and the login attempt on `src/pages/Login.tsx`:
   * for those, 401 is an *expected, ordinary* answer — "nobody is logged
   * in yet" / "wrong email or password" — not a session dying. Both pass
   * `redirectOn401: false` and handle the 401 as data (or an inline
   * error), not as a reason to navigate. Getting this wrong for GET /me
   * specifically would be a redirect loop: /login's own page load would
   * 401 and redirect to /login again.
   */
  redirectOn401?: boolean;
  /**
   * Lets a 2xx body that parses as a JSON ARRAY pass `request<T>`'s
   * shape guard (see {@link isJsonContainer}). Defaults to false: this
   * client's endpoints are overwhelmingly object-shaped, and `T` is
   * erased at runtime, so nothing here can otherwise tell "this caller
   * really expects an array" from "the server answered with the wrong
   * shape". The one caller that needs it today is `adminApi.ts`'s
   * `adminListCourses` (`GET /admin/courses` → `AdminCourseRow[]`) — pass
   * it explicitly there rather than widening the default.
   */
  allowArray?: boolean;
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
 * Everything a request to this API has in common — the base URL, the
 * session cookie, the 401 policy, and turning a non-2xx into an `ApiError`
 * — up to but NOT including how the successful body is read. `request`
 * (below) is the only caller: split out on its own so that a future
 * caller needing the raw `Response` (bytes, a stream, anything
 * `parseBody`'s text-then-JSON path would corrupt) can share this half
 * without a second copy of the base URL and the 401 rule — see `git log`
 * on this file for `api.bytes`, which used to be exactly that caller
 * before it was removed as dead code (final whole-branch review, M5).
 */
/**
 * The HTTP verbs this client speaks.
 *
 * `PUT` joined the list for `PUT /ratings/:registryId` (subsystem 4). It is
 * a genuinely different verb here rather than a stylistic one: a rating is
 * **one row per person per course, overwritten in place** — the Go side's
 * primary key is `(user_id, registry_id)` — so the request is idempotent and
 * the second click on the same star must not be a second vote. `POST` would
 * have said the opposite about an endpoint whose whole design is that
 * repeating it changes nothing.
 *
 * No `DELETE`: nothing in this app removes a rating, and a verb with no
 * caller is a door nobody is watching.
 */
type Method = 'GET' | 'POST' | 'PUT';

async function send(
  method: Method,
  path: string,
  body: unknown,
  options: RequestOptions,
): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && options.redirectOn401 !== false) {
    redirectToLogin();
  }

  if (!res.ok) {
    throw new ApiError(res.status, await parseBody(res));
  }

  return res;
}

/**
 * A 2xx response whose body is not usable as `T`: not JSON at all, or JSON
 * that parsed to something no caller here ever means by `T` — `null`, a
 * bare primitive, or (unless the caller opted in) an array.
 *
 * The original, and still most common, case is specific and recurring: an
 * SPA host answers an unknown path with `200 text/html` (index.html)
 * instead of a 404, so a request for `/stats` succeeds and carries a page.
 * `parseBody` falls back to returning that text, and before this check
 * `request<Stats>` handed it back **typed as `Stats`** — a string that
 * every caller then treats as an object.
 *
 * Measured 2026-08-22: that exact chain white-screened the whole app.
 * `statsQuery.data` was the HTML string, so `data?.courses` did NOT
 * short-circuit (a non-empty string is truthy), `.courses` was `undefined`,
 * and `.map` threw during render. With no error boundary the tree unmounted
 * to an empty `#root`. Three layers, and this is the deepest one.
 *
 * Final whole-branch review, Important 3: the guard that throws this was
 * originally `typeof parsed === 'string'` only — a 2xx that parsed as
 * valid JSON but was `null` or a bare number/boolean sailed through
 * unchecked, and so did a JSON ARRAY handed to a caller that never asked
 * for one (`adminApi.ts`'s `adminPublish` measured this exact shape:
 * `{slug: undefined, version: undefined}` read off an array, rendered as
 * an apparent publish SUCCESS). See {@link isJsonContainer}.
 */
export class NotJsonError extends Error {
  // Khai tường minh, không dùng tham số-thuộc tính: `erasableSyntaxOnly` của
  // repo này cấm chúng (TS1294). `make test-web` vẫn xanh với lỗi ấy vì vitest
  // không kiểm kiểu — chỉ `tsc -b` bắt được.
  readonly status: number;
  readonly contentType: string | null;
  readonly bodyStart: string;

  constructor(status: number, contentType: string | null, bodyStart: string) {
    super(
      // Tiếng Anh KỸ THUẬT: `.message` của lớp lỗi này chỉ tới console và
      // bug report — không màn hình nào vẽ nó. Cùng quy ước mà
      // `course/loader.ts` viết ra cho các lớp lỗi của nó.
      `Server answered ${status} but the response body is not JSON` +
        (contentType === null ? '' : ` (content-type: ${contentType})`) +
        '. Usually an SPA server returning index.html for an API path.',
    );
    this.name = 'NotJsonError';
    this.status = status;
    this.contentType = contentType;
    this.bodyStart = bodyStart;
  }
}

/**
 * True when `value` is a JSON shape safe to trust as `T`: a plain object,
 * or — only when the caller has said it expects one via `allowArray` —
 * an array. Rejects `undefined`, `null`, and every JSON primitive
 * (string, number, boolean): none of those can stand in for an object's
 * fields, and `parsed.slug`/`.version` on any of them is a silent
 * `undefined`, never a thrown error — the exact "wrong shape read as
 * right" chain {@link NotJsonError} exists to stop.
 *
 * Exported so `adminApi.ts`'s hand-rolled `adminPublish` parse — which
 * duplicates `request`'s guard for the reason explained in that file's own
 * header comment — shares this exact check instead of a second copy of it.
 */
export function isJsonContainer(value: unknown, options: { allowArray?: boolean } = {}): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return options.allowArray === true;
  return true;
}

/**
 * A short, safe-to-log preview of a JSON value that failed
 * {@link isJsonContainer}, for {@link NotJsonError}'s `bodyStart`. A raw
 * string (the common SPA-fallback-HTML case) is sliced directly; anything
 * else (`null`, a number, a boolean, a rejected array) is re-serialized
 * first, since those never came through as text in the first place.
 */
export function jsonBodyPreview(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 120);
  try {
    return JSON.stringify(value).slice(0, 120);
  } catch {
    return String(value).slice(0, 120);
  }
}

async function request<T>(
  method: Method,
  path: string,
  body: unknown,
  options: RequestOptions,
): Promise<T> {
  const res = await send(method, path, body, options);
  const parsed = await parseBody(res);
  // `undefined` is a legitimate empty body (204, or a 200 with no
  // content) — the one shape `isJsonContainer` rejects that is still
  // valid here, so it is special-cased rather than folded into that
  // check (which every OTHER caller needs to reject `undefined` too —
  // see `catalog.ts`'s `getJson`, where no endpoint ever legitimately
  // answers empty).
  if (parsed !== undefined && !isJsonContainer(parsed, { allowArray: options.allowArray })) {
    throw new NotJsonError(res.status, res.headers.get('content-type'), jsonBodyPreview(parsed));
  }
  return parsed as T;
}

/**
 * The one fetch wrapper every feature built on top of the API talks
 * through — Task 13's sync engine, Task 14's stats, Task 15's heartbeat,
 * and this task's own Login page all call `api.get`/`api.post` instead of
 * `fetch` directly, so `credentials: 'include'`, the base URL, and the
 * 401 handling above live in exactly one place.
 */
export const api = {
  get: <T,>(path: string, options: RequestOptions = {}): Promise<T> => request<T>('GET', path, undefined, options),
  post: <T,>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> =>
    request<T>('POST', path, body, options),
  /**
   * An idempotent write. See {@link Method} for why ratings use this verb.
   *
   * Typed `Promise<void>` and not `Promise<T>`, because the one endpoint
   * behind it answers **204 with no body**: `parseBody` turns that into
   * `undefined`, and a generic `T` here would hand every caller an
   * `undefined` wearing a type it does not have — the same "a value typed as
   * something it is not" shape that `NotJsonError` above exists to stop, one
   * size smaller. A future PUT that does answer with a body should get its
   * own entry rather than widening this one.
   */
  put: async (path: string, body?: unknown, options: RequestOptions = {}): Promise<void> => {
    await request<unknown>('PUT', path, body, options);
  },
};

/**
 * Did an HTTP response ever arrive?
 *
 * `true` means a server answered — with any status. `false` means the
 * request never got one: the transport failed and this page knows nothing
 * about its own session.
 *
 * This is the single distinction `<RequireAuth>`'s offline branch rests on,
 * so it is worth being precise about what falls on each side, measured
 * rather than assumed (see `client.test.ts`, and task-7b-report.md for the
 * same four cases driven through a real browser):
 *
 *  - **401 → answered.** The server looked at the cookie and said nobody is
 *    signed in. That is a fact, not a silence, and it outranks anything
 *    this device believes about itself. (`useMe` turns it into `null` data
 *    before it ever reaches here.)
 *  - **500 / 502 / 503 → answered.** Something on the other end is broken,
 *    but the network reached it. A reachable, broken server is NOT an
 *    offline device, and the existing behaviour — an inline outage message
 *    — is kept for it deliberately. Widening the offline branch to cover
 *    5xx would mean a bad deploy silently flipped every reader into
 *    local-only mode with no request ever failing to leave the machine.
 *  - **Offline, DNS failure, connection refused, a blocked or CORS-refused
 *    request → NOT answered.** All four arrive here as the same bare
 *    `TypeError` from `fetch`, with no status and no body. The browser
 *    deliberately refuses to tell a page which one it was — so they cannot
 *    be told apart, and this function does not pretend to. What makes that
 *    acceptable is the other side of the door: see
 *    `offlineSessionIsUsable` in `auth/session.ts` for why "unknown" only
 *    ever unlocks the device's OWN local data.
 *  - **Anything else thrown → NOT answered.** A bug in our own code
 *    reaching this predicate reads as "we do not know", never as "the
 *    server answered". Failing that way round is what keeps a future
 *    mistake from being read as authorization.
 */
export function serverAnswered(error: unknown): boolean {
  return error instanceof ApiError;
}

/**
 * Vietnamese, human-readable summary of an auth failure, for surfaces
 * that show it directly to a learner (`Login`, `RequireAuth`) — mirrors
 * `describeCourseError` in `src/course/loader.ts`.
 *
 * The 401 branch is deliberately generic ("email hoặc mật khẩu không
 * đúng") for both a wrong password and an unknown email, matching the
 * backend's own anti-enumeration contract (`auth.ErrInvalidCredentials`
 * returns the identical status and body for both cases — see
 * apps/api/internal/auth/usecase.go) — this UI must not introduce a
 * distinction the backend went out of its way to hide.
 */
export function describeAuthError(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return t('auth.error.badRequest');
      case 401:
        return t('auth.error.credentials');
      case 409:
        return t('auth.error.emailTaken');
      case 429:
        return t('auth.error.tooManyAttempts');
      default:
        return t(error.status >= 500 ? 'auth.error.serverDown' : 'auth.error.unknown');
    }
  }
  // No response ever arrived (see `serverAnswered`). The old wording here was
  // "Không thể kết nối tới máy chủ. Vui lòng kiểm tra kết nối mạng." — one
  // cause, stated as fact, and it was the WRONG one often enough to matter:
  // ruling S1-F25 records that a CORS refusal in production is byte-for-byte
  // this same bare `TypeError`, so a misconfigured deploy told every visitor
  // their wifi was bad and nobody — reader or operator — ever saw the real
  // fault. Naming both possibilities costs one clause and is the only honest
  // thing this function can say, because the browser genuinely does not tell
  // the page which one it was.
  return t('auth.error.unreachable');
}
