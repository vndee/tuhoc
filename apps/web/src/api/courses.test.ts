import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Same reasoning as api/client.test.ts: the 401 redirect is a hard
// `window.location` navigation, which jsdom does not implement. Mocked at
// the module boundary so these tests can assert WHETHER it was requested.
vi.mock('./navigation', () => ({
  redirectToLogin: vi.fn(),
}));

import { ApiError } from './client';
import { fetchPackage, fetchPackageAsset, listCourses } from './courses';
import { redirectToLogin } from './navigation';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.mocked(redirectToLogin).mockClear();
});
afterAll(() => server.close());

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes);

const manifest = {
  id: 'goi',
  title: 'Gói',
  description: '',
  lang: 'vi',
  version: '1.0.0',
  runtime: '^1',
  tier: 'content',
  parts: [
    {
      title: 'Phần 1',
      chapters: [
        { id: 'c1', num: '1.1', title: 'Một', short: 'Một', file: 'chapters/c1.html' },
        { id: 'c2', num: '1.2', title: 'Hai', short: 'Hai', file: 'chapters/c2.html' },
      ],
    },
  ],
};

describe('listCourses', () => {
  it('returns GET /courses as the catalog the server documents', async () => {
    server.use(
      http.get('/courses', () =>
        HttpResponse.json([
          { id: 'goi', title: 'Gói', lang: 'vi', tier: 'content', versions: ['1.0.0', '1.1.0'], pinned: '1.1.0' },
        ]),
      ),
    );

    await expect(listCourses()).resolves.toEqual([
      { id: 'goi', title: 'Gói', lang: 'vi', tier: 'content', versions: ['1.0.0', '1.1.0'], pinned: '1.1.0' },
    ]);
  });

  it('sends a 401 to /login by default — a library screen with a dead session has nothing left to render', async () => {
    server.use(http.get('/courses', () => new HttpResponse(null, { status: 401 })));

    await expect(listCourses()).rejects.toBeInstanceOf(ApiError);
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });

  it('can be asked NOT to redirect, for the speculative call course/loader.ts makes', async () => {
    // `course/loader.ts` consults the catalog for a course that may simply
    // not exist, after the static directory has already refused. A
    // background probe that yanks the reader out of the page they are on is
    // a worse answer than the error the caller already had; `RequireAuth`
    // and `useMe` own the "your session died" transition, and this is not
    // them.
    server.use(http.get('/courses', () => new HttpResponse(null, { status: 401 })));

    await expect(listCourses({ redirectOn401: false })).rejects.toBeInstanceOf(ApiError);
    expect(redirectToLogin).not.toHaveBeenCalled();
  });
});

describe('fetchPackageAsset', () => {
  it('reads one file out of a stored package as BYTES, not as text or JSON', async () => {
    server.use(
      http.get('/courses/goi/@1.0.0/chapters/c1.html', () => new HttpResponse(encode('<h1>Một</h1>'))),
    );

    const bytes = await fetchPackageAsset('goi', '1.0.0', 'chapters/c1.html');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(decode(bytes)).toBe('<h1>Một</h1>');
  });

  it('percent-encodes each path segment, and only the segments', async () => {
    // A course id or a version that contains a slash would otherwise
    // address a different package than the one it names — the same reason
    // the server refuses those ids outright (usecase.go's pathSafeParam).
    // The separators between segments must survive, or the asset path
    // stops being a path.
    let seen = '';
    server.use(
      http.get('/courses/*', ({ request }) => {
        seen = new URL(request.url).pathname;
        return new HttpResponse(encode('ok'));
      }),
    );

    await fetchPackageAsset('a b', '1.0.0', 'chapters/tên có dấu.html');
    expect(seen).toBe('/courses/a%20b/@1.0.0/chapters/t%C3%AAn%20c%C3%B3%20d%E1%BA%A5u.html');
  });

  it('throws ApiError with the status when the asset is not there', async () => {
    server.use(http.get('/courses/goi/@1.0.0/nope.html', () => new HttpResponse(null, { status: 404 })));

    const failure = fetchPackageAsset('goi', '1.0.0', 'nope.html');
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 404 });
  });
});

describe('fetchPackage', () => {
  it('collects the manifest and every chapter file the manifest names', async () => {
    const requested: string[] = [];
    server.use(
      http.get('/courses/goi/@1.0.0/manifest.json', () => {
        requested.push('manifest.json');
        return new HttpResponse(encode(JSON.stringify(manifest)));
      }),
      http.get('/courses/goi/@1.0.0/chapters/:file', ({ params }) => {
        requested.push(`chapters/${params.file as string}`);
        return new HttpResponse(encode(`<h1>${params.file as string}</h1>`));
      }),
    );

    const files = await fetchPackage('goi', '1.0.0');

    expect(Object.keys(files).sort()).toEqual(['chapters/c1.html', 'chapters/c2.html', 'manifest.json']);
    expect(decode(files['chapters/c2.html'])).toBe('<h1>c2.html</h1>');
    expect(requested.sort()).toEqual(['chapters/c1.html', 'chapters/c2.html', 'manifest.json']);
  });

  it('requests a file named by two chapters exactly once', async () => {
    let hits = 0;
    const shared = {
      ...manifest,
      parts: [
        {
          title: 'Phần 1',
          chapters: [
            { id: 'c1', num: '1.1', title: 'Một', short: 'Một', file: 'chapters/shared.html' },
            { id: 'c2', num: '1.2', title: 'Hai', short: 'Hai', file: 'chapters/shared.html' },
          ],
        },
      ],
    };
    server.use(
      http.get('/courses/goi/@1.0.0/manifest.json', () => new HttpResponse(encode(JSON.stringify(shared)))),
      http.get('/courses/goi/@1.0.0/chapters/shared.html', () => {
        hits++;
        return new HttpResponse(encode('<h1>chung</h1>'));
      }),
    );

    await fetchPackage('goi', '1.0.0');
    expect(hits).toBe(1);
  });

  it('refuses a stored package whose manifest is not JSON, instead of returning a package with no chapters', async () => {
    // The failure mode this rules out is the quiet one: a manifest that
    // will not parse yields zero chapter names, and a package with a
    // manifest and no chapters looks like a successful download of an
    // empty course.
    server.use(
      http.get('/courses/goi/@1.0.0/manifest.json', () => new HttpResponse(encode('<html>not json</html>'))),
    );

    await expect(fetchPackage('goi', '1.0.0')).rejects.toThrow();
  });

  it('refuses a manifest that parses but names no chapters at all', async () => {
    server.use(http.get('/courses/goi/@1.0.0/manifest.json', () => new HttpResponse(encode('{"id":"goi"}'))));

    await expect(fetchPackage('goi', '1.0.0')).rejects.toThrow();
  });
});
