/**
 * Tests for the margin cards (P2 Task 6) — the shape the whole phase was
 * built for: *"tôi cũng cần phần highlight comment 1 đoạn văn bản, tận dụng
 * phần khoảng trống phía bên phải màn hình để hiển thị comment"*.
 *
 * Three things here are worth more than the rest, because each is a failure
 * that stays green under the obvious test:
 *
 *  1. **Two notes, not one.** A `NormMap` is a snapshot and painting expires
 *     it (ruling P2-F8): every single-note fixture is green against code that
 *     breaks the moment a chapter has a second highlight. Every fixture below
 *     seeds at least two, and the position tests need two by definition —
 *     one card can never collide with itself.
 *  2. **A note inside a collapsed `<details>` is the ORDINARY case, not a
 *     corner.** The corpus ships 255 `<details class="deriv">` and not one of
 *     them carries `open`; 19 of p1-5's 48 paragraphs live inside one. So a
 *     large share of cards have NO coordinate to align to —
 *     `highlightRects` answers with an empty array, which per its own doc
 *     means "exists but is not drawn", not "no such note". The card still has
 *     to appear, say so, and be able to open the block.
 *  3. **jsdom has no layout engine.** Every rect in this file is stubbed, the
 *     same way `painter.test.ts` stubs `getClientRects` for `highlightRects`
 *     — these tests pin the CONTRACT (which measurement goes where), and the
 *     browser run recorded in the task report is what proves the contract
 *     matches a real page. A test that asserted real geometry here would be
 *     asserting that jsdom returns zeros.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AnnotationRow, clearLocalData, db } from '../db/local';
import { type Anchor, type AnchorColor, selectionToAnchor } from './anchor';
import { type CardFocus, DRAFT_KEY, MarginCards } from './MarginCards';
import { normalizeContainer } from './normalize';
import { type ChapterContent, useAnnotations } from './useAnnotations';

/** Wide enough for the rail to exist at all — `reader.css` hides `#rail`
 * under `@media (max-width:1240px)`, and jsdom's own default is 1024, i.e.
 * the MOBILE branch. Without this every "desktop" test here would silently
 * exercise the bottom sheet. */
const WIDE = 1400;
const NARROW = 900;

function setViewportWidth(px: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });
}

const PROSE = [
  '<h2>Chương thử nghiệm</h2>',
  '<p>Entropy đo lượng thông tin trung bình mà một nguồn tin sinh ra.</p>',
  '<p>Độ dài mã tối ưu không thể ngắn hơn entropy của nguồn tin đó.</p>',
  '<p>Kênh nhiễu làm giảm dung lượng truyền tin của toàn hệ thống.</p>',
].join('\n');

/** The shape the corpus actually has: a "Chứng minh" block that is CLOSED on
 * every page load (not one `<details class="deriv">` in the 44 chapters ships
 * `open`), with prose before it that a reader also annotates. */
const WITH_PROOF = [
  '<p>Entropy đo lượng thông tin trung bình mà một nguồn tin sinh ra.</p>',
  '<details class="deriv"><summary>Chứng minh</summary>',
  '<div class="deriv-body"><p>Bổ đề Kraft cho ta bất đẳng thức cần thiết ở đây.</p></div>',
  '</details>',
].join('\n');

const Q_FIRST = 'Entropy đo lượng thông tin';
const Q_SECOND = 'Độ dài mã tối ưu';
const Q_THIRD = 'Kênh nhiễu làm giảm';
const Q_PROOF = 'Bổ đề Kraft';

/** Builds a real `Anchor` through `./anchor`, from a detached copy of the
 * chapter — the same way `useAnnotations.test.tsx` does, and for the same
 * reason: hand-written `{exact, prefix, suffix}` literals would test this
 * file's idea of the collapsed projection instead of the real one. */
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
async function seed(anchor: Anchor, note: string, at = '2026-08-20T10:00:00.000Z'): Promise<AnnotationRow> {
  seq += 1;
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
  await db.annotations.put(row);
  return row;
}

/**
 * Stands in for `ChapterView`: owns the `<div>` React never gives children
 * to, sets the chapter HTML into it imperatively, bumps a revision counter,
 * holds the ONE `useAnnotations` instance and the focused-card state, and
 * mounts `<MarginCards>` where the rail portal would put it.
 */
