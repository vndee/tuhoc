import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type Anchor,
  anchorToRange,
  isMapStale,
  levenshtein,
  selectionToAnchor,
  StaleNormMapError,
} from './anchor';
import { flatToDom, normalizeContainer, rangeToFlat } from './normalize';

/**
 * Fixture helpers. `el` and `katexSpan` are deliberately duplicated from
 * `normalize.test.ts` rather than imported from it — a test file importing
 * another test file makes the second one's `describe` blocks run twice
 * under vitest. `katexSpan`'s shape (and the evidence that it matches real
 * KaTeX output) is documented at length there; the last `describe` block in
 * THIS file runs the real `vendor/katex.js` over a real chapter, which is
 * what actually guarantees the fixture is not lying.
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

/** Builds an anchor the way the UI will: normalize, pick a flat span, turn
 * it into a Range, hand that to `selectionToAnchor`. Using `flatToDom` (not
 * a hand-built Range) means every fixture selection goes through exactly
 * the same snapping rules a real mouse drag does. */
function anchorAt(map: ReturnType<typeof normalizeContainer>, from: number, to: number): Anchor | null {
  const range = flatToDom(map, from, to);
  if (!range) return null;
  return selectionToAnchor(map, range, 'y');
}

/**
 * The round-trip oracle used by almost every test below, and the reason
 * none of them needs access to anchor.ts's internals: re-describing the
 * range an anchor resolved to must reproduce the SAME `exact` string. It
 * checks the whole loop — projection, offset mapping back to raw `flat`,
 * `flatToDom`, and the projection again — with nothing but the public API.
 */
function describeResolved(map: ReturnType<typeof normalizeContainer>, range: Range): string | null {
  return selectionToAnchor(map, range, 'y')?.exact ?? null;
}

/** Reference Levenshtein — full O(n·m) DP, no band, no early exit. Exists
 * to cross-check the banded/early-cutting implementation on random inputs;
 * a band bug that only shows up off the main diagonal is exactly the kind
 * of thing hand-picked cases miss. */
function refLevenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Deterministic PRNG (mulberry32) — the real-chapter sweep must sample the
 * same few dozen selections on every run, or a failure could not be
 * reproduced from the report. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Task 3's painter, in miniature — and the exact DOM operation that turns a
 * `NormMap` into a snapshot of a DOM that no longer exists.
 * `Range.surroundContents` extracts the covered text and re-inserts it under
 * a `<mark>`, which SPLITS the Text node the range started in: the original
 * node keeps only the characters before the highlight, while `map.segs`
 * still records its old length.
 */
function paint(range: Range): HTMLElement {
  const mark = document.createElement('mark');
  range.surroundContents(mark);
  return mark;
}

/**
 * Deterministic pseudo-prose. The perf fixtures elsewhere in this file
 * repeat one paragraph verbatim, which is fine for measuring cost but
 * useless for the fuzzy tier: a quote taken from a periodic text still
 * occurs VERBATIM at the next period after an edit, so the exact tier
 * answers and the fuzzy tier is never reached. Random word order makes a
 * 2.500-character quote unique in the chapter, which is what a real
 * paragraph is.
 */
function prose(seed: number, words: number): string {
  const bag = [
    'phân', 'kỳ', 'entropy', 'chéo', 'mô', 'hình', 'sinh', 'giá', 'đỡ', 'ước', 'lượng', 'bit',
    'lãng', 'phí', 'ký', 'hiệu', 'thông', 'tin', 'tương', 'hỗ', 'điều', 'kiện', 'bất', 'đẳng',
    'thức', 'cận', 'dưới', 'chi', 'phí', 'tin', 'sai', 'khoảng', 'cách', 'biến', 'phân', 'chuẩn',
    'hoá', 'xác', 'suất', 'hậu', 'nghiệm', 'tiên', 'tổng', 'quát', 'độ', 'dài', 'trung', 'bình',
  ];
  const rand = rng(seed);
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(bag[Math.floor(rand() * bag.length)]);
  return out.join(' ');
}

const PROSE = `<div id="c"><p>Xét phân kỳ ${katexSpan('D_{\\mathrm{KL}}(p\\Vert q)', 'DKL(p‖q)')} giữa hai phân phối,
và ${katexSpan('H(p,q)', 'H(p,q)')} là đại lượng trung tâm của chương này.</p>
<p>Đoạn thứ hai nói về cross-entropy và số bit lãng phí mỗi ký hiệu.</p></div>`;

describe('levenshtein', () => {
  it('khoảng cách cơ bản', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('a', '')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('mô hình', 'mô hìn')).toBe(1);
    expect(levenshtein('mô hình', 'mo hinh')).toBe(2);
  });

  it('đối xứng', () => {
    expect(levenshtein('phân kỳ', 'phan ky')).toBe(levenshtein('phan ky', 'phân kỳ'));
  });

  it('cắt sớm: vượt ngưỡng trả max+1, KHÔNG trả khoảng cách thật', () => {
    // Đây là hợp đồng mà nhánh fuzzy dựa vào để chặn chi phí: khi đã biết
    // chắc "xa hơn ngưỡng" thì dừng, đừng chạy nốt bảng DP.
    expect(levenshtein('a'.repeat(400), 'b'.repeat(400), 2)).toBe(3);
    expect(levenshtein('abcdefghij', 'zzzzzzzzzz', 3)).toBe(4);
    // Chênh lệch độ dài lớn hơn ngưỡng thì thậm chí không cần chạy DP.
    expect(levenshtein('abc', 'abc' + 'x'.repeat(50), 5)).toBe(6);
  });

  it('trong ngưỡng vẫn trả khoảng cách CHÍNH XÁC, không phải "đạt/không đạt"', () => {
    expect(levenshtein('mô hình sinh', 'mô hình sịnh', 5)).toBe(1);
    expect(levenshtein('cross-entropy', 'cross entropy', 5)).toBe(1);
    expect(levenshtein('abcdef', 'abXdef', 1)).toBe(1);
  });

  it('bản có dải băng khớp bản DP đầy đủ trên 200 cặp chuỗi ngẫu nhiên', () => {
    const rand = rng(20260820);
    const alphabet = 'abcđêôư ￼';
    const make = (n: number) =>
      Array.from({ length: n }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
    for (let k = 0; k < 200; k++) {
      const a = make(1 + Math.floor(rand() * 20));
      const b = make(1 + Math.floor(rand() * 20));
      const want = refLevenshtein(a, b);
      expect(levenshtein(a, b)).toBe(want);
      // Với ngưỡng đủ rộng, kết quả phải y hệt bản đầy đủ.
      expect(levenshtein(a, b, 40)).toBe(want);
      // Với ngưỡng chật, hoặc đúng khoảng cách thật, hoặc đúng max+1.
      const tight = levenshtein(a, b, 2);
      expect(tight).toBe(want <= 2 ? want : 3);
    }
  });
});

describe('selectionToAnchor — tạo anchor', () => {
  it('trích exact + prefix + suffix + color từ một đoạn chọn văn xuôi', () => {
    const m = normalizeContainer(el(PROSE));
    const i = m.flat.indexOf('hai phân phối');
    const a = anchorAt(m, i, i + 'hai phân phối'.length)!;
    expect(a).not.toBeNull();
    expect(a.exact).toBe('hai phân phối');
    expect(a.color).toBe('y');
    expect(a.prefix.endsWith('giữa ')).toBe(true);
    expect(a.suffix.startsWith(',')).toBe(true);
    expect(a.prefix.length).toBeLessThanOrEqual(32);
    expect(a.suffix.length).toBeLessThanOrEqual(32);
  });

  it('rangeToFlat trả null ⇒ selectionToAnchor trả null, không chế biến tiếp', () => {
    const host = el(`<section id="ch"><p>Nội dung chương thật.</p></section><aside id="rail"><a>Mục lục</a></aside>`);
    const root = host.querySelector('#ch')!;
    const m = normalizeContainer(root);

    // (1) mép ngoài root
    const outside = document.createRange();
    outside.setStart(root.querySelector('p')!.firstChild as Text, 0);
    outside.setEnd(host.querySelector('#rail a')!.firstChild as Text, 2);
    expect(rangeToFlat(m, outside)).toBeNull();
    expect(selectionToAnchor(m, outside, 'y')).toBeNull();

    // (2) range collapsed (một cú nháy chuột)
    const caret = document.createRange();
    caret.setStart(root.querySelector('p')!.firstChild as Text, 3);
    caret.collapse(true);
    expect(rangeToFlat(m, caret)).toBeNull();
    expect(selectionToAnchor(m, caret, 'g')).toBeNull();
  });

  it('đoạn chọn CHỈ TOÀN khoảng trắng trả null', () => {
    const m = normalizeContainer(el('<div><p>Alpha</p>\n\n   <p>Beta</p></div>'));
    const ws = m.flat.indexOf('\n');
    expect(ws).toBeGreaterThan(0);
    const r = flatToDom(m, ws, ws + 4)!;
    expect(r).not.toBeNull();
    expect(rangeToFlat(m, r)).not.toBeNull(); // có span thật, chỉ là toàn khoảng trắng
    expect(selectionToAnchor(m, r, 'b')).toBeNull();
  });

  it('khoảng trắng thừa hai đầu đoạn chọn bị cắt khỏi exact', () => {
    const m = normalizeContainer(el('<div><p>Alpha beta gamma</p></div>'));
    const i = m.flat.indexOf('beta');
    const a = anchorAt(m, i - 1, i + 'beta'.length + 1)!;
    expect(a.exact).toBe('beta');
  });

  it('biên đầu/cuối chương: prefix/suffix ngắn lại hoặc rỗng, không bao giờ undefined', () => {
    const m = normalizeContainer(el('<div><p>Alpha beta gamma delta</p></div>'));
    const head = anchorAt(m, 0, 5)!;
    expect(head.exact).toBe('Alpha');
    expect(head.prefix).toBe('');
    expect(head.suffix).toBe(' beta gamma delta');

    const n = m.flat.length;
    const tail = anchorAt(m, n - 5, n)!;
    expect(tail.exact).toBe('delta');
    expect(tail.suffix).toBe('');
    expect(tail.prefix).toBe('Alpha beta gamma ');
  });

  it('exact cực ngắn (1–2 ký tự) vẫn tạo được anchor', () => {
    const m = normalizeContainer(el('<div><p>Alpha beta gamma</p></div>'));
    const i = m.flat.indexOf('beta');
    const one = anchorAt(m, i, i + 1)!;
    expect(one.exact).toBe('b');
    expect(one.prefix).toBe('Alpha ');
    const two = anchorAt(m, i, i + 2)!;
    expect(two.exact).toBe('be');
  });

  it('công thức trong đoạn chọn là đúng một ký tự ￼ trong exact', () => {
    const m = normalizeContainer(el(PROSE));
    const f = m.flat.indexOf('￼');
    const a = anchorAt(m, f - 4, f + 6)!;
    expect(a.exact).toContain('￼');
    expect(a.exact.match(/￼/g)).toHaveLength(1);
    expect(a.exact).not.toContain('DKL');
    expect(a.exact).not.toContain('mathnormal');
  });
});

