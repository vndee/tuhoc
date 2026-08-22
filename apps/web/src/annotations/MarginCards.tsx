/**
 * The margin cards (P2 Task 6) — the shape the whole phase was asked for, in
 * the user's own first sentence: *"tôi cũng cần phần highlight comment 1 đoạn
 * văn bản, tận dụng phần khoảng trống phía bên phải màn hình để hiển thị
 * comment"*. Tasks 1–5 built a flattener, an anchor, a painter, a store and a
 * toolbar; none of them put a single word of a reader's note on the screen.
 * This does.
 *
 * ---------------------------------------------------------------------
 * 1. Where this component lives, and why not in `shell/Rail.tsx`
 * ---------------------------------------------------------------------
 * `shell/Rail.tsx` returns `null` on a chapter route (ruling P2-F1): on those
 * routes `ChapterView` portals its own rail content into `#rail`, because the
 * rail's contents are derived from the chapter's own DOM, which `<Rail>` has
 * no access to. So the two tabs ("Trong chương" / "Ghi chú") are built inside
 * ChapterView's portal, and this component is rendered there — building them
 * in `Rail.tsx` would render the rail twice, which is the exact bug P1's Task
 * 11 hit and solved by making the rail route-aware.
 *
 * ---------------------------------------------------------------------
 * 2. Document coordinates, measured imperatively, never in React state
 * ---------------------------------------------------------------------
 * `highlightRects` answers in DOCUMENT coordinates (Task 3's ruling, and its
 * own doc explains why: a viewport-coordinate card is correct at exactly one
 * scroll offset and drifts at every other). Everything here stays in that
 * space: a card's `top` is `rect.top - originY`, where `originY` is the card
 * column's own document Y. Scrolling therefore changes nothing and is NOT a
 * re-measure trigger — the plan's "resize/scroll → re-measure" is half right,
 * and re-measuring on scroll would be pure cost plus a chance to desynchronise
 * from the coordinate space. What DOES move a highlight is a re-layout:
 * window resize, a `<details>` opening or closing, a font or image arriving.
 * Those are the triggers below, throttled to one animation frame.
 *
 * The measured positions are written straight onto the DOM (`el.style.top`)
 * instead of going through React state, and that is deliberate: measuring a
 * card's height requires it to be rendered, so a state-based version is a
 * render → measure → render loop by construction, and the guard against it
 * ("only setState when the numbers changed") is the kind of thing that works
 * until a fractional pixel makes it oscillate. Nothing here can loop: the
 * measure pass reads layout and writes `style.top`, and `style.top` on an
 * absolutely-positioned card cannot change what it measured.
 *
 * ---------------------------------------------------------------------
 * 3. A note inside a collapsed "Chứng minh" block is ORDINARY
 * ---------------------------------------------------------------------
 * `highlightRects` returns an EMPTY ARRAY for a highlight that exists but is
 * not drawn, and the corpus makes that the common case rather than a corner:
 * 255 `<details class="deriv">` blocks, not one of them `open` on load, and
 * 19 of p1-5's 33 paragraphs inside one. Those are the "Chứng minh"/"Lời
 * giải" bodies — where a reader annotates most.
 *
 * 33, not the 48 an earlier draft of this comment claimed. p1-5 has 33 `<p>`
 * (in the rendered DOM and in `chapters/p1-5.html` alike), 11 `<li>`, and 6
 * `<details>`, none of them `open`. Counted twice from opposite ends and the
 * two counts agree; the ratio the corrected number gives is 58%, i.e. STRONGER
 * than the 40% the wrong one implied.
 *
 * So a card gets one of three anchors, recorded on the element as
 * `data-anchor-kind` so the CSS (and a person debugging in the inspector) can
 * see which:
 *
 *   - `rect`    — the highlight is drawn; the card aligns to its first line.
 *   - `details` — the highlight is inside a collapsed block; the card aligns
 *                 to the COLLAPSED BLOCK's own box, which is what the reader
 *                 sees at that spot, and says "Đang thu gọn". Clicking it
 *                 opens the block and scrolls to the highlight.
 *   - `none`    — painted, but with no box anywhere (a highlight over the
 *                 whitespace between two blocks). It keeps its place in the
 *                 column, directly under the previous card, rather than
 *                 disappearing: a note the reader cannot find is a note they
 *                 have lost.
 *
 * Aligning to the collapsed block rather than dropping the card is the whole
 * decision here. The alternative — a separate "hidden notes" list at the
 * bottom — was rejected because it splits one column into two places to look,
 * and because the block's own box IS the right position: it is where that
 * text is on the page right now.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type LocalStorageKey, readLocalStorage, writeLocalStorage } from '../db/local';
import { useLanguage } from '../i18n/LanguageProvider';
import { type CardMeasure, DEFAULT_GAP, layoutCards } from './layout';
import { highlightElements, highlightRects } from './painter';
import { PENDING_ID_PREFIX } from './SelectionToolbar';
import { type Ann, type ChapterContent, colorOf, quoteOf, type UseAnnotationsResult } from './useAnnotations';

/**
 * The card the reader currently has open, and whether the keyboard should be
 * put in it.
 *
 * `edit: true` means "the reader asked for the editor" — the toolbar's "Ghi
 * chú" button, or a click on the card itself — and the note field takes focus.
 * `edit: false` is a click on the HIGHLIGHT: the card opens and scrolls into
 * view, but focus stays in the page, because stealing it from someone who was
 * reading is a way to lose their place.
 *
 * Owned by `ChapterView` rather than by this component, because Task 5's
 * toolbar has to be able to open a card for a note it just created, and that
 * callback (`onRequestNote`) arrives at the parent.
 */
