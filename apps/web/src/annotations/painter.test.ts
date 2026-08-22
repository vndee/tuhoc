import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Anchor, anchorToRange, selectionToAnchor } from './anchor';
import { flatToDom, isMapStale, type NormMap, normalizeContainer } from './normalize';
import { realCourseFile } from '../test/realCourse';
import { highlightElements, highlightRects, paint, paintAll, unpaint } from './painter';

/**
 * Fixture helpers, deliberately duplicated from `normalize.test.ts` /
 * `anchor.test.ts` rather than imported: a test file importing another test
 * file makes the second one's `describe` blocks run twice under vitest. The
 * evidence that `katexSpan` matches real KaTeX output lives in
 * `normalize.test.ts`; the last `describe` in THIS file runs the real
 * `vendor/katex.js` over a real chapter, which is what actually keeps the
 * hand-built fixture honest.
 */
function el(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

function katexSpan(tex: string, visible: string, display = false): string {
  const inner =
    `<span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}>` +
    `<semantics><mrow><mi>${visible}</mi></mrow>` +
    `<annotation encoding="application/x-tex">${tex}</annotation>` +
    `</semantics></math></span>` +
    `<span class="katex-html" aria-hidden="true"><span class="base"><span class="strut"></span>` +
    `<span class="mord mathnormal">${visible}</span></span></span>`;
  const katex = `<span class="katex">${inner}</span>`;
  return display ? `<span class="katex-display">${katex}</span>` : katex;
}

// ---------------------------------------------------------------------------
// Oracles.
//
// The one rule this file follows without exception, because the P2 ledger
// records a review round where a measurement oracle silently compared two
// DIFFERENT text spaces and made a real bug look worse than it was: whenever a
// painted result is compared to a stored `Anchor.exact`, BOTH sides are
// produced by `selectionToAnchor`, i.e. the collapsed projection. Never
// `range.toString()` (raw DOM text) against `exact` (collapsed) — those
// disagree even when nothing at all is wrong.
// ---------------------------------------------------------------------------

type AnchorColorLike = Anchor['color'];

/** Builds an anchor the way the UI will — same helper as `anchor.test.ts`. */
function anchorAt(map: NormMap, from: number, to: number): Anchor | null {
  const range = flatToDom(map, from, to);
  if (!range) return null;
  return selectionToAnchor(map, range, 'y');
}

function anchorFor(map: NormMap, quote: string, color: AnchorColorLike = 'y'): Anchor {
  const from = map.flat.indexOf(quote);
  if (from < 0) throw new Error(`quote not found in raw flat: ${JSON.stringify(quote)}`);
  const a = anchorAt(map, from, from + quote.length);
  if (!a) throw new Error(`could not anchor ${JSON.stringify(quote)}`);
  return { ...a, color };
}

/**
 * What a painted annotation now covers, expressed in the SAME space its
 * `Anchor.exact` is stored in.
 *
 * The span runs from just before the id's first painted element to just after
 * its last, which is what makes gaps the painter deliberately leaves — a
 * newline between two `<p>`s, a formula highlighted by class rather than by
 * `<mark>` — resolve the way the projection resolves them rather than
 * disappearing from the comparison.
 */
function paintedQuote(host: Element, id: string, map?: NormMap): string | null {
  const els = highlightElements(id, host);
  if (els.length === 0) return null;
  const range = (host.ownerDocument ?? document).createRange();
  range.setStartBefore(els[0]);
  range.setEndAfter(els[els.length - 1]);
  // `map` is optional purely for cost: the real-chapter test resolves 40
  // annotations against one freshly built map instead of rebuilding a 20k
  // character projection forty times. Nothing mutates between those calls.
  return selectionToAnchor(map ?? normalizeContainer(host), range, 'y')?.exact ?? null;
}

/**
 * The complementary half of `paintedQuote`: it pins the EXTENT of a highlight
 * (both edges), this pins that there are no HOLES inside it. Returns the data
 * of every text node between the id's first and last painted element that
 * carries a visible character and yet sits outside every `<mark>` of that id.
 *
 * Whitespace-only nodes are exempt on purpose — see `paintable` in
 * `painter.ts`: inter-block indentation is deliberately not wrapped.
 */
function holesInside(host: Element, id: string): string[] {
  const els = highlightElements(id, host);
  if (els.length === 0) return [];
  const range = (host.ownerDocument ?? document).createRange();
  range.setStartBefore(els[0]);
  range.setEndAfter(els[els.length - 1]);

  const holes: string[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const e = node as Element;
        if (e.matches('.katex, .katex-display, .katex-error, .ctrls, .tip, canvas, [data-viz], .readout, .ex-check')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.data.trim() === '') continue;
    if (!range.intersectsNode(text)) continue;
    if (text === range.startContainer && range.startOffset >= text.data.length) continue;
    if (text === range.endContainer && range.endOffset === 0) continue;
    if (text.parentElement?.closest(`mark[data-ann-id="${id}"]`)) continue;
    holes.push(text.data);
  }
  return holes;
}

function marksOf(host: Element, id: string): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('mark.ann')).filter(
    (m) => m.getAttribute('data-ann-id') === id,
  );
}

// ===========================================================================
// Bộ case tối thiểu của brief
// ===========================================================================

const AB_C = '<p>A <b>B</b> C</p>';

describe('paint — hình dạng cơ bản', () => {
  it('range xuyên <p>A <b>B</b> C</p> → 3 mark cùng id, chữ đọc lại nguyên vẹn', () => {
    const host = el(AB_C);
    const before = host.textContent;
    const map = normalizeContainer(host);
    const range = flatToDom(map, 0, map.flat.length)!;

    expect(paint(range, 'n1', 'y')).toBe(3);

    const marks = marksOf(host, 'n1');
    expect(marks).toHaveLength(3);
    expect(marks.map((m) => m.textContent)).toEqual(['A ', 'B', ' C']);
    for (const m of marks) {
      expect(m.className).toBe('ann ann-y');
      expect(m.getAttribute('data-ann-id')).toBe('n1');
    }
    // Painting adds elements, never characters.
    expect(host.textContent).toBe(before);
    expect(host.innerHTML).toBe('<p><mark class="ann ann-y" data-ann-id="n1">A </mark>' +
      '<b><mark class="ann ann-y" data-ann-id="n1">B</mark></b>' +
      '<mark class="ann ann-y" data-ann-id="n1"> C</mark></p>');
  });

  it('4 màu → 4 lớp CSS khác nhau', () => {
    for (const color of ['y', 'g', 'b', 'p'] as const) {
      const host = el('<p>Một câu.</p>');
      const map = normalizeContainer(host);
      paint(flatToDom(map, 0, map.flat.length)!, `id-${color}`, color);
      expect(marksOf(host, `id-${color}`)[0].className).toBe(`ann ann-${color}`);
    }
  });

  it('bôi giữa một text node → cắt đúng 3 mảnh, chỉ mảnh giữa được bọc', () => {
    const host = el('<p>Alpha beta gamma</p>');
    const map = normalizeContainer(host);
    const from = map.flat.indexOf('beta');
    paint(flatToDom(map, from, from + 4)!, 'n1', 'g');
    expect(host.innerHTML).toBe('<p>Alpha <mark class="ann ann-g" data-ann-id="n1">beta</mark> gamma</p>');
  });
});

