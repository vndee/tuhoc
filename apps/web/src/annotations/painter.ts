/**
 * Highlight painter (P2 Task 3) — the part of the annotation engine a reader
 * can actually see.
 *
 * It takes DOM `Range`s (produced by `./anchor`'s `anchorToRange`, or by a
 * live selection) and colours them in: every stretch of text the range covers
 * is wrapped in `<mark class="ann ann-<color>" data-ann-id="…">`, and every
 * KaTeX formula the range covers WHOLE is tinted by adding a class to the
 * formula element itself. `unpaint` reverses both, exactly, back to the DOM
 * the chapter was rendered with.
 *
 * It knows nothing about `NormMap`, anchors, storage or React. What it does
 * know — and what the rest of this comment is about — is that it is the first
 * thing in P2 that CHANGES the DOM, and that several things downstream were
 * built on the assumption that nothing does.
 *
 * ---------------------------------------------------------------------
 * 1. Painting invalidates every `NormMap` — and every `Range` you are holding
 * ---------------------------------------------------------------------
 * `NormMap` is a snapshot (`./normalize`'s own doc, ruling P2-F8): its
 * segments hold direct references to Text nodes plus the flat offsets those
 * nodes occupied at `normalizeContainer` time. Wrapping a highlight calls
 * `Text.splitText`, which shortens a tracked node, so after ANY successful
 * paint the map describes a tree that no longer exists. `anchorToRange` will
 * then throw `StaleNormMapError` rather than answer wrongly. Do not work
 * around it: call `normalizeContainer(root)` again. The good news, measured
 * across all 44 chapters, is that `map.flat` is byte-for-byte identical after
 * painting — `<mark>` adds no text and is not a block boundary — so every
 * stored anchor still resolves to the same characters against the new map.
 *
 * The `paint*` functions return the number of elements they created for
 * exactly this: `0` means the DOM was not touched and your map is still good.
 *
 * Less obvious, and the reason `paintAll` exists at all: **a live `Range`
 * does not survive having its own text wrapped.** Wrapping requires moving a
 * Text node into the new `<mark>`, and the DOM standard's "remove" steps say
 * that every live range whose boundary is inside a removed node is reset to
 * that node's former position in its parent. Measured in jsdom, and mandated
 * by the spec, so true in every browser. Concretely: resolve two overlapping
 * anchors against one map, paint the first, and the second `Range` now points
 * at different words — silently, with no exception anywhere.
 *
 * So the supported way to paint a chapter's annotations is ONE `paintAll`
 * call with all of them. `paintAll` reads every range into a list of text
 * pieces BEFORE it mutates anything, so no range has to survive another
 * range's paint. `paint()` is the single-annotation form (creating a note
 * from a fresh selection); it is `paintAll` with one item.
 *
 *     const map = normalizeContainer(root);
 *     const items = notes.map(n => ({ range: anchorToRange(map, n.anchor)?.range, … }));
 *     paintAll(items.filter(hasRange));   // map is stale from here on
 *
 * ---------------------------------------------------------------------
 * 2. Formulas are tinted, never wrapped
 * ---------------------------------------------------------------------
 * A `<mark>` opened inside a `.katex` subtree would cut through markup KaTeX
 * generated and styles with 227 CSS rules, every one of them written as
 * `.katex …`, so the subtree's shape is load-bearing. The painter therefore
 * never descends into an atomic element (`ATOMIC_SELECTOR`, shared with
 * `./normalize` so the two can never disagree about what a formula is).
 *
 * But stopping on both sides of a formula is not acceptable either: in a
 * mathematics textbook formulas sit INSIDE sentences, so a highlight that
 * skipped them would show a white gap mid-sentence and read as a rendering
 * bug. A formula that lies WHOLLY inside the range instead gets
 * `class="ann-hl ann-hl-<color>"` added to the formula element itself. That is
 * safe by construction — the element keeps its `.katex` class, so every KaTeX
 * rule still matches, and the string "background" does not occur once in
 * `vendor/katex.css`'s 366.680 characters, so nothing inside paints over the
 * tint. A formula the range only PARTLY
 * covers is left alone; ranges from `anchorToRange` never do that (boundaries
 * snap outside atomic tokens), but a raw selection can.
 *
 * ---------------------------------------------------------------------
 * 3. Overlapping notes nest
 * ---------------------------------------------------------------------
 * Readers highlight over their own highlights. Where two annotations overlap,
 * the shared text ends up inside two `<mark>`s, one within the other, each
 * with its own `data-ann-id`: the tints are semi-transparent, so the overlap
 * simply reads darker, and `unpaint(A)` unwraps only A's own elements and
 * leaves B's children in place. Order of removal does not matter. A formula
 * covered by several notes keeps the full id list in `data-ann-ids` and shows
 * the most recently painted colour; removing that note restores the previous
 * one rather than clearing the tint.
 *
 * ---------------------------------------------------------------------
 * 4. Which text nodes get wrapped
 * ---------------------------------------------------------------------
 * The pieces are derived from the text nodes the range actually covers, with
 * each node clipped to `[startOffset, endOffset)` where it is a boundary
 * container — never from `startContainer`/`endContainer` alone. That matters:
 * measured on a real chapter, 6,0% of resolved ranges end at offset 0 of the
 * NEXT text node (usually the newline between two `</p><p>`) and 1,25% end
 * inside a whitespace-only node. A painter that wrapped "every text node the
 * range intersects" would emit an empty `<mark>` outside the paragraph for
 * the first group; the clipping makes those pieces zero-length and they are
 * dropped. `anchor.test.ts` pins the property itself ("BẪY CHO TASK 3").
 *
 * Whitespace-only pieces are the second half of that trap. A run of
 * indentation between two block tags renders as nothing, so wrapping it gains
 * no colour — but it inserts a `<mark>` as a structural child, which changes
 * `.box > :last-child` and `table.tbl tr:last-child td` in `reader.css`, and
 * is invalid markup under `<ul>`/`<ol>`/`<table>`/`<tbody>`. A run of
 * whitespace BETWEEN TWO INLINE ELEMENTS, on the other hand, is a real
 * rendered space, and skipping it puts a one-space hole in the highlight.
 * `paintable` below tells the two apart by looking at the piece's immediate
 * siblings. Measured over the 44 chapters as rendered: 4.972 whitespace-only
 * nodes are skipped and 364 (inside `<p>`/`<li>`/`<td>`/inline-only `<div>`)
 * are painted.
 */

