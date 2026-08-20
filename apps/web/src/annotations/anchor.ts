/**
 * Text-quote anchors for the annotation engine (P2 Task 2).
 *
 * This module is what decides whether a reader's note survives. It turns a
 * live selection into a description of the quoted text that does not depend
 * on DOM structure or character offsets — `exact` plus a little context on
 * each side — and turns that description back into a `Range` the next time
 * the chapter is opened, on another device, or after the course has been
 * rebuilt with edited content. Its failure mode is silent: no exception, no
 * console error, just a note that is no longer where the reader left it.
 *
 * Everything below sits on top of `./normalize`, whose contract matters
 * here in three ways:
 *   1. one KaTeX formula is exactly one `'￼'` (U+FFFC) character in
 *      `map.flat`, so a quote can contain formulas without this module ever
 *      looking at MathML;
 *   2. `rangeToFlat` — never two `domToFlat` calls — is how a `Range`
 *      becomes a flat span. It pairs the two snap biases correctly and
 *      returns `null` for everything that cannot be anchored (outside the
 *      chapter, collapsed, empty after snapping). When it says `null`,
 *      `selectionToAnchor` says `null`; there is nothing to salvage.
 *   3. `map.flat` keeps whitespace RAW — newlines and indentation from
 *      between the chapter's tags included (a real chapter has ~128 such
 *      runs). That is correct for `normalize`, and it is the trap this
 *      module has to be coherent about; see "The whitespace decision".
 *
 * ---------------------------------------------------------------------
 * The whitespace decision (ruling P2-F5): option (b), collapsed projection
 * ---------------------------------------------------------------------
 * An anchor stores its quote in a COLLAPSED projection of `map.flat`, and
 * every search happens in that same projection. Nothing in this file ever
 * runs `indexOf` against raw `flat`. Raw offsets appear at exactly one
 * place — `materialize`, which maps a projected span back through
 * `Projection.rawStart`/`rawEnd` before calling `flatToDom`. Mixing the two
 * spaces is the Critical failure the ruling warns about: a collapsed quote
 * searched in raw text never matches, every note that crosses a tag
 * boundary silently degrades to fuzzy, and long notes become orphans —
 * while a single-line test fixture stays green throughout.
 *
 * The projection does two things to `flat`:
 *   - every run of whitespace becomes a single `' '` (leading and trailing
 *     runs are dropped);
 *   - a `' '` is forced at every BLOCK boundary, whether or not the source
 *     HTML happened to put whitespace between those two tags.
 *
 * The second half is what makes the projection stable across reformatting,
 * which is the whole point of a text-quote anchor. `<p>A</p>\n<p>B</p>` and
 * `<p>A</p><p>B</p>` have different `flat` strings ("A\nB" vs "AB") and
 * whitespace collapsing alone maps them to different projections ("A B" vs
 * "AB") — so a note taken before a rebuild that reindented or minified the
 * chapter would not match after it. With block separators both project to
 * "A B".
 *
 * It also fixes a defect measured on the real p1-5 chapter: adjacent table
 * cells produce no separator at all in `flat`, giving
 * `"Trọng số ở đâuở nơi ￼ lớn"` and `"Hành vimass-covering"`. A quote cut
 * from that reads as nonsense on the note card (Task 6). Deciding it here
 * rather than in `normalize` is deliberate: `flat` must stay exactly
 * invertible for `flatToDom`/`domToFlat`, so the synthetic separator can
 * only live in a projection that carries its own offset map back.
 *
 * Known limitation, stated rather than hidden: `<br>` is NOT treated as a
 * block boundary. Every `<br>` in this course's 44 chapters is followed by
 * a newline in the source, so the whitespace rule already separates those
 * lines; adding a `<br>` rule would mean re-deriving `normalize`'s
 * exclusion list here (to skip `<br>`s inside runtime-generated
 * visualizations), and a duplicated exclusion list that can drift is a
 * worse bug than a missing space. If a future build minifies the HTML, a
 * `<br>`-separated quote loses one space — a distance-1 edit the fuzzy tier
 * absorbs.
 */

import { assertMapFresh, flatToDom, type NormMap, rangeToFlat } from './normalize';

/**
 * Re-exported so a caller that resolves anchors never has to import
 * `./normalize` just to name the error it has to handle, or to ask the
 * question that avoids it. `isMapStale` is the non-throwing form: Task 4's
 * "resolve every annotation on page open" should ask ONCE per batch rather
 * than wrap 200 calls in `try`/`catch`.
 */
export { isMapStale, StaleNormMapError } from './normalize';