describe('unpaint', () => {
  it('gỡ xong DOM trở lại y như cũ (chấp nhận normalize())', () => {
    const host = el('<p>Alpha beta gamma</p><p>Delta <i>epsilon</i> zeta</p>');
    const original = host.innerHTML;
    const map = normalizeContainer(host);
    const from = map.flat.indexOf('beta');
    const to = map.flat.indexOf('epsilon') + 'epsilon'.length;
    paint(flatToDom(map, from, to)!, 'n1', 'b');
    expect(host.innerHTML).not.toBe(original);

    expect(unpaint('n1', host)).toBeGreaterThan(0);
    expect(host.innerHTML).toBe(original);
    // normalize() must actually have run: the two halves of "Alpha beta gamma"
    // that splitText produced have to be ONE text node again, or the next
    // NormMap over this container has a different segment count for identical
    // content.
    expect(host.querySelector('p')!.childNodes).toHaveLength(1);
  });

  it('id chứa dấu nháy/gạch chéo không phá truy vấn CSS', () => {
    // `unpaint`/`highlightElements` tra cứu bằng selector thuộc tính; id đi
    // vào đây từ `AnnotationRow.id`, tức là DỮ LIỆU trả về từ server. Một dấu
    // `"` chưa thoát biến truy vấn thành SyntaxError ném ra giữa lúc render.
    const host = el('<p>Alpha beta gamma</p>');
    const map = normalizeContainer(host);
    const weird = 'a"b\\c]d';
    expect(paint(flatToDom(map, 0, map.flat.length)!, weird, 'y')).toBe(1);
    expect(highlightElements(weird, host)).toHaveLength(1);
    expect(highlightElements('a', host)).toHaveLength(0);
    expect(unpaint(weird, host)).toBe(1);
    expect(host.innerHTML).toBe('<p>Alpha beta gamma</p>');
  });

  it('gỡ id không tồn tại là no-op', () => {
    const host = el(AB_C);
    const original = host.innerHTML;
    expect(unpaint('không-có', host)).toBe(0);
    expect(host.innerHTML).toBe(original);
  });

  it('gỡ chỉ đụng vào id được yêu cầu', () => {
    const host = el('<p>Alpha beta gamma delta</p>');
    const map = normalizeContainer(host);
    const a = map.flat.indexOf('Alpha');
    const d = map.flat.indexOf('delta');
    paintAll([
      { range: flatToDom(map, a, a + 5)!, id: 'n1', color: 'y' },
      { range: flatToDom(map, d, d + 5)!, id: 'n2', color: 'g' },
    ]);
    unpaint('n1', host);
    expect(marksOf(host, 'n1')).toHaveLength(0);
    expect(marksOf(host, 'n2')).toHaveLength(1);
    expect(host.textContent).toBe('Alpha beta gamma delta');
  });
});

// ===========================================================================
// KaTeX — quyết định 2
// ===========================================================================

const KATEX_FIX =
  `<div id="c"><p>Xét phân kỳ ${katexSpan('D_{\\mathrm{KL}}(p\\Vert q)', 'DKL(p‖q)')} giữa hai phân phối, ` +
  `và ${katexSpan('H(p,q)', 'H(p,q)')} là đại lượng trung tâm.</p></div>`;

describe('KaTeX — không bọc, nhưng không để thủng lỗ', () => {
  it('không có <mark> nào nằm trong cây DOM của .katex', () => {
    const host = el(KATEX_FIX);
    const map = normalizeContainer(host);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
    for (const m of host.querySelectorAll('mark')) {
      expect(m.closest('.katex')).toBeNull();
      expect(m.closest('.katex-display')).toBeNull();
    }
    expect(host.querySelectorAll('.katex mark')).toHaveLength(0);
  });

  it('công thức nằm TRỌN trong range được gắn class lên chính element, không bọc', () => {
    const host = el(KATEX_FIX);
    const map = normalizeContainer(host);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');

    const formulas = Array.from(host.querySelectorAll('.katex'));
    expect(formulas).toHaveLength(2);
    for (const f of formulas) {
      expect(f.classList.contains('ann-hl')).toBe(true);
      expect(f.classList.contains('ann-hl-y')).toBe(true);
      expect(f.getAttribute('data-ann-ids')).toBe('n1');
      // The class is ADDED, never swapped in: every KaTeX CSS rule is written
      // against `.katex …`, so losing that class would unstyle the formula.
      expect(f.classList.contains('katex')).toBe(true);
    }
  });

  it('không còn lỗ trắng: mọi ký tự nhìn thấy giữa hai đầu highlight đều được tô', () => {
    const host = el(KATEX_FIX);
    const map = normalizeContainer(host);
    const from = map.flat.indexOf('Xét');
    const to = map.flat.indexOf('trung tâm') + 'trung tâm'.length;
    paint(flatToDom(map, from, to)!, 'n1', 'y');
    expect(holesInside(host, 'n1')).toEqual([]);
  });

  it('công thức chỉ giao MỘT PHẦN với range thì không bị tô', () => {
    const host = el(KATEX_FIX);
    const katex = host.querySelector('.katex')!;
    const glyph = katex.querySelector('.katex-html .mord')!.firstChild as Text;
    const range = (host.ownerDocument ?? document).createRange();
    range.setStart(host.querySelector('p')!.firstChild as Text, 0);
    range.setEnd(glyph, 1); // dừng GIỮA cây DOM của công thức
    paint(range, 'n1', 'y');
    expect(katex.classList.contains('ann-hl')).toBe(false);
    expect(host.querySelectorAll('.katex mark')).toHaveLength(0);
  });

  it('công thức display ($$) — class lên .katex-display (token atomic), không lên .katex bên trong', () => {
    const host = el(`<div id="c"><p>Trước.</p>${katexSpan('H(X)', 'H(X)', true)}<p>Sau.</p></div>`);
    const map = normalizeContainer(host);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
    expect(host.querySelector('.katex-display')!.classList.contains('ann-hl')).toBe(true);
    expect(host.querySelector('.katex-display > .katex')!.classList.contains('ann-hl')).toBe(false);
  });

  it('range nằm TRỌN trong cây DOM của công thức → không tô gì, và tuyệt đối không chèn mark vào trong', () => {
    // Một cú kéo chuột từ glyph này sang glyph kia nằm gọn trong `.katex`.
    // `TreeWalker` KHÔNG chạy bộ lọc trên chính gốc của nó, nên nếu painter
    // chỉ dựa vào bộ lọc thì đây là đường đi thẳng vào giữa markup của KaTeX.
    const host = el(KATEX_FIX);
    const original = host.innerHTML;
    const glyph = host.querySelector('.katex-html .mord')!.firstChild as Text;
    const range = (host.ownerDocument ?? document).createRange();
    range.setStart(glyph, 0);
    range.setEnd(glyph, glyph.data.length);
    expect(range.collapsed).toBe(false);

    expect(paint(range, 'n1', 'y')).toBe(0);
    expect(host.querySelectorAll('.katex mark')).toHaveLength(0);
    expect(host.querySelector('.katex')!.classList.contains('ann-hl')).toBe(false);
    expect(host.innerHTML).toBe(original);
  });

  it('range nằm trọn trong một khối minh hoạ [data-viz] → không tô gì', () => {
    const host = el(
      '<div id="c"><p>Trước.</p><div data-viz="kl" data-done="1">' +
        '<div class="ctrls"><label>tham số mu</label></div></div><p>Sau.</p></div>',
    );
    const original = host.innerHTML;
    const label = host.querySelector('.ctrls label')!.firstChild as Text;
    const range = (host.ownerDocument ?? document).createRange();
    range.setStart(label, 0);
    range.setEnd(label, label.data.length);
    expect(paint(range, 'n1', 'y')).toBe(0);
    expect(host.innerHTML).toBe(original);
  });

  it('công thức đứng CUỐI đoạn — mép cuối range trùng khít mép công thức — vẫn được tô', () => {
    // `flatToDom` chỉ sinh ra `setEndAfter(công thức)` khi công thức là token
    // cuối cùng của chương/đoạn; mọi chỗ khác mép cuối rơi vào text node sau
    // nó. Đây là trường hợp DUY NHẤT phép so mép cuối bằng đúng 0, nên là
    // trường hợp duy nhất phân biệt `>= 0` với `> 0` — và câu văn kết thúc
    // bằng công thức thì đầy trong một giáo trình toán.
    const host = el(`<div id="c"><p>Kết thúc bằng ${katexSpan('H(X)', 'H(X)')}</p></div>`);
    const map = normalizeContainer(host);
    expect(map.flat.endsWith('￼')).toBe(true);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
    expect(host.querySelector('.katex')!.classList.contains('ann-hl-y')).toBe(true);
  });

  it('unpaint gỡ sạch class và thuộc tính trên công thức', () => {
    const host = el(KATEX_FIX);
    const original = host.innerHTML;
    const map = normalizeContainer(host);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
    unpaint('n1', host);
    expect(host.innerHTML).toBe(original);
  });

  it('vùng loại trừ (viz/ctrls/canvas) nằm giữa range không bao giờ bị bọc', () => {
    const host = el(
      '<div id="c"><p>Trước hình.</p>' +
        '<div class="fig-body"><div data-viz="kl" data-done="1">' +
        '<div class="relwrap"><canvas></canvas><div class="tip">σ = 1.2</div></div>' +
        '<div class="ctrls"><label>μ</label></div></div></div>' +
        '<p>Sau hình.</p></div>',
    );
    const map = normalizeContainer(host);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
    expect(host.querySelectorAll('[data-viz] mark')).toHaveLength(0);
    expect(host.querySelector('.tip')!.innerHTML).toBe('σ = 1.2');
    expect(host.querySelector('.ctrls')!.innerHTML).toBe('<label>μ</label>');
    expect(marksOf(host, 'n1').map((m) => m.textContent)).toEqual(['Trước hình.', 'Sau hình.']);
  });
});

