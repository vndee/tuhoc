import { t, type Lang } from '@tuhoc/i18n';
import { domToFlat, normalizeContainer, rangeToFlat } from '../annotations/normalize';
import type { NormMap } from '../annotations/normalize';

/**
 * DỰNG LỜI NHẮC TỪ CHƯƠNG ĐANG ĐỌC — và điều quan trọng nhất trong tệp này là
 * **nó không đọc DOM theo cách ngây thơ**.
 *
 * Sau `CourseKit.renderKatex`, một công thức không còn là chữ: nó là một cây
 * `<span class="katex">` chứa cùng một phép toán **ba lần** (MathML ẩn, nguồn
 * TeX trong `<annotation>`, cây glyph nhìn thấy được). Ba cách đọc quen thuộc
 * đều sai, mỗi cách một kiểu:
 *
 * | cách đọc | công thức thành |
 * |---|---|
 * | `textContent` của cây chương | ba bản chồng lên nhau, vô nghĩa |
 * | `innerText` | một bản, nhưng bị áp cả `text-transform` (P2 đã đo) |
 * | `NormMap.flat` của P2 | **đúng một ký tự `'￼'`** |
 *
 * Cách thứ ba là cái bẫy nguy hiểm nhất vì nó **trông** đúng: nó là phép chiếu
 * chính thức của P2, nó bỏ đúng những cây con do runtime sinh ra, và nó không
 * ném. Nhưng một lời nhắc chứa `'￼'` thay cho công thức là **rác gửi cho
 * mô hình**, và người học nhận về một câu trả lời tự tin về một công thức mà mô
 * hình chưa từng nhìn thấy.
 *
 * Đường đúng — và là đường tệp này đi — dùng lại **phép PHÂN ĐOẠN** của P2
 * (`NormMap.segs`: cái gì là chữ, cái gì là công thức, cái gì phải bỏ) rồi
 * **hoàn nguyên** mỗi đoạn nguyên tử về nguồn LaTeX nằm trong `<annotation
 * encoding="application/x-tex">` của chính nó. Một định nghĩa "cái gì đáng
 * đọc", hai người đọc.
 *
 * Tệp này KHÔNG chạm tới bí mật nào, và không được phép chạm. Nó dựng CHỮ,
 * hết.
 *
 * Câu ấy từng có một vế thứ hai: *"kho khoá ở origin khác là bên duy nhất cầm
 * bí mật"* — đúng ở Pha 1, sai từ Task 16. Không còn kho khoá, và bí mật duy
 * nhất còn liên quan tới AI là key CỦA NỀN TẢNG, sống trong biến môi trường
 * của máy chủ (`config.Config.DeepSeekAPIKey`) — trình duyệt chưa từng và sẽ
 * không bao giờ thấy nó. Ràng buộc ở đây vì thế MẠNH HƠN chứ không yếu đi: ở
 * Pha 1 nó là "đừng cầm bí mật, đã có bên khác cầm"; nay nó là "không có bí
 * mật nào ở phía này để cầm". Chuỗi duy nhất tệp này dựng ra rồi gửi đi là
 * lời nhắc, và nó đi kèm cookie phiên như mọi lời gọi khác của
 * `api/client.ts`.
 */

/**
 * Trần ký tự cho **cả lời nhắc hệ thống** (khung + dàn ý + phần trích), không
 * chỉ cho phần trích.
 *
 * NGƯỠNG ĐẾN TỪ PHÉP ĐO, không phải một con số nghĩ ra. Gói mẫu thật ở
 * `fixtures/courses/`, đo 2026-08-22 bằng parse5 (bỏ script/style, gộp khoảng
 * trắng):
 *
 * - chương dài nhất (`so-dau-phay-dong/chapters/p1-3.html`) = **19.312** ký tự;
 * - mục `h2` lớn nhất trên cả 69 mục của hai gói mẫu = **6.079** ký tự.
 *
 * Quy tắc chọn: **cửa sổ phải chứa TRỌN mục lớn nhất kèm 25% chỗ trống cho văn
 * cảnh hai bên** — 6.079 × 1,25 ≈ 7.599 — làm tròn lên 8.000. Người học hỏi về
 * chỗ họ đang đọc, và mục họ đang đọc phải lọt trọn vẹn vào lời nhắc; nếu không
 * thì mô hình trả lời về nửa mục mà không ai biết là nửa.
 *
 * Đầu kia cũng là một ràng buộc, và nó quan trọng ngang: 8.000 **nhỏ hơn**
 * 19.312, nên nhánh cắt **thật sự chạy trên gói mẫu thật**. Một ngưỡng lớn hơn
 * chương dài nhất là một nhánh không bao giờ chạy — đúng hình dạng "cổng rỗng
 * luôn xanh" đã ghi bốn lần trong `docs/carried-forward.md`.
 *
 * `prompts.test.ts` neo hằng số này vào **cả hai** con số đo được, nên nó không
 * trôi trong im lặng theo bất kỳ chiều nào.
 */
