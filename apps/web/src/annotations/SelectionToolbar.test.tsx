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
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLocalData, db } from '../db/local';
import { type Anchor, type AnchorColor, selectionToAnchor } from './anchor';
import { flatToDom, normalizeContainer } from './normalize';
import { highlightElements } from './painter';
import { SelectionToolbar, type ToolbarStore, toolbarSpot } from './SelectionToolbar';
import { type ChapterContent, type UseAnnotationsResult, useAnnotations } from './useAnnotations';

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

function stubStore(create: ToolbarStore['create']): ToolbarStore {
  return { create, list: [], orphans: [] };
}

/**
 * Renders a chapter the way `ChapterView` does — `innerHTML` into a `<div>`
 * React never gives children to, then a `revision` bump — and mounts the
 * toolbar over it.
 *
 * `store` is either a stub (so a test can watch `create` and leave it pending)
 * or the real `useAnnotations` result (so the paint/handover integration is
 * exercised for real, against fake-indexeddb).
 */
function Harness({
  html,
  store,
  onRequestNote,
}: {
  html: string;
  store?: ToolbarStore;
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
  const live = useAnnotations('c1', 'ch1', store ? { root: null, revision: 0 } : content);
  hook.api = live;
  return (
    <>
      <div ref={ref} data-testid="chapter" />
      <p data-testid="outside">Ngoài chương: chân trang</p>
      <SelectionToolbar content={content} store={store ?? live} onRequestNote={onRequestNote} />
    </>
  );
}

function chapterRoot(): HTMLElement {
  return screen.getByTestId('chapter');
}

/** Selects `quote` (matched in the chapter's flat text, so it keeps working
 * after painting has split text nodes) and fires `selectionchange` — the one
 * event both mouse drags and Shift+Arrow produce. jsdom does not fire it for
 * programmatic selection changes, so the test does. */
function select(quote: string, root: HTMLElement = chapterRoot()): Range {
  const map = normalizeContainer(root);
  const at = map.flat.indexOf(quote);
  if (at < 0) throw new Error(`select: ${JSON.stringify(quote)} not in the chapter`);
  const range = flatToDom(map, at, at + quote.length);
  if (!range) throw new Error(`select: no range for ${JSON.stringify(quote)}`);
  applySelection(range);
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
 * into Dexie the way `sync/engine.ts`'s `pull()` puts a row from another
 * device. Empty context on purpose: `fuzzyFind` needs a prefix or suffix
 * occurrence to have anywhere to look, so this settles as an orphan without
 * spending the fuzzy tier. */
async function seedOrphan(): Promise<void> {
  await db.annotations.put({
    id: 'orphan-1',
    courseId: 'c1',
    chapterId: 'ch1',
    anchor: { exact: 'định lý mã hoá kênh nhiễu của Shannon', prefix: '', suffix: '', color: 'y' },
    note: 'ghi chú cũ',
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    deletedAt: null,
  });
}

const user = userEvent.setup();

async function clickColour(name: RegExp | string): Promise<void> {
  await user.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(async () => {
  clearSelection();
  await clearLocalData();
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. Showing and hiding
// ===========================================================================

describe('hiện/ẩn theo vùng chọn', () => {
  it('bôi chọn văn xuôi trong chương → toolbar nổi lên với 4 nút màu + nút Ghi chú', async () => {
    render(<Harness html={CHAPTER} store={stubStore(vi.fn())} />);
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
    render(<Harness html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());

    const paragraph = chapterRoot().querySelector('#p1')!;
    const caret = document.createRange();
    caret.setStart(paragraph.firstChild!, 5);
    caret.collapse(true);
    applySelection(caret);

    expect(toolbar()).toBeNull();
  });

  it('vùng chọn NGOÀI chương không hiện toolbar', async () => {
    render(<Harness html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());

    const outside = screen.getByTestId('outside');
    const range = document.createRange();
    range.setStart(outside.firstChild!, 0);
    range.setEnd(outside.firstChild!, 6);
    applySelection(range);

    expect(toolbar()).toBeNull();
  });

  it('vùng chọn kéo TỪ TRONG chương RA NGOÀI cũng không hiện toolbar (không đoán ý người đọc)', async () => {
    render(<Harness html={CHAPTER} store={stubStore(vi.fn())} />);
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
    render(<Harness html={CHAPTER} store={stubStore(vi.fn())} />);
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
    render(<Harness html={CHAPTER} store={stubStore(create)} />);
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
    render(<Harness html={CHAPTER} store={stubStore(create)} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    select(Q1);
    expect(toolbar()).not.toBeNull();

    await user.click(screen.getByTestId('outside'));

    expect(toolbar()).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(marks()).toHaveLength(0);
  });

  it('bôi chọn bằng BÀN PHÍM (Shift+mũi tên) cũng mở toolbar — selectionchange, không phải mouseup', async () => {
    render(<Harness html={CHAPTER} store={stubStore(vi.fn())} />);
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
    render(<Harness html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    const outside = screen.getByTestId('outside');
    outside.setAttribute('tabindex', '0');
    outside.focus();

    select(Q1);

    expect(toolbar()).not.toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it('mousedown trên toolbar bị preventDefault — vùng chọn của người đọc sống sót cú bấm', async () => {
    render(<Harness html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    select(Q1);

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    toolbar()!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('Ctrl+C / Cmd+C không bị chặn và toolbar vẫn giữ nguyên vùng chọn', async () => {
    render(<Harness html={CHAPTER} store={stubStore(vi.fn())} />);
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
    render(<Harness html={CHAPTER} store={stubStore(create)} />);
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
    render(<Harness html={CHAPTER} store={stubStore(create)} onRequestNote={onRequestNote} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    select(Q2);

    await clickColour(/ghi chú/i);

    await waitFor(() => expect(onRequestNote).toHaveBeenCalledWith('note-id'));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].exact).toBe(Q2);
    expect(marks().length).toBeGreaterThan(0);
  });

  it('lưu HỎNG → gỡ màu và báo lỗi cho người đọc', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const create = vi.fn(async () => {
      throw new Error('quota exceeded');
    });
    render(<Harness html={CHAPTER} store={stubStore(create)} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    select(Q1);

    await clickColour(/vàng/i);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(marks()).toHaveLength(0);
    expect(chapterRoot().querySelector('#p1')!.textContent).toBe(
      'Entropy đo lượng thông tin trung bình mà một nguồn tin sinh ra.',
    );
  });
});

// ===========================================================================
// 4. The store, for real — where a stale NormMap bites
// ===========================================================================

describe('kho ghi chú thật (fake-indexeddb)', () => {
  it('HAI ghi chú liên tiếp: cả hai neo đúng chỗ, mỗi ghi chú đúng MỘT lớp mark', async () => {
    render(<Harness html={CHAPTER} />);
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
    expect(await db.annotations.count()).toBe(2);
  });

  it('ghi chú thứ hai CHỒNG lên ghi chú thứ nhất vẫn đúng chỗ', async () => {
    render(<Harness html={CHAPTER} />);
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
    await seedOrphan();
    render(<Harness html={CHAPTER} />);
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
    render(<Harness html={CHAPTER} />);
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
    const { rerender } = render(<Harness html={OLD} />);
    await waitFor(() => expect(chapterRoot().textContent).toContain('Con mèo'));
    select('Con mèo đen');
    clearSelection();

    rerender(<Harness html={NEW} />);
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
});

// ===========================================================================
// 6. Chương THẬT, KaTeX THẬT — harness giống anchor.test.ts/painter.test.ts
// ===========================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const CHAPTER_FILE = resolve(REPO, 'courses/***REMOVED***/chapters/p1-5.html');

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
  const live = useAnnotations('ltt', 'p1-5', content);
  hook.api = live;
  return (
    <>
      <div ref={ref} data-testid="chapter" />
      <SelectionToolbar content={content} store={live} />
    </>
  );
}

describe('chương thật p1-5.html với KaTeX thật', () => {
  it('bôi chọn đoạn có CÔNG THỨC rồi bôi chọn tiếp: cả hai ghi chú đúng chữ, đúng một lớp', async () => {
    loadKatex();
    render(<RealChapterHarness html={readFileSync(CHAPTER_FILE, 'utf8')} />);
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
    render(<Harness html={CHAPTER} store={stubStore(vi.fn())} />);
    await waitFor(() => expect(chapterRoot().querySelector('#p1')).not.toBeNull());
    select(Q1);

    const swatches = Array.from(toolbar()!.querySelectorAll<HTMLElement>('button.ann-tb-swatch'));
    expect(swatches.map((b) => b.dataset.color)).toEqual([...COLOUR_ORDER]);
  });
});