// ===========================================================================
// ≥2 ghi chú — RÀNG BUỘC CỨNG (ruling P2-F8)
//
// Một ghi chú duy nhất xanh với MỌI công thức, kể cả công thức sai. Lớp lỗi
// này đã cắn một lần ở Task 2: tô một ghi chú rồi tiếp tục dùng map cũ khiến
// `anchorToRange` ném lỗi giữa lúc render chương.
// ===========================================================================

const TWO_NOTES = `<div id="c">
  <p>Entropy đo độ bất định trung bình của một nguồn tin rời rạc.</p>
  <p>Phân kỳ ${katexSpan('D_{\\mathrm{KL}}', 'DKL')} đo cái giá của việc tin sai mô hình.</p>
</div>`;

describe('nhiều ghi chú — vòng lặp hiển nhiên nhất của Task 4', () => {
  it('giải HAI anchor từ cùng một map rồi tô cả hai: cả hai vẫn đúng chữ', () => {
    const host = el(TWO_NOTES);
    const map = normalizeContainer(host);
    const a1 = anchorFor(map, 'độ bất định trung bình');
    const a2 = anchorFor(map, 'cái giá của việc tin sai', 'g');

    const h1 = anchorToRange(map, a1)!;
    const h2 = anchorToRange(map, a2)!;
    expect(h1).not.toBeNull();
    expect(h2).not.toBeNull();

    paintAll([
      { range: h1.range, id: 'n1', color: a1.color },
      { range: h2.range, id: 'n2', color: a2.color },
    ]);

    expect(paintedQuote(host, 'n1')).toBe(a1.exact);
    expect(paintedQuote(host, 'n2')).toBe(a2.exact);
    expect(holesInside(host, 'n1')).toEqual([]);
    expect(holesInside(host, 'n2')).toEqual([]);
  });

  it('BA ghi chú trong CÙNG MỘT text node, giải hết trước rồi tô', () => {
    // Cùng một Text node là trường hợp `splitText` làm hỏng offset của những
    // Range chưa tô — nếu painter không chụp trước khi mutate thì ghi chú thứ
    // hai và thứ ba trượt chữ.
    const host = el('<p>Alpha beta gamma delta epsilon zeta eta theta</p>');
    const map = normalizeContainer(host);
    const words = ['beta', 'delta', 'eta theta'];
    const anchors = words.map((w, i) => anchorFor(map, w, (['y', 'g', 'b'] as const)[i]));
    const items = anchors.map((a, i) => ({ range: anchorToRange(map, a)!.range, id: `n${i}`, color: a.color }));

    paintAll(items);

    for (let i = 0; i < words.length; i++) {
      expect(paintedQuote(host, `n${i}`), `ghi chú #${i}`).toBe(anchors[i].exact);
    }
    expect(host.textContent).toBe('Alpha beta gamma delta epsilon zeta eta theta');
  });

  it('tô tuần tự bằng paint() với Range đã giải TRƯỚC ĐÓ là sai — và test này chứng minh vì sao', () => {
    // Đây là bằng chứng cho quyết định 1. `Range` KHÔNG sống sót qua thao tác
    // bọc: theo đúng spec DOM, gỡ một node ra khỏi cha (điều `mark.appendChild`
    // bắt buộc phải làm) đặt lại mọi live range đang trỏ VÀO node đó về vị trí
    // của node trong cha. Đo được trong jsdom, và đúng như spec nên đúng ở mọi
    // trình duyệt. Vì vậy Task 4 phải gọi `paintAll` một lần, không phải
    // `paint` trong vòng lặp.
    const host = el('<p>Alpha beta gamma delta epsilon zeta eta theta</p>');
    const map = normalizeContainer(host);
    const a1 = anchorFor(map, 'beta gamma delta');
    const a2 = anchorFor(map, 'gamma delta epsilon', 'g'); // CHỒNG LÊN a1
    const r1 = anchorToRange(map, a1)!.range;
    const r2 = anchorToRange(map, a2)!.range;
    expect(r2.toString()).toBe('gamma delta epsilon');

    paint(r1, 'n1', 'y');
    // r2 giờ đã hỏng — đây là hành vi của DOM, không phải của painter.
    expect(r2.toString()).not.toBe('gamma delta epsilon');

    // Còn paintAll thì không: nó chụp mọi Range thành danh sách mảnh TRƯỚC khi
    // đụng vào DOM.
    const host2 = el('<p>Alpha beta gamma delta epsilon zeta eta theta</p>');
    const map2 = normalizeContainer(host2);
    const b1 = anchorFor(map2, 'beta gamma delta');
    const b2 = anchorFor(map2, 'gamma delta epsilon', 'g');
    paintAll([
      { range: anchorToRange(map2, b1)!.range, id: 'n1', color: 'y' },
      { range: anchorToRange(map2, b2)!.range, id: 'n2', color: 'g' },
    ]);
    expect(paintedQuote(host2, 'n1')).toBe(b1.exact);
    expect(paintedQuote(host2, 'n2')).toBe(b2.exact);
  });

  it('map cũ trở nên vô hiệu sau khi tô, và dựng lại map thì mọi anchor giải đúng trở lại', () => {
    const host = el(TWO_NOTES);
    const map = normalizeContainer(host);
    const a1 = anchorFor(map, 'độ bất định trung bình');
    const a2 = anchorFor(map, 'cái giá của việc tin sai', 'g');
    paintAll([
      { range: anchorToRange(map, a1)!.range, id: 'n1', color: 'y' },
      { range: anchorToRange(map, a2)!.range, id: 'n2', color: 'g' },
    ]);

    // Hợp đồng của painter: sau khi tô, mọi NormMap đã chụp là ảnh chụp cũ.
    expect(isMapStale(map)).toBe(true);

    const fresh = normalizeContainer(host);
    expect(isMapStale(fresh)).toBe(false);
    expect(fresh.flat).toBe(map.flat); // bọc <mark> KHÔNG đổi chuỗi phẳng
    for (const a of [a1, a2]) {
      const hit = anchorToRange(fresh, a)!;
      expect(hit).not.toBeNull();
      expect(selectionToAnchor(fresh, hit.range, 'y')!.exact).toBe(a.exact);
    }
  });

  it('paintAll trả về số phần tử đã tạo — 0 nghĩa là DOM không đổi, map vẫn dùng được', () => {
    const host = el('<p>Một câu.</p>');
    const map = normalizeContainer(host);
    expect(paintAll([])).toBe(0);
    expect(isMapStale(map)).toBe(false);

    const collapsed = (host.ownerDocument ?? document).createRange();
    collapsed.setStart(host.querySelector('p')!.firstChild!, 2);
    collapsed.collapse(true);
    expect(paint(collapsed, 'n1', 'y')).toBe(0);
    expect(isMapStale(map)).toBe(false);
  });

  it('0 nghĩa là DOM KHÔNG bị đụng vào — kể cả khi range đã buộc phải cắt text node', () => {
    // `applyCuts` chạy TRƯỚC `paintable`, nên một range mà mọi mảnh đều bị bỏ
    // vẫn kịp gọi splitText. `innerHTML` không đổi (splitText không đổi chuỗi
    // hoá) nhưng NormMap thì chết — đúng cái bẫy mà giá trị trả về sinh ra để
    // báo. Hợp đồng phải đúng như lời nó nói, không phải đúng "gần như".
    const host = el('<div id="c"><p>Trước.</p>\n\t\t<p>Sau.</p></div>');
    const ws = host.querySelectorAll('p')[0].nextSibling as Text;
    expect(ws.data).toBe('\n\t\t');
    const before = { html: host.innerHTML, children: host.querySelector('#c')!.childNodes.length };

    const map = normalizeContainer(host);
    const range = (host.ownerDocument ?? document).createRange();
    range.setStart(ws, 0);
    range.setEnd(ws, 1); // phủ MỘT PHẦN node khoảng trắng giữa hai khối

    expect(paint(range, 'n1', 'y')).toBe(0);
    expect(isMapStale(map)).toBe(false);
    expect(host.innerHTML).toBe(before.html);
    expect(host.querySelector('#c')!.childNodes.length).toBe(before.children);
    expect(ws.data).toBe('\n\t\t');
  });

  it('một node bị cắt NHIỀU LẦN mà không mảnh nào được tô: chữ ghép lại đúng thứ tự', () => {
    // Hai ghi chú, mỗi cái liếm một đầu của cùng một node khoảng trắng giữa hai
    // khối ⇒ hai vết cắt, BA mảnh, không mảnh nào được tô. Ghép lại sai thứ tự
    // cho đúng số ký tự (nên `isMapStale` im lặng) nhưng sai chuỗi.
    const host = el('<div id="c"><p>Trước.</p>\n\t\t\n<p>Sau.</p></div>');
    const ws = host.querySelectorAll('p')[0].nextSibling as Text;
    expect(ws.data).toBe('\n\t\t\n');
    const before = host.innerHTML;
    const map = normalizeContainer(host);

    const doc = host.ownerDocument ?? document;
    const r1 = doc.createRange();
    r1.setStart(ws, 0);
    r1.setEnd(ws, 1);
    const r2 = doc.createRange();
    r2.setStart(ws, 3);
    r2.setEnd(ws, 4);

    expect(
      paintAll([
        { range: r1, id: 'a', color: 'y' },
        { range: r2, id: 'b', color: 'g' },
      ]),
    ).toBe(0);
    expect(ws.data).toBe('\n\t\t\n');
    expect(host.innerHTML).toBe(before);
    expect(host.querySelector('#c')!.childNodes.length).toBe(3);
    expect(isMapStale(map)).toBe(false);
  });

  it('giá trị trả về ĐẾM ĐÚNG số phần tử đã tạo, không đếm mảnh bị bỏ', () => {
    // Mảnh [0,1) của node khoảng trắng giữa hai <p> BỊ CẮT (vì mép range rơi
    // vào giữa nó) rồi mới bị `paintable` loại. Nếu giá trị trả về đếm cả nó
    // thì caller thấy 2 trong khi DOM chỉ có 1 phần tử mới.
    const host = el('<div id="c"><p>Alpha beta</p>\n\t<p>Sau.</p></div>');
    const alpha = host.querySelectorAll('p')[0].firstChild as Text;
    const ws = host.querySelectorAll('p')[0].nextSibling as Text;
    expect(ws.data).toBe('\n\t');

    const range = (host.ownerDocument ?? document).createRange();
    range.setStart(alpha, 6);
    range.setEnd(ws, 1);

    const created = paint(range, 'n1', 'y');
    expect(marksOf(host, 'n1').map((m) => m.textContent)).toEqual(['beta']);
    expect(highlightElements('n1', host)).toHaveLength(1);
    expect(created).toBe(1);
  });

  it('bọc một text node KHÔNG làm trôi mép range nằm ngay SAU node đó', () => {
    // Thứ tự trong `wrapText` — chèn <mark> TRƯỚC node rồi mới chuyển node vào
    // — là load-bearing, không phải sở thích. Báo cáo Task 3 gọi thứ tự ngược
    // lại là "tương đương thật sự" vì `innerHTML` giống hệt: đúng về DOM, SAI
    // về live Range. Chèn SAU thì mép ở dạng (parent, index) ngay sau node bị
    // bọc rơi sang bên kia <mark>, và range đọc ra "aaxbb" thay vì "xbb".
    const host = el('<p>aa<i>x</i>bb</p>');
    const p = host.querySelector('p')!;
    const keep = (host.ownerDocument ?? document).createRange();
    keep.setStart(p, 1);
    keep.setEnd(p, 3);
    expect(keep.toString()).toBe('xbb');

    const other = (host.ownerDocument ?? document).createRange();
    other.selectNodeContents(p.firstChild as Text); // "aa" — KHÔNG phải chữ của keep
    expect(paint(other, 'n1', 'y')).toBe(1);

    expect(keep.startOffset).toBe(1);
    expect(keep.toString()).toBe('xbb');
  });
});

