import { describe, expect, it } from 'vitest';
import { domToFlat, flatToDom, isMapStale, normalizeContainer, rangeToFlat, StaleNormMapError } from './normalize';

/**
 * Builds a fixture DOM tree from an HTML string, exactly like every other
 * `ChapterView`-adjacent test in this repo (see
 * `../reader/injectExerciseCheckboxes.test.ts`).
 */
function el(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

/**
 * Builds an HTML fragment that mimics real KaTeX output closely enough to
 * exercise normalize.ts's logic, WITHOUT running real KaTeX in jsdom.
 *
 * Representativeness: this shape was not guessed. `packages/course-kit`'s
 * own bundled KaTeX (`packages/course-kit/vendor/katex.js`) was inspected
 * directly (it is the exact renderer `CourseKit.renderKatex` — a thin
 * wrapper around `renderMathInElement`, see `runtime.js:319` — calls
 * against every chapter at read time). Its minified source confirms the
 * output shape used below:
 *   - inline math: `<span class="katex">…</span>`.
 *   - display math (`$$…$$`): wrapped one level further in
 *     `<span class="katex-display">…</span>` (see the `Mt` helper in
 *     vendor/katex.js, which pushes the `"katex-display"` class span
 *     around the inline result).
 *   - inside `.katex`: a `.katex-mathml` span (screen-reader-only via
 *     CSS clip, never `display:none` — see `zt`/`kt` in vendor/katex.js)
 *     holding `<math><semantics><mrow>…</mrow><annotation
 *     encoding="application/x-tex">RAW_TEX</annotation></semantics></math>`,
 *     followed by a `.katex-html` span with `aria-hidden="true"` holding
 *     the visual glyph markup.
 * The real glyph markup nests many more `mord`/`mbin`/spacer spans for
 * complex expressions than this fixture bothers with — normalize.ts never
 * looks past the outer `.katex`/`.katex-display` boundary (that is the
 * whole point of atomic collapsing), so the internal glyph structure is
 * irrelevant to what's under test here. What matters, and what this
 * fixture reproduces faithfully, is: (a) the *same* visible text appears
 * twice (once in the MathML `<mrow>`, once in the HTML glyphs) plus the
 * raw TeX source a third time in `<annotation>`, so naive `textContent`
 * over the subtree is tripled/meaningless, and (b) the exact outer
 * class-name nesting (`katex-display` > `katex` > `katex-mathml` +
 * `katex-html`) that normalize.ts's selectors match against.
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

/** A realistic runtime-generated interactive-figure subtree: canvas + tip
 * (both produced by `Plot`'s constructor, `runtime.js:143-149`), a
 * `.ctrls` row (`ctrlRow`, `runtime.js:300`) and a `.readout`
 * (`runtime.js:301-308`) — everything `initViz` mounts under a
 * `[data-viz]` host. */
function vizFixture(): string {
  return (
    `<div class="fig-body"><div data-viz="kl-directions" data-done="1">` +
    `<div class="relwrap"><canvas></canvas><div class="tip">σ = 1.2</div></div>` +
    `<div class="ctrls"><div class="ctrl"><label>μ</label><input type="range"></div></div>` +
    `<div class="readout"><div class="cell"><div class="k">D(p‖q)</div><div class="v">0.42</div></div></div>` +
    `</div></div>`
  );
}

// Adapted from the task brief's own fixture (task-1-brief.md Step 1), cut
// from real prose in courses/***REMOVED***/chapters/p1-5.html
// ("Xét phân kỳ ... giữa hai phân phối") with two inline formulas and a
// `.ctrls` block that must be excluded.
const BRIEF_FIX = `<div id="c"><p>Xét phân kỳ ${katexSpan('D_{\\mathrm{KL}}(p\\Vert q)', 'DKL(p‖q)')} giữa hai phân phối,
và ${katexSpan('H(p,q)', 'H(p,q)')} là đại lượng trung tâm.</p>
<div class="ctrls"><label>bỏ qua tôi</label></div></div>`;

/** The sentence finding I1 was measured on, cut from the same p1-5.html:
 * ONE inline formula with real prose on BOTH sides, so a selection can end
 * inside the formula (formula at the TAIL of the selection) or start inside
 * it (formula at the HEAD). */
const I1_FIX = `<div id="c"><p>Giả sử dữ liệu thực sự theo ${katexSpan('p', 'p')}, nhưng bạn thiết kế bộ mã tối ưu cho phân phối khác.</p></div>`;

/** A chapter container with a rail/TOC as its SIBLING — the shape finding I4
 * is about. `#chapter` is what gets normalized; `#rail` is DOM the reader can
 * also drag in but which has no flat position at all. */
const OUTSIDE_FIX =
  `<section id="chapter"><p>Nội dung chương thật.</p></section>` +
  `<aside id="rail"><a href="#sec-a">Mục lục ngoài chương</a></aside>`;

/** A DOM position deep inside a formula's VISIBLE glyph tree — where a mouse
 * drag that stops "on the formula" actually lands (the MathML half is
 * clipped out of the hit-testable area by KaTeX's CSS). */
function glyphTextOf(atomicEl: Element): Text {
  return atomicEl.querySelector('.katex-html .mord')!.firstChild as Text;
}

/**
 * Ngân sách của bài test "không quadratic" — **không phải một khẳng định**,
 * mà là `testTimeout` của vitest, và lý do phải đặt tường minh thì đo được.
 *
 * Bài đó chỉ tốn **121 – 130 ms** lúc máy nhàn (3 lần chạy). Dưới
 * `--maxWorkers=24` (24 worker vitest trên 8 lõi) nó tốn tới **4391 ms** —
 * phồng ~35× vì tranh chấp lịch, đo bằng `--reporter=json` trên 12 lần chạy
 * bộ đầy đủ. So với `testTimeout` mặc định 5000 ms thì biên chỉ **1,14×**,
 * và nó đã thủng: **1 hỏng / 24** lần chạy bộ đầy đủ, nguyên văn
 * `Error: Test timed out in 5000ms.`
 *
 * Ghi cho rõ để không ai đổ cho phép đếm mới: bản CŨ (đo bằng đồng hồ) tốn
 * **114 – 132 ms** lúc máy nhàn — **bằng đúng bản này**. Cái trần 5000 ms
 * vốn đã quá sát với bài test này từ trước; bản cũ chỉ chưa bao giờ chạm
 * tới nó vì nó hỏng ở khẳng định 60 ms trước.
 *
 * Vì sao nới cái này KHÔNG phải làm yếu: thân bài test là mã đồng bộ thuần
 * — dựng fixture rồi đếm — nên nó không CHỜ cái gì cả. Không có hành vi nào
 * mà `testTimeout` bắt được và hai khẳng định đếm-node không bắt được;
 * `testTimeout` ở đây chỉ đang canh tốc độ CPU của máy chạy test.
 *
 * 30 s = 6,8× lần chạy tệ nhất từng đo, và cùng con số mà
 * `src/test/syncLifecycle.test.tsx` đã chốt cho cùng loại vấn đề.
 */
const OVERSUBSCRIBED_MS = 30_000;

/** Số node trong cây con của `root`, KỂ CẢ chính nó. */
function nodeCount(root: Node): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  let n = 1;
  while (walker.nextNode() !== null) n++;
  return n;
}

