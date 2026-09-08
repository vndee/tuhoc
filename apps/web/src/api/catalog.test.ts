import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NotJsonError } from './client';
import { assetUrl, CourseFetchError, fetchCatalog, fetchChapter, fetchManifest } from './catalog';
import type { Manifest } from '../course/types';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const manifest: Manifest = {
  id: 'demo',
  title: 'Khóa học demo',
  description: 'Một khóa học để test',
  lang: 'vi',
  version: '1.0.0',
  runtime: '^1',
  parts: [
    {
      title: 'Phần 1',
      chapters: [{ id: 'c1', num: '1.1', title: 'Chương một', short: 'Chương 1', file: 'chapters/c1.html' }],
    },
  ],
};

describe('fetchCatalog', () => {
  it('returns GET /courses as the public catalog', async () => {
    server.use(
      http.get('/courses', () =>
        HttpResponse.json([{ slug: 'demo', title: 'Khóa học demo', lang: 'vi', description: 'desc', version: 3 }]),
      ),
    );

    await expect(fetchCatalog()).resolves.toEqual([
      { slug: 'demo', title: 'Khóa học demo', lang: 'vi', description: 'desc', version: 3 },
    ]);
  });

  /**
   * Final whole-branch review, Important 3. Local dev with `VITE_API_URL`
   * unset resolves `/courses` against `http://localhost:5173` itself — the
   * SPA's OWN client-side `/courses` route — which answers `200 text/html`
   * (index.html), never the catalog. Before this fix, `getJson` called
   * `res.json()` directly, which throws a raw, unhandled `SyntaxError` on
   * that body (`Unexpected token '<'...`) — `catalog.ts`'s own header
   * comment names `CourseFetchError` as "the ONE place a course's bytes
   * come from now", but a bare `SyntaxError` is neither that nor
   * `NotJsonError`, so nothing in this app's error-handling ever caught it
   * cleanly. This asserts the same `NotJsonError` guard `client.ts` has,
   * given the exact SPA-fallback shape.
   */
  it('ném NotJsonError, không phải SyntaxError trần, khi /courses trả về 200 text/html (SPA fallback do VITE_API_URL chưa đặt)', async () => {
    server.use(
      http.get('/courses', () =>
        HttpResponse.html('<!doctype html>\n<html lang="vi"><head><title>Tự học</title></head><body></body></html>'),
      ),
    );

    await expect(fetchCatalog()).rejects.toBeInstanceOf(NotJsonError);
  });

  it('ném NotJsonError khi thân 2xx là JSON hợp lệ nhưng không phải MẢNG (null) — GET /courses luôn trả mảng', async () => {
    server.use(http.get('/courses', () => HttpResponse.json(null)));
    await expect(fetchCatalog()).rejects.toBeInstanceOf(NotJsonError);
  });
});

describe('fetchManifest / fetchChapter — thân 2xx là JSON hợp lệ nhưng không phải object', () => {
  it('fetchManifest ném NotJsonError khi thân là một MẢNG, không phải Manifest', async () => {
    server.use(http.get('/courses/:slug', () => HttpResponse.json([manifest])));
    await expect(fetchManifest('demo')).rejects.toBeInstanceOf(NotJsonError);
  });

  it('fetchChapter ném NotJsonError khi thân là null', async () => {
    server.use(http.get('/courses/:slug/chapters/:chapterId', () => HttpResponse.json(null)));
    await expect(fetchChapter('demo', 'c1')).rejects.toBeInstanceOf(NotJsonError);
  });
});

describe('fetchManifest', () => {
  it('GETs /courses/:slug and returns the manifest verbatim', async () => {
    let path = '';
    server.use(
      http.get('/courses/:slug', ({ params }) => {
        path = String(params.slug);
        return HttpResponse.json(manifest);
      }),
    );

    await expect(fetchManifest('demo')).resolves.toEqual(manifest);
    expect(path).toBe('demo');
  });

  it('percent-encodes the slug', async () => {
    let seenPath = '';
    server.use(
      http.get('/courses/*', ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return HttpResponse.json(manifest);
      }),
    );

    await fetchManifest('a b/c');
    expect(seenPath).toBe('/courses/a%20b%2Fc');
  });

  it('throws CourseFetchError with the HTTP status on a 404', async () => {
    server.use(http.get('/courses/:slug', () => new HttpResponse(null, { status: 404 })));

    const failure = fetchManifest('khong-ton-tai');
    await expect(failure).rejects.toBeInstanceOf(CourseFetchError);
    await expect(failure).rejects.toMatchObject({ status: 404 });
  });

  it('throws CourseFetchError (not a swallowed error) on a 500', async () => {
    server.use(http.get('/courses/:slug', () => new HttpResponse(null, { status: 500 })));

    await expect(fetchManifest('demo')).rejects.toMatchObject({ status: 500 });
  });
});