// ===========================================================================
// Ghi chú CHỒNG NHAU — quyết định 3
// ===========================================================================

const OVERLAP_FIX = '<p>Alpha beta gamma delta epsilon zeta</p>';

function paintOverlapping(host: Element, spans: [string, string][]): void {
  const map = normalizeContainer(host);
  paintAll(
    spans.map(([quote, id], i) => {
      const from = map.flat.indexOf(quote);
      return { range: flatToDom(map, from, from + quote.length)!, id, color: (['y', 'g'] as const)[i % 2] };
    }),
  );
}

describe('ghi chú chồng nhau', () => {
  it('chồng MỘT PHẦN: vùng giao có mark lồng nhau, mỗi id vẫn phủ đúng chữ của mình', () => {
    const host = el(OVERLAP_FIX);
    paintOverlapping(host, [
      ['beta gamma delta', 'A'],
      ['gamma delta epsilon', 'B'],
    ]);

    expect(paintedQuote(host, 'A')).toBe('beta gamma delta');
    expect(paintedQuote(host, 'B')).toBe('gamma delta epsilon');
    expect(host.textContent).toBe('Alpha beta gamma delta epsilon zeta');

    // Vùng giao "gamma delta" nằm trong CẢ HAI mark — mark lồng mark, đúng
    // một `<mark>` cho mỗi (ghi chú, mảnh chữ).
    const shared = Array.from(host.querySelectorAll('mark.ann')).filter((m) => m.textContent === 'gamma delta');
    expect(shared).toHaveLength(2);
    const innermost = shared[1];
    expect(innermost.childNodes).toHaveLength(1);
    expect(innermost.firstChild!.nodeType).toBe(Node.TEXT_NODE);
    expect(innermost.closest('mark[data-ann-id="A"]')).not.toBeNull();
    expect(innermost.closest('mark[data-ann-id="B"]')).not.toBeNull();
  });

  it('LỒNG HOÀN TOÀN: B nằm gọn trong A', () => {
    const host = el(OVERLAP_FIX);
    paintOverlapping(host, [
      ['beta gamma delta epsilon', 'A'],
      ['gamma delta', 'B'],
    ]);
    expect(paintedQuote(host, 'A')).toBe('beta gamma delta epsilon');
    expect(paintedQuote(host, 'B')).toBe('gamma delta');
    expect(holesInside(host, 'A')).toEqual([]);
    expect(holesInside(host, 'B')).toEqual([]);
  });

  it('gỡ A rồi gỡ B — B nguyên vẹn sau khi A biến mất, DOM về đúng gốc', () => {
    const host = el(OVERLAP_FIX);
    const original = host.innerHTML;
    paintOverlapping(host, [
      ['beta gamma delta', 'A'],
      ['gamma delta epsilon', 'B'],
    ]);

    unpaint('A', host);
    expect(marksOf(host, 'A')).toHaveLength(0);
    expect(paintedQuote(host, 'B')).toBe('gamma delta epsilon');
    expect(holesInside(host, 'B')).toEqual([]);
    expect(host.textContent).toBe('Alpha beta gamma delta epsilon zeta');

    unpaint('B', host);
    expect(host.innerHTML).toBe(original);
  });

  it('gỡ B rồi gỡ A — thứ tự ngược lại cũng vậy', () => {
    const host = el(OVERLAP_FIX);
    const original = host.innerHTML;
    paintOverlapping(host, [
      ['beta gamma delta', 'A'],
      ['gamma delta epsilon', 'B'],
    ]);

    unpaint('B', host);
    expect(marksOf(host, 'B')).toHaveLength(0);
    expect(paintedQuote(host, 'A')).toBe('beta gamma delta');
    expect(holesInside(host, 'A')).toEqual([]);

    unpaint('A', host);
    expect(host.innerHTML).toBe(original);
  });

  it('lồng hoàn toàn, gỡ cái NGOÀI trước — cái trong không bị kéo theo', () => {
    const host = el(OVERLAP_FIX);
    const original = host.innerHTML;
    paintOverlapping(host, [
      ['beta gamma delta epsilon', 'A'],
      ['gamma delta', 'B'],
    ]);
    unpaint('A', host);
    expect(paintedQuote(host, 'B')).toBe('gamma delta');
    unpaint('B', host);
    expect(host.innerHTML).toBe(original);
  });

  it('cùng một công thức bị hai ghi chú phủ: giữ đủ hai id, gỡ một cái vẫn còn màu của cái kia', () => {
    const host = el(KATEX_FIX);
    const original = host.innerHTML;
    const map = normalizeContainer(host);
    const whole = flatToDom(map, 0, map.flat.length)!;
    const firstKatexFlat = map.flat.indexOf('￼');
    const narrow = flatToDom(map, firstKatexFlat, firstKatexFlat + 1)!;
    paintAll([
      { range: whole, id: 'A', color: 'y' },
      { range: narrow, id: 'B', color: 'g' },
    ]);

    const f = host.querySelector('.katex')!;
    expect(f.getAttribute('data-ann-ids')).toBe('A B');
    expect(f.classList.contains('ann-hl-g')).toBe(true);
    expect(f.classList.contains('ann-hl-y')).toBe(false);

    unpaint('B', host);
    expect(f.getAttribute('data-ann-ids')).toBe('A');
    expect(f.classList.contains('ann-hl-y')).toBe(true);
    expect(f.classList.contains('ann-hl-g')).toBe(false);

    unpaint('A', host);
    expect(host.innerHTML).toBe(original);
  });

  it('tô lại cùng một id hai lần rồi gỡ một lần: không sót mark nào', () => {
    const host = el(OVERLAP_FIX);
    const original = host.innerHTML;
    paintOverlapping(host, [
      ['beta gamma', 'A'],
      ['delta epsilon', 'A'],
    ]);
    expect(marksOf(host, 'A')).toHaveLength(2);
    unpaint('A', host);
    expect(host.innerHTML).toBe(original);
  });

  it('tô cùng một id HAI LẦN lên cùng một công thức: id chỉ vào danh sách một lần', () => {
    // Công thức không lồng được như <mark>, nên nó giữ một DANH SÁCH id. Nếu
    // cùng một id vào danh sách hai lần thì `unpaint` gỡ được một lần và màu
    // dính lại vĩnh viễn — không có cách nào gỡ nốt.
    const host = el(KATEX_FIX);
    const original = host.innerHTML;
    const map = normalizeContainer(host);
    const k = map.flat.indexOf('￼');
    paintAll([
      { range: flatToDom(map, k, k + 1)!, id: 'A', color: 'y' },
      { range: flatToDom(map, k, k + 1)!, id: 'A', color: 'y' },
    ]);
    expect(host.querySelector('.katex')!.getAttribute('data-ann-ids')).toBe('A');
    unpaint('A', host);
    expect(host.innerHTML).toBe(original);
  });

  it('mảnh khoảng trắng nằm giữa mark của CHÍNH ghi chú đó và chữ kế tiếp vẫn được tô', () => {
    // Mảnh [5,6) chỉ tồn tại vì hai ghi chú khác cắt node ở 5 và 6; lúc A tô
    // tới nó thì anh em bên trái đã là <mark> của chính A. Nếu <mark> không
    // được coi là ngữ cảnh inline thì A thủng đúng một dấu cách GIỮA hai từ.
    const host = el('<p>Alpha beta</p>');
    const map = normalizeContainer(host);
    paintAll([
      { range: flatToDom(map, 0, 10)!, id: 'A', color: 'y' },
      { range: flatToDom(map, 0, 5)!, id: 'B', color: 'g' },
      { range: flatToDom(map, 6, 10)!, id: 'C', color: 'b' },
    ]);
    expect(marksOf(host, 'A').map((m) => m.textContent)).toEqual(['Alpha', ' ', 'beta']);
  });
});