/**
 * Số node DOM mà một lần chạy thực sự NHÌN QUA. **Tất định** — không có
 * đồng hồ nào tham gia, nên tải máy không vào được phép đo. Cùng kỹ thuật
 * với `dpCells` của `anchor.test.ts`, theo ruling P2-F13.
 *
 * Vì sao phải đếm chứ không bấm giờ: bản trước của bài test "không
 * quadratic" đặt trần 60 ms tuyệt đối, và trần đó hỏng **2 lần / 24 lần**
 * chạy bộ đầy đủ ở `--maxWorkers=24` (24 worker vitest trên 8 lõi — hình
 * dạng của một CI bị oversubscribe). Nguyên văn lần hỏng:
 * `AssertionError: expected 99.95658299999923 to be less than 60`. Cùng
 * fixture, cùng máy, cùng phép việc; khác đúng mức tranh chấp CPU. Một cổng
 * nghiệm thu không được phụ thuộc vào chuyện đó.
 *
 * Mô hình chi phí, phát biểu rõ vì đó là thứ làm phép đếm này có nghĩa: mỗi
 * thao tác DOM bị tính bằng **số node nó buộc phải nhìn**.
 *   · một bước của `TreeWalker`/`NodeIterator` nhìn 1 node;
 *   · mỗi lần bộ lọc `acceptNode` được gọi là 1 node được xem xét — đây mới
 *     là vòng đi `normalizeContainer` thật sự trả tiền, vì `nextNode()` chỉ
 *     trả về node được CHẤP NHẬN còn số node phải cân nhắc nằm ở bộ lọc;
 *   · `matches`/`closest` xét 1 node;
 *   · một truy vấn chọn (`querySelector*`, `getElementsBy*`) hay một lần đọc
 *     `textContent` phải quét TRỌN cây con của node nhận, nên bị tính đúng
 *     bằng kích thước cây con đó — **kể cả khi nó trả về rỗng**. Tính theo
 *     độ dài kết quả sẽ là chặn DƯỚI, và một chặn dưới thì không chứng minh
 *     được gì về việc "rẻ": `querySelectorAll('.không-có-gì')` quét cả cây
 *     rồi trả về 0 phần tử;
 *   · một lần đọc `childNodes`/`children` nhìn đúng số con.
 *
 * Nên phép đếm không phụ thuộc cách jsdom cài đặt gì cả: một vòng đi bậc
 * hai viết bằng `querySelectorAll`, bằng đệ quy qua `childNodes`, hay bằng
 * một `TreeWalker` thứ hai đều bị tính như nhau.
 *
 * Vá prototype chỉ được phép ở test và phải hoàn nguyên vô điều kiện —
 * `finally` bên dưới. Không có móc đo đạc nào trong `normalize.ts`, và cố ý
 * không thêm: đây là phép đo của bộ test, không phải của sản phẩm.
 */
function domNodeVisits(run: () => void): number {
  let visits = 0;
  const undo: Array<() => void> = [];

  // Bản gốc, lấy TRƯỚC khi vá, để `subtreeSize` tự đi cây mà không tự đếm
  // chính nó và không đệ quy vào bản đã vá.
  const realCreateTreeWalker = Document.prototype.createTreeWalker;
  const realNextNode = TreeWalker.prototype.nextNode;
  const subtreeSize = (node: Node): number => {
    const walker = realCreateTreeWalker.call(document, node, NodeFilter.SHOW_ALL);
    let n = 1;
    while (realNextNode.call(walker) !== null) n++;
    return n;
  };

  const patchMethod = (proto: object, prop: string, charge: (self: unknown) => number): void => {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || typeof desc.value !== 'function') return;
    const real = desc.value as (...args: unknown[]) => unknown;
    Object.defineProperty(proto, prop, {
      ...desc,
      value(this: unknown, ...args: unknown[]): unknown {
        const result = real.apply(this, args);
        visits += charge(this);
        return result;
      },
    });
    undo.push(() => Object.defineProperty(proto, prop, desc));
  };

  const patchGetter = (proto: object, prop: string, charge: (self: unknown, result: unknown) => number): void => {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || typeof desc.get !== 'function') return;
    const real = desc.get;
    Object.defineProperty(proto, prop, {
      ...desc,
      get(this: unknown): unknown {
        const result = real.call(this);
        visits += charge(this, result);
        return result;
      },
    });
    undo.push(() => Object.defineProperty(proto, prop, desc));
  };

  const one = (): number => 1;

  try {
    for (const step of ['nextNode', 'previousNode', 'firstChild', 'lastChild', 'nextSibling', 'previousSibling', 'parentNode']) {
      patchMethod(TreeWalker.prototype, step, one);
    }
    patchMethod(NodeIterator.prototype, 'nextNode', one);
    patchMethod(NodeIterator.prototype, 'previousNode', one);

    // `createTreeWalker` không bị tính công gì cho bản thân lời gọi; nó chỉ
    // bọc bộ lọc lại để mỗi `acceptNode` cộng đúng 1 node.
    const cwDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'createTreeWalker')!;
    Object.defineProperty(Document.prototype, 'createTreeWalker', {
      ...cwDesc,
      value(this: Document, root: Node, whatToShow?: number, filter?: NodeFilter | ((node: Node) => number) | null): TreeWalker {
        let wrapped = filter;
        if (typeof filter === 'function') {
          wrapped = (node: Node): number => {
            visits++;
            return filter(node);
          };
        } else if (filter && typeof filter.acceptNode === 'function') {
          const accept = filter.acceptNode.bind(filter);
          wrapped = {
            acceptNode: (node: Node): number => {
              visits++;
              return accept(node);
            },
          };
        }
        return realCreateTreeWalker.call(this, root, whatToShow ?? NodeFilter.SHOW_ALL, (wrapped ?? null) as NodeFilter | null);
      },
    });
    undo.push(() => Object.defineProperty(Document.prototype, 'createTreeWalker', cwDesc));

    const scan = (self: unknown): number => subtreeSize(self as Node);
    for (const proto of [Element.prototype, Document.prototype, DocumentFragment.prototype]) {
      for (const query of ['querySelector', 'querySelectorAll', 'getElementsByTagName', 'getElementsByTagNameNS', 'getElementsByClassName']) {
        patchMethod(proto, query, scan);
      }
    }
    patchMethod(Element.prototype, 'matches', one);
    patchMethod(Element.prototype, 'closest', one);
    patchGetter(Node.prototype, 'textContent', scan);
    patchGetter(Node.prototype, 'childNodes', (_self, result) => (result as NodeList).length);
    patchGetter(Element.prototype, 'children', (_self, result) => (result as HTMLCollection).length);

    run();
    return visits;
  } finally {
    for (let i = undo.length - 1; i >= 0; i--) undo[i]();
  }
}

