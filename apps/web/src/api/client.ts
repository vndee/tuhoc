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

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  options: RequestOptions,
): Promise<T> {
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

  return (await parseBody(res)) as T;
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
};

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
  return 'Không thể kết nối tới máy chủ. Vui lòng kiểm tra kết nối mạng.';
}
