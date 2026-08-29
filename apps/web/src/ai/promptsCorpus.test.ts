/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { normalizeContainer } from '../annotations/normalize';
import { CHAPTER_CONTEXT_LIMIT, chapterSystemPrompt, readableText } from './prompts';

/**
 * PHÉP ĐO TRÊN GÓI MẪU THẬT, VỚI KaTeX THẬT.
 *
 * `prompts.test.ts` chạy trên một fixture KaTeX **viết tay** — chép từ
 * `annotations/normalize.test.ts`, vốn được dựng bằng cách đọc mã đã rút gọn
 * của `vendor/katex.js`. Fixture ấy tốt, nhưng nó là **một giả thuyết về đầu
 * ra của KaTeX**, không phải đầu ra của KaTeX. Nếu giả thuyết sai thì cả bảy
 * bài kiểm công thức bên đó xanh trong khi tính năng hỏng — đúng hình dạng
 * "cổng đo thứ nó với tới được" đã ghi bốn lần trong `docs/carried-forward.md`.
 *
 * Tệp này đóng khoảng cách ấy: nó nạp **đúng hai tệp JS mà người học nạp**
 * (`vendor/katex.js`, `vendor/auto-render.js`), chạy chúng trên **đúng HTML
 * chương của gói mẫu**, rồi hỏi phép chiếu cùng một câu hỏi.
 *
 * Nó cũng là chỗ **ba hằng số đo được** của kế hoạch được tính LẠI mỗi lần
 * chạy thay vì tin vào một ảnh chụp. Task 9b phải neo bằng ảnh chụp vì
 * `apps/vault/tsconfig.json` cố ý không có `types: ["node"]`; cấu hình vitest
 * của `apps/web` thì CÓ, nên một bài kiểm ở đây đọc thẳng cây nguồn bằng
 * `node:fs` được — ràng buộc ấy không tồn tại ở đây, và không có lý do gì để
 * chấp nhận một ảnh chụp.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const FIXTURES = join(REPO, 'fixtures/courses');
const VENDOR = join(REPO, 'packages/course-kit/vendor');

/** Cùng cấu hình `CourseKit.renderKatex` dùng — `packages/course-kit/runtime.js`. */
const KATEX_OPTIONS = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false },
  ],
  throwOnError: false,
  strict: false,
  macros: { '\\Pr': '\\operatorname{Pr}', '\\Var': '\\operatorname{Var}' },
};

interface KatexWindow {
  renderMathInElement?: (el: Element, options: unknown) => void;
}

function loadClassicScript(file: string): void {
  const source = readFileSync(join(VENDOR, file), 'utf8');
  // Hai tệp này là script CỔ ĐIỂN: chúng gắn global chứ không export. Đó là lý
  // do `useCourseKit.ts` nạp chúng bằng `<script src>` thay vì `import`, và là
  // lý do ở đây phải chạy chúng trong phạm vi của `window` thay vì nhập.
  const run = new Function('self', 'window', 'globalThis', source) as (
    a: unknown,
    b: unknown,
    c: unknown,
  ) => void;
  run(window, window, window);
}

beforeAll(() => {
  loadClassicScript('katex.js');
  loadClassicScript('auto-render.js');
});

function chapterFiles(): { course: string; file: string; html: string }[] {
  const out: { course: string; file: string; html: string }[] = [];
  for (const course of readdirSync(FIXTURES)) {
    const dir = join(FIXTURES, course, 'chapters');
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of names.filter((n) => n.endsWith('.html'))) {
      out.push({ course, file, html: readFileSync(join(dir, file), 'utf8') });
    }
  }
  return out;
}