import type { AnchorColor } from './anchor';
import { ATOMIC_SELECTOR, EXCLUDED_SELECTOR } from './normalize';

/** Same four values as `Anchor.color` — aliased rather than re-declared so
 * the two can never drift apart. Type-only import: erased at build time, no
 * runtime dependency from the painter on the anchoring code. */
export type HighlightColor = AnchorColor;

const COLORS: readonly HighlightColor[] = ['y', 'g', 'b', 'p'];

/** One annotation to paint.
 *
 * `id` must not contain ASCII whitespace. Everything else — quotes,
 * backslashes, non-ASCII — is escaped for the CSS queries (`cssValue`), but a
 * space genuinely cannot be represented: a formula covered by several notes
 * stores their ids as ONE space-separated attribute, and a space inside an id
 * would be indistinguishable from the separator. `AnnotationRow.id` is a
 * `crypto.randomUUID()`, so this costs nothing in practice — it is stated
 * because "it silently highlights the wrong thing" is not an acceptable way to
 * find out. */
export interface PaintItem {
  readonly range: Range;
  readonly id: string;
  readonly color: HighlightColor;
}

/** Carried by every `<mark>`; exactly one id per element (overlaps nest). */
const MARK_ID = 'data-ann-id';
/** Carried by a tinted formula: a space-separated list, because a formula
 * cannot nest the way a `<mark>` can. Paired index-wise with `ATOMIC_COLORS`. */
const ATOMIC_IDS = 'data-ann-ids';
const ATOMIC_COLORS = 'data-ann-colors';
const HL = 'ann-hl';

/**
 * Elements that participate in an inline formatting context, i.e. next to
 * which a whitespace text node is a REAL rendered space rather than markup
 * indentation. Used only by `paintable`, so the cost of a wrong answer is one
 * space highlighted or not — never a broken offset or a misplaced element.
 *
 * An allowlist rather than a list of block tags, and that direction is the
 * point: an unknown tag is treated as non-inline, which means the whitespace
 * is skipped, which is the harmless failure. The opposite list would treat an
 * unknown block tag as inline and put a `<mark>` into block context, which is
 * the failure that breaks layout. `getComputedStyle` was the other candidate
 * and was rejected for a reason specific to this codebase: half the test
 * fixtures here (and `normalize.test.ts`'s, and `anchor.test.ts`'s) are
 * DETACHED `<div>`s, where jsdom has no box tree to answer from.
 */