export interface CardFocus {
  readonly id: string;
  readonly edit: boolean;
}

/** The part of `useAnnotations`'s result this component needs — a `Pick` for
 * the same reason `ToolbarStore` is one: the dependency stays legible, and
 * `ChapterView` satisfies it with THE one store instance it already holds. A
 * second `useAnnotations` would paint every annotation twice.
 *
 * `orphans` is in here for exactly one line of output, and it earns its place:
 * the empty state below says "Chưa có ghi chú nào trong chương này", which is
 * a claim about the CHAPTER, not about this column. Task 7 put an orphan list
 * directly underneath, so without this the reader can be told they have no
 * notes with two of their own notes printed an inch below. Seen on the real
 * page, not in a test — every fixture that had orphans also had this component
 * out of frame. */
export type MarginCardsStore = Pick<UseAnnotationsResult, 'list' | 'orphans' | 'updateNote' | 'remove'>;

export interface MarginCardsProps {
  /** The chapter DOM, exactly as `useAnnotations` receives it. */
  readonly content: ChapterContent;
  readonly store: MarginCardsStore;
  /** Whether the rail is currently showing the "Ghi chú" tab. When false the
   * column is not built — but this component stays mounted, because a click
   * on a highlight still has to be able to open a card (and, on a narrow
   * screen, the sheet), and the rail's tab has nothing to do with that. */
  readonly visible: boolean;
  readonly focus: CardFocus | null;
  readonly onFocusChange: (focus: CardFocus | null) => void;
}

/**
 * Below this width `reader.css` hides `#rail` outright
 * (`@media (max-width:1240px){#rail{display:none}}`), so there is no column to
 * put cards in and the bottom sheet takes over.
 *
 * 1241, not 1240, and the extra pixel is not a rounding error: `max-width:
 * 1240px` MATCHES at exactly 1240, so a JS check of `>= 1240` would claim a
 * column at the one width where the CSS has already taken it away — one pixel
 * wide, and the reader gets neither cards nor sheet.
 */
export const WIDE_MIN_PX = 1241;
const WIDE_QUERY = `(min-width: ${WIDE_MIN_PX}px)`;

/** How long after the last keystroke the note is written. Long enough that
 * typing a sentence is one write and one outbox row rather than forty.
 *
 * This number is NOT what protects the reader's words — an earlier version of
 * this comment claimed it was ("short enough that a reader who closes the tab
 * mid-thought loses nothing they would notice"), and a browser measurement
 * showed that claim was false: typing a note and reloading 0 ms or 400 ms
 * later lost the WHOLE note, silently, leaving a highlight whose card read
 * "(chưa có nội dung)". What protects it is that every way out flushes
 * first — blur, closing the card, unmounting, and (see `useEffect` below) the
 * page itself going away. This is a ceiling on how long a write can be
 * DEFERRED while the reader is still there, not a bound on what they can
 * lose. */
const WRITE_DEBOUNCE_MS = 600;