export const CHAPTER_CONTEXT_LIMIT = 8_000;

/**
 * Văn cảnh hai bên đoạn bôi đen, tính bằng ký tự của phép chiếu THÔ (trước khi
 * công thức nở ra). Đủ cho một đoạn văn mỗi bên trong gói mẫu (đoạn `<p>` dài
 * nhất đo được ~700 ký tự), và bị kẹp lại lần nữa sau khi hoàn nguyên.
 */
export const SELECTION_CONTEXT_CHARS = 600;

/** Dấu cho biết chỗ này đã bị cắt. Mô hình cần thấy được rằng nó **không**
 *  đang đọc cả chương — nếu không nó sẽ khẳng định "chương này không nói về X"
 *  trong khi chương có nói, chỉ là ở phần bị cắt. */
export const CUT_MARK = '[…]';

/** Nguồn TeX mà KaTeX luôn kèm theo mỗi công thức nó dựng. */
const TEX_ANNOTATION = 'annotation[encoding="application/x-tex"]';

/**
 * Hoàn nguyên MỘT đoạn nguyên tử về nguồn của nó, theo ba nấc, từ trung thực
 * nhất tới kém nhất:
 *
 * 1. `<annotation encoding="application/x-tex">` — nguồn TeX **người viết
 *    chương đã gõ**. Đây là nấc duy nhất trả về đúng thứ nó hứa.
 * 2. `.katex-error` — KaTeX từ chối dựng và giữ nguyên chuỗi gốc làm nội dung;
 *    lấy chính chuỗi đó.
 * 3. `.katex-html` — cây glyph nhìn thấy được, **một bản**. Không phải nguồn,
 *    nhưng là thứ người học đang nhìn, nên nó vẫn tốt hơn một khoảng trống.
 *
 * Trả về chuỗi rỗng nếu cả ba nấc đều không có gì. **Không bao giờ** trả về
 * `textContent` của cả cây con: đó là ba bản chồng lên nhau.
 */
function mathSource(el: Element): string {
  const tex = el.querySelector(TEX_ANNOTATION)?.textContent?.trim();
  if (tex) return el.classList.contains('katex-display') ? `$$${tex}$$` : `$${tex}$`;
  if (el.classList.contains('katex-error')) return (el.textContent ?? '').trim();
  const glyphs = el.querySelector('.katex-html')?.textContent?.trim();
  return glyphs ?? '';
}

/**
 * Chữ của chương trong khoảng `[from, to)` của phép chiếu P2, với mọi công
 * thức đã hoàn nguyên về LaTeX.
 *
 * Một đoạn nguyên tử luôn dài đúng một ký tự trong phép chiếu thô, nên **chạm
 * vào nó là lấy cả nó** — đúng bất biến "công thức không bao giờ chọn được một
 * nửa" mà `normalize.ts` dựng lên.
 */
export function readableText(map: NormMap, from: number, to: number): string {
  if (to <= from) return '';
  const parts: string[] = [];
  for (const seg of map.segs) {
    if (seg.end <= from) continue;
    if (seg.start >= to) break;
    if (seg.atomic) {
      parts.push(mathSource(seg.node as Element));
      continue;
    }
    parts.push(map.flat.slice(Math.max(seg.start, from), Math.min(seg.end, to)));
  }
  return parts.join('');
}

/**
 * Gộp khoảng trắng thừa nhưng GIỮ ranh giới đoạn.
 *
 * HTML nguồn của chương xuống dòng và thụt lề giữa các thẻ; những khoảng trắng
 * ấy chiếm chỗ trong ngân sách ký tự mà người đọc không bao giờ nhìn thấy. Gộp
 * hết thành một dòng thì rẻ hơn nữa, nhưng nó **xoá ranh giới đoạn văn** — và
 * một chương mất hết ranh giới đoạn là một khối chữ mà mô hình phải tự đoán
 * chỗ ngắt ý.
 *
 * Đo trên gói mẫu: phép gộp này tiết kiệm ~0,4% (118.515 → 117.670 ký tự). Nó
 * KHÔNG phải cần cẩu — cần cẩu là cửa sổ cắt bên dưới. Ghi con số ra đây để
 * không ai sau này tưởng nó là.
 */
