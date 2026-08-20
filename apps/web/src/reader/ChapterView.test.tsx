import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { StrictMode, useEffect, useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Chapter } from '../course/types';
import { clearLocalData, db } from '../db/local';
import { ThemeProvider } from '../theme/ThemeContext';
import { ChapterView } from './ChapterView';

// ChapterView's own script injection is useCourseKit's job (covered by
// useCourseKit.test.ts) — here we stub it so these tests can focus on
// what ChapterView does once the runtime is available: render order,
// rail/pager wiring, idempotency, teardown, and (fix-round-1, Finding 1)
// what happens when `ready` flips true AFTER the chapter fragment has
// already resolved. This is the "mock window.CourseKit, don't try to
// render real visualizations in jsdom" trap from the task brief.
//
// `courseKitMockState.gate` (via `vi.hoisted` — required so this plain
// object is visible both inside the hoisted `vi.mock` factory below AND
// in ordinary test bodies, regardless of hoisting order) controls
// readiness: `null` (the default every test but one leaves it at) means
// "always ready," matching every test's ORIGINAL expectation. Set to a
// pending promise before rendering to make `ready` start `false` and
// only flip `true` once that promise resolves — reproducing the real
// ordering `useCourseKit` can produce (four sequential script loads vs.
// one small chapter fetch — see useCourseKit.ts's own doc comment).
const courseKitMockState = vi.hoisted(() => ({ gate: null as Promise<void> | null }));