/**
 * Where the note being typed right now is kept so that nothing can lose it.
 *
 * This exists because of a measurement, not a worry. Three IndexedDB write
 * shapes were raced against four ways a page can go away, in real Chromium:
 *
 * | how the page went away | `put` straight from the handler | read-then-`put` (what the store does) |
 * |---|---|---|
 * | tab closed             | committed | committed |
 * | reloaded (F5)          | **lost**  | **lost**  |
 * | followed a link out    | **lost**  | **lost**  |
 * | hidden, then reloaded  | **lost**  | **lost**  |
 *
 * So "flush harder on the way out" cannot be the whole answer: on a same-tab
 * navigation the browser discards transactions opened during unload no matter
 * how early they are issued, and `updateNote` is a read-modify-write, the
 * shape with the least chance of all. `localStorage` survived every one of the
 * four, because writing it is synchronous — it is done before the handler
 * returns, not scheduled.
 *
 * So the draft is stamped here on EVERY keystroke, and the durable write to
 * Dexie stays debounced. Not on unload only, deliberately: the lesson of this
 * bug is that enumerating the ways out is what failed (nobody listed Cmd+W),
 * and a draft that is already safe before anything happens does not need the
 * list to be complete — it also covers the exits that fire no event at all, a
 * crash or an out-of-memory tab kill on a phone.
 *
 * ONE slot, not one per note: exactly one card is open at a time in a tab (see
 * `editorRef`), so one slot holds everything a tab can be in the middle of.
 * The known limitation, written down rather than designed around: two tabs
 * typing two different notes share this slot, and the tab that stamps second
 * wins it. The loser still writes its note normally through every other path
 * (blur, closing the card, leaving the chapter, closing the tab) — what it
 * gives up is only the recovery of its last few hundred milliseconds, and only
 * if it dies by reload. A key per note would close that, at the price of an
 * unbounded set of keys to expire; this is the cheaper end of that trade and
 * the reason is here so the next person can re-decide it.
 *
 * The key itself is DECLARED in `db/local.ts`, not here, and is classified
 * there as user content. That is deliberate and it is the whole lesson of
 * this mechanism's own follow-up bug: this is a per-BROWSER slot holding one
 * person's private words, so the thing that empties this browser for the next
 * person has to know it exists. Alias, not a second definition — one string,
 * one owner.
 */
export const DRAFT_KEY: LocalStorageKey = 'itbook-note-draft';

interface StashedDraft {
  readonly id: string;
  readonly text: string;
}

/** Reads the slot. The defensive part (localStorage throws in private mode and
 * wherever storage is disabled) lives in `readLocalStorage`; what is left here
 * is this component's own shape check, because the stored JSON is as much an
 * unknown as anything else that outlived a page. */
function readStash(): StashedDraft | null {
  const raw = readLocalStorage(DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const { id, text } = (parsed ?? {}) as { id?: unknown; text?: unknown };
    return typeof id === 'string' && typeof text === 'string' ? { id, text } : null;
  } catch {
    return null;
  }
}

function writeStash(draft: StashedDraft | null): void {
  writeLocalStorage(DRAFT_KEY, draft === null ? null : JSON.stringify(draft));
}

/**
 * The tie's geometry, in px, kept here rather than in CSS because the lane is
 * per-card and the measure pass is already writing to these elements.
 *
 * `TIE_REACH` is how far left of the card column a tie's horizontal segment
 * starts — the same 18px the stylesheet used before lanes existed, so the
 * whole set still lives inside the gutter and never crosses into the 18px a
 * `.fig` bleeds into it above 1100px. `TIE_LANE_PX` × `TIE_LANES` must stay
 * within `TIE_REACH`: four lanes, 4px apart, put the last vertical at -12 and
 * still leave its horizontal 6px of run.
 */
const TIE_REACH = 18;
const TIE_LANE_PX = 4;
const TIE_LANES = 4;

/** How much of the highlighted text a card shows above the note. The cut
 * itself lives in `./useAnnotations`'s `quoteOf`, shared with the orphan
 * panel — this is only this surface's budget. */
const QUOTE_MAX = 120;

/** Two formatters rather than one with four fields, because ICU's vi-VN
 * pattern for the combined form puts the CLOCK first ("02:58 21-08", measured
 * in Chromium) — which reads as a time somebody typed wrong. Date then time,
 * explicitly. The machine-readable value is on the `<time datetime>`
 * attribute either way. */
const DAY_FORMAT = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' });
const CLOCK_FORMAT = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });

type AnchorKind = 'rect' | 'details' | 'none';

interface AnchorPoint {
  /** Y in the card column's own coordinate space (px below its top). */
  readonly y: number;
  readonly kind: AnchorKind;
}

function shortTime(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const when = new Date(at);
  return `${DAY_FORMAT.format(when)} · ${CLOCK_FORMAT.format(when)}`;
}

/**
 * Where one annotation's card should point, in the column's coordinates.
 *
 * The `highlightRects` / `highlightElements` PAIR is what distinguishes the
 * three states — that pairing is the documented way to tell "not drawn right
 * now" from "no such annotation", and it is why this is not simply
 * `rects[0]?.top ?? fallback`.
 */
function anchorFor(id: string, root: HTMLElement, originY: number, scrollY: number, fallbackY: number): AnchorPoint {
  const rects = highlightRects(id, root);
  if (rects.length > 0) return { y: rects[0].top - originY, kind: 'rect' };

  const first = highlightElements(id, root)[0];
  const collapsed = first?.closest('details:not([open])') ?? null;
  if (collapsed) {
    return { y: collapsed.getBoundingClientRect().top + scrollY - originY, kind: 'details' };
  }
  return { y: fallbackY, kind: 'none' };
}

function sameKinds(a: ReadonlyMap<string, AnchorKind>, b: ReadonlyMap<string, AnchorKind>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, kind] of a) if (b.get(id) !== kind) return false;
  return true;
}