describe('normalizeContainer', () => {
  it('katex là 1 token, ctrls bị loại', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    expect(m.flat).toContain('Xét phân kỳ ￼ giữa hai phân phối');
    expect(m.flat).not.toContain('mathml');
    expect(m.flat).not.toContain('bỏ qua tôi');
    // Naive textContent would triple the formula's text (mathml mrow +
    // annotation raw source + html glyphs) — none of that leaks through.
    expect(m.flat).not.toContain('DKL');
    expect(m.flat).not.toContain('D_{\\mathrm{KL}}');
  });

  it('mỗi .katex/.katex-display đóng góp đúng 1 ký tự atomic trong segs', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    const atomicSegs = m.segs.filter((s) => s.atomic);
    expect(atomicSegs).toHaveLength(2);
    for (const seg of atomicSegs) {
      expect(seg.end - seg.start).toBe(1);
      expect(seg.node.nodeType).toBe(Node.ELEMENT_NODE);
      expect((seg.node as Element).classList.contains('katex')).toBe(true);
    }
  });

  it('công thức display ($$...$$) chỉ tạo 1 token — không lặp lại cho .katex bên trong .katex-display', () => {
    const container = el(`<div><p>Trước</p>${katexSpan('x^2', 'x2', true)}<p>Sau</p></div>`);
    const m = normalizeContainer(container);
    const atomicSegs = m.segs.filter((s) => s.atomic);
    expect(atomicSegs).toHaveLength(1);
    expect((atomicSegs[0].node as Element).classList.contains('katex-display')).toBe(true);
    expect(m.flat).toBe('Trước￼Sau');
  });

  it('loại bỏ toàn bộ nội dung runtime của [data-viz]: canvas, .ctrls, .tip, .readout', () => {
    const container = el(`<div><p>Trước hình</p>${vizFixture()}<p>Sau hình</p></div>`);
    const m = normalizeContainer(container);
    expect(m.flat).toBe('Trước hìnhSau hình');
    expect(m.flat).not.toContain('σ');
    expect(m.flat).not.toContain('D(p‖q)');
    expect(m.flat).not.toContain('0.42');
  });

  it('loại bỏ checkbox "Đã làm" mà Task 15 (injectExerciseCheckboxes) tiêm vào .box-h', () => {
    // Mirrors exactly what injectExerciseCheckboxes (src/reader/injectExerciseCheckboxes.ts)
    // appends: <label class="ex-check"><input type="checkbox">…<span>Đã làm</span></label>,
    // inside the SAME .box-h that also carries real authored heading text.
    const container = el(
      `<div class="box ex"><div class="box-h">Bài 1 · Hai chiều của cùng một cặp · ★` +
        `<label class="ex-check"><input type="checkbox" aria-label="Đánh dấu đã làm bài tập 1"><span>Đã làm</span></label>` +
        `</div><p>Nội dung bài tập.</p></div>`,
    );
    const m = normalizeContainer(container);
    expect(m.flat).toContain('Bài 1 · Hai chiều của cùng một cặp · ★');
    expect(m.flat).not.toContain('Đã làm');
  });

  it('bao gồm <th> đối xứng với <td> — cả hai đều là văn xuôi thật trong bảng', () => {
    const container = el(
      `<table class="tbl"><thead><tr><th>Forward $D(p\\Vert q)$</th><th>Reverse</th></tr></thead>` +
        `<tbody><tr><td>ở nơi p lớn</td><td>ở nơi q lớn</td></tr></tbody></table>`,
    );
    const m = normalizeContainer(container);
    expect(m.flat).toContain('Forward');
    expect(m.flat).toContain('Reverse');
    expect(m.flat).toContain('ở nơi p lớn');
    expect(m.flat).toContain('ở nơi q lớn');
  });

  it('bao gồm <summary> của khối chứng minh/lời giải có thể thu gọn', () => {
    const container = el(
      `<details class="deriv"><summary>Chứng minh (3) lồi đồng thời</summary>` +
        `<div class="deriv-body"><p>Nội dung chứng minh.</p></div></details>`,
    );
    const m = normalizeContainer(container);
    expect(m.flat).toContain('Chứng minh (3) lồi đồng thời');
    expect(m.flat).toContain('Nội dung chứng minh.');
  });

  it('bao gồm .fig-title/.fig-desc/.fig-foot/.keyfacts/.box-h — văn xuôi thật quanh hình vẽ', () => {
    const container = el(
      `<div class="fig"><div class="fig-head"><div class="fig-num">Hình 1.7</div>` +
        `<div class="fig-title">Khớp một Gaussian</div><p class="fig-desc">Kéo tham số μ.</p></div>` +
        `${vizFixture()}<div class="fig-foot">Forward KL bắt buộc phủ cả hai mode.</div></div>` +
        `<div class="keyfacts"><div class="box-h">Chốt chương</div><ul><li>Một điểm chốt.</li></ul></div>`,
    );
    const m = normalizeContainer(container);
    expect(m.flat).toContain('Hình 1.7');
    expect(m.flat).toContain('Khớp một Gaussian');
    expect(m.flat).toContain('Kéo tham số μ.');
    expect(m.flat).toContain('Forward KL bắt buộc phủ cả hai mode.');
    expect(m.flat).toContain('Chốt chương');
    expect(m.flat).toContain('Một điểm chốt.');
  });

  it('giữ nguyên khoảng trắng/newline giữa các thẻ — không collapse', () => {
    const container = el('<div><p>Dòng một</p>\n\n  <p>Dòng hai</p></div>');
    const m = normalizeContainer(container);
    expect(m.flat).toBe('Dòng một\n\n  Dòng hai');
  });

  it('<b>/<i> lồng trong <p> không chèn ký tự phân cách, văn bản liền mạch', () => {
    const container = el('<p>Không âm (<b>Gibbs</b>): luôn <i>đúng</i> khi p=q.</p>');
    const m = normalizeContainer(container);
    expect(m.flat).toBe('Không âm (Gibbs): luôn đúng khi p=q.');
  });

  it('hai .katex liền kề không có gì ở giữa tạo ra hai token liền nhau trong flat', () => {
    const container = el(`<p>${katexSpan('a', 'a')}${katexSpan('b', 'b')}</p>`);
    const m = normalizeContainer(container);
    expect(m.flat).toBe('￼￼');
    expect(m.segs.filter((s) => s.atomic)).toHaveLength(2);
    expect(m.segs[0].end).toBe(m.segs[1].start);
  });

  it('text node rỗng không tạo seg nhưng không làm hỏng offset của các seg khác', () => {
    const container = document.createElement('p');
    container.appendChild(document.createTextNode('A'));
    container.appendChild(document.createTextNode('')); // empty, e.g. left behind by DOM manipulation
    container.appendChild(document.createTextNode('B'));
    const m = normalizeContainer(container);
    expect(m.flat).toBe('AB');
    expect(m.segs.filter((s) => s.node.nodeType === Node.TEXT_NODE)).toHaveLength(2);
  });

  it('không quadratic một cách rõ ràng: nhiều trăm công thức trong 1 chương vẫn chạy nhanh', () => {
    const build = (formulas: number): HTMLDivElement => {
      const parts: string[] = [];
      for (let i = 0; i < formulas; i++) {
        parts.push(`<p>Đoạn ${i} có công thức ${katexSpan(`x_{${i}}`, `x${i}`)} ở giữa câu.</p>`);
      }
      return el(`<div>${parts.join('')}</div>`);
    };
    const half = build(200);
    const full = build(400);
    const fullNodes = nodeCount(full);
    expect(fullNodes).toBe(6802);

    let m!: ReturnType<typeof normalizeContainer>;
    const halfVisits = domNodeVisits(() => {
      normalizeContainer(half);
    });
    const fullVisits = domNodeVisits(() => {
      m = normalizeContainer(full);
    });

    expect(m.segs.filter((s) => s.atomic)).toHaveLength(400);

    // Đếm được trên fixture này — SỐ NGUYÊN, lặp lại bao nhiêu lần cũng ra
    // đúng bấy nhiêu, ở mọi mức tải máy:
    //     đúng:          200 công thức 2.004 · 400 công thức 4.004
    //                    → tỉ số 1,998003992015968
    //     mutation M16:  200 công thức 1.162.804 · 400 công thức 4.645.604
    //                    → tỉ số 3,995173735212469
    // (M16 = chèn `root.querySelectorAll('*')` mỗi công thức, tức làm vòng
    // đi bậc hai — đúng mutation mà review Task 1 dùng để chứng minh bài
    // test này có tác dụng.)
    //
    // Hai khẳng định, hai điều khác nhau, cả hai đều tất định:
    //
    // (1) Mỗi node DOM chỉ được nhìn một số lần CÓ CHẶN. 4.004 lần xem trên
    //     6.802 node là 0,589 lần/node; trần `2 × số node` để chỗ cho một
    //     lần viết lại hợp lệ (ví dụ thêm một lượt đi thứ hai) mà vẫn cách
    //     số đo thật 3,4×. M16 vượt trần này 341,5×; nguyên văn lần giết:
    //     `AssertionError: expected 4645604 to be less than 13604`.
    expect(fullVisits).toBeLessThan(fullNodes * 2);
    // (2) Và chi phí đó TUYẾN TÍNH theo kích thước cây, đúng cái tên bài
    //     test nói. Gấp đôi số công thức thì phép đếm gấp đôi (1,99800);
    //     một vòng đi bậc hai thì gấp bốn (3,99277). Ngưỡng 2,5 nằm giữa
    //     hai giá trị đó — cách bản đúng 1,25× và cách mutation 1,60×.
    //     Khẳng định này không phụ thuộc hằng số nào của máy, chỉ phụ thuộc
    //     độ dốc: đó là thứ mà một trần mili-giây tuyệt đối không bao giờ
    //     phát biểu được.
    expect(fullVisits).toBeLessThan(halfVisits * 2.5);
  }, OVERSUBSCRIBED_MS);
});

