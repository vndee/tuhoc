/**
 * Tests for the selection toolbar (P2 Task 5) — the first piece of the
 * annotation engine a reader touches.
 *
 * Four properties here are worth more than the rest, because each of them is a
 * failure that stays GREEN under the obvious test:
 *
 *   1. **Two notes in a row.** Painting the first note invalidates every
 *      `NormMap` taken before it (ruling P2-F8), and "highlight something, then
 *      highlight something else" is this feature's most ordinary path — not a
 *      corner. A toolbar that caches its map, and a store that caches its own,
 *      both stay green on a one-note test and throw `StaleNormMapError` on the
 *      second. The "hai ghi chú liên tiếp" tests below are the ones that fail
 *      against the wrong code, in both the non-overlapping and the overlapping
 *      shape.
 *   2. **The colour appears before the save finishes.** `create` here is left
 *      PENDING on purpose: a toolbar that awaits the write before painting
 *      passes every test that only checks the end state.
 *   3. **Ordinary selection still works.** Readers select to copy at least as
 *      often as to annotate. Focus must not move, `Ctrl/Cmd+C` must not be
 *      swallowed, and a click outside must close the toolbar without writing
 *      anything.
 *   4. **The chapter content can be replaced under a cached map.**
 *      `isMapStale` is documented to detect a CHANGED node, not a DETACHED one
 *      — so a cache keyed on staleness alone survives a chapter swap whose
 *      replacement text happens to have the same length, and anchors the
 *      reader's next note against text that is no longer on the page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnnotation, deleteAnnotation, fetchAnnotations, patchAnnotation } from '../api/annotations';
import { readSampleCourseFile, SAMPLE_CHAPTER } from '../test/sampleCourse';
import { type Anchor, type AnchorColor, selectionToAnchor } from './anchor';
import { flatToDom, normalizeContainer } from './normalize';
import { highlightElements } from './painter';
import {
  PENDING_ID_PREFIX,
  SelectionToolbar,
  type ToolbarSpot,
  type ToolbarStore,
  toolbarSpot,
} from './SelectionToolbar';
import { type Ann, type ChapterContent, type UseAnnotationsResult, useAnnotations } from './useAnnotations';
import { LanguageProvider } from '../i18n/LanguageProvider';

// Task 7, Pha 3: `useAnnotations` reads/writes the server through
// `../api/annotations` now, not Dexie — and `Harness`/`RealChapterHarness`
// below call the REAL hook unconditionally (even the tests that pass a
// `stubStore` for the toolbar itself still mount it, to keep `hook.api`
// populated for the sections that read it). So every test in this file needs
// a working fake of that module, the same shape
// `useAnnotations.test.tsx`/`progress/useProgress.test.ts` already use.
vi.mock('../api/annotations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/annotations')>();
  return {
    ...actual,
    fetchAnnotations: vi.fn(),
    createAnnotation: vi.fn(),
    patchAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
  };
});

const CHAPTER = [
  '<h2>Entropy</h2>',
  '<p id="p1">Entropy đo lượng thông tin trung bình mà một nguồn tin sinh ra.</p>',
  '<p id="p2">Độ dài mã tối ưu không thể ngắn hơn entropy của nguồn tin đó.</p>',
  '<p id="p3">Kênh nhiễu làm giảm dung lượng truyền tin của toàn hệ thống.</p>',
  '<div class="fig-body"><div data-viz="aep"><div class="ctrls"><label>tốc độ mô phỏng</label></div></div></div>',
  '<details open><summary>Chứng minh</summary><p id="p4">Ta xét biến ngẫu nhiên rời rạc.</p></details>',
].join('\n');

const Q1 = 'lượng thông tin trung bình';
const Q2 = 'dung lượng truyền tin';
const Q3 = 'biến ngẫu nhiên rời rạc';
/** Overlaps Q1 on its left half — the "highlight over my own highlight" path. */
const Q1_OVERLAP = 'Entropy đo lượng thông tin';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** The hook result captured out of the store harness, so a test body can read
 * `list`/`orphans` after acting. Same holder shape `useAnnotations.test.tsx`
 * uses. */
const hook = { api: null as unknown as UseAnnotationsResult };

/** A fresh cache per test, and the fake "server" `fetchAnnotations`/
 * `createAnnotation`/`patchAnnotation`/`deleteAnnotation` read from and write
 * to — the same shape `useAnnotations.test.tsx`'s own `queryClient`/
 * `serverRows` use, and the reason is identical: `onSettled` refetches after
 * every real write the "kho ghi chú thật" section below makes. */
let queryClient: QueryClient;
let serverRows: Ann[];

function stubStore(create: ToolbarStore['create']): ToolbarStore {
  return { create, list: [], orphans: [] };
}

/** A stored row, the shape `useAnnotations` publishes in `list`/`orphans`.
 * Only the `id` matters to the toolbar — that is the whole contract between
 * the two: "the store has reached a verdict about this id". */
function annRow(id: string): Ann {
  return {
    id,
    courseId: 'c1',
    chapterId: 'ch1',
    anchor: { exact: Q1, prefix: '', suffix: '', color: 'y' },
    note: '',
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
  };
}