/** Opens every collapsed block around `el`, innermost first, so the highlight
 * inside it can actually be looked at. Returns `el` for chaining. */
function revealBlocks(el: Element): Element {
  let block: Element | null = el.closest('details:not([open])');
  while (block) {
    (block as HTMLDetailsElement).open = true;
    block = block.parentElement?.closest('details:not([open])') ?? null;
  }
  return el;
}

/** True while the rail column exists at all. Falls back to `innerWidth` where
 * `matchMedia` does not exist — jsdom 30 is one such place, and the fallback
 * is what lets the mobile branch be tested at all. */
function isWide(view: Window): boolean {
  if (typeof view.matchMedia === 'function') return view.matchMedia(WIDE_QUERY).matches;
  return view.innerWidth >= WIDE_MIN_PX;
}

/**
 * True while `#rail` exists, kept current as the window is resized.
 *
 * Exported for `./OrphanPanel`, which asks the same question for the opposite
 * reason: this component builds a card column only when the rail is there,
 * that one puts up a "your notes are waiting on a wider screen" signal only
 * when it is not. A second copy of the breakpoint would be a pair of rules
 * that can disagree at exactly one pixel — the same class of drift
 * `ATOMIC_SELECTOR` and `selectionRange` are each shared to avoid.
 */
export function useWideRail(): boolean {
  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? true : isWide(window)));
  useEffect(() => {
    const update = (): void => setWide(isWide(window));
    update();
    window.addEventListener('resize', update);
    const query = typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY) : null;
    query?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      query?.removeEventListener?.('change', update);
    };
  }, []);
  return wide;
}