describe('flatToDom / domToFlat round-trip', () => {
  it('round-trip flat→dom→flat trên text thường', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    const i = m.flat.indexOf('hai phân phối');
    const r = flatToDom(m, i, i + 13)!;
    expect(r).not.toBeNull();
    expect(r.toString()).toBe('hai phân phối');
    expect(domToFlat(m, r.startContainer, r.startOffset)).toBe(i);
    expect(domToFlat(m, r.endContainer, r.endOffset)).toBe(i + 13);
  });

  it('offset trong katex snap ra mép token', () => {
    const container = el(BRIEF_FIX);
    const m = normalizeContainer(container);
    const atomicSeg = m.segs.find((s) => s.atomic)!;
    const katexNode = atomicSeg.node as Element;
    const deepTextNode = katexNode.querySelector('annotation')!.firstChild as Text;

    // A DOM position anywhere inside the katex subtree — whether in the
    // hidden MathML/annotation or the visible HTML glyphs — must resolve
    // to the SAME flat position: the token's own start edge.
    expect(domToFlat(m, deepTextNode, 3)).toBe(atomicSeg.start);
    expect(domToFlat(m, katexNode, 0)).toBe(atomicSeg.start); // pointing at the katex element itself, offset 0

    const glyphSpan = katexNode.querySelector('.katex-html .mord');
    const htmlGlyphText = glyphSpan?.firstChild as Text | undefined;
    expect(htmlGlyphText).toBeDefined();
    expect(domToFlat(m, htmlGlyphText!, 1)).toBe(atomicSeg.start);
  });

  it('flatToDom snap mép ra ngoài .katex: range chạm formula không bao giờ neo bên trong nó', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    const atomicSeg = m.segs.find((s) => s.atomic)!;
    const katexEl = atomicSeg.node as Element;

    // [from,to] = exactly the formula's own span.
    const exact = flatToDom(m, atomicSeg.start, atomicSeg.end)!;
    expect(exact).not.toBeNull();
    for (const container of [exact.startContainer, exact.endContainer]) {
      expect(container).not.toBe(katexEl);
      expect(katexEl.contains(container)).toBe(false);
    }
    // The range still structurally contains the whole katex element.
    expect(exact.cloneContents().querySelectorAll('.katex')).toHaveLength(1);
  });

  it('flatToDom cho khoảng vượt qua công thức round-trip đúng qua domToFlat (không qua Range.toString, vốn không đáng tin ở đây)', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    const from = m.flat.indexOf('kỳ ') + 'kỳ '.length - 1; // a couple chars before the first formula
    const to = m.flat.indexOf(' giữa') + 1; // a couple chars after it — spans the formula
    expect(from).toBeLessThan(to);

    const r = flatToDom(m, from, to)!;
    expect(r).not.toBeNull();
    expect(domToFlat(m, r.startContainer, r.startOffset)).toBe(from);
    expect(domToFlat(m, r.endContainer, r.endOffset)).toBe(to);
    // Range.toString() is NOT the round-trip oracle here: it serializes
    // the *real* DOM text under the spanned .katex (mathml + annotation +
    // html glyphs all at once), which is exactly the tripled/meaningless
    // text this whole module exists to hide from annotation storage.
    expect(r.toString()).not.toBe(m.flat.slice(from, to));
  });

  it('round-trip qua ranh giới <b> lồng trong <p>', () => {
    const container = el('<p>Không âm (<b>Gibbs</b>): luôn đúng.</p>');
    const m = normalizeContainer(container);
    const from = m.flat.indexOf('âm (');
    const to = m.flat.indexOf('): luôn') + '):'.length;
    const r = flatToDom(m, from, to)!;
    expect(r.toString()).toBe(m.flat.slice(from, to));
    expect(domToFlat(m, r.startContainer, r.startOffset)).toBe(from);
    expect(domToFlat(m, r.endContainer, r.endOffset)).toBe(to);
  });

  it('flatToDom trả null khi container không có nội dung annotatable nào', () => {
    const container = el('<div class="ctrls"><label>chỉ có UI runtime</label></div>');
    const m = normalizeContainer(container);
    expect(m.flat).toBe('');
    expect(flatToDom(m, 0, 0)).toBeNull();
  });

  it('domToFlat khoan dung với node không được theo dõi (bên trong vùng bị loại trừ): giải quyết về nội dung thật gần nhất', () => {
    const container = el(`<p>Trước</p>${vizFixture()}<p>Sau</p>`);
    const m = normalizeContainer(container);
    const tipText = container.querySelector('.tip')!.firstChild;
    expect(() => domToFlat(m, tipText as Node, 0)).not.toThrow();
    // A position inside excluded runtime UI has no flat position of its
    // own; it resolves to the nearest tracked content AFTER it in
    // document order — here, the start of "Sau" (climbing up through
    // .tip → .relwrap → [data-viz] → .fig-body and scanning forward at
    // each level, per resolveWithinElement's doc comment in normalize.ts).
    expect(domToFlat(m, tipText as Node, 0)).toBe(m.flat.indexOf('Sau'));
  });
});

