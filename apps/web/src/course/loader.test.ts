import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CourseFetchError, describeCourseError, loadChapter, loadManifest, manifestQueryKey } from './loader';
import type { Manifest } from './types';
import { t as lookup, type Translate } from '../i18n';

/**
 * `t` đã gắn tiếng Việt.
 *
 * `describeCourseError` nhận ngôn ngữ bằng THAM SỐ — nó không phải component
 * và cố ý không có context nào để đọc. Bơm `t` vào từ đây là cách duy nhất
 * một bài kiểm chứng minh nó dùng cái được truyền vào.
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

describe('manifestQueryKey', () => {
  it('one key per course, and it is stable', () => {
    expect(manifestQueryKey('a')).not.toEqual(manifestQueryKey('b'));
    expect(manifestQueryKey('a')).toEqual(manifestQueryKey('a'));
  });
});

describe('loadManifest', () => {
  it('fetches the manifest from GET /courses/:courseId, verbatim', async () => {
    server.use(http.get('/courses/:courseId', () => HttpResponse.json(validManifest)));

    await expect(loadManifest(COURSE_ID)).resolves.toEqual(validManifest);
  });

  it('throws CourseFetchError with the HTTP status when the course is not in the catalog (404)', async () => {
    server.use(http.get('/courses/:courseId', () => new HttpResponse(null, { status: 404 })));

    const failure = loadManifest(COURSE_ID);
    await expect(failure).rejects.toBeInstanceOf(CourseFetchError);
    await expect(failure).rejects.toMatchObject({ status: 404 });
  });

  it('throws CourseFetchError (distinct from a 404) on a server error', async () => {
    server.use(http.get('/courses/:courseId', () => new HttpResponse(null, { status: 500 })));

    const failure = loadManifest(COURSE_ID);
    await expect(failure).rejects.toBeInstanceOf(CourseFetchError);
    await expect(failure).rejects.toMatchObject({ status: 500 });
  });

  it('rejects with a plain (non-CourseFetchError) failure when the network never answers at all', async () => {
    server.use(http.get('/courses/:courseId', () => HttpResponse.error()));

    await expect(loadManifest(COURSE_ID)).rejects.not.toBeInstanceOf(CourseFetchError);
  });
});

describe('loadChapter', () => {
  it('fetches GET /courses/:courseId/chapters/:chapterId — the chapter ID, not the manifest file path', async () => {
    let seenPath = '';
    server.use(
      http.get('/courses/*', ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return HttpResponse.json({ html: '<h1 class="ch-title">Chương một</h1>', widgets: [] });
      }),
    );

    const payload = await loadChapter(COURSE_ID, 'c1');
    expect(seenPath).toBe('/courses/demo/chapters/c1');
    expect(payload).toEqual({ html: '<h1 class="ch-title">Chương một</h1>', widgets: [] });
  });

  it('carries the widgets array through unread — Task 10 only uses .html, but must not drop the field', async () => {
    server.use(
      http.get('/courses/:courseId/chapters/:chapterId', () =>
        HttpResponse.json({ html: '<div data-widget="dem-so"></div>', widgets: [{ name: 'dem-so', html: '<div></div>' }] }),
      ),
    );

    await expect(loadChapter(COURSE_ID, 'c1')).resolves.toEqual({
      html: '<div data-widget="dem-so"></div>',
      widgets: [{ name: 'dem-so', html: '<div></div>' }],
    });
  });

  it('a missing chapter is a CourseFetchError with a 404 — not a bespoke "package asset missing" error', async () => {
    server.use(http.get('/courses/:courseId/chapters/:chapterId', () => new HttpResponse(null, { status: 404 })));

    const failure = loadChapter(COURSE_ID, 'khong-ton-tai');
    await expect(failure).rejects.toBeInstanceOf(CourseFetchError);
    await expect(failure).rejects.toMatchObject({ status: 404 });
  });
});

describe('describeCourseError', () => {
  it('describes a 404 CourseFetchError distinctly from other HTTP statuses', () => {
    const notFound = describeCourseError(new CourseFetchError('/courses/x', 404), t);
    const serverError = describeCourseError(new CourseFetchError('/courses/x', 500), t);
    expect(notFound).toMatch(/^Không tải được khóa học/);
    expect(serverError).toMatch(/^Không tải được khóa học/);
    expect(notFound).not.toBe(serverError);
  });

  it('falls back to a generic Vietnamese message for a network failure (no CourseFetchError to read a status from)', () => {
    expect(describeCourseError(new TypeError('Failed to fetch'), t)).toMatch(/^Không tải được khóa học/);
  });

  it('falls back to a generic Vietnamese message for anything else (e.g. a plain thrown value)', () => {
    expect(describeCourseError('boom', t)).toMatch(/^Không tải được khóa học/);
    expect(describeCourseError(new Error('some unrelated failure'), t)).toMatch(/^Không tải được khóa học/);
  });

  it('never repeats the error class\'s own English .message verbatim', () => {
    const error = new CourseFetchError('/courses/x', 404);
    expect(describeCourseError(error, t)).not.toBe(error.message);
  });
});