function Harness({ html, visible = true, onWrite }: { html: string; visible?: boolean; onWrite?: (id: string, text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<ChapterContent>({ root: null, revision: 0 });
  const [focus, setFocus] = useState<CardFocus | null>(null);
  const store = useAnnotations('c1', 'ch1', content);

  // A pass-through recorder for the one thing no clock-based assertion can
  // pin down: WHEN the write was issued. `flush` calls `updateNote`
  // synchronously from whatever called it, so a test can assert "the note had
  // been written before this line ran" with no `waitFor`, no timer, and no
  // wall clock — which is the only way to tell "flushed on unload" apart from
  // "the 600 ms debounce happened to fire while the test was waiting".
  //
  // Kept identity-stable through refs on purpose: `updateNote` is a
  // `useCallback` dependency of `flush`, and a new function every render would
  // re-run the cleanup effect that flushes on every commit, which is a
  // different component under test.
  const spyRef = useRef(onWrite);
  spyRef.current = onWrite;
  const storeRef = useRef(store);
  storeRef.current = store;
  const updateNote = useCallback((id: string, text: string) => {
    spyRef.current?.(id, text);
    return storeRef.current.updateNote(id, text);
  }, []);
  const recorded = useMemo(() => ({ ...store, updateNote }), [store, updateNote]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    setContent((prev) => ({ root: el, revision: prev.revision + 1 }));
  }, [html]);

  return (
    <>
      <div ref={ref} data-testid="chapter" />
      {/* The witness every wait in this file uses. A `<mark>` appearing in
          the chapter is NOT the same event as the store publishing `list`:
          the paint is an imperative DOM write inside the store's effect, and
          `list` reaches this component through a `setState` that needs its own
          commit. Waiting on the mark and then clicking it found a component
          whose `list` was still empty — so the click was ignored and the test
          failed, but only in the full suite, once per few runs. That is
          ruling P2-F15's race in a new file; the fix is the same one, a
          witness that is produced by the STATE. */}
      <output data-testid="published">{store.list.length}</output>
      <aside data-testid="rail">
        <MarginCards content={content} store={recorded} visible={visible} focus={focus} onFocusChange={setFocus} />
      </aside>
    </>
  );
}

function chapterRoot(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="chapter"]');
  if (!el) throw new Error('chapter root chưa render');
  return el;
}

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-ann-card]'));
}

