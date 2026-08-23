/**
 * The reading view's table of contents — a DRAWER, not a column.
 *
 * Đặc tả: `docs/superpowers/specs/2026-08-23-ia-redesign.md` §"Chế độ đọc",
 * hình đã duyệt: khung "Chế độ đọc · hướng A" trên canvas.
 *
 * ---------------------------------------------------------------------
 * 1. Why one drawer holds BOTH lists
 * ---------------------------------------------------------------------
 * Reading mode used to be navigated by two different things at once, on two
 * different edges of the screen:
 *
 *   - `#sidebar` (306px, left) — the COURSE outline, parts → chapters, which
 *     is also the app's only global navigation. On a chapter route it REPLACED
 *     that global navigation rather than sitting beside it, so the product had
 *     two navigation models and neither told you about the other.
 *   - `#rail` (210px, right) — the CHAPTER's own h2/h3 outline, under a tab
 *     labelled "Trong chương".
 *
 * The new layout takes both columns away from the text. Both lists still have
 * to exist — "the chapter list is now unreachable from a chapter" would be a
 * navigation regression dressed up as a redesign — so they live here,
 * together, in the order a reader asks for them: where am I in THIS chapter,
 * then where is this chapter in the course.
 *
 * ---------------------------------------------------------------------
 * 2. Always mounted, hidden with `visibility` — not unmounted
 * ---------------------------------------------------------------------
 * `visibility: hidden` (see `styles/reader-layout.css`) is doing three jobs at
 * once, and each of them is a reason not to unmount instead:
 *
 *   - it takes the whole subtree OUT OF THE TAB ORDER and out of the
 *     accessibility tree, which `display:none` also does but `opacity:0` and
 *     `transform` alone do not — a closed drawer whose forty chapter links are
 *     still tabbable is a keyboard trap you cannot see;
 *   - unlike `display:none` it is animatable, so the drawer can slide;
 *   - the heading links stay in the DOM, which is what lets
 *     `ChapterView.test.tsx` keep using "the TOC links appeared" as its
 *     witness that the chapter's own render pipeline has COMMITTED. That
 *     witness is not a convenience: `setHeadings` is called from inside an
 *     effect, so it lands in a LATER commit than the one that ran the effect,
 *     and a structural `waitFor` on anything else is exactly the shape of
 *     assertion that file's own header warns is never enough.
 *
 * `aria-hidden` is set alongside it rather than instead of it, for the one
 * case `visibility` cannot cover on its own: a drawer mid-transition is
 * `visibility: visible` for the whole slide-out.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { CourseNav } from '../course/CourseNav';
import type { Part } from '../course/types';
import { useLanguage } from '../i18n/LanguageProvider';

/** One h2/h3 of the open chapter — the same shape `ChapterView` derives. */
export interface DrawerHeading {
  readonly id: string;
  readonly text: string;
  readonly level: 2 | 3;
}

export interface TocDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly courseId: string;
  readonly courseTitle: string;
  readonly currentChapterId: string;
  readonly parts: readonly Part[];
  readonly doneChapterIds?: ReadonlySet<string>;
  readonly headings: readonly DrawerHeading[];
  /** Which heading the reader is level with, from `ChapterView`'s single
   * IntersectionObserver — NOT a second scroll measurement, which would be
   * free to disagree with the one the AI prompt's "focus" is built from. */
  readonly currentHeadingId: string | null;
}