// ===========================================================================
// Fix round 1. Every test below was written RED-first against the reviewed
// implementation (3e420c9) and names the review finding it pins. Several of
// them exist specifically because a mutation of normalize.ts SURVIVED the
// original suite — the mutation each one kills is named in its describe
// block, and re-running that mutation is how the test was verified to have
// teeth rather than merely to pass.
// ===========================================================================

describe('C1 — bôi chọn nằm gọn trong một công thức (review §2)', () => {
  it('flatToDom trả null khi from === to: Range collapsed không bao giờ là "thành công"', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    const i = m.flat.indexOf('hai phân phối');
    expect(flatToDom(m, i, i)).toBeNull();
    expect(flatToDom(m, 0, 0)).toBeNull();
    expect(flatToDom(m, m.flat.length, m.flat.length)).toBeNull();
    // Đối chứng: khoảng KHÔNG rỗng, dù chỉ 1 ký tự, vẫn cho Range.
    expect(flatToDom(m, i, i + 1)).not.toBeNull();
  });

  it('kéo chuột nằm gọn trong một công thức display cho ra NGUYÊN công thức, không phải Range rỗng', () => {
    // Thao tác tự nhiên nhất để "tô một công thức" trong giáo trình toán:
    // nhấn ở giữa khối $$…$$ rồi thả cũng ở giữa nó (khối display căn giữa
    // chiếm cả chiều rộng — mục tiêu kéo chuột lớn nhất trang). Trước bản
    // vá, cả hai mép snap về CÙNG mép đầu ⇒ from === to ⇒ flatToDom trả
    // một Range collapsed nhưng NON-NULL ⇒ painter vẽ không ra gì còn store
    // vẫn lưu một annotation vô hình, không bấm được nên không xóa được.
    const container = el(`<div><p>Trước</p>${katexSpan('x^2', 'x2', true)}<p>Sau</p></div>`);
    const m = normalizeContainer(container);
    const seg = m.segs.find((s) => s.atomic)!;
    const displayEl = seg.node as Element;

    const range = document.createRange();
    range.setStart(displayEl.querySelector('mi')!.firstChild as Text, 0);
    const glyph = glyphTextOf(displayEl);
    range.setEnd(glyph, glyph.data.length);
    expect(range.collapsed).toBe(false);

    const span = rangeToFlat(m, range);
    expect(span).toEqual({ from: seg.start, to: seg.end });

    const painted = flatToDom(m, span!.from, span!.to)!;
    expect(painted).not.toBeNull();
    expect(painted.collapsed).toBe(false);
    expect(painted.cloneContents().querySelectorAll('.katex-display')).toHaveLength(1);
  });
});

describe('I1 — mép cuối snap RA NGOÀI token atomic, không lùi vào trong (review §3)', () => {
  it('domToFlat: bias "end" trả mép CUỐI của token; mặc định và "start" vẫn trả mép đầu', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    const seg = m.segs.find((s) => s.atomic)!;
    const katexEl = seg.node as Element;
    const deepInAnnotation = katexEl.querySelector('annotation')!.firstChild as Text;

    expect(domToFlat(m, deepInAnnotation, 3)).toBe(seg.start);
    expect(domToFlat(m, deepInAnnotation, 3, 'start')).toBe(seg.start);
    expect(domToFlat(m, deepInAnnotation, 3, 'end')).toBe(seg.end);
    expect(domToFlat(m, katexEl, 0, 'end')).toBe(seg.end);
    expect(domToFlat(m, glyphTextOf(katexEl), 1, 'end')).toBe(seg.end);
  });

  it('công thức được bao TRỌN dù nằm ở cuối hay ở đầu đoạn chọn — không phụ thuộc chiều kéo', () => {
    const container = el(I1_FIX);
    const m = normalizeContainer(container);
    const seg = m.segs.find((s) => s.atomic)!;
    const before = m.segs.find((s) => !s.atomic && s.end === seg.start)!;
    const after = m.segs.find((s) => !s.atomic && s.start === seg.end)!;
    const inside = glyphTextOf(seg.node as Element);

    // Công thức ở CUỐI đoạn chọn (kéo xuôi, nhả chuột TRÊN công thức).
    // Trước bản vá `to` lùi về seg.start ⇒ công thức rơi ra ngoài đúng cái
    // người dùng vừa thấy trình duyệt bôi xanh, và highlight hiện ra ngắn
    // hơn vùng họ bôi đúng một công thức.
    const tailRange = document.createRange();
    tailRange.setStart(before.node as Text, 0);
    tailRange.setEnd(inside, 1);
    const tail = rangeToFlat(m, tailRange)!;
    expect(tail.to).toBe(seg.end);

    // Công thức ở ĐẦU đoạn chọn (nhấn chuột TRÊN công thức rồi kéo tiếp).
    const headRange = document.createRange();
    headRange.setStart(inside, 1);
    headRange.setEnd(after.node as Text, 10);
    const head = rangeToFlat(m, headRange)!;
    expect(head.from).toBe(seg.start);

    // Bất biến thật sự: ở CẢ HAI chiều, công thức nằm trọn trong đoạn chọn.
    for (const span of [tail, head]) {
      expect(span.from).toBeLessThanOrEqual(seg.start);
      expect(span.to).toBeGreaterThanOrEqual(seg.end);
    }
  });
});