describe('anchorToRange — tầng 1: khớp chính xác', () => {
  it('vòng tròn tạo → giải trả về đúng chỗ cũ, fuzzy = false', () => {
    const m = normalizeContainer(el(PROSE));
    const i = m.flat.indexOf('hai phân phối');
    const a = anchorAt(m, i, i + 'hai phân phối'.length)!;
    const hit = anchorToRange(m, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(false);
    expect(describeResolved(m, hit.range)).toBe(a.exact);
    expect(rangeToFlat(m, hit.range)).toEqual({ from: i, to: i + 'hai phân phối'.length });
  });

  it('giải lại được sau khi chương render lại từ CÙNG nguồn HTML (thiết bị khác)', () => {
    const m1 = normalizeContainer(el(PROSE));
    const i = m1.flat.indexOf('cross-entropy');
    const a = anchorAt(m1, i, i + 'cross-entropy'.length)!;

    const m2 = normalizeContainer(el(PROSE)); // DOM hoàn toàn mới
    const hit = anchorToRange(m2, a)!;
    expect(hit.fuzzy).toBe(false);
    expect(describeResolved(m2, hit.range)).toBe('cross-entropy');
  });

  it('exact xuất hiện HAI lần ⇒ prefix/suffix chọn đúng bản', () => {
    const html =
      '<div><p>Trong chiều thuận, mô hình sinh phủ mọi mode.</p>' +
      '<p>Trong chiều nghịch, mô hình sinh bám một mode.</p></div>';
    const m = normalizeContainer(el(html));
    const first = m.flat.indexOf('mô hình sinh');
    const second = m.flat.indexOf('mô hình sinh', first + 1);
    expect(second).toBeGreaterThan(first);

    const a1 = anchorAt(m, first, first + 'mô hình sinh'.length)!;
    const a2 = anchorAt(m, second, second + 'mô hình sinh'.length)!;
    expect(a1.exact).toBe(a2.exact);
    expect(a1.prefix).not.toBe(a2.prefix);

    expect(rangeToFlat(m, anchorToRange(m, a1)!.range)).toEqual({
      from: first,
      to: first + 'mô hình sinh'.length,
    });
    expect(rangeToFlat(m, anchorToRange(m, a2)!.range)).toEqual({
      from: second,
      to: second + 'mô hình sinh'.length,
    });
  });

  it('exact MỘT ký tự trong chương có 400 chỗ trùng: prefix+suffix vẫn chỉ đúng một chỗ', () => {
    // Người đọc tô đúng một ký hiệu — hoàn toàn hợp lệ, và brief bắt buộc
    // phải chạy đúng. Nhưng "p" xuất hiện hàng trăm lần trong một chương
    // thật, nhiều hơn số lần bất kỳ danh sách có chặn nào chịu thu thập, nên
    // nếu chỉ dò `exact` rồi chấm điểm ngữ cảnh trên phần thu được thì bản
    // đúng có thể rơi khỏi danh sách và ghi chú dán vào một chữ "p" khác.
    const filler = Array.from({ length: 400 }, (_, k) => `Câu ${k} nói về p và q.`).join(' ');
    const html = `<div><p>${filler} Điểm chốt cuối cùng là p đứng một mình.</p></div>`;
    const m1 = normalizeContainer(el(html));
    const target = m1.flat.indexOf('là p đứng') + 3;
    expect(m1.flat.split('p').length - 1).toBeGreaterThan(400);

    const a = anchorAt(m1, target, target + 1)!;
    expect(a.exact).toBe('p');
    expect(a.prefix.endsWith('cuối cùng là ')).toBe(true);

    const m2 = normalizeContainer(el(html));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(false);
    expect(rangeToFlat(m2, hit.range)).toEqual({ from: target, to: target + 1 });
  });

  it('exact rất phổ biến và suffix ĐÃ ĐỔI: phải chấm điểm quá vài chục lần xuất hiện đầu', () => {
    // Biến thể của trường hợp trên với dò-ngữ-cảnh-nguyên-khối bị vô hiệu
    // (suffix không còn khớp), nên chỉ còn đường chấm điểm từng lần xuất
    // hiện. Nếu danh sách bị cắt ở vài chục thì bản đúng — nằm ở cuối
    // chương — không bao giờ được xét tới.
    const filler = Array.from({ length: 400 }, (_, k) => `Câu ${k} nói về p và q.`).join(' ');
    const before = `<div><p>${filler} Điểm chốt cuối cùng là p đứng một mình.</p></div>`;
    const after = `<div><p>${filler} Điểm chốt cuối cùng là p nằm lẻ loi ở cuối trang.</p></div>`;
    const m1 = normalizeContainer(el(before));
    const target = m1.flat.indexOf('là p đứng') + 3;
    const a = anchorAt(m1, target, target + 1)!;
    expect(a.exact).toBe('p');

    const m2 = normalizeContainer(el(after));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(false);
    expect(rangeToFlat(m2, hit.range)!.from).toBe(m2.flat.indexOf('là p nằm') + 3);
  });

  it('chèn thêm cả một câu phía TRƯỚC: prefix đổi hết nhưng exact còn nguyên ⇒ vẫn đúng chỗ', () => {
    const before = '<div><p>Trong chiều nghịch, mô hình sinh bám một mode duy nhất.</p></div>';
    const after =
      '<div><p>Một câu hoàn toàn mới được tác giả chèn vào đầu đoạn. ' +
      'Trong chiều nghịch, mô hình sinh bám một mode duy nhất.</p></div>';
    const m1 = normalizeContainer(el(before));
    const i = m1.flat.indexOf('bám một mode');
    const a = anchorAt(m1, i, i + 'bám một mode'.length)!;

    const m2 = normalizeContainer(el(after));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(false);
    expect(describeResolved(m2, hit.range)).toBe('bám một mode');
    // ...và đúng bản trong đoạn văn MỚI, không phải một vị trí trôi.
    const span = rangeToFlat(m2, hit.range)!;
    expect(m2.flat.slice(span.from, span.to)).toBe('bám một mode');
  });

  it('exact chứa ￼ vẫn khớp sau khi công thức được render lại', () => {
    const m1 = normalizeContainer(el(PROSE));
    const f = m1.flat.indexOf('￼');
    const a = anchorAt(m1, f - 12, f + 6)!;
    expect(a.exact).toContain('￼');

    const m2 = normalizeContainer(el(PROSE));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(false);
    expect(describeResolved(m2, hit.range)).toBe(a.exact);
    // Range phải bao TRỌN phần tử .katex, không neo vào trong nó.
    expect(hit.range.cloneContents().querySelectorAll('.katex')).toHaveLength(1);
  });
});

describe('anchorToRange — tầng 2: fuzzy', () => {
  it('sửa 1 ký tự chính tả trong exact ⇒ fuzzy = true, vẫn tìm đúng chỗ', () => {
    const before = '<div><p>Phần trả thừa chính là số bit lãng phí mỗi ký hiệu vì dùng sai mô hình.</p></div>';
    const after = '<div><p>Phần trả thừa chính là số bit lãng phí mỗi ký hiệu vì dùng sai mô hìnk.</p></div>';
    const m1 = normalizeContainer(el(before));
    const i = m1.flat.indexOf('vì dùng sai mô hình');
    const a = anchorAt(m1, i, i + 'vì dùng sai mô hình'.length)!;

    const m2 = normalizeContainer(el(after));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(true);
    expect(describeResolved(m2, hit.range)).toBe('vì dùng sai mô hìnk');
  });

  it('chèn thêm một từ vào GIỮA exact ⇒ fuzzy tìm được đoạn đã dài ra', () => {
    const before = '<div><p>Đây là thước đo chi phí của việc tin sai trong lý thuyết mã hóa.</p></div>';
    const after = '<div><p>Đây là thước đo chi phí thật của việc tin sai trong lý thuyết mã hóa.</p></div>';
    const m1 = normalizeContainer(el(before));
    const i = m1.flat.indexOf('chi phí của việc tin sai');
    const a = anchorAt(m1, i, i + 'chi phí của việc tin sai'.length)!;

    const m2 = normalizeContainer(el(after));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(true);
    expect(describeResolved(m2, hit.range)).toBe('chi phí thật của việc tin sai');
  });

  it('xóa một từ khỏi GIỮA exact ⇒ fuzzy tìm được đoạn đã ngắn lại, không mất chữ đầu', () => {
    const before = '<div><p>Đây là thước đo chi phí thật của việc tin sai trong lý thuyết mã hóa.</p></div>';
    const after = '<div><p>Đây là thước đo chi phí của việc tin sai trong lý thuyết mã hóa.</p></div>';
    const m1 = normalizeContainer(el(before));
    const i = m1.flat.indexOf('chi phí thật của việc tin sai');
    const a = anchorAt(m1, i, i + 'chi phí thật của việc tin sai'.length)!;

    const m2 = normalizeContainer(el(after));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(true);
    expect(describeResolved(m2, hit.range)).toBe('chi phí của việc tin sai');
  });

  it('prefix lặp lại ở NHIỀU chỗ: phải thử quá ứng viên đầu tiên mới ra đúng đoạn', () => {
    // Văn xuôi giáo trình lặp cấu trúc câu ("Trong chiều nghịch, mô hình
    // sinh …") — nên vị trí đầu tiên mà prefix khớp thường KHÔNG phải chỗ
    // của ghi chú. Nếu chỉ xét một ứng viên thì ghi chú ở lần xuất hiện thứ
    // hai trở đi thành orphan ngay lần đầu tác giả sửa chính tả.
    const lead = 'Trong chiều nghịch, mô hình sinh ';
    const other = 'bám vào một mode duy nhất và bỏ qua phần còn lại.';
    const quote = 'phủ toàn bộ giá đỡ của phân phối thật';
    const m1 = normalizeContainer(el(`<div><p>${lead}${other}</p><p>${lead}${quote}.</p></div>`));
    const i = m1.flat.indexOf(quote);
    const a = anchorAt(m1, i, i + quote.length)!;
    expect(a.prefix.endsWith('mô hình sinh ')).toBe(true);
    // Chính prefix ấy xuất hiện ở CẢ HAI đoạn.
    const collapsedFlat = m1.flat.replace(/\s+/g, ' ');
    expect(collapsedFlat.indexOf(a.prefix)).toBeLessThan(collapsedFlat.lastIndexOf(a.prefix));

    const typo = 'phủ toàn bộ giá đỡ của phân phối thặt';
    const m2 = normalizeContainer(el(`<div><p>${lead}${other}</p><p>${lead}${typo}.</p></div>`));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(true);
    expect(describeResolved(m2, hit.range)).toBe(typo);
  });

  it('hai ứng viên cùng ĐƯỢC CHẤP NHẬN ⇒ chọn bản gần nhất, không phải bản gặp trước', () => {
    // Giáo trình có những câu gần trùng nhau (chỉ khác một từ). Khi đoạn
    // được ghi chú dính lỗi chính tả, ứng viên ĐẦU TIÊN theo thứ tự vị trí
    // là câu gần trùng ở đoạn trước — và nó cũng nằm trong ngưỡng, tức là
    // "chấp nhận ứng viên đầu tiên tìm được" sẽ dán ghi chú vào ĐÚNG một
    // câu khác, đọc vẫn xuôi tai nên không ai phát hiện ra.
    const lead = 'Trong chiều nghịch, mô hình sinh ';
    const near = 'phủ toàn bộ giá đỡ của phân phối gốc';
    const quote = 'phủ toàn bộ giá đỡ của phân phối thật';
    const m1 = normalizeContainer(el(`<div><p>${lead}${near}.</p><p>${lead}${quote}.</p></div>`));
    const i = m1.flat.indexOf(quote);
    const a = anchorAt(m1, i, i + quote.length)!;

    const typo = 'phủ toàn bộ giá đỡ của phân phối thặt';
    const m2 = normalizeContainer(el(`<div><p>${lead}${near}.</p><p>${lead}${typo}.</p></div>`));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(true);
    expect(describeResolved(m2, hit.range)).toBe(typo);
    // Và nó phải nằm ở đoạn THỨ HAI của DOM mới.
    const span = rangeToFlat(m2, hit.range)!;
    expect(span.from).toBeGreaterThan(m2.flat.indexOf(near));
  });

  it('hai ứng viên khớp ngang nhau ⇒ suffix quyết định, đúng như ở tầng khớp chính xác', () => {
    // Một lần tìm-thay toàn cục (đổi thuật ngữ, sửa dấu) đụng vào CẢ HAI
    // câu gần trùng cùng lúc, nên hai ứng viên có khoảng cách bằng nhau.
    // Lúc đó chỉ còn ngữ cảnh phân biệt được — và nếu tầng fuzzy bỏ qua nó
    // thì ghi chú nhảy sang câu kia mà chẳng có gì đỏ lên.
    const lead = 'Trong chiều nghịch, mô hình sinh ';
    const quote = 'phủ toàn bộ giá đỡ của phân phối thật';
    const tailA = ', và ta dừng lại ở đây.';
    const tailB = ', còn phần sau thì hoàn toàn khác.';
    const m1 = normalizeContainer(el(`<div><p>${lead}${quote}${tailA}</p><p>${lead}${quote}${tailB}</p></div>`));
    const second = m1.flat.indexOf(quote, m1.flat.indexOf(quote) + 1);
    const a = anchorAt(m1, second, second + quote.length)!;
    expect(a.suffix.startsWith(', còn phần sau')).toBe(true);

    const typo = 'phủ toàn bộ giá đỡ của phân phối thặt';
    const m2 = normalizeContainer(el(`<div><p>${lead}${typo}${tailA}</p><p>${lead}${typo}${tailB}</p></div>`));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(true);
    const span = rangeToFlat(m2, hit.range)!;
    expect(span.from).toBeGreaterThan(m2.flat.indexOf(tailA));
  });

  it('prefix hỏng ở ĐẦU cửa sổ 32 ký tự: rơi về đuôi ngắn hơn (16/8) vẫn khoanh đúng vùng', () => {
    // Khi cả prefix lẫn suffix đều dính một sửa đổi ở phần XA đoạn chọn,
    // phép dò bằng nguyên 32 ký tự trượt cả hai bên. Nếu không rơi xuống
    // các đuôi/đầu ngắn hơn thì không sinh được ứng viên nào và ghi chú
    // thành orphan — dù văn bản quanh nó gần như còn nguyên.
    const lead = 'Trước đó ta đã thấy rằng bất đẳng thức ';
    const quote = 'Pinsker cho cận dưới';
    const trail = ', và phần còn lại của đoạn văn vẫn giữ nguyên như cũ.';
    const m1 = normalizeContainer(el(`<div><p>${lead}${quote}${trail}</p></div>`));
    const i = m1.flat.indexOf(quote);
    const a = anchorAt(m1, i, i + quote.length)!;
    expect(a.prefix).toHaveLength(32);
    expect(a.suffix).toHaveLength(32);

    // Sửa đúng một ký tự ở đầu cửa sổ prefix, một ở cuối cửa sổ suffix, và
    // một trong chính exact. Cả ba cửa sổ 32 ký tự đều trượt; 16 ký tự sát
    // đoạn chọn thì còn nguyên.
    const badLead = lead.slice(0, lead.length - 30) + 'X' + lead.slice(lead.length - 29);
    const badTrail = trail.slice(0, 30) + 'X' + trail.slice(31);
    const badQuote = 'Pínsker cho cận dưới';
    const m2 = normalizeContainer(el(`<div><p>${badLead}${badQuote}${badTrail}</p></div>`));
    expect(m2.flat).not.toContain(a.prefix);
    expect(m2.flat).not.toContain(a.suffix);

    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(true);
    expect(describeResolved(m2, hit.range)).toBe(badQuote);
  });

  it('exact quá ngắn (< 8 ký tự) KHÔNG bao giờ đi đường fuzzy — thà orphan còn hơn đoán', () => {
    // Với ngưỡng max(2, ceil(0.2·m)), một exact 5 ký tự sẽ chấp nhận bản
    // khớp lệch 2 ký tự — trên chương 20k ký tự đó không phải khớp, đó là
    // trùng hợp. Và đoán sai nghĩa là ghi chú của người đọc dán vào câu
    // khác, tệ hơn hẳn panel orphan.
    const m1 = normalizeContainer(el('<div><p>Bất đẳng thức Pinsk cho cận dưới.</p></div>'));
    const i = m1.flat.indexOf('Pinsk');
    const a = anchorAt(m1, i, i + 5)!;
    expect(a.exact).toBe('Pinsk');

    const m2 = normalizeContainer(el('<div><p>Bất đẳng thức Pínsk cho cận dưới.</p></div>'));
    expect(anchorToRange(m2, a)).toBeNull();

    // Đối chứng: cùng một sửa đổi, exact đủ dài thì fuzzy vẫn cứu được.
    const long1 = normalizeContainer(el('<div><p>Bất đẳng thức Pinsker cho cận dưới.</p></div>'));
    const j = long1.flat.indexOf('Pinsker cho cận dưới');
    const b = anchorAt(long1, j, j + 'Pinsker cho cận dưới'.length)!;
    const long2 = normalizeContainer(el('<div><p>Bất đẳng thức Pínsker cho cận dưới.</p></div>'));
    expect(anchorToRange(long2, b)).not.toBeNull();
  });

  it('prefix hỏng HẲN mà exact có lỗi chính tả ⇒ suffix cứu được', () => {
    const before =
      '<div><p>Câu dẫn nhập nguyên bản của tác giả ở đây. Bất đẳng thức Pinsker cho cận dưới, ' +
      'và phần còn lại của đoạn giữ nguyên.</p></div>';
    const after =
      '<div><p>Một câu dẫn nhập đã bị viết lại toàn bộ. Bất đẳng thức Pínsker cho cận dưới, ' +
      'và phần còn lại của đoạn giữ nguyên.</p></div>';
    const m1 = normalizeContainer(el(before));
    const i = m1.flat.indexOf('Bất đẳng thức Pinsker');
    const a = anchorAt(m1, i, i + 'Bất đẳng thức Pinsker'.length)!;

    const m2 = normalizeContainer(el(after));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(true);
    expect(describeResolved(m2, hit.range)).toBe('Bất đẳng thức Pínsker');
  });
});

describe('anchorToRange — tầng 3: orphan', () => {
  it('đoạn chứa exact bị XÓA HẲN ⇒ null (Task 7 đưa vào panel orphan)', () => {
    const before = '<div><p>Alpha.</p><p>Bất đẳng thức Pinsker cho cận dưới.</p><p>Omega.</p></div>';
    const after = '<div><p>Alpha.</p><p>Omega.</p></div>';
    const m1 = normalizeContainer(el(before));
    const i = m1.flat.indexOf('Pinsker cho cận dưới');
    const a = anchorAt(m1, i, i + 'Pinsker cho cận dưới'.length)!;

    const m2 = normalizeContainer(el(after));
    expect(anchorToRange(m2, a)).toBeNull();
  });

  it('anchor dị dạng (từ server, kiểu là unknown) trả null thay vì ném', () => {
    const m = normalizeContainer(el(PROSE));
    const bad = [
      null,
      undefined,
      {},
      { exact: '', prefix: '', suffix: '', color: 'y' },
      { exact: '   ', prefix: '', suffix: '', color: 'y' },
      { exact: 42, prefix: null, suffix: undefined, color: 'y' },
      { exact: 'không tồn tại ở đâu cả', prefix: 7, suffix: {}, color: 'z' },
    ];
    for (const a of bad) {
      expect(() => anchorToRange(m, a as unknown as Anchor)).not.toThrow();
      expect(anchorToRange(m, a as unknown as Anchor)).toBeNull();
    }
  });

  it('anchor mang khoảng trắng THÔ (viết tay, hoặc từ một client khác) vẫn khớp', () => {
    // `AnnotationRow.anchor` là `unknown` suốt đường từ `json.RawMessage`
    // của server: không có gì bảo đảm mọi hàng đều do đúng bản anchor.ts
    // này viết ra. Một anchor mang `\n` và thụt lề phải được đưa về CÙNG
    // phép chiếu trước khi tìm, nếu không nó sẽ không bao giờ khớp — im
    // lặng, và trông y hệt "nội dung đã bị xóa".
    const m = normalizeContainer(el('<div><p>Dòng một</p>\n\n    <p>Dòng hai</p></div>'));
    const legacy = { exact: 'Dòng một\n\n    Dòng hai', prefix: '', suffix: '', color: 'y' } as Anchor;
    const hit = anchorToRange(m, legacy)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(false);
    expect(describeResolved(m, hit.range)).toBe('Dòng một Dòng hai');
  });

  it('chương rỗng (không có gì annotatable) trả null', () => {
    const m = normalizeContainer(el('<div class="ctrls"><label>chỉ UI runtime</label></div>'));
    expect(m.flat).toBe('');
    expect(anchorToRange(m, { exact: 'bất kỳ', prefix: '', suffix: '', color: 'y' })).toBeNull();
  });
});

describe('P2-F5 — khoảng trắng: đúng MỘT đường, từ lúc lưu tới lúc tìm', () => {
  it('exact lưu ở dạng đã gộp: không bao giờ chứa xuống dòng hay thụt lề', () => {
    const m = normalizeContainer(el('<div><p>Dòng một</p>\n\n    <p>Dòng hai</p></div>'));
    expect(m.flat).toBe('Dòng một\n\n    Dòng hai'); // flat THÔ vẫn giữ nguyên (Task 1)
    const a = anchorAt(m, 0, m.flat.length)!;
    expect(a.exact).toBe('Dòng một Dòng hai');
    expect(a.exact).not.toContain('\n');
  });

  it('GHI CHÚ BẮC QUA HAI THẺ <p>, HTML nguồn được ĐỊNH DẠNG LẠI ⇒ vẫn giải được', () => {
    // Đây là test mà ruling P2-F5 yêu cầu. Nó ĐỎ nếu ai đó trộn hai đường:
    // lưu `exact` đã gộp rồi vẫn `indexOf` trên `flat` thô thì không lần nào
    // trong ba lần dưới đây khớp.
    const original = '<div><p>Dòng một</p>\n\n    <p>Dòng hai</p></div>';
    const reindented = '<div>\n\t<p>Dòng một</p>\n\t<p>Dòng hai</p>\n</div>';
    const minified = '<div><p>Dòng một</p><p>Dòng hai</p></div>';

    const m1 = normalizeContainer(el(original));
    const i = m1.flat.indexOf('một');
    const j = m1.flat.indexOf('hai') + 3;
    const a = anchorAt(m1, i, j)!;
    expect(a.exact).toBe('một Dòng hai');

    for (const [name, html] of [
      ['reindented', reindented],
      ['minified', minified],
      ['original', original],
    ] as const) {
      const m2 = normalizeContainer(el(html));
      const hit = anchorToRange(m2, a);
      expect(hit, name).not.toBeNull();
      expect(hit!.fuzzy, name).toBe(false);
      expect(describeResolved(m2, hit!.range), name).toBe('một Dòng hai');
      // Và Range trả về phải là DOM THẬT của bản mới, bắc qua đúng hai thẻ
      // <p>, không lan sang chữ "Dòng" đầu tiên. KHÔNG dùng
      // `range.toString()` làm oracle: ở bản minified giữa hai thẻ không còn
      // ký tự khoảng trắng nào trong DOM, nên chuỗi DOM thật sự là
      // "mộtDòng hai" — chính khoảng trống mà phép chiếu tồn tại để lấp.
      const painted = hit!.range.cloneContents().textContent ?? '';
      expect(painted.includes('một'), name).toBe(true);
      expect(painted.includes('Dòng hai'), name).toBe(true);
      expect(painted.includes('Dòng một'), name).toBe(false);
    }
  });

  it('ô bảng dính liền nhau được tách bằng đúng một dấu cách trong exact', () => {
    // Đo trên p1-5 thật (báo cáo Task 1): flat thô cho
    // "Trọng số ở đâuở nơi ￼ lớnở nơi ￼ lớn" — không có dấu phân cách nào
    // giữa hai ô <td>. Nếu tầng anchor không xử lý, thẻ ghi chú ở Task 6 sẽ
    // hiển thị đúng chuỗi dính đó cho người đọc.
    const html =
      '<table class="tbl"><tbody><tr><td>Trọng số ở đâu</td><td>ở nơi p lớn</td>' +
      '<td>ở nơi q lớn</td></tr></tbody></table>';
    const m = normalizeContainer(el(html));
    expect(m.flat).toBe('Trọng số ở đâuở nơi p lớnở nơi q lớn'); // thô: dính liền
    const a = anchorAt(m, 0, m.flat.length)!;
    expect(a.exact).toBe('Trọng số ở đâu ở nơi p lớn ở nơi q lớn');
    // ...và chuỗi đã tách đó vẫn giải ngược được về đúng DOM.
    const hit = anchorToRange(m, a)!;
    expect(hit.fuzzy).toBe(false);
    expect(rangeToFlat(m, hit.range)).toEqual({ from: 0, to: m.flat.length });
  });

  it('thụt lề Ở ĐẦU chương bị bỏ hẳn, không thành một dấu cách vô chủ', () => {
    // Nếu khoảng trắng dẫn đầu được giữ lại thành ' ', mọi chỉ số của phép
    // chiếu dịch đi một, và prefix của ghi chú đầu chương thành ' ' thay vì
    // rỗng — tức là một anchor tạo trên bản HTML thụt lề sẽ không khớp bản
    // không thụt lề, đúng loại hỏng âm thầm mà phép chiếu sinh ra để tránh.
    const m = normalizeContainer(el('<div>\n    <p>Alpha beta gamma</p></div>'));
    expect(m.flat.startsWith('\n')).toBe(true);
    const i = m.flat.indexOf('Alpha');
    const a = anchorAt(m, i, i + 5)!;
    expect(a.exact).toBe('Alpha');
    expect(a.prefix).toBe('');
    expect(anchorToRange(normalizeContainer(el('<div><p>Alpha beta gamma</p></div>')), a)).not.toBeNull();
  });

  it('ranh giới khối chỉ chèn MỘT dấu cách, thẻ inline thì không chèn gì', () => {
    const m = normalizeContainer(el('<div><p>Không âm (<b>Gibbs</b>): luôn <i>đúng</i>.</p></div>'));
    const a = anchorAt(m, 0, m.flat.length)!;
    expect(a.exact).toBe('Không âm (Gibbs): luôn đúng.');
  });
});

// ===========================================================================
// C1 (review vòng 1) — `NormMap` là ẢNH CHỤP.
//
// Vòng lặp hiển nhiên nhất của Task 4 là `for (a of annotations) { paint(
// anchorToRange(map, a)) }`, và nó dùng lại CÙNG một map sau khi DOM đã bị
// tô. Đo trên p1-5 thật (40 anchor, tô đúng một cái): map cũ làm
// `anchorToRange` ném `IndexSizeError: Offset out of bound` — một thông điệp
// không nói được nguyên nhân, ném ra giữa lúc render chương.
//
// Không test một-ghi-chú nào phát hiện được điều này: phải có ghi chú THỨ HAI
// giải sau khi cái thứ nhất đã được tô.
// ===========================================================================

describe('C1 — NormMap cũ sau khi tô: ném lỗi CÓ TÊN, không trả kết quả', () => {
  const ONE_P =
    '<div><p>Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron.</p></div>';
  const TWO_P =
    '<div><p>Alpha beta gamma delta epsilon zeta.</p><p>Eta theta iota kappa lambda mu nu xi.</p></div>';

  function twoAnchors(html: string, first: string, second: string) {
    const root = el(html);
    const m = normalizeContainer(root);
    const i1 = m.flat.indexOf(first);
    const i2 = m.flat.indexOf(second);
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    return { root, m, a1: anchorAt(m, i1, i1 + first.length)!, a2: anchorAt(m, i2, i2 + second.length)! };
  }

  it('ghi chú thứ HAI trong CÙNG text node đã bị cắt: StaleNormMapError, không phải IndexSizeError', () => {
    const { m, a1, a2 } = twoAnchors(ONE_P, 'beta gamma', 'iota kappa');
    expect(isMapStale(m)).toBe(false);

    paint(anchorToRange(m, a1)!.range); // <mark> ⇒ splitText ⇒ node gốc ngắn đi

    expect(isMapStale(m)).toBe(true);
    expect(() => anchorToRange(m, a2)).toThrow(StaleNormMapError);
    // Thông điệp phải nói được PHẢI LÀM GÌ, không chỉ "có gì đó sai".
    expect(() => anchorToRange(m, a2)).toThrow(/normalizeContainer/);
  });

  it('map cũ bị từ chối kể cả khi ghi chú thứ hai nằm ở text node KHÔNG bị đụng tới', () => {
    // Hợp đồng là "ảnh chụp", không phải "ảnh chụp từng phần". Nếu chỉ xác
    // thực đúng những seg mà câu trả lời chạm tới thì 38/40 anchor của p1-5
    // vẫn giải được trên một map đã hỏng — tức là Task 4 sẽ học được thói
    // quen dùng lại map cũ, và sẽ trúng đúng 2/40 kia vào một hôm khác.
    const { m, a1, a2 } = twoAnchors(TWO_P, 'gamma delta', 'iota kappa');
    paint(anchorToRange(m, a1)!.range);
    expect(isMapStale(m)).toBe(true);
    expect(() => anchorToRange(m, a2)).toThrow(StaleNormMapError);
  });

  it('selectionToAnchor cũng từ chối map cũ — tạo ghi chú mới trên map cũ là cùng một lỗi', () => {
    const { root, m, a1 } = twoAnchors(ONE_P, 'beta gamma', 'iota kappa');
    const live = flatToDom(m, m.flat.indexOf('nu xi'), m.flat.indexOf('nu xi') + 5)!;
    paint(anchorToRange(m, a1)!.range);
    expect(() => selectionToAnchor(m, live, 'y')).toThrow(StaleNormMapError);
    void root;
  });

  it('DỰNG LẠI map sau khi tô ⇒ cả hai ghi chú giải đúng, range.toString() khớp exact', () => {
    const { root, m, a1, a2 } = twoAnchors(ONE_P, 'beta gamma', 'iota kappa');
    paint(anchorToRange(m, a1)!.range);

    const m2 = normalizeContainer(root);
    expect(isMapStale(m2)).toBe(false);
    for (const a of [a1, a2]) {
      const hit = anchorToRange(m2, a)!;
      expect(hit, a.exact).not.toBeNull();
      expect(hit.fuzzy, a.exact).toBe(false);
      // Fixture cố ý nằm gọn trong MỘT thẻ <p> với dấu cách thường, nên ở đây
      // chuỗi DOM thô và phép chiếu trùng nhau và `toString()` là oracle hợp lệ
      // (nói chung thì không — xem test "định dạng lại" ở trên).
      expect(hit.range.toString(), a.exact).toBe(a.exact);
    }
  });

  it('<mark> bọc TRỌN một text node (không cắt) KHÔNG bị coi là cũ — chống báo nhầm', () => {
    // Đây là nửa còn lại của hợp đồng. Một painter tô đúng trọn một text node
    // chỉ ĐỔI CHA của node đó: độ dài giữ nguyên, mọi offset vẫn đúng, phép
    // chiếu không đổi (`<mark>` là thẻ inline). Nếu phép xác thực báo cũ ở
    // đây thì Task 4 phải dựng lại `NormMap` sau MỌI nét tô, và "ảnh chụp"
    // biến thành "dựng lại 200 lần mỗi lần mở chương".
    const root = el('<div><p>Alpha beta gamma</p><p>delta epsilon zeta</p></div>');
    const m = normalizeContainer(root);
    const i = m.flat.indexOf('epsilon');
    const a = anchorAt(m, i, i + 'epsilon'.length)!;

    const t = root.querySelector('p')!.firstChild as Text;
    const before = t.data;
    const mark = document.createElement('mark');
    t.parentNode!.insertBefore(mark, t);
    mark.appendChild(t);

    expect(t.data).toBe(before);
    expect(t.parentElement!.tagName).toBe('MARK');
    expect(isMapStale(m)).toBe(false);
    expect(anchorToRange(m, a)!.range.toString()).toBe('epsilon');
  });

  it('isMapStale trả về boolean, không ném — caller kiểm chủ động được, không cần try/catch', () => {
    const root = el(ONE_P);
    const m = normalizeContainer(root);
    expect(isMapStale(m)).toBe(false);
    const i = m.flat.indexOf('beta gamma');
    paint(anchorToRange(m, anchorAt(m, i, i + 10)!)!.range);
    expect(isMapStale(m)).toBe(true);
    expect(isMapStale(normalizeContainer(root))).toBe(false);
  });
});

// ===========================================================================
// I1 (review vòng 1) — trần độ dài của tầng fuzzy.
//
// `bestWindowMatch` chạy TOÀN bảng `(m+1)×(w+1)`, `w ≈ m + 16`, nên số ô tăng
// theo bình phương độ dài quote: với ngân sách 1M ô, một quote quá ~1.000 ký
// tự không còn cửa sổ nào chạy nổi và ghi chú mất hẳn khả năng tự phục hồi
// đúng lúc cần nó nhất (tác giả vừa sửa nội dung).
// ===========================================================================

describe('I1 — quote DÀI vẫn phải còn đường fuzzy', () => {
  /** Ba đoạn văn ~1.000 ký tự, và bản sao đã sửa đúng MỘT ký tự ở giữa
   * đoạn thứ hai. Trả về HTML gốc, HTML đã sửa, và ký tự đã bị thay. */
  function threeParagraphs(seed: number, editAtChar: number, edits = 1) {
    const paras = [prose(seed, 190), prose(seed + 1, 190), prose(seed + 2, 190)];
    const mangle = (s: string): string => {
      let out = s;
      if (edits === 1) return s.slice(0, editAtChar) + 'Ẍ' + s.slice(editAtChar + 1);
      // Spread evenly through the paragraph so the count is the edit
      // DISTANCE, not a cluster the DP absorbs as one block.
      for (let k = 1; k <= edits; k++) {
        const at = Math.floor((k * s.length) / (edits + 1));
        out = out.slice(0, at) + 'Ẍ' + out.slice(at + 1);
      }
      return out;
    };
    const wrap = (ps: string[]): string => `<div>${ps.map((p) => `<p>${p}</p>`).join('\n')}</div>`;
    return { before: wrap(paras), after: wrap([paras[0], mangle(paras[1]), paras[2]]) };
  }

  it('quote ~2.500 ký tự (2–3 đoạn văn) sống sót một lỗi chính tả', () => {
    const { before, after } = threeParagraphs(1234, 400);
    const m1 = normalizeContainer(el(before));
    const a = anchorAt(m1, 100, 2700)!;
    expect(a.exact.length).toBeGreaterThan(2400);

    const m2 = normalizeContainer(el(after));
    const hit = anchorToRange(m2, a);
    expect(hit).not.toBeNull();
    expect(hit!.fuzzy).toBe(true);
    // ...và ở ĐÚNG chỗ, không phải một vị trí trôi: hai đầu của đoạn tìm được
    // phải trùng hai đầu của quote gốc (chỗ sửa nằm ở giữa).
    const got = describeResolved(m2, hit!.range)!;
    expect(got.slice(0, 60)).toBe(a.exact.slice(0, 60));
    expect(got.slice(-60)).toBe(a.exact.slice(-60));
  });

  it('quote ~2.500 ký tự đi hết đường fuzzy vẫn dưới trần thời gian một lần gọi', () => {
    const { before, after } = threeParagraphs(4321, 500);
    const m1 = normalizeContainer(el(before));
    const a = anchorAt(m1, 100, 2700)!;
    const m2 = normalizeContainer(el(after));
    let elapsed = Number.POSITIVE_INFINITY;
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      expect(anchorToRange(m2, a)).not.toBeNull();
      elapsed = Math.min(elapsed, performance.now() - t0);
    }
    // Đo được (best-of-5) 1,2–1,6ms. Trần 60ms cùng cách chọn với các phép đo
    // khác trong file: nó canh ĐỘ PHỨC TẠP, không canh mili-giây. Bỏ dải băng
    // của `bestWindowMatch` thì cửa sổ này là 2.516×2.532 ≈ 6,4M ô — vượt hẳn
    // ngân sách, nên test trên (`không null`) đỏ trước khi test này kịp đỏ.
    expect(elapsed).toBeLessThan(60);
  });

  it('trần số lần sửa vẫn còn: quote dài bị sửa QUÁ nhiều thì thà orphan còn hơn đoán', () => {
    // Dải băng làm quote dài chạy được, nhưng `maxDist = ceil(0.2·m)` trên một
    // quote 2.500 ký tự nghĩa là chấp nhận lệch 500 ký tự — đó không phải khớp,
    // đó là hai đoạn văn khác nhau tình cờ cùng chủ đề. Trần tuyệt đối phải
    // giữ, và nó cũng là thứ giữ cho dải băng rộng CỐ ĐỊNH (bỏ trần thì bề
    // rộng băng lại tỉ lệ với m và chi phí quay về bình phương).
    const { before, after } = threeParagraphs(999, 200, 150);
    const m1 = normalizeContainer(el(before));
    const a = anchorAt(m1, 100, 2700)!;
    const m2 = normalizeContainer(el(after));
    expect(anchorToRange(m2, a)).toBeNull();

    // Đối chứng: cùng quote, cùng chỗ, chỉ 5 lỗi ⇒ vẫn cứu được.
    const { after: lightlyEdited } = threeParagraphs(999, 200, 5);
    const hit = anchorToRange(normalizeContainer(el(lightlyEdited)), a);
    expect(hit).not.toBeNull();
    expect(hit!.fuzzy).toBe(true);
  });
});

