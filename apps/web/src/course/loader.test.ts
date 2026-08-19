import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CourseFetchError,
  describeCourseError,
  loadChapter,
  loadManifest,
  ManifestParseError,
  RuntimeMismatchError,
} from './loader';
import type { Manifest } from './types';

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
    const description = describeCourseError(error);
    expect(description).toMatch(/^Không tải được khóa học/);
    expect(description).not.toBe(error.message);
  });

  it('describes a 404 CourseFetchError distinctly from other HTTP statuses', () => {
    const notFound = describeCourseError(new CourseFetchError('https://x/manifest.json', 404));
    const serverError = describeCourseError(new CourseFetchError('https://x/manifest.json', 500));
    expect(notFound).toMatch(/^Không tải được khóa học/);
    expect(serverError).toMatch(/^Không tải được khóa học/);
    expect(notFound).not.toBe(serverError);
  });

  it('describes a ManifestParseError in Vietnamese, not the raw English Error#message', () => {
    const error = new ManifestParseError('https://x/manifest.json', new SyntaxError('Unexpected token <'));
    const description = describeCourseError(error);
    expect(description).toMatch(/^Không tải được khóa học/);
    expect(description).not.toBe(error.message);
  });

  it('falls back to a generic Vietnamese message for anything else (e.g. a plain thrown value)', () => {
    expect(describeCourseError('boom')).toMatch(/^Không tải được khóa học/);
    expect(describeCourseError(new Error('some unrelated failure'))).toMatch(/^Không tải được khóa học/);
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
