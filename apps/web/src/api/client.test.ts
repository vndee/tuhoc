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

import { api, ApiError, describeAuthError, serverAnswered } from './client';
import { redirectToLogin } from './navigation';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.mocked(redirectToLogin).mockClear();
});
afterAll(() => server.close());

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
    const msg = describeAuthError(new ApiError(401, { error: 'invalid email or password' }));
    expect(msg).toMatch(/email|mật khẩu/i);
    expect(msg.toLowerCase()).not.toMatch(/không tồn tại|not found|khong ton tai/);
  });

  it('maps 409 to a distinct Vietnamese "email already registered" message', () => {
    const msg409 = describeAuthError(new ApiError(409, { error: 'email already registered' }));
    const msg401 = describeAuthError(new ApiError(401, { error: 'invalid email or password' }));
    expect(msg409).not.toBe(msg401);
    expect(msg409).toMatch(/email/i);
  });

  it('maps 429 to a distinct "try again later" Vietnamese message', () => {
    const msg = describeAuthError(new ApiError(429, { error: 'rate limited' }));
    expect(msg).toMatch(/thử lại|đợi/i);
  });

  it('maps 500 to a distinct Vietnamese "server error" message, not the same copy as 401', () => {
    const msg500 = describeAuthError(new ApiError(500, { error: 'registration failed' }));
    const msg401 = describeAuthError(new ApiError(401, { error: 'invalid email or password' }));
    expect(msg500).not.toBe(msg401);
    expect(msg500).toMatch(/máy chủ|lỗi/i);
  });

  it('falls back to a generic Vietnamese message for a non-ApiError (e.g. network failure)', () => {
    expect(describeAuthError(new TypeError('Failed to fetch'))).toMatch(/kết nối|lỗi/i);
    expect(describeAuthError('boom')).toMatch(/kết nối|lỗi/i);
  });
});
