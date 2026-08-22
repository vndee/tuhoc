import { afterEach, describe, expect, it } from 'vitest';
import { getContext, setChapterContextSource } from './getContext';

/** A heading element with a controlled `getBoundingClientRect().top` — jsdom always reports 0, so the "nearest heading above scroll" logic needs this to be meaningfully testable. */
function headingAt(tag: 'h2' | 'h3', text: string, top: number, id?: string): HTMLElement {
  const h = document.createElement(tag);
  h.textContent = text;
  if (id) h.id = id;
  h.getBoundingClientRect = () =>
    ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  return h;
}

function p(text: string): HTMLElement {
  const e = document.createElement('p');
  e.textContent = text;
  return e;
}

describe('getContext', () => {
  afterEach(() => {
    setChapterContextSource(null);
    window.getSelection()?.removeAllRanges();
  });

  it('throws when no chapter is currently mounted', () => {
    expect(() => getContext()).toThrow(/no chapter/i);
  });

  it('returns courseId/chapterId from the registered chapter', () => {
    const content = document.createElement('div');
    setChapterContextSource({ courseId: 'demo', chapterId: 'c1', chapterTitle: 'Chương một', contentEl: content });

    const ctx = getContext();
    expect(ctx.courseId).toBe('demo');
    expect(ctx.chapterId).toBe('c1');
  });

  it('headingTrail is just the chapter title when scrolled above every h2', () => {
    const content = document.createElement('div');
    content.append(headingAt('h2', 'Phần A', 500)); // below the 70px anchor line -> not "reached" yet
    setChapterContextSource({ courseId: 'demo', chapterId: 'c1', chapterTitle: 'Chương một', contentEl: content });

    expect(getContext().headingTrail).toEqual(['Chương một']);
  });

  it('picks the nearest h2 above the scroll position (not h3, and not one further down)', () => {
    const content = document.createElement('div');
    content.append(
      headingAt('h2', 'Phần A', -400),
      headingAt('h3', 'Mục con', 10), // h3 must NOT show up in headingTrail
      headingAt('h2', 'Phần B', 20), // scrolled to (top <= 70)
      headingAt('h2', 'Phần C', 900), // not reached
    );
    setChapterContextSource({ courseId: 'demo', chapterId: 'c1', chapterTitle: 'Chương một', contentEl: content });

    expect(getContext().headingTrail).toEqual(['Chương một', 'Phần B']);
  });

  it('sectionHTML spans from the current h2 up to (excluding) the next h2, including any h3 in between', () => {
    const content = document.createElement('div');
    const secB = headingAt('h2', 'Phần B', 20, 'sec-b');
    const sub = headingAt('h3', 'Mục con', 25);
    content.append(
      headingAt('h2', 'Phần A', -400, 'sec-a'),
      p('nội dung A'),
      secB,
      p('nội dung B1'),
      sub,
      p('nội dung B2'),
      headingAt('h2', 'Phần C', 900, 'sec-c'),
      p('nội dung C'),
    );
    setChapterContextSource({ courseId: 'demo', chapterId: 'c1', chapterTitle: 'Chương một', contentEl: content });

    const { sectionHTML } = getContext();
    expect(sectionHTML).toContain('nội dung B1');
    expect(sectionHTML).toContain('nội dung B2');
    expect(sectionHTML).toContain('Mục con');
    expect(sectionHTML).not.toContain('nội dung A');
    expect(sectionHTML).not.toContain('nội dung C');
  });

  it('sectionHTML is the lede before the first h2 when scrolled above it', () => {
    const content = document.createElement('div');
    content.append(p('lede đầu chương'), headingAt('h2', 'Phần A', 500), p('nội dung A'));
    setChapterContextSource({ courseId: 'demo', chapterId: 'c1', chapterTitle: 'Chương một', contentEl: content });

    const { sectionHTML } = getContext();
    expect(sectionHTML).toContain('lede đầu chương');
    expect(sectionHTML).not.toContain('nội dung A');
  });

  it('includes selection only when it falls inside the chapter content', () => {
    const content = document.createElement('div');
    document.body.appendChild(content);
    const para = p('chọn đoạn này');
    content.appendChild(para);
    setChapterContextSource({ courseId: 'demo', chapterId: 'c1', chapterTitle: 'Chương một', contentEl: content });

    const range = document.createRange();
    range.selectNodeContents(para);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    expect(getContext().selection).toBe('chọn đoạn này');
    document.body.removeChild(content);
  });

  it('omits selection when there is a selection elsewhere in the document (outside the content)', () => {
    const content = document.createElement('div');
    document.body.appendChild(content);
    const outside = p('văn bản ngoài chương');
    document.body.appendChild(outside);
    setChapterContextSource({ courseId: 'demo', chapterId: 'c1', chapterTitle: 'Chương một', contentEl: content });

    const range = document.createRange();
    range.selectNodeContents(outside);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    expect(getContext().selection).toBeUndefined();
    document.body.removeChild(content);
    document.body.removeChild(outside);
  });
});

