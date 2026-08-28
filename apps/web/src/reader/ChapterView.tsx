import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { type CardFocus, MarginCards } from '../annotations/MarginCards';
import { OrphanPanel } from '../annotations/OrphanPanel';
import { SelectionToolbar } from '../annotations/SelectionToolbar';
import { type ChapterContent, useAnnotations } from '../annotations/useAnnotations';
import { AskPanel } from '../ai/AskPanel';
import { DeepDive } from '../ai/DeepDive';
import { type SelectionExcerpt, chapterSystemPrompt } from '../ai/prompts';
import { useMe } from '../api/useMe';
import { describeCourseError, loadChapter } from '../course/loader';
import { useLanguage } from '../i18n/LanguageProvider';
import type { Chapter, Part } from '../course/types';
import { startHeartbeat } from '../progress/heartbeat';
import { useProgress } from '../progress/useProgress';
import { useVaultFrame } from '../shell/VaultFrame';
import { useThemeContext } from '../theme/ThemeContext';
import { setChapterContextSource } from './getContext';
import { injectExerciseCheckboxes } from './injectExerciseCheckboxes';
import { readingProgressWidth } from './readingProgress';
import { rewriteAssetUrls } from './rewriteAssetUrls';
import { TocDrawer } from './TocDrawer';
import { useCourseKit } from './useCourseKit';
import { WidgetFrame } from './WidgetFrame';

export interface ChapterViewProps {
  courseId: string;
  /** The course's own title — used to build `document.title`, same shape as v1's own "<chapter> — <course>". */
  courseTitle: string;
  /** The title of the part (manifest.parts[].title) this chapter belongs to — used for the `#crumb` breadcrumb only; `prevChapter`/`nextChapter` deliberately don't carry this. */
  partTitle: string;
  chapter: Chapter;
  prevChapter: Chapter | null;
  nextChapter: Chapter | null;
  /**
   * The course's whole outline, for the table-of-contents drawer.
   *
   * Passed down from `Reader`, which already holds the manifest, rather than
   * fetched here off the shared query key the way `Sidebar` does it. Both
   * would be a cache hit at runtime; the difference is in the tests, and it
   * is not a small one. `ChapterView.test.tsx` runs MSW with
   * `onUnhandledRequest: 'error'`, so a manifest fetch appearing inside this
   * component would turn every test in that file (and in
   * `leaveChapter.test.tsx`) into a network-error test until each one grew a
   * handler for a request it does not care about. A prop is also the honest
   * shape: this component is already handed `courseTitle`, `partTitle` and
   * both neighbours off exactly this manifest.
   */
  parts: readonly Part[];
}

