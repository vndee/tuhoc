import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type PackageRow } from '../db/local';
import {
  CourseFetchError,
  describeCourseError,
  loadChapter,
  loadManifest,
  ManifestParseError,
  PackageAssetError,
  resolveVizScriptUrl,
  revokeVizScriptUrls,
  RuntimeMismatchError,
} from './loader';
import type { Manifest } from './types';
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


const COURSE_ID = 'demo';

const validManifest: Manifest = {
  id: COURSE_ID,
  title: 'Khóa học demo',
  description: 'Một khóa học để test loader',
  lang: 'vi',
  version: '1.0.0',
  runtime: '^1',
  parts: [
    {
      title: 'Phần 1',
      chapters: [
        { id: 'c1', num: '1.1', title: 'Chương một', short: 'Chương 1', file: 'chapters/c1.html' },
        { id: 'c2', num: '1.2', title: 'Chương hai', short: 'Chương 2', file: 'chapters/c2.html' },
      ],
    },
  ],
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// The loader now reads Dexie BEFORE it reads the network (see below), so a
// package row leaking between tests would change the answer of every test
// in this file. Cleared per test rather than per describe for that reason.
beforeEach(() => db.packages.clear());

const encode = (text: string) => new TextEncoder().encode(text);

/** A cached package for `validManifest`'s course, with its one chapter file. */
function cachedPackage(overrides: Partial<PackageRow> = {}): PackageRow {
  const manifest = { ...validManifest, title: 'Bản đã lưu trên máy' };
  return {
    key: `${COURSE_ID}@1.0.0`,
    courseId: COURSE_ID,
    version: '1.0.0',
    manifest,
    files: {
      'manifest.json': encode(JSON.stringify(manifest)),
      'chapters/c1.html': encode('<h1 class="ch-title">Chương một, từ gói đã lưu</h1>'),
    },
    pinnedAt: '2026-08-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('loadManifest', () => {
  it('fetches and parses a valid manifest', async () => {
    server.use(
      http.get('/courses/:courseId/manifest.json', () => HttpResponse.json(validManifest)),
    );

    await expect(loadManifest(COURSE_ID)).resolves.toEqual(validManifest);
  });

  it('throws RuntimeMismatchError, distinct from other failures, when the manifest declares an incompatible major', async () => {
    server.use(
      http.get('/courses/:courseId/manifest.json', () =>
        HttpResponse.json({ ...validManifest, runtime: '^2' }),
      ),
    );

    await expect(loadManifest(COURSE_ID)).rejects.toBeInstanceOf(RuntimeMismatchError);
  });

  it('accepts a patch/minor-qualified ^1 range (e.g. "^1.4.0")', async () => {
    server.use(
      http.get('/courses/:courseId/manifest.json', () =>
        HttpResponse.json({ ...validManifest, runtime: '^1.4.0' }),
      ),
    );

    await expect(loadManifest(COURSE_ID)).resolves.toMatchObject({ runtime: '^1.4.0' });
  });

  it('throws CourseFetchError with the HTTP status when the manifest 404s', async () => {
    server.use(http.get('/courses/:courseId/manifest.json', () => new HttpResponse(null, { status: 404 })));

    const failure = loadManifest(COURSE_ID);
    await expect(failure).rejects.toBeInstanceOf(CourseFetchError);
    await expect(failure).rejects.toMatchObject({ status: 404 });
  });

  it('throws ManifestParseError (not CourseFetchError) when a misconfigured host returns an HTML error page with a 200', async () => {
    server.use(
      http.get('/courses/:courseId/manifest.json', () =>
        HttpResponse.html('<!DOCTYPE html><html><body>404 — not found</body></html>', { status: 200 }),
      ),
    );

    const failure = loadManifest(COURSE_ID);
    await expect(failure).rejects.toBeInstanceOf(ManifestParseError);
    await expect(failure).rejects.not.toBeInstanceOf(CourseFetchError);
  });

  it('throws ManifestParseError when the body is valid JSON but not shaped like a manifest', async () => {
    server.use(http.get('/courses/:courseId/manifest.json', () => HttpResponse.json({ ok: true })));

    await expect(loadManifest(COURSE_ID)).rejects.toBeInstanceOf(ManifestParseError);
  });
});

describe('describeCourseError', () => {
  it('describes a RuntimeMismatchError in Vietnamese, not the raw English Error#message', () => {
    const error = new RuntimeMismatchError('^2');
    const description = describeCourseError(error, t);
    expect(description).toMatch(/^Không tải được khóa học/);
    expect(description).not.toBe(error.message);
  });

  it('describes a 404 CourseFetchError distinctly from other HTTP statuses', () => {
    const notFound = describeCourseError(new CourseFetchError('https://x/manifest.json', 404), t);
    const serverError = describeCourseError(new CourseFetchError('https://x/manifest.json', 500), t);
    expect(notFound).toMatch(/^Không tải được khóa học/);
    expect(serverError).toMatch(/^Không tải được khóa học/);
    expect(notFound).not.toBe(serverError);
  });

  it('describes a ManifestParseError in Vietnamese, not the raw English Error#message', () => {
    const error = new ManifestParseError('https://x/manifest.json', new SyntaxError('Unexpected token <'));
    const description = describeCourseError(error, t);
    expect(description).toMatch(/^Không tải được khóa học/);
    expect(description).not.toBe(error.message);
  });

  it('falls back to a generic Vietnamese message for anything else (e.g. a plain thrown value)', () => {
    expect(describeCourseError('boom', t)).toMatch(/^Không tải được khóa học/);
    expect(describeCourseError(new Error('some unrelated failure'), t)).toMatch(/^Không tải được khóa học/);
  });
});

describe('loadChapter', () => {
  it('fetches a chapter fragment as text', async () => {
    server.use(
      http.get('/courses/:courseId/chapters/c1.html', () =>
        HttpResponse.html('<h1 class="ch-title">Chương một</h1>'),
      ),
    );

    await expect(loadChapter(COURSE_ID, 'chapters/c1.html')).resolves.toBe(
      '<h1 class="ch-title">Chương một</h1>',
    );
  });

  it('throws CourseFetchError when the chapter file 404s', async () => {
    server.use(http.get('/courses/:courseId/chapters/missing.html', () => new HttpResponse(null, { status: 404 })));

    const failure = loadChapter(COURSE_ID, 'chapters/missing.html');
    await expect(failure).rejects.toBeInstanceOf(CourseFetchError);
    await expect(failure).rejects.toMatchObject({ status: 404 });
  });
});

/* ====================================================================== *
 * Two sources
 * ====================================================================== */

/**
 * A course can now come from two places, and every test below exists to
 * pin WHICH ONE ANSWERS:
 *
 *   1. `db.packages` — a package this reader imported or pulled down. It
 *      lives in IndexedDB, so it is the only source that works with the
 *      network switched off.
 *   2. `courses/` — the directory this repo ships, served at
 *      `/courses/<id>/...` by `apps/web/vite-plugins/courseAssets.ts` in
 *      dev and copied into the build output for production.
 *
 * The cached package wins. See `loader.ts`'s own comment for the argument.
 */
describe('the cached package is the first source', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens a chapter while OFFLINE from the cached package, without touching the network', async () => {
    await db.packages.put(cachedPackage());
    // No msw handler is registered in this test, and the server was started
    // with `onUnhandledRequest: 'error'` — so a stray request would already
    // fail loudly. The spy is here to say the thing out loud anyway: the
    // claim being tested is "zero requests", not "no request that missed a
    // handler."
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const manifest = await loadManifest(COURSE_ID);
    expect(manifest.title).toBe('Bản đã lưu trên máy');

    const html = await loadChapter(COURSE_ID, 'chapters/c1.html');
    expect(html).toContain('từ gói đã lưu');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('wins over a static course of the same id — and wins for the chapter too, not just the manifest', async () => {
    // Both sources are present and they DISAGREE. Splitting the decision
    // (manifest from one source, chapter body from the other) is the
    // failure this asserts against: a reader would be shown one course's
    // table of contents wrapped around another course's prose.
    server.use(
      http.get('/courses/:courseId/manifest.json', () => HttpResponse.json(validManifest)),
      http.get('/courses/:courseId/chapters/c1.html', () => HttpResponse.html('<h1>tĩnh</h1>')),
    );
    await db.packages.put(cachedPackage());

    await expect(loadManifest(COURSE_ID)).resolves.toMatchObject({ title: 'Bản đã lưu trên máy' });
    await expect(loadChapter(COURSE_ID, 'chapters/c1.html')).resolves.toContain('từ gói đã lưu');
  });

  it('leaves the static directory as the source when nothing is cached', async () => {
    server.use(
      http.get('/courses/:courseId/manifest.json', () => HttpResponse.json(validManifest)),
      http.get('/courses/:courseId/chapters/c1.html', () => HttpResponse.html('<h1>tĩnh</h1>')),
    );

    await expect(loadManifest(COURSE_ID)).resolves.toEqual(validManifest);
    await expect(loadChapter(COURSE_ID, 'chapters/c1.html')).resolves.toBe('<h1>tĩnh</h1>');
  });

  it('applies the runtime check to a cached manifest exactly as it does to one off the network', async () => {
    await db.packages.put(cachedPackage({ manifest: { ...validManifest, runtime: '^2' } }));

    await expect(loadManifest(COURSE_ID)).rejects.toBeInstanceOf(RuntimeMismatchError);
  });

  it('reports a cached manifest that is not shaped like a manifest as a parse failure, not as a network failure', async () => {
    await db.packages.put(cachedPackage({ manifest: { ok: true } }));

    const failure = loadManifest(COURSE_ID);
    await expect(failure).rejects.toBeInstanceOf(ManifestParseError);
    await expect(failure).rejects.not.toBeInstanceOf(CourseFetchError);
  });

  it('reports a chapter the cached package is missing as its own error — not as a 404 the reader could retry', async () => {
    // The stored package answers for this course, so falling through to the
    // network here would be wrong twice over: it would go online for a
    // course the reader chose to hold locally, and it would splice a
    // different copy's chapter into this one.
    await db.packages.put(cachedPackage({ files: { 'manifest.json': encode('{}') } }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const failure = loadChapter(COURSE_ID, 'chapters/c1.html');
    await expect(failure).rejects.toBeInstanceOf(PackageAssetError);
    await expect(failure).rejects.not.toBeInstanceOf(CourseFetchError);
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(describeCourseError(new PackageAssetError(COURSE_ID, '1.0.0', 'chapters/c1.html'), t)).toMatch(
      /^Không tải được khóa học/,
    );
  });

  it('reads the version that was pinned most recently when two versions of one course are held', async () => {
    await db.packages.put(
      cachedPackage({
        key: `${COURSE_ID}@1.0.0`,
        version: '1.0.0',
        manifest: { ...validManifest, title: 'Bản cũ' },
        pinnedAt: '2026-08-01T10:00:00.000Z',
      }),
    );
    await db.packages.put(
      cachedPackage({
        key: `${COURSE_ID}@1.1.0`,
        version: '1.1.0',
        manifest: { ...validManifest, title: 'Bản mới' },
        pinnedAt: '2026-08-21T10:00:00.000Z',
      }),
    );

    await expect(loadManifest(COURSE_ID)).resolves.toMatchObject({ title: 'Bản mới' });
  });
});

describe('filling the cache from the server', () => {
  const PACKAGE_ID = 'goi-nhap';

  const packageManifest: Manifest = {
    ...validManifest,
    id: PACKAGE_ID,
    title: 'Gói nhập từ máy chủ',
    parts: [
      {
        title: 'Phần 1',
        chapters: [{ id: 'c1', num: '1.1', title: 'Chương một', short: 'Chương 1', file: 'chapters/c1.html' }],
      },
    ],
  };

  function serveStoredPackage() {
    server.use(
      http.get(`/courses/${PACKAGE_ID}/manifest.json`, () => new HttpResponse(null, { status: 404 })),
      http.get('/courses', () =>
        HttpResponse.json([
          { id: PACKAGE_ID, title: packageManifest.title, lang: 'vi', tier: 'content', versions: ['1.0.0'], pinned: '1.0.0' },
        ]),
      ),
      http.get(`/courses/${PACKAGE_ID}/@1.0.0/manifest.json`, () => new HttpResponse(encode(JSON.stringify(packageManifest)))),
      http.get(`/courses/${PACKAGE_ID}/@1.0.0/chapters/c1.html`, () => new HttpResponse(encode('<h1>Chương một của gói</h1>'))),
    );
  }

  afterEach(() => vi.restoreAllMocks());

  it('pulls a course the static directory does not have, stores it, and then reads it with no network at all', async () => {
    serveStoredPackage();

    await expect(loadManifest(PACKAGE_ID)).resolves.toMatchObject({ title: 'Gói nhập từ máy chủ' });

    const stored = await db.packages.get(`${PACKAGE_ID}@1.0.0`);
    expect(stored).toBeDefined();
    expect(Object.keys(stored!.files).sort()).toEqual(['chapters/c1.html', 'manifest.json']);

    // The point of storing it: everything after this is offline.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(loadManifest(PACKAGE_ID)).resolves.toMatchObject({ title: 'Gói nhập từ máy chủ' });
    await expect(loadChapter(PACKAGE_ID, 'chapters/c1.html')).resolves.toContain('Chương một của gói');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('surfaces the static failure, not a catalog failure, for a course nobody has', async () => {
    // The reader asked for a course that is neither shipped nor held. The
    // useful sentence is "no such course", which is what the static 404
    // says — replacing it with whatever the catalog lookup happened to
    // return would describe our plumbing instead of their problem.
    server.use(
      http.get('/courses/:courseId/manifest.json', () => new HttpResponse(null, { status: 404 })),
      http.get('/courses', () => HttpResponse.json([])),
    );

    const failure = loadManifest('khong-ton-tai');
    await expect(failure).rejects.toBeInstanceOf(CourseFetchError);
    await expect(failure).rejects.toMatchObject({ status: 404 });
    expect(await db.packages.count()).toBe(0);
  });

  it('surfaces the static failure when the catalog itself is unreachable (offline)', async () => {
    server.use(
      http.get('/courses/:courseId/manifest.json', () => new HttpResponse(null, { status: 404 })),
      http.get('/courses', () => HttpResponse.error()),
    );

    await expect(loadManifest('khong-ton-tai')).rejects.toBeInstanceOf(CourseFetchError);
    expect(await db.packages.count()).toBe(0);
  });

  it('does not consult the catalog for a course whose manifest loaded fine', async () => {
    // No `/courses` handler is registered here on purpose: `onUnhandledRequest:
    // 'error'` turns a speculative catalog call into a failure, which is
    // what keeps this from becoming an extra round trip on every course
    // this app already ships.
    server.use(http.get('/courses/:courseId/manifest.json', () => HttpResponse.json(validManifest)));

    await expect(loadManifest(COURSE_ID)).resolves.toEqual(validManifest);
  });

  it('does not go to the catalog for an incompatible runtime — the course was found, and downloading it again cannot help', async () => {
    server.use(http.get('/courses/:courseId/manifest.json', () => HttpResponse.json({ ...validManifest, runtime: '^2' })));

    await expect(loadManifest(COURSE_ID)).rejects.toBeInstanceOf(RuntimeMismatchError);
  });
});

/* ====================================================================== *
 * Where a course's viz.js lives — ruling S1-F14
 * ====================================================================== */

/**
 * `reader/useCourseKit.ts` used to request `/courses/<id>/viz.js`
 * UNCONDITIONALLY and only report `ready: true` once it had loaded. A
 * `content`-tier package has no `viz.js` by definition — and `content` is
 * the tier the registry recommends — so every imported content course
 * would have parked on "Đang tải chương…" or, at best, on the runtime
 * error screen. The two-source rule answers this too: a cached package
 * says where its own scripts are, and for a content package the honest
 * answer is "there are none."
 */
describe('resolveVizScriptUrl', () => {
  beforeEach(() => revokeVizScriptUrls());
  afterEach(() => revokeVizScriptUrls());

  /** Manifest tĩnh của một khoá phục vụ từ `courses/`, hạng khai tường minh. */
  function serveStaticManifest(tier: string): void {
    server.use(
      http.get('/courses/:courseId/manifest.json', () => HttpResponse.json({ ...validManifest, tier })),
    );
  }

  it('points at the static course directory when a non-cached course declares tier interactive', async () => {
    serveStaticManifest('interactive');

    await expect(resolveVizScriptUrl(COURSE_ID)).resolves.toBe('/courses/demo/viz.js');
  });

  /**
   * HỒI QUY, đo trên trình duyệt thật ngày 2026-08-25.
   *
   * Mở `/c/bat-bien-vong-lap/c1` — gói hạng `content`, phục vụ tĩnh, KHÔNG có
   * gói ghim trên máy — và cả trang đọc chỉ còn một câu: "Không tải được công
   * cụ đọc (KaTeX/mô phỏng)." Chương không hỏng, KaTeX không hỏng; thứ duy
   * nhất thiếu là `viz.js`, một tệp mà hạng `content` theo định nghĩa KHÔNG
   * được phép có (`packages/course-format` từ chối `.js` ở hạng ấy).
   *
   * Phán quyết S1-F14 đã nói đúng câu này rồi — "một gói content không được
   * treo vì chờ một tệp mà theo định nghĩa nó không có" — nhưng bản vá chỉ đặt
   * ở nhánh CÓ gói ghim. Khoá phục vụ tĩnh đi qua nhánh khác, và không ai vá
   * nó cho tới khi có người mở đúng một khoá như thế.
   */
  it('answers null for a non-cached course at tier content — S1-F14 áp cho CẢ khoá phục vụ tĩnh', async () => {
    serveStaticManifest('content');

    await expect(resolveVizScriptUrl(COURSE_ID)).resolves.toBeNull();
  });

  it('answers null when the static manifest itself cannot be read — chương sẽ tự báo lỗi bằng câu của nó', async () => {
    server.use(http.get('/courses/:courseId/manifest.json', () => new HttpResponse(null, { status: 404 })));

    await expect(resolveVizScriptUrl(COURSE_ID)).resolves.toBeNull();
  });

  it('answers null for a cached package with no viz.js — a content package ships none, and the static path is a different course', async () => {
    await db.packages.put(cachedPackage());

    await expect(resolveVizScriptUrl(COURSE_ID)).resolves.toBeNull();
  });

  it('percent-encodes the course id it puts in the static URL', async () => {
    serveStaticManifest('interactive');

    await expect(resolveVizScriptUrl('a b/c')).resolves.toBe('/courses/a%20b%2Fc/viz.js');
  });

  /* ------------------------------------------------------------------ *
   * Ruling S1-F14 narrowed: the question is "has viz.js", not "is local"
   * ------------------------------------------------------------------ */

  /**
   * The first version of this function answered `null` for EVERY cached
   * package. That closed S1-F14's hang and opened a hole the same size:
   * measured against the real 46-file textbook once task 11 made it an
   * imported package, an `interactive` course rendered its prose and ran
   * zero of its 59 simulations, with `viz.js` never requested — the exact
   * path this subsystem exists to serve.
   */
  it('serves a cached package OWN viz.js from the package, as a blob URL', async () => {
    await db.packages.put(
      cachedPackage({
        files: {
          'manifest.json': encode(JSON.stringify(validManifest)),
          'viz.js': encode('window.__vizRan = true;'),
        },
      }),
    );

    const url = await resolveVizScriptUrl(COURSE_ID);

    expect(url).toMatch(/^blob:/);
    // Not the static path: for an imported course that path is a 404, or
    // another course's script.
    expect(url).not.toBe('/courses/demo/viz.js');
  });

  /**
   * `useCourseKit` dedupes script injection BY URL. A fresh
   * `URL.createObjectURL` per call would inject the same viz.js once per
   * mount — `defineViz` re-run for every chapter visit. Stability is the
   * contract, not an optimization.
   */
  it('returns the SAME url across calls for one package version', async () => {
    await db.packages.put(
      cachedPackage({ files: { 'manifest.json': encode('{}'), 'viz.js': encode('/* v1 */') } }),
    );

    const first = await resolveVizScriptUrl(COURSE_ID);
    const second = await resolveVizScriptUrl(COURSE_ID);

    expect(first).toBe(second);
  });

  it('mints a new url — and revokes the old one — when the pinned version changes', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    await db.packages.put(
      cachedPackage({ files: { 'manifest.json': encode('{}'), 'viz.js': encode('/* v1 */') } }),
    );
    const first = await resolveVizScriptUrl(COURSE_ID);

    await db.packages.clear();
    await db.packages.put(
      cachedPackage({
        key: `${COURSE_ID}@2.0.0`,
        version: '2.0.0',
        files: { 'manifest.json': encode('{}'), 'viz.js': encode('/* v2 */') },
      }),
    );
    const second = await resolveVizScriptUrl(COURSE_ID);

    expect(second).not.toBe(first);
    expect(revoke).toHaveBeenCalledWith(first);
    revoke.mockRestore();
  });

  /**
   * The half of ruling S1-F14 that must NOT come back. `useCourseKit` reports
   * `ready: true` off `null`; anything else and a content package parks on
   * "Đang tải chương…" forever waiting for a file that does not exist at that
   * tier by definition (`validate.ts` rejects `.js` under `tier: 'content'`).
   */
  it('still answers null for a cached package whose files contain no viz.js at all — S1-F14 stays closed', async () => {
    await db.packages.put(
      cachedPackage({
        files: {
          'manifest.json': encode('{}'),
          'chapters/c1.html': encode('<p>chỉ có văn xuôi</p>'),
          // A file whose name merely ENDS in the right letters is not it.
          'assets/notviz.js.txt': encode('nope'),
        },
      }),
    );

    await expect(resolveVizScriptUrl(COURSE_ID)).resolves.toBeNull();
  });
});
