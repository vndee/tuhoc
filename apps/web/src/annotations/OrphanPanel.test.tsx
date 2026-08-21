/**
 * Tests for the orphan panel (P2 Task 7) — the last promise of the phase.
 *
 * Six tasks built a system that tries very hard to keep a reader's notes
 * attached to the words they were written about. This is the file that covers
 * what happens when it fails anyway: the content was rebuilt, both the exact
 * and the fuzzy tier came back empty, and the note has nowhere to go. The
 * panel is where the reader joins it back up by hand.
 *
 * Four properties here are worth more than the rest, because each of them is a
 * failure that stays GREEN under the obvious test:
 *
 *  1. **Reattach mode and Task 5's toolbar both listen to `selectionchange`.**
 *     A single-feature test never notices that both answer at once. The
 *     decision (reattach mode wins; no new-note toolbar while it is on) is
 *     pinned in `../reader/ChapterView.test.tsx`, where the two components are
 *     actually siblings — a stub of one of them here would only test the stub.
 *  2. **A `NormMap` is a snapshot and reattaching expires it** (ruling
 *     P2-F8). One reattach passes against a component that caches its map
 *     forever; the second one is what throws `StaleNormMapError`. Every
 *     reattach test below therefore does at least two operations.
 *  3. **Reattaching must not cost the reader a single character or the
 *     colour.** They are in the middle of rescuing a note; losing its body
 *     while rescuing it is the worst possible outcome of exactly this task.
 *  4. **Orphans are DATA.** Nothing here — not "Hủy", not ignoring the panel,
 *     not closing the chapter — may write anything at all about them. The
 *     outbox is the witness: a single row means something was propagated to
 *     the reader's other devices that they never asked for.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AnnotationRow, clearLocalData, db } from '../db/local';
import { type Anchor, type AnchorColor, selectionToAnchor } from './anchor';
import { normalizeContainer } from './normalize';
import { ORPHAN_QUOTE_MAX, OrphanPanel } from './OrphanPanel';
import { type ChapterContent, useAnnotations } from './useAnnotations';

const PROSE = [
  '<h2>Chương thử nghiệm</h2>',
  '<p>Entropy đo lượng thông tin trung bình mà một nguồn tin sinh ra.</p>',
  '<p>Độ dài mã tối ưu không thể ngắn hơn entropy của nguồn tin đó.</p>',
  '<p>Kênh nhiễu làm giảm dung lượng truyền tin của toàn hệ thống.</p>',
].join('\n');

/**
 * Two paragraphs from an OLDER build of the chapter. Nothing in them survives
 * into `PROSE`, so an anchor cut from either is an orphan there — which is the
 * only way a chapter gets one that does not depend on the fuzzy tier's exact
 * scoring. The trailing sentence is there so the anchors get a real `suffix`,
 * the same shape `useAnnotations.test.tsx` uses for its own orphan fixture.
 */
const Q_LOST_LONG =
  'Định lý mã hoá kênh của Shannon phát biểu rằng mọi kênh rời rạc không nhớ đều có một dung lượng khả đạt';
const REMOVED_LONG = `<p>${Q_LOST_LONG} và phần chứng minh đi kèm.</p>`;

const Q_LOST_SHORT = 'Bất đẳng thức Fano ràng buộc xác suất lỗi';
const REMOVED_SHORT = `<p>${Q_LOST_SHORT} theo entropy có điều kiện.</p>`;

/** Where the reader will put the rescued notes. Both are in paragraphs the
 * other reattach does not touch, so the second selection is made against text
 * nodes the first paint did not split. */
const TARGET_FIRST = 'Entropy đo lượng thông tin';
const TARGET_THIRD = 'Kênh nhiễu làm giảm dung lượng';