const INLINE_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DEL', 'DFN', 'EM', 'I', 'IMG',
  'INS', 'KBD', 'LABEL', 'MARK', 'Q', 'RB', 'RP', 'RT', 'RUBY', 'S', 'SAMP', 'SMALL', 'SPAN',
  'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR',
]);

interface TextPiece {
  readonly kind: 'text';
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

interface AtomicPiece {
  readonly kind: 'atomic';
  readonly el: Element;
}

type Piece = TextPiece | AtomicPiece;

/** One run of characters of an original Text node after all of a batch's cuts
 * have been applied. `from`/`to` are offsets in the ORIGINAL node, which is
 * what lets a piece recorded before the cuts find its fragments after them. */
interface Fragment {
  readonly from: number;
  readonly to: number;
  readonly node: Text;
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function docOf(node: Node): Document {
  return node.ownerDocument ?? (node as Document);
}

/** True when `range` contains `el` in its entirety — both of the element's
 * own edges lie within the range. Anything less is a partial overlap, and a
 * formula is never partially highlighted. */
function containsWholly(range: Range, el: Element): boolean {
  if (!el.parentNode) return false;
  const own = docOf(el).createRange();
  own.selectNode(el);
  return (
    range.compareBoundaryPoints(Range.START_TO_START, own) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, own) >= 0
  );
}

/**
 * Reads a range into the list of things that would be highlighted, WITHOUT
 * touching the DOM. Everything `paintAll` does is derived from these lists,
 * which is what lets it snapshot a whole batch before mutating.
 *
 * Text nodes are clipped to the range's own offsets where they are boundary
 * containers, so a boundary sitting at offset 0 of a following node — 6,0% of
 * real resolved ranges — yields an empty piece and disappears here rather than
 * becoming an empty `<mark>` later.
 */
function collect(range: Range): Piece[] {
  const pieces: Piece[] = [];
  if (range.collapsed) return pieces;

  const scope = range.commonAncestorContainer;

  // A `TreeWalker` never runs its filter on its own root, so a range that lies
  // ENTIRELY inside a formula (a drag from one glyph to the next, which a
  // reader can absolutely do) would otherwise walk straight past the guard
  // below and open a `<mark>` inside KaTeX's own markup. Same for a drag
  // inside a visualization's controls. There is nothing paintable in either
  // case: a formula is atomic, so a range that does not contain the whole
  // element does not highlight it (`containsWholly`), and a drag inside a
  // `[data-viz]` covers no annotatable text at all. `selectionToAnchor` says
  // the same thing about both — this is the painter refusing independently
  // rather than trusting the caller to have resolved through an anchor first.
  const host = isElement(scope) ? scope : scope.parentElement;
  if (!host || host.closest(ATOMIC_SELECTOR) || host.closest(EXCLUDED_SELECTOR)) return pieces;

  if (scope.nodeType === Node.TEXT_NODE) {
    const node = scope as Text;
    const start = range.startOffset;
    const end = range.endOffset;
    if (end > start) pieces.push({ kind: 'text', node, start, end });
    return pieces;
  }
  if (!isElement(scope)) return pieces;

  const walker = docOf(scope).createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      if (isElement(node)) {
        // FILTER_REJECT skips the node AND its subtree — the only correct
        // answer for both cases: runtime UI must not be wrapped at all, and a
        // formula must be handled as one indivisible element from outside.
        if (node.matches(EXCLUDED_SELECTOR)) return NodeFilter.FILTER_REJECT;
        if (node.matches(ATOMIC_SELECTOR)) {
          if (containsWholly(range, node)) pieces.push({ kind: 'atomic', el: node });
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!range.intersectsNode(text)) continue;
    const start = text === range.startContainer ? range.startOffset : 0;
    const end = text === range.endContainer ? range.endOffset : text.data.length;
    if (end > start) pieces.push({ kind: 'text', node: text, start, end });
  }
  return pieces;
}

/**
 * Applies every cut the whole batch needs, in one pass per Text node, and
 * returns the resulting fragments keyed by the ORIGINAL node.
 *
 * Splitting descending is what makes this safe: `splitText(off)` leaves
 * `[0, off)` in the node it was called on, so every SMALLER offset still means
 * the same character in the same node afterwards. Ascending would invalidate
 * each next offset. The fragments then read off as `node` plus its immediate
 * next siblings, because each `splitText` inserts its new half directly after
 * the node it split, and nothing else is inserted until every cut is done.
 */
function applyCuts(plans: readonly Piece[][]): Map<Text, Fragment[]> {
  const cuts = new Map<Text, Set<number>>();
  for (const pieces of plans) {
    for (const piece of pieces) {
      if (piece.kind !== 'text') continue;
      let offsets = cuts.get(piece.node);
      if (!offsets) {
        offsets = new Set<number>();
        cuts.set(piece.node, offsets);
      }
      if (piece.start > 0) offsets.add(piece.start);
      if (piece.end < piece.node.data.length) offsets.add(piece.end);
    }
  }

  const fragments = new Map<Text, Fragment[]>();
  for (const [node, offsets] of cuts) {
    const length = node.data.length;
    const ascending = Array.from(offsets).sort((a, b) => a - b);
    for (let i = ascending.length - 1; i >= 0; i--) node.splitText(ascending[i]);

    const list: Fragment[] = [];
    let current: Text = node;
    let from = 0;
    for (const offset of ascending) {
      list.push({ from, to: offset, node: current });
      from = offset;
      current = current.nextSibling as Text;
    }
    list.push({ from, to: length, node: current });
    fragments.set(node, list);
  }
  return fragments;
}

/** How the neighbour on one side of a whitespace fragment reads: `'inline'`
 * (a real rendered space belongs here), `'block'` (this is markup
 * indentation), `'none'` (no evidence either way). */
function side(sibling: Node | null): 'inline' | 'block' | 'none' {
  if (!sibling) return 'none';
  if (sibling.nodeType === Node.TEXT_NODE) return 'inline';
  if (isElement(sibling)) return INLINE_TAGS.has(sibling.tagName) ? 'inline' : 'block';
  return 'none';
}

/**
 * Whether this fragment is worth wrapping. Everything with a visible
 * character is; a whitespace-only fragment only if it sits in an inline
 * formatting context — see the file doc, section 4.
 *
 * The `mark.ann` shortcut is for the overlap case: a fragment already wrapped
 * by an earlier annotation has no siblings left to judge by, but the earlier
 * annotation already judged it, and the two must agree or the second note
 * would show a hole the first one does not.
 */
function paintable(node: Text): boolean {
  if (node.data.trim() !== '') return true;
  const parent = node.parentElement;
  if (parent && parent.tagName === 'MARK' && parent.classList.contains('ann')) return true;
  const before = side(node.previousSibling);
  const after = side(node.nextSibling);
  if (before === 'block' || after === 'block') return false;
  return before === 'inline' || after === 'inline';
}

function wrapText(node: Text, id: string, color: HighlightColor): void {
  const parent = node.parentNode;
  if (!parent) return;
  const mark = docOf(node).createElement('mark');
  mark.className = `ann ann-${color}`;
  mark.setAttribute(MARK_ID, id);
  parent.insertBefore(mark, node);
  mark.appendChild(node);
}

function readList(el: Element, attr: string): string[] {
  const raw = el.getAttribute(attr);
  return raw ? raw.split(' ').filter((s) => s.length > 0) : [];
}

/**
 * The two lookups every id-scoped operation starts from, as NATIVE selectors
 * rather than "query everything, then filter in JS".
 *
 * Both forms are O(nodes in `root`) per call — jsdom's `querySelectorAll`
 * walks the tree either way, and measuring said so: unpainting 200
 * annotations off p1-5 one by one cost 10,4 s with a "query every mark, filter
 * in JS" version and 9,3 s with this one. The win is not there; it is that the
 * engine returns a two-element NodeList instead of a 2.027-element one that
 * then has to be copied and filtered — which is why `highlightElements`,
 * called once per annotation per layout pass by Task 6, got materially
 * cheaper (this file's own test suite went 11,0 s → 7,7 s on that change
 * alone).
 *
 * What is NOT fixed by any of this, stated so Task 4 does not walk into it:
 * `unpaint` is O(notes × nodes) when called in a loop. Removing ONE note is
 * 24–70 ms in jsdom (single-digit ms in a browser) and that is the flow that
 * exists — a chapter change drops every mark at once by replacing
 * `innerHTML`, it does not unpaint them. If a "repaint everything" flow ever
 * appears, it needs a batch entry point here, not a loop over this one.
 *
 * Escaped because an id reaches here from `AnnotationRow.id`, which comes back
 * from the server as data — an unescaped `"` in it would turn a query into
 * selector injection, or into a `SyntaxError` thrown in the middle of
 * rendering a chapter. `~=` is the whitespace-separated-list operator, which
 * is exactly what `data-ann-ids` holds for a formula covered by several notes.
 */
function markSelector(id: string): string {
  return `mark.ann[${MARK_ID}="${cssValue(id)}"]`;
}

function atomicSelector(id: string): string {
  return `[${ATOMIC_IDS}~="${cssValue(id)}"]`;
}

/** Escapes a string for use inside a quoted CSS attribute value. `CSS.escape`
 * is the standard answer and exists in every browser this app targets (and in
 * jsdom); the fallback covers the two characters that can actually terminate
 * or extend a quoted string, for any environment that lacks it. */
function cssValue(id: string): string {
  // Called as a METHOD, not through a saved reference: `CSS.escape` is a
  // WebIDL static and both jsdom and browsers throw
  // "'escape' called on an object that is not a valid instance of CSS" when it
  // is detached from its namespace object.
  const css = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS;
  return typeof css?.escape === 'function' ? css.escape(id) : id.replace(/["\\]/g, '\\$&');
}

/** Re-derives a formula's tint classes from its remaining id list. The colour
 * shown is the LAST one painted, mirroring how the innermost `<mark>` is the
 * one drawn on top for text. */
function syncAtomicClasses(el: Element, colors: readonly string[]): void {
  for (const c of COLORS) el.classList.remove(`${HL}-${c}`);
  const top = colors[colors.length - 1];
  if (top === undefined) {
    el.classList.remove(HL);
    return;
  }
  el.classList.add(HL, `${HL}-${top}`);
}

function tintAtomic(el: Element, id: string, color: HighlightColor): boolean {
  const ids = readList(el, ATOMIC_IDS);
  if (ids.includes(id)) return false;
  const colors = readList(el, ATOMIC_COLORS);
  ids.push(id);
  colors.push(color);
  el.setAttribute(ATOMIC_IDS, ids.join(' '));
  el.setAttribute(ATOMIC_COLORS, colors.join(' '));
  syncAtomicClasses(el, colors);
  return true;
}

/**
 * Paints a batch of annotations in one pass. THIS is what a chapter render
 * should call — see the file doc, section 1, for why a loop over `paint` is
 * not equivalent.
 *
 * Returns the number of DOM elements created (`<mark>`s plus newly tinted
 * formulas). A non-zero result means every `NormMap` taken before this call is
 * now stale and must be rebuilt; `0` means nothing changed and the map is
 * still usable.
 *
 * Painting an id that is already painted ADDS a second layer rather than
 * replacing the first — to change an annotation's colour, `unpaint` it first.
 * (`unpaint` does remove every layer, so this is recoverable rather than
 * permanent.)
 */
export function paintAll(items: readonly PaintItem[]): number {
  if (items.length === 0) return 0;

  // Phase 1 — read every range. No mutation, so no range has to survive
  // another range's paint.
  const plans = items.map((item) => collect(item.range));

  // Phase 2 — every cut the batch needs, node by node.
  const fragments = applyCuts(plans);

  // Phase 3 — wrap. Later items nest inside earlier ones where they overlap.
  let created = 0;
  for (let i = 0; i < items.length; i++) {
    const { id, color } = items[i];
    for (const piece of plans[i]) {
      if (piece.kind === 'atomic') {
        if (tintAtomic(piece.el, id, color)) created++;
        continue;
      }
      const list = fragments.get(piece.node);
      if (!list) continue;
      for (const fragment of list) {
        if (fragment.from < piece.start || fragment.to > piece.end) continue;
        if (!paintable(fragment.node)) continue;
        wrapText(fragment.node, id, color);
        created++;
      }
    }
  }
  return created;
}

/**
 * Paints one annotation. Use it for a note being created from a fresh
 * selection; use `paintAll` when more than one range was resolved against the
 * same `NormMap`.
 *
 * Returns the number of elements created, `0` when the range covered nothing
 * paintable (collapsed, or entirely inside a visualization).
 */
export function paint(range: Range, id: string, color: HighlightColor): number {
  return paintAll([{ range, id, color }]);
}

/**
 * Removes every trace of one annotation and merges the text back together, so
 * that painting and un-painting is a round trip: the container's `innerHTML`
 * is restored exactly (`Node.normalize()` is what makes that true — without
 * it the text stays split and the next `NormMap` describes the same content
 * with a different segment count).
 *
 * Overlapping annotations are unaffected in either removal order: unwrapping a
 * `<mark>` moves its children — including another annotation's `<mark>` — into
 * its place. Returns the number of elements changed; `0` means the id was not
 * painted and nothing moved (so a `NormMap` stays valid).
 *
 * `root` defaults to `document`; pass the chapter container to scope the query
 * (and to keep a test fixture from matching another fixture's marks).
 */
export function unpaint(id: string, root: ParentNode = document): number {
  let changed = 0;
  const touched = new Set<Node>();

  for (const mark of Array.from(root.querySelectorAll(markSelector(id)))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    touched.add(parent);
    changed++;
  }

  for (const el of Array.from(root.querySelectorAll(atomicSelector(id)))) {
    const ids = readList(el, ATOMIC_IDS);
    const at = ids.indexOf(id);
    if (at < 0) continue;
    const colors = readList(el, ATOMIC_COLORS);
    ids.splice(at, 1);
    colors.splice(at, 1);
    if (ids.length === 0) {
      el.removeAttribute(ATOMIC_IDS);
      el.removeAttribute(ATOMIC_COLORS);
    } else {
      el.setAttribute(ATOMIC_IDS, ids.join(' '));
      el.setAttribute(ATOMIC_COLORS, colors.join(' '));
    }
    syncAtomicClasses(el, colors);
    changed++;
  }

  for (const parent of touched) parent.normalize();
  return changed;
}

/**
 * Every element currently drawing one annotation, in document order: its
 * `<mark>`s and any formula it tints. This is what Task 6 needs to add a
 * focus class or scroll a highlight into view, and what `highlightRects`
 * measures.
 */
export function highlightElements(id: string, root: ParentNode = document): Element[] {
  // One selector rather than two queries merged afterwards: `querySelectorAll`
  // returns document order across a selector LIST, and document order is the
  // contract here — Task 6 reads the first rect to place a card.
  return Array.from(root.querySelectorAll(`${markSelector(id)}, ${atomicSelector(id)}`));
}

/**
 * Where one annotation is on the page, in DOCUMENT coordinates — one rect per
 * line the highlight wraps onto, in document order.
 *
 * The coordinate system is the decision here, and it is `getClientRects()`
 * (viewport, changes on every scroll) plus the current scroll offset, NOT the
 * raw client rects. Task 6 positions a note card in the right rail beside its
 * highlight; a card placed from viewport coordinates is correct for exactly
 * one scroll position and drifts on every subsequent one, and the layout code
 * would have to know which scroll offset each rect was measured at to fix it.
 * Document coordinates are stable under scrolling and convert to a position
 * inside any container with one subtraction the caller already has to do:
 *
 *     const top = container.getBoundingClientRect().top + window.scrollY;
 *     cardTop = highlightRects(id)[0].top - top;
 *
 * They still change when the page RE-LAYOUTS (a font loads, the window is
 * resized, a figure grows), which is real movement the cards have to follow —
 * so Task 6 re-measures on resize/relayout, but not on scroll.
 *
 * An empty array means the annotation is not painted, or is painted only over
 * content with no box (a highlighted space between two blocks).
 */
export function highlightRects(id: string, root: ParentNode = document): DOMRect[] {
  const out: DOMRect[] = [];
  for (const el of highlightElements(id, root)) {
    const view = el.ownerDocument?.defaultView;
    const scrollX = view?.scrollX ?? 0;
    const scrollY = view?.scrollY ?? 0;
    for (const rect of Array.from(el.getClientRects())) {
      out.push(new DOMRect(rect.left + scrollX, rect.top + scrollY, rect.width, rect.height));
    }
  }
  return out;
}