/** Dựng chương đúng thứ tự `ChapterView` dựng: innerHTML → renderKatex. */
function renderChapter(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  (window as unknown as KatexWindow).renderMathInElement?.(el, KATEX_OPTIONS);
  return el;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Chữ của HTML NGUỒN — cùng phép đo Task 9b dùng (bỏ script/style, gộp
 *  khoảng trắng), để hai báo cáo so được với nhau. */
function sourceText(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  for (const bad of el.querySelectorAll('script, style')) bad.remove();
  return collapse(el.textContent ?? '');
}

const ATOMIC = '￼';

describe('gói mẫu thật + KaTeX thật', () => {
  it('KaTeX THẬT thật sự chạy ở đây — nếu không, mọi bài dưới đây vô nghĩa', () => {
    expect(typeof (window as unknown as KatexWindow).renderMathInElement).toBe('function');

    const el = renderChapter('<p>Chặn trên là $\\tfrac{1}{2}u$ mỗi phép.</p>');
    // Hình dạng đầu ra mà `normalize.ts` và `prompts.ts` đều dựa vào — khẳng
    // định ở đây, trên đầu ra THẬT, chứ không tin fixture viết tay.
    expect(el.querySelector('.katex')).not.toBeNull();
    expect(el.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe(
      '\\tfrac{1}{2}u',
    );

    const map = normalizeContainer(el);
    expect(map.flat).toContain(ATOMIC);
    expect(readableText(map, 0, map.flat.length)).toContain('\\tfrac{1}{2}u');
  });

  it('MỌI chương của gói mẫu: lời nhắc mang LaTeX gốc, không mang ký tự rỗng', () => {
    const chapters = chapterFiles();
    // Phép quét phải tự nói nó đọc được bao nhiêu chương: một `readdirSync`
    // trả về mảng rỗng cho ra đúng cùng một màu xanh.
    expect(chapters.length).toBeGreaterThanOrEqual(11);

    let withFormula = 0;
    for (const { course, file, html } of chapters) {
      const root = renderChapter(html);
      const built = chapterSystemPrompt(root, { lang: 'vi', courseTitle: course, chapterTitle: file });

      expect(built.system).not.toContain(ATOMIC);
      expect(built.contextChars).toBeLessThanOrEqual(CHAPTER_CONTEXT_LIMIT);
      if (root.querySelector('.katex')) {
        withFormula += 1;
        expect(built.system).toMatch(/\$[^$]/);
      }
    }
    // Cùng lập luận: nếu không chương nào có công thức thì khẳng định trên là
    // một câu nói suông.
    expect(withFormula).toBeGreaterThanOrEqual(11);
  });

  it('ba hằng số đo được của kế hoạch được TÍNH LẠI, không phải tin một ảnh chụp', () => {
    const chapters = chapterFiles();
    const texts = chapters.map((c) => sourceText(c.html));
    const longest = Math.max(...texts.map((t) => t.length));

    const sample = chapters.filter((c) => c.course === 'so-dau-phay-dong');
    const sampleTotal = sample.reduce((a, c) => a + sourceText(c.html).length, 0);

    let largestSection = 0;
    for (const { html } of chapters) {
      const el = document.createElement('div');
      el.innerHTML = html;
      const kids = Array.from(el.childNodes);
      let acc: Node[] = [];
      const flush = (): void => {
        const box = document.createElement('div');
        for (const n of acc) box.appendChild(n.cloneNode(true));
        largestSection = Math.max(largestSection, collapse(box.textContent ?? '').length);
      };
      for (const n of kids) {
        if (n.nodeName === 'H2') {
          flush();
          acc = [n];
        } else acc.push(n);
      }
      flush();
    }

    // Ba con số này là căn cứ của `CHAPTER_CONTEXT_LIMIT` (xem `prompts.ts`) và
    // của `SESSION_CHAR_BUDGET` bên kho khoá (Task 9b). Chúng được ghi vào đây
    // với dung sai 2%: gói mẫu là dữ liệu thật, và một lần sửa chính tả trong
    // một chương không được làm đỏ cổng — nhưng một chương MỚI dài gấp rưỡi thì
    // phải, vì cả hai ngưỡng được chọn dựa trên chúng.
    expect(longest).toBeGreaterThan(19_312 * 0.98);
    expect(longest).toBeLessThan(19_312 * 1.02);
    expect(sampleTotal).toBeGreaterThan(117_670 * 0.98);
    expect(sampleTotal).toBeLessThan(117_670 * 1.02);
    expect(largestSection).toBeGreaterThan(6_079 * 0.98);
    expect(largestSection).toBeLessThan(6_079 * 1.02);
  });

  it('PHÉP ĐO CHO NGÂN SÁCH KÝ TỰ: lời nhắc thật dài bao nhiêu trên chương thật', () => {
    const rows = chapterFiles().map(({ course, file, html }) => {
      const root = renderChapter(html);
      const built = chapterSystemPrompt(root, {
        lang: 'vi',
        courseTitle: 'Số dấu phẩy động',
        chapterTitle: 'Ba trường: dấu, số mũ, phần định trị',
      });
      return { course, file, source: sourceText(html).length, prompt: built.contextChars, cut: built.truncated };
    });
    rows.sort((a, b) => b.prompt - a.prompt);
    for (const r of rows) {
      console.log(
        `[ngân sách] ${r.course}/${r.file}: nguồn=${String(r.source)} lời_nhắc=${String(r.prompt)} cắt=${String(r.cut)}`,
      );
    }
    const worst = rows[0].prompt;
    console.log(
      `[ngân sách] lời nhắc DÀI NHẤT = ${String(worst)} ký tự · ` +
        `120.000 / ${String(worst)} = ${String(Math.floor(120_000 / worst))} câu hỏi mỗi cú bấm xác nhận`,
    );

    // Lời nhắc dài nhất phải nằm trong trần, và phải KHÔNG quá nhỏ so với
    // trần — một lời nhắc chỉ dùng 10% ngân sách nghĩa là cửa sổ cắt đang vứt
    // đi phần lớn thứ nó được phép mang theo.
    expect(worst).toBeLessThanOrEqual(CHAPTER_CONTEXT_LIMIT);
    expect(worst).toBeGreaterThan(CHAPTER_CONTEXT_LIMIT * 0.8);
  });
});
