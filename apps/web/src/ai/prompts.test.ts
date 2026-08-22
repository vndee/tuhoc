import { describe, expect, it } from 'vitest';
import { normalizeContainer } from '../annotations/normalize';
import {
  CHAPTER_CONTEXT_LIMIT,
  CUT_MARK,
  chapterSystemPrompt,
  deepDiveSystemPrompt,
  readableText,
  selectionExcerpt,
} from './prompts';

/**
 * BẪY TRUNG TÂM CỦA TASK 8, và vì sao nó có một tệp kiểm riêng.
 *
 * Sau khi `CourseKit.renderKatex` chạy, một công thức KHÔNG còn là chữ. Nó là
 * một cây `<span class="katex">` chứa **cùng một phép toán ba lần**: MathML ẩn,
 * nguồn TeX trong `<annotation>`, và cây glyph nhìn thấy được. `normalize.ts`
 * của P2 gộp cả cây ấy thành **đúng một ký tự `'￼'`** — điều đúng đắn cho
 * việc neo chú thích, và là **rác** nếu nó đi thẳng vào một lời nhắc.
 *
 * `innerText`/`textContent` không cứu được: `textContent` cho ba bản chồng lên
 * nhau, `innerText` thì P2 đã đo là còn áp cả `text-transform`. Đường đúng duy
 * nhất là **dùng lại phép phân đoạn của P2** rồi **hoàn nguyên** mỗi đoạn
 * nguyên tử về nguồn LaTeX của nó.
 *
 * Bài học Task 3 áp thẳng vào đây: *bẫy chỉ cắm ở một đường*. Có **hai** đường
 * đưa chữ chương vào lời nhắc — đoạn bôi đen (Task 8) và ngữ cảnh chương
 * (Task 7) — nên cả hai đều có bài kiểm công thức riêng ở dưới.
 */

/** Ký tự thay thế của P2. Viết bằng escape để chính tệp này không chứa nó. */
const ATOMIC = '￼';

/**
 * Hình dạng đầu ra THẬT của KaTeX, chép nguyên từ `annotations/normalize.test.ts`
 * (tệp ấy ghi lại phép kiểm chứng trên `packages/course-kit/vendor/katex.js`).
 * Giữ nguyên một bản ở đây thay vì nhập chéo: hai tệp kiểm hai module khác nhau,
 * và một helper dùng chung sẽ khiến sửa một bên làm đỏ bên kia vì lý do không
 * liên quan.
 */
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

/** Cây do `initViz` sinh ra lúc chạy — không có trong HTML nguồn của chương. */
function vizFixture(): string {
  return (
    `<div class="fig-body"><div data-viz="sai-so" data-done="1">` +
    `<div class="relwrap"><canvas></canvas><div class="tip">TIP-KHONG-DUOC-VAO-LOI-NHAC</div></div>` +
    `<div class="ctrls"><div class="ctrl"><label>CTRL-KHONG-DUOC-VAO</label><input type="range"></div></div>` +
    `<div class="readout"><div class="cell"><div class="k">READOUT-KHONG-DUOC-VAO</div></div></div>` +
    `</div></div>`
  );
}

