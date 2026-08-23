import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, getConfig, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { StrictMode, useEffect, useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Chapter, Part } from '../course/types';
import { clearLocalData, db } from '../db/local';
import { ThemeProvider } from '../theme/ThemeContext';
import { ChapterView } from './ChapterView';
import { LanguageProvider } from '../i18n/LanguageProvider';

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

/**
 * The course outline the table-of-contents drawer lists — the same shape
 * `Reader` hands down off the manifest it already holds.
 *
 * Two parts rather than one, because the drawer's job is to answer "where is
 * this chapter in the course" and a single-part course cannot tell a right
 * answer from a lucky one.
 */
const PARTS: Part[] = [
  { title: 'Phần 1', chapters: [chapter1] },
  { title: 'Phần 2', chapters: [chapter2] },
];

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
        <LanguageProvider><MemoryRouter initialEntries={['/c/demo/c1']}>
          {withProbe && <LocationProbe />}
          <ChapterView
            courseId="demo"
            courseTitle="Khóa học demo"
            partTitle="Phần 1"
            chapter={chapter1}
            prevChapter={null}
            nextChapter={chapter2}
            parts={PARTS}
            {...props}
          />
        </MemoryRouter></LanguageProvider>
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
    // The chrome `<Shell>`/`<Topbar>` render around a chapter, reproduced by
    // hand because these tests mount `<ChapterView>` on its own. `#reader-nav`,
    // `#reader-notes` and `#progbar` joined the list with chế độ đọc: the
    // first two are the topbar slots the reading toolbar portals into (see
    // Topbar.tsx), and the third is the thin progress line. All three are real
    // nodes in the app, and leaving them out here would mean the reading
    // toolbar silently rendered nowhere in every test in this file.
    document.body.innerHTML =
      '<div id="crumb"></div><aside id="rail"></aside>' +
      '<span id="reader-nav"></span><span id="reader-notes"></span>' +
      '<div id="progwrap"><div id="progbar"></div></div>' +
      '<button id="prev-btn" type="button"></button><button id="next-btn" type="button"></button>' +
      '<button id="mark-btn" type="button"><span class="mk-ico">○</span><span class="mk-lbl">Đã học</span></button>';
  });

  afterEach(async () => {
    await clearLocalData();
    delete document.documentElement.dataset.theme;
    window.localStorage.clear();
    courseKitMockState.gate = null;
  });

  // =========================================================================
  // Waiting for a chapter — read this before writing a test in this file
  // =========================================================================
  //
  // `await waitFor(() => expect(initViz).toHaveBeenCalledTimes(1))` is NOT a
  // signal that the chapter is on the page. It is the signal that the chapter
  // effect's BODY reached its middle. Everything the body writes imperatively
  // (`container.innerHTML`, `#crumb`, `#prev-btn`/`#next-btn`, `#mark-btn`,
  // `document.title`) is there when it resumes; everything the body puts in
  // React STATE is not:
  //
  //     ChapterView.tsx:279  CourseKit.initViz(container)        ← the signal
  //     ChapterView.tsx:288  setHeadings(...)                    ← #rail
  //     ChapterView.tsx:315  setAnnotationContent(...)           ← <SelectionToolbar>
  //
  // Those two `setState` calls need a React render + commit of their own, and
  // that commit is scheduled through React's Scheduler (a host task) while
  // `waitFor` wakes on a MutationObserver microtask and a `setTimeout` poll.
  // The two schedules are independent. On an idle machine the Scheduler
  // happens to drain its whole queue inside the same host task that ran the
  // effect — which is why the wrong wait passes almost always — but it only
  // yields after a 5 ms budget, and once that budget is gone mid-flush the
  // commit lands in a LATER task and `waitFor` has already returned.
  //
  // That is not a theory, it is this file's history: three separate rounds,
  // three separate tests, one race.
  //
  //   1. Task 1 review     → ChapterView.test.tsx:159 (StrictMode), ~8% of runs
  //   2. de-flake round    → :183 (`#rail`), `expected [] to deeply equal [...]`
  //   3. Task 5 review     → :436 and :459, 1 failure per 10 full-suite runs
  //                          with `--maxWorkers=24`
  //
  // Measured for this round with React's Scheduler forced to yield after one
  // unit of work (the no-load stand-in for an oversubscribed machine; see the
  // fix report): the old wait lost **10 runs out of 20**, and the toolbar test
  // at :436 was the one that lost. Waiting on `initViz` is therefore not
  // "usually enough" — it is the wrong signal, and it wins by luck.
  //
  // So: never wait on `initViz` directly. Use `renderChapterAndSettle()` (or
  // `settleChapter()` when the render is hand-rolled). It waits for the
  // COMMIT, and the claims a test then makes need no `waitFor` of their own.

  /** The in-chapter TOC entries `FRAGMENT` produces, in document order. */
  const RAIL_ENTRIES = ['Phần A', 'Tiểu mục', 'Phần B'];

  /** The chapter's own h2/h3 outline, wherever it currently lives. */
  function tocLinks(): HTMLAnchorElement[] {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>('.rd-toc a'));
  }

  /**
   * Waits until the chapter's own commit has landed.
   *
   * The chapter's h2/h3 outline is the witness: `setHeadings` and
   * `setAnnotationContent` are two adjacent statements of one effect body, so
   * React batches them into ONE render, and those links appearing is the same
   * commit that gives `<SelectionToolbar>` a `content.root` to watch. The
   * de-flake round measured this directly — a DOM snapshot taken at the
   * instant `initViz` runs holds ZERO of them, and under StrictMode it is
   * still empty two macrotasks later.
   *
   * Chế độ đọc moved those links from `#rail` into `<TocDrawer>`, and the
   * witness moved with them rather than being replaced by something
   * structural. That is not a formality: the drawer stays MOUNTED while
   * closed precisely so this measurement keeps working, and `waitFor` on a
   * structure would never have been enough for an invariant about which
   * commit a `setState` inside an effect body lands in.
   *
   * The trailing `act` is for what the commit SCHEDULES rather than what it
   * writes: the toolbar's `selectionchange` listener is a passive effect of
   * that commit and runs after it. A test that dispatches a one-shot event
   * into a listener that does not exist yet gets no second chance.
   */
  async function settleChapter({
    initVizCalls = 1,
    rail = RAIL_ENTRIES,
  }: { initVizCalls?: number; rail?: readonly string[] } = {}): Promise<void> {
    await waitFor(() => expect(initViz).toHaveBeenCalledTimes(initVizCalls));
    await waitFor(() => expect(tocLinks().map((a) => a.textContent)).toEqual([...rail]));
    await act(async () => {});
  }

  /** `renderChapterView`, then `settleChapter`. What every test here wants. */
  async function renderChapterAndSettle(
    props: Partial<React.ComponentProps<typeof ChapterView>> = {},
    options: { strict?: boolean; withProbe?: boolean } = {},
  ): Promise<ReturnType<typeof renderChapterView>> {
    const view = renderChapterView(props, options);
    await settleChapter();
    return view;
  }

  // The two selection helpers below live here, at the top level of this
  // describe, rather than inside the Task 5 block that first needed them:
  // Task 6's own block needs the SAME action ("select prose, get a toolbar")
  // to reach the "Ghi chú" button, and a second copy of a helper whose retry
  // shape is load-bearing (see `selectAndOpenToolbar`'s doc) is a copy that
  // drifts. Moved verbatim, not rewritten.

  function selectInChapter(text: string): HTMLElement {
    const container = document.querySelector('.fade-in') as HTMLElement;
    const paragraph = Array.from(container.querySelectorAll('p')).find((p) => p.textContent === text);
    if (!paragraph?.firstChild) throw new Error(`no <p> reading ${JSON.stringify(text)} in the chapter`);
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0);
    range.setEnd(paragraph.firstChild, text.length);
    act(() => {
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      // jsdom does not fire this for a programmatic selection; a real drag or
      // a Shift+Arrow does.
      document.dispatchEvent(new Event('selectionchange'));
    });
    return container;
  }

  /**
   * Selects `text` and returns the chapter container once the toolbar it
   * must open is on the page.
   *
   * The retry is the point. `selectionchange` is a ONE-SHOT event: a
   * listener that attaches after the dispatch never hears it, and no amount
   * of polling for the toolbar afterwards will conjure one — which is why
   * `findByRole('toolbar')` would be the wrong tool and `getByRole` alone
   * was the flaky one. So each attempt re-creates the whole user action
   * (select, then look) instead of looking again at the result of a single
   * dispatch. `renderChapterAndSettle` should already make the first attempt
   * enough; this is what makes that "should" unable to matter.
   *
   * The deadline is read from testing-library's own config rather than
   * written here as a number. It used to be a literal `1000`, which is the
   * value RTL's default happened to have — so this loop looked like it
   * shared the suite's wait budget while actually being the one wall clock
   * in this file that `configure({ asyncUtilTimeout })` in
   * `src/test/setup.ts` could not reach. Raising that budget for the whole
   * suite and leaving a hidden 1000 ms here would have fixed every wait in
   * this file except the one the failing test goes through.
   */
  async function selectAndOpenToolbar(text: string): Promise<HTMLElement> {
    const deadline = Date.now() + getConfig().asyncUtilTimeout;
    let container = selectInChapter(text);
    while (!screen.queryByRole('toolbar') && Date.now() < deadline) {
      await act(async () => {});
      container = selectInChapter(text);
    }
    // `getByRole`, not `queryByRole`: when this genuinely breaks the failure
    // should carry testing-library's own report, not a bare boolean.
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
    return container;
  }

  it('calls renderKatex then initViz exactly once, with the element containing the fragment', async () => {
    await renderChapterAndSettle();

    expect(initViz).toHaveBeenCalledTimes(1);
    expect(renderKatex).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['renderKatex', 'initViz']);

    const renderKatexArg = renderKatex.mock.calls[0][0] as HTMLElement;
    expect(renderKatexArg.textContent).toContain('Nội dung A');
    expect(renderKatexArg.querySelector('[data-viz="aep"]')).not.toBeNull();
    // Same element, and KaTeX ran on it before viz measured it.
    expect(initViz.mock.calls[0][0]).toBe(renderKatexArg);
  });

  it('is idempotent under React StrictMode double-invoke — still exactly one call each, and one TOC entry set', async () => {
    await renderChapterAndSettle({}, { strict: true });

    expect(initViz).toHaveBeenCalledTimes(1);
    expect(renderKatex).toHaveBeenCalledTimes(1);

    // Read synchronously, because `renderChapterAndSettle` has already waited
    // for the commit that fills the drawer's TOC — the window this assertion
    // used to lose to (~8% of full-suite runs in P2 Task 1's review, always
    // `expected 0 to have length 3`) is closed by the wait, not by luck. Still
    // exactly 3, never "at least one".
    expect(tocLinks()).toHaveLength(3);
    // REDRAWS holds exactly the current (single, live) chapter's entry —
    // not a leftover from the StrictMode-discarded first pass.
    expect(window.CourseKit?.REDRAWS).toHaveLength(1);
  });

  it('builds a TOC entry for every h2/h3, in the drawer, exactly once', async () => {
    await renderChapterAndSettle();

    // Synchronous again, for the same reason: the TOC is the very thing
    // `settleChapter` waits on, so by here the commit has landed. The de-flake
    // round had to wrap this array in `waitFor` because the wait above it was
    // `initViz`; with the right wait the claim goes back to being a plain
    // assertion — same three headings, same order, never "at least one".
    const links = tocLinks();
    expect(links.map((a) => a.textContent)).toEqual(['Phần A', 'Tiểu mục', 'Phần B']);
    expect(links[1].className).toContain('lvl3');
    expect(links[0].className).not.toContain('lvl3');

    // Chế độ đọc: the chapter's outline moved OUT of `#rail`, which is now the
    // notes margin and nothing else. One copy, in one place — the duplicate
    // that ruling P2-F1 exists to prevent would show up here as six links.
    expect(document.querySelectorAll('.rd-toc').length).toBe(1);
    expect(document.getElementById('rail')!.querySelectorAll('a')).toHaveLength(0);
  });

  it('portals the breadcrumb into #crumb as span.crumb-part (the part) + b (num + chapter title)', async () => {
    await renderChapterAndSettle();

    const crumb = document.getElementById('crumb')!;
    const part = crumb.querySelector('span.crumb-part');
    const title = crumb.querySelector('b');
    expect(part?.textContent).toContain('Phần 1');
    expect(title?.textContent).toBe('1.1 Chương một');
  });

  it('renders the in-content pager with only a next link when there is no prev chapter', async () => {
    await renderChapterAndSettle();

    expect(screen.queryByText('← Chương trước')).not.toBeInTheDocument();
    const next = screen.getByText('Chương sau →').closest('a');
    expect(next).toHaveAttribute('href', '/c/demo/c2');
  });

  it('disables topbar #prev-btn/#next-btn according to prev/next chapter availability', async () => {
    await renderChapterAndSettle();

    expect((document.getElementById('prev-btn') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('next-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ArrowRight navigates to the next chapter', async () => {
    await renderChapterAndSettle({}, { withProbe: true });

    fireEvent.keyDown(document, { key: 'ArrowRight' });

    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/c/demo/c2'));
  });

  it('does not navigate on ArrowRight while typing in a form field', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    await renderChapterAndSettle({}, { withProbe: true });

    fireEvent.keyDown(input, { key: 'ArrowRight' });

    expect(screen.getByTestId('path').textContent).toBe('/c/demo/c1');
    document.body.removeChild(input);
  });

  it('cleans up on unmount: splices out the REDRAWS entries this chapter added, re-enables prev/next buttons', async () => {
    const { unmount } = await renderChapterAndSettle();
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
          <LanguageProvider><MemoryRouter initialEntries={['/c/demo/c1']}>
            <ChapterView
              courseId="demo"
              courseTitle="Khóa học demo"
              partTitle="Phần 1"
              chapter={chapter1}
              prevChapter={null}
              nextChapter={chapter2}
              parts={PARTS}
            />
          </MemoryRouter></LanguageProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await settleChapter();
    expect(window.CourseKit?.REDRAWS).toHaveLength(1);
    expect(document.getElementById('crumb')!.textContent).toBe(
      'Phần 1' + '\u00A0\u203a\u00A0' + '1.1 Chương một',
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <LanguageProvider><MemoryRouter initialEntries={['/c/demo/c1']}>
            <ChapterView
              courseId="demo"
              courseTitle="Khóa học demo"
              partTitle="Phần 2"
              chapter={chapter2}
              prevChapter={chapter1}
              nextChapter={null}
              parts={PARTS}
            />
          </MemoryRouter></LanguageProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    // Chapter 2 has no h2/h3 at all, so its commit is the one that EMPTIES the
    // TOC — which makes `[]` as good a witness for it as three links are for
    // chapter 1, and a strictly better one than `initViz` (whose second call
    // happens before chapter 1's entries have been taken down).
    await settleChapter({ initVizCalls: 2, rail: [] });
    // Still exactly 1 — chapter 1's entry was spliced out when chapter 2's
    // effect ran, not left behind to redraw a detached canvas forever.
    expect(window.CourseKit?.REDRAWS).toHaveLength(1);
    // Crumb reflects the new chapter's part, not a leftover from chapter 1.
    expect(document.getElementById('crumb')!.textContent).toBe(
      'Phần 2' + '\u00A0\u203a\u00A0' + '1.2 Chương hai',
    );
  });

  it('sets document.title from the chapter and course titles', async () => {
    await renderChapterAndSettle();

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
      await renderChapterAndSettle();

      const markBtn = document.getElementById('mark-btn')!;
      expect(markBtn.classList.contains('on')).toBe(false);
      expect(markBtn.querySelector('.mk-ico')!.textContent).toBe('○');
      expect(markBtn.querySelector('.mk-lbl')!.textContent).toBe('Đánh dấu đã học');
    });

    it('clicking #mark-btn marks the chapter read: flips icon/label/class AND writes local progress + outbox', async () => {
      await renderChapterAndSettle();

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
      await renderChapterAndSettle();

      const markBtn = document.getElementById('mark-btn')!;
      fireEvent.click(markBtn);
      await waitFor(() => expect(markBtn.classList.contains('on')).toBe(true));

      fireEvent.click(markBtn);
      await waitFor(() => expect(markBtn.classList.contains('on')).toBe(false));
      expect(markBtn.querySelector('.mk-ico')!.textContent).toBe('○');
    });

    it('reflects a chapter already marked read before this component mounted', async () => {
      await db.progress.put({ courseId: 'demo', chapterId: 'c1', status: 'read', done: true, updatedAt: new Date().toISOString() });

      await renderChapterAndSettle();

      await waitFor(() => expect(document.getElementById('mark-btn')!.classList.contains('on')).toBe(true));
    });

    it('resets to the neutral ○/"Đánh dấu đã học" default on unmount, so it never shows a stale ✓ from a chapter that is no longer open', async () => {
      const { unmount } = await renderChapterAndSettle();

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

  // P2 Task 5. The toolbar has its own suite
  // (src/annotations/SelectionToolbar.test.tsx); what is tested HERE is the
  // wiring this file owns, which no test over there can see: that the toolbar
  // is mounted over the same element the chapter pipeline just filled, that it
  // shares ChapterView's ONE `useAnnotations` instance (a second one would
  // paint every annotation twice), and that a colour click reaches the real
  // local store with this chapter's own course/chapter ids.
  describe('selection toolbar (P2 Task 5)', () => {
    it('selecting chapter prose opens the toolbar; a colour click paints immediately and stores the annotation', async () => {
      await renderChapterAndSettle();

      const container = await selectAndOpenToolbar('Nội dung A');
      const toolbar = screen.getByRole('toolbar');
      fireEvent.click(within(toolbar).getByRole('button', { name: /vàng/i }));

      // Painted on the click, before anything has been read back out of Dexie.
      expect(container.querySelectorAll('mark.ann').length).toBeGreaterThan(0);
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();

      await waitFor(async () => expect(await db.annotations.count()).toBe(1));
      const [row] = await db.annotations.toArray();
      expect(row).toMatchObject({ courseId: 'demo', chapterId: 'c1', note: '', deletedAt: null });
      expect((row.anchor as { exact: string; color: string }).exact).toBe('Nội dung A');
      expect((row.anchor as { exact: string; color: string }).color).toBe('y');
      // The outbox entry is what carries it to the other device — Task 4 writes
      // both in one transaction, and this is the first caller to prove it from
      // the UI side.
      expect(await db.outbox.count()).toBe(1);

      // The store takes the highlight over, and there is exactly ONE mark left:
      // no double paint from a second hook instance, no orphaned optimistic
      // layer from the handover.
      //
      // Both claims live in ONE `waitFor` because they are one state, and the
      // handover is what gets it there: the store paints the real mark into
      // the DOM first and publishes `list` afterwards, so the moment the real
      // mark exists is a moment where the temporary one is still there too.
      // Asserting the count outside the wait read that in-between state and
      // failed with `expected …(2) to have a length of 1` under the scheduler
      // probe. Neither claim is loosened — they simply have to hold together.
      await waitFor(() => {
        expect(container.querySelectorAll(`mark.ann[data-ann-id="${row.id}"]`).length).toBeGreaterThan(0);
        expect(container.querySelectorAll('mark.ann')).toHaveLength(1);
      });
    });

    it('a selection outside the chapter (the pager) gets no toolbar', async () => {
      await renderChapterAndSettle();

      // The precondition, and the whole reason this test is worth running: a
      // NEGATIVE claim about the toolbar proves nothing until something has
      // proved a toolbar CAN open here. Without it the test also passes in the
      // state where the component is simply DEAF — `content.root` still null,
      // no `selectionchange` listener attached — and that is exactly the state
      // the commit race leaves it in. Measured: with the positive precondition
      // bolted onto the OLD `waitFor(initViz)` wait, under the scheduler probe
      // described at the top of this file, this test failed 15 runs out of 20;
      // without the precondition it passed 20 out of 20 while the component
      // never heard a thing.
      await selectAndOpenToolbar('Nội dung A');

      const pagerLink = screen.getByText('Chương sau →');
      const range = document.createRange();
      range.setStart(pagerLink.firstChild!, 0);
      range.setEnd(pagerLink.firstChild!, 6);
      act(() => {
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });

      // Stronger than it looks now: the toolbar that WAS open had to be taken
      // down by the outside selection, rather than never having existed.
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    });
  });

  // P2 Task 6, as chế độ đọc leaves it. `MarginCards` has its own suite
  // (src/annotations/MarginCards.test.tsx); what is tested HERE is the wiring
  // this file owns and no test over there can see: that `#rail` is now the
  // notes MARGIN and holds nothing else, inside ChapterView's own portal
  // (ruling P2-F1 — `shell/Rail.tsx` returns null on a chapter route, and
  // building this there instead would duplicate the whole rail), that the
  // notes are on by DEFAULT rather than behind a tab, and that Task 5's "Ghi
  // chú" button — which until Task 6 only painted yellow and called a
  // callback nobody had wired — opens a real note editor.
  //
  // The block used to be called "rail tabs"; the tabs are gone. What replaced
  // them is one toggle in the topbar, and every claim below that used to be
  // about switching tabs is now about that toggle NOT being needed.
  describe('notes margin (P2 Task 6, chế độ đọc)', () => {
    /** `reader.css` hides `#rail` under `@media (max-width:1240px)`, and
     * jsdom's own default width is 1024 — i.e. the MOBILE branch, where the
     * cards deliberately do not exist. */
    function setViewportWidth(px: number): void {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });
    }

    beforeEach(() => setViewportWidth(1400));
    afterEach(() => setViewportWidth(1024));

    function rail(): HTMLElement {
      return document.getElementById('rail')!;
    }

    /** The topbar's notes control. Keeps `#rail-tab-notes` — see the comment
     * on it in ChapterView.tsx, and the six e2e assertions that read it. */
    function notesBtn(): HTMLElement {
      return document.getElementById('rail-tab-notes')!;
    }

    it('the notes margin is ON by default, holds no tabs, and is not the chapter TOC', async () => {
      await renderChapterAndSettle();

      // No tablist anywhere: the two-tab rail is what chế độ đọc replaced.
      expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
      expect(document.querySelectorAll('.rail-tabs')).toHaveLength(0);

      // The count control lives in the topbar now, is pressed (notes on), and
      // still says exactly what six e2e assertions read off it.
      expect(notesBtn().textContent).toBe('Ghi chú (0)');
      expect(notesBtn()).toHaveAttribute('aria-pressed', 'true');
      expect(document.getElementById('reader-notes')!.contains(notesBtn())).toBe(true);

      // `#rail` is the margin: cards and the orphan panel, and nothing else.
      // Its chapter-outline links moved to the drawer — six links here would
      // be the P1 Task 11 duplicate-rail bug that ruling P2-F1 prevents.
      expect(rail().querySelectorAll('a')).toHaveLength(0);
      expect(rail().querySelector('#reader-notes-margin')).not.toBeNull();
      expect(rail().querySelector('#reader-notes-margin')).not.toHaveAttribute('hidden');
    });

    it('the notes toggle hides the margin and brings it back, without unmounting what is in it', async () => {
      await renderChapterAndSettle();

      fireEvent.click(notesBtn());
      await waitFor(() => expect(notesBtn()).toHaveAttribute('aria-pressed', 'false'));
      expect(rail().querySelector('#reader-notes-margin')).toHaveAttribute('hidden');
      // `.rail-notes` comes off with it: the class is what turns `#rail` from
      // a sticky self-scrolling box into a document-coordinate column, and a
      // hidden margin has no column to lay out.
      expect(rail().classList.contains('rail-notes')).toBe(false);
      // Still MOUNTED, not unmounted: a click on a highlight (and, below
      // 1241px, its bottom sheet) has to keep working whatever the margin is
      // showing — the same reason the two-tab version used `hidden` here.
      expect(rail().querySelector('#reader-notes-margin')).not.toBeNull();

      fireEvent.click(notesBtn());
      await waitFor(() => expect(notesBtn()).toHaveAttribute('aria-pressed', 'true'));
      expect(rail().querySelector('#reader-notes-margin')).not.toHaveAttribute('hidden');
    });

    it('the toolbar\'s "Ghi chú" button opens a margin card for the new note, focused, and what is typed there is stored', async () => {
      await renderChapterAndSettle();

      await selectAndOpenToolbar('Nội dung A');
      fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Ghi chú' }));

      // The margin is on and the card is in it — a note editor the reader has
      // to go find is not an editor.
      const box = await screen.findByRole('textbox', { name: /ghi chú/i });
      expect(notesBtn()).toHaveAttribute('aria-pressed', 'true');
      expect(document.activeElement).toBe(box);
      expect(rail().querySelectorAll('[data-ann-card]')).toHaveLength(1);

      fireEvent.change(box, { target: { value: 'xem lại chỗ này' } });
      fireEvent.blur(box);

      await waitFor(async () => {
        const [row] = await db.annotations.toArray();
        expect(row.note).toBe('xem lại chỗ này');
      });
      // One row for the create, one for the note edit — the note reaches the
      // other device the same way the highlight does.
      expect(await db.outbox.count()).toBe(2);
      expect(notesBtn().textContent).toBe('Ghi chú (1)');
    });

    it('a note opened while the margin is off turns it back on — a card the reader cannot see is a click that did nothing', async () => {
      await renderChapterAndSettle();

      fireEvent.click(notesBtn());
      await waitFor(() => expect(notesBtn()).toHaveAttribute('aria-pressed', 'false'));

      await selectAndOpenToolbar('Nội dung A');
      fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Ghi chú' }));

      // This is `focusCard`'s `setNotesOn(true)`, and it is the rule the
      // two-tab version spent `setRailTab('notes')` on. Without it the
      // toolbar paints a highlight, creates a note and opens an editor that
      // is `hidden` — the exact bug Task 6 was written to close, back when
      // nothing listened to `onRequestNote` at all.
      const box = await screen.findByRole('textbox', { name: /ghi chú/i });
      expect(notesBtn()).toHaveAttribute('aria-pressed', 'true');
      expect(document.activeElement).toBe(box);
    });

    it('two notes give two cards in document order (a chapter with one note proves nothing — ruling P2-F8)', async () => {
      await renderChapterAndSettle();

      // Created in REVERSE document order, through the real toolbar, so the
      // order asserted below can only come from the store's own placement —
      // and so the second paint happens against a map the first paint expired.
      await selectAndOpenToolbar('Nội dung B');
      fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: /vàng/i }));
      await waitFor(async () => expect(await db.annotations.count()).toBe(1));

      await selectAndOpenToolbar('Nội dung A');
      fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: /xanh lá/i }));
      await waitFor(async () => expect(await db.annotations.count()).toBe(2));

      await waitFor(() => expect(rail().querySelectorAll('[data-ann-card]')).toHaveLength(2));

      const container = document.querySelector('.fade-in') as HTMLElement;
      const ids = Array.from(rail().querySelectorAll<HTMLElement>('[data-ann-card]')).map((c) => c.dataset.annCard);
      const painted = Array.from(container.querySelectorAll<HTMLElement>('mark.ann')).map((m) => m.dataset.annId);
      expect(ids).toEqual(painted);
      expect(notesBtn().textContent).toBe('Ghi chú (2)');
    });

    it('.rail-notes có sẵn từ đầu (lề luôn bật), và gỡ khi rời chương', async () => {
      // Class này là toàn bộ khác biệt giữa "một rãnh TOC ngắn tự cuộn" và "một
      // cột thẻ neo theo toạ độ tài liệu": nó tắt `position:sticky`,
      // `max-height:calc(100vh - 100px)` và `overflow-y:auto`, rồi nới rãnh ra
      // cho vừa một thẻ. Gỡ nó ra trên trang thật thì rãnh tụt về 210px và MỘT
      // THẺ BỊ CẮT — mà không một test nào trong 456 nhìn thấy, vì không test
      // nào từng đọc `className` của `#rail`.
      //
      // Trước hướng A, class chỉ lên khi người đọc bấm tab "Ghi chú"; nay ghi
      // chú là mặc định, nên class phải có mặt NGAY LÚC MỞ CHƯƠNG — nếu không
      // thì thẻ đầu tiên bị cắt trước khi ai kịp bấm gì.
      const { unmount } = await renderChapterAndSettle();
      expect(rail().classList.contains('rail-notes')).toBe(true);

      unmount();

      // Rãnh của trang sau (`/`, `/c/:courseId`) không thừa hưởng bố cục thẻ.
      expect(rail().classList.contains('rail-notes')).toBe(false);
    });
  });

  // P2 Task 7. The panel has its own suite
  // (src/annotations/OrphanPanel.test.tsx); what is tested HERE is the thing
  // no test over there can see, because it is a property of two SIBLINGS: Task
  // 5's toolbar and Task 7's reattach mode both listen to `selectionchange` on
  // this document, and while a rescue is in progress only one of them may
  // answer. A stub of either component in the other's suite would only prove
  // the stub behaves.
  describe('orphan panel + reattach mode (P2 Task 7)', () => {
    /**
     * A note whose quote occurs nowhere in `FRAGMENT` — the shape every note
     * takes when the course content it was written against is rebuilt.
     *
     * Hand-written rather than built through `selectionToAnchor`, and that is
     * safe HERE for a reason worth stating: nothing about the collapsed
     * projection matters to a quote that is absent in every space at once. The
     * real-anchor fixtures live in `../annotations/OrphanPanel.test.tsx`,
     * where the projection is load-bearing.
     */
    const LOST = {
      id: 'orphan-1',
      courseId: 'demo',
      chapterId: 'c1',
      anchor: {
        exact: 'Định lý mã hoá kênh của Shannon phát biểu rằng mọi kênh rời rạc không nhớ đều có dung lượng',
        prefix: 'Ở chương trước ta đã thấy ',
        suffix: ' và phần chứng minh đi kèm.',
        color: 'p',
      },
      note: 'ghi chú cần cứu',
      createdAt: '2026-08-19T09:30:00.000Z',
      updatedAt: '2026-08-19T09:30:00.000Z',
      deletedAt: null,
    };

    // The margin-card column only exists above 1240px (`reader.css` hides
    // `#rail` below it), and jsdom's own default is 1024 — the MOBILE branch.
    // Without this the "the column must not claim the chapter is empty" test
    // below would be green because there is no column at all.
    beforeEach(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 }));
    afterEach(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 }));

    function rail(): HTMLElement {
      return document.getElementById('rail')!;
    }

    /** The orphan row in the notes margin. There is no tab to click any more
     * — the margin is on by default, which is itself load-bearing (an orphan
     * has to be on screen the moment a reader opens a chapter whose text
     * moved under it) — so this only WAITS. It waits on the store having
     * published the orphan, not on anything the chapter painted, because the
     * row is a fact about the store and not about the DOM (ruling P2-F15). */
    async function openOrphanList(): Promise<HTMLElement> {
      return await within(rail()).findByRole('button', { name: 'Gắn lại' });
    }

    it('mồ côi hiện trong lề ghi chú — đúng MỘT bản, trong portal của ChapterView (P2-F1)', async () => {
      await db.annotations.put(LOST);
      await renderChapterAndSettle();
      await openOrphanList();

      const sections = document.querySelectorAll('.ann-orphans');
      // One copy, and it is inside `#rail`. Building this in `shell/Rail.tsx`
      // instead — which returns null on a chapter route — is the duplicate-rail
      // bug ruling P2-F1 exists to prevent, and it would show up here as two.
      expect(sections).toHaveLength(1);
      expect(rail().contains(sections[0])).toBe(true);
      expect(within(rail()).getByRole('heading', { name: 'Mồ côi (1)' })).toBeInTheDocument();
      expect(within(rail()).getByText('ghi chú cần cứu')).toBeInTheDocument();
    });

    it('cột thẻ KHÔNG nói "chưa có ghi chú nào" khi ngay dưới nó có ghi chú mồ côi', async () => {
      await db.annotations.put(LOST);
      await renderChapterAndSettle();
      await openOrphanList();

      // Two statements one above the other, one of them false. The column's
      // empty line is a claim about the CHAPTER; the orphan list underneath is
      // two of the reader's own notes. Seen on the real page in dark mode —
      // no fixture in the 498 tests had both components in frame at once.
      expect(within(rail()).queryByText(/chưa có ghi chú/i)).not.toBeInTheDocument();
      expect(within(rail()).getByText('ghi chú cần cứu')).toBeInTheDocument();
    });

    it('nút đếm cả ghi chú mồ côi — nếu không, con số duy nhất nói về chúng lại đề "(0)"', async () => {
      await db.annotations.put(LOST);
      await renderChapterAndSettle();

      // The reader has exactly one note in this chapter. It could not be
      // placed, so nothing is painted and there is no card — but it exists,
      // it is theirs, and this count is the only thing that will tell them so.
      // Counting only `list` here reads "Ghi chú (0)" beside a margin holding
      // their note, and makes a content rebuild look like their notes
      // vanished. Found by opening the real page, not by a test.
      await waitFor(() => expect(document.getElementById('rail-tab-notes')!.textContent).toBe('Ghi chú (1)'));
      expect(document.querySelectorAll('mark.ann')).toHaveLength(0);
    });

    it('trong chế độ "Gắn lại", bôi chọn KHÔNG mở thanh công cụ tạo ghi chú mới — và mở lại được sau khi hủy', async () => {
      await db.annotations.put(LOST);
      await renderChapterAndSettle();

      // The positive precondition first, exactly as the pager test above does
      // it and for the same reason: a negative claim about the toolbar proves
      // nothing until something has proved a toolbar CAN open here. Without
      // it this test also passes against a component that never heard a thing.
      await selectAndOpenToolbar('Nội dung A');

      fireEvent.click(await openOrphanList());

      // Entering the mode takes down a toolbar that was ALREADY open. Leaving
      // it up would give the reader a swatch that writes a second note into
      // the selection they meant to rescue the first one into.
      await waitFor(() => expect(screen.queryByRole('toolbar')).not.toBeInTheDocument());

      selectInChapter('Nội dung B');
      await act(async () => {});

      // The whole point of this test: one drag, one answer.
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Gắn vào đây' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));

      // And the veto is temporary: `selectAndOpenToolbar` fails loudly if no
      // toolbar can be opened within a second, so this line is the proof that
      // suspending it did not leave it deaf.
      await selectAndOpenToolbar('Nội dung B');
      expect(await db.outbox.count()).toBe(0);
    });

    it('gắn lại qua giao diện thật: ghi chú về đúng chỗ mới, giữ nguyên chữ và màu, và rời khỏi mục mồ côi', async () => {
      await db.annotations.put(LOST);
      await renderChapterAndSettle();

      fireEvent.click(await openOrphanList());
      selectInChapter('Nội dung A');
      fireEvent.click(await screen.findByRole('button', { name: 'Gắn vào đây' }));

      // The witness has to be one that CHANGES on the reattach and comes from
      // STATE. The count already read "Ghi chú (1)" while the note was an orphan
      // (that is the point of the test above), so waiting on it would return
      // before anything happened; a margin card is no good either, because
      // jsdom's 1024px is the narrow branch where the column deliberately does
      // not exist. The orphan section disappearing is exactly the store
      // publishing an empty `orphans`, and it can only happen after the new
      // anchor resolved and was painted.
      await waitFor(() => expect(document.querySelectorAll('.ann-orphans')).toHaveLength(0));
      expect(document.getElementById('rail-tab-notes')!.textContent).toBe('Ghi chú (1)');

      const container = document.querySelector('.fade-in') as HTMLElement;
      const mark = container.querySelector<HTMLElement>('mark.ann[data-ann-id="orphan-1"]')!;
      expect(mark.textContent).toBe('Nội dung A');
      // The rescued note keeps its own colour, not the toolbar's default.
      expect(mark.className).toContain('ann-p');

      const row = await db.annotations.get('orphan-1');
      expect(row!.note).toBe('ghi chú cần cứu');
      expect(row!.deletedAt).toBeNull();
      expect((row!.anchor as { exact: string; color: string }).exact).toBe('Nội dung A');
      expect((row!.anchor as { exact: string; color: string }).color).toBe('p');
      // One outbox row for the reattach, and only that: nothing about an
      // orphan is written until the reader asks for it.
      expect(await db.outbox.count()).toBe(1);
    });
  });

  describe('t/T theme shortcut (debt #2 — shared ThemeContext, no topbar desync)', () => {
    it('pressing "t" toggles <html data-theme> via the same toggle the topbar would use', async () => {
      await renderChapterAndSettle();

      expect(document.documentElement.dataset.theme).toBe('light');
      fireEvent.keyDown(document, { key: 't' });
      expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('pressing "T" (shift) also toggles', async () => {
      await renderChapterAndSettle();

      fireEvent.keyDown(document, { key: 'T' });
      expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('does not toggle while typing in a form field, same guard as ArrowLeft/ArrowRight', async () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      await renderChapterAndSettle();

      fireEvent.keyDown(input, { key: 't' });

      expect(document.documentElement.dataset.theme).toBe('light');
      document.body.removeChild(input);
    });
  });

  describe('exercise checkboxes (injected into every .box.ex .box-h)', () => {
    it('injects exactly one checkbox per .box.ex once the chapter renders', async () => {
      await renderChapterAndSettle();

      const checkboxes = document.querySelectorAll('.box.ex .box-h input[type="checkbox"]');
      expect(checkboxes).toHaveLength(2);
    });

    it('checking a box writes "ex:<index>" progress (0-based, DOM order) to local storage + outbox', async () => {
      await renderChapterAndSettle();

      const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('.box.ex .box-h input[type="checkbox"]'));
      fireEvent.click(checkboxes[1]);

      await waitFor(async () => {
        const row = await db.progress.get(['demo', 'c1', 'ex:1']);
        expect(row).toMatchObject({ status: 'ex:1', done: true });
      });
    });

    it('does not double-inject across a StrictMode double-mount', async () => {
      await renderChapterAndSettle({}, { strict: true });

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

      await settleChapter();

      const checkboxes = document.querySelectorAll('.box.ex .box-h input[type="checkbox"]');
      expect(checkboxes).toHaveLength(2);
    });
  });
});