interface HeadingEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * One `<div data-widget>` placeholder found in the chapter's `innerHTML`,
 * paired with the widget it resolved to — `node` is what `createPortal`
 * mounts a `<WidgetFrame>` into, in the render below. Built fresh by the
 * main content effect every time it runs (own `key` per placeholder so a
 * later chapter's placeholders are never confused with an earlier one's —
 * see that effect's comment).
 */
interface WidgetTarget {
  key: string;
  node: HTMLElement;
  name: string;
  html: string;
}

/**
 * Renders one chapter: fetches its HTML fragment (plus its widgets), injects
 * the HTML into a DOM node React never diffs (see the module doc below),
 * runs `CourseKit.renderKatex` over it, mounts each `<div data-widget>`
 * placeholder's `<WidgetFrame>` via a portal, builds the right-rail TOC and
 * the in-content pager, and wires the pager keyboard shortcuts + topbar
 * prev/next buttons. `getContext()` (src/reader/getContext.ts) reads
 * whatever chapter this component most recently registered.
 *
 * DOM ownership: `containerRef`'s `<div>` is never given React children as
 * markup — its content is set imperatively via `innerHTML`. This is
 * deliberate: React only ever sees an empty `<div ref={containerRef} />` in
 * its own vdom, so it never has anything to reconcile there and won't fight
 * the imperative write on a later re-render (the trap called out in the
 * task brief: `dangerouslySetInnerHTML` would fight both the re-render
 * replacement and script tags not executing; a plain ref'd node sidesteps
 * both). React DOES reach back into that subtree, but only through
 * `createPortal` — see `widgetTargets` below — which is how a widget's
 * `<iframe>` gets to be a real React-owned component even though its parent
 * node was never in React's own tree.
 */
export function ChapterView({
  courseId,
  courseTitle,
  partTitle,
  chapter,
  prevChapter,
  nextChapter,
  parts,
}: ChapterViewProps) {
  const { lang, t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const [railEl, setRailEl] = useState<HTMLElement | null>(null);
  const [crumbEl, setCrumbEl] = useState<HTMLElement | null>(null);
  // The two reading-mode topbar slots `<Topbar>` renders on every route (see
  // its doc comment for why two, and why unconditionally).
  const [navSlotEl, setNavSlotEl] = useState<HTMLElement | null>(null);
  const [notesSlotEl, setNotesSlotEl] = useState<HTMLElement | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [currentHeadingId, setCurrentHeadingId] = useState<string | null>(null);
  const [widgetTargets, setWidgetTargets] = useState<WidgetTarget[]>([]);
  const navigate = useNavigate();
  const courseKit = useCourseKit(courseId);
  // Only `toggle` is needed here — the reader never displays the theme
  // icon itself, that's `#theme-btn`'s job (Topbar, via AppShell). Reading
  // this through the shared context (not a second `useTheme()` call) is
  // debt #2's whole point — see ThemeContext.tsx's doc comment.
  const { toggle: toggleTheme } = useThemeContext();

  /**
   * Task 12 — courses are free to read with no account; signing in is what
   * makes progress, notes and AI conversations follow a reader between
   * devices (spec §2.4). Everything that WRITES for this chapter —
   * annotations, progress, the study heartbeat — lives in `AuthedReaderExtras`
   * below, mounted only once `confirmedLoggedIn` is true. That component is
   * the ONLY place those hooks are called; this component never calls
   * `useAnnotations`/`useProgress` itself, and never branches a hook call on
   * these booleans (React's rules of hooks forbid that) — it only ever
   * branches whether the CHILD COMPONENT mounts.
   *
   * `confirmedLoggedIn`/`confirmedLoggedOut` are deliberately NOT each
   * other's negation. `useMe()` is `undefined`-shaped while pending and
   * `isError` on a 500 (see its own doc comment) — both cases where the
   * server has NOT said "nobody is signed in" in so many words, so neither
   * one is "logged out" and neither one is "logged in". Getting this wrong in
   * either direction is a real, visible bug: mounting `AuthedReaderExtras`
   * on a guess would let a still-unconfirmed visitor's clicks start writing
   * before the server ever confirmed who they are; showing the nudge on a
   * guess would flash "đăng nhập để…" at an already-signed-in reader for the
   * one request `useMe()` takes to settle.
   */
  const me = useMe();
  const confirmedLoggedIn = me.isSuccess && me.data != null;
  const confirmedLoggedOut = me.isSuccess && me.data == null;

  // The table-of-contents drawer's "done" marks (Ruling F4-adjacent) — public
  // UI (every reader gets a TOC), fed by session-only data. Stays the empty
  // set for as long as nobody is confirmed signed in, which is the honest
  // reading: there is no server-recorded progress to show yet. Lifted up
  // rather than read here directly for the same rules-of-hooks reason as
  // above — `AuthedReaderExtras` is the one place `useProgress` runs, and it
  // reports back through `onDoneChapterIdsChange`.
  const [doneChapterIds, setDoneChapterIds] = useState<ReadonlySet<string>>(new Set());

  // P2 Task 4: the annotation store resolves this chapter's stored anchors
  // against the DOM below and paints the highlights in. It has to be told when
  // the content under `containerRef` was REPLACED — the element identity never
  // changes (the main effect swaps `innerHTML` on the same `<div>`), so a
  // counter bumped by that effect is the only honest signal that every
  // `<mark>` is gone and every anchor needs resolving again.
  //
  // This state stays HERE (not inside `AuthedReaderExtras`) even though only
  // that component's `useAnnotations` reads it for creating/painting notes:
  // `askAboutChapter` below (public — asking the AI about a chapter needs no
  // account) reads `annotationContent.root` too, and it is the SAME container
  // `AuthedReaderExtras`'s exercise-checkbox injection needs — see that
  // component's own doc for why reusing this one revision-counted signal,
  // rather than `chapterQuery.data`/`courseKit.ready` directly, is what keeps
  // the checkbox injection correctly ordered after the innerHTML write below.
  const [annotationContent, setAnnotationContent] = useState<ChapterContent>({ root: null, revision: 0 });

  const [tocOpen, setTocOpen] = useState(false);

  /**
   * Hệ thống con 2, Task 7 + 8. Trợ lý AI có ĐÚNG HAI lối vào từ chương này —
   * hỏi về cả chương, và "Đào sâu" một đoạn bôi đen — nên chúng là hai nhánh
   * của MỘT trạng thái, không phải hai cờ. Hai cờ cho phép cả hai panel mở
   * cùng lúc, và hai panel cùng gọi kho khoá là hai hoá đơn cho một câu hỏi.
   *
   * Lời nhắc được dựng **lúc mở**, không phải mỗi lần render: nó đọc cả cây
   * chương, và dựng lại nó ở mỗi lần gõ một ký tự vào ô câu hỏi là quét ~20.000
   * ký tự cho mỗi phím bấm.
   */
  const [ai, setAi] = useState<
    { kind: 'chapter'; system: string } | { kind: 'dive'; excerpt: SelectionExcerpt } | null
  >(null);
  /** `null` ⇒ bản dựng này không có kho khoá; khi ấy KHÔNG mời gì cả. Một nút
   *  dẫn tới một câu "tính năng này không có" tệ hơn là không có nút. */
  const { origin: vaultOrigin } = useVaultFrame();
  const aiReady = vaultOrigin !== null;

  const askAboutChapter = useCallback(() => {
    const root = annotationContent.root;
    if (!root) return;
    // Mục người học đang đọc, lấy từ CÙNG tín hiệu đang tô sáng mục lục trong
    // ngăn kéo — không phải một phép đo cuộn thứ hai, vốn sẽ trả lời khác nó.
    const focusEl =
      Array.from(root.querySelectorAll('h2, h3')).find((h) => h.id === currentHeadingId) ?? null;
    const built = chapterSystemPrompt(root, {
      lang,
      courseTitle,
      chapterTitle: chapter.title,
      focusEl,
    });
    setAi({ kind: 'chapter', system: built.system });
  }, [annotationContent.root, currentHeadingId, courseTitle, chapter.title, lang]);

  const closeAi = useCallback(() => {
    setAi(null);
  }, []);

  // Đổi chương là đổi chủ đề: một panel còn mở đang mang ngữ cảnh của chương
  // cũ, và câu trả lời tiếp theo sẽ nói về một chương người học đã rời khỏi.
  useEffect(() => {
    setAi(null);
  }, [chapter.id]);

  const closeToc = useCallback(() => setTocOpen(false), []);

  const chapterQuery = useQuery({
    queryKey: ['course-chapter', courseId, chapter.id],
    queryFn: () => loadChapter(courseId, chapter.id),
  });

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
  //
  // ── `#crumb` KHÔNG được portal vào thẳng — S2 Task 10, đo được ─────────
  // `#rail` là `<aside id="rail">{rail}</aside>`: con của nó luôn là một
  // PHẦN TỬ React (`<Rail/>`), nên react-dom không bao giờ commit nó bằng
  // đường tắt văn bản. `#crumb` thì khác — `<Topbar>` dựng nó là
  // `<div id="crumb">{!isChapterRoute && 'Tuhoc'}</div>`, và khi rời chương
  // `children` của nó đổi từ `false` sang một CHUỖI. react-dom coi
  // `children` kiểu chuỗi là trường hợp riêng và commit nó bằng
  // `setTextContent(node, …)` — tức `node.textContent = …` — thứ **xoá sạch
  // mọi con**, kể cả những nút portal mà React vẫn tin là mình đang giữ.
  // Commit ngay sau đó React tháo portal và gọi
  // `crumb.removeChild(<span class="crumb-part">)` trên một nút đã không còn
  // là con:
  //
  //     NotFoundError: Failed to execute 'removeChild' on 'Node'
  //
  // ném GIỮA giai đoạn commit, nên cả lần chuyển route bị bỏ dở: URL đã đổi
  // (history đổi trước), nội dung thì không. Đó là toàn bộ lỗi "bấm liên kết
  // trong chương thì không đi đâu cả".
  //
  // Bản sửa: portal vào một nút **của chính component này**, treo dưới
  // `#crumb`. Khi `#crumb` bị dọn bằng `textContent`, nút ấy bị tách ra
  // NGUYÊN VẸN cùng con của nó, nên `removeChild` của React vẫn tìm thấy
  // đúng cha nó cần và không có gì ném; `host.remove()` ở cleanup là no-op
  // khi nút đã bị tách.
  //
  // Sửa ở ĐÂY chứ không ở `<Topbar>` là có chủ ý. Đo được bằng ba nhánh đối
  // chứng (xem báo cáo): đổi `'Tuhoc'` thành `<>Tuhoc</>` cũng hết ném — DOM
  // ra y hệt, chỉ khác đường commit — nhưng đó là sửa MỘT trường hợp. Bên đi
  // mượn nút DOM của người khác là component này, nên bất biến "portal của
  // chương phải sống sót được việc chủ nút viết lại nội dung nút" thuộc về
  // nó, và bản sửa này đúng với MỌI cách viết (`children` chuỗi,
  // `dangerouslySetInnerHTML`, một `innerHTML` mệnh lệnh nào đó về sau).
  //
  // Một `<span>` trần: `reader.css` chỉ có `#crumb b` và `#crumb .crumb-part`
  // — đều là bộ chọn hậu duệ — nên một lớp bọc inline không đổi gì về trình
  // bày, và `#crumb`'s `text-overflow:ellipsis` vẫn đo trên chính `#crumb`.
  //
  // `#reader-nav`/`#reader-notes` join `#rail` in the plain-lookup half of
  // this effect rather than the append-a-host half: like `#rail`, they are
  // nodes `<Topbar>` renders as React ELEMENTS and never as text, on every
  // route, so there is no `setTextContent` fast path that could ever sweep a
  // portal's children out of them. See `Topbar.tsx`'s own doc.
  useEffect(() => {
    setRailEl(document.getElementById('rail'));
    setNavSlotEl(document.getElementById('reader-nav'));
    setNotesSlotEl(document.getElementById('reader-notes'));

    const crumb = document.getElementById('crumb');
    if (!crumb) return;
    const host = document.createElement('span');
    // Không phải trang trí: đây là dấu cho người đọc DOM biết nút này có chủ,
    // và là thứ `leaveChapter.test.tsx` chỉ vào khi giải thích vì sao nó tồn tại.
    host.dataset.chapterCrumb = '';
    crumb.appendChild(host);
    setCrumbEl(host);

    return () => {
      // `ChildNode.remove()`, không phải `crumb.removeChild(host)`: nếu
      // `#crumb` đã bị chủ của nó dọn sạch thì `host` không còn cha, và
      // `removeChild` sẽ ném đúng cái lỗi mà cả khối này tồn tại để tránh.
      host.remove();
    };
  }, []);

  // Prev/next chapter navigation: topbar `#prev-btn`/`#next-btn` (Task 9
  // left them inert — its own comment names this task as the owner) plus
  // v1's ArrowLeft/ArrowRight shortcuts. Both live here, together, since
  // both need the same prev/next targets and both must stop working the
  // moment this chapter is no longer on screen.
  //
  // The `t`/`T` theme shortcut (debt #2, v1 parity — the v1 single-file
  // source, line 11170) rides the SAME keydown handler and
  // the SAME "not while typing in a form field" guard, rather than a
  // second global listener: v1 itself has exactly one keydown handler for
  // all of these shortcuts, and `toggleTheme` here is the identical
  // function `#theme-btn` calls (via `useThemeContext()`, not a second
  // `useTheme()` instance — see ThemeContext.tsx), so the topbar icon can
  // never desync from a shortcut pressed while a chapter is open.
  //
  // `c` — mục lục — rides the same handler for the same reason. It is the one
  // shortcut chế độ đọc adds, and it is added because the table of contents
  // stopped being a column you can glance at: it is now behind a button, and a
  // thing behind a button in a reading view wants a key. Not `m`: `t` already
  // proves this handler owns single letters, and `m` is one keystroke away
  // from `#mark-btn`'s job — a reader reaching for "mark read" and getting a
  // drawer would learn to distrust both.
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
      // Toggle, not open: the key that brings the drawer out is the obvious
      // key to press again to put it away. Escape closes it too (TocDrawer
      // owns that, and only while it is open, so it does not compete with the
      // AI panel's or the note sheet's Escape).
      else if (e.key === 'c' || e.key === 'C') setTocOpen((open) => !open);
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
  // a node this component's own JSX ever produces.
  //
  // Task 12: the CLICK wiring (`.on` class, ○/✓ icon, label, the toggle
  // itself) moved into `AuthedReaderExtras` along with `useProgress` — see
  // that component's own doc. What stays HERE is the one thing that has to
  // run whether or not that component is even mounted: `<Topbar>` renders
  // `#mark-btn` UNCONDITIONALLY on every chapter route (`hidden={!isChapterRoute}`
  // — a holdover from when reading a chapter always implied a session), so an
  // anonymous visitor would otherwise see a "Đánh dấu đã học" button that is
  // simply never wired to anything — the exact "a control that appears and
  // does nothing" shape this task's brief calls out as worse than no control
  // at all. Hiding it here, keyed on the same `confirmedLoggedIn` that gates
  // `AuthedReaderExtras`, is the fix; no cleanup is needed; leaving a chapter
  // route changes `<Topbar>`'s OWN `hidden` prop, which wins on the next
  // render regardless of whatever this effect last set.
  useEffect(() => {
    const markBtn = document.getElementById('mark-btn');
    if (markBtn) markBtn.hidden = !confirmedLoggedIn;
  }, [confirmedLoggedIn]);

  /**
   * `#progbar` — how far through the chapter the reader is, as ONE THIN LINE.
   *
   * `<Shell>` has rendered `#progwrap > #progbar` since P1 and `reader.css`
   * has styled it since the v1 port, and until now nothing in the repo ever
   * wrote to it: a grep for `progbar` across `src/` found the skeleton, the
   * stylesheet and two tests asserting the elements exist. It was a 3px grey
   * strip on every page of the product, permanently at `width: 0`. It is
   * wired here because chế độ đọc asks it to carry what a whole column used
   * to: the reader's place in the chapter, which the rail's highlighted TOC
   * entry used to show and which nothing shows once the rail is a margin.
   *
   * Imperative, and not through React state, for `MarginCards`' reason: this
   * runs on every scroll frame, and a `setState` per frame is a re-render of
   * the entire chapter subtree per frame. `style.width` on a bar cannot
   * change what the next frame measures, so nothing here can loop.
   *
   * Three triggers, and the third is the one that is easy to miss: scroll,
   * resize, and the DOCUMENT GETTING TALLER. A chapter's height is not final
   * when its HTML lands — KaTeX relays out every formula, images arrive —
   * so a bar measured once at load reports a position against a document
   * that no longer exists. `ResizeObserver` on `<html>` is the honest signal
   * for that and is guarded because jsdom has none.
   */
  useEffect(() => {
    const bar = document.getElementById('progbar');
    if (!bar) return;

    let frame = 0;
    const paint = () => {
      frame = 0;
      bar.style.width = readingProgressWidth({
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
      });
    };
    // One paint per animation frame at most. `scroll` fires far more often
    // than the screen refreshes, and every extra call is a forced layout read.
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(paint);
    };

    paint();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(document.documentElement);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      // Back to reader.css's own `width: 0`. Same discipline as
      // `#mark-btn`/`#prev-btn` above: this bar is chrome that outlives the
      // chapter, and a line left at 62% on `/courses` is a claim about a page
      // that has no chapters in it.
      bar.style.width = '';
    };
  }, []);

  // The main render pipeline: set the fragment's HTML, then renderKatex
  // (KaTeX must lay out its DOM before anything else reads the container's
  // layout), then resolve widget placeholders, then derive the rail TOC and
  // register this chapter with getContext().
  useEffect(() => {
    if (!courseKit.ready) return;
    const data = chapterQuery.data;
    if (data == null) return;
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
    container.innerHTML = data.html;

    // Final whole-branch review, Important 2: a chapter's package-relative
    // `<img src>`/`<source src>`/`<a href>` values are relative to the
    // PACKAGE, not to this SPA's document URL — resolved here, right after
    // the innerHTML write that produces the tree they live in, and before
    // anything (KaTeX, widget wiring) reads that tree. See
    // rewriteAssetUrls.ts's own doc comment for why this cannot be left to
    // the browser.
    rewriteAssetUrls(container, courseId);

    CourseKit.renderKatex(container);

    // Widgets: a chapter marks a widget's place with `<div data-widget=
    // "name">`, dropped in by the SAME innerHTML write above — so this has
    // to run after it, on the fragment that write just produced. Matched by
    // name against `data.widgets` (the payload's own list, see
    // `ChapterPayload` in `api/catalog.ts`); a name with no match leaves the
    // placeholder empty rather than throwing, since the server already
    // rejects any chapter whose widget refs don't resolve (WIDGET_* rules,
    // Tasks 2/7) — the only way to hit that here is a stale client cache of
    // an old, already-superseded chapter payload.
    //
    // `key` carries `chapter.id` so a widget of the same name in a
    // DIFFERENT chapter is never mistaken for the same portal target by
    // React's reconciler — the placeholder `node` for each is itself a
    // fresh element from the innerHTML write above, never reused across
    // chapters.
    const widgetsByName = new Map(data.widgets.map((w) => [w.name, w] as const));
    const placeholders = Array.from(container.querySelectorAll<HTMLElement>('div[data-widget]'));
    setWidgetTargets(
      placeholders.flatMap((node, i) => {
        const widget = widgetsByName.get(node.dataset.widget ?? '');
        if (!widget) return [];
        return [{ key: `${chapter.id}-${i}`, node, name: widget.name, html: widget.html }];
      }),
    );

    // The chapter's own outline, ported from v1's buildRail(): one entry per
    // h2/h3, keeping any id the fragment already carries (cross-references
    // rely on it) and only inventing one where none exists. It is read by
    // `<TocDrawer>` now rather than by a rail column, but it is derived here
    // for the reason it always was — this is the only place that has the
    // chapter's DOM — and `currentHeadingId` below still feeds BOTH the
    // drawer's highlight and `askAboutChapter`'s notion of what the reader is
    // looking at, from one measurement rather than two that can disagree.
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
    // Last, and only after KaTeX/TOC have finished with the container:
    // annotation anchors are resolved against the DOM as the reader sees it,
    // and `normalize.ts` is built to ignore exactly what a widget
    // placeholder's own subtree looks like. Resolving before that ran would
    // anchor against text that is about to change shape.
    setAnnotationContent((prev) => ({ root: container, revision: prev.revision + 1 }));
    document.title = `${chapter.num ? `${chapter.num} ` : ''}${chapter.title} — ${courseTitle}`;
    window.scrollTo({ top: 0, behavior: 'auto' });

    return () => {
      observer?.disconnect();
      setChapterContextSource(null);
    };
  }, [courseKit.ready, chapterQuery.data, courseId, chapter.id, chapter.num, chapter.title, courseTitle]);

  // Error checks come before the pending check: `!courseKit.ready` is true
  // for the whole time scripts are loading, so if it were checked first, a
  // chapter fetch that fails *while* scripts are still loading would show
  // "Đang tải chương…" instead of the real error until courseKit happened
  // to settle too — silently hiding a genuine failure behind a loading spinner.
  //
  // ── Vì sao ba trạng thái này KHÔNG còn `return` sớm ───────────────────────
  // They used to return the message on its own, and in the three-column layout
  // that was harmless: `#sidebar` was still standing next to it with the whole
  // course outline and every global link in it. Reading mode takes the sidebar
  // away, so an early return would leave a reader who hit a failed fetch —
  // that is, the exact reader who most needs to get out — on a page with one
  // sentence of error text and NO way off it but the browser's back button.
  //
  // So the chapter BODY becomes a value, and the reading chrome around it (the
  // way out, the table of contents, the notes margin) is rendered in every
  // state. The container `<div>` is still built only when there is something
  // to put in it, which is what the main render pipeline's
  // `if (!container) return` has always relied on.
  let body: ReactNode;
  if (courseKit.error) {
    console.error('useCourseKit failed to load the course runtime', courseKit.error);
    body = <p className="ch-lede">{t('reader.kitFailed')}</p>;
  } else if (chapterQuery.isError) {
    body = <p className="ch-lede">{describeCourseError(chapterQuery.error, t)}</p>;
  } else if (!courseKit.ready || chapterQuery.isPending) {
    body = <p className="ch-lede">{t('reader.chapterLoading')}</p>;
  } else {
    // A plain element, NOT a nested `<ChapterBody/>` component. A component
    // declared inside this function gets a new identity on every render, and
    // React remounts the whole subtree when a type changes — which would blow
    // away `containerRef`'s `<div>`, and with it every widget iframe portalled
    // inside it, on every keystroke anywhere in the chapter. That is this
    // file's opening trap, reached from a different direction.
    body = (
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
      {/* Task 12 — once, quietly, at the top of the chapter: not a modal, not
          an interstitial, and shown only once `useMe()` has SETTLED on "nobody
          is signed in" (`confirmedLoggedOut`), never on a guess. See this
          component's own doc for why that is not simply `!confirmedLoggedIn`. */}
      {confirmedLoggedOut && <p className="reader-anon-nudge">{t('reader.anonNudge')}</p>}
      <div ref={containerRef} />
      {/* One `<WidgetFrame>` portalled into each placeholder `widgetTargets`
          found inside `containerRef`'s subtree — the innerHTML write put
          those placeholder `<div>`s there, so this is the one legitimate way
          for React to own a component whose parent node it never rendered.
          `key` is `widgetTargets`' own per-placeholder key (chapter id +
          index), not `w.name`: see that state's own doc comment for why a
          same-named widget in a later chapter must never be treated as "the
          same" portal. */}
      {widgetTargets.map((w) => createPortal(<WidgetFrame name={w.name} html={w.html} />, w.node, w.key))}
      {/* Everything that WRITES for this chapter — annotations (and the
          toolbar that creates them), progress (and the exercise checkboxes,
          and `#mark-btn`'s click handling), the study heartbeat — lives here,
          mounted only once a session is confirmed. See `AuthedReaderExtras`'s
          own doc for the full accounting of what is and is not inside it. */}
      {confirmedLoggedIn && (
        <AuthedReaderExtras
          courseId={courseId}
          chapter={chapter}
          content={annotationContent}
          railEl={railEl}
          notesSlotEl={notesSlotEl}
          onDeepDive={aiReady ? (excerpt) => setAi({ kind: 'dive', excerpt }) : undefined}
          onDoneChapterIdsChange={setDoneChapterIds}
        />
      )}
      {aiReady && (
        <>
          {/*
            BONG BÓNG NỔI, không phải một nút nằm trong dòng chữ.

            Nút này vốn đứng ở cuối phần nội dung, nên muốn hỏi về chương thì
            phải cuộn xuống tận đấy tìm nó — hoặc bôi đen một đoạn, thứ chỉ hợp
            khi câu hỏi thuộc về đúng đoạn ấy. Người dùng nói đúng: phải mở được
            BẤT KỲ LÚC NÀO.

            Ẩn khi panel đang mở: một bong bóng "mở chat" nổi ngay cạnh khung
            chat đang mở là một nút không làm gì.
          */}
          {ai === null && (
            <button
              type="button"
              className="ai-launch ai-launch-fab"
              onClick={askAboutChapter}
              disabled={annotationContent.root === null}
              aria-label={t('reader.askAi')}
              title={t('reader.askAi')}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M17 9.5c0 3.2-3.1 5.8-7 5.8-.9 0-1.7-.1-2.5-.4L3 16.5l1.3-3.2A5.4 5.4 0 013 9.5C3 6.3 6.1 3.7 10 3.7s7 2.6 7 5.8z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          {ai?.kind === 'chapter' && (
            <AskPanel heading={t('reader.askHeading')} system={ai.system} onClose={closeAi} />
          )}
          {ai?.kind === 'dive' && (
            <DeepDive
              courseTitle={courseTitle}
              chapterTitle={chapter.title}
              excerpt={ai.excerpt}
              onClose={closeAi}
            />
          )}
        </>
      )}
      {(prevChapter || nextChapter) && (
        <div className="pager">
          {prevChapter && (
            <Link className="prev" to={`/c/${courseId}/${prevChapter.id}`}>
              <div className="dir">{t('reader.prev')}</div>
              <div className="nm">
                {prevChapter.num ? `${prevChapter.num} · ` : ''}
                {prevChapter.short}
              </div>
            </Link>
          )}
          {nextChapter && (
            <Link className="next" to={`/c/${courseId}/${nextChapter.id}`}>
              <div className="dir">{t('reader.next')}</div>
              <div className="nm">
                {nextChapter.num ? `${nextChapter.num} · ` : ''}
                {nextChapter.short}
              </div>
            </Link>
          )}
        </div>
      )}
      </>
    );
  }

  return (
    <>
      {body}
      {/* ── Thanh trên của chế độ đọc, nhóm TRÁI ────────────────────────────
          MỘT lối ra, không phải năm. Reading mode hides `#sidebar` entirely
          (styles/reader-layout.css), and with it the five flat nav links that
          the đặc tả names as the original problem; this link is what replaces
          all of them. It goes to `/` — "Học tiếp" — because that is where the
          canvas's own flow arrow points ("Chế độ đọc → thoát → Học tiếp"), and
          because `/` is the one screen that always has somewhere to go next. */}
      {navSlotEl &&
        createPortal(
          <>
            <Link className="rd-exit" to="/" aria-label={t('reader.exitAria')} title={t('reader.exitAria')}>
              <span aria-hidden="true">←</span> <span className="rd-lbl">{t('reader.exit')}</span>
            </Link>
            <button
              type="button"
              className="tb-btn rd-toc-btn"
              // `aria-expanded` + `aria-controls` rather than a bare label:
              // the drawer is always in the DOM (see TocDrawer's doc), so a
              // screen reader needs to be told whether it is currently open,
              // and this is the only element that knows.
              aria-expanded={tocOpen}
              aria-controls="reader-toc-drawer"
              title={tocOpen ? t('reader.tocClose') : t('reader.tocOpen')}
              onClick={() => setTocOpen((open) => !open)}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 5.5h12M4 10h12M4 14.5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>{' '}
              <span className="rd-lbl">{t('reader.toc')}</span>
            </button>
          </>,
          navSlotEl,
        )}

      {/* ── Thanh trên của chế độ đọc, nhóm PHẢI: nút "Ghi chú (N)" ─────────
          Task 12: this button — and the margin column it governs — only
          exists at all once `AuthedReaderExtras` mounts (below). It, and not
          `ChapterView`, now owns `notesOn`/the notes count, since creating and
          reading back a note is exactly the kind of write an anonymous reader
          must not be offered a control for. See that component's own doc. */}

      {/* Mục lục — ngăn kéo, không phải cột. Renders into `document.body`
          (its own portal), so its position in this JSX is about ownership.
          Public UI (every reader gets a table of contents); `doneChapterIds`
          is the one session-only ingredient, and stays the empty set — never
          the WRONG reader's set — until `AuthedReaderExtras` reports one in. */}
      <TocDrawer
        open={tocOpen}
        onClose={closeToc}
        courseId={courseId}
        courseTitle={courseTitle}
        currentChapterId={chapter.id}
        parts={parts}
        doneChapterIds={doneChapterIds}
        headings={headings}
        currentHeadingId={currentHeadingId}
      />
    </>
  );
}

/**
 * Everything about this chapter that only makes sense for a reader the
 * server has confirmed (Task 12, spec §2.4 — courses are free to read; an
 * account is what makes progress, notes and AI conversations follow a reader
 * between devices). `ChapterView` mounts this ONLY once `useMe()` has
 * settled on a real user — never conditionally calls a hook itself. That is
 * the whole reason this is a separate component and not an `if` inside
 * `ChapterView`: `useAnnotations`, `useProgress` and the study heartbeat all
 * have to run unconditionally *somewhere*, and "somewhere" has to be a
 * component whose OWN mounting is the condition (React's rules of hooks
 * forbid a hook call guarded by an `if`), not a branch around the calls.
 *
 * What lives here, and why:
 *  - `useAnnotations` + `<SelectionToolbar>` (creates a highlight/note) +
 *    `<MarginCards>`/`<OrphanPanel>` (reads them back) + the "Ghi chú (N)"
 *    toggle button — creating and painting an annotation is writing to
 *    `db.annotations`, which syncs to the server under THIS reader's
 *    account; an anonymous highlight would have nowhere of its own to live.
 *  - `useProgress` + the exercise checkboxes — same reasoning, for
 *    `db.progress`. Nothing else in the tree can create a `.box.ex .box-h`
 *    checkbox, so an anonymous chapter simply renders with none of them, not
 *    with dead ones — a checkbox that appears and does nothing is worse than
 *    one that is absent.
 *  - The `#mark-btn` CLICK wiring (icon/label/class + the toggle itself).
 *    `ChapterView` still hides the button itself whenever this component is
 *    not mounted (its own effect, keyed on the same `confirmedLoggedIn`) —
 *    the same "worse than absent" reasoning applies to it too.
 *  - The study heartbeat (`startHeartbeat`) — it queues `db.outbox` rows
 *    attributed to an account; there is no account to attribute them to for
 *    an anonymous visit.
 *
 * What does NOT live here, deliberately — see `ChapterView`'s own doc for the
 * full reasoning on each: the chapter's HTML/KaTeX/widget rendering, the
 * table of contents, and the reading-progress bar (`#progbar`). None of them
 * read or write anything about a specific reader; they are exactly as public
 * as the chapter text itself.
 */
interface AuthedReaderExtrasProps {
  courseId: string;
  chapter: Chapter;
  /** Same object `ChapterView` itself reads for `askAboutChapter` — passing
   * anything else here would give the chapter TWO live `useAnnotations`
   * instances, each painting every highlight (the trap that hook's own doc
   * names). Doubles as the "chapter DOM is ready" signal for the exercise-
   * checkbox effect below, for the same reason `useAnnotations` already
   * keys its own resolve-and-paint pass off it. */
  content: ChapterContent;
  railEl: HTMLElement | null;
  notesSlotEl: HTMLElement | null;
  onDeepDive: ((excerpt: SelectionExcerpt) => void) | undefined;
  /** Reports this course's local progress UP to `ChapterView`'s TocDrawer —
   * see `ChapterView`'s own doc for why the flow runs this direction instead
   * of `TocDrawer`/`ChapterView` calling `useProgress` themselves. */
  onDoneChapterIdsChange: (ids: ReadonlySet<string>) => void;
}

function AuthedReaderExtras({
  courseId,
  chapter,
  content,
  railEl,
  notesSlotEl,
  onDeepDive,
  onDoneChapterIdsChange,
}: AuthedReaderExtrasProps) {
  const { t } = useLanguage();
  const annotations = useAnnotations(courseId, chapter.id, content);
  const progress = useProgress(courseId);

  // `notesOn`/`cardFocus`/`reattaching` — see `ChapterView`'s original P2
  // Task 6/7 doc comments (git history) for the full reasoning; unchanged by
  // this move except that they now live beside the hooks they gate.
  const [notesOn, setNotesOn] = useState(true);
  const [cardFocus, setCardFocus] = useState<CardFocus | null>(null);
  const [reattaching, setReattaching] = useState<string | null>(null);

  const focusCard = useCallback((next: CardFocus | null) => {
    setCardFocus(next);
    if (next) setNotesOn(true);
  }, []);

  const requestNote = useCallback((id: string) => focusCard({ id, edit: true }), [focusCard]);

  useEffect(() => {
    onDoneChapterIdsChange(progress.doneChapterIds);
  }, [progress.doneChapterIds, onDoneChapterIdsChange]);

  useEffect(() => {
    if (!railEl) return;
    railEl.classList.toggle('rail-notes', notesOn);
    return () => railEl.classList.remove('rail-notes');
  }, [railEl, notesOn]);

  useEffect(() => {
    setCardFocus(null);
    setReattaching(null);
  }, [chapter.id]);

  // Kept current on every render (not inside an effect — a plain assignment
  // during render is enough, since `startHeartbeat`'s tick only ever reads
  // this ref asynchronously, well after React has committed) so the mount
  // effect below can hand `startHeartbeat` a getter that always answers
  // "whichever chapter is open right now," never a value frozen at mount
  // time.
  const heartbeatCtxRef = useRef<{ courseId: string; chapterId: string } | null>(null);
  heartbeatCtxRef.current = { courseId, chapterId: chapter.id };

  // Task 15: the study heartbeat. Started ONCE per mount (`[]` deps) — this
  // component stays mounted across in-course chapter navigation exactly like
  // `ChapterView` itself does (same instance, not remounted), so restarting
  // the interval on every chapter would reset the 30s cadence/60s activity
  // window for no reason. `getCtx` reads `heartbeatCtxRef` above instead, so
  // each tick still gets attributed to whatever chapter is open AT THAT TICK.
  useEffect(() => {
    return startHeartbeat(() => heartbeatCtxRef.current);
  }, []);

  // `#mark-btn`'s click wiring. `ChapterView` owns showing/hiding the button
  // itself (it must do that whether or not THIS component is even mounted);
  // this is the rest of v1's `syncMark()` — icon/label/class, re-applied
  // whenever `isRead` for THIS chapter changes, including a change that did
  // not originate from this button (a remote sync pull, for instance).
  const isChapterRead = progress.isRead(chapter.id);
  useEffect(() => {
    const markBtn = document.getElementById('mark-btn');
    if (!markBtn) return;

    markBtn.classList.toggle('on', isChapterRead);
    markBtn.title = t(isChapterRead ? 'reader.markUnread' : 'topbar.markRead');
    // `<Topbar>` sets a static `aria-label` on this button, which — per the
    // accessible-name computation rules — takes precedence over its visible
    // text content. Updating only `.mk-lbl`'s text below without also
    // updating `aria-label` here would leave a screen reader announcing
    // "Đánh dấu đã học" forever, even once the chapter IS marked read.
    markBtn.setAttribute('aria-label', t(isChapterRead ? 'reader.markUnread' : 'topbar.markRead'));
    const icon = markBtn.querySelector('.mk-ico');
    if (icon) icon.textContent = isChapterRead ? '✓' : '○';
    const label = markBtn.querySelector('.mk-lbl');
    if (label) label.textContent = t(isChapterRead ? 'reader.read' : 'topbar.markRead');

    const handleClick = () => progress.toggleRead(chapter.id);
    markBtn.addEventListener('click', handleClick);
    return () => {
      markBtn.removeEventListener('click', handleClick);
      // Reset to the neutral "off" default. This cleanup also runs between
      // chapters (not only on true unmount or on sign-out), but that is
      // harmless for the same reason `ChapterView`'s `#prev-btn`/`#next-btn`
      // cleanup is: if a new chapter (or a still-signed-in re-render) is
      // mounting right after, its own effect run sets the right state before
      // the browser paints.
      markBtn.classList.remove('on');
      markBtn.title = t('topbar.markRead');
      markBtn.setAttribute('aria-label', t('topbar.markRead'));
      const iconEl = markBtn.querySelector('.mk-ico');
      if (iconEl) iconEl.textContent = '○';
      const labelEl = markBtn.querySelector('.mk-lbl');
      if (labelEl) labelEl.textContent = t('topbar.markRead');
    };
    // Deliberately depends on `isChapterRead`/`progress.toggleRead` (stable —
    // see useProgress.ts) rather than the whole `progress` object — see the
    // ORIGINAL version of this effect (git history, pre-Task-12) for why
    // that specifically matters (re-running on every exercise toggle).
  }, [chapter.id, isChapterRead, progress.toggleRead, t]);

  // Exercise checkboxes: inject into every `.box.ex .box-h` and keep their
  // `checked` state in sync with progress — WITHOUT ever touching
  // `innerHTML` (that is `ChapterView`'s main content effect's job).
  //
  // Keyed on `content` (i.e. `annotationContent`'s `root`+`revision`, the
  // SAME signal `useAnnotations` itself resolves against) rather than
  // directly on `chapterQuery.data`/`courseKit.ready`, which is what the
  // pre-Task-12 version of this effect did and is what fix-round-1 (see git
  // history) had to specifically special-case `courseKit.ready` for: this
  // component is a CHILD of `ChapterView` now, and a child's effects run
  // before its parent's in the same commit, so depending directly on
  // `ChapterView`'s own query results could run this BEFORE the main content
  // effect has written the fragment's HTML in a commit where both first
  // become true together. `content` sidesteps that entirely — it is only
  // ever updated by `ChapterView` calling `setAnnotationContent` AFTER that
  // write, which means this component only ever sees the new `content` in a
  // LATER commit, by which point the DOM mutation (from the earlier commit)
  // has already happened.
  useEffect(() => {
    const container = content.root;
    if (!container) return;
    injectExerciseCheckboxes(
      container,
      {
        isDone: (n) => progress.exDone(chapter.id, n),
        toggle: (n) => progress.toggleEx(chapter.id, n),
      },
      t,
    );
  }, [chapter.id, content, progress.partStats, progress.exDone, progress.toggleEx, t]);

  return (
    <>
      {/* Last in the chapter pipeline (innerHTML → renderKatex → widgets →
          checkboxes → normalize/resolve/paint → toolbar): it watches
          `selectionchange` and does nothing at all until the reader selects
          something inside `content.root`. It portals itself into
          `document.body`, so its position in this JSX is about ownership. */}
      <SelectionToolbar
        content={content}
        store={annotations}
        onRequestNote={requestNote}
        onDeepDive={onDeepDive}
        suspended={reattaching !== null}
      />

      {/* The old "Ghi chú (N)" TAB, with its tablist taken away and its job
          narrowed to the half that was always real: how much of the reader's
          work is in this chapter, and a switch over whether it is on the
          page. Keeps `id="rail-tab-notes"` and the exact `reader.notesTab`
          string on purpose — `e2e/p2.spec.ts` (×4) and `e2e/s1.spec.ts` (×2)
          assert both, on real data, and they are this feature's own gates. */}
      {notesSlotEl &&
        createPortal(
          <button
            type="button"
            className="tb-btn rd-notes-btn"
            id="rail-tab-notes"
            aria-pressed={notesOn}
            aria-controls="reader-notes-margin"
            title={t('reader.notesToggle')}
            onClick={() => setNotesOn((on) => !on)}
          >
            {/* `list` PLUS `orphans` — see the pre-Task-12 version of this
                comment (git history) for why the orphan count is included. */}
            {t('reader.notesTab', String(annotations.list.length + annotations.orphans.length))}
          </button>,
          notesSlotEl,
        )}

      {/* `#rail` is a MARGIN, not a tabbed column: `<MarginCards>` places
          every card absolutely at its own highlight's document Y, so a
          chapter with two notes paints two cards and nothing anywhere else.
          Still mounted while `notesOn` is false, and `hidden` rather than
          unmounted, so a click on a highlight can still open its card (and,
          below 1241px, its bottom sheet). */}
      {railEl &&
        createPortal(
          <div id="reader-notes-margin" hidden={!notesOn}>
            <MarginCards
              content={content}
              store={annotations}
              visible={notesOn}
              focus={cardFocus}
              onFocusChange={focusCard}
            />
            {/* Last, under the card column: notes this chapter could NOT
                place, after the ones it could. Same one store instance — a
                second `useAnnotations` here would paint every annotation
                twice. */}
            <OrphanPanel
              content={content}
              store={annotations}
              reattaching={reattaching}
              onReattachingChange={setReattaching}
            />
          </div>,
          railEl,
        )}
    </>
  );
}

export default ChapterView;
