import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
