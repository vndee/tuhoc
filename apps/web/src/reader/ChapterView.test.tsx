import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { StrictMode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Chapter } from '../course/types';
import { ChapterView } from './ChapterView';

// ChapterView's own script injection is useCourseKit's job (covered by
// useCourseKit.test.ts) — here we stub it as always-ready so these tests
// can focus on what ChapterView does once the runtime is available:
// render order, rail/pager wiring, idempotency, and teardown. This is the
// "mock window.CourseKit, don't try to render real visualizations in
// jsdom" trap from the task brief.
vi.mock('./useCourseKit', () => ({
  useCourseKit: () => ({ ready: true, error: null }),
}));

const FRAGMENT = `
<h1 class="ch-title">Chương một</h1>
<p class="ch-lede">Xem $x$ ở đây.</p>
<h2 id="sec-a">Phần A</h2>
<p>Nội dung A</p>
<h3>Tiểu mục</h3>
<p>Chi tiết</p>
<div class="fig-body"><div data-viz="aep"></div></div>
<h2>Phần B</h2>
<p>Nội dung B</p>
`;

const CHAPTER_2_HTML = '<h1 class="ch-title">Chương hai</h1><p>nội dung khác</p>';

const server = setupServer(
  http.get('/courses/demo/chapters/c1.html', () => HttpResponse.text(FRAGMENT)),
  http.get('/courses/demo/chapters/c2.html', () => HttpResponse.text(CHAPTER_2_HTML)),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const chapter1: Chapter = { id: 'c1', num: '1.1', title: 'Chương một', short: 'Chương 1', file: 'chapters/c1.html' };
const chapter2: Chapter = { id: 'c2', num: '1.2', title: 'Chương hai', short: 'Chương 2', file: 'chapters/c2.html' };

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

function renderChapterView(
  props: Partial<React.ComponentProps<typeof ChapterView>> = {},
  { strict = false, withProbe = false } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const body = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/c/demo/c1']}>
        {withProbe && <LocationProbe />}
        <ChapterView
          courseId="demo"
          courseTitle="Khóa học demo"
          partTitle="Phần 1"
          chapter={chapter1}
          prevChapter={null}
          nextChapter={chapter2}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{body}</StrictMode> : body);
}

