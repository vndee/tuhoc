/**
 * Text normalization for the annotation engine (P2 Task 1).
 *
 * `ChapterView` (`../reader/ChapterView.tsx`) renders a chapter by setting
 * `innerHTML` on a plain `<div>` React never diffs, then running
 * `CourseKit.renderKatex(el)` (KaTeX auto-render — see
 * `packages/course-kit/runtime.js:319`), `CourseKit.initViz(el)`
 * (mounts canvas-based figures into every `[data-viz]` node), and finally
 * `injectExerciseCheckboxes` (`../reader/injectExerciseCheckboxes.ts`,
 * appends a "Đã làm" checkbox into every `.box.ex .box-h`). By the time
 * annotation code runs, the container mixes three kinds of content:
 *
 *   1. Authored prose — `<p>`, `<li>`, table cells, callout boxes, figure
 *      captions, collapsible `<summary>`/`<details>` bodies — anything
 *      that came from the chapter's own HTML fragment and will exist
 *      again, byte-for-byte, on the next render.
 *   2. KaTeX output — each formula becomes a `<span class="katex">` (or,
 *      for `$$…$$` display math, a `<span class="katex-display">`
 *      wrapping one) containing the SAME mathematics rendered three
 *      times over: a visually-hidden MathML tree (whose `<annotation>`
 *      also carries the raw TeX source — a second, unrelated string) and
 *      a visible HTML glyph tree. Naive `textContent` over that subtree
 *      is tripled and meaningless.
 *   3. Runtime-generated UI — canvases, slider/button rows (`.ctrls`),
 *      live numeric readouts (`.readout`), hover tooltips (`.tip`, all
 *      mounted under `[data-viz]` — see `runtime.js`'s `Plot`, `ctrlRow`,
 *      `readout`), and the exercise "Đã làm" checkbox (`.ex-check`,
 *      injected by `injectExerciseCheckboxes`). None of this exists in
 *      the chapter's source HTML; all of it must be invisible to
 *      annotation, or a highlight anchor would silently rot the moment
 *      the visualization repaints or a checkbox is (un)checked.
 *
 * `normalizeContainer` walks the DOM once (a `TreeWalker`, O(n) in the
 * number of nodes — chapters with hundreds of formulas still walk in a
 * handful of milliseconds, see the perf sanity test in
 * `normalize.test.ts`) and produces a flat string plus a segment map back
 * to DOM positions:
 *
 *   - Every included text node contributes its FULL `data` (whitespace
 *     included — collapsing it would break the offset correspondence
 *     `flatToDom`/`domToFlat` exist to provide; see the file-level doc in
 *     `normalize.test.ts` and this task's report for why that is a
 *     deliberate choice, not an oversight).
 *   - Every `.katex`/`.katex-display` root contributes exactly one
 *     `'￼'` (OBJECT REPLACEMENT CHARACTER) and its subtree is never
 *     descended into.
 *   - `.ctrls`, `.tip`, `canvas`, `[data-viz]` (the whole viz mount —
 *     canvas/.ctrls/.tip/.readout are all descendants of it, so excluding
 *     it wholesale is both simpler and more future-proof than enumerating
 *     each generated class individually) and `.ex-check` are skipped
 *     entirely, subtree included.
 *   - Everything else (headings, `<b>`/`<i>`, `<th>`, `<summary>`, box
 *     headers, figure titles/captions, …) is included by default: this
 *     module treats "annotatable" as the DEFAULT and excludes only the
 *     specific, known, runtime-generated chrome above, rather than
 *     maintaining an allowlist of prose tags. An allowlist would need to
 *     anticipate every element the course content ever wraps prose in;
 *     getting it wrong in the narrow direction (forgetting `<th>` or
 *     `<summary>`, say) silently makes real authored content
 *     unannotatable, which is worse than the alternative.
 *
 * `flatToDom`/`domToFlat` are the two directions of the same mapping.
 * Both treat an atomic segment's element as indivisible: a boundary that
 * lands on/inside a formula is always resolved to a position in the
 * formula's PARENT (immediately before or after the whole element), never
 * to a position inside the formula's own (excluded) subtree — this is
 * the "snap outward" behaviour the task brief asks for, and it falls out
 * naturally from always using `Range.setStart(Before|After)` /
 * `setEnd(Before|After)` for atomic segments instead of indexing into the
 * element's own children.
 */