describe('fetchChapter', () => {
  it('GETs /courses/:slug/chapters/:chapterId and returns html + widgets', async () => {
    let path = '';
    server.use(
      http.get('/courses/:slug/chapters/:chapterId', ({ params }) => {
        path = `${String(params.slug)}/${String(params.chapterId)}`;
        return HttpResponse.json({ html: '<h1>Chương một</h1>', widgets: [{ name: 'dem-so', html: '<div></div>' }] });
      }),
    );

    await expect(fetchChapter('demo', 'c1')).resolves.toEqual({
      html: '<h1>Chương một</h1>',
      widgets: [{ name: 'dem-so', html: '<div></div>' }],
    });
    expect(path).toBe('demo/c1');
  });

  it('carries the widgets array through even when empty — Task 10 does not read it, but must not drop it', async () => {
    server.use(
      http.get('/courses/:slug/chapters/:chapterId', () =>
        HttpResponse.json({ html: '<p>chỉ văn xuôi</p>', widgets: [] }),
      ),
    );

    await expect(fetchChapter('demo', 'c1')).resolves.toEqual({ html: '<p>chỉ văn xuôi</p>', widgets: [] });
  });

  it('throws CourseFetchError with the HTTP status when the chapter 404s (chapter or course missing)', async () => {
    server.use(http.get('/courses/:slug/chapters/:chapterId', () => new HttpResponse(null, { status: 404 })));

    const failure = fetchChapter('demo', 'khong-ton-tai');
    await expect(failure).rejects.toBeInstanceOf(CourseFetchError);
    await expect(failure).rejects.toMatchObject({ status: 404 });
  });

  it('percent-encodes both the slug and the chapter id', async () => {
    let seenPath = '';
    server.use(
      http.get('/courses/*', ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return HttpResponse.json({ html: '', widgets: [] });
      }),
    );

    await fetchChapter('a b', 'c 1');
    expect(seenPath).toBe('/courses/a%20b/chapters/c%201');
  });
});

describe('assetUrl', () => {
  it('builds an absolute-path URL under /courses/:slug/assets/', () => {
    expect(assetUrl('demo', 'images/fig1.png')).toBe('/courses/demo/assets/images/fig1.png');
  });

  it('percent-encodes each path segment individually, keeping the slashes', () => {
    expect(assetUrl('a b', 'tên có dấu/hình 1.png')).toBe(
      '/courses/a%20b/assets/t%C3%AAn%20c%C3%B3%20d%E1%BA%A5u/h%C3%ACnh%201.png',
    );
  });

  it('does not fetch anything — it only builds a string', () => {
    // No msw handler registered; onUnhandledRequest: 'error' would fail this
    // test if assetUrl ever touched the network.
    expect(() => assetUrl('demo', 'x.png')).not.toThrow();
  });
});

/**
 * Ba đường đọc của tệp này phải GỬI COOKIE.
 *
 * Chúng từng là công khai thuần, nên `fetch` trần là đúng và rẻ. Giả định ấy
 * chết vào ngày khoá học có thể riêng tư — và cái chết ấy đã đo được trên sản
 * xuất: một người đã đăng nhập, đã được cấp quyền, mở bảng điều khiển và thấy
 * "Không tải được khoá học", vì `GET /courses/<slug>` trả 404 cho một request
 * mà máy chủ chỉ có thể đọc là của người lạ.
 *
 * Đo bằng cách chặn `globalThis.fetch` chứ không qua msw: msw không phản chiếu
 * `credentials` một cách đáng tin giữa các môi trường (xem chú thích trong
 * `client.test.ts`), và một phép đo "mềm" ở đúng chỗ này thì vô dụng — nó sẽ
 * xanh cả khi cookie không được gửi, tức xanh đúng lúc lỗi quay lại.
 */
describe('mọi request danh mục đều mang cookie phiên', () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['fetchCatalog', () => fetchCatalog()],
    ['fetchManifest', () => fetchManifest('demo')],
    ['fetchChapter', () => fetchChapter('demo', 'c1')],
  ];

  for (const [name, call] of cases) {
    it(`${name} gửi credentials: "include"`, async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
      try {
        await call().catch(() => undefined);
        expect(spy).toHaveBeenCalledTimes(1);
        const init = spy.mock.calls[0][1] as RequestInit | undefined;
        expect(init?.credentials, `${name} phải gửi cookie, nếu không khoá riêng luôn 404`).toBe('include');
      } finally {
        spy.mockRestore();
      }
    });
  }
});
