import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CourseHome } from '../pages/CourseHome';
import type { Chapter, Manifest } from '../course/types';
import { clearLocalData, db } from '../db/local';
import { LanguageProvider } from '../i18n/LanguageProvider';

function buildManifest(chapterCount: number): Manifest {
  const chapters: Chapter[] = Array.from({ length: chapterCount }, (_, i) => ({
    id: `ch-${i + 1}`,
    num: `${i + 1}`,
    title: `Chương thứ ${i + 1}`,
    short: `Chương ${i + 1}`,
    file: `chapters/ch-${i + 1}.html`,
  }));
  const half = Math.ceil(chapterCount / 2);
  return {
    id: 'demo',
    title: 'Khóa học demo',
    description: 'Mô tả khóa học demo',
    lang: 'vi',
    version: '1.0.0',
    runtime: '^1',
    parts: [
      { title: 'Phần A', chapters: chapters.slice(0, half) },
      { title: 'Phần B', chapters: chapters.slice(half) },
    ],
  };
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(async () => {
  await clearLocalData();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderCourseHome(initialPath = '/c/demo') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider><MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/c/:courseId" element={<CourseHome />} />
        </Routes>
      </MemoryRouter></LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('CourseHome', () => {
  it('renders the manifest title and description', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(buildManifest(4))));

    renderCourseHome();

    expect(await screen.findByRole('heading', { name: 'Khóa học demo' })).toBeInTheDocument();
    expect(await screen.findByText('Mô tả khóa học demo')).toBeInTheDocument();
  });

  it('renders one link per chapter across every part — 44 chapters, 44 links', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(buildManifest(44))));

    renderCourseHome();

    const links = await screen.findAllByRole('link');
    expect(links).toHaveLength(44);
  });

  it('every chapter link carries data-ch=<chapterId> and links to /c/:courseId/:chapterId', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(buildManifest(3))));

    renderCourseHome();

    const links = await screen.findAllByRole('link');
    expect(links).toHaveLength(3);
    for (const [i, link] of links.entries()) {
      const id = `ch-${i + 1}`;
      expect(link).toHaveAttribute('data-ch', id);
      expect(link).toHaveAttribute('href', `/c/demo/${id}`);
      expect(link.className).toContain('nav-item');
    }
  });

  it('marks chapters read in LOCAL progress (Ruling F4 / debt #1 — real data, not a prop) with the "done" class', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(buildManifest(3))));
    await db.progress.put({ courseId: 'demo', chapterId: 'ch-2', status: 'read', done: true, updatedAt: new Date().toISOString() });

    renderCourseHome();

    const links = await screen.findAllByRole('link');
    await waitFor(() => {
      expect(links.find((a) => a.getAttribute('data-ch') === 'ch-2')?.className).toContain('done');
    });
    expect(links.find((a) => a.getAttribute('data-ch') === 'ch-1')?.className).not.toContain('done');
    expect(links.find((a) => a.getAttribute('data-ch') === 'ch-3')?.className).not.toContain('done');
  });

  it('does NOT mark a chapter done from a DIFFERENT course\'s local progress row (courseId scoping)', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(buildManifest(3))));
    await db.progress.put({ courseId: 'other-course', chapterId: 'ch-2', status: 'read', done: true, updatedAt: new Date().toISOString() });

    renderCourseHome();

    const links = await screen.findAllByRole('link');
    expect(links.find((a) => a.getAttribute('data-ch') === 'ch-2')?.className).not.toContain('done');
  });

  it('renders every part title as a .nav-part heading', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(buildManifest(4))));

    renderCourseHome();

    await screen.findAllByRole('link');
    const partHeadings = document.querySelectorAll('.nav-part');
    expect(Array.from(partHeadings).map((el) => el.textContent)).toEqual(['Phần A', 'Phần B']);
  });

  it('shows a non-crashing message instead of chapters when the manifest 404s', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => new HttpResponse(null, { status: 404 })));

    renderCourseHome();

    expect(await screen.findByText(/không tải được|not found|lỗi/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('shows a non-crashing message when the manifest is a runtime the app does not support', async () => {
    server.use(
      http.get('/courses/demo/manifest.json', () => HttpResponse.json({ ...buildManifest(2), runtime: '^2' })),
    );

    renderCourseHome();

    expect(await screen.findByText(/không tải được|not found|lỗi/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
