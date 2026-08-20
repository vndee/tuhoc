/**
 * The orphan panel (P2 Task 7) — the last promise of the phase, and the only
 * one that is about failure.
 *
 * An ORPHAN is a note whose anchor this render could not find: the exact tiers
 * missed, the fuzzy tier missed, and `anchorToRange` answered `null`. That is
 * not a statement about the note — `./useAnnotations`'s own doc is emphatic
 * that resolving is a READ and that nothing anywhere deletes, tombstones or
 * even touches an orphan — it is a statement about this build of the chapter.
 * The commonest cause is the ordinary one: the course content was rebuilt and
 * the sentence the note was written about no longer reads the same.
 *
 * Six tasks went into keeping a reader's notes attached. This file is what
 * happens when all of that is not enough, and it exists so the answer is *"I
 * could not find this one, but I still have every word of it"* instead of
 * silence. If this panel is careless, the six tasks of data-loss defence in
 * front of it are worth nothing: the note was not lost, but it cannot be got
 * back either.
 *
 * ---------------------------------------------------------------------
 * 1. Two components, one `selectionchange`
 * ---------------------------------------------------------------------
 * Task 5's `./SelectionToolbar` turns a selection into a NEW note. This file
 * turns a selection into a new HOME for an old note. Both listen to the same
 * event on the same document, and while reattach mode is on they would both
 * answer it — the reader would drag across a paragraph and get a colour picker
 * sitting on top of the thing they were trying to re-anchor, with two owners
 * racing over the same `NormMap`.
 *
 * The rule is: **reattach mode wins**. The toolbar takes a `suspended` prop and
 * detaches its listener entirely while this mode is on (see its own doc for
 * why the veto lives there rather than here). Reattach mode is the narrower,
 * explicitly-requested state — the reader pressed a button that says what the
 * next selection is for — and a mode with no visible way to complete it is
 * worse than a button that is temporarily not offered.
 *
 * ---------------------------------------------------------------------
 * 2. A `NormMap` is a snapshot, and reattaching expires it (ruling P2-F8)
 * ---------------------------------------------------------------------
 * `reattach` writes a new anchor; the store resolves it and PAINTS it, which
 * splits the very text nodes this file's cached map recorded lengths for. So
 * the map taken for the first rescue describes a tree that no longer exists by
 * the time the reader rescues a second note, and `rangeToFlat` /
 * `selectionToAnchor` are documented to THROW `StaleNormMapError` rather than
 * answer wrongly.
 *
 * "Rescue one note, then rescue another" is not an edge case here — a chapter
 * that orphaned one note almost always orphaned several, because the thing
 * that caused it (a content rebuild) is not selective. So the cache below is
 * checked with `isMapStale` on every use, the proactive form the ruling
 * prescribes, and keyed on `(root, revision)` as well: `isMapStale` detects a
 * tracked node whose LENGTH changed, not one that was DETACHED, and replacing
 * the chapter detaches every node while leaving every length alone.
 *
 * ---------------------------------------------------------------------
 * 3. What reattaching may and may not change
 * ---------------------------------------------------------------------
 * It changes the anchor. That is all. The note text is not read, not
 * re-written and not passed anywhere near this code path (`reattach` in
 * `./useAnnotations` patches `anchor` and `updatedAt` and nothing else), and
 * the COLOUR is carried over from the old anchor rather than re-picked — a
 * reader rescuing a purple note gets a purple note back. Losing either while
 * the reader is in the middle of a rescue is the worst outcome this particular
 * file could produce, which is why the colour is read from `colorOf(row.anchor)`
 * at the call site instead of defaulting to anything.
 *
 * ---------------------------------------------------------------------
 * 4. There is no bulk delete, and that is deliberate
 * ---------------------------------------------------------------------
 * The obvious affordance for a list of things that "did not work" is a button
 * that empties it. This panel does not have one, at any granularity. Every row
 * here is prose a reader chose to write; the list being untidy is not a reason
 * to offer them a single click that destroys all of it, and an orphan is not
 * even permanently broken — a note orphaned by today's content rebuild can
 * re-attach on its own after tomorrow's. Deleting one note remains possible
 * where it always was: open the note, and use the card's own "Xóa ghi chú".
 *
 * ---------------------------------------------------------------------
 * 5. Known limit, written down rather than designed around
 * ---------------------------------------------------------------------
 * `reader.css` hides `#rail` outright below 1241px, so on a phone this panel
 * is not reachable at all — same as the TOC and, in its column form, the
 * margin cards. Nothing is lost there (orphans are never written to, so they
 * are all still waiting on a wider screen), but nothing can be rescued there
 * either. A bottom-sheet form of this panel is the fix; it is a second surface
 * with its own selection story and it is not in this task.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Anchor, selectionToAnchor } from './anchor';
import { isMapStale, type NormMap, normalizeContainer, rangeToFlat } from './normalize';
import { selectionRange } from './SelectionToolbar';
import {
  type Ann,
  type ChapterContent,
  colorOf,
  exactOf,
  quoteOf,
  type UseAnnotationsResult,
} from './useAnnotations';

/**
 * The part of `useAnnotations`'s result this panel needs.
 *
 * A `Pick`, like `ToolbarStore` and `MarginCardsStore`, so the dependency is
 * legible and so `ChapterView` satisfies it with THE one store instance it
 * already holds. A second `useAnnotations` would paint every annotation twice.
 *
 * Note what is NOT in it: `remove`. This component cannot tombstone a note
 * even by accident, because it was never handed the ability to (see section 4
 * of the file doc).
 */