function cardFor(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-ann-card="${id}"]`);
  if (!el) throw new Error(`không có thẻ cho ghi chú ${id}`);
  return el;
}

function marksFor(id: string): HTMLElement[] {
  return Array.from(chapterRoot().querySelectorAll<HTMLElement>(`mark.ann[data-ann-id="${id}"]`));
}

/** Same tool `painter.test.ts` uses: jsdom has no box tree, so the only
 * honest way to test a measurement contract is to supply the measurement. */
function stubRects(el: Element, rects: [number, number, number, number][]): void {
  Object.defineProperty(el, 'getClientRects', {
    configurable: true,
    value: () => rects.map(([x, y, w, h]) => new DOMRect(x, y, w, h)),
  });
}

function stubBox(el: Element, y: number, height: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, y, 260, height),
  });
}

/** Waits until the store has PUBLISHED `count` notes — the only honest signal
 * that a click on a highlight will be recognised, since the component matches
 * the clicked id against `list`. See the `<output>` in `Harness`. */
async function waitForNotes(count: number): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('published')).toHaveTextContent(String(count)));
}

/** `waitForNotes`, then the cards those notes produce. */
async function waitForCards(count: number): Promise<void> {
  await waitForNotes(count);
  await waitFor(() => expect(cards()).toHaveLength(count));
}

/** One animation frame — the throttle every re-measure goes through. */
async function frame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

/**
 * The page going away — the part of the lifecycle jsdom CAN be made to
 * imitate, and the only part these tests need.
 *
 * jsdom has no unload: closing a tab, F5 and Cmd+W all happen outside it, so
 * no test can observe the real teardown. What it does have is the two events
 * the browser fires ON THE WAY there, and those are what the component
 * listens to — so the contract ("the note is written before the page is
 * allowed to go") is testable even though the teardown is not. The browser
 * measurement in the fix report is what proves the contract matches Chromium.
 *
 * `visibilityState` is a getter on `Document.prototype`, so it has to be
 * shadowed on the instance; `afterEach` puts it back.
 */
function hidePage(): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  fireEvent(document, new Event('visibilitychange'));
}

function unloadPage(): void {
  fireEvent(window, new Event('pagehide'));
}

beforeEach(async () => {
  await clearLocalData();
  window.localStorage.removeItem(DRAFT_KEY);
  document.body.innerHTML = '';
  setViewportWidth(WIDE);
  // Reset so ids are `n1`, `n2` in EVERY test, not `n3`, `n4` in the second
  // one — the ids are what the assertions below name.
  seq = 0;
});

afterEach(async () => {
  await clearLocalData();
  setViewportWidth(1024);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('MarginCards — cột thẻ ghi chú', () => {
  it('dựng đúng một thẻ cho mỗi ghi chú, theo thứ tự tài liệu, kèm nội dung/màu/thời gian', async () => {
    // Cố ý seed NGƯỢC thứ tự tài liệu: thứ tự thẻ phải đến từ `list` (đã sắp
    // theo vị trí trong chương), không phải từ thứ tự Dexie trả về.
    await seed(makeAnchor(PROSE, Q_THIRD, 'b'), 'ghi chú ba');
    await seed(makeAnchor(PROSE, Q_FIRST, 'g'), 'ghi chú một');
    render(<Harness html={PROSE} />);
    await waitForCards(2);

    const list = cards();
    expect(list.map((c) => c.dataset.annCard)).toEqual(['n2', 'n1']);
    expect(within(list[0]).getByText('ghi chú một')).toBeInTheDocument();
    expect(within(list[1]).getByText('ghi chú ba')).toBeInTheDocument();
    // Màu viền trái = màu của chính highlight, đọc phòng thủ từ `anchor`
    // (nó là `unknown` suốt đường từ server về).
    expect(list[0].className).toContain('ann-card-g');
    expect(list[1].className).toContain('ann-card-b');
    // Thời gian là <time datetime> — chuỗi hiển thị phụ thuộc múi giờ máy
    // chạy test, thuộc tính thì không.
    expect(list[0].querySelector('time')).toHaveAttribute('datetime', '2026-08-20T10:00:00.000Z');
  });

  it('canh Y theo highlightRects, và ĐẨY XUỐNG khi hai thẻ chạm nhau', async () => {
    await seed(makeAnchor(PROSE, Q_FIRST), 'trên');
    await seed(makeAnchor(PROSE, Q_SECOND), 'dưới');
    render(<Harness html={PROSE} />);
    await waitForCards(2);

    // Hai highlight cách nhau 20px trên trang, thẻ cao 60px ⇒ thẻ thứ hai
    // KHÔNG thể nằm đúng chỗ của nó.
    stubRects(marksFor('n1')[0], [[40, 200, 300, 20]]);
    stubRects(marksFor('n2')[0], [[40, 220, 300, 20]]);
    for (const card of cards()) stubBox(card, 0, 60);
    fireEvent(window, new Event('resize'));
    await frame();

    await waitFor(() => {
      expect(cardFor('n1').style.top).toBe('200px');
      expect(cardFor('n2').style.top).toBe('270px');
    });
    // Đường nối: một cái cho mỗi thẻ, và cái của thẻ bị đẩy phải bắc từ Y
    // của highlight xuống tới thẻ.
    const ties = document.querySelectorAll<HTMLElement>('.ann-tie');
    expect(ties).toHaveLength(2);
    expect(ties[1].style.top).toBe('220px');
    expect(parseFloat(ties[1].style.height)).toBeGreaterThanOrEqual(50);
  });

  it('ghi chú trong khối "Chứng minh" ĐANG ĐÓNG: vẫn có thẻ, có dấu hiệu, và bấm thì MỞ khối ra', async () => {
    await seed(makeAnchor(WITH_PROOF, Q_FIRST), 'ngoài khối');
    await seed(makeAnchor(WITH_PROOF, Q_PROOF), 'trong chứng minh');
    render(<Harness html={WITH_PROOF} />);
    await waitForCards(2);

    const details = chapterRoot().querySelector('details')!;
    expect(details.open).toBe(false);
    // Highlight tồn tại (highlightElements liệt kê nó) nhưng KHÔNG được vẽ
    // (highlightRects rỗng) — trạng thái hợp lệ thứ ba, không phải lỗi.
    expect(marksFor('n2')).toHaveLength(1);

    const card = cardFor('n2');
    expect(card.dataset.anchorKind).toBe('details');
    expect(within(card).getByText(/thu gọn/i)).toBeInTheDocument();
    // Thẻ ngoài khối không được mang dấu hiệu ấy.
    expect(cardFor('n1').dataset.anchorKind).not.toBe('details');

    const mark = marksFor('n2')[0];
    const scrollIntoView = vi.fn();
    Object.defineProperty(mark, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    fireEvent.click(within(card).getByRole('button', { name: /trong chứng minh|Bổ đề Kraft/ }));

    await waitFor(() => expect(details.open).toBe(true));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('hai chiều: bấm thẻ làm nổi highlight, bấm highlight mở thẻ tương ứng', async () => {
    await seed(makeAnchor(PROSE, Q_FIRST), 'thẻ một');
    await seed(makeAnchor(PROSE, Q_SECOND), 'thẻ hai');
    render(<Harness html={PROSE} />);
    await waitForCards(2);

    // Chiều 1: thẻ → highlight.
    fireEvent.click(within(cardFor('n1')).getByRole('button', { name: /thẻ một|Entropy/ }));
    await waitFor(() => expect(marksFor('n1')[0].classList.contains('focus')).toBe(true));
    expect(marksFor('n2')[0].classList.contains('focus')).toBe(false);

    // Chiều 2: highlight → thẻ. Bấm sang highlight kia phải CHUYỂN tiêu điểm,
    // không phải cộng thêm một cái nữa.
    fireEvent.click(marksFor('n2')[0]);
    await waitFor(() => expect(cardFor('n2').dataset.open).toBe('true'));
    expect(cardFor('n1').dataset.open).not.toBe('true');
    expect(marksFor('n1')[0].classList.contains('focus')).toBe(false);
    expect(marksFor('n2')[0].classList.contains('focus')).toBe(true);
  });

  it('thẻ đang mở là Ô NHẬP: gõ rồi rời ô là ghi vào Dexie kèm một dòng outbox', async () => {
    const row = await seed(makeAnchor(PROSE, Q_FIRST), '');
    await seed(makeAnchor(PROSE, Q_SECOND), 'giữ nguyên');
    render(<Harness html={PROSE} />);
    await waitForCards(2);
    expect(await db.outbox.count()).toBe(0);

    fireEvent.click(within(cardFor(row.id)).getByRole('button', { name: /Entropy/ }));
    const box = await screen.findByRole('textbox', { name: /ghi chú/i });
    fireEvent.change(box, { target: { value: 'xem lại chỗ này' } });
    fireEvent.blur(box);

    await waitFor(async () => expect((await db.annotations.get(row.id))?.note).toBe('xem lại chỗ này'));
    expect(await db.outbox.count()).toBe(1);
    // Ghi chú kia không bị đụng tới.
    expect((await db.annotations.get('n2'))?.note).toBe('giữ nguyên');
  });

  it('trang bị ẩn đi giữa lúc đang gõ: ghi chú được ghi NGAY, không chờ hết debounce', async () => {
    // Đây là đường mất dữ liệu duy nhất của cả tính năng, đo được trên
    // Chromium thật: gõ rồi Cmd+W / F5 trong ~600 ms cuối thì mất SẠCH nội
    // dung, im lặng, để lại một thẻ ghi "(chưa có nội dung)". Không blur,
    // không đóng thẻ, không rời chương — chỉ có trang biến mất.
    const row = await seed(makeAnchor(PROSE, Q_FIRST), '');
    await seed(makeAnchor(PROSE, Q_SECOND), 'giữ nguyên');
    const writes: [string, string][] = [];
    render(<Harness html={PROSE} onWrite={(id, text) => writes.push([id, text])} />);
    await waitForCards(2);

    fireEvent.click(within(cardFor(row.id)).getByRole('button', { name: /Entropy/ }));
    const box = await screen.findByRole('textbox', { name: /ghi chú/i });
    fireEvent.change(box, { target: { value: 'nhớ đọc lại' } });
    // Chưa có gì được ghi: đang trong 600 ms debounce, và đây là toàn bộ cửa
    // sổ mất dữ liệu.
    expect(writes).toEqual([]);

    hidePage();

    // KHÔNG `waitFor`, KHÔNG đồng hồ: `flush` gọi `updateNote` đồng bộ ngay
    // trong handler, nên nếu dòng này xanh thì việc ghi đã xảy ra TRƯỚC khi
    // trang được phép biến mất — chứ không phải vì test chờ đủ lâu cho
    // debounce nổ.
    expect(writes).toEqual([[row.id, 'nhớ đọc lại']]);

    await waitFor(async () => expect((await db.annotations.get(row.id))?.note).toBe('nhớ đọc lại'));
    // Và ghi chú kia không bị đụng tới — flush chỉ ghi cái đang mở.
    expect((await db.annotations.get('n2'))?.note).toBe('giữ nguyên');
  });

  it('cửa sổ bị đóng (pagehide) mà chưa từng ẩn: vẫn ghi', async () => {
    // `visibilitychange` là sự kiện đáng tin trên di động, nhưng đóng một cửa
    // sổ desktop có thể đi thẳng tới `pagehide` khi trang vẫn đang HIỆN. Hai
    // sự kiện, không phải một.
    const row = await seed(makeAnchor(PROSE, Q_FIRST), '');
    await seed(makeAnchor(PROSE, Q_SECOND), 'giữ nguyên');
    const writes: [string, string][] = [];
    render(<Harness html={PROSE} onWrite={(id, text) => writes.push([id, text])} />);
    await waitForCards(2);

    fireEvent.click(within(cardFor(row.id)).getByRole('button', { name: /Entropy/ }));
    const box = await screen.findByRole('textbox', { name: /ghi chú/i });
    fireEvent.change(box, { target: { value: 'đóng cửa sổ' } });
    expect(writes).toEqual([]);

    unloadPage();

    expect(writes).toEqual([[row.id, 'đóng cửa sổ']]);
    await waitFor(async () => expect((await db.annotations.get(row.id))?.note).toBe('đóng cửa sổ'));
  });

  it('ẩn rồi mới unload: ĐÚNG MỘT lần ghi, không phải hai dòng outbox', async () => {
    // Chromium bắn `visibilitychange`→hidden RỒI `pagehide` cho cùng một lần
    // đóng tab. Cả hai đều gọi flush, và `list` chưa kịp phát lại giữa hai sự
    // kiện — nếu flush không nhớ nó vừa ghi gì thì mỗi lần đóng tab là hai
    // dòng outbox, tức hai vòng sync cho một ghi chú.
    const row = await seed(makeAnchor(PROSE, Q_FIRST), '');
    await seed(makeAnchor(PROSE, Q_SECOND), 'giữ nguyên');
    const writes: [string, string][] = [];
    render(<Harness html={PROSE} onWrite={(id, text) => writes.push([id, text])} />);
    await waitForCards(2);
    expect(await db.outbox.count()).toBe(0);

    fireEvent.click(within(cardFor(row.id)).getByRole('button', { name: /Entropy/ }));
    const box = await screen.findByRole('textbox', { name: /ghi chú/i });
    fireEvent.change(box, { target: { value: 'một lần thôi' } });

    hidePage();
    unloadPage();

    expect(writes).toEqual([[row.id, 'một lần thôi']]);
    await waitFor(async () => expect((await db.annotations.get(row.id))?.note).toBe('một lần thôi'));
    expect(await db.outbox.count()).toBe(1);
  });

  it('mỗi lần gõ được ghim NGAY vào localStorage — thứ duy nhất sống sót qua F5', async () => {
    // Phép đo trên Chromium thật: IndexedDB **không** ghi được nữa khi trang
    // đang bị thay thế. Ba dạng ghi khác nhau (put đồng bộ ngay trong
    // `pagehide`; get→put; put trong microtask) đều KHÔNG commit khi tải lại
    // hay khi bấm một liên kết ra ngoài — chỉ khi ĐÓNG tab thì hai dạng đầu
    // mới kịp. Một listener gọi flush là cần, nhưng không đủ.
    //
    // Thứ commit được trong CẢ BỐN đường ra là `localStorage`: nó đồng bộ. Nên
    // bản nháp được ghim ở đó ngay từ phím đầu tiên, và cửa sổ mất dữ liệu
    // biến mất hoàn toàn thay vì bị thu hẹp lại.
    const row = await seed(makeAnchor(PROSE, Q_FIRST), '');
    await seed(makeAnchor(PROSE, Q_SECOND), 'giữ nguyên');
    render(<Harness html={PROSE} />);
    await waitForCards(2);

    fireEvent.click(within(cardFor(row.id)).getByRole('button', { name: /Entropy/ }));
    const box = await screen.findByRole('textbox', { name: /ghi chú/i });
    fireEvent.change(box, { target: { value: 'nửa' } });
    // Đồng bộ, ngay trong handler của phím — không `waitFor`, không đồng hồ.
    expect(JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? 'null')).toEqual({ id: row.id, text: 'nửa' });
    fireEvent.change(box, { target: { value: 'nửa câu' } });
    expect(JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? 'null')).toEqual({ id: row.id, text: 'nửa câu' });

    // Ghi được rồi thì bản ghim phải biến đi, nếu không lần mở chương sau sẽ
    // "phục hồi" một bản nháp đã cũ đè lên nội dung mới hơn.
    fireEvent.blur(box);
    await waitFor(async () => expect((await db.annotations.get(row.id))?.note).toBe('nửa câu'));
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('bản nháp sót lại từ phiên trước được nhận về, ghi vào ghi chú, rồi dọn đi', async () => {
    // Đây là nửa còn lại của C1: người đọc gõ rồi F5. IndexedDB không nhận
    // được lần ghi ấy, nhưng bản ghim đồng bộ thì còn — nên lần mở chương sau
    // phải trả lại đúng chữ họ đã gõ, không phải "(chưa có nội dung)".
    const row = await seed(makeAnchor(PROSE, Q_FIRST), '');
    await seed(makeAnchor(PROSE, Q_SECOND), 'giữ nguyên');
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: row.id, text: 'nhớ đọc lại' }));

    render(<Harness html={PROSE} />);
    await waitForCards(2);

    await waitFor(async () => expect((await db.annotations.get(row.id))?.note).toBe('nhớ đọc lại'));
    // Một dòng outbox: bản nháp phục hồi cũng phải đi đồng bộ như mọi sửa đổi
    // khác, không phải chỉ nằm lại trên máy này.
    expect(await db.outbox.count()).toBe(1);
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    // Và ghi chú kia không bị đụng tới.
    expect((await db.annotations.get('n2'))?.note).toBe('giữ nguyên');
  });

  it('bản nháp của một ghi chú KHÔNG thuộc chương này được để nguyên, không nuốt mất', async () => {
    // Một khe duy nhất, dùng chung cho cả app: nếu chương này thấy một bản
    // nháp không phải của mình mà xoá đi, thì ghi chú của chương kia mất thật.
    await seed(makeAnchor(PROSE, Q_FIRST), 'một');
    await seed(makeAnchor(PROSE, Q_SECOND), 'hai');
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: 'của-chương-khác', text: 'chưa lưu' }));

    render(<Harness html={PROSE} />);
    await waitForCards(2);
    await frame();

    expect(JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? 'null')).toEqual({ id: 'của-chương-khác', text: 'chưa lưu' });
    expect(await db.outbox.count()).toBe(0);
  });

  it('xóa từ thẻ: hàng được tombstone (không xóa cứng) và highlight biến mất', async () => {
    const row = await seed(makeAnchor(PROSE, Q_FIRST), 'bỏ đi');
    await seed(makeAnchor(PROSE, Q_SECOND), 'giữ lại');
    render(<Harness html={PROSE} />);
    await waitForCards(2);

    fireEvent.click(within(cardFor(row.id)).getByRole('button', { name: /Entropy/ }));
    fireEvent.click(await within(cardFor(row.id)).findByRole('button', { name: 'Xóa ghi chú' }));

    await waitForCards(1);
    expect(marksFor(row.id)).toHaveLength(0);
    const stored = await db.annotations.get(row.id);
    expect(stored?.deletedAt).not.toBeNull();
    expect(marksFor('n2')).toHaveLength(1);
  });

  it('tab "Trong chương" đang bật (visible=false): không dựng cột thẻ, nhưng bấm highlight vẫn báo ra ngoài', async () => {
    await seed(makeAnchor(PROSE, Q_FIRST), 'một');
    await seed(makeAnchor(PROSE, Q_SECOND), 'hai');
    const view = render(<Harness html={PROSE} visible={false} />);
    await waitForNotes(2);

    expect(cards()).toHaveLength(0);
    // Người đọc bấm vào highlight khi rãnh đang ở tab TOC: Harness lưu tiêu
    // điểm, và khi tab lật sang "Ghi chú" thì thẻ ấy đã mở sẵn.
    fireEvent.click(marksFor('n2')[0]);
    view.rerender(<Harness html={PROSE} visible={true} />);
    await waitForCards(2);
    await waitFor(() => expect(cardFor('n2').dataset.open).toBe('true'));
  });

  it('màn hẹp (<1240px): không có cột thẻ; chạm highlight mở tấm trượt từ dưới lên', async () => {
    setViewportWidth(NARROW);
    await seed(makeAnchor(PROSE, Q_FIRST), 'ghi chú trên điện thoại');
    await seed(makeAnchor(PROSE, Q_SECOND), 'ghi chú kia');
    render(<Harness html={PROSE} />);
    await waitForNotes(2);

    expect(cards()).toHaveLength(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(marksFor('n1')[0]);

    const sheet = await screen.findByRole('dialog', { name: /ghi chú/i });
    // Đúng MỘT ghi chú — của chính highlight vừa chạm, không phải cả chương.
    expect(sheet.dataset.annCard).toBe('n1');
    const box = within(sheet).getByRole('textbox', { name: /ghi chú/i });
    expect(box).toHaveValue('ghi chú trên điện thoại');
    expect(within(sheet).getByText(/Entropy đo lượng thông tin/)).toBeInTheDocument();
    // Sửa được ngay trong tấm trượt — đó là toàn bộ lý do nó tồn tại.
    fireEvent.change(box, { target: { value: 'sửa trên máy nhỏ' } });
    fireEvent.blur(box);
    await waitFor(async () => expect((await db.annotations.get('n1'))?.note).toBe('sửa trên máy nhỏ'));

    fireEvent.click(within(sheet).getByRole('button', { name: /đóng/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('mở/đóng <details> làm trang dàn lại → thẻ được đo lại, không giữ toạ độ cũ', async () => {
    await seed(makeAnchor(WITH_PROOF, Q_FIRST), 'ngoài');
    await seed(makeAnchor(WITH_PROOF, Q_PROOF), 'trong');
    render(<Harness html={WITH_PROOF} />);
    await waitForCards(2);

    const details = chapterRoot().querySelector('details')!;
    stubRects(marksFor('n1')[0], [[40, 100, 300, 20]]);
    stubBox(details, 140, 30);
    for (const card of cards()) stubBox(card, 0, 40);
    fireEvent(window, new Event('resize'));
    await frame();
    await waitFor(() => expect(cardFor('n2').style.top).toBe('150px'));

    // Người đọc mở khối ra: highlight có toạ độ thật, và thẻ phải theo.
    details.open = true;
    stubRects(marksFor('n2')[0], [[40, 400, 300, 20]]);
    // `toggle` KHÔNG nổi bọt — nghe được nó là phải bắt ở pha capture.
    details.dispatchEvent(new Event('toggle'));
    await frame();

    await waitFor(() => {
      expect(cardFor('n2').style.top).toBe('400px');
      expect(cardFor('n2').dataset.anchorKind).toBe('rect');
    });
  });
});