function tidy(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Giữ phần ĐẦU, cắt phần đuôi. */
function clampHead(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

/** Giữ phần ĐUÔI, cắt phần đầu — đúng thứ cần cho "văn cảnh ngay trước". */
function clampTail(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  const space = cut.indexOf(' ');
  return (space >= 0 && space < max * 0.4 ? cut.slice(space + 1) : cut).trimStart();
}

/** Dàn ý các mục `h2` của chương, theo thứ tự tài liệu. */
export function chapterOutline(root: Element): string[] {
  return Array.from(root.querySelectorAll('h2'))
    .map((h) => (h.textContent ?? '').trim())
    .filter((t) => t.length > 0);
}

interface Span {
  from: number;
  to: number;
}

/**
 * Cửa sổ rộng `width` quanh `focusAt`, **lệch về phía trước**: 25% phía sau,
 * 75% phía trước. Người học đọc xuôi, nên phần chưa đọc đáng giá hơn phần vừa
 * đọc; một cửa sổ đối xứng tiêu nửa ngân sách vào chỗ họ vừa đi qua.
 */
function spanFor(focusAt: number, width: number, total: number): Span {
  let from = focusAt - Math.floor(width * 0.25);
  let to = from + width;
  if (from < 0) {
    to -= from;
    from = 0;
  }
  if (to > total) {
    from = Math.max(0, from - (to - total));
    to = total;
  }
  return { from, to: Math.min(to, total) };
}

/**
 * Xa nhất mà một mép được phép dịch để tránh cắt giữa từ.
 *
 * Cần một trần vì phép dịch này có một ca hỏng đã đo được: một chương dày đặc
 * công thức có **hàng trăm ký tự liền nhau không một khoảng trắng** (mỗi công
 * thức là đúng một ký tự trong phép chiếu thô của P2). Không có trần, mép cuối
 * lùi về khoảng trắng gần nhất — nằm tận trong tiêu đề mục — và cửa sổ 200 ký
 * tự co lại còn ba chữ, trong im lặng. Không có khoảng trắng nào trong 80 ký
 * tự thì đoạn ấy không phải văn xuôi, và cắt "giữa từ" là cái giá nhỏ hơn.
 */
const SNAP_MAX = 80;

/** Đẩy hai mép ra khỏi giữa một từ. Chỉ THU HẸP, không bao giờ nới. */
function snap(map: NormMap, span: Span): Span {
  let { from, to } = span;
  if (from > 0) {
    const next = map.flat.indexOf(' ', from);
    if (next >= 0 && next < to && next - from <= SNAP_MAX) from = next + 1;
  }
  if (to < map.flat.length) {
    const prev = map.flat.lastIndexOf(' ', to);
    if (prev > from && to - prev <= SNAP_MAX) to = prev;
  }
  return { from, to };
}

/**
 * Cửa sổ RỘNG NHẤT quanh `focusAt` mà chữ **đã hoàn nguyên** của nó vẫn nằm
 * trong `budget`.
 *
 * Tìm bằng chia đôi trên bề rộng, và bề rộng đo bằng **offset thô** trong khi
 * ràng buộc đo bằng **ký tự đã hoàn nguyên**. Hai thước khác nhau là cố ý, và
 * là lý do hàm này không phải một phép `slice`: một công thức chiếm 1 ký tự thô
 * nhưng có thể nở ra 40 ký tự LaTeX. Cắt theo thước thô rồi mới hoàn nguyên sẽ
 * vượt trần tới 40 lần trong một chương dày công thức — và không phép kiểm nào
 * ở tầng trên nhìn thấy, vì phần trích *trông* vẫn đúng.
 *
 * `projected` đơn điệu không giảm theo bề rộng, nên phép chia đôi hợp lệ.
 */
function widestWindow(map: NormMap, focusAt: number, budget: number): Span {
  const total = map.flat.length;
  const measure = (w: number): number => {
    const s = spanFor(focusAt, w, total);
    return tidy(readableText(map, s.from, s.to)).length;
  };
  if (measure(total) <= budget) return { from: 0, to: total };

  let lo = 0;
  let hi = total;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(mid) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return snap(map, spanFor(focusAt, lo, total));
}

export interface BuiltPrompt {
  /** Lời nhắc đặt vào vai `system`. */
  readonly system: string;
  /** Phần THÂN đã cắt — tách ra để bài kiểm hỏi được về nó mà không bị dàn ý
   *  (vốn liệt kê mọi tiêu đề mục) trả lời hộ. */
  readonly excerpt: string;
  readonly truncated: boolean;
  /**
   * Số ký tự THẬT sẽ rời khỏi máy cho phần ngữ cảnh này. Bằng đúng
   * `system.length`, không phải một ước lượng — và `prompts.test.ts` cưỡng
   * chế đẳng thức ấy.
   *
   * LÝ DO GỐC ĐÃ CHẾT, LÝ DO MỚI THÌ KHÔNG. Bản Pha 1 viết: *"người gác của
   * kho khoá trừ ngân sách bằng số ký tự thật, nên mọi con số ở đây phải là
   * cùng một số"* — tức có một BÊN THỨ HAI đếm cùng đại lượng, và lệch một ký
   * tự là hai bên bất đồng. Task 16 gỡ người gác ấy cùng kho khoá, và Pha 2
   * không dựng lại nó: máy chủ trừ credit theo TOKEN thật do nhà cung cấp báo
   * về, không theo ký tự.
   *
   * Trường này ở lại vì nó nay phục vụ NGƯỜI ĐỌC, không phải một bộ đếm:
   * `AskPanel`/`DeepDive` nói cho người học biết bao nhiêu chữ của chương sắp
   * rời khỏi máy, và `CHAPTER_CONTEXT_LIMIT` cắt theo đúng con số ấy. Một ước
   * lượng ở đây là nói dối về một điều riêng tư — nên đẳng thức
   * `contextChars === system.length` vẫn là bất biến, chỉ đổi người thụ hưởng.
   */
  readonly contextChars: number;
}

export interface ChapterPromptOptions {
  /**
   * Ngôn ngữ của CÂU TRẢ LỜI, không chỉ của giao diện — câu vai bảo mô hình
   * trả lời bằng tiếng nào. BẮT BUỘC, không mặc định: một mặc định lặng lẽ ở
   * đây cho ra một người đọc tiếng Anh nhận câu trả lời tiếng Việt, và không
   * cổng nào hỏi được điều đó. Bắt buộc thì `tsc` bắt mọi chỗ gọi tự nói ra.
   */
  readonly lang: Lang;
  readonly courseTitle: string;
  readonly chapterTitle: string;
  /** Tiêu đề mục người học đang đọc (rail TOC đã biết nó). `null`/vắng ⇒ cắt
   *  từ đầu chương. */
  readonly focusEl?: Element | null;
  readonly limit?: number;
}

const chapterRole = (lang: Lang): string => t(lang, 'ai.prompt.chapterRole', CUT_MARK);

function assemble(
  role: string,
  fields: readonly (readonly [string, string])[],
): string {
  return [role, ...fields.map(([k, v]) => `${k}:\n${v}`)].join('\n\n');
}

/**
 * Lời nhắc hỏi–đáp cho chương đang đọc.
 *
 * `root` là **cây chương đã dựng xong** — sau KaTeX, sau `initViz`, sau khi
 * chèn ô đánh dấu bài tập — tức đúng cây mà P2 neo chú thích vào. Không dùng
 * HTML nguồn: nó không biết người học đang đọc tới đâu, và nó vẫn còn nguyên
 * những cây con mà `initViz` sẽ thay thế.
 */
export function chapterSystemPrompt(root: Element, opts: ChapterPromptOptions): BuiltPrompt {
  const limit = opts.limit ?? CHAPTER_CONTEXT_LIMIT;
  const map = normalizeContainer(root);

  const outlineAll = chapterOutline(root).join(' · ');
  const outline = clampHead(outlineAll, Math.floor(limit * 0.25));

  const head = (excerpt: string): string =>
    assemble(chapterRole(opts.lang), [
      [t(opts.lang, 'ai.prompt.field.course'), opts.courseTitle],
      [t(opts.lang, 'ai.prompt.field.chapter'), opts.chapterTitle],
      [t(opts.lang, 'ai.prompt.field.outline'), outline],
      [t(opts.lang, 'ai.prompt.field.excerpt'), excerpt],
    ]);

  // Chi phí cố định đo bằng cách dựng thật với phần thân rỗng, không bằng một
  // hằng số ước lượng: mỗi lần ai đó sửa một chữ trong khung, ước lượng ấy sai
  // đi mà không có gì báo.
  const overhead = head('').length + CUT_MARK.length * 2 + 2;
  const span = widestWindow(map, focusOffset(map, opts.focusEl), Math.max(0, limit - overhead));
  const truncated = span.from > 0 || span.to < map.flat.length;

  const body = tidy(readableText(map, span.from, span.to));
  const excerpt =
    (span.from > 0 ? `${CUT_MARK} ` : '') + body + (span.to < map.flat.length ? ` ${CUT_MARK}` : '');

  const system = head(excerpt);
  return { system, excerpt, truncated, contextChars: system.length };
}

function focusOffset(map: NormMap, focusEl: Element | null | undefined): number {
  if (!focusEl) return 0;
  return domToFlat(map, focusEl, 0) ?? 0;
}

export interface SelectionExcerpt {
  /** Đoạn người học bôi đen, công thức đã hoàn nguyên. */
  readonly quote: string;
  /** Chữ ngay trước và ngay sau đoạn ấy, cùng phép chiếu. */
  readonly before: string;
  readonly after: string;
}

/**
 * Đoạn bôi đen, chiếu qua đúng phép phân đoạn của P2.
 *
 * `null` khi không có gì đáng hỏi: `rangeToFlat` đã trả lời câu "vùng chọn này
 * có nằm trong chương và có chữ nào không" cho cả P2 lẫn chỗ này, và một bản
 * sao thứ hai của câu trả lời ấy là đúng thứ trôi dạt mà `normalize.ts` đã trả
 * giá để tránh.
 *
 * NÉM `StaleNormMapError` khi `map` mô tả một cây DOM đã đổi — cùng hợp đồng
 * `rangeToFlat` công bố, và cố ý không nuốt: một bản đồ cũ là lỗi của bên gọi,
 * không phải một vùng chọn không hợp lệ.
 */
export function selectionExcerpt(
  map: NormMap,
  range: Range,
  contextChars: number = SELECTION_CONTEXT_CHARS,
): SelectionExcerpt | null {
  const span = rangeToFlat(map, range);
  if (!span) return null;

  const quote = tidy(readableText(map, span.from, span.to));
  if (!quote) return null;

  return {
    quote,
    before: tidy(readableText(map, Math.max(0, span.from - contextChars), span.from)),
    after: tidy(
      readableText(map, span.to, Math.min(map.flat.length, span.to + contextChars)),
    ),
  };
}

/** Câu hỏi mặc định của "Đào sâu" — người học không phải gõ gì để bắt đầu. */
export const deepDiveQuestion = (lang: Lang): string => t(lang, 'ai.prompt.deepDiveQuestion');

export interface DeepDiveOptions {
  /** Xem `ChapterPromptOptions.lang` — cùng lý do, cùng mức bắt buộc. */
  readonly lang: Lang;
  readonly courseTitle: string;
  readonly chapterTitle: string;
  readonly limit?: number;
}

/**
 * Lời nhắc "Đào sâu".
 *
 * Ngân sách được chia theo thứ tự ưu tiên rõ ràng: văn cảnh hai bên bị kẹp
 * TRƯỚC, rồi mới tới đoạn được chọn. Một người học bôi đen cả chương vẫn phải
 * ra một lời nhắc nằm trong trần — và thứ đáng giữ khi phải cắt là **đoạn họ
 * chọn**, không phải văn cảnh quanh nó.
 */
export function deepDiveSystemPrompt(
  excerpt: SelectionExcerpt,
  opts: DeepDiveOptions,
): BuiltPrompt {
  const limit = opts.limit ?? CHAPTER_CONTEXT_LIMIT;

  const head = (before: string, quote: string, after: string): string =>
    assemble(t(opts.lang, 'ai.prompt.deepDiveRole'), [
      [t(opts.lang, 'ai.prompt.field.course'), opts.courseTitle],
      [t(opts.lang, 'ai.prompt.field.chapter'), opts.chapterTitle],
      [t(opts.lang, 'ai.prompt.field.before'), before],
      [t(opts.lang, 'ai.prompt.field.selection'), quote],
      [t(opts.lang, 'ai.prompt.field.after'), after],
    ]);

  const before = clampTail(excerpt.before, SELECTION_CONTEXT_CHARS);
  const after = clampHead(excerpt.after, SELECTION_CONTEXT_CHARS);
  const overhead = head(before, '', after).length;
  const quote = clampHead(excerpt.quote, Math.max(0, limit - overhead));

  const system = head(before, quote, after);
  return { system, excerpt: quote, truncated: quote.length < excerpt.quote.length, contextChars: system.length };
}
