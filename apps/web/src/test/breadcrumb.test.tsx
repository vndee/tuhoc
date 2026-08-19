import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * `#crumb` is owned by <Topbar> (Task 9's file) but populated by
 * <ChapterView> (Task 11) via a portal — the same "Task-9-owned static
 * placeholder must get out of the way of Task-11's portalled content"
 * problem already solved for `#rail` (Rail.tsx). A unit test that renders
 * ChapterView alone (ChapterView.test.tsx) can't catch a regression in
 * Topbar's OWN half of that contract — e.g. Topbar forgetting to hide its
 * static "Tuhoc" text on chapter routes, which would silently concatenate
 * with the portalled breadcrumb ("TuhọcPhần 1 › ..."). This file renders
 * the real <App/> (real <Shell>, real <Topbar>, real <ChapterView>) to
 * cover exactly that seam.
 */
vi.mock('../reader/useCourseKit', () => ({
  useCourseKit: () => ({ ready: true, error: null }),
}));

const CHAPTER_1_HTML = '<h1 class="ch-title">Chương một</h1><p>nội dung 1</p>';
const CHAPTER_3_HTML = '<h1 class="ch-title">Chương ba</h1><p>nội dung 3</p>';

const manifest = {
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
        { id: 'c1', num: '1.1', title: 'Chương một', short: 'C1', file: 'chapters/c1.html' },
        { id: 'c2', num: '1.2', title: 'Chương hai', short: 'C2', file: 'chapters/c2.html' },
      ],
    },
    {
      title: 'Phần 2',
      chapters: [{ id: 'c3', num: '2.1', title: 'Chương ba', short: 'C3', file: 'chapters/c3.html' }],
    },
  ],
};

const server = setupServer(
  http.get('/courses/demo/manifest.json', () => HttpResponse.json(manifest)),
  http.get('/courses/demo/chapters/c1.html', () => HttpResponse.text(CHAPTER_1_HTML)),
  http.get('/courses/demo/chapters/c3.html', () => HttpResponse.text(CHAPTER_3_HTML)),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function goTo(path: string) {
  window.history.pushState({}, '', path);
}

beforeEach(() => {
  window.CourseKit = { renderKatex: vi.fn(), initViz: vi.fn(), REDRAWS: [], VIZ: {} };
});

describe('#crumb breadcrumb (Topbar + ChapterView integration)', () => {
  it('shows "part › chapter" on a chapter route, with no leftover static "Tuhoc" text', async () => {
    goTo('/c/demo/c1');
    render(<App />);

    await waitFor(() => expect(document.getElementById('crumb')?.querySelector('b')).not.toBeNull());

    const crumb = document.getElementById('crumb')!;
    expect(crumb.textContent).not.toContain('Tuhoc');
    expect(crumb.querySelector('span.crumb-part')?.textContent).toContain('Phần 1');
    expect(crumb.querySelector('b')?.textContent).toBe('1.1 Chương một');
  });

  it('updates the breadcrumb (including the part) when navigating to a chapter in a different part', async () => {
    goTo('/c/demo/c1');
    render(<App />);
    await waitFor(() =>
      expect(document.getElementById('crumb')?.querySelector('b')?.textContent).toBe('1.1 Chương một'),
    );
    expect(document.getElementById('crumb')?.querySelector('span.crumb-part')?.textContent).toContain('Phần 1');

    // Navigate via a real in-app link (the sidebar's own chapter list,
    // shared with CourseHome — same as a learner clicking a chapter),
    // landing on c3, which is in Phần 2, not Phần 1.
    const sidebarLinkToC3 = document.querySelector('#sidebar a[data-ch="c3"]') as HTMLAnchorElement;
    expect(sidebarLinkToC3).not.toBeNull();
    sidebarLinkToC3.click();

    await waitFor(() =>
      expect(document.getElementById('crumb')?.querySelector('b')?.textContent).toBe('2.1 Chương ba'),
    );
    // The part changed too — not a stale "Phần 1" left over from c1.
    expect(document.getElementById('crumb')?.querySelector('span.crumb-part')?.textContent).toContain('Phần 2');
    expect(document.getElementById('crumb')?.textContent).not.toContain('Tuhoc');
  });

  it('shows the static "Tuhoc" text on a non-chapter route (course home), not blank and not a chapter breadcrumb', async () => {
    goTo('/c/demo');
    render(<App />);

    await screen.findByRole('heading', { name: 'Khóa học demo' });
    expect(document.getElementById('crumb')?.textContent).toBe('Tuhoc');
  });
});