// ===========================================================================
// Bẫy endContainer — quyết định 4 (đã ĐO trên chương thật ở Task 2)
// ===========================================================================

describe('bẫy endContainer', () => {
  it('range kết thúc ở offset 0 của text node TIẾP THEO → không tạo mark rỗng', () => {
    const host = el('<div id="c"><p>Câu thứ nhất.</p>\n<p>Câu thứ hai.</p></div>');
    const p1Text = host.querySelectorAll('p')[0].firstChild as Text;
    const between = p1Text.parentElement!.nextSibling as Text; // "\n" giữa hai <p>
    expect(between.data).toBe('\n');

    const range = (host.ownerDocument ?? document).createRange();
    range.setStart(p1Text, 0);
    range.setEnd(between, 0); // đúng hình dạng 6,0% range thật có

    paint(range, 'n1', 'y');
    const marks = marksOf(host, 'n1');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('Câu thứ nhất.');
    for (const m of host.querySelectorAll('mark')) expect(m.textContent).not.toBe('');
  });

  it('range kết thúc trong text node TOÀN khoảng trắng → không đặt <mark> vào ngữ cảnh khối', () => {
    const host = el('<div id="c"><p>Câu thứ nhất.</p>\n<p>Câu thứ hai.</p></div>');
    const p1Text = host.querySelectorAll('p')[0].firstChild as Text;
    const between = p1Text.parentElement!.nextSibling as Text;

    const range = (host.ownerDocument ?? document).createRange();
    range.setStart(p1Text, 0);
    range.setEnd(between, 1); // ăn TRỌN node khoảng trắng

    paint(range, 'n1', 'y');
    // <mark> con trực tiếp của #c sẽ phá `.box > :last-child`, `tr:last-child td`
    // trong reader.css và là HTML không hợp lệ dưới <ul>/<table>.
    expect(host.querySelector('#c > mark')).toBeNull();
    expect(marksOf(host, 'n1').map((m) => m.textContent)).toEqual(['Câu thứ nhất.']);
  });

  it('khoảng trắng GIỮA HAI THẺ INLINE thì vẫn tô — nếu không, highlight thủng một ô trống', () => {
    // 364 chỗ trong 44 chương thật có hình dạng này (`<b>…</b> <span>…</span>`
    // bên trong <p>/<li>/<td>), so với 4.972 chỗ khoảng trắng giữa hai khối.
    const host = el('<p><b>đậm</b> <span>thường</span></p>');
    const map = normalizeContainer(host);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
    expect(marksOf(host, 'n1').map((m) => m.textContent)).toEqual(['đậm', ' ', 'thường']);
    expect(holesInside(host, 'n1')).toEqual([]);
  });

  it('khoảng trắng có MỘT bên là khối thì vẫn bỏ qua, dù bên kia là inline', () => {
    const host = el('<div id="c">Mở đầu <b>đậm</b>\n<p>Đoạn sau.</p></div>');
    const map = normalizeContainer(host);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
    // "Mở đầu " là chữ thật nằm thẳng trong #c ⇒ mark ở đó hợp lệ; còn "\n"
    // ngay trước <p> thì không, dù nó đứng liền sau một thẻ inline.
    expect(marksOf(host, 'n1').map((m) => m.textContent)).toEqual(['Mở đầu ', 'đậm', 'Đoạn sau.']);
  });

  it('chỉ bôi đúng MỘT dấu cách giữa hai từ — vẫn phải tô', () => {
    // Mảnh khoảng trắng có text node ở CẢ HAI bên là khoảng trắng đang hiển
    // thị giữa hai từ, không phải thụt lề giữa hai thẻ.
    const host = el('<p>Alpha beta</p>');
    const map = normalizeContainer(host);
    paint(flatToDom(map, 5, 6)!, 'n1', 'y');
    expect(marksOf(host, 'n1').map((m) => m.textContent)).toEqual([' ']);
    expect(host.innerHTML).toBe('<p>Alpha<mark class="ann ann-y" data-ann-id="n1"> </mark>beta</p>');
  });

  it('hai ghi chú chồng nhau cùng phủ một dấu cách inline: cả hai đều tô nó', () => {
    const host = el('<p><b>đậm</b> <span>thường</span> đuôi</p>');
    const map = normalizeContainer(host);
    const cut = map.flat.indexOf('thường') + 'thường'.length;
    paintAll([
      { range: flatToDom(map, 0, map.flat.length)!, id: 'A', color: 'y' },
      { range: flatToDom(map, 0, cut)!, id: 'B', color: 'g' },
    ]);
    expect(marksOf(host, 'A').map((m) => m.textContent)).toEqual(['đậm', ' ', 'thường', ' đuôi']);
    // B tô ĐÈ lên dấu cách A đã tô: mảnh ấy giờ là con duy nhất của mark A,
    // không còn anh em nào để xét — nhưng A đã xét rồi, và hai bên buộc phải
    // đồng ý, nếu không ghi chú thứ hai thủng một ô mà cái thứ nhất thì không.
    expect(marksOf(host, 'B').map((m) => m.textContent)).toEqual(['đậm', ' ', 'thường']);
  });

  it('bôi xuyên hai <p>: mỗi đoạn một mark, khoảng trắng giữa hai khối bị bỏ qua', () => {
    const host = el('<div id="c"><p>Câu thứ nhất.</p>\n<p>Câu thứ hai.</p></div>');
    const map = normalizeContainer(host);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
    expect(marksOf(host, 'n1').map((m) => m.textContent)).toEqual(['Câu thứ nhất.', 'Câu thứ hai.']);
    expect(host.querySelector('#c > mark')).toBeNull();
    expect(paintedQuote(host, 'n1')).toBe('Câu thứ nhất. Câu thứ hai.');
  });

  it('khoảng trắng không có anh em nào (khối rỗng) thì không tô', () => {
    // Không có bằng chứng nào nói nó đang hiển thị, và bọc nó chỉ thêm một
    // element vào giữa DOM mà `initViz`/`reader.css` có thể đang đếm.
    const host = el('<div id="c"><p>Trước.</p><div class="fig-body">\n</div><p>Sau.</p></div>');
    const map = normalizeContainer(host);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
    expect(host.querySelector('.fig-body')!.innerHTML).toBe('\n');
    expect(marksOf(host, 'n1').map((m) => m.textContent)).toEqual(['Trước.', 'Sau.']);
  });

  it('khoảng trắng đầu dòng sau <br> vẫn là ngữ cảnh inline', () => {
    // 21 chỗ trong 44 chương có đúng hình dạng `P | BR _ B` (18 ở p4-10, 3 ở
    // p1-1) và chúng nằm trong 364 mảnh được tô mà doc của module đếm. Bỏ 'BR'
    // khỏi INLINE_TAGS làm `side()` chấm nó là 'block' và luật "một bên là
    // khối thì bỏ" nuốt mất mảnh này — không test nào bắt được cho tới đây.
    const host = el('<p>Dòng một<br>\n<b>Dòng hai</b></p>');
    const br = host.querySelector('br')!;
    expect((br.nextSibling as Text).data).toBe('\n');

    const map = normalizeContainer(host);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
    expect(marksOf(host, 'n1').map((m) => m.textContent)).toEqual(['Dòng một', '\n', 'Dòng hai']);
  });

  it('không bao giờ đặt <mark> làm con trực tiếp của <ul>/<tbody>', () => {
    const host = el(
      '<div id="c"><ul>\n<li>Mục một</li>\n<li>Mục hai</li>\n</ul>\n' +
        '<table class="tbl"><tbody>\n<tr><td>Ô A</td></tr>\n<tr><td>Ô B</td></tr>\n</tbody></table></div>',
    );
    const map = normalizeContainer(host);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
    expect(host.querySelectorAll('ul > mark')).toHaveLength(0);
    expect(host.querySelectorAll('tbody > mark')).toHaveLength(0);
    expect(host.querySelectorAll('tr > mark')).toHaveLength(0);
    expect(host.querySelectorAll('table > mark')).toHaveLength(0);
    expect(marksOf(host, 'n1').map((m) => m.textContent)).toEqual(['Mục một', 'Mục hai', 'Ô A', 'Ô B']);
  });
});