export function TocDrawer({
  open,
  onClose,
  courseId,
  courseTitle,
  currentChapterId,
  parts,
  doneChapterIds,
  headings,
  currentHeadingId,
}: TocDrawerProps) {
  const { t } = useLanguage();
  const location = useLocation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  /**
   * `onClose` read through a ref, and the reason is a bug this component had
   * for exactly as long as it took its first test to run.
   *
   * The navigation effect below has to fire when the ROUTE changes and at no
   * other time. Listing `onClose` in its dependency array makes it fire
   * whenever `onClose` changes identity too — which, for any caller that
   * passes an inline arrow, is EVERY RENDER. The drawer then closes itself in
   * the commit right after the one that opened it, and no amount of clicking
   * the button ever opens it: it is not "flaky", it simply never works.
   *
   * `ChapterView` happens to pass a `useCallback`, so the trap would not have
   * been visible from the app at all. A component whose correctness depends on
   * its caller remembering to memoize a callback is a component with a trap in
   * it, so the dependency is removed rather than documented.
   *
   * Assigned during render rather than in an effect: the ref is only ever READ
   * asynchronously (from effects that run after the commit), so there is no
   * moment at which a mid-render write could be observed as torn.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Navigating shuts it. Written as "any route change" rather than as an
  // `onClick` on every chapter link, for the reason `useMobileNav` gives for
  // the same rule: a chapter link is only one of the things that can change
  // the route, and `CourseNav` is markup shared with `CourseHome`/`Sidebar`
  // that has no business learning what a drawer is.
  //
  // `key` AND `pathname`, not either alone. `pathname` is the honest signal
  // for "went somewhere else" and is what `useMobileNav` uses. It is blind to
  // one case a reader hits constantly, though: clicking the chapter they are
  // ALREADY in. React Router pushes that — same pathname, new `key` — so
  // without `key` the drawer stays open over the text it was asked to reveal.
  // Listing both means a router build where `key` is stable still closes on
  // real navigation rather than never closing at all.
  useEffect(() => {
    onCloseRef.current();
  }, [location.pathname, location.key]);

  // Escape closes it. Registered only while open so this hook never competes
  // with the other Escape handlers a chapter has on screen at the same time
  // (the AI panel's, the note sheet's, `useMobileNav`'s) — a closed drawer
  // that still swallows Escape would silently break all three.
  useEffect(() => {
    if (!open) return;
    function onKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
    }
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
    // `onClose` through the ref for the reason given above; here it would only
    // cost a listener torn down and re-attached on every render rather than
    // breaking the feature, but one rule about this prop is easier to keep
    // than two.
  }, [open]);

  // Focus goes into the drawer when it opens and comes back to whatever
  // opened it when it shuts. Without the second half, closing the drawer
  // leaves focus on a `visibility:hidden` button and the next Tab starts over
  // from the top of the document — measured, and the reason this is not left
  // to the browser.
  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      closeRef.current?.focus();
      return;
    }
    const previous = returnFocusRef.current;
    returnFocusRef.current = null;
    // `isConnected`: leaving the chapter closes the drawer in the same commit
    // that removes the toolbar the focus came from.
    if (previous?.isConnected) previous.focus();
  }, [open]);

  return (
    <div className="rd-drawer-root" data-open={open ? 'true' : 'false'}>
      {/* Presentation only — Escape and the close button are the keyboard
          ways out, and a scrim that announces itself is one more thing
          between a screen-reader user and the list they opened. */}
      <div className="rd-scrim" aria-hidden="true" onClick={onClose} />
      <nav
        id="reader-toc-drawer"
        className="rd-drawer"
        aria-label={t('reader.tocAria')}
        aria-hidden={open ? undefined : true}
      >
        <div className="rd-drawer-head">
          <p className="rd-drawer-title">{courseTitle}</p>
          <button type="button" className="rd-drawer-close" aria-label={t('reader.tocClose')} onClick={onClose} ref={closeRef}>
            ×
          </button>
        </div>

        <p className="rd-h">{t('rail.inChapter')}</p>
        <div className="rd-toc">
          {headings.length === 0 && <p className="rd-empty muted">{t('reader.tocHeadingsEmpty')}</p>}
          {headings.map((h) => (
            <a
              key={h.id}
              href={`#${h.id}`}
              className={[h.level === 3 ? 'lvl3' : '', h.id === currentHeadingId ? 'cur' : ''].filter(Boolean).join(' ') || undefined}
              onClick={(event) => {
                event.preventDefault();
                // Close FIRST: the drawer overlays the left edge of the text
                // column, so scrolling to a heading while it is still up
                // parks the reader behind it.
                onClose();
                document.getElementById(h.id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
              }}
            >
              {h.text}
            </a>
          ))}
        </div>

        <p className="rd-h">{t('reader.toc')}</p>
        <div className="rd-nav">
          {parts.length === 0 ? (
            <p className="rd-empty muted">{t('reader.tocEmpty')}</p>
          ) : (
            <CourseNav
              courseId={courseId}
              parts={parts}
              doneChapterIds={doneChapterIds}
              currentChapterId={currentChapterId}
            />
          )}
        </div>
      </nav>
    </div>
  );
}

export default TocDrawer;
