/**
 * The selection toolbar (P2 Task 5) — the button that turns four modules of
 * plumbing into a feature.
 *
 * `./normalize` flattens a chapter, `./anchor` describes a quote, `./painter`
 * colours a `Range` in and `./useAnnotations` stores it and syncs it. Until
 * this file existed, none of that could be reached by a reader: there was no
 * way to CREATE an annotation. Everything here is about the two seconds between
 * the reader letting go of the mouse and the colour appearing.
 *
 * ---------------------------------------------------------------------
 * 1. `rangeToFlat` is the only door (ruling P2-F6)
 * ---------------------------------------------------------------------
 * A `Selection` becomes offsets through `rangeToFlat`, never through two
 * `domToFlat` calls. The bias argument is the trap: forget `'end'` on the end
 * boundary and every selection that stops on a formula silently loses it, with
 * no error and no failing type check. `rangeToFlat` returning `null` means
 * there is nothing to anchor — the selection is collapsed, outside the chapter,
 * or covers nothing annotatable (a drag inside a visualization's controls) —
 * and the answer to `null` is to show no toolbar at all, not to show one whose
 * buttons quietly do nothing.
 *
 * ---------------------------------------------------------------------
 * 2. A `NormMap` is a snapshot, and painting invalidates it (ruling P2-F8)
 * ---------------------------------------------------------------------
 * Highlighting splits the text nodes a `NormMap` holds, so the map taken for
 * the FIRST note describes a tree that no longer exists by the time the reader
 * makes their second selection — and `rangeToFlat`/`selectionToAnchor` throw
 * `StaleNormMapError` rather than answer wrongly. "Highlight something, then
 * highlight something else" is this feature's most ordinary path, so the map
 * cache below is checked with `isMapStale` (the proactive form the ruling
 * prescribes) on every use, not wrapped in a `try`/`catch`.
 *
 * `isMapStale` is not sufficient on its own, and the reason is in its own doc:
 * it detects a tracked node whose LENGTH changed, not one that was DETACHED.
 * Replacing the chapter (`ChapterView` swaps `innerHTML` on the same `<div>`)
 * detaches every tracked node while leaving every length alone, so a cache
 * keyed on staleness would keep answering from a chapter that is gone. Hence
 * the cache key is `(root, revision)` AND `isMapStale`, which is exactly the
 * pair of signals `ChapterContent` was given a revision counter for.
 *
 * ---------------------------------------------------------------------
 * 3. The colour appears on the click, not on the write
 * ---------------------------------------------------------------------
 * `create` writes to IndexedDB and queues an outbox row; a live query then
 * brings the row back and `useAnnotations` resolves and paints it. That is
 * milliseconds on a good day and much more on a busy one, and none of it should
 * stand between a reader clicking yellow and seeing yellow. So this file paints
 * the highlight itself, synchronously, in the click handler, under a TEMPORARY
 * id — and when the store reports that it has settled the real row (painted it,
 * or judged it an orphan), the temporary paint is removed.
 *
 * The handover exists because the two owners cannot share an id: `useAnnotations`
 * generates it inside `create`, and painting the same id twice NESTS rather than
 * replaces (see `./painter`), which reads as one permanently-too-dark highlight.
 * The overlap between "temporary painted" and "real painted" lasts one commit
 * and shows as a slightly deeper tint; the alternative order — unpaint as soon
 * as `create` resolves — blinks the colour off and back on, which is worse, and
 * would also mean the reader sees nothing at all if the store is slow.
 *
 * If the write FAILS, the optimistic paint is removed and the reader is told.
 * Silently leaving the colour there would be a highlight that vanishes on the
 * next page load with no explanation.
 *
 * ---------------------------------------------------------------------
 * 4. Selecting to COPY must keep working
 * ---------------------------------------------------------------------
 * Readers select text to copy it at least as often as to annotate it, so this
 * component: never moves focus (no autofocus anywhere), never calls
 * `preventDefault` on a key event — `Ctrl/Cmd+C` reaches the browser untouched —
 * and closes on a click outside WITHOUT writing anything. The one
 * `preventDefault` in the file is on the toolbar's own `mousedown`, which is
 * what keeps the browser from collapsing the reader's selection (and from
 * moving focus into the toolbar) when they reach for a swatch.
 *
 * `selectionchange` is the event listened to, not `mouseup`: a reader selecting
 * with Shift+Arrow produces no mouse event at all, and a toolbar that only
 * appears for mouse users is a toolbar half the accessibility story is missing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type SelectionExcerpt, selectionExcerpt } from '../ai/prompts';
import type { MessageKey } from '../i18n';
import { useLanguage } from '../i18n/LanguageProvider';
import { type Anchor, type AnchorColor, selectionToAnchor } from './anchor';
import { isMapStale, type NormMap, normalizeContainer, rangeToFlat } from './normalize';
import { paint, unpaint } from './painter';
import type { ChapterContent, UseAnnotationsResult } from './useAnnotations';

/**
 * The part of `useAnnotations`'s result this component needs.
 *
 * A `Pick` rather than the whole interface so the dependency is legible (it
 * creates, and it watches for the store to settle what it created), and so a
 * test can hand over a three-property stub instead of a fake store. `ChapterView`
 * passes the real result, which satisfies this by structural typing — and it must
 * pass THE one it already holds: a second `useAnnotations` instance would paint
 * every annotation twice.
 */