// ===========================================================================
// highlightRects — quyết định 5
// ===========================================================================

function stubRects(el2: Element, rects: [number, number, number, number][]): void {
  Object.defineProperty(el2, 'getClientRects', {
    configurable: true,
    value: () => rects.map(([x, y, w, h]) => new DOMRect(x, y, w, h)),
  });
}

describe('highlightRects', () => {
  it('trả toạ độ TÀI LIỆU (cộng scroll), không phải toạ độ viewport', () => {
    const host = el(AB_C);
    document.body.appendChild(host);
    try {
      const map = normalizeContainer(host);
      paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
      const marks = marksOf(host, 'n1');
      stubRects(marks[0], [[10, 20, 30, 14]]);
      stubRects(marks[1], [[40, 20, 8, 14]]);
      stubRects(marks[2], [[48, 20, 20, 14]]);

      const atTop = highlightRects('n1', host);
      expect(atTop.map((r) => [r.x, r.y, r.width, r.height])).toEqual([
        [10, 20, 30, 14],
        [40, 20, 8, 14],
        [48, 20, 20, 14],
      ]);

      // Cuộn trang: getClientRects (viewport) sẽ đổi, nhưng câu trả lời của
      // highlightRects phải GIỮ NGUYÊN vị trí trong tài liệu. Mô phỏng bằng
      // cách dời rect lên 500px đúng như trình duyệt làm, và đặt scrollY=500.
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 });
      Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
      stubRects(marks[0], [[10, -480, 30, 14]]);
      stubRects(marks[1], [[40, -480, 8, 14]]);
      stubRects(marks[2], [[48, -480, 20, 14]]);
      const scrolled = highlightRects('n1', host);
      expect(scrolled.map((r) => [r.x, r.y])).toEqual([
        [10, 20],
        [40, 20],
        [48, 20],
      ]);
    } finally {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
      host.remove();
    }
  });

  it('một mark xuống dòng cho nhiều rect; thứ tự là thứ tự tài liệu', () => {
    const host = el(AB_C);
    const map = normalizeContainer(host);
    paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
    const marks = marksOf(host, 'n1');
    stubRects(marks[0], [
      [10, 20, 100, 14],
      [0, 40, 30, 14],
    ]);
    stubRects(marks[1], []);
    stubRects(marks[2], [[30, 40, 20, 14]]);
    expect(highlightRects('n1', host).map((r) => [r.x, r.y])).toEqual([
      [10, 20],
      [0, 40],
      [30, 40],
    ]);
  });

  it('công thức được tô cũng có rect (không thì thẻ lề canh Y sai chỗ)', () => {
    const host = el(KATEX_FIX);
    const map = normalizeContainer(host);
    const k = map.flat.indexOf('￼');
    paint(flatToDom(map, k, k + 1)!, 'n1', 'y');
    const els = highlightElements('n1', host);
    expect(els).toHaveLength(1);
    expect(els[0].classList.contains('katex')).toBe(true);
    stubRects(els[0], [[5, 60, 44, 18]]);
    expect(highlightRects('n1', host).map((r) => [r.x, r.y, r.width, r.height])).toEqual([[5, 60, 44, 18]]);
  });

  it('id chưa tô → mảng rỗng, không ném', () => {
    const host = el(AB_C);
    expect(highlightRects('không-có', host)).toEqual([]);
    expect(highlightElements('không-có', host)).toEqual([]);
  });
});