describe('getContext().selection — công thức phải là LaTeX, không phải rác', () => {
  afterEach(() => {
    setChapterContextSource(null);
    window.getSelection()?.removeAllRanges();
  });

  /** Một `<span class="katex">` đúng hình dạng KaTeX render ra: MathML ẩn (mang
   *  nguồn TeX trong `<annotation>`) + glyph nhìn thấy được. `sel.toString()`
   *  trên nó trả về **cả ba** dán liền nhau — đó là toàn bộ vấn đề. */
  function katex(tex: string, visible: string): string {
    return (
      `<span class="katex">` +
      `<span class="katex-mathml"><math><semantics><mrow><mi>${visible}</mi></mrow>` +
      `<annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span>` +
      `<span class="katex-html" aria-hidden="true"><span class="base">` +
      `<span class="mord mathnormal">${visible}</span></span></span></span>`
    );
  }

  function mountWithFormula(): HTMLElement {
    const content = document.createElement('div');
    content.innerHTML = `<p>Chặn trên là ${katex('\\tfrac{1}{2}\\varepsilon^2', 'ε2')} cho mỗi phép cộng.</p>`;
    document.body.appendChild(content);
    setChapterContextSource({ courseId: 'demo', chapterId: 'c1', chapterTitle: 'Chương một', contentEl: content });
    return content;
  }

  function selectWholeParagraph(content: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(content.querySelector('p')!);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  it('trả về mã LaTeX gốc, KHÔNG phải chuỗi ba-lần-rác của sel.toString()', () => {
    const content = mountWithFormula();
    selectWholeParagraph(content);

    // SO BẰNG ĐÚNG, không phải `toContain`. Đã đo hai chuỗi trong jsdom:
    //   sel.toString() → "Chặn trên là ε2\\tfrac{1}{2}\\varepsilon^2ε2 cho mỗi phép cộng."
    //   đúng           → "Chặn trên là $\\tfrac{1}{2}\\varepsilon^2$ cho mỗi phép cộng."
    // `toContain(LaTeX)` ĐÚNG với cả hai, vì `toString()` cũng nhặt text của
    // <annotation>. Glyph `ε2` xuất hiện HAI LẦN KẸP QUANH LaTeX, nên cả
    // `not.toContain('ε2ε2')` cũng trượt. Bản đầu của bài kiểm này dùng đúng hai
    // khẳng định ấy và **mutant sống sót** — cùng cái bẫy đã làm bài kiểm đầu
    // của Task 8 thành giả, mắc lại sau khi đã đọc cảnh báo của họ.
    expect(getContext().selection).toBe('Chặn trên là $\\tfrac{1}{2}\\varepsilon^2$ cho mỗi phép cộng.');
  });

  it('ĐỐI CHỨNG: đoạn không có công thức vẫn trả về đúng chữ', () => {
    const content = document.createElement('div');
    content.innerHTML = '<p>Một câu bình thường.</p>';
    document.body.appendChild(content);
    setChapterContextSource({ courseId: 'demo', chapterId: 'c1', chapterTitle: 'Chương một', contentEl: content });
    selectWholeParagraph(content);

    expect(getContext().selection).toBe('Một câu bình thường.');
  });

  it('vùng chọn NGOÀI chương không được lọt vào ngữ cảnh', () => {
    mountWithFormula();
    const outside = document.createElement('div');
    outside.innerHTML = '<p>Chữ ngoài chương.</p>';
    document.body.appendChild(outside);
    selectWholeParagraph(outside);

    expect(getContext().selection).toBeUndefined();
  });
});