export type ToolbarStore = Pick<UseAnnotationsResult, 'create' | 'list' | 'orphans'>;

export interface SelectionToolbarProps {
  /** The chapter DOM to watch, exactly as `useAnnotations` receives it. */
  readonly content: ChapterContent;
  readonly store: ToolbarStore;
  /**
   * Called with the new annotation's id after the "Ghi chú" button created it,
   * so the owner can open a note editor for it. That editor is Task 6's margin
   * card, which does not exist yet; until it does, "Ghi chú" is "highlight, and
   * tell me which one" and this callback is where the two tasks meet.
   */
  readonly onRequestNote?: (id: string) => void;
  /**
   * Called with the selected passage — PROJECTED, not raw — after the reader
   * pressed "Đào sâu" (hệ thống con 2, Task 8). Absent ⇒ the button is not
   * rendered at all, which is what keeps a build without the AI feature from
   * offering a control that leads nowhere.
   *
   * The projection happens HERE, in `deepDiveFrom` below, and not in the AI
   * panel, for the reason the P2 modules already paid for: this component
   * holds the chapter's ONE live `NormMap`, and a second map taken later can
   * already be stale (painting a note splits text nodes — ruling P2-F8). It
   * also puts the KaTeX knowledge in exactly one place: `ai/prompts.ts`, which
   * reuses P2's own segmentation and restores each formula's LaTeX source.
   * Reading `innerText`/`textContent` here instead would put `'￼'` — one
   * object-replacement character per formula — into the prompt.
   */
  readonly onDeepDive?: (excerpt: SelectionExcerpt) => void;
  /**
   * True while somebody ELSE owns what a selection means.
   *
   * There is exactly one such owner, Task 7's `./OrphanPanel`: while the
   * reader is putting an orphaned note back, dragging across a paragraph means
   * "the note goes here", not "make a new note". Both components listen to
   * `selectionchange` on the same document, so without this they both answer,
   * and the reader gets a colour picker on top of the thing they were trying
   * to re-anchor — with the two answers racing over the same `NormMap`.
   *
   * Reattach mode wins, and it wins here rather than in the panel, because
   * "offer nothing" is a state this component can be in safely and "ignore the
   * toolbar the reader can see" is not: a swatch that does nothing when
   * clicked is worse than no swatch. A toolbar already open when the mode
   * starts is taken down (the effect below runs its cleanup and re-runs), so
   * there is no window in which a stale toolbar can still be clicked.
   */
  readonly suspended?: boolean;
}

/** Colours in the order they are offered, matching `AnchorColor`'s own order.
 * The labels are what a screen reader announces — the swatches carry no text.
 *
 * KHOÁ, không phải chữ: bảng này là hằng số ở tầm module, dựng MỘT LẦN lúc nạp
 * — trước khi có ngôn ngữ nào được chọn. `MessageKey` bắt `tsc` kiểm rằng cả
 * bốn khoá tồn tại thật. */
const PALETTE: readonly { readonly color: AnchorColor; readonly labelKey: MessageKey }[] = [
  { color: 'y', labelKey: 'ann.color.yellow' },
  { color: 'g', labelKey: 'ann.color.green' },
  { color: 'b', labelKey: 'ann.color.blue' },
  { color: 'p', labelKey: 'ann.color.purple' },
];