// ===========================================================================
// I2 (review vòng 1) — hai cơ chế mà 43 test cũ KHÔNG hề giữ.
//
// Review độc lập chạy 25 mutation: R22 (bỏ hẳn tầng chữ ký
// `prefix+exact+suffix`) và R21 (bỏ tie-break ngữ cảnh ở hàng cuối của
// Sellers) đều để nguyên 43/43 test xanh. Cả hai đều là quyết định mà chính
// doc của module gọi là quan trọng.
// ===========================================================================

describe('I2 — hai cơ chế trước đây không có test nào giữ', () => {
  it('R22 — chữ ký prefix+exact+suffix là thứ DUY NHẤT cứu được quote khi exact vượt EXACT_CAP', () => {
    // Đường chấm điểm từng lần xuất hiện chỉ thu thập `EXACT_CAP = 2000` chỗ
    // đầu tiên. Test cũ dùng 400 chỗ trùng — thừa sức lọt qua cái cap đó, nên
    // bỏ HẲN tầng chữ ký mà chúng vẫn xanh. Ở đây `exact` xuất hiện hơn 2.000
    // lần TRƯỚC vị trí đúng, nên danh sách bị cắt cụt trước khi tới nơi và chỉ
    // còn chữ ký nguyên khối trả lời đúng được.
    const filler = Array.from({ length: 2100 }, (_, k) => `Câu ${k} nói về p và q.`).join(' ');
    const html = `<div><p>${filler} Điểm chốt cuối cùng là p đứng một mình.</p></div>`;
    const m1 = normalizeContainer(el(html));
    const target = m1.flat.indexOf('là p đứng') + 3;
    expect(m1.flat.slice(0, target).split('p').length - 1).toBeGreaterThan(2000);

    const a = anchorAt(m1, target, target + 1)!;
    expect(a.exact).toBe('p');

    const m2 = normalizeContainer(el(html));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(false);
    expect(rangeToFlat(m2, hit.range)).toEqual({ from: target, to: target + 1 });
  });

  it('R21 — tie-break NGỮ CẢNH ở hàng cuối Sellers: độ dài gần |exact| nhất là câu trả lời SAI', () => {
    // Ký tự cuối của quote bị xóa. Trong cửa sổ có ĐÚNG hai cách khớp cùng giá
    // (khoảng cách 1):
    //   (A) dừng trước dấu chấm  → xóa 'h' khỏi pattern, dài m-1
    //   (B) nuốt luôn dấu chấm   → thay 'h' bằng '.',   dài m
    // (B) có |len − m| = 0 nên "chọn độ dài gần nhất" luôn thắng — và nó dán
    // thêm một dấu chấm không thuộc về ghi chú vào highlight, mỗi lần tác giả
    // sửa chữ thì lấn thêm một ký tự. Chỉ ngữ cảnh (suffix bắt đầu bằng '.')
    // mới phân biệt được hai cách này.
    const lead = 'Đoạn dẫn nhập giữ nguyên. Bất đẳng thức Pinsker ';
    const quote = 'cho cận dưới của phân phối thật của mô hình';
    const trail = '. Kết thúc đoạn văn ở đây.';
    const m1 = normalizeContainer(el(`<div><p>${lead}${quote}${trail}</p></div>`));
    const i = m1.flat.indexOf(quote);
    const a = anchorAt(m1, i, i + quote.length)!;
    expect(a.suffix.startsWith('. Kết thúc')).toBe(true);

    const edited = quote.slice(0, quote.length - 1); // mất chữ 'h' cuối
    const m2 = normalizeContainer(el(`<div><p>${lead}${edited}${trail}</p></div>`));
    const hit = anchorToRange(m2, a)!;
    expect(hit).not.toBeNull();
    expect(hit.fuzzy).toBe(true);
    expect(describeResolved(m2, hit.range)).toBe(edited);
  });
});

