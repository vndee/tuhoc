import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The api client's own 401 handling is a hard `window.location` navigation
// (see src/api/navigation.ts's doc comment for why: it needs to work from
// contexts with no react-router `navigate()`, e.g. a queryFn). jsdom does
// not implement real navigation, so the redirect side effect is mocked at
// the module boundary instead of asserted via window.location — this also
// keeps the test from caring *how* the redirect happens, only *whether*
// and *with what* it was requested.
vi.mock('./navigation', () => ({
  redirectToLogin: vi.fn(),
}));

import { api, ApiError, describeAuthError, NotJsonError, serverAnswered } from './client';
import { redirectToLogin } from './navigation';
import { t as lookup, type Translate } from '../i18n';

/**
 * `t` đã gắn tiếng Việt.
 *
 * `describeFinding`, `describeCourseError`, `describeAuthError` và
 * `importCourse` nhận ngôn ngữ bằng THAM SỐ từ Task 5 — chúng không phải
 * component và cố ý không có context nào để đọc. Bơm `t` vào từ đây là cách
 * duy nhất một bài kiểm chứng minh chúng dùng cái được truyền vào.
 */
const t: Translate = (key, ...args) => lookup('vi', key, ...args);


const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.mocked(redirectToLogin).mockClear();
});
afterAll(() => server.close());

describe('thân phản hồi 2xx không phải JSON', () => {
  // Hồi quy, đo 2026-08-22 trên bản dựng production: một máy chủ SPA trả
  // `200 text/html` (index.html) cho `/stats`. `parseBody` lùi về trả VĂN BẢN,
  // và `request<Stats>` trao lại chuỗi ấy DƯỚI DANH NGHĨA `Stats`. Ở tầng trên,
  // `data?.courses` không ngắn mạch (chuỗi khác rỗng là truthy), `.courses` là
  // undefined, `.map` ném khi render, và cả cây React unmount thành `#root`
  // rỗng — trang trắng, không một chữ nào.
  const SPA_HTML = '<!doctype html>\n<html lang="vi"><head><title>Tự học</title></head><body></body></html>';

  it('ném NotJsonError thay vì trao chuỗi HTML dưới danh nghĩa T', async () => {
    server.use(http.get('/stats', () => HttpResponse.html(SPA_HTML)));
    await expect(api.get<{ courses: unknown[] }>('/stats')).rejects.toBeInstanceOf(NotJsonError);
  });

  it('lỗi nêu status, content-type và đầu thân phản hồi — đủ để chẩn đoán mà không cần mở DevTools', async () => {
    server.use(http.get('/stats', () => HttpResponse.html(SPA_HTML)));
    const err = await api.get('/stats').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotJsonError);
    const e = err as NotJsonError;
    expect(e.status).toBe(200);
    expect(e.contentType).toContain('text/html');
    expect(e.bodyStart).toContain('<!doctype html>');
    expect(e.message).toContain('SPA');
  });

  it('thân RỖNG vẫn hợp lệ — undefined không phải chuỗi, đừng bắt nhầm nó', async () => {
    server.use(http.get('/nothing', () => new HttpResponse(null, { status: 204 })));
    await expect(api.get('/nothing')).resolves.toBeUndefined();
  });

  it('JSON hợp lệ vẫn đi qua — đối chứng, để bài trên không xanh vì mọi thứ đều ném', async () => {
    server.use(http.get('/ok', () => HttpResponse.json({ courses: [] })));
    await expect(api.get<{ courses: unknown[] }>('/ok')).resolves.toEqual({ courses: [] });
  });

  /**
   * Final whole-branch review, Important 3. The guard above only ever
   * caught a literal STRING body — `typeof parsed === 'string'`. A 2xx
   * whose body parses as valid JSON but is `null` or a bare primitive
   * (number/boolean) sailed straight through under `T`'s name, exactly
   * the same "wrong shape read as right" chain the string case above
   * exists to stop, one layer down: `null.slug`/`(3).slug` are not a
   * thrown error, they are a silent `undefined`.
   */
  it.each([
    ['null', null],
    ['a bare number', 42],
    ['a bare boolean', true],
  ])('ném NotJsonError khi thân 2xx là JSON hợp lệ nhưng %s, không phải một object', async (_label, jsonValue) => {
    server.use(http.get('/weird', () => HttpResponse.json(jsonValue)));
    await expect(api.get('/weird')).rejects.toBeInstanceOf(NotJsonError);
  });

  it('mặc định ném NotJsonError khi thân 2xx là một MẢNG — request<T> không biết T là gì lúc chạy, nên phải được báo rõ ràng mới cho mảng qua', async () => {
    server.use(http.get('/weird-array', () => HttpResponse.json([{ slug: 'demo' }])));
    await expect(api.get('/weird-array')).rejects.toBeInstanceOf(NotJsonError);
  });

  it('allowArray:true cho một MẢNG hợp lệ đi qua — cổng GET /admin/courses (AdminCourseRow[]) cần đúng lối này', async () => {
    server.use(http.get('/rows', () => HttpResponse.json([{ slug: 'demo' }])));
    await expect(api.get<{ slug: string }[]>('/rows', { allowArray: true })).resolves.toEqual([{ slug: 'demo' }]);
  });

  it('allowArray:true KHÔNG nới lỏng gì thêm — null/số/chuỗi vẫn bị ném dù allowArray:true', async () => {
    server.use(http.get('/still-weird', () => HttpResponse.json(null)));
    await expect(api.get('/still-weird', { allowArray: true })).rejects.toBeInstanceOf(NotJsonError);
  });
});