describe('I4 — vị trí ngoài root phải báo được, không giả vờ là đầu/cuối chương (review §3)', () => {
  it('NormMap ghi lại root của lần chuẩn hoá', () => {
    const host = el(OUTSIDE_FIX);
    const root = host.querySelector('#chapter')!;
    expect(normalizeContainer(root).root).toBe(root);
  });

  it('domToFlat trả null cho node ngoài root (rail/TOC, cây rời) — không phải 0 hay flat.length', () => {
    const host = el(OUTSIDE_FIX);
    const root = host.querySelector('#chapter')!;
    const m = normalizeContainer(root);

    const railText = host.querySelector('#rail a')!.firstChild as Text;
    expect(domToFlat(m, railText, 0)).toBeNull();
    expect(domToFlat(m, railText, 0, 'end')).toBeNull();
    expect(domToFlat(m, host, 1)).toBeNull(); // chính cha của root

    const detached = document.createElement('p');
    detached.textContent = 'hoàn toàn tách rời';
    expect(domToFlat(m, detached.firstChild!, 0)).toBeNull();

    // Đối chứng: bên trong root vẫn giải bình thường — 0 vẫn là 0 THẬT,
    // và đó chính là lý do 0 không được phép kiêm nghĩa "thất bại".
    const inside = root.querySelector('p')!.firstChild as Text;
    expect(domToFlat(m, inside, 0)).toBe(0);
    expect(domToFlat(m, inside, 3)).toBe(3);
  });

  it('rangeToFlat trả null khi một mép nằm ngoài root', () => {
    const host = el(OUTSIDE_FIX);
    const root = host.querySelector('#chapter')!;
    const m = normalizeContainer(root);
    const inside = root.querySelector('p')!.firstChild as Text;
    const railText = host.querySelector('#rail a')!.firstChild as Text;

    const r = document.createRange();
    r.setStart(inside, 0);
    r.setEnd(railText, 2);
    expect(rangeToFlat(m, r)).toBeNull();
  });
});

describe('rangeToFlat — cách dùng ĐÚNG là cách dùng mặc định (review §2, đề xuất (b))', () => {
  it('đoạn chọn văn xuôi bình thường cho đúng [from, to)', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    const i = m.flat.indexOf('hai phân phối');
    const r = flatToDom(m, i, i + 13)!;
    expect(rangeToFlat(m, r)).toEqual({ from: i, to: i + 13 });
  });

  it('Range collapsed (nháy chuột, không bôi gì) trả null — kể cả khi nháy vào giữa công thức', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    const seg = m.segs.find((s) => s.atomic)!;

    const caretInProse = document.createRange();
    caretInProse.setStart(m.segs[0].node as Text, 3);
    caretInProse.collapse(true);
    expect(rangeToFlat(m, caretInProse)).toBeNull();

    // Đây là chỗ chốt chặn này thật sự cần: hai mép snap ra hai hướng
    // ngược nhau nên from < to, tức là nếu không kiểm `collapsed` thì
    // một cú NHÁY vào công thức sẽ thành một annotation cả công thức.
    const caretInFormula = document.createRange();
    caretInFormula.setStart(glyphTextOf(seg.node as Element), 1);
    caretInFormula.collapse(true);
    expect(rangeToFlat(m, caretInFormula)).toBeNull();
  });

  it('đoạn chọn không rỗng nhưng nằm trọn trong vùng bị loại trừ cho from === to ⇒ null', () => {
    const container = el(`<div><p>Trước</p>${vizFixture()}<p>Sau</p></div>`);
    const m = normalizeContainer(container);
    const tipText = container.querySelector('.tip')!.firstChild as Text;

    const r = document.createRange();
    r.setStart(tipText, 0);
    r.setEnd(tipText, 3);
    expect(r.collapsed).toBe(false);
    expect(rangeToFlat(m, r)).toBeNull();
  });
});

describe('I2 — mỗi selector loại trừ phải tự đứng vững MỘT MÌNH (review §3, mutation M5–M8)', () => {
  // `vizFixture()` đặt canvas/.tip/.ctrls/.readout BÊN TRONG [data-viz], nên
  // mỗi selector đều được selector khác che: xóa bất kỳ cái nào khỏi
  // EXCLUDED_SELECTOR cũng không làm test nào đỏ. Mỗi test dưới đây tách ra
  // đúng MỘT selector và không để cái nào khác che nó.

  it('[data-viz] chặn được legend/.ctrl/<button>/div.small.muted — thứ danh sách hẹp KHÔNG có tên', () => {
    // runtime.js sinh legendRow (:309), seg (:283), ctrl (:274), button
    // (:298), và viz.js:50 sinh div.small.muted — TRỰC TIẾP dưới host
    // [data-viz]. Không cái nào khớp canvas/.tip/.ctrls/.readout/.ex-check.
    // Nếu ai đó dọn EXCLUDED_SELECTOR và bỏ [data-viz] vì "đã có canvas/.tip
    // rồi", đúng những chuỗi này chui vào flat — và nhãn legend phụ thuộc
    // TRẠNG THÁI viz, tức khác nhau giữa hai lần render và giữa hai thiết
    // bị: anchor lưu ở máy A không giải được ở máy B.
    const container = el(
      `<div><p>Trước hình</p>` +
        `<div data-viz="kl-directions">` +
        `<div class="legend"><span class="sw"></span>p (hỗn hợp hai mode)</div>` +
        `<div class="ctrl"><label>μ</label><input type="range"></div>` +
        `<div class="seg"><button type="button">Forward</button><button type="button">Reverse</button></div>` +
        `<div class="small muted">Kéo để thay đổi tham số.</div>` +
        `</div>` +
        `<p>Sau hình</p></div>`,
    );
    const m = normalizeContainer(container);
    expect(m.flat).toBe('Trước hìnhSau hình');
  });

  it('canvas tự nó bị loại (nội dung dự phòng trong <canvas> không phải văn xuôi)', () => {
    const m = normalizeContainer(
      el('<div><p>Trước</p><canvas>Trình duyệt không hỗ trợ canvas</canvas><p>Sau</p></div>'),
    );
    expect(m.flat).toBe('TrướcSau');
  });

  it('.tip tự nó bị loại kể cả khi không nằm trong [data-viz]', () => {
    const m = normalizeContainer(el('<div><p>Trước</p><div class="tip">σ = 1.2</div><p>Sau</p></div>'));
    expect(m.flat).toBe('TrướcSau');
  });

  it('.readout tự nó bị loại kể cả khi không nằm trong [data-viz]', () => {
    const m = normalizeContainer(
      el('<div><p>Trước</p><div class="readout"><div class="k">D(p‖q)</div><div class="v">0.42</div></div><p>Sau</p></div>'),
    );
    expect(m.flat).toBe('TrướcSau');
  });

  it('.ctrls tự nó bị loại kể cả khi không nằm trong [data-viz]', () => {
    const m = normalizeContainer(el('<div><p>Trước</p><div class="ctrls"><label>μ</label></div><p>Sau</p></div>'));
    expect(m.flat).toBe('TrướcSau');
  });

  it('.ex-check tự nó bị loại kể cả khi không nằm trong .box-h', () => {
    const m = normalizeContainer(
      el('<div><p>Trước</p><label class="ex-check"><input type="checkbox"><span>Đã làm</span></label><p>Sau</p></div>'),
    );
    expect(m.flat).toBe('TrướcSau');
  });
});

