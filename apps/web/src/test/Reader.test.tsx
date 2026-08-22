import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Reader } from '../pages/Reader';
import type { Manifest } from '../course/types';
import { LanguageProvider } from '../i18n/LanguageProvider';

// Reader's job is finding the right chapter + its neighbours in the
// manifest and handing them to ChapterView — not rendering KaTeX/viz
// itself, so ChapterView is stubbed out here (its own behavior is covered
// by ChapterView.test.tsx).
vi.mock('../reader/ChapterView', () => ({
  ChapterView: ({ chapter, partTitle, prevChapter, nextChapter }: any) => (
    <div data-testid="chapter-view">
      <span data-testid="current">{chapter.id}</span>
      <span data-testid="part">{partTitle}</span>
      <span data-testid="prev">{prevChapter?.id ?? 'none'}</span>
      <span data-testid="next">{nextChapter?.id ?? 'none'}</span>
    </div>
  ),
}));

function manifest(): Manifest {
  return {
    id: 'demo',
    title: 'Khóa học demo',
    description: 'desc',
    lang: 'vi',
    version: '1.0.0',
    runtime: '^1',
    parts: [
      {
        title: 'Phần 1',
        chapters: [
          { id: 'c1', num: '1', title: 'Chương một', short: 'C1', file: 'chapters/c1.html' },
          { id: 'c2', num: '2', title: 'Chương hai', short: 'C2', file: 'chapters/c2.html' },
        ],
      },
      {
        title: 'Phần 2',
        chapters: [{ id: 'c3', num: '3', title: 'Chương ba', short: 'C3', file: 'chapters/c3.html' }],
      },
    ],
  };
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider><MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/c/:courseId/:chapterId" element={<Reader />} />
        </Routes>
      </MemoryRouter></LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('Reader', () => {
  beforeEach(() => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(manifest())));
  });

  it('resolves the middle chapter with prev/next from adjacent parts respected as manifest order', async () => {
    renderAt('/c/demo/c2');

    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('c2'));
    expect(screen.getByTestId('prev').textContent).toBe('c1');
    expect(screen.getByTestId('next').textContent).toBe('c3'); // next part, flattened in order
    expect(screen.getByTestId('part').textContent).toBe('Phần 1');
  });

  it('the first chapter has no prev', async () => {
    renderAt('/c/demo/c1');

    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('c1'));
    expect(screen.getByTestId('prev').textContent).toBe('none');
    expect(screen.getByTestId('next').textContent).toBe('c2');
    expect(screen.getByTestId('part').textContent).toBe('Phần 1');
  });

  it('the last chapter has no next, and carries ITS OWN part title (not the previous chapter\'s Part 1)', async () => {
    renderAt('/c/demo/c3');

    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('c3'));
    expect(screen.getByTestId('prev').textContent).toBe('c2');
    expect(screen.getByTestId('next').textContent).toBe('none');
    expect(screen.getByTestId('part').textContent).toBe('Phần 2');
  });

  it('shows a Vietnamese message for a chapterId not present in the manifest', async () => {
    renderAt('/c/demo/does-not-exist');

    expect(await screen.findByText(/không tìm thấy/i)).toBeInTheDocument();
    expect(screen.queryByTestId('chapter-view')).not.toBeInTheDocument();
  });

  it('shows a Vietnamese message when the manifest fails to load', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/demo/c1');

    expect(await screen.findByText(/không tải được/i)).toBeInTheDocument();
  });
});