export type AnchorColor = 'y' | 'g' | 'b' | 'p';

/**
 * What gets stored, verbatim, in `AnnotationRow.anchor` (`../db/local.ts`,
 * carried as opaque `unknown` there and as `json.RawMessage` on the server
 * — see ruling P2-F2: this shape needs no migration, and if it looked like
 * it did, that would mean the data contract had been misread).
 *
 * `exact`, `prefix` and `suffix` are all in the collapsed projection
 * described above: no newlines, no runs of spaces, one `'￼'` per formula.
 */
export interface Anchor {
  exact: string;
  prefix: string;
  suffix: string;
  color: AnchorColor;
}

/**
 * How many characters of context to store on each side.
 *
 * 32 is the W3C Web Annotation / `dom-anchor-text-quote` convention, and
 * the reasoning holds here: it is 5–6 Vietnamese words, enough to tell
 * apart the repeated fragments this course actually contains (`"ở nơi p
 * lớn"` / `"ở nơi q lớn"` in comparison tables, `"mô hình sinh"` in half
 * the chapters), while costing ~64 extra characters per annotation in a
 * jsonb column. Making it longer is nearly free for correctness — context
 * is scored from the edge ADJACENT to the quote outward, so a stale far end
 * simply stops contributing — but it is not free for storage, and 32 is
 * already past the point where a longer prefix changes any decision on this
 * corpus. A selection at the very start or end of a chapter gets a shorter
 * prefix/suffix, or `''`; both are ordinary values here, never `undefined`.
 */
const CONTEXT_LEN = 32;

/** How far the fuzzy tier lets a match start/end drift from the position
 * the prefix (or suffix) suggested. Spec §9's `|exact| ± 8`. */
const FUZZY_SLACK = 8;

/** Maximum candidate positions the fuzzy tier will consider. Bounds the
 * work when a prefix is a phrase that recurs across the chapter. */
const CAND_CAP = 32;

/**
 * Total DP cells one `anchorToRange` call may spend in the fuzzy tier.
 *
 * Task 4 resolves EVERY anchor of a chapter at once while the reader is
 * waiting for the page, so "slow" here means a frozen tab, not a slow
 * function. A cell is a handful of integer operations on an `Int32Array`;
 * one million of them is single-digit milliseconds on this machine (see
 * task-2-report.md). The budget is spent per candidate window, largest
 * first come first served, so a pathological anchor degrades to "fewer
 * candidates examined" rather than to "browser stops responding". A quote
 * long enough that a single window exceeds the whole budget (~1000
 * characters) gets the exact tier only.
 */
const MAX_DP_CELLS = 1_000_000;

/**
 * Cap on exact-match occurrences collected before context scoring.
 *
 * Chosen high rather than tight on purpose. The cap's only job is to bound
 * the work (`EXACT_CAP × 2·CONTEXT_LEN` character comparisons ≈ 0.13M, well
 * under a millisecond); it must NOT be the thing that decides which
 * occurrence wins. A one-character quote — which a reader is allowed to
 * make, and which the tests pin — occurs several hundred times in a real
 * 11k–19k character chapter, so a cap in the dozens silently truncates the
 * list before reaching the right one and the note moves to a different
 * letter. 2000 is more occurrences than any single character has in the
 * longest chapter of this course — but only just: the highest single-
 * character count measured across all 44 chapters is 1.559 (`'n'`, p4-6),
 * a margin of 1,28×. A chapter ~30% longer, or a second course, truncates
 * the list; what keeps the note in the right place when that happens is the
 * unique-signature tier in `anchorToRange`, which is therefore load-bearing
 * rather than a shortcut, and now has a test of its own (search "R22" in
 * `anchor.test.ts` — before that test it could be deleted outright with all
 * 43 tests still green).
 */
const EXACT_CAP = 2000;

const ATOMIC_CHAR = '￼';

/** Non-global on purpose: `RegExp.prototype.test` on a `/g` regex advances
 * `lastIndex` between calls, which would make this character-by-character
 * classification depend on how many times it had been called before. */
const WS_CHAR = /\s/;

const WS_RUN = /\s+/g;

/**
 * Tags that start a new line of reading. Used only to decide where the
 * projection forces a separator, so the cost of a wrong answer is one
 * space present or absent — which the fuzzy tier can absorb — not a broken
 * offset. An allowlist of tag names rather than computed `display`:
 * `getComputedStyle` is both expensive per node and unavailable in the
 * jsdom test environment, and the chapters' markup is authored HTML with a
 * fixed, known vocabulary.
 */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CAPTION', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE',
  'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