describe('I3 — biên CUỐI chương (review §3, mutation M13)', () => {
  it('tô mấy chữ cuối chương: pos === flat.length cho Range hợp lệ và round-trip đúng', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    const n = m.flat.length;
    const r = flatToDom(m, n - 8, n)!;
    expect(r).not.toBeNull();
    expect(r.toString()).toBe(m.flat.slice(n - 8, n));
    expect(domToFlat(m, r.startContainer, r.startOffset)).toBe(n - 8);
    expect(domToFlat(m, r.endContainer, r.endOffset, 'end')).toBe(n);
  });

  it('đúng ký tự cuối cùng, một mình, cũng tô được', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    const n = m.flat.length;
    const r = flatToDom(m, n - 1, n)!;
    expect(r.toString()).toBe(m.flat.slice(n - 1));
    expect(domToFlat(m, r.endContainer, r.endOffset, 'end')).toBe(n);
  });

  it('offset vượt quá flat.length bị kẹp về cuối, không ném IndexSizeError', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    const n = m.flat.length;
    const r = flatToDom(m, n - 3, n + 999)!;
    expect(r).not.toBeNull();
    expect(domToFlat(m, r.endContainer, r.endOffset, 'end')).toBe(n);
  });
});

describe('M-c — clamp offset của text node (review §4, mutation M14)', () => {
  it('offset vượt quá độ dài text node bị kẹp về mép seg, không tràn sang seg sau', () => {
    const container = el('<div><p>Alpha</p><p>Beta</p></div>');
    const m = normalizeContainer(container);
    expect(m.flat).toBe('AlphaBeta');
    const first = container.querySelector('p')!.firstChild as Text;
    const seg = m.segs.find((s) => s.node === first)!;
    expect(domToFlat(m, first, 999)).toBe(seg.end);
    expect(domToFlat(m, first, -7)).toBe(seg.start);
  });

  it('offset không hữu hạn (NaN/Infinity) trả null thay vì NaN', () => {
    const container = el('<div><p>Alpha</p></div>');
    const m = normalizeContainer(container);
    const t = container.querySelector('p')!.firstChild as Text;
    expect(domToFlat(m, t, Number.NaN)).toBeNull();
    expect(domToFlat(m, t, Number.POSITIVE_INFINITY)).toBeNull();
    expect(flatToDom(m, Number.NaN, 3)).toBeNull();
  });
});

describe('M-d — nhánh hoán đổi from/to của flatToDom (review §4, mutation M12)', () => {
  it('from/to đảo ngược được chuẩn hoá lại, KHÔNG cho ra Range collapsed', () => {
    // Giữ nhánh này thay vì bỏ nó: nếu bỏ, `setEnd` với biên nằm TRƯỚC
    // start sẽ (đúng theo spec DOM) làm Range tự collapse — tức là đúng lỗi
    // "annotation vô hình" mà chốt chặn `from === to` tồn tại để ngăn, chỉ
    // khác là lần này nó lọt qua chốt vì về mặt số học from !== to.
    const m = normalizeContainer(el(BRIEF_FIX));
    const i = m.flat.indexOf('hai phân phối');
    const fwd = flatToDom(m, i, i + 13)!;
    const rev = flatToDom(m, i + 13, i)!;
    expect(rev).not.toBeNull();
    expect(rev.collapsed).toBe(false);
    expect(rev.startContainer).toBe(fwd.startContainer);
    expect(rev.startOffset).toBe(fwd.startOffset);
    expect(rev.endContainer).toBe(fwd.endContainer);
    expect(rev.endOffset).toBe(fwd.endOffset);
  });
});

describe('M-a / M-b — hai lỗ hổng tiềm ẩn (review §4)', () => {
  it('M-a: <style>/<script>/<svg> không bao giờ thành văn xuôi tô được', () => {
    // Cả ba đều mang text THẬT trong DOM nhưng VÔ HÌNH với người đọc
    // (<svg><title>/<desc> là chuỗi trợ năng). Lọt vào flat, chúng chiếm
    // những offset không ai chọn được và làm lệch mọi offset phía sau.
    const container = el(
      `<div><p>Trước.</p><style>.fig{color:red}</style><script>var secret=1;</script>` +
        `<svg viewBox="0 0 10 10"><title>Sơ đồ ẩn</title><desc>mô tả ẩn</desc><text x="0" y="5">nhãn</text></svg>` +
        `<p>Sau</p></div>`,
    );
    const m = normalizeContainer(container);
    expect(m.flat).toBe('Trước.Sau');
  });

  it('M-b: công thức KaTeX lỗi cú pháp (.katex-error) cũng là 1 token atomic, TeX thô không lọt vào flat', () => {
    // Với throwOnError:false (đúng option runtime.js:319-333 dùng), lỗi
    // parse cho <span class="katex-error">RAW_TEX</span> KHÔNG bọc trong
    // .katex và KHÔNG bọc trong .katex-display — nên nếu ATOMIC_SELECTOR
    // không nhắc tới nó, nguyên chuỗi TeX thô vào flat như văn xuôi.
    const container = el(
      `<div><p>Trước <span class="katex-error" title="ParseError" style="color:#cc0000">\\frac{a}{</span> Sau</p></div>`,
    );
    const m = normalizeContainer(container);
    expect(m.flat).toBe('Trước ￼ Sau');
    expect(m.flat).not.toContain('\\frac');
    expect(m.segs.filter((s) => s.atomic)).toHaveLength(1);
  });
});