vi.mock('./useCourseKit', () => ({
  useCourseKit: () => {
    const [ready, setReady] = useState(courseKitMockState.gate === null);
    useEffect(() => {
      const gate = courseKitMockState.gate;
      if (gate === null) return;
      let cancelled = false;
      void gate.then(() => {
        if (!cancelled) setReady(true);
      });
      return () => {
        cancelled = true;
      };
      // Deliberately empty deps: this mock only ever reads ONE gate per
      // render of a given ChapterView instance — tests that need a
      // different gate re-render a fresh instance.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return { ready, error: null };
  },
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
<div class="box ex"><div class="box-h">Bài 1</div><p>Đề 1</p></div>
<div class="box ex"><div class="box-h">Bài 2</div><p>Đề 2</p></div>
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
      <ThemeProvider>
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
      </ThemeProvider>
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
      '<div id="crumb"></div><aside id="rail"></aside>' +
      '<button id="prev-btn" type="button"></button><button id="next-btn" type="button"></button>' +
      '<button id="mark-btn" type="button"><span class="mk-ico">○</span><span class="mk-lbl">Đã học</span></button>';
  });

  afterEach(async () => {
    await clearLocalData();
    delete document.documentElement.dataset.theme;
    window.localStorage.clear();
    courseKitMockState.gate = null;
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

    // `initViz` having been called only proves the chapter effect's BODY
    // ran. The rail entries are React state (`setHeadings`, set at the end
    // of that same effect) rendered through a portal into `#rail`, so they
    // land one commit LATER. Asserting on them immediately after the
    // `waitFor` above reads the DOM inside the window between the two, and
    // on a loaded machine that window is wide enough to lose: measured 1
    // failure in 40 consecutive runs of this file under an 8-core CPU load
    // (and ~8% of full-suite runs in P2 Task 1's review), always
    // `expected 0 to have length 3`. Waiting for the count itself closes
    // the window WITHOUT loosening the claim — still exactly 3, never "at
    // least one".
    const rail = document.getElementById('rail')!;
    await waitFor(() => expect(rail.querySelectorAll('a')).toHaveLength(3));
    // REDRAWS holds exactly the current (single, live) chapter's entry —
    // not a leftover from the StrictMode-discarded first pass.
    expect(window.CourseKit?.REDRAWS).toHaveLength(1);
  });

  it('builds a rail entry for every h2/h3, portalled into #rail', async () => {
    renderChapterView();
    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

    // The same portal-commit race the StrictMode test above documents, in the
    // test that finally lost to it: `initViz` having been called proves only
    // that the chapter effect's BODY ran, while the rail entries are React
    // state (`setHeadings`, at the end of that same effect) rendered through a
    // portal into `#rail`, so they need a LATER commit. Measured directly, with
    // a DOM snapshot taken at the exact instant `initViz` is called — the
    // earliest moment the `waitFor` above can resume — `#rail` holds ZERO links
    // there, and under StrictMode it is still empty two macrotasks later. That
    // is the whole window, and P2 Task 4's 23 extra lines in ChapterView.tsx
    // widened it enough to lose: `expected [] to deeply equal [ 'Phần A',
    // 'Tiểu mục', 'Phần B' ]`. The same snapshot shows `#crumb`,
    // `#prev-btn`/`#next-btn`, `#mark-btn` and the pager are ALREADY correct at
    // that instant (they are written by the commit before, or by the same
    // effect body), which is why only the rail needs this. Waiting for the full
    // array keeps the claim exactly as strong as it was — still those three
    // headings, in that order, never "at least one".
    const rail = document.getElementById('rail')!;
    await waitFor(() =>
      expect(Array.from(rail.querySelectorAll('a')).map((a) => a.textContent)).toEqual([
        'Phần A',
        'Tiểu mục',
        'Phần B',
      ]),
    );
    const links = Array.from(rail.querySelectorAll('a'));
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
        <ThemeProvider>
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
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));
    expect(window.CourseKit?.REDRAWS).toHaveLength(1);
    expect(document.getElementById('crumb')!.textContent).toBe(
      'Phần 1' + '\u00A0\u203a\u00A0' + '1.1 Chương một',
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
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
        </ThemeProvider>
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

  describe('#mark-btn (debt #5 — Ruling F4, wired to real progress)', () => {
    it('starts unmarked (○ / "Đánh dấu đã học") when the chapter has no progress row', async () => {
      renderChapterView();
      await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

      const markBtn = document.getElementById('mark-btn')!;
      expect(markBtn.classList.contains('on')).toBe(false);
      expect(markBtn.querySelector('.mk-ico')!.textContent).toBe('○');
      expect(markBtn.querySelector('.mk-lbl')!.textContent).toBe('Đánh dấu đã học');
    });

    it('clicking #mark-btn marks the chapter read: flips icon/label/class AND writes local progress + outbox', async () => {
      renderChapterView();
      await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

      const markBtn = document.getElementById('mark-btn')!;
      fireEvent.click(markBtn);

      await waitFor(() => expect(markBtn.classList.contains('on')).toBe(true));
      expect(markBtn.querySelector('.mk-ico')!.textContent).toBe('✓');
      expect(markBtn.querySelector('.mk-lbl')!.textContent).toBe('Đã học');
      // aria-label (not just visible text) must also flip — Topbar sets a
      // static aria-label that would otherwise win over .mk-lbl's text for
      // the button's accessible name.
      expect(markBtn.getAttribute('aria-label')).toBe('Bỏ đánh dấu đã học');

      const row = await db.progress.get(['demo', 'c1', 'read']);
      expect(row).toMatchObject({ courseId: 'demo', chapterId: 'c1', status: 'read', done: true });
      expect(await db.outbox.count()).toBe(1);
    });

    it('clicking #mark-btn a second time unmarks it again', async () => {
      renderChapterView();
      await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

      const markBtn = document.getElementById('mark-btn')!;
      fireEvent.click(markBtn);
      await waitFor(() => expect(markBtn.classList.contains('on')).toBe(true));

      fireEvent.click(markBtn);
      await waitFor(() => expect(markBtn.classList.contains('on')).toBe(false));
      expect(markBtn.querySelector('.mk-ico')!.textContent).toBe('○');
    });

    it('reflects a chapter already marked read before this component mounted', async () => {
      await db.progress.put({ courseId: 'demo', chapterId: 'c1', status: 'read', done: true, updatedAt: new Date().toISOString() });

      renderChapterView();
      await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

      await waitFor(() => expect(document.getElementById('mark-btn')!.classList.contains('on')).toBe(true));
    });

    it('resets to the neutral ○/"Đánh dấu đã học" default on unmount, so it never shows a stale ✓ from a chapter that is no longer open', async () => {
      const { unmount } = renderChapterView();
      await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

      const markBtn = document.getElementById('mark-btn')!;
      fireEvent.click(markBtn);
      await waitFor(() => expect(markBtn.classList.contains('on')).toBe(true));

      unmount();

      expect(markBtn.classList.contains('on')).toBe(false);
      expect(markBtn.querySelector('.mk-ico')!.textContent).toBe('○');
      expect(markBtn.querySelector('.mk-lbl')!.textContent).toBe('Đánh dấu đã học');
      expect(markBtn.getAttribute('aria-label')).toBe('Đánh dấu đã học');
    });
  });

  describe('t/T theme shortcut (debt #2 — shared ThemeContext, no topbar desync)', () => {
    it('pressing "t" toggles <html data-theme> via the same toggle the topbar would use', async () => {
      renderChapterView();
      await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

      expect(document.documentElement.dataset.theme).toBe('light');
      fireEvent.keyDown(document, { key: 't' });
      expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('pressing "T" (shift) also toggles', async () => {
      renderChapterView();
      await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

      fireEvent.keyDown(document, { key: 'T' });
      expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('does not toggle while typing in a form field, same guard as ArrowLeft/ArrowRight', async () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      renderChapterView();
      await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

      fireEvent.keyDown(input, { key: 't' });

      expect(document.documentElement.dataset.theme).toBe('light');
      document.body.removeChild(input);
    });
  });

  describe('exercise checkboxes (injected into every .box.ex .box-h)', () => {
    it('injects exactly one checkbox per .box.ex once the chapter renders', async () => {
      renderChapterView();
      await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

      const checkboxes = document.querySelectorAll('.box.ex .box-h input[type="checkbox"]');
      expect(checkboxes).toHaveLength(2);
    });

    it('checking a box writes "ex:<index>" progress (0-based, DOM order) to local storage + outbox', async () => {
      renderChapterView();
      await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

      const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('.box.ex .box-h input[type="checkbox"]'));
      fireEvent.click(checkboxes[1]);

      await waitFor(async () => {
        const row = await db.progress.get(['demo', 'c1', 'ex:1']);
        expect(row).toMatchObject({ status: 'ex:1', done: true });
      });
    });

    it('does not double-inject across a StrictMode double-mount', async () => {
      renderChapterView({}, { strict: true });
      await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

      expect(document.querySelectorAll('.box.ex .box-h input[type="checkbox"]')).toHaveLength(2);
    });

    // Fix-round-1, Finding 1: the checkbox effect's dependency array was
    // missing `courseKit.ready`. In every OTHER test in this file,
    // `useCourseKit` is mocked to report `ready: true` synchronously, so
    // the chapter fragment and the "runtime ready" signal always arrive
    // in the same render pass — the exact ordering this bug depends on
    // never occurs there. This test reproduces the real, plausible
    // ordering directly: the chapter fragment (one small fetch) resolves
    // WHILE `courseKit.ready` is still false (still "loading" four
    // scripts in sequence — see useCourseKit.ts), and only flips true
    // afterward.
    it('still injects exercise checkboxes when courseKit.ready flips true AFTER the chapter fragment has already resolved', async () => {
      let releaseCourseKitReady: (() => void) | undefined;
      courseKitMockState.gate = new Promise<void>((resolve) => {
        releaseCourseKitReady = resolve;
      });

      renderChapterView();

      // Give the (fast, single) chapter fragment fetch time to resolve
      // while courseKit is still gated — confirms this test is actually
      // exercising the "chapter data arrived first" ordering, not just
      // racing it.
      await waitFor(() => expect(screen.getByText('Đang tải chương…')).toBeInTheDocument());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(initViz).not.toHaveBeenCalled();

      releaseCourseKitReady!();

      await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1));

      const checkboxes = document.querySelectorAll('.box.ex .box-h input[type="checkbox"]');
      expect(checkboxes).toHaveLength(2);
    });
  });
});