const ATOMIC_SELECTOR = '.katex, .katex-display';

/**
 * Runtime-generated UI that must never be annotated. `[data-viz]` alone
 * would cover canvas/.ctrls/.tip/.readout (all mounted underneath it by
 * `initViz`, see the file doc above), but the narrower selectors are kept
 * too as defence in depth in case a future visualization ever appends
 * one of these outside its own `[data-viz]` host. `.ex-check` is Task
 * 15's injected exercise checkbox — not a visualization at all, but the
 * same category of "exists only in the live DOM, never in the chapter's
 * source HTML."
 */
const EXCLUDED_SELECTOR = '.ctrls, .tip, canvas, [data-viz], .readout, .ex-check';

/** OBJECT REPLACEMENT CHARACTER — the single atomic stand-in for one
 * whole `.katex`/`.katex-display` subtree. */
const ATOMIC_CHAR = '￼';

export interface NormSeg {
  /** The Text node this segment's characters come from, or the
   * `.katex`/`.katex-display` Element it stands in for (`atomic: true`). */
  node: Text | Element;
  /** Flat-string offset where this segment starts (inclusive). */
  start: number;
  /** Flat-string offset where this segment ends (exclusive). */
  end: number;
  /** True for a `.katex`/`.katex-display` stand-in (always `end - start === 1`). */
  atomic: boolean;
}