// ===========================================================================
// Highlight trong khối đang THU GỌN.
//
// Đo trên Chromium thật, cả 44 chương, một highlight cho mỗi <details> đóng:
// 254/254 highlight trả về rect KHÔNG rỗng, và 254/254 trả
// `checkVisibility() === false`. Rect ấy trỏ vào khoảng trống giữa hộp
// <details> đã thu gọn và đoạn văn kế tiếp, vì Chrome dựng thân <details> đóng
// bằng `content-visibility`: nó bỏ phần VẼ nhưng giữ hình học của con cháu.
// Corpus có 255 <details class="deriv"> và KHÔNG cái nào mang `open`.
//
// `Element.checkVisibility` không tồn tại trong jsdom 30 (không có engine dàn
// trang để trả lời), nên nó được stub ở đây đúng cách `stubRects` stub
// `getClientRects` — test ghim HỢP ĐỒNG, còn phép đo trên trình duyệt là thứ
// chứng minh hợp đồng ấy khớp với Chrome.
// ===========================================================================

function stubVisibility(target: Element, visible: boolean): void {
  Object.defineProperty(target, 'checkVisibility', { configurable: true, value: () => visible });
}

const DETAILS_FIX =
  '<div id="c"><details class="deriv"><summary>Chứng minh</summary>' +
  '<div class="deriv-body"><p>Bước một của chứng minh.</p></div></details>' +
  '<p id="after">Đoạn văn kế tiếp.</p></div>';

describe('highlightRects — highlight không hiển thị được', () => {
  it('trả MẢNG RỖNG, không phải một toạ độ trông hợp lệ mà trỏ vào chỗ trống', () => {
    const host = el(DETAILS_FIX);
    document.body.appendChild(host);
    try {
      const map = normalizeContainer(host);
      const from = map.flat.indexOf('Bước một');
      expect(paint(flatToDom(map, from, from + 8)!, 'H', 'y')).toBe(1);

      const mark = marksOf(host, 'H')[0];
      stubRects(mark, [[89.5, 121.4, 70.6, 22.5]]); // đúng thứ Chrome trả về
      stubVisibility(mark, false);
      expect(highlightRects('H', host)).toEqual([]);

      // …và khi người đọc mở khối ra thì toạ độ ấy mới có nghĩa.
      stubVisibility(mark, true);
      expect(highlightRects('H', host).map((r) => [r.x, r.y])).toEqual([[89.5, 121.4]]);
    } finally {
      host.remove();
    }
  });

  it('mảng rỗng là trạng thái HỢP LỆ — highlightElements phân biệt "thu gọn" với "chưa tô"', () => {
    const host = el(DETAILS_FIX);
    document.body.appendChild(host);
    try {
      const map = normalizeContainer(host);
      const from = map.flat.indexOf('Bước một');
      paint(flatToDom(map, from, from + 8)!, 'H', 'y');
      const mark = marksOf(host, 'H')[0];
      stubRects(mark, [[10, 20, 30, 14]]);
      stubVisibility(mark, false);

      // Đang được tô, chỉ là không vẽ ra ở đâu cả.
      expect(highlightRects('H', host)).toEqual([]);
      expect(highlightElements('H', host)).toHaveLength(1);

      // Không hề được tô — cùng mảng rỗng, khác ý nghĩa.
      expect(highlightRects('không-có', host)).toEqual([]);
      expect(highlightElements('không-có', host)).toHaveLength(0);
    } finally {
      host.remove();
    }
  });

  it('công thức được tô cũng bị loại, không riêng <mark>', () => {
    const host = el(
      '<div id="c"><details class="deriv"><summary>S</summary><div class="deriv-body">' +
        `<p>Ta có ${katexSpan('p', 'p')} xong.</p></div></details></div>`,
    );
    document.body.appendChild(host);
    try {
      const map = normalizeContainer(host);
      const k = map.flat.indexOf('￼');
      paint(flatToDom(map, k, k + 1)!, 'F', 'g');
      const els = highlightElements('F', host);
      expect(els).toHaveLength(1);
      stubRects(els[0], [[5, 60, 44, 18]]);
      stubVisibility(els[0], false);
      expect(highlightRects('F', host)).toEqual([]);
    } finally {
      host.remove();
    }
  });

  it('lọc theo TỪNG phần tử: phần hiển thị được vẫn trả toạ độ của nó', () => {
    const host = el(AB_C);
    document.body.appendChild(host);
    try {
      const map = normalizeContainer(host);
      paint(flatToDom(map, 0, map.flat.length)!, 'n1', 'y');
      const marks = marksOf(host, 'n1');
      expect(marks).toHaveLength(3);
      marks.forEach((m, i) => {
        stubRects(m, [[10 * i, 20, 8, 14]]);
        stubVisibility(m, i !== 1);
      });
      expect(highlightRects('n1', host).map((r) => r.x)).toEqual([0, 20]);
    } finally {
      host.remove();
    }
  });
});

// ===========================================================================
// Chương THẬT, KaTeX THẬT.
// Harness giống anchor.test.ts: nạp vendor/katex.js + auto-render.js vào jsdom
// bằng `new Function(src).call(globalThis)` và gọi renderMathInElement với
// ĐÚNG bộ option của packages/course-kit/runtime.js:319-333.
// ===========================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
// Chương THẬT, không phải fixture — và từ task 11 nó không nằm trong repo nữa.
// `realCourseFile` giải đường dẫn trong thư mục làm việc `courses/`, và ném ra
// câu chỉ đúng lệnh phải chạy khi gói chưa được nạp về. Xem
// apps/web/src/test/realCourse.ts.
const CHAPTER = realCourseFile('chapters/p1-5.html');

let katexLoaded = false;
function loadKatex(): void {
  if (katexLoaded) return;
  new Function(readFileSync(resolve(REPO, 'packages/course-kit/vendor/katex.js'), 'utf8')).call(globalThis);
  new Function(readFileSync(resolve(REPO, 'packages/course-kit/vendor/auto-render.js'), 'utf8')).call(globalThis);
  katexLoaded = true;
}