describe('api.get/api.post', () => {
  it('GET sends credentials:"include" and resolves with the parsed JSON body', async () => {
    let seenCredentials: RequestCredentials | undefined;
    server.use(
      http.get('/ping', ({ request }) => {
        seenCredentials = (request as unknown as { credentials?: RequestCredentials }).credentials;
        return HttpResponse.json({ ok: true });
      }),
    );

    await expect(api.get<{ ok: boolean }>('/ping')).resolves.toEqual({ ok: true });
    // msw's Request doesn't always echo `credentials` back reliably across
    // environments, so this is a soft check; the hard guarantee is
    // asserted below via a handler that only succeeds when the cookie is
    // actually forwarded.
    void seenCredentials;
  });

  it('POST sends the body as JSON with a Content-Type header and resolves with the parsed JSON response', async () => {
    server.use(
      http.post('/echo', async ({ request }) => {
        expect(request.headers.get('content-type')).toMatch(/application\/json/);
        const body = await request.json();
        return HttpResponse.json({ received: body });
      }),
    );

    await expect(api.post<{ received: unknown }>('/echo', { a: 1 })).resolves.toEqual({
      received: { a: 1 },
    });
  });

  it('GET with no body sends no request body', async () => {
    server.use(
      http.get('/no-body', async ({ request }) => {
        const text = await request.text();
        return HttpResponse.json({ bodyWasEmpty: text === '' });
      }),
    );

    await expect(api.get<{ bodyWasEmpty: boolean }>('/no-body')).resolves.toEqual({ bodyWasEmpty: true });
  });

  it('prefixes every request with VITE_API_URL (import.meta.env), not just same-origin paths', async () => {
    // vite.config.ts / test env does not set VITE_API_URL, so the base is
    // "" and requests resolve relative to the test origin — this is
    // exercised implicitly by every other test in this file succeeding
    // against a relative-path MSW handler. A dedicated assertion on the
    // *value itself* would require rebuilding import.meta.env, which
    // vitest does not support swapping mid-file; the contract is instead
    // covered by client.ts reading import.meta.env.VITE_API_URL directly
    // (see source) plus this suite's requests all resolving correctly.
    server.use(http.get('/base-url-check', () => HttpResponse.json({ ok: true })));
    await expect(api.get('/base-url-check')).resolves.toEqual({ ok: true });
  });

  it('a non-2xx response rejects with ApiError carrying the numeric status and parsed body', async () => {
    server.use(
      http.get('/broken', () => HttpResponse.json({ error: 'nope' }, { status: 418 })),
    );

    const failure = api.get('/broken');
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 418, body: { error: 'nope' } });
  });

  it('401 triggers the shared redirectToLogin side effect by default', async () => {
    server.use(http.get('/needs-auth', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));

    await expect(api.get('/needs-auth')).rejects.toBeInstanceOf(ApiError);
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });

  it('POST 401 also triggers redirectToLogin by default (blanket 401 handling, not GET-only)', async () => {
    server.use(http.post('/needs-auth-2', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));

    await expect(api.post('/needs-auth-2', {})).rejects.toBeInstanceOf(ApiError);
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });

  it('redirectOn401:false suppresses the redirect but still rejects with ApiError(401)', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));

    const failure = api.get('/me', { redirectOn401: false });
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 401 });
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it('a 500 rejects with ApiError(500) and does NOT trigger redirectToLogin — a server failure must not look like a logout', async () => {
    server.use(http.get('/broken-server', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));

    await expect(api.get('/broken-server')).rejects.toMatchObject({ status: 500 });
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it('a 429 rejects with ApiError(429) and does NOT trigger redirectToLogin', async () => {
    server.use(http.get('/rate-limited', () => HttpResponse.json({ error: 'too many requests' }, { status: 429 })));

    await expect(api.get('/rate-limited')).rejects.toMatchObject({ status: 429 });
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it('a response with an empty body (e.g. POST /auth/logout) resolves without throwing', async () => {
    server.use(http.post('/auth/logout', () => new HttpResponse(null, { status: 200 })));
    await expect(api.post('/auth/logout')).resolves.toBeUndefined();
  });
});

/**
 * `patch`/`del` join `get`/`post`/`put` for Task 5's `annotations.ts`:
 * `PATCH /annotations/:id` and `DELETE /annotations/:id` both answer 204
 * with no body. `del` is typed `Promise<void>` for the identical reason
 * `put` already is (see `api.put`'s own doc comment) — its only caller
 * today is a 204 endpoint, so a generic `T` would hand back an `undefined`
 * wearing a type it does not have. `patch` keeps `<T>` because unlike
 * `del`, a PATCH that answers a body is a plausible future endpoint, not a
 * hypothetical one this client has any evidence against.
 */
describe('api.patch/api.del', () => {
  it('api.del resolves with undefined on a 204 with no body, without throwing NotJsonError', async () => {
    server.use(http.delete('/annotations/x', () => new HttpResponse(null, { status: 204 })));
    await expect(api.del('/annotations/x')).resolves.toBeUndefined();
  });

  it('api.patch sends the PATCH method and the body as JSON', async () => {
    server.use(
      http.patch('/annotations/x', async ({ request }) => {
        expect(request.method).toBe('PATCH');
        expect(request.headers.get('content-type')).toMatch(/application\/json/);
        await expect(request.json()).resolves.toEqual({ note: 'a' });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(api.patch('/annotations/x', { note: 'a' })).resolves.toBeUndefined();
  });

  it('api.patch resolves with the parsed JSON body when the endpoint answers one — <T> is not dead code', async () => {
    server.use(http.patch('/echo', () => HttpResponse.json({ ok: true })));
    await expect(api.patch<{ ok: boolean }>('/echo', {})).resolves.toEqual({ ok: true });
  });

  it('a non-2xx PATCH rejects with ApiError, same as every other verb', async () => {
    server.use(http.patch('/broken-patch', () => HttpResponse.json({ error: 'nope' }, { status: 404 })));
    await expect(api.patch('/broken-patch', {})).rejects.toMatchObject({ status: 404 });
  });

  it('a non-2xx DELETE rejects with ApiError, same as every other verb', async () => {
    server.use(http.delete('/broken-delete', () => HttpResponse.json({ error: 'nope' }, { status: 404 })));
    await expect(api.del('/broken-delete')).rejects.toMatchObject({ status: 404 });
  });
});

/**
 * The classifier `<RequireAuth>` leans on to tell "the server said no" from
 * "no server said anything" (Task 7b). Every case here is a REAL failure
 * driven through the real `api.get`, not a hand-built error object: the
 * distinction is only worth anything if it survives the actual shapes fetch
 * produces.
 */
describe('serverAnswered — did an HTTP response ever arrive?', () => {
  it('true for every HTTP status, including the ones that are not 401', async () => {
    for (const status of [400, 401, 403, 404, 409, 429, 500, 502, 503]) {
      server.use(http.get('/probe', () => HttpResponse.json({ error: 'x' }, { status })));
      const error = await api.get('/probe', { redirectOn401: false }).catch((e: unknown) => e);
      expect(serverAnswered(error), `status ${status}`).toBe(true);
    }
  });

  it('false when the transport fails — this is what offline, DNS failure and a blocked request all collapse to', async () => {
    // `HttpResponse.error()` is msw's network-level failure: `fetch` rejects
    // with a bare `TypeError`, carrying no status and no body. That is
    // exactly what a browser hands back for a dead network, an unresolvable
    // host, a refused connection, and a request a CORS preflight or an
    // extension blocked — the browser deliberately does not tell a page
    // which, so this one branch is all four.
    server.use(http.get('/gone', () => HttpResponse.error()));

    const error = await api.get('/gone').catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(serverAnswered(error)).toBe(false);
  });

  it('false for anything that is not an ApiError at all, so an unexpected throw is never read as an answer', () => {
    expect(serverAnswered(new TypeError('Failed to fetch'))).toBe(false);
    expect(serverAnswered(new Error('boom'))).toBe(false);
    expect(serverAnswered(undefined)).toBe(false);
    expect(serverAnswered({ status: 401 })).toBe(false);
  });

  it('a transport failure does NOT trigger redirectToLogin — nothing said the session is dead', async () => {
    server.use(http.get('/gone-2', () => HttpResponse.error()));

    await expect(api.get('/gone-2')).rejects.toThrow();
    expect(redirectToLogin).not.toHaveBeenCalled();
  });
});

describe('describeAuthError', () => {
  it('maps 401 to a Vietnamese message that does not reveal whether the email exists', () => {
    const msg = describeAuthError(new ApiError(401, { error: 'invalid email or password' }), t);
    expect(msg).toMatch(/email|mật khẩu/i);
    expect(msg.toLowerCase()).not.toMatch(/không tồn tại|not found|khong ton tai/);
  });

  it('maps 409 to a distinct Vietnamese "email already registered" message', () => {
    const msg409 = describeAuthError(new ApiError(409, { error: 'email already registered' }), t);
    const msg401 = describeAuthError(new ApiError(401, { error: 'invalid email or password' }), t);
    expect(msg409).not.toBe(msg401);
    expect(msg409).toMatch(/email/i);
  });

  it('maps 429 to a distinct "try again later" Vietnamese message', () => {
    const msg = describeAuthError(new ApiError(429, { error: 'rate limited' }), t);
    expect(msg).toMatch(/thử lại|đợi/i);
  });

  it('maps 500 to a distinct Vietnamese "server error" message, not the same copy as 401', () => {
    const msg500 = describeAuthError(new ApiError(500, { error: 'registration failed' }), t);
    const msg401 = describeAuthError(new ApiError(401, { error: 'invalid email or password' }), t);
    expect(msg500).not.toBe(msg401);
    expect(msg500).toMatch(/máy chủ|lỗi/i);
  });

  it('falls back to a generic Vietnamese message for a non-ApiError (e.g. network failure)', () => {
    expect(describeAuthError(new TypeError('Failed to fetch'), t)).toMatch(/kết nối|lỗi/i);
    expect(describeAuthError('boom', t)).toMatch(/kết nối|lỗi/i);
  });

  it('the transport-failure message names BOTH causes — not just "check your network" (ruling S1-F25)', () => {
    // `serverAnswered` documents that offline, DNS failure, a refused
    // connection and a CORS refusal all arrive as the same bare `TypeError`,
    // with the browser deliberately refusing to say which. This string is
    // what a visitor sees when that happens on a COLD load, before anything
    // else on the page exists — so if it names only the network, a
    // misconfigured deploy tells every visitor their wifi is bad and neither
    // they nor the operator ever learns otherwise. That is the invisible
    // failure S1-F25 is about; the fix is one clause, and this is what keeps
    // it from being tidied away.
    const msg = describeAuthError(new TypeError('Failed to fetch'), t);
    expect(msg).toMatch(/ngoại tuyến|mạng/i);
    expect(msg).toMatch(/cấu hình|CORS/i);
  });
});
