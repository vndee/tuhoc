import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { type CardFocus, MarginCards } from '../annotations/MarginCards';
import { SelectionToolbar } from '../annotations/SelectionToolbar';
import { type ChapterContent, useAnnotations } from '../annotations/useAnnotations';
import { describeCourseError, loadChapter } from '../course/loader';
import type { Chapter } from '../course/types';
import { startHeartbeat } from '../progress/heartbeat';
import { useProgress } from '../progress/useProgress';
import { useThemeContext } from '../theme/ThemeContext';
import { setChapterContextSource } from './getContext';
import { injectExerciseCheckboxes } from './injectExerciseCheckboxes';
import { useCourseKit } from './useCourseKit';

export interface ChapterViewProps {
  courseId: string;
  /** The course's own title — used to build `document.title`, same shape as v1's own "<chapter> — <course>". */
  courseTitle: string;
  /** The title of the part (manifest.parts[].title) this chapter belongs to — used for the `#crumb` breadcrumb only; `prevChapter`/`nextChapter` deliberately don't carry this. */
  partTitle: string;
  chapter: Chapter;
  prevChapter: Chapter | null;
  nextChapter: Chapter | null;
}

interface HeadingEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * Renders one chapter: fetches its HTML fragment, injects it into a DOM
 * node React never diffs (see the module doc below), then runs
 * `CourseKit.renderKatex` → `CourseKit.initViz` in that order, builds the
 * right-rail TOC and the in-content pager, and wires the pager keyboard
 * shortcuts + topbar prev/next buttons. `getContext()` (src/reader/getContext.ts)
 * reads whatever chapter this component most recently registered.
 *
 * DOM ownership: `containerRef`'s `<div>` is never given React children —
 * its content is set imperatively via `innerHTML` and mutated in place by
 * `initViz` (canvases, sliders, ...). This is deliberate: React only ever
 * sees an empty `<div ref={containerRef} />` in its own vdom, so it never
 * has anything to reconcile there and won't blow away `initViz`'s DOM on a
 * later re-render — the trap called out in the task brief (dangerouslySetInnerHTML
 * would fight both the re-render replacement and script tags not
 * executing; a plain ref'd node sidesteps both).
 */
export function ChapterView({ courseId, courseTitle, partTitle, chapter, prevChapter, nextChapter }: ChapterViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [railEl, setRailEl] = useState<HTMLElement | null>(null);
  const [crumbEl, setCrumbEl] = useState<HTMLElement | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [currentHeadingId, setCurrentHeadingId] = useState<string | null>(null);
  const navigate = useNavigate();
  const courseKit = useCourseKit(courseId);
  const progress = useProgress(courseId);
  // Only `toggle` is needed here — the reader never displays the theme
  // icon itself, that's `#theme-btn`'s job (Topbar, via AppShell). Reading
  // this through the shared context (not a second `useTheme()` call) is
  // debt #2's whole point — see ThemeContext.tsx's doc comment.
  const { toggle: toggleTheme } = useThemeContext();

  // P2 Task 4: the annotation store resolves this chapter's stored anchors
  // against the DOM below and paints the highlights in. It has to be told when
  // the content under `containerRef` was REPLACED — the element identity never
  // changes (the main effect swaps `innerHTML` on the same `<div>`), so a
  // counter bumped by that effect is the only honest signal that every
  // `<mark>` is gone and every anchor needs resolving again.
  //
  // Task 5 consumes the result: `<SelectionToolbar>` below is what lets a
  // reader CREATE an annotation, and it takes THIS one hook result as a prop.
  // Calling `useAnnotations` again from inside the toolbar would give the
  // chapter two live instances, each painting every annotation — the trap the
  // hook's own doc names. The margin cards (T6) and the orphan panel (T7) join
  // the same way, through `list`/`orphans` on this same object.
  const [annotationContent, setAnnotationContent] = useState<ChapterContent>({ root: null, revision: 0 });
  const annotations = useAnnotations(courseId, chapter.id, annotationContent);

  // P2 Task 6. The right rail becomes two tabs, and BOTH are built here,
  // inside this component's own portal into `#rail` — ruling P2-F1.
  // `shell/Rail.tsx` returns null on a chapter route precisely because the
  // rail's content is derived from the chapter DOM, which that component
  // cannot see; adding the tabs there would render the rail twice (the P1
  // Task 11 bug that route-awareness was introduced to fix).
  //
  // `cardFocus` is which note card is open. It lives here rather than inside
  // `<MarginCards>` because Task 5's toolbar is what opens one: "Ghi chú"
  // creates the annotation and calls `onRequestNote(id)` — a callback that,
  // until this task, nothing was listening to, so the button highlighted in
  // yellow and offered no way to write anything.
  const [railTab, setRailTab] = useState<'toc' | 'notes'>('toc');
  const [cardFocus, setCardFocus] = useState<CardFocus | null>(null);

  // A card being opened from the CHAPTER (a click on a highlight) has to
  // bring its tab forward with it, or the reader clicks their own highlight
  // and nothing appears to happen.
  const focusCard = useCallback((next: CardFocus | null) => {
    setCardFocus(next);
    if (next) setRailTab('notes');
  }, []);

  const requestNote = useCallback((id: string) => focusCard({ id, edit: true }), [focusCard]);

  const chapterQuery = useQuery({
    queryKey: ['course-chapter', courseId, chapter.file],
    queryFn: () => loadChapter(courseId, chapter.file),
  });

  // Kept current on every render (not inside an effect — a plain
  // assignment during render is enough, since `startHeartbeat`'s tick
  // only ever reads this ref asynchronously, well after React has
  // committed) so the mount effect below can hand `startHeartbeat` a
  // getter that always answers "whichever chapter is open right now,"
  // never a value frozen at mount time.
  const heartbeatCtxRef = useRef<{ courseId: string; chapterId: string } | null>(null);
  heartbeatCtxRef.current = { courseId, chapterId: chapter.id };

  // Task 15: the study heartbeat. Started ONCE per mount (`[]` deps), not
  // re-started on every chapter change — `ChapterView` is reused across
  // in-course navigation rather than remounted (see
  // ChapterView.test.tsx's "navigating between chapters does not
  // accumulate REDRAWS entries" test, which proves this via `rerender`),
  // so restarting the interval on every chapter would reset the 30s
  // cadence and the 60s activity window on every navigation for no
  // reason. `getCtx` reads `heartbeatCtxRef` above instead, so each tick
  // still gets attributed to whatever chapter is open AT THAT TICK.
  // Teardown on unmount is what stops heartbeats once the reader is left
  // entirely (navigating to `/`, `/login`, ...) — without it, a stale
  // heartbeat would keep attributing study time to a chapter nobody is
  // reading anymore.
  useEffect(() => {
    return startHeartbeat(() => heartbeatCtxRef.current);
  }, []);

  // `#rail` and `#crumb` are rendered by <Shell>/<Topbar> (Task 9), siblings
  // of the routed content this component lives in — not DOM nodes reachable
  // via ref. Both always exist in the DOM by the time any effect runs
  // (React commits the whole tree before running effects), but NOT yet
  // during this component's own first render, so the portal targets are
  // picked up post-commit and stashed in state. This is the standard
  // portal-into-an-externally-owned-node pattern — the lint warning below
  // ("setState in effect can cascade") is the expected/necessary shape of
  // that pattern here: the effect has no dependencies (runs once per
  // mount), the state it sets isn't read by anything the effect itself
  // depends on, so there's no render loop, just the one extra render a
  // portal target discovery always needs.
  useEffect(() => {
    setRailEl(document.getElementById('rail'));
    setCrumbEl(document.getElementById('crumb'));
  }, []);

  // The rail is a STICKY, self-scrolling box (`reader.css`: `position:sticky`,
  // `max-height:calc(100vh - 100px)`, `overflow-y:auto`) — the right shape for
  // a short table of contents and the wrong one for a column of cards pinned
  // to document coordinates, which have to scroll WITH the chapter and must
  // not be clipped at the viewport's height. `.rail-notes` (src/styles/
  // index.css) turns those three properties off and widens the rail to fit a
  // card.
  //
  // Applied from here, imperatively, for the same reason `#mark-btn` and
  // `#prev-btn` are driven from here: `#rail` is chrome `<Shell>` renders,
  // and teaching `shell/Rail.tsx` about chapter state is exactly what ruling
  // P2-F1 forbids. The cleanup is what keeps a rail on `/` or `/c/:courseId`
  // from inheriting a chapter's layout after the reader navigates away.
  useEffect(() => {
    if (!railEl) return;
    railEl.classList.toggle('rail-notes', railTab === 'notes');
    return () => railEl.classList.remove('rail-notes');
  }, [railEl, railTab]);

  // A new chapter has none of the previous chapter's notes, so an open card
  // there refers to an annotation that is no longer on the page. The tab
  // itself is deliberately NOT reset: which of the two the reader is using is
  // a preference, and resetting it every chapter would fight them.
  useEffect(() => {
    setCardFocus(null);
  }, [chapter.id]);

  // Prev/next chapter navigation: topbar `#prev-btn`/`#next-btn` (Task 9
  // left them inert — its own comment names this task as the owner) plus
  // v1's ArrowLeft/ArrowRight shortcuts. Both live here, together, since
  // both need the same prev/next targets and both must stop working the
  // moment this chapter is no longer on screen.
  //
  // The `t`/`T` theme shortcut (debt #2, v1 parity —
  // `***REMOVED***.html:11170`) rides the SAME keydown handler and
  // the SAME "not while typing in a form field" guard, rather than a
  // second global listener: v1 itself has exactly one keydown handler for
  // all of these shortcuts, and `toggleTheme` here is the identical
  // function `#theme-btn` calls (via `useThemeContext()`, not a second
  // `useTheme()` instance — see ThemeContext.tsx), so the topbar icon can
  // never desync from a shortcut pressed while a chapter is open.
  useEffect(() => {
    const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement | null;
    const nextBtn = document.getElementById('next-btn') as HTMLButtonElement | null;

    const goPrev = () => {
      if (prevChapter) navigate(`/c/${courseId}/${prevChapter.id}`);
    };
    const goNext = () => {
      if (nextChapter) navigate(`/c/${courseId}/${nextChapter.id}`);
    };

    if (prevBtn) {
      prevBtn.disabled = !prevChapter;
      prevBtn.addEventListener('click', goPrev);
    }
    if (nextBtn) {
      nextBtn.disabled = !nextChapter;
      nextBtn.addEventListener('click', goNext);
    }

    function onKeydown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      // v1's own guard: don't hijack shortcuts while the reader is typing
      // somewhere (a form field), only Escape gets special treatment there
      // — and Escape/mobile-nav is already useMobileNav's job (Task 10).
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 't' || e.key === 'T') toggleTheme();
    }
    document.addEventListener('keydown', onKeydown);

    return () => {
      prevBtn?.removeEventListener('click', goPrev);
      nextBtn?.removeEventListener('click', goNext);
      if (prevBtn) prevBtn.disabled = false;
      if (nextBtn) nextBtn.disabled = false;
      document.removeEventListener('keydown', onKeydown);
    };
  }, [courseId, prevChapter, nextChapter, navigate, toggleTheme]);

  // `#mark-btn` (topbar chrome, Task 9 left it an inert placeholder naming
  // this task as its owner — Ruling F4/debt #5): same
  // portal-into-externally-owned-node recipe as `#prev-btn`/`#next-btn`
  // above, since `#mark-btn` is sibling chrome rendered by `<Topbar>`, not
  // a node this component's own JSX ever produces. Visual state (`.on`
  // class, ○/✓ icon, label) mirrors v1's `syncMark()` exactly
  // (`***REMOVED***.html`'s own mark-btn wiring) and is re-applied
  // whenever `isRead` for THIS chapter changes — including a change that
  // did not originate from this button (e.g. a remote sync pull marking
  // the chapter read from another device while it's open here).
  const isChapterRead = progress.isRead(chapter.id);
  useEffect(() => {
    const markBtn = document.getElementById('mark-btn');
    if (!markBtn) return;

    markBtn.classList.toggle('on', isChapterRead);
    markBtn.title = isChapterRead ? 'Bỏ đánh dấu đã học' : 'Đánh dấu đã học';
    // `<Topbar>` sets a static `aria-label` on this button, which — per
    // the accessible-name computation rules — takes precedence over its
    // visible text content. Updating only `.mk-lbl`'s text below without
    // also updating `aria-label` here would leave a screen reader
    // announcing "Đánh dấu đã học" (mark as read) forever, even once the
    // chapter IS marked read and the button's real action has flipped to
    // unmark it — so this mirrors `title`'s update exactly.
    markBtn.setAttribute('aria-label', isChapterRead ? 'Bỏ đánh dấu đã học' : 'Đánh dấu đã học');
    const icon = markBtn.querySelector('.mk-ico');
    if (icon) icon.textContent = isChapterRead ? '✓' : '○';
    const label = markBtn.querySelector('.mk-lbl');
    if (label) label.textContent = isChapterRead ? 'Đã học' : 'Đánh dấu đã học';

    const handleClick = () => progress.toggleRead(chapter.id);
    markBtn.addEventListener('click', handleClick);
    return () => {
      markBtn.removeEventListener('click', handleClick);
      // Reset to the neutral "off" default — same discipline as
      // `#prev-btn`/`#next-btn`'s cleanup re-enabling themselves above.
      // This cleanup also runs between chapters (not only on true
      // unmount), but that is harmless: if a NEW chapter is mounting
      // right after, its own effect run sets the correct state for that
      // chapter in the same commit, before the browser paints. If nothing
      // is mounting next (navigated away to `/` or `/login`, where this
      // button isn't wired to anything), this is what stops the button
      // from indefinitely showing a stale "✓ Đã học" from whatever
      // chapter was last open.
      markBtn.classList.remove('on');
      markBtn.title = 'Đánh dấu đã học';
      markBtn.setAttribute('aria-label', 'Đánh dấu đã học');
      const iconEl = markBtn.querySelector('.mk-ico');
      if (iconEl) iconEl.textContent = '○';
      const labelEl = markBtn.querySelector('.mk-lbl');
      if (labelEl) labelEl.textContent = 'Đánh dấu đã học';
    };
    // Deliberately depends on `isChapterRead` (the specific boolean this
    // effect cares about) and `progress.toggleRead` (stable — see
    // useProgress.ts) rather than the whole `progress` object: `progress`
    // also carries `partStats`/`doneChapterIds`, which change on every
    // EXERCISE toggle too — including the whole object here would re-run
    // this effect (tearing down and re-attaching the click listener) on
    // every exercise checkbox click in this chapter, not just on an actual
    // change to whether THIS chapter is marked read.
  }, [chapter.id, isChapterRead, progress.toggleRead]);

  // The main render pipeline: set the fragment's HTML, then
  // renderKatex -> initViz IN THAT ORDER (KaTeX must lay out its DOM
  // before a viz measures container width), then derive the rail TOC and
  // register this chapter with getContext().
  useEffect(() => {
    if (!courseKit.ready) return;
    const html = chapterQuery.data;
    if (html == null) return;
    const container = containerRef.current;
    if (!container) return;
    const CourseKit = window.CourseKit;
    if (!CourseKit) return;

    // Re-trigger v1's own fade-in transition (reader.css's .fade-in
    // animation) on every chapter change. Reading offsetWidth between the
    // two class assignments forces a reflow, so the browser treats the
    // second assignment as a fresh animation start rather than a no-op.
    container.className = '';
    void container.offsetWidth;
    container.className = 'fade-in';
    container.innerHTML = html;

    // REDRAWS is a plain array runtime.js only ever pushes onto (once per
    // Plot instance, from its constructor) — it has no teardown of its
    // own. Snapshotting its length before/after initViz lets cleanup
    // below splice out exactly the entries THIS chapter added: without
    // that, navigating between chapters would leave every previous
    // chapter's Plot instances registered forever, each one redrawing a
    // detached canvas on every future theme toggle.
    const redraws = CourseKit.REDRAWS;
    const redrawsBefore = redraws.length;
    CourseKit.renderKatex(container);
    CourseKit.initViz(container);
    const redrawsAfter = redraws.length;

    // Rail TOC, ported from v1's buildRail(): one entry per h2/h3, keeping
    // any id the fragment already carries (cross-references rely on it)
    // and only inventing one where none exists.
    const headingEls = Array.from(container.querySelectorAll<HTMLElement>('h2, h3'));
    headingEls.forEach((h, i) => {
      if (!h.id) h.id = `h-${chapter.id}-${i}`;
    });
    setHeadings(
      headingEls.map((h) => ({ id: h.id, text: (h.textContent ?? '').trim(), level: h.tagName === 'H3' ? 3 : 2 })),
    );
    setCurrentHeadingId(null);

    // Current-section highlighting, ported from v1's observeRail(). jsdom
    // has no IntersectionObserver — guarded so unit tests (which mock
    // CourseKit and never load the real runtime) don't need one either.
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined' && headingEls.length > 0) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) setCurrentHeadingId((entry.target as HTMLElement).id);
          }
        },
        { rootMargin: '-70px 0px -75% 0px' },
      );
      for (const h of headingEls) observer.observe(h);
    }

    setChapterContextSource({ courseId, chapterId: chapter.id, chapterTitle: chapter.title, contentEl: container });
    // Last, and only after KaTeX/viz/TOC have finished with the container:
    // annotation anchors are resolved against the DOM as the reader sees it,
    // and `normalize.ts` is built to ignore exactly what `initViz` generates.
    // Resolving before that ran would anchor against text that is about to
    // change shape.
    setAnnotationContent((prev) => ({ root: container, revision: prev.revision + 1 }));
    document.title = `${chapter.num ? `${chapter.num} ` : ''}${chapter.title} — ${courseTitle}`;
    window.scrollTo({ top: 0, behavior: 'auto' });

    return () => {
      redraws.splice(redrawsBefore, redrawsAfter - redrawsBefore);
      observer?.disconnect();
      setChapterContextSource(null);
    };
  }, [courseKit.ready, chapterQuery.data, courseId, chapter.id, chapter.num, chapter.title, courseTitle]);

  // Exercise checkboxes (this task's own deliverable): inject into every
  // `.box.ex .box-h` and keep their `checked` state in sync with progress
  // — WITHOUT ever touching `innerHTML` here (that is the main content
  // effect's job, above, and re-running it on every checkbox toggle would
  // tear down and rebuild everything `initViz`/`renderKatex` already set
  // up, including live canvas/slider state completely unrelated to any
  // exercise). This effect only ever mutates nodes inside `.box.ex
  // .box-h`, the same restraint `initViz` applies to `[data-viz]` nodes,
  // so the two can never fight over the same element.
  //
  // Declared AFTER the main content effect above on purpose: React runs
  // passive effects in declaration order within one commit, so by the
  // time this one runs, `containerRef.current` already holds the fragment
  // that effect just set — including on first mount and on every chapter
  // change (`chapter.id` is in this effect's own deps too).
  //
  // `courseKit.ready` MUST be in this effect's own deps too (fix-round-1,
  // Finding 1) — it is not enough that the main content effect above
  // already depends on it. `useCourseKit` loads four scripts in sequence
  // (see useCourseKit.ts's own doc comment) while the chapter's HTML
  // fragment is one small fetch; it is entirely plausible for
  // `chapterQuery.data` to resolve BEFORE `courseKit.ready` flips true.
  // When that happens, this effect fires once (because `chapterQuery.data`
  // changed) while `courseKit.ready` is still false — the component is
  // still rendering "Đang tải chương…", so `containerRef.current` is
  // null, and this effect is a no-op. Once `courseKit.ready` finally
  // flips true, the main content effect re-runs (its own deps include
  // `courseKit.ready`) and sets `innerHTML` for the first time — but
  // WITHOUT `courseKit.ready` also listed here, NONE of this effect's
  // OTHER deps would have changed on that render (same `chapter.id`,
  // same already-resolved `chapterQuery.data`, unchanged progress), so
  // React would never re-run it, and the exercise checkboxes would
  // silently never appear for that chapter. No test in this file caught
  // this before fix-round-1 because `useCourseKit` is mocked to return
  // `ready: true` synchronously everywhere else in this suite — see the
  // dedicated "ready flips true only after chapter data has resolved"
  // test below, which mocks the two independently to reproduce the real
  // ordering.
  //
  // `progress.partStats` changes identity on every underlying progress
  // write (see useProgress.ts), which is what lets this effect re-sync
  // `checked` after a remote change without re-injecting anything —
  // `injectExerciseCheckboxes` only ever CREATES a checkbox that doesn't
  // exist yet; every other call just refreshes `checked` on the same node.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    injectExerciseCheckboxes(container, {
      isDone: (n) => progress.exDone(chapter.id, n),
      toggle: (n) => progress.toggleEx(chapter.id, n),
    });
    // `progress.exDone`/`progress.toggleEx` (stable — see useProgress.ts)
    // plus `progress.partStats` (the change SIGNAL — see the paragraph
    // above) rather than the whole `progress` object: `progress` also
    // carries `isRead`/`doneChapterIds`/`toggleRead`, and including it
    // whole would re-run this effect (and re-walk every `.box.ex` in the
    // chapter) on every chapter-level `isRead` change too, not just an
    // exercise change.
  }, [chapter.id, courseKit.ready, progress.partStats, progress.exDone, progress.toggleEx, chapterQuery.data]);

  // Error checks come before the pending check: `!courseKit.ready` is true
  // for the whole time scripts are loading, so if it were checked first, a
  // chapter fetch that fails *while* scripts are still loading would show
  // "Đang tải chương…" instead of the real error until courseKit happened
  // to settle too — silently hiding a genuine failure behind a loading spinner.
  if (courseKit.error) {
    console.error('useCourseKit failed to load the course runtime', courseKit.error);
    return <p className="ch-lede">Không tải được công cụ đọc (KaTeX/mô phỏng). Hãy thử tải lại trang.</p>;
  }
  if (chapterQuery.isError) {
    return <p className="ch-lede">{describeCourseError(chapterQuery.error)}</p>;
  }
  if (!courseKit.ready || chapterQuery.isPending) {
    return <p className="ch-lede">Đang tải chương…</p>;
  }

  return (
    <>
      {crumbEl &&
        createPortal(
          // Markup ported from v1's own show(): '<span class="crumb-part">'+c.part+' › </span><b>'+num+title+'</b>'.
          // reader.css hides .crumb-part on narrow screens (#crumb .crumb-part{display:none})
          // so the chapter title alone survives on mobile — kept as a real
          // element here, not folded into the <b>, for that rule to keep working.
          <>
            <span className="crumb-part">
              {partTitle}
              {' › '}
            </span>
            <b>
              {chapter.num ? `${chapter.num} ` : ''}
              {chapter.title}
            </b>
          </>,
          crumbEl,
        )}
      <div ref={containerRef} />
      {/* Last in the chapter pipeline (innerHTML → renderKatex → initViz →
          injectExerciseCheckboxes → normalize/resolve/paint → toolbar): it
          watches `selectionchange` and does nothing at all until the reader
          selects something inside `annotationContent.root`, which is the same
          element the store above resolves against and only exists once that
          effect has run. It portals itself into `document.body`, so its
          position in this JSX is about ownership, not layout. */}
      <SelectionToolbar content={annotationContent} store={annotations} onRequestNote={requestNote} />
      {(prevChapter || nextChapter) && (
        <div className="pager">
          {prevChapter && (
            <Link className="prev" to={`/c/${courseId}/${prevChapter.id}`}>
              <div className="dir">← Chương trước</div>
              <div className="nm">
                {prevChapter.num ? `${prevChapter.num} · ` : ''}
                {prevChapter.short}
              </div>
            </Link>
          )}
          {nextChapter && (
            <Link className="next" to={`/c/${courseId}/${nextChapter.id}`}>
              <div className="dir">Chương sau →</div>
              <div className="nm">
                {nextChapter.num ? `${nextChapter.num} · ` : ''}
                {nextChapter.short}
              </div>
            </Link>
          )}
        </div>
      )}
      {railEl &&
        createPortal(
          <>
            {/* The rail's own heading used to be a `<p class="rail-h">Trong
                chương này</p>`; the "Trong chương" tab now IS that heading,
                and two of them one above the other is one too many. */}
            <div className="rail-tabs" role="tablist" aria-label="Nội dung rãnh phải">
              <button
                type="button"
                role="tab"
                id="rail-tab-toc"
                aria-controls="rail-panel-toc"
                aria-selected={railTab === 'toc'}
                onClick={() => setRailTab('toc')}
              >
                Trong chương
              </button>
              <button
                type="button"
                role="tab"
                id="rail-tab-notes"
                aria-controls="rail-panel-notes"
                aria-selected={railTab === 'notes'}
                onClick={() => setRailTab('notes')}
              >
                {`Ghi chú (${annotations.list.length})`}
              </button>
            </div>
            {railTab === 'toc' && (
              <div role="tabpanel" id="rail-panel-toc" aria-labelledby="rail-tab-toc">
                {headings.map((h) => (
                  <a
                    key={h.id}
                    href={`#${h.id}`}
                    className={
                      [h.level === 3 ? 'lvl3' : '', h.id === currentHeadingId ? 'cur' : ''].filter(Boolean).join(' ') ||
                      undefined
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(h.id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    {h.text}
                  </a>
                ))}
              </div>
            )}
            {/* Always mounted, `hidden` while the TOC tab is up: a click on a
                highlight has to be able to open its card (and, below 1241px
                where the rail does not exist at all, the bottom sheet)
                whatever the rail happens to be showing. `visible` is what
                decides whether the COLUMN is built; the component itself has
                work to do either way. */}
            <div
              role="tabpanel"
              id="rail-panel-notes"
              aria-labelledby="rail-tab-notes"
              hidden={railTab !== 'notes'}
            >
              <MarginCards
                content={annotationContent}
                store={annotations}
                visible={railTab === 'notes'}
                focus={cardFocus}
                onFocusChange={focusCard}
              />
            </div>
          </>,
          railEl,
        )}
    </>
  );
}

export default ChapterView;
