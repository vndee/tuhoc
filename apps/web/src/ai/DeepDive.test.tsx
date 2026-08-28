/// <reference types="node" />
import { act, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useEffect, useRef, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeContainer } from '../annotations/normalize';
import { SelectionToolbar, type ToolbarStore } from '../annotations/SelectionToolbar';
import type { ChapterContent } from '../annotations/useAnnotations';
import { DeepDive } from './DeepDive';
import type { SelectionExcerpt } from './prompts';
import { LanguageProvider } from '../i18n/LanguageProvider';

/**
 * TASK 8, VÀ CÁI BẪY ĐÃ CẮN DỰ ÁN NÀY BA LẦN.
 *
 * Một công thức sau khi KaTeX dựng xong là **đúng một ký tự `'￼'`** trong
 * phép chiếu của P2. Bất kỳ ai đọc `innerText`, `textContent`, hay
 * `NormMap.flat` rồi gửi đi đều gửi ký tự ấy thay cho công thức — và mô hình
 * trả lời tự tin về một thứ nó chưa từng thấy.
 *
 * Nên tệp này chạy **KaTeX THẬT** (`packages/course-kit/vendor/`), không phải
 * một fixture viết tay: fixture là một *giả thuyết* về đầu ra của KaTeX, và
 * một giả thuyết sai làm cả bộ kiểm xanh trong khi tính năng hỏng. Và nó đi
 * **qua giao diện thật** — bôi đen, bấm nút — tới tận thông điệp `postMessage`
 * rời khỏi trang, vì ruling S1-F29 sinh ra từ đúng chỗ này: bốn cổng đơn vị
 * không hỏi được câu *"người dùng có bấm tới được không"*.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = resolve(HERE, '../../../..', 'packages/course-kit/vendor');
const ATOMIC = '￼';
const TEX = '\\tfrac{1}{2}\\varepsilon^2';

/** Cùng cấu hình `CourseKit.renderKatex` dùng (`packages/course-kit/runtime.js`). */
const KATEX_OPTIONS = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false },
  ],
  throwOnError: false,
  strict: false,
};

interface KatexWindow {
  renderMathInElement?: (el: Element, options: unknown) => void;
}

beforeAll(() => {
  for (const file of ['katex.js', 'auto-render.js']) {
    const source = readFileSync(join(VENDOR, file), 'utf8');
    const run = new Function('self', 'window', 'globalThis', source) as (
      a: unknown,
      b: unknown,
      c: unknown,
    ) => void;
    run(window, window, window);
  }
});

/**
 * Đoạn văn CÙNG với một hình tương tác do `initViz` dựng lúc chạy. Cây `[data-viz]`
 * nằm TRONG vùng bôi đen, và mọi chữ của nó phải vô hình với lời nhắc: nó không
 * có trong HTML nguồn của chương và nó đổi mỗi lần người học kéo thanh trượt.
 */
const CHAPTER =
  `<h2>Sai số</h2><p id="p1">Chặn trên là $${TEX}$ cho mỗi phép cộng.</p>` +
  `<div class="fig-body"><div data-viz="sai-so">` +
  `<canvas></canvas><div class="tip">TIP-KHONG-DUOC-VAO</div>` +
  `<div class="ctrls"><label>CTRL-KHONG-DUOC-VAO</label></div>` +
  `<div class="readout">READOUT-KHONG-DUOC-VAO</div>` +
  `</div></div>` +
  `<p id="p2">Sai số dồn lại theo số phép.</p>`;

/**
 * ĐÚNG chuỗi mà một phép chiếu đúng phải cho ra. Khẳng định BẰNG NHAU, không
 * phải `toContain`, và lý do là một phép đo:
 *
 *   `range.toString()` trên đúng đoạn này trả về
 *   "Chặn trên là 12ε2\\tfrac{1}{2}\\varepsilon^221​ε2 cho mỗi phép cộng."
 *
 * — công thức BA LẦN (MathML ẩn, nguồn TeX, cây glyph), với nguồn TeX nằm lẫn
 * ở giữa. Nghĩa là một bài kiểm viết theo kiểu *"có chứa mã LaTeX"* + *"không
 * chứa `'￼'`"* **XANH với cài đặt sai** — cả hai vế đều đúng cho chuỗi rác
 * trên. Đo được bằng đột biến U1: nó SỐNG SÓT qua phiên bản đầu của tệp này.
 *
 * Đây đúng bài học Task 3 (*"hai bài kiểm của chính họ là giả"*), và nó cắn ở
 * đây dù tôi đã đọc báo cáo ấy trước khi viết. Bẫy chỉ cắm ở một đường — đường
 * `NormMap.flat` — trong khi có ít nhất hai đường ngây thơ.
 */