/** The colour "Ghi chú" uses. The reader who wants a particular colour picks
 * one; the reader who presses "Ghi chú" is after the words, and a predictable
 * colour is worth more here than a clever one (a "last used colour" would make
 * the same button produce a different result depending on history). */
const NOTE_COLOR: AnchorColor = 'y';

/** Marks painted optimistically carry this prefix, so a leftover is
 * recognisable in the DOM rather than looking like a real annotation. */
export const PENDING_ID_PREFIX = 'pending-';

const SAVE_FAILED: MessageKey = 'ann.saveFailed';
/** How long the failure notice stays before it removes itself. */
const FAILURE_MS = 8000;

/**
 * Gap between the selection and the toolbar, in px. Kept in step with the
 * `translate(…)` in `.ann-tb`'s CSS: this constant decides whether there is
 * ROOM above, that transform decides where the box is drawn.
 */
const GAP = 8;
/** Distance from the viewport edge the toolbar refuses to come closer than. */
const EDGE = 8;
/**
 * Assumed toolbar size, used ONLY to decide when to flip below the selection
 * and how far to clamp from the window's edges.
 *
 * Deliberately an estimate rather than a measurement: measuring means rendering
 * the toolbar, reading its box and re-rendering it somewhere else, i.e. a
 * visible jump on every open, and the horizontal centring is done by CSS
 * (`translateX(-50%)`) which needs no width at all. A wrong estimate costs a
 * few pixels of clamping or a flip that happens slightly early — never a
 * toolbar in the wrong place.
 *
 * The numbers are measured, not guessed, and the measurement is why they are
 * not 220×40. Measured in Chromium with the real stylesheets: 188,67 × 34 px
 * with a mouse, and 226,67 × 42 px under `@media (pointer: coarse)` in
 * `index.css`, which grows every control. Those two are OBSERVATIONS of one
 * viewport and one font stack rather than constants of the layout — the Task 5
 * review measured 212,6 × 42 for the coarse case on an iPhone 12 emulation,
 * and a fallback font would move the width again. What the estimate must do is
 * cover the widest of them: a too-small width is the one direction that can
 * push the box past the window edge, and the coarse case is also the
 * narrow-window case. Hence, rounded up from the largest coarse measurement
 * with a few px of margin.
 *
 * Both numbers are pinned by `SelectionToolbar.test.tsx` §5b, which asserts
 * that the REAL 227 × 42 box lands inside the window and never covers the line
 * it points at — not that the constants hold particular values. The estimate
 * stays free to be a few px off; it is not free to be off by enough for a
 * reader to see.
 */
/**
 * Hệ thống con 2, Task 8 thêm nút "Đào sâu" cạnh "Ghi chú", nên ước lượng bề
 * rộng phải lớn lên theo. "Đào sâu" dài 7 ký tự so với 7 của "Ghi chú" và mang
 * đúng cùng bộ luật CSS (`.ann-tb-dive` dùng chung khai báo với `.ann-tb-note`),
 * cộng `gap: 4px` — nên phần thêm vào là bề rộng của một nút "Ghi chú" nữa,
 * lấy đúng con số đã đo cho nó ở ca `pointer: coarse` (~78 px) làm phía an
 * toàn. Sai về phía LỚN là hướng sai vô hại: nó chỉ kẹp sớm vài pixel; sai về
 * phía nhỏ mới đẩy được thanh công cụ ra ngoài mép cửa sổ.
 *
 * Nút chỉ xuất hiện khi có `onDeepDive`, nên bản dựng không có AI phải chịu
 * một ước lượng rộng hơn thực tế 78 px. Hai hằng số theo hai nhánh sẽ khiến
 * `toolbarSpot` phải nhận thêm một tham số chỉ để tiết kiệm mấy pixel kẹp —
 * đắt hơn thứ nó mua.
 */
const EST_WIDTH = 310;
const EST_HEIGHT = 44;

export interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewportLike {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly innerWidth: number;
}

/** Where the toolbar goes, in DOCUMENT coordinates. */
export interface ToolbarSpot {
  readonly left: number;
  readonly top: number;
  /** `true` when the toolbar sits below the selection because there was no
   * room above it. The CSS reads this to flip its transform. */
  readonly below: boolean;
}