/**
 * A collapsed view of `map.flat` plus the offset map back to it.
 *
 * `rawStart[i]`/`rawEnd[i]` bracket the raw `flat` characters that produced
 * projected character `i`. For an ordinary character they differ by one;
 * for a collapsed whitespace run they span the whole run; for a separator
 * synthesized at a block boundary they are EQUAL (that character has no
 * source text at all), which is exactly what makes it invisible when a
 * projected span is mapped back.
 */
interface Projection {
  readonly text: string;
  readonly rawStart: Int32Array;
  readonly rawEnd: Int32Array;
}

/**
 * Built once per `NormMap` — i.e. once per chapter render — and reused by
 * every anchor resolved against it. Task 4's "resolve all annotations on
 * page open" would otherwise rebuild an identical 11k–19k character
 * projection once per note. Keyed by the `NormMap` object identity in a
 * `WeakMap` for the same reason `normalize.ts` caches its segment index
 * that way: when the chapter's map is dropped, so is this, with no
 * invalidation to remember.
 *
 * A cache keyed on a snapshot makes stale state STICKY, which is exactly
 * the objection raised against it in review — so the ordering matters and
 * is deliberate: every public entry point (`selectionToAnchor` via
 * `rangeToFlat`, `anchorToRange` directly) calls `assertMapFresh` BEFORE it
 * calls `projectionFor`. A map that fails that check never reaches this
 * cache, so a cached projection can only ever be read for a map whose
 * segments still describe the DOM. There is deliberately no invalidation
 * path: a stale `NormMap` is not something to recover from, it is something
 * to replace, and its `Projection` becomes garbage along with it.
 */
const projectionCache = new WeakMap<NormMap, Projection>();

function projectionFor(map: NormMap): Projection {
  let proj = projectionCache.get(map);
  if (!proj) {
    proj = buildProjection(map);
    projectionCache.set(map, proj);
  }
  return proj;
}

/** The nearest block-level ancestor of a segment's node, or `map.root` when
 * there is none inside the chapter. Two segments sharing this element are
 * on the same line of reading; two that do not have a boundary between
 * them. The walk starts at the node's PARENT in both cases: for a Text
 * segment because a Text node is never itself a block, and for an atomic
 * (formula) segment because the `.katex` element is a `<span>` whose own
 * subtree is off-limits by construction. `Text` and `Element` both have
 * `parentElement`, so there is nothing to branch on — an earlier version
 * had a ternary here whose two arms were the same expression. */
function blockOf(node: Text | Element, root: Element): Element {
  let el: Element | null = node.parentElement;
  while (el && el !== root) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return root;
}

function buildProjection(map: NormMap): Projection {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  // A whitespace run (real, synthetic, or both merged) waiting to be
  // emitted as one ' '. Held back rather than emitted eagerly so that a run
  // at the very end of the chapter is simply dropped.
  let pendFrom = -1;
  let pendTo = -1;
  let prevBlock: Element | null = null;

  const flushPending = (): void => {
    if (pendFrom < 0) return;
    // `chars.length === 0` means this run is leading whitespace: dropped,
    // so that a quote's offsets never depend on how the chapter's first tag
    // was indented.
    if (chars.length > 0) {
      chars.push(' ');
      starts.push(pendFrom);
      ends.push(pendTo);
    }
    pendFrom = -1;
    pendTo = -1;
  };

  for (const seg of map.segs) {
    const block = blockOf(seg.node, map.root);
    if (prevBlock !== null && block !== prevBlock && pendFrom < 0) {
      // Zero-width synthetic separator: it maps back to an empty raw span,
      // so a projected span that happens to touch it resolves to the same
      // DOM range as one that does not.
      pendFrom = seg.start;
      pendTo = seg.start;
    }
    prevBlock = block;

    if (seg.atomic) {
      flushPending();
      chars.push(ATOMIC_CHAR);
      starts.push(seg.start);
      ends.push(seg.end);
      continue;
    }

    const data = (seg.node as Text).data;
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      const abs = seg.start + i;
      if (WS_CHAR.test(ch)) {
        if (pendFrom < 0) pendFrom = abs;
        pendTo = abs + 1;
        continue;
      }
      flushPending();
      chars.push(ch);
      starts.push(abs);
      ends.push(abs + 1);
    }
  }

  return {
    text: chars.join(''),
    rawStart: Int32Array.from(starts),
    rawEnd: Int32Array.from(ends),
  };
}