function renderChapter(html: string): HTMLDivElement {
  loadKatex();
  const host = document.createElement('div');
  host.innerHTML = html;
  (globalThis as unknown as { renderMathInElement: (el: Element, o: unknown) => void }).renderMathInElement(host, {
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
  return host;
}

/** Deterministic PRNG — same shape as `anchor.test.ts`'s, so the two files
 * draw the same kind of selections. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Ngân sách CHẠY cho hai bài chương-thật dưới đây. Không phải một khẳng định,
 * và không có khẳng định nào về tốc độ ở đây — cùng loại với ruling P2-F16.
 *
 * Vì sao con số cũ (60 s) chưa đủ, đo chứ không đoán. Thân bài "tô 40 ghi
 * chú" là CPU thuần, đồng bộ từ đầu đến cuối: không `waitFor`, không hẹn giờ,
 * không I/O. Đây là phân rã một lần chạy nhàn (tổng 5 344 ms):
 *
 *     renderChapter (KaTeX thật, 263 công thức)      256 ms
 *     normalizeContainer                              38 ms
 *     paintAll (40 ghi chú)                           68 ms
 *     paintedQuote × 40   (khẳng định "đúng chỗ")  1 552 ms
 *     holesInside  × 40   (khẳng định "không thủng")1 641 ms
 *     unpaint      × 40   (khẳng định "khôi phục") 1 667 ms
 *     (loadKatex chỉ 11 ms — KHÔNG có phần nhập nguội nào để hâm sẵn, nên
 *      cách chữa của `syncLifecycle.test.tsx` không áp được vào đây)
 *
 * Ba dòng tốn nhất là ba khẳng định trung tâm của bài. Không cắt được dòng
 * nào mà không làm yếu bài, nên thứ phải sửa là cái trần.
 *
 * Đo trên máy này, `bun run test` đầy đủ (thời gian THỰC của thân bài; lưu ý
 * con số vitest in ra khi nó CẮT một bài là lúc nó bỏ cuộc, không phải lúc
 * bài xong — nên mọi số dưới đây lấy từ những lượt chạy KHÔNG bị cắt):
 *
 *     máy rảnh (load 13–30)                      8 268 – 17 342 ms, 10 lượt
 *     16 tiến trình quay CPU trên 8 lõi (load 34–58,
 *       đúng mức tải lần nghiệm thu báo đỏ)  41 190 / 43 461 ms ← 69–72 % trần cũ
 *     20 tiến trình quay CPU (load 66–130)      31 861 – 60 121 ms, 12 lượt
 *
 * Trần cũ 60 s nằm ngay giữa dải đó. Ở mức tải người dùng gặp nó chỉ còn
 * ~1,4×, và lượt đo 60 121 ms ở trên là một lượt **xanh với trần mới** mà
 * trần cũ đã cắt. Trước khi sửa, cùng điều kiện ấy cho 3 lượt đỏ trên 8, đúng
 * nguyên văn "Test timed out in 60000ms.".
 *
 * Con số mới lấy theo tỉ lệ mà repo này đã chấp nhận: `testTimeout` 30 s của
 * `vite.config.ts` phủ những thân bài nhàn dưới 1 s, tức ≥30×. Áp đúng tỉ lệ
 * ấy cho thân bài ~6,4 s ⇒ ≥193 s; làm tròn lên 240 s. So lại: 4,0× lần tệ
 * nhất từng đo được (60 121 ms) và 13,8× lần tệ nhất khi không ép tải.
 *
 * Nới trần này không giấu được gì. Thân bài đồng bộ nên thứ duy nhất một
 * `testTimeout` bắt được ở đây là vòng lặp vô hạn trong `paint`/`unpaint`/
 * `normalize` — mà vòng lặp vô hạn thì không ngân sách hữu hạn nào "bắt"
 * được, chỉ là báo sớm hay muộn. Mọi khẳng định bên dưới giữ nguyên từng chữ.
 */
const REAL_CHAPTER_MS = 240_000;

describe('chương thật p1-5.html với KaTeX thật', () => {
  const SOURCE = readFileSync(CHAPTER, 'utf8');

  it('tô 40 ghi chú trong MỘT lượt: chữ không đổi, mọi ghi chú đúng chỗ, gỡ ra khôi phục đúng', () => {
    const host = renderChapter(SOURCE);
    const originalHtml = host.innerHTML;
    const originalText = host.textContent;
    const map = normalizeContainer(host);
    expect(map.flat.length).toBeGreaterThan(10000);

    const rand = rng(20260820);
    const items: { range: Range; id: string; color: AnchorColorLike }[] = [];
    const anchors: Anchor[] = [];
    const palette = ['y', 'g', 'b', 'p'] as const;
    for (let k = 0; k < 200 && anchors.length < 40; k++) {
      const len = 8 + Math.floor(rand() * 180);
      const from = Math.floor(rand() * Math.max(1, map.flat.length - len - 1));
      const a = anchorAt(map, from, from + len);
      if (!a) continue;
      const hit = anchorToRange(map, a);
      if (!hit) continue;
      const color = palette[anchors.length % 4];
      items.push({ range: hit.range, id: `real-${anchors.length}`, color });
      anchors.push({ ...a, color });
    }
    expect(anchors.length).toBe(40);

    const created = paintAll(items);
    expect(created).toBeGreaterThan(40);

    // 1. Tô không đổi một ký tự nào của chương.
    expect(host.textContent).toBe(originalText);
    // 2. Không có <mark> nào lọt vào cây DOM của KaTeX.
    expect(host.querySelectorAll('.katex mark')).toHaveLength(0);
    expect(host.querySelectorAll('[data-viz] mark')).toHaveLength(0);
    // 3. Không có mark rỗng, và không có mark nào là con trực tiếp của một
    //    thẻ khối chỉ chứa khối (bẫy `.box > :last-child` / `<ul> > mark`).
    for (const m of host.querySelectorAll('mark.ann')) {
      expect(m.textContent).not.toBe('');
      expect(['UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TR']).not.toContain(m.parentElement!.tagName);
    }
    // 4. Chuỗi phẳng không đổi ⇒ mọi anchor cũ vẫn giải được trên map MỚI.
    const fresh = normalizeContainer(host);
    expect(fresh.flat).toBe(map.flat);
    expect(isMapStale(map)).toBe(true);
    expect(isMapStale(fresh)).toBe(false);

    // 5. Mỗi ghi chú phủ ĐÚNG đoạn chữ của nó, đo trong cùng một không gian.
    for (let i = 0; i < anchors.length; i++) {
      expect(paintedQuote(host, `real-${i}`, fresh), `ghi chú #${i}`).toBe(anchors[i].exact);
      expect(holesInside(host, `real-${i}`), `ghi chú #${i}`).toEqual([]);
    }

    // 6. Gỡ hết → DOM trở về y như trước khi tô.
    for (let i = 0; i < anchors.length; i++) unpaint(`real-${i}`, host);
    expect(host.querySelectorAll('mark.ann')).toHaveLength(0);
    expect(host.querySelectorAll('[data-ann-ids]')).toHaveLength(0);
    expect(host.querySelectorAll('.ann-hl')).toHaveLength(0);
    expect(host.innerHTML).toBe(originalHtml);
  }, REAL_CHAPTER_MS);

  it('tô rồi gỡ theo thứ tự NGẪU NHIÊN vẫn khôi phục nguyên trạng', () => {
    const host = renderChapter(SOURCE);
    const originalHtml = host.innerHTML;
    const map = normalizeContainer(host);

    const rand = rng(777);
    const items: { range: Range; id: string; color: AnchorColorLike }[] = [];
    for (let k = 0; k < 200 && items.length < 25; k++) {
      const len = 20 + Math.floor(rand() * 400); // dài hơn ⇒ chồng nhau nhiều hơn
      const from = Math.floor(rand() * Math.max(1, map.flat.length - len - 1));
      const a = anchorAt(map, from, from + len);
      if (!a) continue;
      const hit = anchorToRange(map, a);
      if (!hit) continue;
      items.push({ range: hit.range, id: `ov-${items.length}`, color: 'y' });
    }
    expect(items.length).toBe(25);
    paintAll(items);

    const order = items.map((it) => it.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const id of order) unpaint(id, host);
    expect(host.innerHTML).toBe(originalHtml);
  }, REAL_CHAPTER_MS);
});