/**
 * Decides where a toolbar for `rects` belongs, in DOCUMENT coordinates — the
 * same coordinate space `highlightRects` returns, and for the same reason: a
 * position expressed in viewport coordinates is correct for exactly one scroll
 * offset and drifts on every subsequent one. In document coordinates the
 * toolbar simply scrolls with the words it belongs to.
 *
 * `rects` are the selection's own client rects, in viewport coordinates and in
 * document order — one per line the selection wraps onto. The FIRST line
 * anchors a toolbar that floats above (that is where the selection starts, and
 * it is where a reader's eye is); the LAST anchors one that had to flip below,
 * so the toolbar never covers the text it belongs to.
 *
 * An empty `rects` list still produces a position rather than `null`. It means
 * "the selection is not drawn anywhere", which in a browser is close to
 * impossible for a non-collapsed selection but is the STANDARD case in jsdom,
 * which has no layout engine at all. A toolbar parked at the top of the
 * viewport is usable; a toolbar that refuses to appear is not, and it would
 * make every component test in this file green for the wrong reason.
 *
 * Pure, and exported, because this is the part with real cases in it (flip,
 * multi-line, clamping) and jsdom cannot produce a single one of them.
 */
export function toolbarSpot(rects: readonly RectLike[], view: ViewportLike): ToolbarSpot {
  const half = EST_WIDTH / 2;
  const min = EDGE + half;
  const max = view.innerWidth - EDGE - half;
  const clampX = (x: number): number => (max < min ? view.innerWidth / 2 : Math.min(Math.max(x, min), max));

  // A zero-area rect is a line break's own artefact, not a place to point at.
  const drawn = rects.filter((r) => r.width > 0 || r.height > 0);
  if (drawn.length === 0) {
    return { left: clampX(view.innerWidth / 2) + view.scrollX, top: view.scrollY + EST_HEIGHT + GAP + EDGE, below: false };
  }

  const first = drawn[0];
  const last = drawn[drawn.length - 1];
  const below = first.top < EST_HEIGHT + GAP + EDGE;
  const anchor = below ? last : first;
  return {
    left: clampX(anchor.left + anchor.width / 2) + view.scrollX,
    top: (below ? anchor.bottom : anchor.top) + view.scrollY,
    below,
  };
}

/** One optimistic paint waiting for the store to take over. */
interface Handover {
  readonly tempId: string;
  readonly realId: string;
}

/** The current selection, if it is one this chapter can anchor. `null` for a
 * caret, for a selection that starts or ends outside the chapter, and for no
 * selection at all.
 *
 * Exported for `./OrphanPanel`, which has to ask the SAME question about the
 * SAME selection — its "Gắn vào đây" and this file's swatches are two answers
 * to one drag, and a second private copy of "is this selection inside the
 * chapter" is exactly the drift the sibling modules here have already paid to
 * avoid (see `colorOf` in `./useAnnotations`). */
export function selectionRange(root: HTMLElement): Range | null {
  const selection = root.ownerDocument?.defaultView?.getSelection?.() ?? null;
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;
  if (!root.contains(range.commonAncestorContainer)) return null;
  return range;
}

function viewportOf(root: HTMLElement): ViewportLike {
  const view = root.ownerDocument?.defaultView;
  return {
    scrollX: view?.scrollX ?? 0,
    scrollY: view?.scrollY ?? 0,
    innerWidth: view?.innerWidth ?? 0,
  };
}

function rectsOf(range: Range): RectLike[] {
  if (typeof range.getClientRects !== 'function') return [];
  return Array.from(range.getClientRects());
}

/**
 * The floating toolbar a reader gets when they select text in a chapter.
 *
 * Renders into `document.body` through a portal: it is positioned in document
 * coordinates, and living inside the chapter's own container would make it a
 * child of whatever `position`/`overflow`/`transform` context the content
 * happens to have — and would put reader-owned DOM inside the element
 * `./painter` and `./normalize` walk.
 */
