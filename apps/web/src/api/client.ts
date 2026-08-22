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
 * — up to but NOT including how the successful body is read.
 *
 * Split out from `request` so that `api.bytes` can share all of it: a
 * course package's files are opaque bytes (the server labels every one of
 * them `application/octet-stream`, deliberately — see apps/api's
 * course/handler.go), and running them through `parseBody`'s
 * text-then-JSON path would corrupt anything that is not UTF-8 text. The
 * alternative — a second `fetch` call site — is a second copy of the
 * base URL and the 401 rule, which is exactly what this module exists to
 * prevent.
 */
async function send(
  method: 'GET' | 'POST',
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
 * A 2xx response whose body is not JSON.
 *
 * Named, not generic, because the shape that produces it is specific and
 * recurring: an SPA host answers an unknown path with `200 text/html`
 * (index.html) instead of a 404, so a request for `/stats` succeeds and
 * carries a page. `parseBody` falls back to returning that text, and before
 * this check `request<Stats>` handed it back **typed as `Stats`** — a string
 * that every caller then treats as an object.
 *
 * Measured 2026-08-22: that exact chain white-screened the whole app.
 * `statsQuery.data` was the HTML string, so `data?.courses` did NOT
 * short-circuit (a non-empty string is truthy), `.courses` was `undefined`,
 * and `.map` threw during render. With no error boundary the tree unmounted
 * to an empty `#root`. Three layers, and this is the deepest one.
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
      `Máy chủ trả ${status} nhưng thân phản hồi không phải JSON` +
        (contentType === null ? '' : ` (content-type: ${contentType})`) +
        '. Thường là do một máy chủ SPA trả index.html cho đường dẫn API.',
    );
    this.name = 'NotJsonError';
    this.status = status;
    this.contentType = contentType;
    this.bodyStart = bodyStart;
  }
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  options: RequestOptions,
): Promise<T> {
  const res = await send(method, path, body, options);
  const parsed = await parseBody(res);
  // `undefined` is a legitimate empty body (204, or a 200 with no content).
  // A *string* is not: every caller of `api.get<T>`/`api.post<T>` names an
  // object or array as `T`, and handing back text under that name is how a
  // transport problem became a render crash. Fail here, where the caller's
  // error path already exists, instead of three layers up where it doesn't.
  if (typeof parsed === 'string') {
    throw new NotJsonError(res.status, res.headers.get('content-type'), parsed.slice(0, 120));
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
   * A GET whose response is BYTES. Same transport as `get` — base URL,
   * cookie, 401 policy, `ApiError` — and no parsing.
   *
   * The one caller today is `api/courses.ts`, reading files out of a stored
   * course package. Those files are chapter HTML, images and (for an
   * `interactive` package) JavaScript; the server hands every one of them
   * back as `application/octet-stream` with `nosniff`, and the reader is
   * what decides what the bytes are. Anything that decoded them here would
   * be guessing on the reader's behalf.
   */
  bytes: async (path: string, options: RequestOptions = {}): Promise<Uint8Array> =>
    new Uint8Array(await (await send('GET', path, undefined, options)).arrayBuffer()),
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
export function describeAuthError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return 'Yêu cầu không hợp lệ. Vui lòng kiểm tra lại thông tin đã nhập.';
      case 401:
        return 'Email hoặc mật khẩu không đúng.';
      case 409:
        return 'Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.';
      case 429:
        return 'Bạn đã thử quá nhiều lần. Vui lòng đợi một chút rồi thử lại.';
      default:
        return error.status >= 500
          ? 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.'
          : 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.';
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
  return 'Không thể kết nối tới máy chủ. Có thể bạn đang ngoại tuyến, hoặc máy chủ đang bị cấu hình sai (CORS/DNS).';
}