export type OrphanPanelStore = Pick<UseAnnotationsResult, 'orphans' | 'reattach'>;

export interface OrphanPanelProps {
  /** The chapter DOM, exactly as `useAnnotations` receives it. */
  readonly content: ChapterContent;
  readonly store: OrphanPanelStore;
  /**
   * The orphan currently waiting for the reader to select its new home, or
   * `null`.
   *
   * Owned by `ChapterView` rather than by this component, because Task 5's
   * toolbar has to be suspended while it is set, and that is a sibling — the
   * same reason `CardFocus` lives up there.
   */
  readonly reattaching: string | null;
  readonly onReattachingChange: (id: string | null) => void;
}

/**
 * How much of the lost quote a row shows.
 *
 * Smaller than the margin card's 120 because a rail row has less width and,
 * more to the point, a different job: the card's quote identifies a highlight
 * the reader can also SEE, while this one is a reminder of text that is no
 * longer on the page. The full string is one click away in "Xem exact gốc",
 * which is the control that actually has to be complete.
 */
export const ORPHAN_QUOTE_MAX = 80;

/** How much of the reader's new selection the confirm bar echoes back. Enough
 * to tell two paragraphs apart, short enough not to become a second copy of
 * the page. */
const PREVIEW_MAX = 60;

const REATTACH_FAILED = 'Không gắn lại được. Hãy bôi chọn lại rồi thử lần nữa.';

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

/**
 * The list of notes this chapter could not place, and the way to put one back.
 *
 * Renders nothing at all when there are no orphans: a permanent "Mồ côi (0)"
 * heading would teach the reader to expect a section that, on a healthy
 * chapter, has nothing to say.
 */