/**
 * A DISPLAY FORMULA, in the only shape that matters here: `normalize.ts`
 * matches `.katex-display` with `ATOMIC_SELECTOR` and stands the whole subtree
 * in for exactly ONE `'￼'` in the flat text — whatever it renders as, and
 * whether or not KaTeX itself ever ran. Chapter `p1-5` of the real course has
 * 263 of these nodes, which is why "the reader dragged across a formula" is
 * the ordinary case and not the exotic one.
 */
const FORMULA = '<p class="katex-display" data-testid="formula"><span class="katex">H(X) = -Σ p log p</span></p>';
const PROSE_MATH = [PROSE, FORMULA].join('\n');

/** Wide enough for `#rail` to exist at all — `reader.css` hides it under
 * `@media (max-width:1240px)` and jsdom's own default is 1024, i.e. the phone
 * branch. Every test about the rail PANEL therefore has to say so out loud;
 * the ones about the narrow-screen signal set their own width. */
const WIDE = 1400;
const PHONE = 390;

function setViewportWidth(px: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });
}

/**
 * The test's own, independent restatement of "is there anything in this quote
 * a search could ever find again": strip the formula stand-ins, strip the
 * spaces, see if a single character is left.
 *
 * Deliberately NOT imported from `./anchor`. This is the invariant the whole
 * of C1 is about, and a test that asserts it by calling the very function
 * under test would stay green if that function were changed to `() => true`.
 */
function hasWordsInIt(exact: string): boolean {
  return exact.replace(/￼/g, '').trim().length > 0;
}

/** Builds a real `Anchor` through `./anchor`, from a DETACHED copy of some
 * content — the same way `MarginCards.test.tsx` and `useAnnotations.test.tsx`
 * do, and for the same reason: a hand-written `{exact, prefix, suffix}`
 * literal would test this file's idea of the collapsed projection instead of
 * the real one. */
function makeAnchor(html: string, quote: string, color: AnchorColor = 'y'): Anchor {
  const scratch = document.createElement('div');
  scratch.innerHTML = html;
  const map = normalizeContainer(scratch);
  const walker = document.createTreeWalker(scratch, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const at = text.data.indexOf(quote);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + quote.length);
    const anchor = selectionToAnchor(map, range, color);
    if (anchor) return anchor;
  }
  throw new Error(`makeAnchor: không neo được ${JSON.stringify(quote)}`);
}

let seq = 0;
async function seed(anchor: Anchor, note: string): Promise<AnnotationRow> {
  seq += 1;
  const at = '2026-08-19T09:30:00.000Z';
  const row: AnnotationRow = {
    id: `n${seq}`,
    courseId: 'c1',
    chapterId: 'ch1',
    anchor,
    note,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  // Straight into Dexie with no outbox entry — exactly what `sync/engine.ts`'s
  // `pull()` does with a row from another device. That is what makes "the
  // outbox is still empty" a meaningful assertion below.
  await db.annotations.put(row);
  return row;
}

/**
 * Stands in for `ChapterView`: owns the `<div>` React never gives children to,
 * sets the chapter HTML into it imperatively, bumps a revision counter, holds
 * the ONE `useAnnotations` instance, and owns the reattach-mode state the way
 * `ChapterView` does (it has to live above both this panel and the toolbar).
 */
function Harness({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<ChapterContent>({ root: null, revision: 0 });
  const [reattaching, setReattaching] = useState<string | null>(null);
  const store = useAnnotations('c1', 'ch1', content);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    setContent((prev) => ({ root: el, revision: prev.revision + 1 }));
  }, [html]);

  return (
    <>
      <div ref={ref} data-testid="chapter" />
      {/* The witnesses every wait in this file uses. A `<mark>` appearing in
          the chapter is not the same event as the store PUBLISHING its lists:
          the paint is an imperative DOM write inside the store's effect, and
          `list`/`orphans` reach this component through a `setState` that needs
          a commit of its own. Waiting on the DOM and then clicking a panel
          button finds a panel whose props are still empty — ruling P2-F15's
          race, in this file's shape. */}
      <output data-testid="orphan-count">{store.orphans.length}</output>
      <output data-testid="list-count">{store.list.length}</output>
      <aside data-testid="rail">
        <OrphanPanel
          content={content}
          store={store}
          reattaching={reattaching}
          onReattachingChange={setReattaching}
        />
      </aside>
    </>
  );
}

