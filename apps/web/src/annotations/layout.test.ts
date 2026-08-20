/**
 * Tests for `layoutCards` (P2 Task 6) — the one piece of the margin-card
 * feature that is pure arithmetic, and therefore the one piece jsdom can
 * judge honestly.
 *
 * Everything else about a margin card (where a highlight is on the page, how
 * tall a card renders) needs a layout engine jsdom does not have. This
 * function is what is left once those two measurements are taken as given,
 * and it is where the interesting failure lives: two notes on adjacent lines
 * produce two cards that would occupy the same 40 pixels of rail, and the
 * rule that separates them has to keep the column readable without ever
 * reordering the reader's notes.
 */
import { describe, expect, it } from 'vitest';
import { type CardMeasure, layoutCards } from './layout';

function m(id: string, y: number, height: number): CardMeasure {
  return { id, y, height };
}

/** `{id: top}`, for assertions that do not care about the array order. */
function tops(items: readonly CardMeasure[], gap?: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const placed of layoutCards(items, gap)) out[placed.id] = placed.top;
  return out;
}

describe('layoutCards', () => {
  it('mảng rỗng → mảng rỗng (không ném, không dựng gì)', () => {
    expect(layoutCards([])).toEqual([]);
  });

  it('không thẻ nào chạm nhau → mỗi thẻ nằm đúng Y của highlight', () => {
    const placed = layoutCards([m('a', 100, 60), m('b', 300, 60), m('c', 500, 60)]);
    expect(placed).toEqual([
      { id: 'a', top: 100 },
      { id: 'b', top: 300 },
      { id: 'c', top: 500 },
    ]);
  });

  it('chạm dây chuyền: mỗi thẻ bị đẩy xuống đáy thẻ trước + gap, cộng dồn', () => {
    // Ba highlight cách nhau 20px nhưng thẻ cao 60px: thẻ hai và thẻ ba
    // không thể nằm đúng chỗ của chúng, và cái đẩy phải CỘNG DỒN — thẻ ba bị
    // đẩy bởi vị trí ĐÃ ĐẨY của thẻ hai, không phải bởi Y gốc của nó.
    expect(layoutCards([m('a', 100, 60), m('b', 120, 60), m('c', 140, 60)], 10)).toEqual([
      { id: 'a', top: 100 },
      { id: 'b', top: 170 },
      { id: 'c', top: 240 },
    ]);
  });

  it('một thẻ cao đẩy cả phần đuôi của dây chuyền', () => {
    expect(tops([m('a', 100, 200), m('b', 150, 40), m('c', 200, 40)], 10)).toEqual({
      a: 100,
      b: 310,
      c: 360,
    });
  });

  it('dây chuyền dừng lại khi có khoảng trống thật: thẻ sau đó về đúng Y của nó', () => {
    expect(tops([m('a', 100, 60), m('b', 120, 60), m('c', 900, 60)], 10)).toEqual({
      a: 100,
      b: 170,
      c: 900,
    });
  });

  it('THỨ TỰ GIỮ NGUYÊN: đầu ra theo đúng thứ tự đầu vào, còn vị trí thì theo Y', () => {
    // Đầu vào lộn xộn (thứ tự này KHÔNG phải thứ tự tài liệu). Đầu ra phải
    // ghép được một-một với đầu vào bằng chỉ số — người gọi zip nó với danh
    // sách ghi chú của mình — nhưng chồng thẻ thì phải theo Y.
    const placed = layoutCards([m('b', 300, 60), m('a', 100, 60), m('c', 320, 60)], 10);
    expect(placed.map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(placed.map((p) => p.top)).toEqual([300, 100, 370]);
  });

  it('không bao giờ đảo chỗ hai thẻ: thẻ có Y nhỏ hơn luôn nằm trên', () => {
    const items = [m('sau', 205, 80), m('truoc', 200, 80)];
    const placed = tops(items, 10);
    expect(placed.truoc).toBeLessThan(placed.sau);
  });

  it('hai thẻ cùng Y → thẻ đứng sau trong đầu vào xuống dưới (sắp xếp ỔN ĐỊNH)', () => {
    // Hai ghi chú trên cùng một dòng — bình thường trong một cuốn giáo trình
    // (một câu, hai người đọc tô hai lần). Không có Y nào phân biệt được
    // chúng, nên thứ tự đầu vào (chính là thứ tự tài liệu mà `list` đưa ra)
    // là thứ duy nhất còn lại để quyết định, và nó phải ổn định.
    expect(layoutCards([m('a', 200, 40), m('b', 200, 40)], 10)).toEqual([
      { id: 'a', top: 200 },
      { id: 'b', top: 250 },
    ]);
  });

  it('gap là tham số thật: gap=0 cho hai thẻ dính nhau mà vẫn không chồng', () => {
    expect(tops([m('a', 100, 40), m('b', 110, 40)], 0)).toEqual({ a: 100, b: 140 });
  });

  it('gap mặc định là 10', () => {
    expect(tops([m('a', 100, 40), m('b', 110, 40)])).toEqual({ a: 100, b: 150 });
  });

  it('KHÔNG BAO GIỜ có hai thẻ chồng lên nhau — quét 200 bố cục giả lập tất định', () => {
    // Một LCG thay cho Math.random: cùng một hạt giống cho cùng một dãy bố
    // cục ở mọi lần chạy, nên một lỗi bắt được ở đây là lỗi tái hiện được.
    let seed = 20260819;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };
    for (let round = 0; round < 200; round++) {
      const count = 1 + next(8);
      const items: CardMeasure[] = [];
      for (let i = 0; i < count; i++) items.push(m(`n${i}`, next(1200), 30 + next(120)));
      const byId = new Map(items.map((item) => [item.id, item]));
      const placed = layoutCards(items, 10);
      const ordered = [...placed].sort((a, b) => a.top - b.top);
      for (let i = 1; i < ordered.length; i++) {
        const above = ordered[i - 1];
        const bottom = above.top + byId.get(above.id)!.height;
        expect(ordered[i].top).toBeGreaterThanOrEqual(bottom + 10);
      }
      // Và không thẻ nào bị KÉO LÊN trên highlight của nó: một thẻ nằm cao
      // hơn chỗ nó chú thích thì đường nối chỉ ngược, còn tệ hơn là chồng.
      for (const p of placed) expect(p.top).toBeGreaterThanOrEqual(byId.get(p.id)!.y);
    }
  });

  it('không sửa mảng đầu vào', () => {
    const items = [m('b', 300, 60), m('a', 100, 60)];
    layoutCards(items, 10);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});