export function OrphanPanel({ content, store, reattaching, onReattachingChange }: OrphanPanelProps) {
  const { orphans, reattach } = store;
  const root = content.root;
  const revision = content.revision;

  /** Which row has its full `exact` opened. One at a time: the box is tall,
   * and the reason to open it is to copy one quote and go looking for it. */
  const [shown, setShown] = useState<string | null>(null);
  /** A short echo of the selection the reader has made, or `null` when there
   * is nothing anchorable selected. Doubles as "is the confirm button
   * offered", so the button can never be present with nothing behind it. */
  const [candidate, setCandidate] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  /** The map for the CURRENT `(root, revision)`, rebuilt whenever a paint has
   * invalidated it. See the file doc, section 2. */
  const mapRef = useRef<{ root: HTMLElement; revision: number; map: NormMap } | null>(null);
  /** The last selection judged anchorable. A fallback only — the live
   * selection is preferred at click time, for the same reason the toolbar
   * prefers it: it is the browser's own up-to-date answer, and a stored
   * `Range` can be moved out from under us by the store's deferred pass
   * painting something that overlaps it. */
  const rangeRef = useRef<Range | null>(null);
  const exactRefs = useRef(new Map<string, HTMLTextAreaElement>());

  const target: Ann | null = reattaching ? (orphans.find((row) => row.id === reattaching) ?? null) : null;

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

  // The row being reattached stopped being an orphan without going through
  // this component: a pull from another device re-anchored it, or the chapter
  // was replaced underneath. Either way the mode is pointing at nothing and
  // the bar must come down rather than sit there taking the toolbar's place.
  useEffect(() => {
    if (reattaching && !target) onReattachingChange(null);
  }, [reattaching, target, onReattachingChange]);

  // ---- watch the selection, but only while a rescue is in progress --------
  //
  // The three resets at the top belong to this effect rather than one of their
  // own, because they answer the same question it does: this is a NEW rescue
  // (or the end of one, or a chapter re-rendered underneath), so nothing the
  // previous attempt left behind may be reused. `rangeRef` is the one that
  // matters — `confirmReattach` falls back to it when there is no live
  // selection, so a range kept across two rescues would quietly send the
  // second note to the first one's paragraph.
  useEffect(() => {
    rangeRef.current = null;
    setCandidate(null);
    setFailed(false);
    if (!root || !reattaching) return;
    const onSelectionChange = (): void => {
      const range = selectionRange(root);
      if (!range) {
        rangeRef.current = null;
        setCandidate(null);
        return;
      }
      const map = mapFor();
      // `rangeToFlat` is the only door (ruling P2-F6): `null` here is every
      // reason there is not to offer the button, in one answer.
      if (!map || !rangeToFlat(map, range)) {
        rangeRef.current = null;
        setCandidate(null);
        return;
      }
      rangeRef.current = range.cloneRange();
      setCandidate(preview(range.toString()));
    };
    const doc = root.ownerDocument ?? document;
    doc.addEventListener('selectionchange', onSelectionChange);
    return () => doc.removeEventListener('selectionchange', onSelectionChange);
  }, [root, reattaching, mapFor]);

  // Escape leaves the mode. Nothing else is looked at and nothing is
  // prevented, so Ctrl/Cmd+C on the quote the reader just copied, and the
  // chapter pager's own arrows, all pass through untouched.
  useEffect(() => {
    if (!reattaching || !root) return;
    const doc = root.ownerDocument ?? document;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onReattachingChange(null);
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [reattaching, root, onReattachingChange]);

  const confirmReattach = useCallback(async (): Promise<void> => {
    if (!root || !target) return;
    const range = selectionRange(root) ?? rangeRef.current;
    if (!range || range.collapsed || !root.contains(range.commonAncestorContainer)) {
      setFailed(true);
      return;
    }
    const map = mapFor();
    if (!map) return;

    // The colour is the OLD note's colour. This is a rescue, not a new note.
    const anchor: Anchor | null = selectionToAnchor(map, range, colorOf(target.anchor));
    if (!anchor) {
      // `./anchor`'s final word: a selection with no quotable text in it (a
      // drag across the gap between two paragraphs). Storing it anyway would
      // move the note from "cannot be found" to "cannot be found, and now
      // points somewhere else too".
      setFailed(true);
      return;
    }

    root.ownerDocument?.defaultView?.getSelection?.()?.removeAllRanges();
    try {
      // Only the anchor changes. `reattach` patches `anchor` + `updatedAt`;
      // the note text is never read here, let alone written.
      await reattach(target.id, anchor);
      onReattachingChange(null);
    } catch (error) {
      // The reader keeps the mode, the selection and the note. A rescue that
      // failed silently would look exactly like one that worked until the next
      // page load.
      console.error('OrphanPanel: could not reattach the note', error);
      setFailed(true);
    }
  }, [root, target, mapFor, reattach, onReattachingChange]);

  const setExactRef = useCallback((id: string, el: HTMLTextAreaElement | null): void => {
    if (el) exactRefs.current.set(id, el);
    else exactRefs.current.delete(id);
  }, []);

  const copyExact = useCallback((row: Ann): void => {
    // Selecting the field is the part that works everywhere, needs no
    // permission and cannot fail: Ctrl/Cmd+C then does the rest, and a reader
    // who prefers to drag over it was never blocked in the first place. The
    // Clipboard call is the shortcut layered on top, and it is optional in
    // both directions — no `navigator.clipboard` (jsdom, http origins,
    // older Safari) and a rejected promise both leave the selection standing.
    exactRefs.current.get(row.id)?.select?.();
    const clipboard = (navigator as Navigator & { clipboard?: { writeText?: (text: string) => Promise<void> } })
      .clipboard;
    if (typeof clipboard?.writeText !== 'function') return;
    void clipboard.writeText(exactOf(row.anchor)).catch((error: unknown) => {
      console.error('OrphanPanel: could not copy the quote', error);
    });
  }, []);

  if (!root || orphans.length === 0) return null;

  const doc = root.ownerDocument ?? document;

  return (
    <>
      <section className="ann-orphans" aria-labelledby="ann-orphans-h">
        <h3 className="ann-orphans-h" id="ann-orphans-h">{`Mồ côi (${orphans.length})`}</h3>
        <p className="ann-orphans-lede">
          Bản chương hiện tại không còn đoạn văn mà những ghi chú này neo vào. Nội dung ghi chú vẫn được giữ nguyên —
          bấm “Gắn lại” rồi bôi chọn đoạn tương ứng để nối lại.
        </p>
        <ul className="ann-orphan-list">
          {orphans.map((row) => {
            const open = shown === row.id;
            const waiting = reattaching === row.id;
            return (
              <li
                key={row.id}
                className={`ann-orphan ann-card-${colorOf(row.anchor)}`}
                data-ann-orphan={row.id}
                data-waiting={waiting ? 'true' : undefined}
              >
                <p className="ann-orphan-quote" data-testid={`orphan-quote-${row.id}`}>
                  {quoteOf(row.anchor, ORPHAN_QUOTE_MAX)}
                </p>
                <p className={row.note ? 'ann-orphan-note' : 'ann-orphan-note ann-orphan-note-empty'}>
                  {row.note || '(chưa có nội dung)'}
                </p>
                {waiting && (
                  <p className="ann-orphan-wait" role="status">
                    Bôi chọn đoạn văn tương ứng trong chương, rồi bấm “Gắn vào đây”.
                  </p>
                )}
                <div className="ann-orphan-actions">
                  {!waiting && (
                    <button type="button" className="ann-orphan-act" onClick={() => onReattachingChange(row.id)}>
                      Gắn lại
                    </button>
                  )}
                  {/* Stays available DURING a rescue on purpose: copying the
                      original words and searching the rebuilt chapter for them
                      is how the reader finds the paragraph they are about to
                      select. */}
                  <button
                    type="button"
                    className="ann-orphan-act"
                    aria-expanded={open}
                    aria-controls={`ann-orphan-exact-${row.id}`}
                    onClick={() => setShown(open ? null : row.id)}
                  >
                    Xem exact gốc
                  </button>
                </div>
                {open && (
                  <div className="ann-orphan-source">
                    <textarea
                      id={`ann-orphan-exact-${row.id}`}
                      className="ann-orphan-exact"
                      aria-label="Đoạn văn gốc của ghi chú"
                      readOnly
                      rows={3}
                      value={exactOf(row.anchor)}
                      ref={(el) => setExactRef(row.id, el)}
                    />
                    <button type="button" className="ann-orphan-act" onClick={() => copyExact(row)}>
                      Sao chép
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {target &&
        createPortal(
          <div
            className="ann-reattach"
            // Not `role="toolbar"`: that role belongs to Task 5's bar, and the
            // one claim worth being able to make about this mode is "no
            // new-note toolbar is on screen". Two things answering to the same
            // role would make that claim untestable.
            role="group"
            aria-label="Gắn lại ghi chú"
            // Keeps the reader's selection alive across the click and keeps
            // focus where it was — the browser would otherwise collapse the
            // selection the moment they reach for the button. On the container,
            // so it covers every control at once.
            onMouseDown={(event) => event.preventDefault()}
          >
            <span className="ann-reattach-what">
              Gắn lại: <b>{quoteOf(target.anchor, PREVIEW_MAX)}</b>
            </span>
            {candidate === null ? (
              <span className="ann-reattach-hint">Bôi chọn đoạn văn mới trong chương.</span>
            ) : (
              <>
                <span className="ann-reattach-preview">“{candidate}”</span>
                <button
                  type="button"
                  className="ann-reattach-ok"
                  onClick={() => {
                    void confirmReattach();
                  }}
                >
                  Gắn vào đây
                </button>
              </>
            )}
            {failed && (
              <span className="ann-reattach-error" role="alert">
                {REATTACH_FAILED}
              </span>
            )}
            <button type="button" className="ann-reattach-cancel" onClick={() => onReattachingChange(null)}>
              Hủy
            </button>
          </div>,
          doc.body,
        )}
    </>
  );
}

export default OrphanPanel;