function mount(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

/** Bôi đen toàn bộ nội dung của `el` (kể cả cây con). */
function rangeOver(el: Element): Range {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range;
}

// ---------------------------------------------------------------------------
// PHÉP ĐO trên gói mẫu THẬT — `fixtures/courses/`, đo 2026-08-22 bằng parse5
// (bỏ script/style, gộp khoảng trắng). Lệnh sinh ra ba con số này nằm trong
// báo cáo task-7-8; chạy lại nếu gói mẫu đổi.
//
//   so-dau-phay-dong · 8 chương · chương dài nhất p1-3.html   = 19_312
//   so-dau-phay-dong · cả gói                                  = 117_670
//   đoạn h2 lớn nhất trên CẢ HAI gói mẫu (51 + 18 = 69 đoạn)   =  6_079
//
// Task 9b đo hai con số đầu bằng cùng phương pháp và ghi 19_343 / 117_872;
// chênh lệch ~0,2% là do cách gộp khoảng trắng ở rìa nút văn bản. Lấy con số
// NHỎ HƠN ở đây là chọn phía chặt hơn cho ngưỡng dưới.
// ---------------------------------------------------------------------------
const LONGEST_CHAPTER_TEXT = 19_312;
const LARGEST_H2_SECTION = 6_079;

describe('phép chiếu văn bản — công thức phải là LaTeX, không phải một ký tự rỗng', () => {
  /**
   * BẪY CHO CHÍNH BẪY.
   *
   * Ba bài dưới đây khẳng định "không thấy `'￼'`". Một fixture KHÔNG CÓ
   * công thức nào cho ra đúng cùng một kết quả xanh — đó là hình dạng bài kiểm
   * giả mà Task 3 đo được hai lần trong chính bộ của họ. Bài này hỏi câu mà một
   * fixture rỗng không trả lời được: phép chiếu THÔ của P2 có thật sự sinh ra
   * ký tự ấy trên đúng fixture này không.
   */
  it('phép chiếu THÔ của P2 thật sự sinh ra ký tự rỗng — fixture không phải đồ giả', () => {
    const el = mount(`<p>Sai số là ${katexSpan('\\frac{1}{2}\\varepsilon', '½ε')} trên mỗi bước.</p>`);
    const map = normalizeContainer(el);

    expect(map.flat).toContain(ATOMIC);
    expect(map.flat).not.toContain('\\frac');
    expect(map.segs.filter((s) => s.atomic)).toHaveLength(1);
  });

  it('BẪY CỦA TASK 8: đoạn bôi đen CÓ công thức ⇒ lời nhắc mang mã LaTeX gốc', () => {
    const el = mount(`<p>Sai số là ${katexSpan('\\frac{1}{2}\\varepsilon', '½ε')} trên mỗi bước.</p>`);
    const map = normalizeContainer(el);

    const excerpt = selectionExcerpt(map, rangeOver(el));
    expect(excerpt).not.toBeNull();
    expect(excerpt?.quote).toContain('\\frac{1}{2}\\varepsilon');
    expect(excerpt?.quote).not.toContain(ATOMIC);

    // Và lời nhắc thật sự gửi đi cũng vậy — không chỉ cái `quote` trung gian.
    const prompt = deepDiveSystemPrompt(excerpt!, {
      lang: 'vi',
      courseTitle: 'Số dấu phẩy động',
      chapterTitle: 'Sai số làm tròn',
    });
    expect(prompt.system).toContain('\\frac{1}{2}\\varepsilon');
    expect(prompt.system).not.toContain(ATOMIC);
  });

  it('công thức KHỐI ra `$$…$$`, công thức trong dòng ra `$…$`', () => {
    const el = mount(
      `<p>a ${katexSpan('x^2', 'x²')} b</p>${katexSpan('\\int_0^1 f', '∫f', true)}`,
    );
    const map = normalizeContainer(el);
    const text = readableText(map, 0, map.flat.length);

    expect(text).toContain('$x^2$');
    expect(text).toContain('$$\\int_0^1 f$$');
    expect(text).not.toContain(ATOMIC);
  });

  it('`.katex-error` giữ nguyên nguồn người viết, vẫn không ra ký tự rỗng', () => {
    const el = mount(
      `<p>Hỏng: <span class="katex-error" title="ParseError">$\\notacommand$</span> hết.</p>`,
    );
    const map = normalizeContainer(el);
    const text = readableText(map, 0, map.flat.length);

    expect(text).toContain('\\notacommand');
    expect(text).not.toContain(ATOMIC);
  });

  it('giao diện do runtime sinh ra KHÔNG lọt vào lời nhắc', () => {
    const el = mount(`<p>Trước.</p>${vizFixture()}<p>Sau.</p>`);
    const map = normalizeContainer(el);
    const text = readableText(map, 0, map.flat.length);

    expect(text).toContain('Trước.');
    expect(text).toContain('Sau.');
    expect(text).not.toContain('TIP-KHONG-DUOC-VAO-LOI-NHAC');
    expect(text).not.toContain('CTRL-KHONG-DUOC-VAO');
    expect(text).not.toContain('READOUT-KHONG-DUOC-VAO');
  });

  it('cùng một công thức KHÔNG bị lặp ba lần (MathML + annotation + glyph)', () => {
    const el = mount(`<p>${katexSpan('x^2', 'x²')}</p>`);
    const map = normalizeContainer(el);
    const text = readableText(map, 0, map.flat.length);

    // `textContent` thô cho "x²x^2x²"; phép chiếu đúng cho đúng MỘT bản.
    expect(text.split('x^2')).toHaveLength(2);
    expect(text).not.toContain('x²');
  });

  it('đoạn bôi đen NGOÀI chương ⇒ không có đoạn trích, và không ném', () => {
    const el = mount('<p>Trong chương.</p>');
    const other = mount('<p>Ngoài chương.</p>');
    const map = normalizeContainer(el);

    expect(selectionExcerpt(map, rangeOver(other))).toBeNull();
  });
});

// ---------------------------------------------------------------------------

/** Một chương giả dài `n` ký tự, chia thành các mục `h2` cỡ thật. */
function longChapter(totalChars: number, sectionChars = 3_000): string {
  let html = '';
  let written = 0;
  let i = 0;
  while (written < totalChars) {
    i += 1;
    const body = `M${String(i)} `.repeat(Math.ceil(sectionChars / 4));
    html += `<h2 id="s${String(i)}">Mục ${String(i)}</h2><p>${body}</p>`;
    written += sectionChars;
  }
  return html;
}

describe('lời nhắc về chương đang đọc — cắt bớt phải ĐO, không đoán', () => {
  it('ngưỡng cắt đến từ PHÉP ĐO trên gói mẫu thật, không phải một con số nghĩ ra', () => {
    // Sàn: mục `h2` LỚN NHẤT của gói mẫu phải lọt trọn vẹn vào cửa sổ, kèm
    // 25% chỗ trống cho văn cảnh hai bên — nếu không, một người học đang đọc
    // đúng mục ấy sẽ hỏi về một đoạn mà mô hình chỉ nhìn thấy một nửa.
    expect(CHAPTER_CONTEXT_LIMIT).toBeGreaterThanOrEqual(Math.ceil(LARGEST_H2_SECTION * 1.25));
    // Trần: ngưỡng phải THẬT SỰ cắt chương dài nhất của gói mẫu. Một ngưỡng
    // lớn hơn 19_312 là một nhánh cắt không bao giờ chạy — đúng hình dạng
    // "cổng rỗng luôn xanh" mà repo này đã vấp bốn lần.
    expect(CHAPTER_CONTEXT_LIMIT).toBeLessThan(LONGEST_CHAPTER_TEXT);
  });

  it('lời nhắc mang tiêu đề khoá học, tiêu đề chương và nội dung đang đọc', () => {
    const el = mount('<h2 id="a">Ba trường</h2><p>Số mũ lệch 127.</p>');
    const built = chapterSystemPrompt(el, {
      lang: 'vi',
      courseTitle: 'Số dấu phẩy động',
      chapterTitle: 'Ba trường: dấu, số mũ, phần định trị',
    });

    expect(built.system).toContain('Số dấu phẩy động');
    expect(built.system).toContain('Ba trường: dấu, số mũ, phần định trị');
    expect(built.system).toContain('Số mũ lệch 127.');
    expect(built.truncated).toBe(false);
    // Trên `excerpt`, không trên `system`: khung lời nhắc GIẢI THÍCH dấu cắt
    // cho mô hình, nên chữ ấy có mặt trong `system` kể cả khi không cắt gì.
    expect(built.excerpt).not.toContain(CUT_MARK);
  });

  it('chương NGẮN không bị cắt; chương DÀI CỠ THẬT thì bị, và ngữ cảnh không vượt ngưỡng', () => {
    const short = mount('<h2 id="a">Mục</h2><p>Ngắn thôi.</p>');
    expect(chapterSystemPrompt(short, { lang: 'vi', courseTitle: 'K', chapterTitle: 'C' }).truncated).toBe(false);

    const long = mount(longChapter(LONGEST_CHAPTER_TEXT));
    const built = chapterSystemPrompt(long, { lang: 'vi', courseTitle: 'K', chapterTitle: 'C' });

    expect(built.truncated).toBe(true);
    // Trên `excerpt`, KHÔNG trên `system`. Khung lời nhắc giải thích dấu cắt
    // cho mô hình, nên `system` chứa chuỗi ấy dù có cắt hay không —
    // `expect(built.system).toContain(CUT_MARK)` là một khẳng định LUÔN ĐÚNG,
    // và đột biến P6 (bỏ hẳn dấu cắt khỏi phần thân) đã SỐNG SÓT qua nó.
    expect(built.excerpt.startsWith(CUT_MARK) || built.excerpt.endsWith(CUT_MARK)).toBe(true);
    expect(built.contextChars).toBeLessThanOrEqual(CHAPTER_CONTEXT_LIMIT);
  });

  it('cắt ở GIỮA chương thì đánh dấu CẢ HAI đầu — mô hình phải biết thiếu ở đâu', () => {
    const el = mount(longChapter(LONGEST_CHAPTER_TEXT));
    const heads = Array.from(el.querySelectorAll('h2'));
    const middle = heads[Math.floor(heads.length / 2)];
    const built = chapterSystemPrompt(el, {
      lang: 'vi',
      courseTitle: 'K',
      chapterTitle: 'C',
      focusEl: middle,
    });

    expect(built.truncated).toBe(true);
    expect(built.excerpt.startsWith(CUT_MARK)).toBe(true);
    expect(built.excerpt.endsWith(CUT_MARK)).toBe(true);
  });

  it('BẪY CỦA TASK 3 — bẫy công thức phải cắm ở CẢ HAI đường: ngữ cảnh chương cũng vậy', () => {
    const el = mount(
      `<h2 id="a">Sai số</h2><p>Chặn trên là ${katexSpan('\\tfrac{1}{2}u', '½u')} mỗi phép.</p>`,
    );
    const built = chapterSystemPrompt(el, { lang: 'vi', courseTitle: 'K', chapterTitle: 'C' });

    expect(built.system).toContain('\\tfrac{1}{2}u');
    expect(built.system).not.toContain(ATOMIC);
  });

  it('ngưỡng là ngưỡng của CHỮ ĐÃ HOÀN NGUYÊN — công thức nở ra không phá được trần', () => {
    // Mỗi công thức là 1 ký tự trong phép chiếu thô của P2 nhưng ~40 ký tự sau
    // khi hoàn nguyên. Cắt theo offset thô rồi mới hoàn nguyên sẽ vượt trần
    // gần 40 lần mà không bài kiểm nào ở trên nhìn thấy.
    const dense = mount(
      `<h2 id="a">Dày đặc</h2><p>${katexSpan('\\alpha_{i}+\\beta_{j}\\cdot\\gamma_{k}', 'α+βγ').repeat(600)}</p>`,
    );
    const built = chapterSystemPrompt(dense, { lang: 'vi', courseTitle: 'K', chapterTitle: 'C' });

    expect(built.truncated).toBe(true);
    expect(built.contextChars).toBeLessThanOrEqual(CHAPTER_CONTEXT_LIMIT);
    expect(built.system).toContain('\\alpha_{i}');
  });

  it('cửa sổ cắt BÁM THEO mục người học đang đọc, không phải luôn lấy phần đầu', () => {
    const el = mount(longChapter(LONGEST_CHAPTER_TEXT));
    const heads = Array.from(el.querySelectorAll('h2'));
    const last = heads[heads.length - 1];

    const fromTop = chapterSystemPrompt(el, { lang: 'vi', courseTitle: 'K', chapterTitle: 'C' });
    const atLast = chapterSystemPrompt(el, {
      lang: 'vi',
      courseTitle: 'K',
      chapterTitle: 'C',
      focusEl: last,
    });

    // Khẳng định trên `excerpt` (phần THÂN được cắt) chứ không trên cả
    // `system`: dàn ý liệt kê MỌI tiêu đề mục, nên `system` chứa tên mục cuối
    // trong cả hai trường hợp — một bài kiểm đọc `system` ở đây sẽ luôn xanh.
    expect(fromTop.excerpt).toContain('Mục 1');
    expect(fromTop.excerpt).not.toContain(last.textContent!);
    expect(atLast.excerpt).toContain(last.textContent!);
  });

  it('DÀN Ý các mục luôn có mặt — mô hình phải biết phần nào nó KHÔNG được xem', () => {
    const el = mount(longChapter(LONGEST_CHAPTER_TEXT));
    const heads = Array.from(el.querySelectorAll('h2')).map((h) => h.textContent!);
    const built = chapterSystemPrompt(el, { lang: 'vi', courseTitle: 'K', chapterTitle: 'C' });

    expect(built.truncated).toBe(true);
    for (const title of heads) expect(built.system).toContain(title);
  });

  it('`contextChars` là SỐ KÝ TỰ THẬT của phần ngữ cảnh, không phải một ước lượng', () => {
    const el = mount('<h2 id="a">Mục</h2><p>Vừa đủ ngắn.</p>');
    const built = chapterSystemPrompt(el, { lang: 'vi', courseTitle: 'K', chapterTitle: 'C' });
    expect(built.contextChars).toBe(built.system.length);
  });
});

describe('lời nhắc "Đào sâu" — đoạn được chọn kèm văn cảnh hai bên', () => {
  it('mang đoạn được chọn VÀ văn cảnh trước/sau nó', () => {
    const el = mount('<p>Phần đầu rất dài. ĐOẠN ĐƯỢC CHỌN. Phần đuôi cũng vậy.</p>');
    const map = normalizeContainer(el);
    const node = el.querySelector('p')!.firstChild!;
    const text = node.textContent!;
    const start = text.indexOf('ĐOẠN');
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 'ĐOẠN ĐƯỢC CHỌN.'.length);

    const excerpt = selectionExcerpt(map, range);
    expect(excerpt?.quote).toBe('ĐOẠN ĐƯỢC CHỌN.');
    expect(excerpt?.before).toContain('Phần đầu rất dài.');
    expect(excerpt?.after).toContain('Phần đuôi cũng vậy.');

    const built = deepDiveSystemPrompt(excerpt!, { lang: 'vi', courseTitle: 'K', chapterTitle: 'C' });
    expect(built.system).toContain('ĐOẠN ĐƯỢC CHỌN.');
    expect(built.system).toContain('Phần đầu rất dài.');
    expect(built.contextChars).toBe(built.system.length);
  });

  it('văn cảnh hai bên bị chặn, nên một đoạn bôi đen không kéo cả chương đi theo', () => {
    const el = mount(`<p>${'X'.repeat(40_000)}CHON${'Y'.repeat(40_000)}</p>`);
    const map = normalizeContainer(el);
    const node = el.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(node, 40_000);
    range.setEnd(node, 40_004);

    const built = deepDiveSystemPrompt(selectionExcerpt(map, range)!, {
      lang: 'vi',
      courseTitle: 'K',
      chapterTitle: 'C',
    });
    expect(built.contextChars).toBeLessThanOrEqual(CHAPTER_CONTEXT_LIMIT);
  });
});