/**
 * Renders a chapter the way `ChapterView` does — `innerHTML` into a `<div>`
 * React never gives children to, then a `revision` bump — and mounts the
 * toolbar over it.
 *
 * Split into two components — `StubHarness`/`LiveHarness` — rather than one
 * component that conditionally uses a stub or the real `useAnnotations`
 * result, for a reason that is about ASYNC NOISE, not the Rules of Hooks: a
 * `useAnnotations` instance fetches through `../api/annotations` on mount
 * regardless of whether anything ends up reading its `list`/`orphans` (the
 * resolve/paint effect is what is gated on `content.root`, not the query
 * itself). A `stubStore` test never reads that instance's result at all — the
 * old single-`Harness` version called it anyway, purely to keep `hook.api`
 * populated for the tests that DO want it — and that spare, unread fetch
 * turned out not to be free: jsdom fires its OWN 'selectionchange' for a
 * programmatic selection change asynchronously, on a later task (documented
 * on `selectSilently` below), independent of the one `select()` dispatches
 * synchronously. With the spare fetch's extra pending microtask in the mix,
 * that delayed native event was landing INSIDE the `Esc`-test's
 * `await act(async () => { dispatch Escape })` window often enough to reopen
 * the toolbar it had just closed (still seeing the same live selection) —
 * reproduced directly: 8/10 runs red with the spare `useAnnotations` call in
 * place, 0/10 without it, 10/10 green before Task 7 (Pha 3) gave this hook a
 * query to run in the first place. Splitting the harness removes the spare
 * fetch for every `stubStore` test — the actual bug this traces to is a
 * pre-existing jsdom timing hazard in `SelectionToolbar.tsx` this task's
 * brief forbids touching, not something wrong with the toolbar's Esc
 * handling itself.
 */
function StubHarness({
  html,
  store,
  onRequestNote,
}: {
  html: string;
  store: ToolbarStore;
  onRequestNote?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<ChapterContent>({ root: null, revision: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    setContent((prev) => ({ root: el, revision: prev.revision + 1 }));
  }, [html]);
  return (
    <>
      <div ref={ref} data-testid="chapter" />
      <p data-testid="outside">Ngoài chương: chân trang</p>
      <LanguageProvider>
        <SelectionToolbar content={content} store={store} onRequestNote={onRequestNote} />
      </LanguageProvider>
    </>
  );
}

/** The real `useAnnotations` result — for the "kho ghi chú thật" section,
 * where the paint/handover integration is exercised for real, against the
 * mocked `../api/annotations` this file's `beforeEach` wires up. */
function LiveHarness({ html, onRequestNote }: { html: string; onRequestNote?: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<ChapterContent>({ root: null, revision: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    setContent((prev) => ({ root: el, revision: prev.revision + 1 }));
  }, [html]);
  const live = useAnnotations('c1', 'ch1', content);
  hook.api = live;
  return (
    <>
      <div ref={ref} data-testid="chapter" />
      <p data-testid="outside">Ngoài chương: chân trang</p>
      <LanguageProvider>
        <SelectionToolbar content={content} store={live} onRequestNote={onRequestNote} />
      </LanguageProvider>
    </>
  );
}

function Harness({
  html,
  store,
  onRequestNote,
}: {
  html: string;
  store?: ToolbarStore;
  onRequestNote?: (id: string) => void;
}) {
  return store ? (
    <StubHarness html={html} store={store} onRequestNote={onRequestNote} />
  ) : (
    <LiveHarness html={html} onRequestNote={onRequestNote} />
  );
}

/** Every render needs a `QueryClientProvider` — `LiveHarness` calls the real
 * `useAnnotations`, and `StubHarness` costs nothing extra by also having one
 * in its (unused) tree. Wrapped ONE level above `Harness` rather than at each
 * of this file's ~25 `render(<HarnessRoot .../>)`/`rerender(...)` call sites.
 * `rerender` reuses this same outer element (same type, same position in the
 * tree), so the `queryClient` a test set up in `beforeEach` stays the one in
 * effect across a `rerender` too. */
function HarnessRoot(props: Parameters<typeof Harness>[0]) {
  return (
    <QueryClientProvider client={queryClient}>
      <Harness {...props} />
    </QueryClientProvider>
  );
}

function chapterRoot(): HTMLElement {
  return screen.getByTestId('chapter');
}

/** The `Range` covering `quote`, matched in the chapter's flat text so it
 * keeps working after painting has split text nodes. */
function rangeFor(quote: string, root: HTMLElement = chapterRoot()): Range {
  const map = normalizeContainer(root);
  const at = map.flat.indexOf(quote);
  if (at < 0) throw new Error(`select: ${JSON.stringify(quote)} not in the chapter`);
  const range = flatToDom(map, at, at + quote.length);
  if (!range) throw new Error(`select: no range for ${JSON.stringify(quote)}`);
  return range;
}

/** Selects `quote` and fires `selectionchange` — the one event both mouse
 * drags and Shift+Arrow produce. jsdom does fire one of its own for a
 * programmatic selection change, but only on a LATER task (measured; see
 * `selectSilently`), which is no use to a test that wants to assert on the
 * next line. Dispatching it here, inside `act`, is what makes the moment the
 * component hears about the selection a moment the test controls. */
function select(quote: string, root: HTMLElement = chapterRoot()): Range {
  const range = rangeFor(quote, root);
  applySelection(range);
  return range;
}

/**
 * Moves the browser's selection to `quote` and returns BEFORE the component
 * has been told, so its stored `lastRangeRef` and the live selection disagree.
 *
 * That disagreement is the whole subject of `createFrom`'s
 * `selectionRange(root) ?? lastRangeRef.current`. In a browser it is opened by
 * a DOM change rather than by a move: the store's deferred pass paints an
 * overlapping note between the last `selectionchange` and the click, and per
 * the DOM's own remove steps the STORED `Range` is pushed off the text it
 * described while the browser's own answer stays right. Reproducing that
 * particular mutation faithfully in jsdom would be testing jsdom's live-range
 * fidelity rather than this component; moving the selection leaves the
 * component in the same position with nothing else changed.
 *
 * No `selectionchange` is dispatched here — but note that jsdom fires one
 * BY ITSELF, asynchronously (measured: nothing during the synchronous block,
 * the event arrives on a later task). So the window this helper opens is real
 * but short, and a caller has to act inside it: `fireEvent.click`, never
 * `await user.click`, whose first await lets jsdom's queued event through and
 * puts the two back in agreement.
 */
function selectSilently(quote: string, root: HTMLElement = chapterRoot()): Range {
  const range = rangeFor(quote, root);
  const selection = window.getSelection();
  if (!selection) throw new Error('no Selection in this environment');
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

function applySelection(range: Range | null): void {
  const selection = window.getSelection();
  if (!selection) throw new Error('no Selection in this environment');
  act(() => {
    selection.removeAllRanges();
    if (range) selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

function clearSelection(): void {
  applySelection(null);
}

function toolbar(): HTMLElement | null {
  return screen.queryByRole('toolbar');
}

function marks(root: HTMLElement = chapterRoot()): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('mark.ann'));
}

/** The optimistic layer only: marks still carrying a `pending-` id, i.e. ones
 * whose handover to the store has not happened. */
function pendingMarks(root: HTMLElement = chapterRoot()): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`mark.ann[data-ann-id^="${PENDING_ID_PREFIX}"]`));
}

/** What a painted annotation now covers, in the same (collapsed projection)
 * space its `Anchor.exact` is stored in — the comparison `painter.test.ts`
 * uses, for the same reason: raw `textContent` and `exact` are different
 * spaces and comparing them directly is an oracle bug, not a finding. */
function paintedQuote(root: HTMLElement, id: string): string | null {
  const els = highlightElements(id, root);
  if (els.length === 0) return null;
  const range = document.createRange();
  range.setStartBefore(els[0]);
  range.setEndAfter(els[els.length - 1]);
  return selectionToAnchor(normalizeContainer(root), range, 'y')?.exact ?? null;
}

/** How many `<mark>` layers deep the text of `id` is wrapped. Two layers of the
 * SAME id is the double-paint bug the temp-id handover exists to avoid: it
 * reads as a darker highlight and nothing throws. */
function layersOf(root: HTMLElement, id: string): number {
  const els = highlightElements(id, root);
  let deepest = 0;
  for (const el of els) {
    let depth = 0;
    for (let node: Element | null = el; node && node !== root; node = node.parentElement) {
      if (node.matches(`mark.ann[data-ann-id="${id}"]`)) depth++;
    }
    if (depth > deepest) deepest = depth;
  }
  return deepest;
}

/** A row that cannot possibly be found in the fixture chapter, put straight
 * into `serverRows` the way a row from another device already sitting on the
 * server would arrive via `GET /annotations`. Empty context on purpose:
 * `fuzzyFind` needs a prefix or suffix occurrence to have anywhere to look,
 * so this settles as an orphan without spending the fuzzy tier. */
function seedOrphan(): void {
  serverRows.push({
    id: 'orphan-1',
    courseId: 'c1',
    chapterId: 'ch1',
    anchor: { exact: 'định lý mã hoá kênh nhiễu của Shannon', prefix: '', suffix: '', color: 'y' },
    note: 'ghi chú cũ',
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
  });
}

const user = userEvent.setup();

async function clickColour(name: RegExp | string): Promise<void> {
  await user.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  serverRows = [];
  vi.mocked(fetchAnnotations)
    .mockReset()
    .mockImplementation(async (courseId) =>
      serverRows.filter((row) => courseId === undefined || row.courseId === courseId).map((row) => ({ ...row })),
    );
  vi.mocked(createAnnotation)
    .mockReset()
    .mockImplementation(async (row) => {
      const at = new Date().toISOString();
      serverRows.push({ ...(row as Ann), createdAt: at, updatedAt: at });
    });
  vi.mocked(patchAnnotation)
    .mockReset()
    .mockImplementation(async (id, patch) => {
      const idx = serverRows.findIndex((row) => row.id === id);
      if (idx === -1) return;
      serverRows[idx] = { ...serverRows[idx], ...patch, updatedAt: new Date().toISOString() };
    });
  vi.mocked(deleteAnnotation)
    .mockReset()
    .mockImplementation(async (id) => {
      serverRows = serverRows.filter((row) => row.id !== id);
    });
});