const CORRECT_QUOTE = `Chặn trên là $${TEX}$ cho mỗi phép cộng.`;
/** Chữ của cây glyph mà KaTeX vẽ ra — dấu vân tay của một phép đọc DOM ngây thơ. */
const GLYPH_TEXT = '12ε2';

/**
 * PHA 2: lời nhắc rời trang qua `POST /ai/chat` thật (chặn bằng msw), không
 * còn `postMessage` vào kho khoá. Xem `AskPanel.test.tsx`'s doc comment cho
 * lý do dùng `act(async () => {…})` + `flush()` thay vì `waitFor`.
 */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function controllableSSE() {
  const encoder = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return {
    stream,
    event: (kind: string, payload: { text?: string; code?: string }) => {
      ctrl.enqueue(encoder.encode(`event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`));
    },
    close: () => {
      ctrl.close();
    },
  };
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function stubStore(): ToolbarStore {
  return { create: vi.fn(), list: [], orphans: [] };
}

/** Chương dựng đúng thứ tự `ChapterView` dựng: innerHTML → renderKatex. */
function Harness({ onDeepDive }: { onDeepDive: (e: SelectionExcerpt) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<ChapterContent>({ root: null, revision: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = CHAPTER;
    (window as unknown as KatexWindow).renderMathInElement?.(el, KATEX_OPTIONS);
    setContent((prev) => ({ root: el, revision: prev.revision + 1 }));
  }, []);
  return (
    <>
      <div ref={ref} data-testid="chapter" />
      <LanguageProvider>
        <SelectionToolbar content={content} store={stubStore()} onDeepDive={onDeepDive} />
      </LanguageProvider>
    </>
  );
}

/** Bôi đen từ đầu `#p1` tới hết `#p2` — tức là ngang qua cả cây `[data-viz]`
 *  nằm giữa hai đoạn, đúng như một cú kéo chuột thật. */
function selectAcrossFigure(): void {
  const root = screen.getByTestId('chapter');
  const range = document.createRange();
  range.setStartBefore(root.querySelector('#p1')!);
  range.setEndAfter(root.querySelector('#p2')!);
  const selection = window.getSelection()!;
  act(() => {
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

function selectParagraph(): void {
  const p = screen.getByTestId('chapter').querySelector('#p1')!;
  const range = document.createRange();
  range.selectNodeContents(p);
  const selection = window.getSelection()!;
  act(() => {
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

describe('SelectionToolbar — nút "Đào sâu"', () => {
  it('đứng CẠNH nút "Ghi chú" trong cùng thanh công cụ', () => {
    render(<Harness onDeepDive={vi.fn()} />);
    selectParagraph();

    const bar = screen.getByRole('toolbar', { name: 'Ghi chú đoạn đã chọn' });
    const labels = Array.from(bar.querySelectorAll('button'))
      .map((b) => b.textContent?.trim())
      .filter(Boolean);
    expect(labels).toEqual(['Ghi chú', 'Đào sâu']);
  });

  it('BẪY CÒN SỐNG: phép chiếu THÔ của P2 trên ĐÚNG chương này vẫn ra ký tự rỗng', () => {
    render(<Harness onDeepDive={vi.fn()} />);
    const map = normalizeContainer(screen.getByTestId('chapter'));

    // Nếu khẳng định này hỏng thì hai bài dưới đây trở thành vô nghĩa: chúng
    // sẽ "chứng minh" rằng không có `'￼'` trong một chương vốn không có
    // công thức nào. Task 3 đo được HAI bài kiểm giả của chính họ đúng theo
    // khuôn ấy.
    expect(map.flat).toContain(ATOMIC);
    expect(map.flat).not.toContain('\\tfrac');
  });

  it('BẪY CỦA TASK 8: bôi đen đoạn CÓ CÔNG THỨC ⇒ đoạn trích mang LaTeX GỐC', () => {
    const onDeepDive = vi.fn();
    render(<Harness onDeepDive={onDeepDive} />);
    selectParagraph();

    act(() => {
      screen.getByRole('button', { name: 'Đào sâu' }).click();
    });

    expect(onDeepDive).toHaveBeenCalledOnce();
    const excerpt = onDeepDive.mock.calls[0][0] as SelectionExcerpt;

    // BẰNG NHAU, không phải "có chứa" — xem khối chú thích ở `CORRECT_QUOTE`.
    expect(excerpt.quote).toBe(CORRECT_QUOTE);
    expect(excerpt.quote).not.toContain(ATOMIC);
    // Ba khẳng định dưới đây là ba cách hỏng KHÁC NHAU của cùng một cái bẫy,
    // viết riêng ra để khi một cái đỏ thì thông điệp nói được nó là cái nào.
    expect(excerpt.quote).not.toContain(GLYPH_TEXT); // cây glyph lọt vào
    expect(excerpt.quote.split(TEX)).toHaveLength(2); // công thức bị lặp
  });

  it('vùng bôi đen QUA một hình tương tác: chữ do runtime sinh ra không lọt vào', () => {
    const onDeepDive = vi.fn();
    render(<Harness onDeepDive={onDeepDive} />);
    selectAcrossFigure();

    act(() => {
      screen.getByRole('button', { name: 'Đào sâu' }).click();
    });

    const excerpt = onDeepDive.mock.calls[0][0] as SelectionExcerpt;
    expect(excerpt.quote).toContain('Chặn trên là');
    expect(excerpt.quote).toContain('Sai số dồn lại theo số phép.');
    // `range.toString()` mang cả ba chuỗi này theo; phép chiếu của P2 thì không.
    expect(excerpt.quote).not.toContain('TIP-KHONG-DUOC-VAO');
    expect(excerpt.quote).not.toContain('CTRL-KHONG-DUOC-VAO');
    expect(excerpt.quote).not.toContain('READOUT-KHONG-DUOC-VAO');
  });

  it('không bôi đen gì thì nút không tồn tại, và không có đoạn trích nào được trao', () => {
    const onDeepDive = vi.fn();
    render(<Harness onDeepDive={onDeepDive} />);
    expect(screen.queryByRole('button', { name: 'Đào sâu' })).toBeNull();
    expect(onDeepDive).not.toHaveBeenCalled();
  });
});

describe('DeepDive — LỜI NHẮC RỜI KHỎI TRANG phải mang LaTeX gốc', () => {
  /**
   * PHA 2: không còn vai `system` riêng trên dây (`chatRequest` phía Go chỉ
   * có `question`/`course_slug` — xem `useAI.ts`'s doc comment). Ngữ cảnh mà
   * `deepDiveSystemPrompt` dựng (khoá học, chương, LaTeX gốc của đoạn bôi
   * đen) nay GỘP VÀO ĐẦU `question` gửi đi — bài này đo đúng chỗ đó thay vì
   * một `message` vai `system` không còn tồn tại.
   */
  it('question gửi đi chứa mã LaTeX gốc của đoạn bôi đen, không chứa ký tự rỗng', async () => {
    // Lấy đoạn trích qua ĐÚNG đường người dùng đi: bôi đen rồi bấm nút.
    let captured: SelectionExcerpt | null = null;
    const { unmount } = render(
      <Harness
        onDeepDive={(e) => {
          captured = e;
        }}
      />,
    );
    selectParagraph();
    act(() => {
      screen.getByRole('button', { name: 'Đào sâu' }).click();
    });
    unmount();
    expect(captured).not.toBeNull();

    const requests: { question: string }[] = [];
    const sse = controllableSSE();
    server.use(
      http.post('/ai/chat', async ({ request }) => {
        requests.push((await request.json()) as { question: string });
        return new HttpResponse(sse.stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );

    render(
      <LanguageProvider><MemoryRouter>
        <DeepDive
          courseTitle="Số dấu phẩy động"
          chapterTitle="Sai số làm tròn"
          excerpt={captured!}
          onClose={() => {}}
        />
      </MemoryRouter></LanguageProvider>,
    );

    // `autoAsk` gửi lời nhắc ngay khi mở — không còn vòng dò trước
    // (`AskPanel.tsx`'s doc comment).
    await act(async () => {
      await flush();
    });

    expect(requests).toHaveLength(1);
    const { question } = requests[0];
    expect(question).toContain(CORRECT_QUOTE);
    expect(question).not.toContain(ATOMIC);
    expect(question).not.toContain(GLYPH_TEXT);
    expect(question.split(TEX)).toHaveLength(2);

    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
  });

  it('hiện lại ĐÚNG đoạn người học đã bôi đen, để họ thấy panel đang nói về cái gì', () => {
    // `autoAsk` (dùng bên trong `AskPanel`) vẫn bắn một request thật ngay khi
    // mở — bài này không quan tâm nó ra sao, chỉ cần một hồi đáp hợp lệ để
    // `onUnhandledRequest: 'error'` không ném.
    server.use(http.post('/ai/chat', () => HttpResponse.json({ code: 'Internal', error: 'x' }, { status: 500 })));
    const excerpt: SelectionExcerpt = {
      quote: `Chặn trên là $${TEX}$ cho mỗi phép cộng.`,
      before: 'Sai số',
      after: '',
    };
    render(
      <LanguageProvider><MemoryRouter>
        <DeepDive courseTitle="K" chapterTitle="C" excerpt={excerpt} onClose={() => {}} />
      </MemoryRouter></LanguageProvider>,
    );
    expect(screen.getByTestId('ai-quote')).toHaveTextContent(TEX);
  });
});
