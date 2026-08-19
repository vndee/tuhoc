import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { describeCourseError, loadChapter } from '../course/loader';
import type { Chapter } from '../course/types';
import { setChapterContextSource } from './getContext';
import { useCourseKit } from './useCourseKit';

export interface ChapterViewProps {
  courseId: string;
  /** The course's own title — used to build `document.title`, same shape as v1's own "<chapter> — <course>". */
  courseTitle: string;
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
export function ChapterView({ courseId, courseTitle, chapter, prevChapter, nextChapter }: ChapterViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [railEl, setRailEl] = useState<HTMLElement | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [currentHeadingId, setCurrentHeadingId] = useState<string | null>(null);
  const navigate = useNavigate();
  const courseKit = useCourseKit(courseId);

  const chapterQuery = useQuery({
    queryKey: ['course-chapter', courseId, chapter.file],
    queryFn: () => loadChapter(courseId, chapter.file),
  });

  // `#rail` is rendered by <Shell> (Task 9), a sibling of the routed
  // content this component lives in — not a DOM node we can reach via
  // ref. It always exists in the DOM by the time any effect runs (React
  // commits the whole tree before running effects), but NOT yet during
  // this component's own first render, so the portal target is picked up
  // post-commit and stashed in state. This is the standard
  // portal-into-an-externally-owned-node pattern — the lint warning below
  // ("setState in effect can cascade") is the expected/necessary shape of
  // that pattern here: the effect has no dependencies (runs once per
  // mount), the state it sets isn't read by anything the effect itself
  // depends on, so there's no render loop, just the one extra render a
  // portal target discovery always needs.
  useEffect(() => {
    setRailEl(document.getElementById('rail'));
  }, []);

  // Prev/next chapter navigation: topbar `#prev-btn`/`#next-btn` (Task 9
  // left them inert — its own comment names this task as the owner) plus
  // v1's ArrowLeft/ArrowRight shortcuts. Both live here, together, since
  // both need the same prev/next targets and both must stop working the
  // moment this chapter is no longer on screen.
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
      // v1's own guard: don't hijack arrow keys while the reader is typing
      // somewhere (a form field), only Escape gets special treatment there
      // — and Escape/mobile-nav is already useMobileNav's job (Task 10).
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    }
    document.addEventListener('keydown', onKeydown);

    return () => {
      prevBtn?.removeEventListener('click', goPrev);
      nextBtn?.removeEventListener('click', goNext);
      if (prevBtn) prevBtn.disabled = false;
      if (nextBtn) nextBtn.disabled = false;
      document.removeEventListener('keydown', onKeydown);
    };
  }, [courseId, prevChapter, nextChapter, navigate]);

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
    document.title = `${chapter.num ? `${chapter.num} ` : ''}${chapter.title} — ${courseTitle}`;
    window.scrollTo({ top: 0, behavior: 'auto' });

    return () => {
      redraws.splice(redrawsBefore, redrawsAfter - redrawsBefore);
      observer?.disconnect();
      setChapterContextSource(null);
    };
  }, [courseKit.ready, chapterQuery.data, courseId, chapter.id, chapter.num, chapter.title, courseTitle]);

  if (courseKit.error) {
    console.error('useCourseKit failed to load the course runtime', courseKit.error);
    return <p className="ch-lede">Không tải được công cụ đọc (KaTeX/mô phỏng). Hãy thử tải lại trang.</p>;
  }
  if (!courseKit.ready || chapterQuery.isPending) {
    return <p className="ch-lede">Đang tải chương…</p>;
  }
  if (chapterQuery.isError) {
    return <p className="ch-lede">{describeCourseError(chapterQuery.error)}</p>;
  }

  return (
    <>
      <div ref={containerRef} />
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
            {headings.length > 0 && <p className="rail-h">Trong chương này</p>}
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
          </>,
          railEl,
        )}
    </>
  );
}

export default ChapterView;