afterEach(() => {
  clearSelection();
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. Showing and hiding
// ===========================================================================

describe('hiện/ẩn theo vùng chọn', () => {
  it('bôi chọn văn xuôi trong chương → toolbar nổi lên với 4 nút màu + nút Ghi chú', async () => {
    render(<HarnessRoot html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());

    select(Q1);

    const bar = toolbar();
    expect(bar).not.toBeNull();
    const buttons = Array.from(bar!.querySelectorAll('button'));
    expect(buttons).toHaveLength(5);
    // Every control has a readable name — a swatch with no name is a button a
    // screen reader announces as "button".
    for (const button of buttons) {
      const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
      expect(name.trim().length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('button', { name: /ghi chú/i })).toBeInTheDocument();
    // Reachable by keyboard: no `tabindex="-1"`, no `inert`.
    buttons[0].focus();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('một cú NHÁY chuột (selection rỗng) không hiện toolbar', async () => {
    render(<HarnessRoot html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());

    const paragraph = chapterRoot().querySelector('#p1')!;
    const caret = document.createRange();
    caret.setStart(paragraph.firstChild!, 5);
    caret.collapse(true);
    applySelection(caret);

    expect(toolbar()).toBeNull();
  });

  it('vùng chọn NGOÀI chương không hiện toolbar', async () => {
    render(<HarnessRoot html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());

    const outside = screen.getByTestId('outside');
    const range = document.createRange();
    range.setStart(outside.firstChild!, 0);
    range.setEnd(outside.firstChild!, 6);
    applySelection(range);

    expect(toolbar()).toBeNull();
  });

  it('vùng chọn kéo TỪ TRONG chương RA NGOÀI cũng không hiện toolbar (không đoán ý người đọc)', async () => {
    render(<HarnessRoot html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());

    const inside = chapterRoot().querySelector('#p1')!.firstChild!;
    const outside = screen.getByTestId('outside').firstChild!;
    const range = document.createRange();
    range.setStart(inside, 3);
    range.setEnd(outside, 6);
    applySelection(range);

    // Clamping the far edge back into the chapter would store a note over text
    // the reader never selected; `rangeToFlat` says `null` and so do we.
    expect(toolbar()).toBeNull();
  });

  it('vùng chọn nằm gọn trong một khối [data-viz] không hiện toolbar (không có gì để neo)', async () => {
    render(<HarnessRoot html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('[data-viz]')).not.toBeNull());

    const label = chapterRoot().querySelector('.ctrls label')!;
    const range = document.createRange();
    range.setStart(label.firstChild!, 0);
    range.setEnd(label.firstChild!, 5);
    applySelection(range);

    expect(toolbar()).toBeNull();
  });

  it('Esc đóng toolbar và KHÔNG tạo gì', async () => {
    const create = vi.fn();
    render(<HarnessRoot html={CHAPTER} store={stubStore(create)} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    select(Q1);
    expect(toolbar()).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(toolbar()).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(marks()).toHaveLength(0);
  });

  it('bấm ra ngoài đóng toolbar và KHÔNG tạo gì', async () => {
    const create = vi.fn();
    render(<HarnessRoot html={CHAPTER} store={stubStore(create)} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    select(Q1);
    expect(toolbar()).not.toBeNull();

    await user.click(screen.getByTestId('outside'));

    expect(toolbar()).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(marks()).toHaveLength(0);
  });

  it('bôi chọn bằng BÀN PHÍM (Shift+mũi tên) cũng mở toolbar — selectionchange, không phải mouseup', async () => {
    render(<HarnessRoot html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());

    // A keyboard selection produces no mouse event at all: only the selection
    // itself moves, and only `selectionchange` reports it.
    select(Q2);

    expect(toolbar()).not.toBeNull();
  });
});

// ===========================================================================
// 2. Ordinary selection must keep working
// ===========================================================================

describe('không phá thao tác chọn thông thường', () => {
  it('không cướp focus khi hiện lên', async () => {
    render(<HarnessRoot html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    const outside = screen.getByTestId('outside');
    outside.setAttribute('tabindex', '0');
    outside.focus();

    select(Q1);

    expect(toolbar()).not.toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it('mousedown trên toolbar bị preventDefault — vùng chọn của người đọc sống sót cú bấm', async () => {
    render(<HarnessRoot html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    select(Q1);

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    toolbar()!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('Ctrl+C / Cmd+C không bị chặn và toolbar vẫn giữ nguyên vùng chọn', async () => {
    render(<HarnessRoot html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    const range = select(Q1);

    const copy = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(copy);
    const copyMac = new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(copyMac);

    expect(copy.defaultPrevented).toBe(false);
    expect(copyMac.defaultPrevented).toBe(false);
    expect(toolbar()).not.toBeNull();
    expect(window.getSelection()!.toString()).toBe(range.toString());
  });
});

// ===========================================================================
// 3. Creating
// ===========================================================================

describe('luồng tạo ghi chú', () => {
  it('bấm màu → TÔ NGAY, trước khi việc lưu xong; create nhận đúng exact + màu', async () => {
    // Deliberately never resolves: a toolbar that awaits the write before it
    // paints fails here and passes every end-state test.
    let settle: ((id: string) => void) | undefined;
    const create = vi.fn(
      (_anchor: Anchor, _note: string) =>
        new Promise<string>((res) => {
          settle = res;
        }),
    );
    render(<HarnessRoot html={CHAPTER} store={stubStore(create)} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    select(Q1);

    await clickColour(/xanh lá/i);

    expect(create).toHaveBeenCalledTimes(1);
    const [anchor, note] = create.mock.calls[0];
    expect(anchor.exact).toBe(Q1);
    expect(anchor.color).toBe('g');
    expect(note).toBe('');
    // The colour is on the page while the write is still in flight.
    expect(marks().length).toBeGreaterThan(0);
    expect(marks()[0].textContent).toBe(Q1);
    expect(marks()[0].className).toContain('ann-g');
    // And the toolbar got out of the way, taking the browser's blue selection
    // with it — leaving it drawn on top of the fresh highlight would hide the
    // colour the reader just asked for.
    expect(toolbar()).toBeNull();
    expect(window.getSelection()!.toString()).toBe('');

    await act(async () => {
      settle?.('id-1');
    });
  });

  it('nút "Ghi chú" tạo ghi chú rồi báo cho chủ gọi mở ô nhập (thẻ lề là việc của Task 6)', async () => {
    // Typed parameters, so `create.mock.calls[0][0]` is the `Anchor` this test
    // reads and not `never`: a bare `vi.fn(async () => …)` type-checks in
    // vitest and fails `tsc -b`, which is the gate that counts (P2-F7).
    const create = vi.fn(async (_anchor: Anchor, _note: string) => 'note-id');
    const onRequestNote = vi.fn();
    render(<HarnessRoot html={CHAPTER} store={stubStore(create)} onRequestNote={onRequestNote} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    select(Q2);

    await clickColour(/ghi chú/i);

    await waitFor(() => expect(onRequestNote).toHaveBeenCalledWith('note-id'));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].exact).toBe(Q2);
    // ALWAYS yellow, in the stored anchor and on the page alike. `NOTE_COLOR`
    // is a design decision the component's own doc argues for ("a predictable
    // colour is worth more here than a clever one"), and until this line
    // nothing held it: swapping it for green left every test green too.
    expect(create.mock.calls[0][0].color).toBe('y');
    expect(marks().length).toBeGreaterThan(0);
    expect(marks()[0].className).toContain('ann-y');
  });

  it('lưu HỎNG → gỡ màu và báo lỗi cho người đọc', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const create = vi.fn(async () => {
      throw new Error('quota exceeded');
    });
    render(<HarnessRoot html={CHAPTER} store={stubStore(create)} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    select(Q1);

    await clickColour(/vàng/i);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(marks()).toHaveLength(0);
    expect(chapterRoot().querySelector('#p1')!.textContent).toBe(
      'Entropy đo lượng thông tin trung bình mà một nguồn tin sinh ra.',
    );
  });

  it('bấm màu neo theo vùng chọn ĐANG SỐNG, không theo bản Range đã lưu', async () => {
    // `createFrom` asks `selectionRange(root)` FIRST and only falls back to
    // `lastRangeRef.current`, and the component's own comment says why: "a
    // stored `Range` can be moved by a DOM change (the store's deferred pass
    // painting an overlapping note, say)". That is a WRONG-DATA path — pick
    // the wrong source and the note is anchored over words the reader never
    // selected, silently and permanently — and until this test it was held up
    // by nothing but that comment: reversing the two produced no failure
    // anywhere in the suite.
    const create = vi.fn(async (_anchor: Anchor, _note: string) => 'id-1');
    render(<HarnessRoot html={CHAPTER} store={stubStore(create)} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());

    select(Q1);
    expect(toolbar()).not.toBeNull();

    // The browser's answer moves on; the component's stored copy has not been
    // told yet. `fireEvent`, not `user.click`: the click has to land inside
    // that window, and userEvent's first `await` lets jsdom's own queued
    // `selectionchange` through, which would close it (see `selectSilently`).
    selectSilently(Q2);
    fireEvent.click(screen.getByRole('button', { name: /tô màu vàng/i }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0].exact).toBe(Q2);
    // …and the colour went on the words the anchor names, not on the stale ones.
    expect(marks()).toHaveLength(1);
    expect(marks()[0].textContent).toBe(Q2);
  });

  it('kho xếp ghi chú vừa tạo là MỒ CÔI: lớp tô tạm vẫn được gỡ, không để lại vệt pending-', async () => {
    // `settled` is the union of `list` AND `orphans`, and the union is the
    // whole point: an orphan is a verdict, not a pending state. Watch only
    // `list` and a note the store cannot re-anchor never settles — the
    // `pending-` layer then sits on the page for the rest of the reading
    // session, a highlight that looks real, has no note behind it, and
    // disappears on the next load. The path is ordinary, not exotic: the
    // chapter can change shape between the create and the store's resolve
    // pass (a `<details>` opened, a viz redrawn, an overlapping note painted),
    // and with 255 closed `<details class="deriv">` in this corpus it will.
    const create = vi.fn(async (_anchor: Anchor, _note: string) => 'real-1');
    const { rerender } = render(<HarnessRoot html={CHAPTER} store={{ create, list: [], orphans: [] }} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());

    select(Q1);
    await clickColour(/vàng/i);

    // The optimistic layer is on the page, under its temporary id, waiting.
    await waitFor(() => expect(pendingMarks()).toHaveLength(1));

    // The store's verdict lands — as an ORPHAN, so `real-1` will never appear
    // in `list` at all.
    rerender(<HarnessRoot html={CHAPTER} store={{ create, list: [], orphans: [annRow('real-1')] }} />);

    await waitFor(() => expect(pendingMarks()).toHaveLength(0));
    // Removing the layer put the chapter's text back exactly as it was —
    // `unpaint` unwraps and re-normalises rather than deleting.
    expect(chapterRoot().querySelector('#p1')!.textContent).toBe(
      'Entropy đo lượng thông tin trung bình mà một nguồn tin sinh ra.',
    );
  });
});

// ===========================================================================
// 4. The store, for real — where a stale NormMap bites
// ===========================================================================

describe('kho ghi chú thật (máy chủ giả lập qua api/annotations)', () => {
  it('HAI ghi chú liên tiếp: cả hai neo đúng chỗ, mỗi ghi chú đúng MỘT lớp mark', async () => {
    render(<HarnessRoot html={CHAPTER} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());

    select(Q1);
    await clickColour(/vàng/i);
    await waitFor(() => expect(hook.api.list).toHaveLength(1));

    // The second selection is made against a chapter whose DOM the first paint
    // has already cut up — the map taken for the first note is stale now.
    select(Q2);
    await clickColour(/xanh dương/i);
    await waitFor(() => expect(hook.api.list).toHaveLength(2));

    const root = chapterRoot();
    await waitFor(() => {
      for (const row of hook.api.list) expect(highlightElements(row.id, root).length).toBeGreaterThan(0);
    });
    const byQuote = new Map(hook.api.list.map((row) => [(row.anchor as Anchor).exact, row]));
    expect(Array.from(byQuote.keys()).sort()).toEqual([Q1, Q2].sort());
    for (const [quote, row] of byQuote) {
      expect(paintedQuote(root, row.id)).toBe(quote);
      expect(layersOf(root, row.id)).toBe(1);
    }
    // No temporary optimistic mark survived the handover.
    expect(root.querySelectorAll('mark.ann[data-ann-id^="pending-"]')).toHaveLength(0);
    expect(hook.api.orphans).toHaveLength(0);
    expect(serverRows).toHaveLength(2);
  });

  it('ghi chú thứ hai CHỒNG lên ghi chú thứ nhất vẫn đúng chỗ', async () => {
    render(<HarnessRoot html={CHAPTER} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());

    select(Q1);
    await clickColour(/vàng/i);
    await waitFor(() => expect(hook.api.list).toHaveLength(1));

    select(Q1_OVERLAP);
    await clickColour(/tím/i);
    await waitFor(() => expect(hook.api.list).toHaveLength(2));

    const root = chapterRoot();
    for (const row of hook.api.list) {
      expect(paintedQuote(root, row.id)).toBe((row.anchor as Anchor).exact);
      expect(layersOf(root, row.id)).toBe(1);
    }
    expect(new Set(hook.api.list.map((r) => (r.anchor as Anchor).exact))).toEqual(new Set([Q1, Q1_OVERLAP]));
    // The chapter's own text is untouched by two overlapping highlights.
    expect(root.querySelector('#p1')!.textContent).toBe(
      'Entropy đo lượng thông tin trung bình mà một nguồn tin sinh ra.',
    );
  });

  it('chương đang có ghi chú MỒ CÔI: tô một ghi chú mới không được làm nổ bản đồ của kho', async () => {
    // The shape that matters: an orphan is the one outcome that leaves
    // `useAnnotations` holding a freshly built `NormMap` it has no reason to
    // drop — it resolved something and painted nothing. The toolbar's own paint
    // then makes that map describe a tree that no longer exists, and the store
    // does not catch `StaleNormMapError` (deliberately — it is a caller bug, not
    // a lost note). With 255 closed `<details class="deriv">` in this corpus and
    // an orphan panel shipping in Task 7, "this chapter has an orphan in it" is
    // an ordinary Tuesday, not a corner.
    seedOrphan();
    render(<HarnessRoot html={CHAPTER} />);
    await waitFor(() => expect(hook.api.orphans).toHaveLength(1));

    select(Q1);
    await clickColour(/vàng/i);

    await waitFor(() => expect(hook.api.list).toHaveLength(1));
    const row = hook.api.list[0];
    expect((row.anchor as Anchor).exact).toBe(Q1);
    expect(paintedQuote(chapterRoot(), row.id)).toBe(Q1);
    expect(layersOf(chapterRoot(), row.id)).toBe(1);
    // The orphan is still an orphan, and still has its note.
    expect(hook.api.orphans.map((r) => r.note)).toEqual(['ghi chú cũ']);
  });

  it('ghi chú trong <details> đang mở neo đúng đoạn của nó', async () => {
    render(<HarnessRoot html={CHAPTER} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p4')).not.toBeNull());

    select(Q3);
    await clickColour(/xanh lá/i);
    await waitFor(() => expect(hook.api.list).toHaveLength(1));

    const root = chapterRoot();
    const row = hook.api.list[0];
    expect((row.anchor as Anchor).exact).toBe(Q3);
    expect(paintedQuote(root, row.id)).toBe(Q3);
    expect(root.querySelector('details')!.contains(highlightElements(row.id, root)[0])).toBe(true);
  });

  it('nội dung chương bị THAY: ghi chú tiếp theo neo vào nội dung MỚI, không vào bản đồ cũ', async () => {
    // Same byte length, different words: `isMapStale` is documented to detect a
    // node whose length changed, NOT one that was detached — so a map cache
    // keyed on staleness alone happily answers from the chapter that is gone.
    const OLD = '<p id="q">Con mèo đen ngồi im trên mái nhà cũ.</p>';
    const NEW = '<p id="q">Con chó nâu chạy quanh trong sân sau.</p>';
    const { rerender } = render(<HarnessRoot html={OLD} />);
    await waitFor(() => expect(chapterRoot().textContent).toContain('Con mèo'));
    select('Con mèo đen');
    clearSelection();

    rerender(<HarnessRoot html={NEW} />);
    await waitFor(() => expect(chapterRoot().textContent).toContain('Con chó'));

    select('chạy quanh');
    await clickColour(/vàng/i);
    await waitFor(() => expect(hook.api.list).toHaveLength(1));

    expect((hook.api.list[0].anchor as Anchor).exact).toBe('chạy quanh');
    expect(paintedQuote(chapterRoot(), hook.api.list[0].id)).toBe('chạy quanh');
  });
});

// ===========================================================================
// 5. Where the toolbar goes — pure, so it needs no layout engine
// ===========================================================================

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

describe('toolbarSpot — vị trí trong toạ độ TÀI LIỆU', () => {
  const view = { scrollX: 0, scrollY: 0, innerWidth: 1200 };

  it('mặc định nổi PHÍA TRÊN vùng chọn, canh giữa dòng đầu', () => {
    const spot = toolbarSpot([rect(300, 400, 200, 20)], view);
    expect(spot.below).toBe(false);
    expect(spot.top).toBe(400);
    expect(spot.left).toBe(400);
  });

  it('vùng chọn sát MÉP TRÊN màn hình → lật xuống dưới, canh theo dòng CUỐI', () => {
    const spot = toolbarSpot([rect(300, 2, 200, 20), rect(100, 22, 400, 20)], view);
    expect(spot.below).toBe(true);
    expect(spot.top).toBe(42);
    expect(spot.left).toBe(300);
  });

  it('vùng chọn NHIỀU DÒNG khi nổi lên trên thì neo vào dòng ĐẦU', () => {
    const spot = toolbarSpot([rect(500, 400, 200, 20), rect(100, 420, 600, 20)], view);
    expect(spot.below).toBe(false);
    expect(spot.top).toBe(400);
    expect(spot.left).toBe(600);
  });

  it('cộng scroll để ra toạ độ tài liệu — cuộn trang không làm toolbar trôi khỏi vùng chọn', () => {
    const spot = toolbarSpot([rect(300, 400, 200, 20)], { scrollX: 40, scrollY: 900, innerWidth: 1200 });
    expect(spot.top).toBe(1300);
    expect(spot.left).toBe(440);
  });

  it('kẹp trong bề ngang cửa sổ: vùng chọn sát mép trái/phải không đẩy toolbar ra ngoài', () => {
    const narrow = { scrollX: 0, scrollY: 0, innerWidth: 400 };
    const atLeft = toolbarSpot([rect(0, 300, 30, 20)], narrow);
    const atRight = toolbarSpot([rect(370, 300, 30, 20)], narrow);
    expect(atLeft.left).toBeGreaterThan(15);
    expect(atRight.left).toBeLessThan(385);
    expect(atLeft.left).toBeLessThan(atRight.left);
  });

  it('không có rect nào (jsdom, hoặc vùng chọn không được vẽ) vẫn cho một vị trí dùng được', () => {
    const spot = toolbarSpot([], { scrollX: 0, scrollY: 500, innerWidth: 1200 });
    expect(Number.isFinite(spot.left)).toBe(true);
    expect(spot.top).toBeGreaterThanOrEqual(500);
  });

  it('bỏ qua rect DIỆN TÍCH 0 (vết ngắt dòng), neo vào dòng thật đầu/cuối', () => {
    // A zero-area rect is what a line break leaves behind, and it can sit
    // either end of the list. Keeping it costs a toolbar pointed at a place
    // where nothing is drawn — 20 px above the real first line here, and 200 px
    // to the right of the real last line below.
    const above = toolbarSpot([rect(700, 400, 0, 0), rect(100, 420, 600, 20)], view);
    expect(above.below).toBe(false);
    expect(above.top).toBe(420);
    expect(above.left).toBe(400);

    const below = toolbarSpot([rect(300, 2, 200, 20), rect(100, 22, 400, 20), rect(500, 42, 0, 0)], view);
    expect(below.below).toBe(true);
    expect(below.top).toBe(42);
    expect(below.left).toBe(300);
  });
});

// ===========================================================================
// 5b. The two estimates, pinned against the box that actually ships
// ===========================================================================
//
// `EST_WIDTH`/`EST_HEIGHT` are the ONLY things deciding when the toolbar flips
// below the selection and how far it is clamped from a window edge, and Task 5
// CHANGED them (220×40 → 232×44) on the strength of a Chromium measurement.
// Nothing held them: the Task 5 review flipped `EST_HEIGHT` to 0 and
// `EST_WIDTH` to 232 → 20 and every test stayed green, because the clamp test
// above only asks for `left > 15` on a 400 px window — which `EST_WIDTH = 20`
// satisfies while the real 227 px box hangs ~95 px off the right edge.
//
// The tests below therefore do not assert the constants. They assert the thing
// the constants exist for: THE REAL BOX LANDS ON SCREEN, and it never covers
// the line it belongs to. The estimate is free to be a few px off (that is what
// it is for); it is not free to be off by enough to push the box out of the
// window, which is the only failure mode a reader can see.

/**
 * The toolbar's real measured box, in Chromium with this repo's own
 * stylesheets: 188,67 × 34 px with a mouse, 226,67 × 42 px with
 * `@media (pointer: coarse)` — and the coarse case is also the narrow-window
 * case, so it is the one that binds. (The Task 5 review measured 212,6 × 42 on
 * an iPhone 12 emulation; the larger of the two independent measurements is
 * used here, so these tests cannot pass by assuming a smaller toolbar than the
 * one that ships.)
 */
const REAL_W = 227;
const REAL_H = 42;
/** `.ann-tb`'s own `transform: translate(-50%, calc(-100% - 8px))` — the gap
 * `GAP` decides there is ROOM for, and the CSS then draws. */
const CSS_GAP = 8;
/** How close to a window edge the toolbar is allowed to come. */
const CSS_EDGE = 8;

/** Where the real box lands for a given spot. `left` is a CENTRE (the CSS does
 * `translateX(-50%)`); `top` is the selection line's own edge, with the box
 * `CSS_GAP` away from it on whichever side `below` says. */
function realBox(spot: ToolbarSpot) {
  return {
    left: spot.left - REAL_W / 2,
    right: spot.left + REAL_W / 2,
    top: spot.below ? spot.top + CSS_GAP : spot.top - CSS_GAP - REAL_H,
    bottom: spot.below ? spot.top + CSS_GAP + REAL_H : spot.top - CSS_GAP,
  };
}

describe('toolbarSpot — hộp THẬT phải nằm trong màn hình', () => {
  const view = { scrollX: 0, scrollY: 0, innerWidth: 1200 };

  it.each([
    ['điện thoại hẹp (iPhone 12)', 390],
    ['cửa sổ hẹp', 400],
    ['máy tính để bàn', 1280],
  ])('kẹp NGANG đủ cho hộp 227px: %s', (_name, innerWidth) => {
    const narrow = { scrollX: 0, scrollY: 0, innerWidth };
    for (const left of [0, 5, 30, innerWidth / 2, innerWidth - 60, innerWidth - 30, innerWidth - 1]) {
      const box = realBox(toolbarSpot([rect(left, 300, 30, 20)], narrow));
      expect(box.left).toBeGreaterThanOrEqual(CSS_EDGE);
      expect(box.right).toBeLessThanOrEqual(innerWidth - CSS_EDGE);
    }
  });

  it('lật xuống dưới SỚM ĐỦ: hộp 42px không bao giờ bị đẩy quá mép trên, không bao giờ che dòng của nó', () => {
    // Sweeps the whole band the flip threshold lives in, one px at a time —
    // the band the old tests never touched (`top = 2` is below every candidate
    // threshold, so it cannot tell 60 from 16).
    for (let top = 0; top <= 120; top++) {
      const spot = toolbarSpot([rect(300, top, 200, 20)], view);
      const box = realBox(spot);
      expect(box.top).toBeGreaterThanOrEqual(CSS_EDGE);
      if (spot.below) {
        // Below the selection's LAST line, never on top of it.
        expect(box.top).toBeGreaterThanOrEqual(top + 20);
      } else {
        // Above the selection's FIRST line, never on top of it.
        expect(box.bottom).toBeLessThanOrEqual(top);
      }
    }
  });

  it('ngưỡng lật đúng bằng EST_HEIGHT + GAP + EDGE = 60 px, không phải 59 hay 61', () => {
    // The exact boundary, so a `<`/`<=` slip is a failure rather than a shrug.
    // 60 is the conservative side of the safety property above: the real 42 px
    // box fits above a line at `top = 60` with 10 px to spare, so declining to
    // flip there is right, and flipping at 59 is the estimate being cautious
    // about a box it deliberately over-states.
    expect(toolbarSpot([rect(300, 59, 200, 20)], view).below).toBe(true);
    expect(toolbarSpot([rect(300, 60, 200, 20)], view).below).toBe(false);
  });
});

// ===========================================================================
// 6. Chương THẬT, KaTeX THẬT — harness giống anchor.test.ts/painter.test.ts
// ===========================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
// Chương của một GÓI THẬT, không phải HTML viết trong tệp này.
// `readSampleCourseFile` đọc trong thư mục làm việc `courses/`, và ném ra câu
// chỉ đúng lệnh phải chạy khi gói chưa được bung. Xem
// apps/web/src/test/sampleCourse.ts — kể cả vì sao course đổi ở task 13.
//
// Gọi TRONG test, không phải ở cấp module: khác với painter/anchor/version —
// nơi phép đọc vốn đã ở cấp module nên cả tệp trượt cùng nhau — tệp này còn 30
// test khác không liên quan tới chương thật. Đọc ở cấp module sẽ kéo tất cả
// chúng đỏ theo, tức mất độ phân giải chẩn đoán mà không được gì.
const CHAPTER_FILE = SAMPLE_CHAPTER;

let katexLoaded = false;
function loadKatex(): void {
  if (katexLoaded) return;
  new Function(readFileSync(resolve(REPO, 'packages/course-kit/vendor/katex.js'), 'utf8')).call(globalThis);
  new Function(readFileSync(resolve(REPO, 'packages/course-kit/vendor/auto-render.js'), 'utf8')).call(globalThis);
  katexLoaded = true;
}

/** Renders one chapter the way `ChapterView` does: fragment HTML, then KaTeX
 * auto-render with EXACTLY `packages/course-kit/runtime.js:319-333`'s options. */
function RealChapterHarness({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<ChapterContent>({ root: null, revision: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    (globalThis as unknown as { renderMathInElement: (el: Element, o: unknown) => void }).renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
      strict: false,
      macros: { '\\Pr': '\\operatorname{Pr}', '\\Var': '\\operatorname{Var}' },
    });
    setContent((prev) => ({ root: el, revision: prev.revision + 1 }));
  }, [html]);
  const live = useAnnotations('sdpd', 'p1-3', content);
  hook.api = live;
  return (
    <>
      <div ref={ref} data-testid="chapter" />
      <LanguageProvider>
        <SelectionToolbar content={content} store={live} />
      </LanguageProvider>
    </>
  );
}

describe('chương thật p1-3.html của gói mẫu, với KaTeX thật', () => {
  it('bôi chọn đoạn có CÔNG THỨC rồi bôi chọn tiếp: cả hai ghi chú đúng chữ, đúng một lớp', async () => {
    loadKatex();
    render(
      <QueryClientProvider client={queryClient}>
        <RealChapterHarness html={readSampleCourseFile(CHAPTER_FILE)} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(chapterRoot().querySelectorAll('.katex').length).toBeGreaterThan(100));

    const root = chapterRoot();
    const map = normalizeContainer(root);
    // A stretch of real prose that CONTAINS a formula: the atomic token has to
    // survive selection → anchor → paint, on the DOM KaTeX actually built.
    const withFormula = map.flat.indexOf('￼');
    expect(withFormula).toBeGreaterThan(0);
    const firstFrom = Math.max(0, withFormula - 60);
    const firstTo = Math.min(map.flat.length, withFormula + 60);
    const secondFrom = Math.min(map.flat.length - 1, firstTo + 400);
    const secondTo = Math.min(map.flat.length, secondFrom + 120);

    applySelection(flatToDom(map, firstFrom, firstTo));
    expect(toolbar()).not.toBeNull();
    await clickColour(/vàng/i);
    await waitFor(() => expect(hook.api.list).toHaveLength(1));

    const fresh = normalizeContainer(root);
    applySelection(flatToDom(fresh, secondFrom, secondTo));
    expect(toolbar()).not.toBeNull();
    await clickColour(/xanh dương/i);
    await waitFor(() => expect(hook.api.list).toHaveLength(2));

    for (const row of hook.api.list) {
      const anchor = row.anchor as Anchor;
      expect(paintedQuote(root, row.id)).toBe(anchor.exact);
      expect(layersOf(root, row.id)).toBe(1);
    }
    // The first note quotes a formula, and quoting it did not drag any of
    // KaTeX's own tripled text into the anchor.
    const quotes = hook.api.list.map((r) => (r.anchor as Anchor).exact);
    expect(quotes.some((q) => q.includes('￼'))).toBe(true);
    expect(quotes.join(' ')).not.toContain('\\frac');
    // Nothing was wrapped inside a formula's markup, and the chapter still
    // reads the same.
    expect(root.querySelectorAll('.katex mark')).toHaveLength(0);
    expect(root.querySelectorAll('mark.ann[data-ann-id^="pending-"]')).toHaveLength(0);
    expect(hook.api.orphans).toHaveLength(0);
  }, 60_000);
});

/** Kept honest about what the colour buttons are named, so a rename cannot
 * silently make `clickColour(/vàng/i)` match the wrong swatch. */
const COLOUR_ORDER: readonly AnchorColor[] = ['y', 'g', 'b', 'p'];

describe('bảng màu', () => {
  it('đúng bốn màu của hợp đồng, theo thứ tự y-g-b-p', async () => {
    render(<HarnessRoot html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    select(Q1);

    const swatches = Array.from(toolbar()!.querySelectorAll<HTMLElement>('button.ann-tb-swatch'));
    expect(swatches.map((b) => b.dataset.color)).toEqual([...COLOUR_ORDER]);
  });
});
