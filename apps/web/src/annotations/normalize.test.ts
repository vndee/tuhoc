import { describe, expect, it } from 'vitest';
import { domToFlat, flatToDom, normalizeContainer } from './normalize';

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
    const parts: string[] = [];
    for (let i = 0; i < 400; i++) {
      parts.push(`<p>Đoạn ${i} có công thức ${katexSpan(`x_{${i}}`, `x${i}`)} ở giữa câu.</p>`);
    }
    const container = el(`<div>${parts.join('')}</div>`);
    const start = performance.now();
    const m = normalizeContainer(container);
    const elapsed = performance.now() - start;
    expect(m.segs.filter((s) => s.atomic)).toHaveLength(400);
    // Generous ceiling — this is a sanity net against an accidentally
    // quadratic walk (e.g. re-scanning from root per formula), not a tight
    // perf budget: a linear walk over ~400 formulas finishes in low
    // single-digit milliseconds even under test-runner overhead.
    expect(elapsed).toBeLessThan(500);
  });
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