export function SelectionToolbar({
  content,
  store,
  onRequestNote,
  onDeepDive,
  suspended = false,
}: SelectionToolbarProps) {
  const { t } = useLanguage();
  const { create, list, orphans } = store;
  const root = content.root;
  const revision = content.revision;

  const [spot, setSpot] = useState<ToolbarSpot | null>(null);
  const [failure, setFailure] = useState<ToolbarSpot | null>(null);
  const [handovers, setHandovers] = useState<readonly Handover[]>([]);
  const barRef = useRef<HTMLDivElement | null>(null);
  /** The map for the CURRENT (root, revision), rebuilt whenever painting has
   * invalidated it. See the file doc, section 2. */
  const mapRef = useRef<{ root: HTMLElement; revision: number; map: NormMap } | null>(null);
  /** The last selection this component judged anchorable. Only a fallback: the
   * live selection is preferred at click time, because it is the browser's own
   * up-to-date answer, and a stored `Range` can be moved by a DOM change (the
   * store's deferred pass painting an overlapping note, say). */
  const lastRangeRef = useRef<Range | null>(null);

  const mapFor = useCallback((): NormMap | null => {
    if (!root) return null;
    const cached = mapRef.current;
    if (cached && cached.root === root && cached.revision === revision && !isMapStale(cached.map)) {
      return cached.map;
    }
    const map = normalizeContainer(root);
    mapRef.current = { root, revision, map };
    return map;
  }, [root, revision]);

  // ---- watch the selection ------------------------------------------------
  useEffect(() => {
    // `suspended` alongside `!root`, in the same branch, on purpose: both mean
    // "this component has no business answering a selection right now", and
    // both have to take down whatever is already on screen. Because the
    // listener is never attached in that state, there is no path by which a
    // drag made during reattach mode can leave a toolbar behind afterwards.
    if (!root || suspended) {
      setSpot(null);
      return;
    }
    const onSelectionChange = (): void => {
      const range = selectionRange(root);
      if (!range) {
        lastRangeRef.current = null;
        setSpot(null);
        return;
      }
      const map = mapFor();
      // `rangeToFlat` is the only door (see the file doc): `null` here is every
      // reason there is not to offer a toolbar, in one answer.
      if (!map || !rangeToFlat(map, range)) {
        lastRangeRef.current = null;
        setSpot(null);
        return;
      }
      lastRangeRef.current = range.cloneRange();
      setSpot(toolbarSpot(rectsOf(range), viewportOf(root)));
    };
    const doc = root.ownerDocument ?? document;
    doc.addEventListener('selectionchange', onSelectionChange);
    return () => doc.removeEventListener('selectionchange', onSelectionChange);
  }, [root, mapFor, suspended]);

  // ---- Esc, and clicking away --------------------------------------------
  useEffect(() => {
    if (!spot || !root) return;
    const doc = root.ownerDocument ?? document;
    const onKeyDown = (event: KeyboardEvent): void => {
      // Note what is NOT here: no `preventDefault`, and no key but this one is
      // even looked at. Ctrl/Cmd+C, the reader's own shortcuts and the chapter
      // pager's ArrowLeft/ArrowRight all pass through untouched.
      if (event.key === 'Escape') setSpot(null);
    };
    const onPointerDown = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && barRef.current?.contains(target)) return;
      // Closing only. A click outside is a reader dismissing the toolbar (or
      // starting a new selection), never a reason to write anything.
      setSpot(null);
    };
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('mousedown', onPointerDown, true);
    return () => {
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [spot, root]);

  // ---- hand the optimistic paint over to the store ------------------------
  const settled = useMemo(() => {
    const ids = new Set<string>();
    for (const row of list) ids.add(row.id);
    for (const row of orphans) ids.add(row.id);
    return ids;
  }, [list, orphans]);

  useEffect(() => {
    if (handovers.length === 0 || !root) return;
    const done = handovers.filter((h) => settled.has(h.realId));
    if (done.length === 0) return;
    // The store has painted the real annotation (or filed it as an orphan, in
    // which case there is nothing on the page to keep). Either way this
    // temporary layer has been replaced by the owner of painted state.
    for (const h of done) unpaint(h.tempId, root);
    setHandovers((prev) => prev.filter((h) => !settled.has(h.realId)));
  }, [handovers, settled, root]);

  // The chapter was replaced: every mark went with it, including any optimistic
  // one still waiting for its handover.
  useEffect(() => {
    setHandovers((prev) => (prev.length === 0 ? prev : []));
  }, [root, revision]);

  useEffect(() => {
    if (!failure) return;
    const handle = setTimeout(() => setFailure(null), FAILURE_MS);
    return () => clearTimeout(handle);
  }, [failure]);

  const createFrom = useCallback(
    async (color: AnchorColor, wantsNote: boolean): Promise<void> => {
      if (!root) return;
      const at = spot;
      const range = selectionRange(root) ?? lastRangeRef.current;
      setSpot(null);
      if (!range || range.collapsed || !root.contains(range.commonAncestorContainer)) return;
      const map = mapFor();
      if (!map) return;

      const anchor: Anchor | null = selectionToAnchor(map, range, color);
      // `null` is `./anchor`'s final word — a selection with no quotable text in
      // it. Storing something anyway would store a note that can never be found
      // again.
      if (!anchor) return;

      const tempId = `${PENDING_ID_PREFIX}${crypto.randomUUID()}`;
      // The whole point of this task, in one line: the colour is on the page
      // before anything is written anywhere.
      paint(range, tempId, color);
      // The map now describes a tree that no longer exists; `mapFor` will
      // notice (`isMapStale`) and rebuild on the next selection.
      lastRangeRef.current = null;
      root.ownerDocument?.defaultView?.getSelection?.()?.removeAllRanges();

      try {
        const id = await create(anchor, '');
        setHandovers((prev) => [...prev, { tempId, realId: id }]);
        if (wantsNote) onRequestNote?.(id);
      } catch (error) {
        console.error('SelectionToolbar: could not store the annotation', error);
        unpaint(tempId, root);
        setFailure(at ?? { left: 0, top: 0, below: false });
      }
    },
    [root, spot, mapFor, create, onRequestNote],
  );

  /**
   * "Đào sâu": hand the passage up, write nothing.
   *
   * Deliberately NOT a variant of `createFrom`. That function's whole shape —
   * optimistic paint, temp id, handover to the store, failure toast — exists
   * because it WRITES. This one asks a question about text; there is no
   * annotation, nothing to roll back, and no reason for a reader's question to
   * leave a highlight behind on their chapter.
   *
   * The selection is left alone for the same reason: `createFrom` clears it
   * because the paint it just made is the new visual answer, whereas here the
   * reader's own selection is still the subject of the panel that is opening.
   */
  const deepDiveFrom = useCallback((): void => {
    if (!root || !onDeepDive) return;
    const range = selectionRange(root) ?? lastRangeRef.current;
    setSpot(null);
    if (!range || range.collapsed || !root.contains(range.commonAncestorContainer)) return;
    const map = mapFor();
    if (!map) return;
    // `null` is `selectionExcerpt`'s final word — a selection with no quotable
    // text in it (a drag that landed entirely inside a visualization, say).
    // Opening a panel about nothing is worse than not opening one.
    const excerpt = selectionExcerpt(map, range);
    if (!excerpt) return;
    onDeepDive(excerpt);
  }, [root, mapFor, onDeepDive]);

  if (!root) return null;

  const doc = root.ownerDocument ?? document;
  return createPortal(
    <>
      {spot && (
        <div
          ref={barRef}
          className={`ann-tb${spot.below ? ' ann-tb-below' : ''}`}
          style={{ left: `${spot.left}px`, top: `${spot.top}px` }}
          role="toolbar"
          aria-label={t('ann.toolbarAria')}
          // Keeps the reader's selection alive across the click and keeps focus
          // where it was — the browser would otherwise collapse the selection
          // and focus the button. Deliberately on the container, so it covers
          // every control at once and cannot be forgotten on a new one.
          onMouseDown={(event) => event.preventDefault()}
        >
          {PALETTE.map(({ color, labelKey }) => (
            <button
              key={color}
              type="button"
              className={`ann-tb-swatch ann-${color}`}
              data-color={color}
              aria-label={t(labelKey)}
              title={t(labelKey)}
              onClick={() => {
                void createFrom(color, false);
              }}
            />
          ))}
          <button
            type="button"
            className="ann-tb-note"
            onClick={() => {
              void createFrom(NOTE_COLOR, true);
            }}
          >
            {t('ann.note')}
          </button>
          {onDeepDive && (
            <button type="button" className="ann-tb-dive" onClick={deepDiveFrom}>
              {t('ann.deepDive')}
            </button>
          )}
        </div>
      )}
      {failure && (
        <div
          className="ann-tb-error"
          role="alert"
          style={{ left: `${failure.left}px`, top: `${failure.top}px` }}
        >
          <span>{t(SAVE_FAILED)}</span>
          <button type="button" aria-label={t('ann.dismissAlert')} onClick={() => setFailure(null)}>
            ×
          </button>
        </div>
      )}
    </>,
    doc.body,
  );
}

export default SelectionToolbar;