function chapterRoot(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="chapter"]');
  if (!el) throw new Error('chapter root chưa render');
  return el;
}

function orphanRow(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-ann-orphan="${id}"]`);
  if (!el) throw new Error(`không có hàng mồ côi cho ${id}`);
  return el;
}

function marksFor(id: string): HTMLElement[] {
  return Array.from(chapterRoot().querySelectorAll<HTMLElement>(`mark.ann[data-ann-id="${id}"]`));
}

function paintedText(id: string): string {
  return marksFor(id)
    .map((m) => m.textContent ?? '')
    .join('');
}

/** Waits until the store has PUBLISHED this many orphans. See the `<output>`
 * in `Harness`. */
async function waitForOrphans(count: number): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('orphan-count')).toHaveTextContent(String(count)));
}

async function waitForPlaced(count: number): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('list-count')).toHaveTextContent(String(count)));
}

/**
 * The reader's own action: drag across `text` in the rendered chapter.
 *
 * `selectionchange` is dispatched by hand because jsdom does not fire it for a
 * programmatic selection — a real drag, and a real Shift+Arrow, both do.
 */
function selectInChapter(text: string): void {
  const walker = document.createTreeWalker(chapterRoot(), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node as Text).data.indexOf(text);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + text.length);
    act(() => {
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    return;
  }
  throw new Error(`không tìm thấy ${JSON.stringify(text)} trong chương đã render`);
}

/**
 * Put the whole of `node` in the selection — the drag that lands on a display
 * formula. `selectNode`, not a text offset pair: a `.katex-display` subtree is
 * off-limits to `normalize.ts`'s walker by construction, so its INSIDE has no
 * flat offsets to select between. This is what a reader's mouse produces when
 * it crosses a rendered formula.
 */
function selectNodeInChapter(node: Node, { announce = true }: { announce?: boolean } = {}): void {
  const range = document.createRange();
  range.selectNode(node);
  const apply = (): void => {
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    if (announce) document.dispatchEvent(new Event('selectionchange'));
  };
  if (announce) act(apply);
  else apply();
}

function formulaNode(): HTMLElement {
  const el = chapterRoot().querySelector<HTMLElement>('[data-testid="formula"]');
  if (!el) throw new Error('chương chưa render công thức');
  return el;
}

/** The reattach bar, or `null`. Identified by its own role+name rather than by
 * a class, so a test cannot be satisfied by a bar that is on screen but
 * unusable. */
function reattachBar(): HTMLElement | null {
  return screen.queryByRole('group', { name: 'Gắn lại ghi chú' });
}

function confirmButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: /gắn vào đây/i });
}

/** "Gắn lại" on one orphan, then select `target`, then confirm. The whole
 * user-visible path, in one call, because every reattach test needs at least
 * two of them (ruling P2-F8). */
async function reattachTo(id: string, target: string): Promise<void> {
  fireEvent.click(within(orphanRow(id)).getByRole('button', { name: 'Gắn lại' }));
  selectInChapter(target);
  const confirm = await screen.findByRole('button', { name: /gắn vào đây/i });
  fireEvent.click(confirm);
}

beforeEach(async () => {
  await clearLocalData();
  document.body.innerHTML = '';
  seq = 0;
  setViewportWidth(WIDE);
});

afterEach(async () => {
  await clearLocalData();
  window.getSelection()?.removeAllRanges();
  setViewportWidth(1024);
});

describe('OrphanPanel — ghi chú mồ côi là dữ liệu, không phải rác', () => {
  it('liệt kê từng ghi chú mồ côi: exact cắt còn 80 ký tự, kèm nguyên văn nội dung ghi chú', async () => {
    await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG), 'chỗ này phải đọc lại trước kỳ thi');
    render(<Harness html={PROSE} />);
    await waitForOrphans(1);

    const section = screen.getByRole('region', { name: /mồ côi/i });
    expect(within(section).getByRole('heading', { name: 'Mồ côi (1)' })).toBeInTheDocument();

    const row = orphanRow('n1');
    const quote = within(row).getByTestId('orphan-quote-n1');
    // The literal 80 as well as the constant, deliberately. Asserting only
    // `toHaveLength(ORPHAN_QUOTE_MAX)` is self-referential — it stays green
    // when the budget is changed to any other number, which is precisely how
    // Task 5's EST_WIDTH/EST_HEIGHT ended up pinned by nothing at all.
    expect(ORPHAN_QUOTE_MAX).toBe(80);
    expect(Q_LOST_LONG.length).toBeGreaterThan(80);
    expect(quote.textContent).toHaveLength(80);
    expect(quote.textContent!.endsWith('…')).toBe(true);
    // Not merely "80 characters": the RIGHT 80, taken from the front of the
    // stored quote, so a row can be recognised by reading it.
    expect(Q_LOST_LONG.startsWith(quote.textContent!.slice(0, -1))).toBe(true);

    // The reader's own words are NOT truncated: the quote is a hint about
    // where the note used to be, the note is the thing being rescued.
    expect(within(row).getByText('chỗ này phải đọc lại trước kỳ thi')).toBeInTheDocument();
  });

  it('không có ghi chú mồ côi thì không dựng mục nào cả', async () => {
    await seed(makeAnchor(PROSE, TARGET_FIRST), 'ghi chú bình thường');
    render(<Harness html={PROSE} />);
    await waitForPlaced(1);

    expect(screen.getByTestId('orphan-count')).toHaveTextContent('0');
    expect(screen.queryByRole('region', { name: /mồ côi/i })).not.toBeInTheDocument();
  });

  it('"Xem exact gốc" mở ra đoạn văn ĐẦY ĐỦ trong một ô sao chép được', async () => {
    await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG), 'ghi chú dài');
    render(<Harness html={PROSE} />);
    await waitForOrphans(1);

    const row = orphanRow('n1');
    const toggle = within(row).getByRole('button', { name: /xem exact gốc/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const box = within(row).getByRole('textbox', { name: /đoạn văn gốc/i }) as HTMLTextAreaElement;
    // The WHOLE quote, not the 80-character version: this control exists
    // precisely so the reader can search the new chapter for it themselves.
    expect(box.value).toBe(Q_LOST_LONG);
    expect(box.readOnly).toBe(true);

    // "Copyable" has to mean something a reader can do. Selecting the field is
    // the way that works with no permissions and no API; the Clipboard call is
    // the shortcut on top of it.
    const select = vi.fn();
    Object.defineProperty(box, 'select', { configurable: true, value: select });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    fireEvent.click(within(row).getByRole('button', { name: /sao chép/i }));
    expect(select).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(Q_LOST_LONG);
  });

  it('gắn lại giữ NGUYÊN nội dung ghi chú và màu, chỉ đổi chỗ neo', async () => {
    const before = await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG, 'p'), 'đừng làm mất chữ này');
    render(<Harness html={PROSE} />);
    await waitForOrphans(1);

    await reattachTo('n1', TARGET_FIRST);

    await waitForPlaced(1);
    await waitForOrphans(0);
    expect(paintedText('n1')).toBe(TARGET_FIRST);

    const after = await db.annotations.get('n1');
    expect(after!.note).toBe('đừng làm mất chữ này');
    expect((after!.anchor as Anchor).color).toBe('p');
    expect((after!.anchor as Anchor).exact).toBe(TARGET_FIRST);
    expect(after!.createdAt).toBe(before.createdAt);
    expect(after!.deletedAt).toBeNull();
    // The highlight wears the note's original colour, not the default yellow.
    expect(marksFor('n1')[0].className).toContain('ann-p');
    // One outbox row: the reattach itself, and nothing else.
    expect(await db.outbox.count()).toBe(1);
  });

  it('gắn lại HAI ghi chú liên tiếp — map là ảnh chụp, và cái thứ hai là cái phát hiện ra điều đó (P2-F8)', async () => {
    await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG, 'g'), 'ghi chú một');
    await seed(makeAnchor(REMOVED_SHORT, Q_LOST_SHORT, 'b'), 'ghi chú hai');
    render(<Harness html={PROSE} />);
    await waitForOrphans(2);

    // First reattach: paints into paragraph 1, which splits the text nodes the
    // panel's own NormMap was built from.
    await reattachTo('n1', TARGET_FIRST);
    await waitForPlaced(1);
    expect(paintedText('n1')).toBe(TARGET_FIRST);

    // Second reattach, against a chapter that has moved underneath the cached
    // map. Without `isMapStale`, `selectionToAnchor` throws StaleNormMapError
    // here and the reader's second note can never be rescued.
    await reattachTo('n2', TARGET_THIRD);
    await waitForPlaced(2);
    await waitForOrphans(0);

    expect(paintedText('n2')).toBe(TARGET_THIRD);
    // And the first one did not move when the second was placed.
    expect(paintedText('n1')).toBe(TARGET_FIRST);
    expect((await db.annotations.get('n1'))!.note).toBe('ghi chú một');
    expect((await db.annotations.get('n2'))!.note).toBe('ghi chú hai');
    expect((await db.annotations.get('n2')!)!.anchor).toMatchObject({ exact: TARGET_THIRD, color: 'b' });
  });

  it('"Hủy" không ghi gì cả: hàng vẫn mồ côi, không tombstone, outbox vẫn rỗng', async () => {
    await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG), 'ghi chú quý');
    render(<Harness html={PROSE} />);
    await waitForOrphans(1);

    fireEvent.click(within(orphanRow('n1')).getByRole('button', { name: 'Gắn lại' }));
    selectInChapter(TARGET_FIRST);
    expect(await screen.findByRole('button', { name: /gắn vào đây/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^hủy$/i }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /gắn vào đây/i })).not.toBeInTheDocument());
    expect(orphanRow('n1')).toBeInTheDocument();

    const row = await db.annotations.get('n1');
    expect(row!.deletedAt).toBeNull();
    expect(row!.note).toBe('ghi chú quý');
    expect(row!.updatedAt).toBe('2026-08-19T09:30:00.000Z');
    // Backing out of a rescue is a READ. Nothing about it belongs on another
    // device.
    expect(await db.outbox.count()).toBe(0);
  });

  it('lần cứu thứ hai không thừa hưởng đoạn chọn của lần thứ nhất', async () => {
    await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG), 'ghi chú một');
    await seed(makeAnchor(REMOVED_SHORT, Q_LOST_SHORT), 'ghi chú hai');
    render(<Harness html={PROSE} />);
    await waitForOrphans(2);

    // Start a rescue, make a selection, then back out of it.
    fireEvent.click(within(orphanRow('n1')).getByRole('button', { name: 'Gắn lại' }));
    selectInChapter(TARGET_FIRST);
    expect(await screen.findByRole('button', { name: /gắn vào đây/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^hủy$/i }));

    // Now rescue a DIFFERENT note. The confirm button must not be sitting
    // there already: it would be offering the previous note's paragraph, and
    // the fallback range behind it points at exactly that. The reader would
    // click "Gắn vào đây" for note two and get note one's place.
    fireEvent.click(within(orphanRow('n2')).getByRole('button', { name: 'Gắn lại' }));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: /gắn vào đây/i })).not.toBeInTheDocument();

    // And it comes back for a selection this rescue actually made.
    selectInChapter(TARGET_THIRD);
    fireEvent.click(await screen.findByRole('button', { name: /gắn vào đây/i }));
    await waitForPlaced(1);
    expect(paintedText('n2')).toBe(TARGET_THIRD);
    expect(screen.getByTestId('orphan-count')).toHaveTextContent('1');
  });

  it('không có nút xoá nào trong mục mồ côi — đây là chữ người dùng đã bỏ công viết', async () => {
    await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG), 'một');
    await seed(makeAnchor(REMOVED_SHORT, Q_LOST_SHORT), 'hai');
    render(<Harness html={PROSE} />);
    await waitForOrphans(2);

    const section = screen.getByRole('region', { name: /mồ côi/i });
    const labels = within(section)
      .getAllByRole('button')
      .map((b) => (b.textContent ?? '') + ' ' + (b.getAttribute('aria-label') ?? ''));
    expect(labels.some((label) => /xo[áa]|dọn|xóa hết|bỏ hết/i.test(label))).toBe(false);
  });

  it('đóng chương rồi mở lại: ghi chú mồ côi vẫn còn nguyên, và vẫn không có gì được ghi', async () => {
    await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG), 'ghi chú sống sót');
    const first = render(<Harness html={PROSE} />);
    await waitForOrphans(1);

    first.unmount();
    document.body.innerHTML = '';

    render(<Harness html={PROSE} />);
    await waitForOrphans(1);
    expect(within(orphanRow('n1')).getByText('ghi chú sống sót')).toBeInTheDocument();

    const row = await db.annotations.get('n1');
    expect(row!.deletedAt).toBeNull();
    expect(await db.outbox.count()).toBe(0);
  });
});

/**
 * C1: the rescue must never cost the note the one field that cannot be
 * reconstructed.
 *
 * `anchor.exact` is what "Xem exact gốc" hands back to a reader so they can go
 * looking for their own paragraph by hand. A reattach that overwrites 109
 * characters of prose with a single formula stand-in does not merely fail to
 * help — it removes the last clue, takes the note OUT of the orphan list (so
 * both "Gắn lại" and "Xem exact gốc" disappear with it), and pushes one outbox
 * row of that to every other device. There is no undo.
 *
 * The narrow claim being defended here, and it is narrow on purpose:
 * annotating a formula is a legitimate thing to do and Task 1 deliberately
 * made it possible — that path is untouched. What may not happen is the
 * RESCUE path trading a quote that has words in it for one that has none.
 */
describe('OrphanPanel — cứu hộ không được phá thứ nó đang cứu (C1)', () => {
  it('bôi chọn trúng một công thức: panel KHÔNG mời "Gắn vào đây", và nói vì sao', async () => {
    await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG), 'ghi chú về công thức này');
    render(<Harness html={PROSE_MATH} />);
    await waitForOrphans(1);

    fireEvent.click(within(orphanRow('n1')).getByRole('button', { name: 'Gắn lại' }));
    selectNodeInChapter(formulaNode());

    // Inviting and then refusing is the worst of both: the reader has already
    // decided the rescue worked by the time anything says otherwise.
    await waitFor(() => expect(reattachBar()).toBeInTheDocument());
    expect(confirmButton()).not.toBeInTheDocument();
    expect(screen.getByText(/chỉ gồm công thức/i)).toBeInTheDocument();

    // And the mode stays alive, with the note untouched, so the reader can
    // simply widen the selection.
    expect(orphanRow('n1')).toBeInTheDocument();
    const row = await db.annotations.get('n1');
    expect((row!.anchor as Anchor).exact).toBe(Q_LOST_LONG);
    expect(row!.updatedAt).toBe('2026-08-19T09:30:00.000Z');
    expect(await db.outbox.count()).toBe(0);
  });

  it('nút đã hiện rồi mà đoạn chọn đổi sang công thức: lệnh GHI vẫn từ chối, exact giữ nguyên từng byte', async () => {
    const before = await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG), 'chữ của người đọc');
    render(<Harness html={PROSE_MATH} />);
    await waitForOrphans(1);

    fireEvent.click(within(orphanRow('n1')).getByRole('button', { name: 'Gắn lại' }));
    selectInChapter(TARGET_FIRST);
    const confirm = await screen.findByRole('button', { name: /gắn vào đây/i });

    // The selection moves without the component being told — the shape of
    // every "the button was right when it was drawn" race there is. The button
    // on screen is now offering a paragraph nobody has selected, and
    // `confirmReattach` reads the LIVE selection, on purpose.
    selectNodeInChapter(formulaNode(), { announce: false });
    fireEvent.click(confirm);
    await act(async () => {});

    // The gate that matters is the one on the WRITE, not the one on the
    // button: it is the only one that holds however the click arrived.
    expect(screen.getByText(/chỉ gồm công thức/i)).toBeInTheDocument();
    const row = await db.annotations.get('n1');
    expect((row!.anchor as Anchor).exact).toBe(Q_LOST_LONG);
    expect(row!.anchor).toEqual(before.anchor);
    expect(row!.updatedAt).toBe(before.updatedAt);
    expect(row!.note).toBe('chữ của người đọc');
    expect(row!.deletedAt).toBeNull();
    expect(await db.outbox.count()).toBe(0);

    // Still rescuable, which is the whole point: the row never left the list,
    // so backing out of this attempt hands both of its controls straight back.
    // (The C1 bug took the note OUT of `orphans`, and "Gắn lại" and "Xem exact
    // gốc" went with it.)
    expect(within(orphanRow('n1')).getByRole('button', { name: /xem exact gốc/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^hủy$/i }));
    await waitFor(() => expect(reattachBar()).not.toBeInTheDocument());
    expect(within(orphanRow('n1')).getByRole('button', { name: 'Gắn lại' })).toBeInTheDocument();
    const exactBox = within(orphanRow('n1')).getByRole('button', { name: /xem exact gốc/i });
    fireEvent.click(exactBox);
    expect((within(orphanRow('n1')).getByRole('textbox', { name: /đoạn văn gốc/i }) as HTMLTextAreaElement).value).toBe(
      Q_LOST_LONG,
    );
  });

  it('gắn lại KHÔNG BAO GIỜ làm exact nghèo đi: sau mọi lần thử, trích dẫn vẫn còn chữ tìm lại được', async () => {
    await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG), 'ghi chú một');
    render(<Harness html={PROSE_MATH} />);
    await waitForOrphans(1);

    const start = await db.annotations.get('n1');
    expect(hasWordsInIt((start!.anchor as Anchor).exact)).toBe(true);

    fireEvent.click(within(orphanRow('n1')).getByRole('button', { name: 'Gắn lại' }));

    // Every drag a reader might make on a chapter that is mostly formulas, in
    // the order they would make them: the formula alone, then the formula
    // again after a good selection has already armed the button, then real
    // prose. The invariant is checked after EACH one, not only at the end —
    // an `exact` that went to "￼" and came back would still have been on
    // every other device in between.
    for (const attempt of [0, 1]) {
      if (attempt === 1) selectInChapter(TARGET_FIRST);
      selectNodeInChapter(formulaNode(), { announce: attempt === 0 });
      const button = confirmButton();
      if (button) fireEvent.click(button);
      await act(async () => {});
      const row = await db.annotations.get('n1');
      expect(hasWordsInIt((row!.anchor as Anchor).exact)).toBe(true);
    }

    // The rescue the reader eventually makes still works, and it is the one
    // that had words in it.
    selectInChapter(TARGET_FIRST);
    fireEvent.click(await screen.findByRole('button', { name: /gắn vào đây/i }));
    await waitForPlaced(1);
    const done = await db.annotations.get('n1');
    expect((done!.anchor as Anchor).exact).toBe(TARGET_FIRST);
    expect(hasWordsInIt((done!.anchor as Anchor).exact)).toBe(true);
    expect(await db.outbox.count()).toBe(1);
  });
});

/**
 * I1: below 1241px `reader.css` hides `#rail` outright, so this whole panel —
 * heading, count, rows, both buttons — has a rect of 0×0 and is out of the
 * accessibility tree with it. Measured on a real browser at 390, 1024 and
 * 1240: `document.body.innerText` contains the word "Mồ côi" nowhere, and the
 * mobile nav drawer says nothing about notes either.
 *
 * What is fixed here is the SIGNAL, not the rescue surface. A bottom-sheet
 * rescue is a second selection story and a separate task; being told "three of
 * your notes are waiting on a wider screen" costs nothing and is the
 * difference between data that is out of reach and data that looks deleted.
 */
