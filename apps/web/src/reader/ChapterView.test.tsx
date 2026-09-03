import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, getConfig, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { StrictMode, useEffect, useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Chapter, Part } from '../course/types';
import { __resetSessionIdentityForTests, announceSessionUser, sessionWasSuperseded } from '../auth/sessionIdentity';
import { clearUserContent } from '../db/localStorage';
import { t } from '../i18n';
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

// `dao-ham`'s placeholder replaces what used to be a `[data-viz="aep"]` node
// (Task 11: viz canvases are gone, widgets in sandboxed iframes are what
// replaced them — see WidgetFrame.tsx). `WIDGETS` is this chapter's payload
// entry for it; `renderChapterAndSettle` renders it on every test in this
// file that doesn't override the `c1` handler, the same way `RAIL_ENTRIES`
// below is produced on every one of them.
const FRAGMENT = `
<h1 class="ch-title">Chương một</h1>
<p class="ch-lede">Xem $x$ ở đây.</p>
<h2 id="sec-a">Phần A</h2>
<p>Nội dung A</p>
<h3>Tiểu mục</h3>
<p>Chi tiết</p>
<div class="fig-body"><div data-widget="dao-ham"></div></div>
<h2>Phần B</h2>
<p>Nội dung B</p>
<div class="box ex"><div class="box-h">Bài 1</div><p>Đề 1</p></div>
<div class="box ex"><div class="box-h">Bài 2</div><p>Đề 2</p></div>
`;

const WIDGETS = [{ name: 'dao-ham', html: '<p>widget đạo hàm</p>' }];

const CHAPTER_2_HTML = '<h1 class="ch-title">Chương hai</h1><p>nội dung khác</p>';

/**
 * Task 6, Pha 3: `useProgress` (mounted by `AuthedReaderExtras`, same as
 * `/me` below) now reads/writes `GET`/`PUT /progress` instead of Dexie's
 * `db.progress`/`db.outbox` — every `#mark-btn`/exercise-checkbox test in
 * this file needs these to resolve. Backed by this in-memory array rather
 * than a handler that always answers `[]`: `onSettled` (`useProgress.ts`)
 * invalidates and REFETCHES after every mutation, so a `GET` that ignores
 * what was just `PUT` would clobber the very write a test is trying to
 * observe the instant that refetch lands — the same trap
 * `progress/useProgress.test.ts`'s own mock avoids the same way. Reset in
 * this file's `beforeEach`, below.
 */
let progressRows: Array<{ courseId: string; chapterId: string; status: string; done: boolean; updatedAt: string }>;

/**
 * Task 7, Pha 3: `useAnnotations` (mounted by `AuthedReaderExtras`, same as
 * `useProgress` above) now reads/writes `GET/POST /annotations` and
 * `PATCH/DELETE /annotations/:id` instead of Dexie's `db.annotations`/
 * `db.outbox` — the identical shift `progressRows` already made one task
 * earlier, for the identical reason: `onSettled` (`useAnnotations.ts`)
 * invalidates and REFETCHES after every write, so a `GET` that ignores what
 * was just written would clobber the very write a test is trying to observe.
 * Reset in this file's `beforeEach`, below. No `deletedAt` field — the server
 * hard-deletes (see `../api/annotations`'s own header), so `DELETE` below
 * really does remove the row rather than tombstoning it.
 */
let annotationRows: Array<{
  id: string;
  courseId: string;
  chapterId: string;
  anchor: unknown;
  note: string;
  createdAt: string;
  updatedAt: string;
}>;

