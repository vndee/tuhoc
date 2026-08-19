import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Sidebar } from '../shell/Sidebar';
import type { Manifest } from '../course/types';

const manifest: Manifest = {
  id: 'demo',
  title: 'Khóa học demo',
  description: 'Mô tả',
  lang: 'vi',
  version: '1.0.0',
  runtime: '^1',
  parts: [
    {
      title: 'Phần 1',
      chapters: [
        { id: 'c1', num: '1.1', title: 'Chương một', short: 'Chương một', file: 'chapters/c1.html' },
        { id: 'c2', num: '1.2', title: 'Chương hai', short: 'Chương hai', file: 'chapters/c2.html' },
      ],
    },
  ],
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderSidebar(initialPath: string, doneChapterIds?: ReadonlySet<string>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Sidebar doneChapterIds={doneChapterIds} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Sidebar real course outline', () => {
  it('keeps the "no course loaded" empty state on routes without a course (e.g. "/")', () => {
    renderSidebar('/');
    expect(screen.getByText('Chưa có khóa học nào được tải.')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('renders the course outline in #nav on /c/:courseId', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(manifest)));
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    const links = await within(nav).findAllByRole('link');
    expect(links).toHaveLength(2);
    expect(within(nav).queryByText('Chưa có khóa học nào được tải.')).not.toBeInTheDocument();
  });

  it('also renders the course outline on a chapter sub-route /c/:courseId/:chapterId', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(manifest)));
    renderSidebar('/c/demo/c1');

    const nav = document.getElementById('nav')!;
    expect(await within(nav).findAllByRole('link')).toHaveLength(2);
  });

  it('every chapter link in #nav carries data-ch and the .nav-item class', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(manifest)));
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    const links = await within(nav).findAllByRole('link');
    expect(links.map((a) => a.getAttribute('data-ch')).sort()).toEqual(['c1', 'c2']);
    for (const link of links) {
      expect(link.className).toContain('nav-item');
    }
  });

  it('marks chapters in doneChapterIds with the done class inside #nav', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(manifest)));
    renderSidebar('/c/demo', new Set(['c2']));

    const nav = document.getElementById('nav')!;
    const links = await within(nav).findAllByRole('link');
    expect(links.find((a) => a.getAttribute('data-ch') === 'c1')?.className).not.toContain('done');
    expect(links.find((a) => a.getAttribute('data-ch') === 'c2')?.className).toContain('done');
  });

  it('shows a visible failure message in #nav — not silence — when the manifest 404s', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => new HttpResponse(null, { status: 404 })));
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    // User-visible outcome, not an internal query flag: some text shows up
    // in #nav once the fetch settles, and it must not be empty and must
    // not be mistaken for "no course loaded" (a different, wrong message —
    // a course *was* selected, it just failed to load).
    await within(nav).findByText(/không tải được/i);
    expect(within(nav).queryByText('Chưa có khóa học nào được tải.')).not.toBeInTheDocument();
    expect(within(nav).queryAllByRole('link')).toHaveLength(0);
  });

  it('shows a distinct loading message in #nav while the manifest is pending, before it resolves', async () => {
    server.use(
      http.get('/courses/demo/manifest.json', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json(manifest);
      }),
    );
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    expect(within(nav).getByText('Đang tải khóa học…')).toBeInTheDocument();
    expect(within(nav).queryByText('Chưa có khóa học nào được tải.')).not.toBeInTheDocument();

    expect(await within(nav).findAllByRole('link')).toHaveLength(2);
  });
});