describe('OrphanPanel — màn hẹp phải BIẾT là mình có ghi chú đang chờ', () => {
  it('dưới 1241px: một tín hiệu NGOÀI rãnh, mang đúng số ghi chú và nói phải làm gì', async () => {
    setViewportWidth(PHONE);
    await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG), 'một');
    await seed(makeAnchor(REMOVED_SHORT, Q_LOST_SHORT), 'hai');
    render(<Harness html={PROSE} />);
    await waitForOrphans(2);

    const alert = await screen.findByRole('status', { name: /ghi chú chưa gắn lại được/i });
    // Outside `#rail` — anything inside it is `display:none` at this width and
    // would be exactly as invisible as the count on the tab already is.
    expect(document.querySelector('[data-testid="rail"]')!.contains(alert)).toBe(false);
    expect(alert.textContent).toContain('2');
    // And it says where to go, because there is nothing to do here.
    expect(alert.textContent).toMatch(/màn hình rộng/i);
  });

  it('từ 1241px: không có tín hiệu — mục "Mồ côi" đã ở ngay trên màn hình rồi', async () => {
    setViewportWidth(WIDE);
    await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG), 'một');
    render(<Harness html={PROSE} />);
    await waitForOrphans(1);

    expect(screen.getByRole('region', { name: /mồ côi/i })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /ghi chú chưa gắn lại được/i })).not.toBeInTheDocument();
  });

  it('chương lành trên màn hẹp: không có tín hiệu nào cả', async () => {
    setViewportWidth(PHONE);
    await seed(makeAnchor(PROSE, TARGET_FIRST), 'ghi chú bình thường');
    render(<Harness html={PROSE} />);
    await waitForPlaced(1);

    expect(screen.getByTestId('orphan-count')).toHaveTextContent('0');
    expect(screen.queryByRole('status', { name: /ghi chú chưa gắn lại được/i })).not.toBeInTheDocument();
  });

  it('"Ẩn" tắt tín hiệu và KHÔNG ghi gì — mồ côi vẫn nguyên vẹn dưới đó', async () => {
    setViewportWidth(PHONE);
    await seed(makeAnchor(REMOVED_LONG, Q_LOST_LONG), 'ghi chú quý');
    render(<Harness html={PROSE} />);
    await waitForOrphans(1);

    const alert = await screen.findByRole('status', { name: /ghi chú chưa gắn lại được/i });
    fireEvent.click(within(alert).getByRole('button', { name: /ẩn/i }));

    await waitFor(() =>
      expect(screen.queryByRole('status', { name: /ghi chú chưa gắn lại được/i })).not.toBeInTheDocument(),
    );
    const row = await db.annotations.get('n1');
    expect(row!.deletedAt).toBeNull();
    expect(row!.note).toBe('ghi chú quý');
    expect(row!.updatedAt).toBe('2026-08-19T09:30:00.000Z');
    expect(await db.outbox.count()).toBe(0);
  });
});