describe('ChapterView', () => {
  let renderKatex: Mock<(root: ParentNode) => void>;
  let initViz: Mock<(root: ParentNode) => void>;
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
    renderKatex = vi.fn<(root: ParentNode) => void>(() => {
      callOrder.push('renderKatex');
    });
    initViz = vi.fn<(root: ParentNode) => void>(() => {
      callOrder.push('initViz');
      // Real runtime.js's initViz constructs a Plot per [data-viz] node,
      // which pushes a redraw callback onto REDRAWS. Emulate that so the
      // teardown tests below exercise the real splice-delta mechanism.
      window.CourseKit?.REDRAWS.push(() => {});
    });
    window.CourseKit = { renderKatex, initViz, REDRAWS: [], VIZ: {} };
    document.body.innerHTML =
      '<div id="crumb"></div><aside id="rail"></aside><button id="prev-btn" type="button"></button><button id="next-btn" type="button"></button>';
  });

  it('calls renderKatex then initViz exactly once, with the element containing the fragment', async () => {
    renderChapterView();

    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));
    expect(renderKatex).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['renderKatex', 'initViz']);

    const renderKatexArg = renderKatex.mock.calls[0][0] as HTMLElement;
    expect(renderKatexArg.textContent).toContain('Nội dung A');
    expect(renderKatexArg.querySelector('[data-viz="aep"]')).not.toBeNull();
    // Same element, and KaTeX ran on it before viz measured it.
    expect(initViz.mock.calls[0][0]).toBe(renderKatexArg);
  });

  it('is idempotent under React StrictMode double-invoke — still exactly one call each, and one rail entry set', async () => {
    renderChapterView({}, { strict: true });

    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));
    expect(renderKatex).toHaveBeenCalledTimes(1);

    const rail = document.getElementById('rail')!;
    expect(rail.querySelectorAll('a')).toHaveLength(3);
    // REDRAWS holds exactly the current (single, live) chapter's entry —
    // not a leftover from the StrictMode-discarded first pass.
    expect(window.CourseKit?.REDRAWS).toHaveLength(1);
  });

  it('builds a rail entry for every h2/h3, portalled into #rail', async () => {
    renderChapterView();
    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

    const rail = document.getElementById('rail')!;
    const links = Array.from(rail.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual(['Phần A', 'Tiểu mục', 'Phần B']);
    expect(links[1].className).toContain('lvl3');
    expect(links[0].className).not.toContain('lvl3');
  });

  it('portals the breadcrumb into #crumb as span.crumb-part (the part) + b (num + chapter title)', async () => {
    renderChapterView();
    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

    const crumb = document.getElementById('crumb')!;
    const part = crumb.querySelector('span.crumb-part');
    const title = crumb.querySelector('b');
    expect(part?.textContent).toContain('Phần 1');
    expect(title?.textContent).toBe('1.1 Chương một');
  });

  it('renders the in-content pager with only a next link when there is no prev chapter', async () => {
    renderChapterView();
    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

    expect(screen.queryByText('← Chương trước')).not.toBeInTheDocument();
    const next = screen.getByText('Chương sau →').closest('a');
    expect(next).toHaveAttribute('href', '/c/demo/c2');
  });

  it('disables topbar #prev-btn/#next-btn according to prev/next chapter availability', async () => {
    renderChapterView();
    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

    expect((document.getElementById('prev-btn') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('next-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ArrowRight navigates to the next chapter', async () => {
    renderChapterView({}, { withProbe: true });
    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(document, { key: 'ArrowRight' });

    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/c/demo/c2'));
  });

  it('does not navigate on ArrowRight while typing in a form field', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    renderChapterView({}, { withProbe: true });
    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(input, { key: 'ArrowRight' });

    expect(screen.getByTestId('path').textContent).toBe('/c/demo/c1');
    document.body.removeChild(input);
  });

  it('cleans up on unmount: splices out the REDRAWS entries this chapter added, re-enables prev/next buttons', async () => {
    const { unmount } = renderChapterView();
    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));
    expect(window.CourseKit?.REDRAWS).toHaveLength(1);

    unmount();

    expect(window.CourseKit?.REDRAWS).toHaveLength(0);
    expect((document.getElementById('next-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('navigating between chapters does not accumulate REDRAWS entries (no leak across chapters), and the crumb updates', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/c/demo/c1']}>
          <ChapterView
            courseId="demo"
            courseTitle="Khóa học demo"
            partTitle="Phần 1"
            chapter={chapter1}
            prevChapter={null}
            nextChapter={chapter2}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));
    expect(window.CourseKit?.REDRAWS).toHaveLength(1);
    expect(document.getElementById('crumb')!.textContent).toBe(
      'Phần 1' + '\u00A0\u203a\u00A0' + '1.1 Chương một',
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/c/demo/c1']}>
          <ChapterView
            courseId="demo"
            courseTitle="Khóa học demo"
            partTitle="Phần 2"
            chapter={chapter2}
            prevChapter={chapter1}
            nextChapter={null}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(2));
    // Still exactly 1 — chapter 1's entry was spliced out when chapter 2's
    // effect ran, not left behind to redraw a detached canvas forever.
    expect(window.CourseKit?.REDRAWS).toHaveLength(1);
    // Crumb reflects the new chapter's part, not a leftover from chapter 1.
    expect(document.getElementById('crumb')!.textContent).toBe(
      'Phần 2' + '\u00A0\u203a\u00A0' + '1.2 Chương hai',
    );
  });

  it('sets document.title from the chapter and course titles', async () => {
    renderChapterView();
    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

    expect(document.title).toBe('1.1 Chương một — Khóa học demo');
  });

  it('shows a Vietnamese error message (not a hang) when the chapter fragment fails to fetch', async () => {
    server.use(http.get('/courses/demo/chapters/c1.html', () => new HttpResponse(null, { status: 404 })));

    renderChapterView();

    expect(await screen.findByText(/không tải được|not found|lỗi/i)).toBeInTheDocument();
    expect(initViz).not.toHaveBeenCalled();
  });
});