export interface NormMap {
  /** The chapter's annotatable text, whitespace preserved, one `'￼'`
   * per formula. */
  flat: string;
  /** Segments in flat-string order, contiguous and gapless: `segs[i].end
   * === segs[i + 1].start` for every `i`. */
  segs: NormSeg[];
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

/**
 * Walks `root` once and builds the flat text + segment map described in
 * the file-level doc above.
 *
 * Implemented with a `TreeWalker` whose `acceptNode` filter does double
 * duty: for an excluded container it returns `FILTER_REJECT`, which per
 * the DOM traversal algorithm skips the node AND its entire subtree —
 * exactly what "invisible to annotation" requires. For an atomic
 * `.katex`/`.katex-display` root it records the atomic segment as a side
 * effect and *also* returns `FILTER_REJECT`, for the same subtree-skip
 * reason (the walker never needs to visit — and must never visit — the
 * MathML/HTML internals). Ordinary elements return `FILTER_SKIP` (not
 * accepted themselves, but their children are still traversed). Text
 * nodes are accepted outright. This keeps the whole walk to a single
 * `nextNode()` loop with no re-scanning of any subtree, so cost is
 * linear in the number of DOM nodes regardless of how many formulas a
 * chapter has.
 */
export function normalizeContainer(root: Element): NormMap {
  const segs: NormSeg[] = [];
  let flat = '';

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      if (isElement(node)) {
        if (node.matches(EXCLUDED_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.matches(ATOMIC_SELECTOR)) {
          segs.push({ node, start: flat.length, end: flat.length + 1, atomic: true });
          flat += ATOMIC_CHAR;
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const data = text.data;
    if (data.length === 0) continue; // empty text nodes contribute nothing; see normalize.test.ts
    segs.push({ node: text, start: flat.length, end: flat.length + data.length, atomic: false });
    flat += data;
  }

  return { flat, segs };
}

/** Binary-searches `map.segs` (sorted, contiguous, gapless by
 * construction) for the segment covering flat position `pos`, returning
 * that segment plus `pos`'s offset within it. `pos === map.flat.length`
 * (the very end of the content) resolves to the LAST segment with
 * `offsetInSeg === segment length`, i.e. "just past the end." Returns
 * `null` only when there are no segments at all (nothing annotatable). */
function locate(map: NormMap, pos: number): { seg: NormSeg; offsetInSeg: number } | null {
  const segs = map.segs;
  if (segs.length === 0) return null;

  const clamped = Math.max(0, Math.min(pos, map.flat.length));
  let lo = 0;
  let hi = segs.length - 1;
  let ans = segs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].end > clamped) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  const seg = segs[ans];
  return { seg, offsetInSeg: clamped - seg.start };
}

/** Sets one boundary (`'start'` or `'end'`) of `range` for a resolved
 * `(seg, offsetInSeg)` pair. This is where atomic tokens get "snapped
 * outward": for an atomic segment the boundary is placed in the
 * element's PARENT via `setStartBefore`/`setStartAfter` (never
 * `setStart(element, childIndex)`, which would point INSIDE the
 * element's own — excluded — child list). For an ordinary text segment
 * the boundary is a plain offset into that Text node. */
function setBoundary(range: Range, which: 'start' | 'end', seg: NormSeg, offsetInSeg: number): void {
  if (seg.atomic) {
    const el = seg.node as Element;
    if (offsetInSeg === 0) {
      if (which === 'start') range.setStartBefore(el);
      else range.setEndBefore(el);
    } else {
      if (which === 'start') range.setStartAfter(el);
      else range.setEndAfter(el);
    }
    return;
  }
  const t = seg.node as Text;
  if (which === 'start') range.setStart(t, offsetInSeg);
  else range.setEnd(t, offsetInSeg);
}

/**
 * Converts a `[from, to)` flat-offset span into a DOM `Range`.
 *
 * `from`/`to` are clamped into `[0, map.flat.length]` and swapped if
 * given in reverse order — a defensive convenience, not a documented
 * contract callers should rely on. Returns `null` when `map` has no
 * annotatable content at all (nothing to build a `Range` over).
 *
 * A boundary that lands exactly on a formula's edge is always resolved
 * to a position in the formula's parent (see `setBoundary` above), never
 * inside the formula's own subtree — there is no flat position that can
 * land "inside" an atomic token in the first place (it occupies exactly
 * one flat character, so its only two boundary positions ARE its edges),
 * but naively reusing `Range.setStart(element, offset)` for an Element
 * segment the way it's used for a Text segment would place the boundary
 * one level too deep, among the formula's own (excluded) MathML/HTML
 * children. `setStartBefore`/`setStartAfter` avoid that by construction.
 */
export function flatToDom(map: NormMap, from: number, to: number): Range | null {
  if (map.flat.length === 0 || map.segs.length === 0) return null;

  let a = Math.max(0, Math.min(from, map.flat.length));
  let b = Math.max(0, Math.min(to, map.flat.length));
  if (a > b) [a, b] = [b, a];

  const startLoc = locate(map, a);
  const endLoc = locate(map, b);
  if (!startLoc || !endLoc) return null;

  const range = document.createRange();
  setBoundary(range, 'start', startLoc.seg, startLoc.offsetInSeg);
  setBoundary(range, 'end', endLoc.seg, endLoc.offsetInSeg);
  return range;
}

/** Returns the flat start offset of the first tracked segment reachable
 * within `node` (itself or any descendant), scanning in document order.
 * `null` if nothing under `node` is tracked (e.g. it's wholly excluded,
 * or an empty text node). */
function firstFlatStart(node: Node, segByNode: Map<Node, NormSeg>): number | null {
  const seg = segByNode.get(node);
  if (seg) return seg.start;
  if (!isElement(node)) return null;
  for (const child of Array.from(node.childNodes)) {
    const found = firstFlatStart(child, segByNode);
    if (found !== null) return found;
  }
  return null;
}

/** Mirror of `firstFlatStart`: the flat END offset of the LAST tracked
 * segment reachable within `node`, scanning backward. */
function lastFlatEnd(node: Node, segByNode: Map<Node, NormSeg>): number | null {
  const seg = segByNode.get(node);
  if (seg) return seg.end;
  if (!isElement(node)) return null;
  const children = Array.from(node.childNodes);
  for (let i = children.length - 1; i >= 0; i--) {
    const found = lastFlatEnd(children[i], segByNode);
    if (found !== null) return found;
  }
  return null;
}

/** Climbs from `node` (inclusive) up through `parentElement` looking for
 * a tracked ATOMIC ancestor — i.e. a `.katex`/`.katex-display` root that
 * has a segment in `segByNode`. Any Element key in `segByNode` is
 * necessarily atomic (plain-text segments are always keyed by a Text
 * node), so no extra `.atomic` check is needed once a match is found. */
function closestAtomicAncestor(node: Node, segByNode: Map<Node, NormSeg>): NormSeg | null {
  let el: Element | null = isElement(node) ? node : node.parentElement;
  while (el) {
    const seg = segByNode.get(el);
    if (seg) return seg;
    el = el.parentElement;
  }
  return null;
}

/** Resolves the flat position "just before `el.childNodes[offset]`" (or
 * "just after `el`'s last tracked content" when `offset` is at or past
 * the end). Tries forward first (what starts at-or-after `offset`?),
 * then backward (what ends at-or-before `offset`?), and if `el` itself
 * has no tracked content anywhere near `offset`, recurses one level up
 * using `el`'s own position in ITS parent — this is what lets an
 * `Element`+childIndex boundary landing in the middle of a wholly
 * excluded/empty subtree still resolve to a sensible nearby position
 * instead of failing. */
function resolveWithinElement(map: NormMap, el: Element, offset: number, segByNode: Map<Node, NormSeg>): number {
  const children = Array.from(el.childNodes);
  const clampedOffset = Math.max(0, Math.min(offset, children.length));

  for (let i = clampedOffset; i < children.length; i++) {
    const found = firstFlatStart(children[i], segByNode);
    if (found !== null) return found;
  }
  for (let i = clampedOffset - 1; i >= 0; i--) {
    const found = lastFlatEnd(children[i], segByNode);
    if (found !== null) return found;
  }

  const parent = el.parentNode;
  if (parent && isElement(parent)) {
    const idx = Array.prototype.indexOf.call(parent.childNodes, el);
    return domToFlat(map, parent, idx);
  }
  return 0;
}

/** `domToFlat` is called repeatedly against the SAME `NormMap` while a
 * user drags out a selection (once per `selectionchange`, potentially
 * many times per second) — rebuilding a `Node -> NormSeg` index from
 * `map.segs` on every call would be needless O(segs) work each time.
 * Caching it here, keyed by the `NormMap` object's own identity (a fresh
 * object is returned by every `normalizeContainer` call, i.e. every
 * chapter render), avoids that without changing the public `NormMap`
 * shape. A `WeakMap` rather than a plain module-level slot: once a
 * chapter's `NormMap` is no longer referenced anywhere else (the reader
 * navigated away, `normalizeContainer` ran again for a re-render), its
 * cached index — and the DOM nodes it holds onto as keys — becomes
 * eligible for garbage collection on its own, with no explicit
 * invalidation needed. */
const segIndexCache = new WeakMap<NormMap, Map<Node, NormSeg>>();

function segIndexFor(map: NormMap): Map<Node, NormSeg> {
  let segByNode = segIndexCache.get(map);
  if (!segByNode) {
    segByNode = new Map<Node, NormSeg>();
    for (const seg of map.segs) segByNode.set(seg.node, seg);
    segIndexCache.set(map, segByNode);
  }
  return segByNode;
}

/**
 * Converts a DOM `(node, offset)` position — as handed back by a live
 * `Selection`/`Range`, or by a `Range` this module itself produced — into
 * a flat offset.
 *
 * Any position inside a `.katex`/`.katex-display` subtree (the hidden
 * MathML, its `<annotation>`, or the visible HTML glyphs — anywhere)
 * resolves to that formula's own START edge, regardless of how deep the
 * position is nested or which of the three internal renderings it falls
 * in. This is a deliberate simplification: distinguishing "closer to the
 * start" from "closer to the end" of a formula would require reasoning
 * about the internal MathML/HTML structure this module is specifically
 * designed to never look inside. A single, consistent edge keeps the
 * mapping well-defined and — critically — keeps a formula from ever
 * being partially selectable, which is the actual requirement.
 */
export function domToFlat(map: NormMap, node: Node, offset: number): number {
  const segByNode = segIndexFor(map);

  if (node.nodeType === Node.TEXT_NODE) {
    const seg = segByNode.get(node);
    if (seg) {
      return Math.max(seg.start, Math.min(seg.start + offset, seg.end));
    }
  }

  const atomicHost = closestAtomicAncestor(node, segByNode);
  if (atomicHost) return atomicHost.start;

  if (isElement(node)) {
    return resolveWithinElement(map, node, offset, segByNode);
  }

  // An untracked/empty Text node, or some other node kind: resolve as
  // "just before this node" from its parent's perspective.
  const parent = node.parentNode;
  if (parent && isElement(parent)) {
    const idx = Array.prototype.indexOf.call(parent.childNodes, node);
    return domToFlat(map, parent, idx);
  }
  return 0;
}
