import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Same rationale as `api/client.test.ts`: the 401 redirect is a hard
// `window.location` navigation jsdom cannot perform, so it is mocked at the
// module boundary and asserted as "was it requested", not "did it happen".
vi.mock('../api/navigation', () => ({
  redirectToLogin: vi.fn(),
}));

import { t as lookup, type Translate } from '../i18n';
import { redirectToLogin } from '../api/navigation';
import { ApiError } from '../api/client';
import {
  FindingsError,
  adminListCourses,
  adminPublish,
  adminRollback,
  adminUnpublish,
  describeAdminError,
} from './adminApi';

const t: Translate = (key, ...args) => lookup('vi', key, ...args);

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.mocked(redirectToLogin).mockClear();
});
afterAll(() => server.close());

function row(over: Record<string, unknown> = {}) {
  return {
    slug: 'dai-so',
    title: 'Đại số',
    version: 3,
    published_at: '2026-08-20T10:15:30.000Z',
    versions: [1, 2, 3],
    ...over,
  };
}

const zip = () => new File([new Uint8Array([1, 2, 3, 4])], 'dai-so.zip', { type: 'application/zip' });

describe('adminListCourses', () => {
  it('GET /admin/courses → the array, verbatim', async () => {
    server.use(http.get('/admin/courses', () => HttpResponse.json([row()])));
    await expect(adminListCourses()).resolves.toEqual([row()]);
  });

  it('a non-2xx rejects with ApiError', async () => {
    server.use(http.get('/admin/courses', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    await expect(adminListCourses()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('adminPublish', () => {
  it('PUT /admin/courses/:slug, Content-Type application/zip, body = the raw bytes, slug percent-encoded', async () => {
    let method = '';
    let contentType: string | null = null;
    let path = '';
    let bodyBytes: Uint8Array | null = null;
    server.use(
      http.put('/admin/courses/:slug', async ({ request, params }) => {
        method = request.method;
        contentType = request.headers.get('content-type');
        path = String(params.slug);
        bodyBytes = new Uint8Array(await request.arrayBuffer());
        return HttpResponse.json({ slug: 'đại số', version: 4 }, { status: 201 });
      }),
    );

    await adminPublish('đại số', zip());

    expect(method).toBe('PUT');
    expect(path).toBe('đại số');
    expect(contentType).toBe('application/zip');
    expect(bodyBytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('201 resolves with {slug, version} — version is the server publish sequence, not a semver', async () => {
    server.use(http.put('/admin/courses/:slug', () => HttpResponse.json({ slug: 'dai-so', version: 4 }, { status: 201 })));
    await expect(adminPublish('dai-so', zip())).resolves.toEqual({ slug: 'dai-so', version: 4 });
  });

  /**
   * The 400 shape this whole task exists to render: EVERY finding at once,
   * not just the first. `FindingsError` is how that survives the trip from
   * `adminApi.ts` (which knows the wire shape) to `AdminCourses.tsx` (which
   * draws the table) without the screen having to know `{error, findings}`
   * is the body of an `ApiError`.
   */
  it('400 with findings → rejects with FindingsError carrying every finding, in order', async () => {
    const findings = [
      { code: 'MANIFEST_MISSING', path: 'manifest.json', detail: 'package has no manifest.json at its root' },
      { code: 'DUPLICATE_CHAPTER_ID', path: 'chapters/c1.html', detail: 'two chapters share one id' },
    ];
    server.use(
      http.put('/admin/courses/:slug', () =>
        HttpResponse.json({ error: 'invalid course package', findings }, { status: 400 }),
      ),
    );

    const failure = adminPublish('dai-so', zip());
    await expect(failure).rejects.toBeInstanceOf(FindingsError);
    await expect(failure).rejects.toMatchObject({ findings });
  });

  it('a 400 with NO findings array (e.g. slug mismatch) stays a plain ApiError, not a FindingsError', async () => {
    server.use(
      http.put('/admin/courses/:slug', () =>
        HttpResponse.json({ error: 'slug in package does not match URL slug' }, { status: 400 }),
      ),
    );

    const failure = adminPublish('dai-so', zip());
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.not.toBeInstanceOf(FindingsError);
  });

  it('401 triggers the shared redirectToLogin side effect, same as every other authenticated call', async () => {
    server.use(http.put('/admin/courses/:slug', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    await expect(adminPublish('dai-so', zip())).rejects.toBeInstanceOf(ApiError);
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });
});

describe('adminUnpublish', () => {
  it('DELETE /admin/courses/:slug, slug percent-encoded', async () => {
    let method = '';
    let path = '';
    server.use(
      http.delete('/admin/courses/:slug', ({ request, params }) => {
        method = request.method;
        path = String(params.slug);
        return HttpResponse.json({ slug: path });
      }),
    );

    await adminUnpublish('đại số');
    expect(method).toBe('DELETE');
    expect(path).toBe('đại số');
  });

  it('resolves (void) on 200', async () => {
    server.use(http.delete('/admin/courses/:slug', () => HttpResponse.json({ slug: 'dai-so' })));
    await expect(adminUnpublish('dai-so')).resolves.toBeUndefined();
  });

  it('404 (unknown slug) rejects with ApiError', async () => {
    server.use(http.delete('/admin/courses/:slug', () => HttpResponse.json({ error: 'not found' }, { status: 404 })));
    await expect(adminUnpublish('ghost')).rejects.toMatchObject({ status: 404 });
  });
});

describe('adminRollback', () => {
  it('POST /admin/courses/:slug/rollback, body {version}', async () => {
    let path = '';
    let body: unknown = null;
    server.use(
      http.post('/admin/courses/:slug/rollback', async ({ request, params }) => {
        path = String(params.slug);
        body = await request.json();
        return HttpResponse.json({ slug: path, version: 2 }, { status: 201 });
      }),
    );

    await expect(adminRollback('dai-so', 2)).resolves.toEqual({ slug: 'dai-so', version: 2 });
    expect(path).toBe('dai-so');
    expect(body).toEqual({ version: 2 });
  });

  it('400 with findings (rollback re-validates the stored package) → FindingsError', async () => {
    const findings = [{ code: 'CHAPTER_FILE_MISSING', path: 'chapters/c2.html', detail: 'missing' }];
    server.use(
      http.post('/admin/courses/:slug/rollback', () =>
        HttpResponse.json({ error: 'invalid course package', findings }, { status: 400 }),
      ),
    );
    await expect(adminRollback('dai-so', 2)).rejects.toBeInstanceOf(FindingsError);
  });
});

describe('describeAdminError', () => {
  it('maps a 500 to the server-down sentence', () => {
    expect(describeAdminError(new ApiError(500, { error: 'boom' }), t)).toBe(t('admin.error.serverDown'));
  });

  it('maps a 404 to the not-found sentence', () => {
    expect(describeAdminError(new ApiError(404, { error: 'not found' }), t)).toBe(t('admin.error.notFound'));
  });

  it('maps a plain (non-findings) 400 to the bad-request sentence', () => {
    expect(describeAdminError(new ApiError(400, { error: 'bad' }), t)).toBe(t('admin.error.badRequest'));
  });

  it('a non-ApiError (no response ever arrived) maps to the unreachable sentence', () => {
    expect(describeAdminError(new TypeError('Failed to fetch'), t)).toBe(t('admin.error.unreachable'));
  });
});
