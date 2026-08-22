/**
 * The stable interface a later phase's AI tutor consumes (spec §6 —
 * "ổ cắm thiết kế từ P1"). Deliberately framework-agnostic (no React
 * import): whatever calls `getContext()` later (a rail button, a keyboard
 * shortcut) only needs a plain function, not a hook or a component prop.
 *
 * `ChapterView` is the sole writer of the module-level registration below —
 * it calls `setChapterContextSource` once its fragment is committed to the
 * DOM, and clears it (`null`) on cleanup/chapter change. `getContext()`
 * throws when nothing is registered, since it is only ever meant to be
 * called from reader UI that exists *because* a chapter is on screen.
 */

export interface ReaderContext {
  courseId: string;
  chapterId: string;
  /** Chapter title, plus the nearest `h2` above the current scroll position (if any have been scrolled past). */
  headingTrail: string[];
  /** The user's current text selection, if any, and if it falls inside the chapter content. */
  selection?: string;
  /** HTML from the current `h2` (see `headingTrail`) up to the next one — or the lede before the first `h2` if none has been scrolled past yet. */
  sectionHTML: string;
}

export interface ChapterContextSource {
  courseId: string;
  chapterId: string;
  chapterTitle: string;
  /** The root element the chapter fragment's HTML was set into — NOT `#content` itself, which also holds the pager. */
  contentEl: HTMLElement;
}

let source: ChapterContextSource | null = null;

import { normalizeContainer } from '../annotations/normalize';
import { selectionExcerpt } from '../ai/prompts';

/** Written by `ChapterView` only. Not part of the public reader contract — `getContext()` is. */
export function setChapterContextSource(next: ChapterContextSource | null): void {
  source = next;
}

// Matches reader.css's `h2,h3{scroll-margin-top:70px}` and v1's own rail
// IntersectionObserver (`rootMargin:'-70px 0px -75% 0px'`) — the viewport
// y-coordinate a heading counts as "scrolled to" at.
const SCROLL_ANCHOR_OFFSET = 70;

/** The last `h2` (in document order) whose top has scrolled to/above the anchor line — or null if the reader hasn't scrolled past the first one yet. */
function nearestH2Above(h2s: HTMLElement[]): HTMLElement | null {
  let match: HTMLElement | null = null;
  for (const h of h2s) {
    if (h.getBoundingClientRect().top <= SCROLL_ANCHOR_OFFSET) {
      match = h;
    }
  }
  return match;
}

/** Concatenated `outerHTML` of `contentEl`'s direct children from `start` (inclusive) up to `end` (exclusive). `start:null` collects from the top of `contentEl`. */
function outerHTMLOfRange(contentEl: HTMLElement, start: Element | null, end: Element | null): string {
  let html = '';
  let collecting = start === null;
  for (const node of Array.from(contentEl.children)) {
    if (node === start) collecting = true;
    if (node === end) break;
    if (collecting) html += node.outerHTML;
  }
  return html;
}

export function getContext(): ReaderContext {
  if (!source) {
    throw new Error('getContext(): no chapter is currently mounted');
  }
  const { courseId, chapterId, chapterTitle, contentEl } = source;

  const h2s = Array.from(contentEl.querySelectorAll<HTMLElement>('h2'));
  const currentH2 = nearestH2Above(h2s);
  const headingTrail = currentH2 ? [chapterTitle, (currentH2.textContent ?? '').trim()] : [chapterTitle];
  const nextH2 = currentH2 ? (h2s[h2s.indexOf(currentH2) + 1] ?? null) : (h2s[0] ?? null);
  const sectionHTML = outerHTMLOfRange(contentEl, currentH2, nextH2);

  const context: ReaderContext = { courseId, chapterId, headingTrail, sectionHTML };

  // KHÔNG dùng `sel.toString()`. Sau khi KaTeX render, `toString()` trên một
  // đoạn có công thức trả về chuỗi MathML + nguồn TeX + glyph dán liền nhau —
  // đo được trên chương thật: `"Chặn trên là 12ε2\tfrac{1}{2}\varepsilon^221​ε2
  // cho mỗi phép cộng."`, tức công thức xuất hiện BA lần dưới ba dạng. Một mô
  // hình nhận chuỗi ấy nhận rác.
  //
  // `selectionExcerpt` chiếu qua đúng phép phân đoạn của P2 rồi hoàn nguyên
  // LaTeX từ `<annotation encoding="application/x-tex">`. Ổ cắm này chưa có
  // consumer nào; nối nó vào phép chiếu đúng NGAY BÂY GIỜ là để người đầu tiên
  // dùng nó không phải tự dựng lại `sel.toString()` một lần nữa.
  const sel = window.getSelection?.();
  if (sel && sel.rangeCount > 0 && sel.anchorNode && contentEl.contains(sel.anchorNode)) {
    const excerpt = selectionExcerpt(normalizeContainer(contentEl), sel.getRangeAt(0));
    if (excerpt) context.selection = excerpt.quote;
  }

  return context;
}