describe('chi phí fuzzy — không được treo trình duyệt lúc mở chương', () => {
  /** Sinh một `flat` cỡ chương thật (p4-10, chương dài nhất: 19.358 ký
   * tự) bằng văn xuôi lặp lại — lặp lại là trường hợp TỆ cho việc khoanh
   * vùng ứng viên, nên đây là ước lượng bi quan chứ không lạc quan. */
  function bigChapter(paras: number): HTMLDivElement {
    const parts: string[] = [];
    for (let i = 0; i < paras; i++) {
      parts.push(
        `<p>Đoạn ${i}: phân kỳ Kullback–Leibler đo chi phí của việc tin sai, ` +
          `và bất đối xứng của nó tương ứng hai chế độ thất bại của mô hình sinh.</p>`,
      );
    }
    return el(`<div>${parts.join('\n')}</div>`);
  }

  /**
   * Số ô DP mà một lời gọi `anchorToRange` thực sự tính. **Tất định** — không
   * có đồng hồ nào tham gia, nên tải máy không vào được phép đo (ruling
   * P2-F13).
   *
   * Cách đếm, và vì sao nó đúng bằng số ô: cả hai bảng DP trong `anchor.ts`
   * đọc đúng MỘT ký tự văn bản cho mỗi ô, qua `String.prototype.charCodeAt` —
   * `bestWindowMatch` ở `text.charCodeAt(from + j - 1)`, `levenshtein` ở
   * `b.charCodeAt(j - 1)`. Ngoài hai vòng lặp ô đó, cả module không gọi
   * `charCodeAt` ở đâu khác: đúng bốn chỗ trong file, hai chỗ còn lại
   * (`pattern.charCodeAt(i - 1)`, `a.charCodeAt(i - 1)`) là một lần mỗi HÀNG,
   * không phải mỗi ô. Nên số đếm = số ô + số hàng, và số hàng là dưới 1% của
   * số ô ở kích cỡ bài này. Quan trọng hơn: đó là **cùng một hàm của cùng
   * khối lượng việc** cho cả hai vế được so, nên tỉ số giữa hai lần đếm CHÍNH
   * LÀ tỉ số ô DP.
   *
   * Vá `String.prototype` chỉ được phép ở test và phải hoàn nguyên vô điều
   * kiện — `finally` bên dưới. Không có móc đo đạc nào trong `anchor.ts`, và
   * cố ý không thêm: đây là phép đo của bộ test, không phải của sản phẩm.
   */
  function dpCells(run: () => void): number {
    const real = String.prototype.charCodeAt;
    let cells = 0;
    String.prototype.charCodeAt = function (this: string, index: number): number {
      cells++;
      return real.call(this, index);
    };
    try {
      run();
    } finally {
      String.prototype.charCodeAt = real;
    }
    return cells;
  }

  it('anchor KHÔNG tồn tại (đường xấu nhất) trên flat cỡ chương thật vẫn dưới trần thời gian', () => {
    const m = normalizeContainer(bigChapter(150));
    expect(m.flat.length).toBeGreaterThan(19000); // ≥ chương dài nhất của khóa học

    // Kịch bản ép fuzzy chạy hết sức. Ba điều kiện phải đồng thời đúng, nếu
    // thiếu một cái thì test này đo nhầm một đường rẻ tiền:
    //  (1) exact KHÔNG có trong chương ⇒ tầng 1 trượt;
    //  (2) prefix/suffix xuất hiện ở RẤT NHIỀU chỗ ⇒ sinh tối đa ứng viên;
    //  (3) exact GẦN GIỐNG văn bản thật (chỉ hỏng 1/4 số ký tự) ⇒ cực tiểu
    //      từng hàng DP không bao giờ vượt ngưỡng sớm, nên mỗi ứng viên phải
    //      chạy TRỌN bảng DP rồi mới bị loại. Với `z`.repeat(200) thì chốt
    //      cắt sớm bắn ngay hàng thứ 41 và test không đo gì cả.
    const passage = m.flat.replace(/\s+/g, ' ').slice(600, 800);
    const hostile: Anchor = {
      exact: [...passage].map((ch, k) => (k % 4 === 0 ? 'ẍ' : ch)).join(''),
      prefix: 'phân kỳ Kullback–Leibler đo chi phí',
      suffix: 'và bất đối xứng của nó tương ứng hai',
      color: 'y',
    };
    expect(hostile.exact).toHaveLength(200);
    expect(m.flat.replace(/\s+/g, ' ')).not.toContain(hostile.exact);

    const RUNS = 5;
    let elapsed = Number.POSITIVE_INFINITY;
    for (let r = 0; r < RUNS; r++) {
      const t0 = performance.now();
      expect(anchorToRange(m, hostile)).toBeNull();
      elapsed = Math.min(elapsed, performance.now() - t0);
    }
    // BEST-of-5, không phải một phát: `anchorToRange` chỉ ĐỌC, chạy lại đo
    // đúng cùng một khối lượng việc, nên cực tiểu là ước lượng trung thực —
    // nó loại bỏ đúng cú GC/tráo lịch mà một lần đo xui xẻo nuốt phải.
    //
    // Đo trên máy này (flat 20.139 ký tự, đúng fixture trên):
    //     một phát   máy rảnh 4.5–12.8ms  ·  8 lõi bão hòa 4.6–28.6ms
    //     best-of-5  máy rảnh 4.5ms       ·  8 lõi bão hòa 4.6ms
    // Trần 60ms = 13× số đo best-of-5 tệ nhất, cùng cách chọn (và cùng con
    // số) mà normalize.test.ts dùng cho phép đo của nó. Vòng sửa Task 1 đo
    // được cùng một phép việc dao động 24–90ms tùy tải CPU, nên trần sát số
    // đo lúc máy rảnh là tự chuốc lấy flaky. Cái này canh ĐỘ PHỨC TẠP: bỏ
    // `CAND_CAP` (32 → 150 ứng viên do prefix lặp lại) hay quét cả chương
    // đều vượt; nới `MAX_DP_CELLS` một chút thì không, và đó là chủ ý —
    // một trần tuyệt đối không thể vừa chịu được CI chậm vừa bắt được hồi
    // quy 2×.
    expect(elapsed).toBeLessThan(60);
  });

  it('exact vô vọng ngay từ đầu rẻ hơn HẲN exact gần đúng — chốt cắt sớm phải còn đó', () => {
    // Trần thời gian tuyệt đối không bắt được chốt cắt sớm: bỏ nó đi chỉ
    // làm chậm ~4,8× (1,17ms → 5,58ms đo trên máy này), tức vẫn lọt qua mọi
    // ngưỡng đủ rộng để không flaky. Bản trước của test này vì thế so hai
    // phép ĐO THỜI GIAN trong cùng một lần chạy, dựa trên giả định "cả hai
    // vế chịu đúng một mức tải CPU nên TỈ SỐ giữa chúng không phụ thuộc
    // máy". Giả định đó SAI, và ruling P2-F13 khai tử nó: dưới
    // `--maxWorkers=24` vế ~1ms phồng 2,51× còn vế ~4,5ms gần như không đổi
    // (0,92×) — nhiễu lịch trình cộng vào một lượng gần như TUYỆT ĐỐI, nên
    // nó nuốt trọn vế nhỏ và bỏ qua vế lớn. Tỉ số trượt từ 0,260 lên 0,710
    // và vượt ngưỡng 0,600; `Math.min` của 5 lần lặp không cứu được vì cả 5
    // lần đều chịu cùng mức bão hoà.
    //
    // Nên bản này không đo thời gian nữa: nó đếm **số ô DP đã tính** —
    // đúng đại lượng mà chốt cắt sớm tồn tại để cắt bớt, và là một số
    // nguyên tất định (xem `dpCells`). Ngưỡng 0,600 giữ NGUYÊN từng chữ:
    // nới nó là ăn thẳng vào biên phát hiện mutation.
    //
    //   · "vô vọng": exact toàn ký tự không hề có trong chương ⇒ cực tiểu
    //     hàng vượt ngưỡng ở hàng ~41 ⇒ bỏ bảng DP ngay.
    //   · "gần đúng": exact chỉ hỏng 1/4 ký tự ⇒ không hàng nào vượt ngưỡng
    //     ⇒ chạy trọn bảng.
    // Cùng số ứng viên, cùng kích thước cửa sổ; khác nhau đúng ở chốt cắt.
    const m = normalizeContainer(bigChapter(150));
    const context = {
      prefix: 'phân kỳ Kullback–Leibler đo chi phí',
      suffix: 'và bất đối xứng của nó tương ứng hai',
      color: 'y',
    } as const;
    const passage = m.flat.replace(/\s+/g, ' ').slice(600, 800);
    const nearMiss: Anchor = {
      ...context,
      exact: [...passage].map((ch, k) => (k % 4 === 0 ? 'ẍ' : ch)).join(''),
    };
    const hopeless: Anchor = { ...context, exact: 'ẍ'.repeat(200) };

    // Làm nóng trước khi đếm: `projectionFor` dựng `Projection` một lần rồi
    // cache theo `NormMap`, nên vế nào chạy TRƯỚC sẽ gánh thêm phần dựng đó.
    // (`buildProjection` không gọi `charCodeAt`, nên nó không vào số đếm —
    // gọi trước cũng loại luôn mọi tranh cãi về thứ tự.)
    expect(anchorToRange(m, hopeless)).toBeNull();

    let hopelessHit: unknown;
    let nearMissHit: unknown;
    const hopelessCells = dpCells(() => {
      hopelessHit = anchorToRange(m, hopeless);
    });
    const nearMissCells = dpCells(() => {
      nearMissHit = anchorToRange(m, nearMiss);
    });
    // Cả hai vế vẫn phải là orphan — nếu một vế bỗng khớp thì hai bên không
    // còn so cùng một phép việc và tỉ số ô mất nghĩa. Đây đúng hai khẳng
    // định `toBeNull()` của bản cũ, giữ nguyên, chỉ chuyển ra ngoài vùng đếm
    // để không có lời gọi nào của vitest lọt vào số đếm.
    expect(hopelessHit).toBeNull();
    expect(nearMissHit).toBeNull();

    // Đếm được trên fixture này (flat 20.139 ký tự) — số nguyên, lặp lại 3
    // lần ra đúng cùng một số, cả lúc máy nhàn lẫn lúc ép tải:
    //     còn chốt cắt sớm:  hopeless 151.921 ô · nearMiss 595.947 ô → 0,2549
    //     bỏ chốt cắt sớm:   hopeless 732.100 ô · nearMiss 732.100 ô → 1,0000
    // Ngưỡng 0,600 y hệt bản cũ và vẫn nằm giữa hai giá trị đó: số đúng thấp
    // hơn ngưỡng 2,35× và mutation cao hơn ngưỡng 1,67×. Con số mutation là
    // 1,0000 chứ không phải 0,8× như bản đo bằng đồng hồ ghi, vì bỏ chốt cắt
    // sớm làm CẢ HAI vế chạy trọn mọi hàng của mọi ứng viên — tức chính xác
    // cùng một số ô — nên phép đếm phân biệt sắc hơn phép đo thời gian.
    expect(hopelessCells).toBeLessThan(nearMissCells * 0.6);
  });

  it('nội dung bị xóa hẳn (không prefix, không suffix, không exact) ⇒ orphan gần như tức thì', () => {
    const m = normalizeContainer(bigChapter(150));
    const gone: Anchor = {
      exact: 'chuỗi không hề tồn tại trong chương này ở bất kỳ đâu',
      prefix: 'cũng không có prefix nào giống thế này cả',
      suffix: 'và suffix cũng vậy, hoàn toàn xa lạ với chương',
      color: 'y',
    };
    let elapsed = Number.POSITIVE_INFINITY;
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      expect(anchorToRange(m, gone)).toBeNull();
      elapsed = Math.min(elapsed, performance.now() - t0);
    }
    // Đo được 0.06–0.14ms ở cả hai chế độ tải: không có ứng viên nào thì
    // không có bảng DP nào chạy. Trần 15ms để khẳng định đúng MỘT điều —
    // rằng nhánh này KHÔNG quét cả chương. Một lần quét toàn chương ở đây
    // là ~10^8 phép tính, tức hàng giây, nên 15ms bắt được nó dứt khoát mà
    // vẫn cách số đo hơn 100×.
    expect(elapsed).toBeLessThan(15);
  });

  it('giải 60 anchor cùng lúc lúc mở chương (kịch bản Task 4) vẫn dưới trần', () => {
    const m = normalizeContainer(bigChapter(150));
    const anchors: Anchor[] = [];
    const rand = rng(7);
    // Vòng lặp CÓ CHẶN TRÊN: một `while (anchors.length < 60)` ở đây treo
    // vô hạn (rồi giết worker vì hết bộ nhớ) ngay khi `selectionToAnchor`
    // trả null — đúng điều đã xảy ra ở vòng RED với bản stub.
    for (let k = 0; k < 500 && anchors.length < 60; k++) {
      const from = Math.floor(rand() * (m.flat.length - 300));
      const a = anchorAt(m, from, from + 40 + Math.floor(rand() * 160));
      if (a) anchors.push(a);
    }
    expect(anchors).toHaveLength(60);
    let elapsed = Number.POSITIVE_INFINITY;
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      for (const a of anchors) expect(anchorToRange(m, a)).not.toBeNull();
      elapsed = Math.min(elapsed, performance.now() - t0);
    }
    // Đo được (best-of-5): 1.6ms máy rảnh, 1.5ms khi ép 8 lõi bão hòa — cả
    // 60 anchor khớp CHÍNH XÁC nên không anchor nào chạm tới bảng DP, và
    // phép chiếu chỉ dựng đúng một lần cho cả 60 (WeakMap theo NormMap).
    // Trần 60ms ≈ 40×: bỏ cache phép chiếu là dựng lại chuỗi 20k ký tự 60
    // lần, đúng loại hồi quy mà con số này canh.
    expect(elapsed).toBeLessThan(60);
  });
});