/** First projected index whose raw span ENDS after `raw`. Both offset
 * arrays are non-decreasing by construction, so binary search is valid;
 * synthetic separators (zero-width) are skipped by this predicate rather
 * than being picked up as the leading character of a span. */
function firstEndAfter(proj: Projection, raw: number): number {
  let lo = 0;
  let hi = proj.rawEnd.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (proj.rawEnd[mid] > raw) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** First projected index whose raw span STARTS at or after `raw` — i.e. the
 * exclusive end of the projected span covering raw offsets below `raw`. */
function firstStartAtOrAfter(proj: Projection, raw: number): number {
  let lo = 0;
  let hi = proj.rawStart.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (proj.rawStart[mid] >= raw) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Describes a live selection as a text quote, or returns `null` when there
 * is nothing to anchor.
 *
 * `null` cases, all of them deliberate:
 *   - `rangeToFlat` returned `null` (selection outside the chapter, a plain
 *     click, or a drag that covered nothing annotatable). Its judgement is
 *     final here — a caller that "recovered" from it would be storing an
 *     annotation over content the reader never touched.
 *   - the selection is nothing but whitespace. A drag across the gap
 *     between two paragraphs is a real `Range` with a real, non-empty flat
 *     span, and it collapses to zero characters of quotable text. An
 *     "annotation" on it would have no findable quote and would rot into an
 *     orphan the first time the chapter's indentation changed.
 *
 * Whitespace at the edges of a selection is trimmed off the quote (browsers
 * routinely include a trailing space or newline when a drag ends past the
 * end of a line), so `exact` never begins or ends with a space.
 *
 * Throws `StaleNormMapError` (via `rangeToFlat`) if `map` describes a DOM
 * that has since changed — creating an annotation against a stale map is
 * the same bug as resolving one against it, and would store an anchor whose
 * quote is read off the wrong characters.
 */
export function selectionToAnchor(map: NormMap, range: Range, color: AnchorColor): Anchor | null {
  const span = rangeToFlat(map, range);
  if (!span) return null;

  const proj = projectionFor(map);
  if (proj.text.length === 0) return null;

  let from = firstEndAfter(proj, span.from);
  let to = firstStartAtOrAfter(proj, span.to);
  while (from < to && proj.text[from] === ' ') from++;
  while (to > from && proj.text[to - 1] === ' ') to--;
  if (from >= to) return null;

  return {
    exact: proj.text.slice(from, to),
    prefix: proj.text.slice(Math.max(0, from - CONTEXT_LEN), from),
    suffix: proj.text.slice(to, Math.min(proj.text.length, to + CONTEXT_LEN)),
    color,
  };
}

/** The three strings an anchor is searched by, normalized into the same
 * projection space the chapter is searched in. Defensive because
 * `AnnotationRow.anchor` is `unknown` all the way from the server's
 * `json.RawMessage`: a malformed row must produce an orphan (Task 7's
 * panel, where the reader can still read their note), never an exception
 * during chapter render, which would take the whole page down. */
function readQuote(a: Anchor): { exact: string; prefix: string; suffix: string } | null {
  const raw = a as unknown as { exact?: unknown; prefix?: unknown; suffix?: unknown } | null | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const exact = collapse(raw.exact).trim();
  if (exact.length === 0) return null;
  return { exact, prefix: collapse(raw.prefix), suffix: collapse(raw.suffix) };
}

/** Applies the projection's whitespace rule to a stored string. Anchors
 * written by this module are already collapsed, so this is normally a
 * no-op; it exists so that a hand-edited or legacy row is searched in the
 * same space as everything else instead of silently never matching. */
function collapse(value: unknown): string {
  return typeof value === 'string' ? value.replace(WS_RUN, ' ') : '';
}

function allIndexOf(hay: string, needle: string, cap: number): number[] {
  const out: number[] = [];
  if (needle.length === 0) return out;
  let i = hay.indexOf(needle);
  while (i !== -1 && out.length < cap) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

/**
 * How well the text around `[start, to)` agrees with the context stored in
 * the anchor, counted from the edges TOUCHING the quote outward and
 * stopping at the first mismatch. This is what picks the right one when a
 * quote occurs more than once: a paragraph inserted somewhere else in the
 * chapter shifts positions but not neighbours, and an edit far from the
 * quote costs only the tail of the score rather than invalidating it.
 */
function contextScore(text: string, start: number, to: number, prefix: string, suffix: string): number {
  let before = 0;
  while (before < prefix.length && start - 1 - before >= 0 && text[start - 1 - before] === prefix[prefix.length - 1 - before]) {
    before++;
  }
  let after = 0;
  while (after < suffix.length && to + after < text.length && text[to + after] === suffix[after]) {
    after++;
  }
  return before + after;
}

/**
 * Levenshtein edit distance, banded and cut short at `max`.
 *
 * Returns the true distance when it is `<= max`, and `max + 1` — a value
 * meaning only "further than max" — when it is not. The band is what makes
 * the fuzzy tier affordable: only cells within `max` of the diagonal can
 * ever contribute to a result at or below `max`, so the cost is O(n·max)
 * rather than O(n·m), and a row whose cheapest cell already exceeds `max`
 * ends the computation immediately (row minima are non-decreasing).
 *
 * Exported because it is the ACCEPTANCE test for a fuzzy match:
 * `bestWindowMatch` proposes a span via a DP traceback, and this function
 * independently re-measures it. A traceback bug therefore produces an
 * orphan (visible, recoverable) instead of a highlight over the wrong
 * sentence (invisible, wrong, and attached to something the reader wrote).
 */
export function levenshtein(a: string, b: string, max: number = Number.POSITIVE_INFINITY): number {
  const m = a.length;
  const n = b.length;
  const band = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : Math.max(m, n);
  const over = band + 1;
  if (Math.abs(m - n) > band) return over;
  if (m === 0) return n <= band ? n : over;
  if (n === 0) return m <= band ? m : over;

  let prev = new Int32Array(n + 2);
  let cur = new Int32Array(n + 2);
  for (let j = 0; j <= n; j++) prev[j] = j <= band ? j : over;
  prev[n + 1] = over;

  for (let i = 1; i <= m; i++) {
    const lo = Math.max(1, i - band);
    const hi = Math.min(n, i + band);
    // Column 0 is inside the band only while `i <= band`; outside it the
    // cell must read as "further than max" so it cannot seed a cheap path.
    cur[0] = i <= band ? i : over;
    if (lo > 1) cur[lo - 1] = over;
    let rowMin = cur[0];
    const ai = a.charCodeAt(i - 1);
    for (let j = lo; j <= hi; j++) {
      const sub = prev[j - 1] + (ai === b.charCodeAt(j - 1) ? 0 : 1);
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      let v = sub < del ? sub : del;
      if (ins < v) v = ins;
      if (v > over) v = over;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (hi < n) cur[hi + 1] = over;
    if (rowMin > band) return over;
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  // Redundant defence, kept knowingly: every cell is clamped to `over` above
  // and every out-of-band cell is assigned `over`, so `prev[n] <= over` and
  // `prev[n] > band` holds exactly when `prev[n] === over` — both arms return
  // the same value. Review proved this (its mutation "drop the final guard"
  // survived, necessarily). Left in rather than deleted because it is the
  // line that makes the RETURN CONTRACT true by construction if a future
  // edit adds a path that skips the clamp; do not add a test to "kill" it,
  // there is no behaviour to kill.
  return prev[n] > band ? over : prev[n];
}

/**
 * Approximate substring search (Sellers) inside one window: finds the
 * substring of `text[from, to)` closest to `pattern`, with the start and
 * the end both free. Row 0 is all zeros, which is what "may start anywhere
 * in the window" means; a parallel row of start positions (`prevS`/`curS`)
 * carries the origin of each cell's best path, so the winning substring's
 * start can be read off the final row without a second traceback pass.
 *
 * One pass over the window replaces the naive alternative of running a
 * plain Levenshtein for every (start, length) pair in `±FUZZY_SLACK`, which
 * is ~289 full DPs for the same answer — and this version also considers
 * lengths the ±8 grid would miss.
 *
 * Returns `null` as soon as an entire row's best cell exceeds `maxDist`
 * (row minima never decrease, so nothing below `maxDist` can appear later),
 * which is what keeps a quote that simply is not in the chapter cheap.
 *
 * Ties in the final row are broken by CONTEXT, not by position, and that is
 * load-bearing rather than tidy. Equal-cost alignments are the normal case,
 * not an edge one: a quote whose last character was edited matches equally
 * well with that character included or dropped, and a quote with a word
 * inserted in the middle matches equally well starting at the real
 * beginning or a few characters in. Preferring the earliest (or the
 * shortest) alignment picks wrong about half the time, which shows up as a
 * highlight that creeps by a word or two every time the chapter is edited.
 * The stored `prefix`/`suffix` say which alignment the reader actually
 * meant; length closest to `|exact|` only settles what context cannot.
 * Pinned by the "R21" test in `anchor.test.ts` — and only since that test:
 * review replaced this `contextScore` call with a constant `0` and all 43
 * tests stayed green, so for one commit this paragraph described an
 * intention rather than a guarantee.
 *
 * That tie-break can only choose between different END positions, though —
 * two alignments that end at the same place but START in different places
 * are one cell, and which start survives is decided inside the DP. So the
 * cell-level tie-break carries the same intent: among equal-cost paths,
 * keep the one whose start is nearest `expectedStart`, the position the
 * prefix (or suffix) pointed at. Without it, "chi phí của việc tin sai"
 * re-attaches to "phí thật của việc tin sai" — same cost, same end, four
 * characters late, and the reader's highlight loses its first word. That
 * one IS pinned, by the "chèn thêm một từ vào GIỮA exact" test, which is
 * the same example; the two tie-breaks are separate decisions in separate
 * places and only one of them used to have a test.
 */
function bestWindowMatch(
  text: string,
  from: number,
  to: number,
  pattern: string,
  maxDist: number,
  prefix: string,
  suffix: string,
  expectedStart: number,
): { start: number; to: number; dist: number } | null {
  const m = pattern.length;
  const w = to - from;
  if (m === 0 || w <= 0) return null;

  let prevD = new Int32Array(w + 1);
  let prevS = new Int32Array(w + 1);
  let curD = new Int32Array(w + 1);
  let curS = new Int32Array(w + 1);
  for (let j = 0; j <= w; j++) {
    prevD[j] = 0;
    prevS[j] = from + j;
  }

  for (let i = 1; i <= m; i++) {
    curD[0] = i;
    curS[0] = from;
    let rowMin = i;
    const pi = pattern.charCodeAt(i - 1);
    for (let j = 1; j <= w; j++) {
      let best = prevD[j - 1] + (pi === text.charCodeAt(from + j - 1) ? 0 : 1);
      let bestStart = prevS[j - 1];
      let bestDrift = bestStart < expectedStart ? expectedStart - bestStart : bestStart - expectedStart;

      const del = prevD[j] + 1;
      if (del <= best) {
        const s = prevS[j];
        const drift = s < expectedStart ? expectedStart - s : s - expectedStart;
        if (del < best || drift < bestDrift) {
          best = del;
          bestStart = s;
          bestDrift = drift;
        }
      }
      const ins = curD[j - 1] + 1;
      if (ins <= best) {
        const s = curS[j - 1];
        const drift = s < expectedStart ? expectedStart - s : s - expectedStart;
        if (ins < best || drift < bestDrift) {
          best = ins;
          bestStart = s;
          bestDrift = drift;
        }
      }

      curD[j] = best;
      curS[j] = bestStart;
      if (best < rowMin) rowMin = best;
    }
    if (rowMin > maxDist) return null;
    let swap = prevD;
    prevD = curD;
    curD = swap;
    swap = prevS;
    prevS = curS;
    curS = swap;
  }

  // `prevD` now holds row `m`. Column 0 is skipped: it describes the empty
  // substring, which is never a useful anchor and would otherwise win for
  // very short patterns where `maxDist >= m`.
  let bestV = Number.POSITIVE_INFINITY;
  for (let j = 1; j <= w; j++) {
    if (prevD[j] < bestV) bestV = prevD[j];
  }
  if (bestV > maxDist) return null;

  let bestJ = -1;
  let bestScore = -1;
  let bestLenGap = Number.POSITIVE_INFINITY;
  for (let j = 1; j <= w; j++) {
    if (prevD[j] !== bestV) continue;
    const start = prevS[j];
    const end = from + j;
    if (end <= start) continue;
    const score = contextScore(text, start, end, prefix, suffix);
    const lenGap = Math.abs(end - start - m);
    if (score > bestScore || (score === bestScore && lenGap < bestLenGap)) {
      bestScore = score;
      bestLenGap = lenGap;
      bestJ = j;
    }
  }
  if (bestJ < 0) return null;
  return { start: prevS[bestJ], to: from + bestJ, dist: bestV };
}

/**
 * Where in the chapter the fuzzy tier is even willing to look.
 *
 * The quote itself is known not to be present verbatim (tier 1 already
 * failed), so the surviving evidence is its neighbourhood. Occurrences of
 * the prefix put the quote's start right after them; occurrences of the
 * suffix put it `exact.length` before them. Progressively shorter
 * prefix-tails / suffix-heads (32 → 16 → 8 characters, stopping at the
 * first length that hits anything) cover the case where the context itself
 * picked up an edit: the end adjacent to the quote is the part worth
 * trusting, and a shorter probe has fewer characters in which to have been
 * edited.
 *
 * An empty result means give up — see `fuzzyFind`.
 */
function candidateStarts(text: string, prefix: string, suffix: string, exactLen: number): number[] {
  const found = new Set<number>();
  for (const start of probe(text, prefix, true)) found.add(start);
  for (const start of probe(text, suffix, false)) found.add(start - exactLen);

  const out: number[] = [];
  for (const c of found) {
    if (c > -exactLen && c < text.length) out.push(c);
  }
  out.sort((x, y) => x - y);
  return out.length > CAND_CAP ? out.slice(0, CAND_CAP) : out;
}

/** Occurrences of the informative end of one context string: the LAST
 * `len` characters of a prefix, or the FIRST `len` of a suffix. Returns
 * raw occurrence positions plus the length used, folded into the caller's
 * arithmetic by returning `index + len` for a prefix and `index` for a
 * suffix. */
function probe(text: string, context: string, isPrefix: boolean): number[] {
  const full = Math.min(context.length, CONTEXT_LEN);
  if (full === 0) return [];
  const tried = new Set<number>();
  for (const len of [full, 16, 8]) {
    if (len <= 0 || len > full || tried.has(len)) continue;
    tried.add(len);
    const needle = isPrefix ? context.slice(context.length - len) : context.slice(0, len);
    const hits = allIndexOf(text, needle, CAND_CAP);
    if (hits.length > 0) return isPrefix ? hits.map((i) => i + len) : hits;
  }
  return [];
}

/**
 * Tier 2. Returns the projected span of the best acceptable fuzzy match, or
 * `null`.
 *
 * Two refusals are decisions, not omissions:
 *
 * 1. **No candidate ⇒ orphan, no chapter-wide scan.** If neither the quote,
 *    nor 8 characters of its prefix, nor 8 of its suffix occur anywhere,
 *    then roughly 260 consecutive characters of the chapter have changed.
 *    Scanning the whole chapter would cost O(n·m·k) — on a 19k-character
 *    chapter with a 200-character quote that is ~10^8 operations, PER
 *    ANNOTATION, while the reader waits for the page — and what it would
 *    find is the least-bad guess in a region that no longer resembles the
 *    quote. Attaching a note to the wrong sentence is worse than the orphan
 *    panel (Task 7), where the reader still has their words and can put
 *    them back. Cheap and honest beats expensive and wrong.
 *
 * 2. **Short quotes never go fuzzy.** With `max(2, ceil(0.2·m))` as the
 *    threshold, a 4-character quote would accept a match that differs in
 *    half its characters — which on a 19k chapter is not a match, it is a
 *    coincidence. Short quotes are exactly the ones the exact tier finds
 *    reliably; if it did not, the text is gone.
 *
 *    The rule is literally `m >= 4 · maxDist`, which is NOT the same as
 *    "at least 8 characters" — an earlier version of this comment said
 *    that, and it was wrong. Because `maxDist` steps up in whole edits, the
 *    admitted lengths are 8, 9, 10, then 12 and up: an 11-character quote
 *    gets `maxDist = 3`, needs 12, and is refused while both 10 and 12 are
 *    allowed. That step is an artifact of rounding, not a decision, and it
 *    is left alone deliberately — the alternative rules all move the
 *    threshold for real quote lengths too, and one refused 11-character
 *    quote (which becomes an orphan the reader can re-attach) is a smaller
 *    price than shifting the line for every length around it.
 */
function fuzzyFind(
  text: string,
  quote: { exact: string; prefix: string; suffix: string },
): { start: number; to: number } | null {
  const m = quote.exact.length;
  const maxDist = Math.max(2, Math.ceil(0.2 * m));
  if (m < 4 * maxDist) return null;

  const candidates = candidateStarts(text, quote.prefix, quote.suffix, m);
  if (candidates.length === 0) return null;

  let budget = MAX_DP_CELLS;
  let best: { start: number; to: number; dist: number; score: number } | null = null;

  for (const c of candidates) {
    const from = Math.max(0, c - FUZZY_SLACK);
    const to = Math.min(text.length, c + m + FUZZY_SLACK);
    const w = to - from;
    if (w <= 0) continue;
    const cells = (m + 1) * (w + 1);
    if (cells > budget) break;
    budget -= cells;

    const hit = bestWindowMatch(text, from, to, quote.exact, maxDist, quote.prefix, quote.suffix, c);
    if (!hit) continue;
    // Independent re-measurement of the proposed span; see `levenshtein`.
    if (levenshtein(quote.exact, text.slice(hit.start, hit.to), maxDist) > maxDist) continue;

    const score = contextScore(text, hit.start, hit.to, quote.prefix, quote.suffix);
    if (!best || hit.dist < best.dist || (hit.dist === best.dist && score > best.score)) {
      best = { start: hit.start, to: hit.to, dist: hit.dist, score };
    }
  }

  return best ? { start: best.start, to: best.to } : null;
}

/** Projected span → live `Range`. The ONLY place raw `flat` offsets are
 * touched, and the reason nothing else in this module may call `indexOf`
 * on `map.flat`. */
function materialize(
  map: NormMap,
  proj: Projection,
  from: number,
  to: number,
  fuzzy: boolean,
): { range: Range; fuzzy: boolean } | null {
  if (to <= from) return null;
  const range = flatToDom(map, proj.rawStart[from], proj.rawEnd[to - 1]);
  return range ? { range, fuzzy } : null;
}

/**
 * Finds the anchored text in a freshly normalized chapter, in three tiers:
 *
 *   1. the quote occurs verbatim — first as `prefix + exact + suffix` if
 *      that whole string is unique, otherwise by scoring each occurrence of
 *      `exact` against the stored context and keeping the best;
 *      `fuzzy: false` either way;
 *   2. otherwise `fuzzyFind` looks around the positions the context
 *      suggests and accepts a match within `max(2, ceil(0.2·|exact|))`
 *      edits; `fuzzy: true`, so a caller can show the note differently and
 *      Task 7 can offer to re-save it;
 *   3. otherwise `null` — an orphan.
 *
 * `null` is also the answer for a chapter with nothing annotatable in it,
 * for an anchor whose quote is empty or not a string, and for a span that
 * `flatToDom` refuses (see its own doc). None of THOSE throw — they are all
 * statements about the stored annotation or about the chapter, and this
 * runs during chapter render, once per stored annotation, where an
 * exception takes the page down.
 *
 * Exactly one thing here does throw, and on purpose: `StaleNormMapError`,
 * when `map` no longer describes the live DOM. That is not a statement
 * about an annotation, it is a caller bug — and it is the one Task 4 walks
 * straight into, because the obvious loop is
 * `for (const a of annotations) paint(anchorToRange(map, a))` and painting
 * the first one invalidates `map` for the rest. Measured on the real p1-5
 * with 40 anchors and one painted: two of the remaining resolutions threw
 * `IndexSizeError: Offset out of bound` from deep inside `Range.setStart`.
 * Returning `null` instead would file the reader's note in the orphan panel
 * and say nothing about why; a named error says what happened and what to
 * do. Callers that would rather ask than catch have `isMapStale(map)`.
 */
export function anchorToRange(map: NormMap, a: Anchor): { range: Range; fuzzy: boolean } | null {
  assertMapFresh(map);

  const quote = readQuote(a);
  if (!quote) return null;

  const proj = projectionFor(map);
  const text = proj.text;
  if (text.length === 0) return null;

  // Quote AND both neighbourhoods, verbatim and unique: the strongest
  // evidence there is, found in one scan. This exists for short quotes.
  // `exact` may legitimately be one or two characters (a reader
  // highlighting a single symbol), and a one-character string occurs
  // hundreds of times in a chapter — more times than the occurrence list
  // below is willing to collect, so the right one can fall off the end of
  // it and the note lands on some other letter `p`. Prefix and suffix turn
  // that into a ~65-character signature that is unique in practice.
  const context = quote.prefix + quote.exact + quote.suffix;
  if (context.length > quote.exact.length) {
    const unique = allIndexOf(text, context, 2);
    if (unique.length === 1) {
      const start = unique[0] + quote.prefix.length;
      return materialize(map, proj, start, start + quote.exact.length, false);
    }
  }

  const occurrences = allIndexOf(text, quote.exact, EXACT_CAP);
  if (occurrences.length > 0) {
    const perfect = quote.prefix.length + quote.suffix.length;
    let bestStart = occurrences[0];
    let bestScore = -1;
    for (const start of occurrences) {
      const score = contextScore(text, start, start + quote.exact.length, quote.prefix, quote.suffix);
      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
      }
      if (bestScore === perfect) break; // nothing later can beat a full match
    }
    return materialize(map, proj, bestStart, bestStart + quote.exact.length, false);
  }

  const hit = fuzzyFind(text, quote);
  if (!hit) return null;
  return materialize(map, proj, hit.start, hit.to, true);
}