describe('M-g — NormMap/NormSeg readonly (review §4)', () => {
  it('kiểu từ chối mọi phép sửa map sau khi chuẩn hoá', () => {
    const m = normalizeContainer(el(BRIEF_FIX));
    // Khối dưới đây KHÔNG BAO GIỜ chạy. Nó tồn tại để `tsc` từ chối biên
    // dịch nếu ai đó gỡ `readonly` khỏi NormMap/NormSeg: một
    // `@ts-expect-error` không còn lỗi để nuốt thì tự nó thành lỗi.
    // `segIndexFor` (normalize.ts) lập chỉ mục `map.segs` đúng MỘT lần cho
    // mỗi NormMap, nên một task sau push thêm seg vào đó sẽ làm cache lỗi
    // thời trong im lặng — không có gì đỏ, chỉ có offset sai.
    const wouldNotCompile = () => {
      // @ts-expect-error `segs` là mảng readonly
      m.segs.push(m.segs[0]);
      // @ts-expect-error `flat` là readonly
      m.flat = '';
      // @ts-expect-error `NormSeg.start` là readonly
      m.segs[0].start = 1;
      // @ts-expect-error `root` là readonly
      m.root = document.createElement('div');
    };
    expect(wouldNotCompile).toBeTypeOf('function');
  });
});

// ===========================================================================
// C1 (review Task 2) — `NormMap` là một ẢNH CHỤP của DOM, không phải một
// khung nhìn sống. Task 3 sẽ bọc `<mark>` quanh từng đoạn được tô, tức
// `splitText`: text node gốc ngắn lại trong khi `map.segs` vẫn ghi độ dài
// cũ, và `setBoundary` gọi `range.setStart(t, offsetInSeg)` với một offset
// đã vượt quá node. Trên p1-5 thật, tô đúng MỘT ghi chú rồi giải 40 ghi chú
// còn lại trên cùng map: 2 lần `IndexSizeError: Offset out of bound`.
// ===========================================================================

describe('C1 — map cũ sau khi DOM đổi (review Task 2)', () => {
  it('isMapStale: false trên map vừa dựng, true sau khi một text node bị cắt ngắn', () => {
    const container = el('<div><p>Alpha beta gamma delta</p></div>');
    const m = normalizeContainer(container);
    expect(isMapStale(m)).toBe(false);

    const t = container.querySelector('p')!.firstChild as Text;
    t.splitText(5); // đúng thứ mà bọc <mark> làm với text node
    expect(isMapStale(m)).toBe(true);
  });

  it('text node DÀI RA cũng là map cũ — gỡ <mark> rồi normalize() gộp node lại là đường đó', () => {
    const container = el('<div><p>Alpha beta</p></div>');
    const m = normalizeContainer(container);
    const t = container.querySelector('p')!.firstChild as Text;
    t.appendData(' gamma');
    expect(isMapStale(m)).toBe(true);
  });

  it('rangeToFlat ném StaleNormMapError thay vì trả offset của một DOM không còn tồn tại', () => {
    const container = el('<div><p>Alpha beta gamma delta</p></div>');
    const m = normalizeContainer(container);
    const t = container.querySelector('p')!.firstChild as Text;

    const range = document.createRange();
    range.setStart(t, 0);
    range.setEnd(t, 5);
    expect(rangeToFlat(m, range)).toEqual({ from: 0, to: 5 });

    t.splitText(11);
    expect(() => rangeToFlat(m, range)).toThrow(StaleNormMapError);
    // Lỗi phải TỰ GIẢI THÍCH: cả tên lớp lẫn cách sửa.
    expect(() => rangeToFlat(m, range)).toThrow(/normalizeContainer/);
    try {
      rangeToFlat(m, range);
    } catch (e) {
      expect((e as Error).name).toBe('StaleNormMapError');
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('đổi CHA của một text node mà không cắt nó KHÔNG phải map cũ', () => {
    // Painter tô trọn một text node chỉ chuyển node đó vào trong <mark>.
    // Độ dài không đổi ⇒ mọi offset vẫn đúng ⇒ map vẫn dùng được, và phải
    // được coi là dùng được, nếu không Task 4 phải dựng lại map sau MỌI nét tô.
    const container = el('<div><p>Alpha beta</p><p>gamma delta</p></div>');
    const m = normalizeContainer(container);
    const t = container.querySelector('p')!.firstChild as Text;
    const mark = document.createElement('mark');
    t.parentNode!.insertBefore(mark, t);
    mark.appendChild(t);

    expect(isMapStale(m)).toBe(false);
    const range = document.createRange();
    range.setStart(t, 0);
    range.setEnd(t, 5);
    expect(rangeToFlat(m, range)).toEqual({ from: 0, to: 5 });
  });
});

// ===========================================================================
// Mục 7 của review Task 2 — BẪY CHO PAINTER (Task 3), ghim bằng test vì một
// báo cáo bị gitignore thì biến mất.
// ===========================================================================

describe('mép CUỐI của Range: hợp lệ về offset, gây hiểu nhầm về cấu trúc', () => {
  it('range dừng đúng cuối một thẻ <p> lại kết thúc ở offset 0 của text node NGOÀI thẻ đó', () => {
    const m = normalizeContainer(el('<div><p>Alpha beta</p>\n<p>Gamma delta</p></div>'));
    expect(m.flat).toBe('Alpha beta\nGamma delta');

    const r = flatToDom(m, 0, 10)!;
    expect(r).not.toBeNull();

    // Chữ thì ĐÚNG, offset đọc ngược lại cũng ĐÚNG...
    expect(r.toString()).toBe('Alpha beta');
    expect(rangeToFlat(m, r)).toEqual({ from: 0, to: 10 });

    // ...nhưng mép cuối nằm ở một node khác hẳn: text node "\n" giữa hai thẻ
    // <p>, tại offset 0. `locate(10)` chọn seg ĐẦU TIÊN có `end > 10`, và seg
    // "Alpha beta" kết thúc đúng ở 10.
    expect(r.endContainer.nodeType).toBe(Node.TEXT_NODE);
    expect(r.endContainer).not.toBe(r.startContainer);
    expect(r.endOffset).toBe(0);
    expect((r.endContainer as Text).data.trim()).toBe('');

    // Hệ quả cho painter: range đã RA NGOÀI thẻ <p>. Một painter bọc "mọi
    // text node giao với range" sẽ sinh một <mark> rỗng ở cấp <div>; một
    // painter suy luận theo `endContainer.parentElement` sẽ tưởng highlight
    // kết thúc ở đoạn văn KẾ TIẾP. Cách đúng là `getClientRects()` /
    // `cloneContents()`, không phải đọc `endContainer`.
    expect((r.commonAncestorContainer as Element).tagName).toBe('DIV');
    expect(r.commonAncestorContainer).not.toBe(r.startContainer.parentElement);
    expect(r.cloneContents().childNodes).toHaveLength(2);
    expect(r.cloneContents().textContent).toBe('Alpha beta');
  });
});