// ===========================================================================
// Chương THẬT, KaTeX THẬT. Fixture thủ công không chứng minh được rằng anchor
// sống sót trên dữ liệu thực — vòng review Task 1 đã cho thấy đây là thứ duy
// nhất phân biệt "code có vẻ đúng" với "code đúng". Harness nạp
// packages/course-kit/vendor/katex.js + auto-render.js vào jsdom bằng
// `new Function(src).call(globalThis)` và gọi renderMathInElement với ĐÚNG bộ
// option của packages/course-kit/runtime.js:319-333.
// ===========================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const CHAPTER = resolve(REPO, 'courses/***REMOVED***/chapters/p1-5.html');

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

describe('chương thật p1-5.html với KaTeX thật', () => {
  const SOURCE = readFileSync(CHAPTER, 'utf8');

  it('40 đoạn chọn ngẫu nhiên: tạo anchor rồi giải lại, khớp 100%', () => {
    const m = normalizeContainer(renderChapter(SOURCE));
    expect(m.flat.length).toBeGreaterThan(10000);
    expect(m.segs.filter((s) => s.atomic).length).toBeGreaterThan(200);

    const rand = rng(20260820);
    let made = 0;
    let exactHits = 0;
    for (let k = 0; k < 40; k++) {
      const len = 3 + Math.floor(rand() * 200);
      const from = Math.floor(rand() * Math.max(1, m.flat.length - len - 1));
      const a = anchorAt(m, from, from + len);
      if (!a) continue; // đoạn chọn toàn khoảng trắng — hợp lệ, bỏ qua
      made++;
      const hit = anchorToRange(m, a);
      expect(hit, `anchor #${k} ${JSON.stringify(a.exact.slice(0, 40))}`).not.toBeNull();
      if (!hit!.fuzzy) exactHits++;
      expect(describeResolved(m, hit!.range), `anchor #${k}`).toBe(a.exact);
    }
    expect(made).toBeGreaterThanOrEqual(35);
    expect(exactHits).toBe(made); // trên DOM y hệt thì phải khớp CHÍNH XÁC, không fuzzy
  });

  it('cùng bộ anchor đó vẫn giải được sau khi HTML nguồn bị bỏ hết khoảng trắng giữa các khối', () => {
    // Mô phỏng một lần build lại khóa học với bộ định dạng HTML khác: nội
    // dung chữ y nguyên, chỉ khoảng trắng GIỮA CÁC THẺ KHỐI biến mất. Đây là
    // trường hợp làm hỏng âm thầm mọi cách lưu `exact` thô.
    const BLOCK = 'p|div|h[1-6]|li|ul|ol|td|th|tr|thead|tbody|table|section|details|summary|figcaption|blockquote';
    const reflowed = SOURCE.replace(new RegExp(`(</(?:${BLOCK})>)\\s+(<)`, 'gi'), '$1$2');
    expect(reflowed).not.toBe(SOURCE);

    const m1 = normalizeContainer(renderChapter(SOURCE));
    const m2 = normalizeContainer(renderChapter(reflowed));
    expect(m2.flat).not.toBe(m1.flat); // đã thật sự đổi

    const rand = rng(31337);
    let made = 0;
    let resolved = 0;
    for (let k = 0; k < 40; k++) {
      const len = 10 + Math.floor(rand() * 150);
      const from = Math.floor(rand() * Math.max(1, m1.flat.length - len - 1));
      const a = anchorAt(m1, from, from + len);
      if (!a) continue;
      made++;
      const hit = anchorToRange(m2, a);
      if (hit && describeResolved(m2, hit.range) === a.exact) resolved++;
    }
    expect(made).toBeGreaterThanOrEqual(35);
    expect(resolved).toBe(made);
  });

  it('BẪY CHO TASK 3: mép cuối của Range thường KHÔNG ở nơi painter đoán', () => {
    // Tính chất này không phải lỗi — `rangeToFlat` đọc lại đúng offset cũ và
    // `range.toString()` đúng chữ. Nó là một CẢNH BÁO cho painter: một
    // `Range` hợp lệ có thể kết thúc ở `offset 0` của text node TIẾP THEO,
    // thường là một node chỉ chứa xuống dòng/thụt lề nằm NGOÀI thẻ <p>. Một
    // painter suy luận theo `endContainer` — hay "bọc mọi text node giao với
    // range" — sẽ tạo một `<mark>` RỖNG ở ngoài đoạn văn.
    //
    // Cảnh báo này trước đây chỉ nằm trong một báo cáo bị gitignore. Test này
    // là chỗ nó sống được: nếu một ngày nào đó `flatToDom` đổi cách chọn mép
    // và tính chất biến mất, đây là nơi Task 3 biết được.
    const m = normalizeContainer(renderChapter(SOURCE));
    const rand = rng(20260820);
    let made = 0;
    let endsAtOffsetZero = 0;
    let endsInWhitespaceNode = 0;
    let endsOutsideStartBlock = 0;
    for (let k = 0; k < 200; k++) {
      const len = 3 + Math.floor(rand() * 200);
      const from = Math.floor(rand() * Math.max(1, m.flat.length - len - 1));
      const a = anchorAt(m, from, from + len);
      if (!a) continue;
      const hit = anchorToRange(m, a);
      if (!hit) continue;
      made++;
      const r = hit.range;
      if (r.endOffset === 0) endsAtOffsetZero++;
      if (r.endContainer.nodeType === Node.TEXT_NODE && (r.endContainer as Text).data.trim() === '') {
        endsInWhitespaceNode++;
      }
      if (r.endContainer !== r.startContainer) endsOutsideStartBlock++;
    }
    // Đo được trên p1-5 với đúng hạt giống này: made=200, offset0=12 (6,0%),
    // node toàn khoảng trắng=6 (3,0%), khác node bắt đầu=159 (79,5%).
    expect(made).toBe(200);
    expect(endsAtOffsetZero).toBeGreaterThanOrEqual(5);
    expect(endsInWhitespaceNode).toBeGreaterThanOrEqual(3);
    expect(endsOutsideStartBlock).toBeGreaterThan(made / 2);
  });
});