export function MarginCards({ content, store, visible, focus, onFocusChange }: MarginCardsProps) {
  const { t } = useLanguage();
  const { list, orphans, updateNote, remove } = store;
  const root = content.root;
  const revision = content.revision;
  const wide = useWideRail();
  const focusId = focus?.id ?? null;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const tieRefs = useRef(new Map<string, HTMLElement>());
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  /** The rows, readable from callbacks that must not be re-created on every
   * store emission (the same plain-assignment-during-render pattern
   * `ChapterView` uses for its heartbeat context). */
  const rowsRef = useRef<readonly Ann[]>(list);
  rowsRef.current = list;

  const byId = useMemo(() => new Map(list.map((row) => [row.id, row] as const)), [list]);

  /** How each card is anchored, published by the measure pass. Empty until
   * the first one runs; `rect` is the default because it is the quiet one —
   * a card that flashed "Đang thu gọn" for one frame on every chapter open
   * would be worse than one that shows the badge one frame late. */
  const [kinds, setKinds] = useState<ReadonlyMap<string, AnchorKind>>(() => new Map());

  // ---- the note being edited ----------------------------------------------
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** What was last handed to `updateNote`. The `row.note === pending.text`
   * guard below cannot stand in for this: `row` comes from `list`, and `list`
   * does not re-emit between a `visibilitychange` and the `pagehide` that
   * follows it milliseconds later — so without this, one tab close costs two
   * Dexie writes and two outbox rows, i.e. two sync round trips, for one note.
   * Cleared when the write fails, so a later flush retries rather than
   * believing a note was stored that was not. */
  const writtenRef = useRef<{ id: string; text: string } | null>(null);

  const flush = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = draftRef.current;
    if (!pending) return;
    const row = rowsRef.current.find((r) => r.id === pending.id);
    // Nothing to write when the text is unchanged — `updateNote` would still
    // stamp `updatedAt` and queue an outbox row, i.e. a sync round trip for
    // opening a card and closing it again.
    if (!row || row.note === pending.text) return;
    const written = writtenRef.current;
    if (written !== null && written.id === pending.id && written.text === pending.text) return;
    writtenRef.current = { id: pending.id, text: pending.text };
    void updateNote(pending.id, pending.text)
      .then(() => {
        // Only now: while the write is in flight the stash is still the only
        // copy that survives a reload, and clearing it first would open the
        // very window this whole mechanism exists to close.
        const current = readStash();
        if (current && current.id === pending.id && current.text === pending.text) writeStash(null);
      })
      .catch((error: unknown) => {
        writtenRef.current = null;
        console.error('MarginCards: could not store the note', error);
      });
  }, [updateNote]);

  /**
   * The other half of `DRAFT_KEY`: a draft that outlived its page gets written
   * through as soon as the note it belongs to is on screen.
   *
   * Keyed on `list` because the row has to exist before it can be patched, and
   * it arrives asynchronously (Dexie live query → resolve → paint). Rows from
   * OTHER chapters are left alone rather than cleaned up: one shared slot means
   * a draft this chapter does not recognise probably belongs to a chapter that
   * has not been opened yet, and deleting it would be exactly the silent data
   * loss this is here to end.
   *
   * `honoured` because `list` emits again on the store's own write of this very
   * note, and a second `updateNote` for the same text would be a second outbox
   * row — the same trap `flush`'s `writtenRef` guards.
   */
  const recoveredRef = useRef<string | null>(null);
  useEffect(() => {
    const stash = readStash();
    if (!stash) return;
    const row = list.find((candidate) => candidate.id === stash.id);
    if (!row) return;
    if (row.note === stash.text) {
      writeStash(null);
      return;
    }
    const token = `${stash.id} ${stash.text}`;
    if (recoveredRef.current === token) return;
    recoveredRef.current = token;
    void updateNote(stash.id, stash.text)
      .then(() => {
        const current = readStash();
        if (current && current.id === stash.id && current.text === stash.text) writeStash(null);
      })
      .catch((error: unknown) => {
        recoveredRef.current = null;
        console.error('MarginCards: could not restore the note that was being typed', error);
      });
  }, [list, updateNote]);

  // A card opening (or closing) loads the draft from the row. Deliberately
  // keyed on the id ALONE: re-reading it whenever `list` emits would throw
  // away what the reader is typing every time the store publishes — including
  // on the store's own write of this very note.
  useEffect(() => {
    if (!focusId) {
      setDraft(null);
      return;
    }
    setDraft({ id: focusId, text: rowsRef.current.find((row) => row.id === focusId)?.note ?? '' });
  }, [focusId]);

  // Leaving the card, and unmounting, both write immediately.
  useEffect(() => {
    return () => flush();
  }, [focusId, flush]);

  /**
   * The page going away is a write deadline, and the debounce above had no
   * answer for it. Measured on Chromium, through the real user path (select →
   * "Ghi chú" → type → reload): waiting 0 ms lost the note, 400 ms lost the
   * note, 800 ms kept it. In-app navigation was always safe — the cleanup
   * above sees that — so the hole was HARD unload only: Cmd+W, F5, a link out
   * of the app, quitting the browser. What survived was a highlight whose card
   * said "(chưa có nội dung)", with no warning and no recoverable draft.
   *
   * `visibilitychange` → `hidden` AND `pagehide`, both, and deliberately NOT
   * `beforeunload`:
   *
   *   - `visibilitychange` is the one that matters on a phone. iOS and Android
   *     discard a backgrounded tab without ever running `pagehide` or
   *     `beforeunload`, so anything that waits for those loses the note on the
   *     commonest mobile exit there is — switching apps. It also fires on an
   *     ordinary tab switch, well before anything is torn down, so in practice
   *     the note is usually already stored long before the tab is really
   *     closed.
   *   - `pagehide` covers the desktop shape `visibilitychange` does not
   *     guarantee to precede: a window closed, or navigated away from, while it
   *     is still the visible one. Firing both for one exit costs nothing —
   *     `writtenRef` makes the second call a no-op.
   *   - `beforeunload` is absent on purpose. It does not fire on mobile, it
   *     disqualifies the page from the back/forward cache, and it adds nothing
   *     the two above do not already cover.
   *
   * Not gated on `visible`/`wide`: below 1241px the bottom sheet edits the same
   * draft through the same `flush`, and a reader on a phone is exactly who this
   * is for.
   */
  useEffect(() => {
    const doc = root?.ownerDocument ?? document;
    const view = doc.defaultView ?? window;
    const onVisibility = (): void => {
      if (doc.visibilityState === 'hidden') flush();
    };
    const onPageHide = (): void => flush();
    doc.addEventListener('visibilitychange', onVisibility);
    view.addEventListener('pagehide', onPageHide);
    return () => {
      doc.removeEventListener('visibilitychange', onVisibility);
      view.removeEventListener('pagehide', onPageHide);
    };
  }, [root, flush]);

  // The reader asked for the editor (toolbar "Ghi chú", or a click on the
  // card). `focus` is a fresh object on every request, so asking twice for the
  // same card focuses it twice — which is what a second click should do.
  //
  // `list` is in the deps and `honoured` is what makes that safe. The toolbar
  // path arrives EARLY: "Ghi chú" creates the row and asks for its card in the
  // same tick, but that card cannot exist until the row has travelled through
  // Dexie's live query and been resolved and painted — several commits later.
  // A focus effect keyed on `focus` alone runs once, finds no textarea, and
  // the reader is handed an editor they then have to click. Re-running it on
  // every store emission fixes that and introduces the opposite bug — focus
  // yanked back into the note while they are typing somewhere else — so each
  // request is honoured exactly once.
  const honouredRef = useRef<CardFocus | null>(null);
  useEffect(() => {
    if (!focus?.edit || honouredRef.current === focus) return;
    const box = editorRef.current;
    if (!box) return;
    honouredRef.current = focus;
    box.focus();
    const end = box.value.length;
    box.setSelectionRange?.(end, end);
  }, [focus, list]);

  // ---- the highlight ↔ card link (both directions) ------------------------
  const reveal = useCallback(
    (id: string): void => {
      if (!root) return;
      const first = highlightElements(id, root)[0];
      if (!first) return;
      revealBlocks(first).scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    },
    [root],
  );

  useEffect(() => {
    if (!root) return;
    const onClick = (event: Event): void => {
      const target = event.target as Element | null;
      const painted = target?.closest?.('[data-ann-id], [data-ann-ids]') ?? null;
      if (!painted) return;
      const single = painted.getAttribute('data-ann-id');
      // A formula covered by several notes keeps every id in one attribute and
      // shows the LAST one's colour, so the last one is the note the reader
      // just clicked on.
      const id = single ?? (painted.getAttribute('data-ann-ids') ?? '').split(' ').filter(Boolean).pop() ?? '';
      // The toolbar's optimistic paint has no row and no card yet.
      if (!id || id.startsWith(PENDING_ID_PREFIX) || !byId.has(id)) return;
      onFocusChange({ id, edit: false });
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [root, byId, onFocusChange]);

  // The focused annotation is outlined in the text. Re-applied when the store
  // repaints (`list` identity changes), because an unpaint/repaint replaces
  // the very elements this class was put on.
  useEffect(() => {
    if (!root || !focusId) return;
    const els = highlightElements(focusId, root);
    for (const el of els) el.classList.add('focus');
    return () => {
      for (const el of els) el.classList.remove('focus');
    };
  }, [root, focusId, list, revision]);

  // ---- measurement --------------------------------------------------------
  const measure = useCallback((): void => {
    const host = hostRef.current;
    if (!host || !root) return;
    const view = root.ownerDocument?.defaultView ?? window;
    const scrollY = view.scrollY ?? 0;
    const originY = host.getBoundingClientRect().top + scrollY;

    const measures: CardMeasure[] = [];
    const anchors: AnchorPoint[] = [];
    const nextKinds = new Map<string, AnchorKind>();
    let previousY = 0;
    for (const row of rowsRef.current) {
      const card = cardRefs.current.get(row.id);
      if (!card) continue;
      const anchor = anchorFor(row.id, root, originY, scrollY, previousY);
      previousY = anchor.y;
      nextKinds.set(row.id, anchor.kind);
      anchors.push(anchor);
      measures.push({ id: row.id, y: anchor.y, height: card.getBoundingClientRect().height });
    }

    const placed = layoutCards(measures, DEFAULT_GAP);
    let bottom = 0;
    for (let i = 0; i < placed.length; i++) {
      const card = cardRefs.current.get(placed[i].id);
      if (card) card.style.top = `${placed[i].top}px`;
      const tie = tieRefs.current.get(placed[i].id);
      if (tie) {
        tie.style.top = `${anchors[i].y}px`;
        // +1 so a card sitting exactly at its anchor still draws the
        // horizontal hairline rather than a zero-height box.
        tie.style.height = `${Math.max(1, placed[i].top - anchors[i].y + 1)}px`;
        // The lane. Every tie used to drop its vertical at the column's own
        // left edge, so in a cluster the five of them stacked into ONE
        // continuous rule — measured on the real page, and the eye sees a
        // single line, not five. That is the tie failing precisely where it is
        // needed most. Spreading them across the gutter by index turns the
        // cluster back into N brackets, all sharing a left edge at -TIE_REACH
        // so the row of horizontals still reads as one column of departures.
        const reach = TIE_REACH - (i % TIE_LANES) * TIE_LANE_PX;
        tie.style.left = `${-TIE_REACH}px`;
        tie.style.width = `${reach}px`;
      }
      bottom = Math.max(bottom, placed[i].top + measures[i].height);
    }

    // The one measurement that goes back into React, because it is the one a
    // card RENDERS from: an anchor kind decides whether the card carries the
    // "Đang thu gọn" badge (and the dashed tie), and a badge changes the
    // card's height.
    //
    // This is not the render → measure → render loop the file doc rejects for
    // positions. A kind is discrete and cannot be changed by anything this
    // pass does: moving a card inside the rail cannot make a `<mark>` in the
    // content gain or lose a rect (the rail is a flex SIBLING of `#content`,
    // so it does not reflow it). The pass therefore converges in exactly one
    // extra round — measure, publish kinds, measure again, publish nothing —
    // and `sameKinds` is what makes "publish nothing" true rather than
    // merely likely.
    setKinds((previous) => (sameKinds(previous, nextKinds) ? previous : nextKinds));
    // The column is a stack of absolutely-positioned cards, so it has no
    // height of its own — and `#rail` is `align-self:flex-start`, so without
    // this the aside collapses and its own sticky tab bar has no box to stick
    // inside. Cleared when there are no cards, so the empty-state paragraph
    // is not squeezed into a 0px box.
    host.style.height = placed.length > 0 ? `${bottom}px` : '';
  }, [root]);

  // Runs on every commit that could have changed either input: the note list,
  // which card is open (the editor makes a card taller), and the chapter
  // itself. `useLayoutEffect` so the browser never paints a frame with the
  // cards stacked at the top of the column.
  useLayoutEffect(() => {
    measure();
  }, [measure, list, focusId, draft, visible, wide, revision, kinds]);

  // Re-measure when the PAGE moves under the cards. Not on scroll — see the
  // file doc, section 2.
  useEffect(() => {
    if (!root || !visible || !wide) return;
    const view = root.ownerDocument?.defaultView ?? window;
    let frame = 0;
    const schedule = (): void => {
      if (frame) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    view.addEventListener('resize', schedule);
    // `toggle` (a <details> opening) and `load` (an image or a figure
    // arriving) do not BUBBLE — the capture phase is the only way to hear
    // them from the chapter root.
    root.addEventListener('toggle', schedule, true);
    root.addEventListener('load', schedule, true);
    const fonts = (root.ownerDocument as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    void fonts?.ready?.then(schedule).catch(() => {});
    return () => {
      view.removeEventListener('resize', schedule);
      root.removeEventListener('toggle', schedule, true);
      root.removeEventListener('load', schedule, true);
      if (frame) view.cancelAnimationFrame(frame);
    };
  }, [root, measure, visible, wide]);

  // NOTHING here scrolls the column, and that is the fix for the one thing
  // measurement showed this feature getting wrong on a real page.
  //
  // There used to be a `cardRefs.current.get(focusId)?.scrollIntoView({block:
  // 'nearest'})` on this line, whose stated job was "a card opened from a click
  // on its highlight has to be brought into view". On Chromium, with a cluster
  // of notes in one paragraph and the reader looking at their own highlight in
  // the middle of the screen, clicking it moved the page from about six notes
  // onward, and from about fifteen the move pushed the highlight they had just
  // clicked clean off the top of the screen (at twenty: y=-224). Both
  // directions of the "two-way" link ended at the same scroll position, so the
  // link only ever really went one way: the card always won.
  //
  // That contradicted this component's own rule, three screens up, that
  // `edit:false` must not steal a reader's place. It stole the place instead of
  // the caret, which is the same loss.
  //
  // Clamping the scroll so the highlight stays visible was tried on paper and
  // is worse: at twenty notes it moves the page as far as it is allowed and
  // STILL cannot get the card on screen, so the reader pays the disorientation
  // and gets nothing. Doing nothing is right. What the reader gets instead is
  // the card's open state, the highlight's own outline, and the tie — which is
  // why the tie's contrast and its per-card lane (see `measure`) are part of
  // the same change rather than a cosmetic afterthought.
  //
  // The two `edit:true` paths were never this effect's job and are already
  // covered: `openCard` calls `reveal`, which scrolls the HIGHLIGHT to centre,
  // and the toolbar path's `box.focus()` brings the editor into view by itself.

  /**
   * Which card the reader is pointing at, or has tabbed to — and its highlight
   * and its tie lit up to say so.
   *
   * This is the answer to the half of the problem lanes cannot solve. A lane
   * proves there are five ties rather than one; it still does not say WHICH of
   * five nearly-identical brackets belongs to the card under the cursor, and
   * the highlights it points back at are scattered across 600px of prose. One
   * pointer (or one Tab stop) resolves the whole cluster.
   *
   * Written imperatively, like every other pairing signal in this file: a
   * `useState` here would re-render — and re-measure — the entire column on
   * every mouse move across it, to change two class names. `focus`/`blur` are
   * React's bubbling synthetic events, so tabbing to any control inside the
   * card counts, which is what makes this reachable without a mouse.
   */
  const peek = useCallback(
    (id: string, on: boolean): void => {
      const tie = tieRefs.current.get(id);
      if (tie) {
        if (on) tie.dataset.peek = 'true';
        else delete tie.dataset.peek;
      }
      if (!root) return;
      for (const el of highlightElements(id, root)) el.classList.toggle('peek', on);
    },
    [root],
  );

  const setCardRef = useCallback((id: string, el: HTMLElement | null): void => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  const setTieRef = useCallback((id: string, el: HTMLElement | null): void => {
    if (el) tieRefs.current.set(id, el);
    else tieRefs.current.delete(id);
  }, []);

  const openCard = useCallback(
    (id: string): void => {
      onFocusChange({ id, edit: true });
      reveal(id);
    },
    [onFocusChange, reveal],
  );

  const onDraftChange = useCallback(
    (id: string, text: string): void => {
      setDraft({ id, text });
      // Synchronously, before anything is scheduled — see `DRAFT_KEY`. This
      // line is what makes the loss window zero rather than smaller.
      writeStash({ id, text });
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, WRITE_DEBOUNCE_MS);
    },
    [flush],
  );

  const onDelete = useCallback(
    (id: string): void => {
      // Drop the draft first: flushing it on the way out would resurrect the
      // note text onto a row that is being tombstoned.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      draftRef.current = null;
      // And the durable copy with it: the row is being tombstoned, so a stash
      // left behind would be a draft nothing will ever adopt.
      const stash = readStash();
      if (stash?.id === id) writeStash(null);
      setDraft(null);
      onFocusChange(null);
      void remove(id).catch((error: unknown) => {
        console.error('MarginCards: could not delete the note', error);
      });
    },
    [onFocusChange, remove],
  );

  const body = (row: Ann) => {
    const open = focusId === row.id;
    const note = open && draft?.id === row.id ? draft.text : row.note;
    const quote = quoteOf(row.anchor, QUOTE_MAX);
    const kind = kinds.get(row.id) ?? 'rect';
    return (
      <>
        <button type="button" className="ann-card-open" onClick={() => openCard(row.id)}>
          <span className="ann-card-quote">{quote}</span>
          <time className="ann-card-time" dateTime={row.updatedAt}>
            {shortTime(row.updatedAt)}
          </time>
          {kind !== 'rect' && (
            // The highlight exists but is not drawn anywhere on the page —
            // almost always because it is inside a "Chứng minh" block the
            // reader has not opened. Saying so is the difference between a
            // card that looks misplaced and one that explains itself; the
            // click that opens the card opens the block too.
            <span className="ann-card-badge">
              {t(kind === 'details' ? 'ann.card.collapsed' : 'ann.card.offPage')}
            </span>
          )}
          {!open && (
            <span className={note ? 'ann-card-note' : 'ann-card-note ann-card-note-empty'}>
              {note || t('ann.card.emptyNote')}
            </span>
          )}
        </button>
        {open && (
          <>
            <textarea
              // Exactly one card is open at a time, and either the column or
              // the sheet renders it — never both — so one ref is enough.
              ref={editorRef}
              className="ann-card-input"
              aria-label={t('ann.card.editorAria')}
              rows={3}
              value={draft?.id === row.id ? draft.text : row.note}
              onChange={(event) => onDraftChange(row.id, event.target.value)}
              onBlur={flush}
            />
            <div className="ann-card-actions">
              <button type="button" className="ann-card-del" onClick={() => onDelete(row.id)}>
                {t('ann.card.delete')}
              </button>
              <button type="button" className="ann-card-done" onClick={() => onFocusChange(null)}>
                {t('ann.card.done')}
              </button>
            </div>
          </>
        )}
      </>
    );
  };

  if (!root) return null;

  const doc = root.ownerDocument ?? document;
  const sheetRow = !wide && focusId ? (byId.get(focusId) ?? null) : null;

  return (
    <>
      {visible && wide && (
        <div className="ann-cards" ref={hostRef}>
          {list.length === 0 && orphans.length === 0 && (
            <p className="ann-cards-empty muted">{t('ann.card.none')}</p>
          )}
          {list.map((row) => (
            <Fragment key={row.id}>
              <span
                className="ann-tie"
                aria-hidden="true"
                data-anchor-kind={kinds.get(row.id) ?? 'rect'}
                ref={(el) => setTieRef(row.id, el)}
              />
              <article
                className={`ann-card ann-card-${colorOf(row.anchor)}`}
                data-ann-card={row.id}
                data-anchor-kind={kinds.get(row.id) ?? 'rect'}
                data-open={focusId === row.id ? 'true' : undefined}
                ref={(el) => setCardRef(row.id, el)}
                onMouseEnter={() => peek(row.id, true)}
                onMouseLeave={() => peek(row.id, false)}
                onFocus={() => peek(row.id, true)}
                onBlur={() => peek(row.id, false)}
              >
                {body(row)}
              </article>
            </Fragment>
          ))}
        </div>
      )}
      {sheetRow &&
        createPortal(
          <>
            <div
              className="ann-sheet-scrim"
              // Presentation only: the sheet itself carries the dialog role,
              // and Escape/"Đóng" are the keyboard ways out.
              aria-hidden="true"
              onClick={() => onFocusChange(null)}
            />
            <div
              className={`ann-sheet ann-card-${colorOf(sheetRow.anchor)}`}
              role="dialog"
              aria-modal="true"
              aria-label={t('ann.card.sheetAria')}
              data-ann-card={sheetRow.id}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onFocusChange(null);
              }}
            >
              <button type="button" className="ann-sheet-close" aria-label={t('ann.card.sheetClose')} onClick={() => onFocusChange(null)}>
                ×
              </button>
              {body(sheetRow)}
            </div>
          </>,
          doc.body,
        )}
    </>
  );
}

export default MarginCards;