const server = setupServer(
  http.get('/courses/demo/chapters/c1', () => HttpResponse.json({ html: FRAGMENT, widgets: WIDGETS })),
  http.get('/courses/demo/chapters/c2', () => HttpResponse.json({ html: CHAPTER_2_HTML, widgets: [] })),
  // Task 12: `ChapterView` now calls `useMe()` itself, to decide whether to
  // mount `AuthedReaderExtras`. Every test in this file predates that and
  // was written assuming the reader's own annotations/progress/checkboxes —
  // a signed-in `/me` here is what keeps all of them describing the same
  // behaviour as before; the handful of tests that care about the OTHER
  // shape (Task 12's own block, below) override this with `server.use`.
  http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'Người học' })),
  // Task 6 (ghi-danh-khoa-hoc): `ChapterView` now also queries `GET
  // /enrollments` for every signed-in reader (to decide whether "Thêm vào
  // khoá của tôi" makes sense) — the exact same `onUnhandledRequest: 'error'`
  // trap Task 12's `/me` handler above already names: every test in this file
  // that reaches a signed-in reader fires this request too, so a default
  // handler here is required before ANY of them stop erroring. Empty by
  // default — "not yet enrolled" — the one shape every test that doesn't
  // care about enrollment implicitly wants; the Task 6 block below overrides
  // it where the enrollment state itself is what's under test.
  http.get('/enrollments', () => HttpResponse.json({ enrollments: [] })),
  http.get('/progress', () => HttpResponse.json({ progress: progressRows })),
  http.put('/progress', async ({ request }) => {
    const body = (await request.json()) as { courseId: string; chapterId: string; status: string; done: boolean };
    const idx = progressRows.findIndex(
      (r) => r.courseId === body.courseId && r.chapterId === body.chapterId && r.status === body.status,
    );
    const saved = { ...body, updatedAt: new Date().toISOString() };
    if (idx === -1) progressRows.push(saved);
    else progressRows[idx] = saved;
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/annotations', ({ request }) => {
    const course = new URL(request.url).searchParams.get('course');
    const rows = course === null ? annotationRows : annotationRows.filter((r) => r.courseId === course);
    return HttpResponse.json({ annotations: rows });
  }),
  http.post('/annotations', async ({ request }) => {
    const body = (await request.json()) as { id: string; courseId: string; chapterId: string; anchor: unknown; note: string };
    const at = new Date().toISOString();
    annotationRows.push({ ...body, createdAt: at, updatedAt: at });
    return new HttpResponse(null, { status: 201 });
  }),
  http.patch('/annotations/:id', async ({ request, params }) => {
    const id = String(params.id);
    const patch = (await request.json()) as { note?: string; anchor?: unknown };
    const idx = annotationRows.findIndex((r) => r.id === id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    annotationRows[idx] = { ...annotationRows[idx], ...patch, updatedAt: new Date().toISOString() };
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete('/annotations/:id', ({ params }) => {
    const id = String(params.id);
    annotationRows = annotationRows.filter((r) => r.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),
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

  // The supersession test at the bottom of this file is the only one that
  // touches `auth/sessionIdentity`'s module state, and a leftover
  // `superseded` flag would make every test after it render a signed-out
  // reader. Reset unconditionally rather than in that one test: a guard that
  // depends on remembering to call it is the shape this whole round of
  // fixes exists to remove.
  afterEach(() => {
    __resetSessionIdentityForTests();
  });

  beforeEach(() => {
    progressRows = [];
    annotationRows = [];
    renderKatex = vi.fn<(root: ParentNode) => void>();
    // `initViz`/`REDRAWS`/`VIZ` are still part of `window.CourseKit`'s type
    // (packages/course-kit/runtime.js still attaches them — see
    // theme/useTheme.ts's redraw-on-toggle code, untouched by this task) but
    // Task 11 removed every call ChapterView itself made into them. Provided
    // here only so this object satisfies that type; no test in this file may
    // assert anything through `initViz`/`REDRAWS` again — a chapter that
    // called them would be a regression back to the pre-widget model.
    window.CourseKit = { renderKatex, initViz: vi.fn(), REDRAWS: [], VIZ: {} };
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
    await clearUserContent();
    delete document.documentElement.dataset.theme;
    window.localStorage.clear();
    courseKitMockState.gate = null;
  });

  // =========================================================================
  // Waiting for a chapter — read this before writing a test in this file
  // =========================================================================
  //
  // `await waitFor(() => expect(renderKatex).toHaveBeenCalledTimes(1))` is
  // NOT a signal that the chapter is on the page. It is the signal that the
  // chapter effect's BODY reached its middle. Everything the body writes
  // imperatively (`container.innerHTML`, `#crumb`, `#prev-btn`/`#next-btn`,
  // `#mark-btn`, `document.title`) is there when it resumes; everything the
  // body puts in React STATE is not:
  //
  //     ChapterView.tsx:603  CourseKit.renderKatex(container)     ← the signal
  //     ChapterView.tsx:642  setHeadings(...)                     ← #rail
  //     ChapterView.tsx:669  setAnnotationContent(...)            ← <SelectionToolbar>
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
  // at :436 was the one that lost. Waiting on a single early imperative call
  // is therefore not "usually enough" — it is the wrong signal, and it wins
  // by luck. Task 11 replaced `initViz` with `renderKatex` as that early
  // signal (the last real call ChapterView still makes on `window.CourseKit`
  // before the state writes), but the underlying trap is identical — the
  // fix has never been "pick a different single call," it's the second wait
  // below.
  //
  // So: never wait on `renderKatex` alone. Use `renderChapterAndSettle()` (or
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
   * instant the early imperative call (`initViz` then, `renderKatex` now)
   * runs holds ZERO of them, and under StrictMode it is still empty two
   * macrotasks later.
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
    renderCalls = 1,
    rail = RAIL_ENTRIES,
    expectSession = true,
  }: { renderCalls?: number; rail?: readonly string[]; expectSession?: boolean } = {}): Promise<void> {
    await waitFor(() => expect(renderKatex).toHaveBeenCalledTimes(renderCalls));
    await waitFor(() => expect(tocLinks().map((a) => a.textContent)).toEqual([...rail]));
    await act(async () => {});
    // Task 12: `AuthedReaderExtras` only mounts once `useMe()` settles, which
    // is a SEPARATE network round trip from the chapter fragment the two
    // waits above witness — the two can (and, under MSW, typically do)
    // resolve in different commits. Every test in this file but Task 12's own
    // block expects a signed-in reader's full UI (annotations toolbar,
    // `#rail-tab-notes`, wired `#mark-btn`, exercise checkboxes), so this
    // waits for that extra commit too — `#rail-tab-notes` exists ONLY once
    // `AuthedReaderExtras` has rendered its portal, and nothing else in this
    // file creates that id. `expectSession: false` (Task 12's anonymous
    // tests) skips it — that id must never appear there, so waiting for it
    // would just be a timeout with extra steps.
    if (expectSession) {
      await waitFor(() => expect(document.getElementById('rail-tab-notes')).not.toBeNull());
    }
  }

  /** `renderChapterView`, then `settleChapter`. What every test here wants. */
  async function renderChapterAndSettle(
    props: Partial<React.ComponentProps<typeof ChapterView>> = {},
    options: { strict?: boolean; withProbe?: boolean; expectSession?: boolean } = {},
  ): Promise<ReturnType<typeof renderChapterView>> {
    const { expectSession, ...renderOptions } = options;
    const view = renderChapterView(props, renderOptions);
    await settleChapter({ expectSession });
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

  it('calls renderKatex exactly once, with the element containing the fragment', async () => {
    await renderChapterAndSettle();

    expect(renderKatex).toHaveBeenCalledTimes(1);

    const renderKatexArg = renderKatex.mock.calls[0][0] as HTMLElement;
    expect(renderKatexArg.textContent).toContain('Nội dung A');
    expect(renderKatexArg.querySelector('[data-widget="dao-ham"]')).not.toBeNull();
  });

  it('is idempotent under React StrictMode double-invoke — still exactly one renderKatex call, one TOC entry set, one widget iframe', async () => {
    await renderChapterAndSettle({}, { strict: true });

    expect(renderKatex).toHaveBeenCalledTimes(1);

    // Read synchronously, because `renderChapterAndSettle` has already waited
    // for the commit that fills the drawer's TOC — the window this assertion
    // used to lose to (~8% of full-suite runs in P2 Task 1's review, always
    // `expected 0 to have length 3`) is closed by the wait, not by luck. Still
    // exactly 3, never "at least one".
    expect(tocLinks()).toHaveLength(3);
    // The widget placeholder's portal is equally exposed to a StrictMode
    // double-mount (`createPortal` into a DOM node React did not create) —
    // one iframe, not two from a discarded first pass left behind.
    expect(document.querySelectorAll('[data-widget="dao-ham"] iframe')).toHaveLength(1);
  });

  it('builds a TOC entry for every h2/h3, in the drawer, exactly once', async () => {
    await renderChapterAndSettle();

    // Synchronous again, for the same reason: the TOC is the very thing
    // `settleChapter` waits on, so by here the commit has landed. The de-flake
    // round had to wrap this array in `waitFor` because the wait above it was
    // on the early imperative call; with the right wait the claim goes back
    // to being a plain assertion — same three headings, same order, never
    // "at least one".
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

  it('cleans up on unmount: re-enables topbar prev/next buttons', async () => {
    const { unmount } = await renderChapterAndSettle();

    unmount();

    expect((document.getElementById('next-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('navigating between chapters reuses the component instance (rerender, not remount), does not leak the previous chapter\'s widget iframe, and the crumb updates', async () => {
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
    // Chapter 1's own widget iframe is on the page (WIDGETS' one entry).
    expect(document.querySelectorAll('[data-widget="dao-ham"] iframe')).toHaveLength(1);
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
    // chapter 1, and a strictly better one than `renderKatex`'s second call
    // (which happens before chapter 1's entries have been taken down).
    await settleChapter({ renderCalls: 2, rail: [] });
    // Chapter 2's payload carries no widgets, so chapter 1's iframe must be
    // GONE — not orphaned in a detached placeholder still holding a live
    // iframe (the exact leak REDRAWS-splicing used to guard against for
    // canvases; a portal target belonging to a replaced `innerHTML` subtree
    // is this task's version of the same hazard).
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
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
    server.use(http.get('/courses/demo/chapters/c1', () => new HttpResponse(null, { status: 404 })));

    renderChapterView();

    expect(await screen.findByText(/không tải được|not found|lỗi/i)).toBeInTheDocument();
    expect(renderKatex).not.toHaveBeenCalled();
  });

  // Task 11 — the whole reason this task exists. `<WidgetFrame>` itself
  // (its `sandbox` attribute, `srcDoc`, `title`) has its own dedicated suite
  // in WidgetFrame.test.tsx; what belongs HERE is the wiring only ChapterView
  // does: finding a chapter's `<div data-widget>` placeholders after
  // `innerHTML` + KaTeX have run, and portalling the right widget into each.
  describe('widgets (Task 11 — sandboxed iframes)', () => {
    it('renders a WidgetFrame for a placeholder whose name matches a payload widget, inside that placeholder', async () => {
      await renderChapterAndSettle();

      const placeholder = document.querySelector('[data-widget="dao-ham"]')!;
      const frame = placeholder.querySelector('iframe')!;
      expect(frame).toBeInTheDocument();
      // Exactly `allow-scripts` — see WidgetFrame.test.tsx for the assertion
      // that actually guards the regression; this is just proof ChapterView
      // hands WidgetFrame's own props through unchanged, not a second copy
      // of that guard.
      expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
      expect(frame).toHaveAttribute('title', 'dao-ham');
      expect((frame as HTMLIFrameElement).srcdoc).toBe('<p>widget đạo hàm</p>');
    });

    it('leaves a placeholder empty when its data-widget name has no match in the payload (a stale cache, per the server\'s own validation)', async () => {
      server.use(
        http.get('/courses/demo/chapters/c1', () =>
          HttpResponse.json({
            html: '<h1 class="ch-title">Chương một</h1><div data-widget="khong-con-nua"></div>',
            widgets: [],
          }),
        ),
      );

      renderChapterView();
      await waitFor(() => expect(renderKatex).toHaveBeenCalledTimes(1));
      await act(async () => {});

      const placeholder = document.querySelector('[data-widget="khong-con-nua"]');
      expect(placeholder).not.toBeNull();
      expect(placeholder!.querySelector('iframe')).toBeNull();
      expect(placeholder!.innerHTML).toBe('');
    });
  });

  describe('#mark-btn (debt #5 — Ruling F4, wired to real progress)', () => {
    it('starts unmarked (○ / "Đánh dấu đã học") when the chapter has no progress row', async () => {
      await renderChapterAndSettle();

      const markBtn = document.getElementById('mark-btn')!;
      expect(markBtn.classList.contains('on')).toBe(false);
      expect(markBtn.querySelector('.mk-ico')!.textContent).toBe('○');
      expect(markBtn.querySelector('.mk-lbl')!.textContent).toBe('Đánh dấu đã học');
    });

    it('clicking #mark-btn marks the chapter read: flips icon/label/class AND PUTs the new progress row', async () => {
      // Task 6, Pha 3: the write this button makes is now a `PUT /progress`
      // (`useProgress`'s optimistic mutation), not a Dexie write + outbox
      // enqueue — see this file's server setup (`progressRows`) for where
      // that PUT lands.
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

      await waitFor(() => expect(progressRows).toHaveLength(1));
      expect(progressRows[0]).toMatchObject({ courseId: 'demo', chapterId: 'c1', status: 'read', done: true });
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
      // Task 6, Pha 3: "already marked read" now means the server's `GET
      // /progress` says so, not a pre-seeded Dexie row.
      progressRows.push({ courseId: 'demo', chapterId: 'c1', status: 'read', done: true, updatedAt: new Date().toISOString() });

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

      // Painted on the click, before the server has answered the POST.
      expect(container.querySelectorAll('mark.ann').length).toBeGreaterThan(0);
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();

      await waitFor(() => expect(annotationRows).toHaveLength(1));
      const [row] = annotationRows;
      expect(row).toMatchObject({ courseId: 'demo', chapterId: 'c1', note: '' });
      expect((row.anchor as { exact: string; color: string }).exact).toBe('Nội dung A');
      expect((row.anchor as { exact: string; color: string }).color).toBe('y');

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

      await waitFor(() => {
        const [row] = annotationRows;
        expect(row.note).toBe('xem lại chỗ này');
      });
      // Still exactly one row — the note edit is a PATCH of the same id, not a
      // second annotation.
      expect(annotationRows).toHaveLength(1);
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
      await waitFor(() => expect(annotationRows).toHaveLength(1));

      await selectAndOpenToolbar('Nội dung A');
      fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: /xanh lá/i }));
      await waitFor(() => expect(annotationRows).toHaveLength(2));

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
      annotationRows.push(LOST);
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
      annotationRows.push(LOST);
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
      annotationRows.push(LOST);
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
      annotationRows.push(LOST);
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
      // "Hủy" is a READ — nothing about the orphan changed on the server.
      expect(annotationRows).toEqual([LOST]);
    });

    it('gắn lại qua giao diện thật: ghi chú về đúng chỗ mới, giữ nguyên chữ và màu, và rời khỏi mục mồ côi', async () => {
      annotationRows.push(LOST);
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

      // Still exactly one row, with the SAME id — a delete-then-create would
      // have produced a second row (a new id) instead of a PATCH of this one.
      expect(annotationRows).toHaveLength(1);
      const row = annotationRows.find((r) => r.id === 'orphan-1');
      expect(row!.note).toBe('ghi chú cần cứu');
      expect((row!.anchor as { exact: string; color: string }).exact).toBe('Nội dung A');
      expect((row!.anchor as { exact: string; color: string }).color).toBe('p');
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

    it('checking a box PUTs "ex:<index>" progress (0-based, DOM order)', async () => {
      // Task 6, Pha 3: this write is now `PUT /progress`, not a Dexie row —
      // see the `#mark-btn` block above for the same change.
      await renderChapterAndSettle();

      const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('.box.ex .box-h input[type="checkbox"]'));
      fireEvent.click(checkboxes[1]);

      await waitFor(() => expect(progressRows).toHaveLength(1));
      expect(progressRows[0]).toMatchObject({ courseId: 'demo', chapterId: 'c1', status: 'ex:1', done: true });
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
      expect(renderKatex).not.toHaveBeenCalled();

      releaseCourseKitReady!();

      await settleChapter();

      const checkboxes = document.querySelectorAll('.box.ex .box-h input[type="checkbox"]');
      expect(checkboxes).toHaveLength(2);
    });
  });

  /**
   * Final whole-branch review, Important 2: `container.innerHTML = data.html`
   * (above) never rewrote a package-relative `src`/`href`, so
   * `<img src="images/fig1.png">` resolved against the SPA's own document
   * URL and silently hit the `/* -> /index.html` fallback instead of the
   * real asset — invisible until now because none of the three shipping
   * courses (`fixtures/courses/*`) contains an `<img>`. This is the fixture
   * chapter that carries one, wired through the real fetch/render path
   * (`rewriteAssetUrls.test.ts` covers the rewriting rules themselves —
   * package-relative vs. absolute/protocol-relative/fragment/mailto/tel —
   * in isolation).
   */
  describe('asset URLs (final whole-branch review, Important 2)', () => {
    it('rewrites a package-relative <img src> to the real asset endpoint instead of leaving it to hit the SPA fallback', async () => {
      server.use(
        http.get('/courses/demo/chapters/c1', () =>
          HttpResponse.json({
            html: '<h1 class="ch-title">Chương một</h1><img src="images/fig1.png" alt="Hình 1">',
            widgets: [],
          }),
        ),
      );

      // This fixture fragment has no h2/h3, same reasoning as CHAPTER_2_HTML
      // above — the empty rail is the correct witness for it. Calling
      // renderChapterView + settleChapter directly (not
      // renderChapterAndSettle, which would wait for RAIL_ENTRIES and never
      // settle against this fragment's empty rail).
      renderChapterView();
      await settleChapter({ rail: [] });

      const img = document.querySelector<HTMLImageElement>('.fade-in img');
      expect(img?.getAttribute('src')).toBe('/courses/demo/assets/images/fig1.png');
    });

    it('leaves an absolute-URL <img src> untouched — an external image is valid chapter content, not a package asset', async () => {
      server.use(
        http.get('/courses/demo/chapters/c1', () =>
          HttpResponse.json({
            html: '<h1 class="ch-title">Chương một</h1><img src="https://cdn.example.com/fig1.png" alt="Hình 1">',
            widgets: [],
          }),
        ),
      );

      renderChapterView();
      await settleChapter({ rail: [] });

      const img = document.querySelector<HTMLImageElement>('.fade-in img');
      expect(img?.getAttribute('src')).toBe('https://cdn.example.com/fig1.png');
    });
  });

  /**
   * Task 12 — courses are free to read; signing in is what makes progress,
   * notes and AI conversations follow a reader between devices (spec §2.4).
   * Every OTHER test in this file renders with the default signed-in `/me`
   * handler above and exercises the session-only UI directly; this block is
   * the one place that exercises the opposite shape, and the one place that
   * proves the two do not leak into each other.
   *
   * `expectSession: false` is `settleChapter`'s own opt-out (see its doc
   * comment) — waiting for `#rail-tab-notes` would time out here on purpose,
   * since it must never appear for an anonymous reader.
   */
  // =========================================================================
  // B (review tổng nhánh Pha 2) — courseSlug phải TỚI ĐƯỢC dây
  // =========================================================================
  //
  // ĐO ĐƯỢC TRƯỚC VÒNG SỬA NÀY: `ChapterView.tsx` render `<AskPanel heading
  // system onClose>` và `<DeepDive courseTitle chapterTitle excerpt
  // onClose>` — KHÔNG truyền `courseSlug` ở cả hai chỗ. Prop tồn tại suốt
  // chuỗi (DeepDive → AskPanel → useAI, mặc định `''`), nên mọi lượt hỏi
  // của mọi người học gửi `course_slug: ""`. Phía máy chủ, `agent.go`'s
  // `if isValidCourseSlug(t.CourseSlug)` là một NHÁNH CHẾT trong sản xuất,
  // và `read_course` khai `"required":["slug"]` mà không có tool nào liệt
  // kê course — nên model không có nguồn nào để biết một slug hợp lệ. Tính
  // năng chủ lực của cả pha, bật MẶC ĐỊNH (`0007` seed
  // `tools_enabled = '{read_course}'`) và hiện trong màn cài đặt như đang
  // chạy, chưa từng được nối dây.
  //
  // Hai bài dưới đây kiểm ĐÚNG một điều mỗi bài, ở đúng cái ranh giới mà
  // không bài nào trong `AskPanel.test.tsx`/`DeepDive.test.tsx` nhìn thấy
  // được: hai tệp ấy TRUYỀN `courseSlug` vào component rồi kiểm nó đi ra
  // dây — chúng xanh suốt trong khi `ChapterView` (nơi DUY NHẤT thật sự
  // biết slug) không truyền gì cả. Đây là hình dạng "không ai sở hữu mối
  // nối" mà cả vòng review này nói về.
  describe('courseSlug tới được /ai/chat (B)', () => {
    /**
     * Chặn POST /ai/chat (trả một stream SSE rỗng đã đóng sẵn) VÀ phục vụ
     * chương của một course có slug KHÁC 'demo'.
     *
     * Slug riêng không phải để cho đẹp: với `courseId = 'demo'` thì chuỗi
     * 'demo' cũng nằm trong `courseTitle` ("Khóa học demo") và trong URL,
     * nên một khẳng định `toBe('demo')` không loại trừ được việc ai đó nối
     * nhầm biến. Một slug chỉ tồn tại ở ĐÚNG MỘT prop thì loại trừ được.
     */
    function captureChat(courseId: string): { bodies: { question: string; course_slug: string }[] } {
      const bodies: { question: string; course_slug: string }[] = [];
      server.use(
        http.get(`/courses/${courseId}/chapters/c1`, () =>
          HttpResponse.json({ html: FRAGMENT, widgets: WIDGETS }),
        ),
        http.get(`/courses/${courseId}/chapters/c2`, () =>
          HttpResponse.json({ html: CHAPTER_2_HTML, widgets: [] }),
        ),
        http.post('/ai/chat', async ({ request }) => {
          bodies.push((await request.json()) as { question: string; course_slug: string });
          const encoder = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
              c.close();
            },
          });
          return new HttpResponse(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }),
      );
      return { bodies };
    }

    it('nút "Hỏi AI về chương này" gửi course_slug = courseId của chương đang đọc', async () => {
      const { bodies } = captureChat('so-dau-phay-dong');
      await renderChapterAndSettle({ courseId: 'so-dau-phay-dong' });

      await act(async () => {
        screen.getByRole('button', { name: t('vi', 'reader.askAi') }).click();
      });
      const box = await screen.findByRole('textbox');
      fireEvent.change(box, { target: { value: 'Số mũ lệch là gì?' } });
      await act(async () => {
        screen.getByRole('button', { name: 'Hỏi' }).click();
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(bodies).toHaveLength(1);
      // KHÔNG `toBeTruthy()` / `not.toBe('')`: giá trị phải là ĐÚNG slug của
      // course đang mở, nếu không thì một dây nối nhầm biến (courseTitle,
      // chapter.id) vẫn đi qua.
      expect(bodies[0].course_slug).toBe('so-dau-phay-dong');
    });

    it('"Đào sâu" trên một đoạn bôi đen cũng gửi course_slug', async () => {
      const { bodies } = captureChat('bat-bien-vong-lap');
      await renderChapterAndSettle({ courseId: 'bat-bien-vong-lap' });

      await selectAndOpenToolbar('Nội dung A');
      // DeepDive hỏi NGAY khi mở (`autoAsk`), nên không cần gõ gì.
      await act(async () => {
        screen.getByRole('button', { name: t('vi', 'ann.deepDive') }).click();
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(bodies).toHaveLength(1);
      expect(bodies[0].course_slug).toBe('bat-bien-vong-lap');
    });
  });

  describe('Task 12 — đọc công khai, gate ẩn danh', () => {
    it('an anonymous reader (GET /me → 401) sees the chapter and the nudge, and none of the session-only UI', async () => {
      server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));

      await renderChapterAndSettle({}, { expectSession: false });

      // The chapter itself is exactly as public as it always was.
      expect(screen.getByText('Nội dung A')).toBeInTheDocument();
      expect(renderKatex).toHaveBeenCalledTimes(1);

      // The nudge — once, quietly, in the reader's own language.
      expect(screen.getByText(t('vi', 'reader.anonNudge'))).toBeInTheDocument();

      // Nothing that WRITES is on the page: annotations, progress, exercises.
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument(); // <SelectionToolbar>
      expect(document.getElementById('rail-tab-notes')).toBeNull(); // notes toggle + count
      expect(document.querySelectorAll('.box.ex .box-h input[type="checkbox"]')).toHaveLength(0);
      expect(document.getElementById('mark-btn')!.hidden).toBe(true);

      // Selecting text — the one gesture that used to summon the toolbar —
      // truly does nothing now, not just "nothing appeared yet".
      selectInChapter('Nội dung A');
      await act(async () => {});
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();

      // And nothing reached the server — Task 6/7, Pha 3: `useProgress`/
      // `useAnnotations` no longer write to Dexie at all, so the meaningful
      // check is the server-facing state these mocks stand in for.
      expect(progressRows).toHaveLength(0);
      expect(annotationRows).toHaveLength(0);
    });

    it('a signed-in reader sees no nudge, alongside the full session UI', async () => {
      await renderChapterAndSettle();

      expect(screen.queryByText(t('vi', 'reader.anonNudge'))).not.toBeInTheDocument();
      expect(document.getElementById('rail-tab-notes')).not.toBeNull();
      expect(document.getElementById('mark-btn')!.hidden).toBe(false);
      expect(document.querySelectorAll('.box.ex .box-h input[type="checkbox"]')).toHaveLength(2);
    });

    /**
     * Rà soát toàn nhánh, bước 5 — CHỖ THỨ NĂM, đo trên chính component
     * thật.
     *
     * `AuthedReaderExtras` mang cả `useAnnotations` (POST/PATCH/DELETE
     * /annotations) lẫn `useProgress` (PUT /progress), và nó dựng trên
     * route CÔNG KHAI `/c/:courseId/:chapterId` — ngoài `<RequireAuth>`,
     * tức ngoài người đọc duy nhất của `sessionWasSuperseded()` trước vòng
     * sửa này. Với `useMe` còn cache là A, một tab nền vẫn vẽ cây của A và
     * mọi cú ghi của nó đi dưới cookie của B: một ghi chú A gõ rồi lưu sau
     * lúc bàn giao được INSERT vào tài khoản B, nguyên văn.
     *
     * Bài này KHÔNG dựng lại cổng ấy bằng một bản sao — nó dùng đúng
     * `<ChapterView>` thật, với đúng dòng `me.isSuccess && me.data != null`
     * mà production chạy. Cổng nay nằm trong `useMe()` (một nơi hỏi, mọi
     * nơi thừa hưởng), nên đây là chỗ chứng minh nó thật sự tới được tới
     * lớp ghi.
     *
     * Tab kia là một ĐỒ THỊ MODULE RIÊNG: `BroadcastChannel` không trả
     * thông điệp về cho chính object đã gửi, nên `announceSessionUser` gọi
     * trong cùng một module sẽ không bao giờ đo được điều nó định đo.
     */
    it('một tab khác chiếm phiên ⇒ lớp GHI của trang đọc biến mất, và không cú ghi nào của A tới máy chủ', async () => {
      await renderChapterAndSettle();

      // Đối chứng dương TRƯỚC: lớp ghi đang thật sự đứng đó.
      expect(document.getElementById('rail-tab-notes')).not.toBeNull();
      expect(document.getElementById('mark-btn')!.hidden).toBe(false);
      expect(document.querySelectorAll('.box.ex .box-h input[type="checkbox"]')).toHaveLength(2);

      // Tab 1: A đăng xuất (`clearSession()` công bố `null`), B đăng nhập.
      vi.resetModules();
      const tab1 = await import('../auth/sessionIdentity');
      tab1.announceSessionUser(null);
      tab1.announceSessionUser('u-b');
      await waitFor(() => expect(sessionWasSuperseded()).toBe(true));

      // Mọi thứ GHI do React dựng đã rời khỏi trang — cùng danh sách mà
      // bài "khách ẩn danh" ngay trên kiểm, vì đó chính xác là hình dạng
      // đúng: tab này không còn là một phiên đã xác nhận nữa.
      await waitFor(() => expect(document.getElementById('rail-tab-notes')).toBeNull());
      expect(document.getElementById('mark-btn')!.hidden).toBe(true);

      // CÁC Ô BÀI TẬP CŨNG PHẢI BIẾN MẤT, và đây là nửa mà bản sửa "một nơi
      // hỏi, mọi nơi thừa hưởng" KHÔNG tự lo được. Chúng là DOM mệnh lệnh
      // tiêm vào fragment của chương, mang một listener `change` đóng gói
      // `progress.toggleEx` — tức một `PUT /progress` sống. Tháo
      // `AuthedReaderExtras` ra không gỡ chúng đi, vì chúng không thuộc cây
      // React. Bản đầu của bài kiểm này bấm vào một ô còn sót và NHẬN ĐƯỢC
      // một hàng tiến độ — nên `injectExerciseCheckboxes.ts` nay có
      // `removeExerciseCheckboxes`, gọi từ một cleanup lúc unmount.
      const leftoverCheckbox = document.querySelector('.box.ex .box-h input[type="checkbox"]');
      expect(leftoverCheckbox).toBeNull();

      // Các cử chỉ ghi thật sự không làm gì nữa: bôi đen không gọi được
      // thanh công cụ, bấm `#mark-btn` không sinh ra hàng nào phía máy chủ.
      selectInChapter('Nội dung A');
      await act(async () => {});
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();

      fireEvent.click(document.getElementById('mark-btn')!);
      await act(async () => {});
      expect(progressRows).toHaveLength(0);
      expect(annotationRows).toHaveLength(0);
    });

    /**
     * Nửa còn lại, và là nửa dễ làm hỏng nhất khi vá loại lỗi này: một tab
     * bị thay phiên phải trở lại BÌNH THƯỜNG ngay khi nó tự biết mình là
     * ai — không phải một cái khoá đến hết đời tab.
     */
    it('và khi tab này tự hỏi lại rồi biết mình là B, lớp ghi trở lại đầy đủ', async () => {
      await renderChapterAndSettle();

      vi.resetModules();
      const tab1 = await import('../auth/sessionIdentity');
      tab1.announceSessionUser(null);
      await waitFor(() => expect(sessionWasSuperseded()).toBe(true));
      await waitFor(() => expect(document.getElementById('rail-tab-notes')).toBeNull());

      // Tab này tự xác lập danh tính mới — đúng thứ `api/useMe.ts` làm khi
      // `GET /me` của chính nó trả lời.
      announceSessionUser('u-b');

      await waitFor(() => expect(document.getElementById('rail-tab-notes')).not.toBeNull());
      expect(document.getElementById('mark-btn')!.hidden).toBe(false);
    });

    it('does not show the nudge while GET /me is still pending — a flash aimed at a signed-in reader is worse than a late nudge', async () => {
      let resolveMe: (() => void) | undefined;
      server.use(
        http.get('/me', async () => {
          await new Promise<void>((resolve) => {
            resolveMe = resolve;
          });
          return HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'Người học' });
        }),
      );

      renderChapterView();

      // The chapter itself never waits on `/me` — it settles on its own.
      await waitFor(() => expect(renderKatex).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(t('vi', 'reader.anonNudge'))).not.toBeInTheDocument();

      resolveMe!();
      await settleChapter();
      expect(screen.queryByText(t('vi', 'reader.anonNudge'))).not.toBeInTheDocument();
    });
  });

  /**
   * Task 6 (ghi-danh-khoa-hoc) — người đọc tới THẲNG một chương qua liên kết
   * chia sẻ, chưa từng ghé `/c/:courseId` (nơi Task 5 đã có "Bắt đầu
   * học"/"Bỏ khỏi khoá của tôi"), cần một cách để thêm khoá vào "Học tiếp"
   * mà không phải tự rời chương đi tìm trang khoá. `reader.addToMine`
   * đứng đúng chỗ `reader.anonNudge` (Task 12) đứng — xem đó cho nudge ẩn
   * danh, đây là nửa còn lại cho người ĐÃ đăng nhập.
   *
   * Bốn bài canh đúng bốn điều brief đòi, trên REQUEST/response thật (method
   * + path + body), không chỉ trên "nút có mặt": đã đăng nhập + chưa ghi
   * danh ⇒ hiện; đã ghi danh ⇒ KHÔNG hiện (nút hết nghĩa); chưa đăng nhập ⇒
   * không hiện (họ có nudge riêng — hai lời mời chồng nhau là một lời mời bị
   * bỏ qua); bấm ⇒ đúng `POST /enrollments {courseId}` của khoá đang đọc.
   */
  describe('Task 6 — lối ghi danh cho người vào thẳng', () => {
    it('đã đăng nhập, chưa ghi danh khoá này ⇒ hiện "Thêm vào khoá của tôi"', async () => {
      server.use(http.get('/enrollments', () => HttpResponse.json({ enrollments: [] })));

      await renderChapterAndSettle();

      expect(screen.getByRole('button', { name: t('vi', 'reader.addToMine') })).toBeInTheDocument();
    });

    it('đã ghi danh khoá này ⇒ KHÔNG hiện nút, vì nó không còn nghĩa gì', async () => {
      server.use(
        http.get('/enrollments', () =>
          HttpResponse.json({ enrollments: [{ courseId: 'demo', createdAt: '2026-09-03T00:00:00Z' }] }),
        ),
      );

      await renderChapterAndSettle();

      expect(screen.queryByRole('button', { name: t('vi', 'reader.addToMine') })).not.toBeInTheDocument();
    });

    it('khách CHƯA đăng nhập ⇒ không hiện nút — họ đã có reader.anonNudge riêng một dòng bên cạnh', async () => {
      server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));

      await renderChapterAndSettle({}, { expectSession: false });

      // Đối chứng dương: nudge của khách vẫn đứng đó — hai lời mời không
      // cùng lúc biến mất cả hai vì một điều kiện sai.
      expect(screen.getByText(t('vi', 'reader.anonNudge'))).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: t('vi', 'reader.addToMine') })).not.toBeInTheDocument();
    });

    it('bấm nút gửi đúng POST /enrollments {courseId} của khoá đang đọc', async () => {
      server.use(http.get('/enrollments', () => HttpResponse.json({ enrollments: [] })));
      const posted: unknown[] = [];
      server.use(
        http.post('/enrollments', async ({ request }) => {
          posted.push(await request.json());
          return new HttpResponse(null, { status: 201 });
        }),
      );

      await renderChapterAndSettle();

      const btn = screen.getByRole('button', { name: t('vi', 'reader.addToMine') });
      fireEvent.click(btn);
      await act(async () => {});

      // REQUEST thật gửi ra, không chỉ "nút bấm được": đúng method (POST,
      // qua `http.post`), đúng thân ({courseId: 'demo'} — của khoá `demo`
      // đang mở trong `renderChapterView`, không phải chuỗi rỗng hay
      // `undefined` lọt qua `enabled`/prop).
      expect(posted).toEqual([{ courseId: 'demo' }]);
    });

    /**
     * Fix round 1 — `enrolled` reads `(enrollmentsQuery.data ?? []).some(...)`,
     * which is `false` while that query is still pending, not just once it
     * has resolved to "not enrolled". A gate of `confirmedLoggedIn &&
     * !enrolled` alone therefore cannot tell "confirmed not enrolled" apart
     * from "don't know yet" — it shows the button on the SECOND shape too, for
     * exactly as long as `GET /enrollments` takes to answer, then yanks it
     * away the instant the real (enrolled) answer lands. The four tests above
     * cannot catch this: `renderChapterAndSettle` always awaits full
     * settlement, so by the time any of them assert, `/enrollments` has
     * already resolved.
     *
     * This is the identical mistake the file's own doc comment on
     * `confirmedLoggedIn`/`confirmedLoggedOut` (see `ChapterView`'s top)
     * already forbids on the LOGIN axis — never render off a guess about
     * server-confirmed state — just not yet applied to the enrollment axis.
     */
    it('đã ghi danh khoá này: không được thấy nút trong lúc GET /enrollments còn treo — đoán sai còn tệ hơn chậm', async () => {
      let resolveEnrollments: (() => void) | undefined;
      server.use(
        http.get('/enrollments', async () => {
          await new Promise<void>((resolve) => {
            resolveEnrollments = resolve;
          });
          return HttpResponse.json({
            enrollments: [{ courseId: 'demo', createdAt: '2026-09-03T00:00:00Z' }],
          });
        }),
      );

      await renderChapterAndSettle();

      // Còn treo: chưa có gì XÁC NHẬN "chưa ghi danh", nên nút không được đoán.
      expect(screen.queryByRole('button', { name: t('vi', 'reader.addToMine') })).not.toBeInTheDocument();

      resolveEnrollments!();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      // Đáp án thật là "đã ghi danh" — nút vẫn phải vắng mặt, không phải
      // "vắng mặt rồi hiện ra rồi biến mất lại".
      expect(screen.queryByRole('button', { name: t('vi', 'reader.addToMine') })).not.toBeInTheDocument();
    });

    /**
     * Fix round 1 — `enroll` only had `onSuccess` before this round; nothing
     * read `enroll.isError`, so a failed `POST /enrollments` left the button
     * exactly where it was with nothing telling the reader it did not go
     * through. Same failure surface Task 5 shipped for `CourseHome.tsx`'s own
     * enroll button (`role="alert"`, `.lib-notice-server`), and the same
     * `useMutation` self-clearing-on-retry contract already proven for
     * `progress.saveError`/`annotations.saveError` in `AuthedReaderExtras`
     * below.
     */
    it('Fix round 1 — POST /enrollments trả 500: hiện thông báo lỗi tại chỗ; bấm lại và thành công thì thông báo biến mất', async () => {
      server.use(http.get('/enrollments', () => HttpResponse.json({ enrollments: [] })));
      let shouldFail = true;
      server.use(
        http.post('/enrollments', () => {
          if (shouldFail) return new HttpResponse(null, { status: 500 });
          return new HttpResponse(null, { status: 201 });
        }),
      );

      await renderChapterAndSettle();

      const btn = screen.getByRole('button', { name: t('vi', 'reader.addToMine') });
      fireEvent.click(btn);

      // Một request hỏng KHÔNG được lặng lẽ biến mất: nút vẫn đứng đó (còn
      // "Thêm vào khoá của tôi" — request thật sự hỏng, không lỡ coi như đã
      // ghi danh), và `role="alert"` phải hiện đúng câu.
      expect(await screen.findByRole('alert')).toHaveTextContent(t('vi', 'reader.addToMineFailed'));
      expect(screen.getByRole('button', { name: t('vi', 'reader.addToMine') })).toBeInTheDocument();

      // Bấm lại — lần này server trả 201 — thông báo cũ phải biến mất, không
      // kẹt lại dưới một nút giờ đã hoạt động.
      shouldFail = false;
      fireEvent.click(screen.getByRole('button', { name: t('vi', 'reader.addToMine') }));

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
  });
});
