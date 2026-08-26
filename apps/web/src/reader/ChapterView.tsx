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

  // P2 Task 6 built the rail as TWO TABS — "Trong chương" (the chapter's own
  // h2/h3 outline) and "Ghi chú". Chế độ đọc hướng A takes the tabs apart, and
  // the two halves go to opposite places rather than both staying in a column
  // beside the text:
  //
  //   - the outline moves into `<TocDrawer>`, together with the COURSE outline
  //     that used to be the app sidebar. Two lists that were on two different
  //     edges of the screen, in one drawer, behind one button.
  //   - the notes stay in `#rail`, but the rail stops being a tabbed column
  //     and becomes what the cards always were underneath: a margin, holding
  //     anchored notes at their own paragraphs and NOTHING where there is no
  //     note. `notesOn` is the reader's own switch over that margin, not a tab
  //     — there is no second thing behind it to switch to any more.
  //
  // Both are still built HERE, in this component's portals, for the reason
  // ruling P2-F1 gives: their content is derived from the chapter's DOM, which
  // `shell/Rail.tsx` and `shell/Topbar.tsx` cannot see, and building them
  // there renders the rail twice (the P1 Task 11 bug route-awareness fixed).
  //
  // `notesOn` starts TRUE and is not persisted. Both halves of that are load-
  // bearing: an orphaned note has to be on screen the moment a reader opens a
  // chapter whose text moved under it — that is the whole promise of P2 §3 —
  // and a remembered `false` would hide every note in the product across a
  // reload, which is indistinguishable from the data loss this phase exists to
  // prevent.
  //
  // `cardFocus` is which note card is open. It lives here rather than inside
  // `<MarginCards>` because Task 5's toolbar is what opens one: "Ghi chú"
  // creates the annotation and calls `onRequestNote(id)` — a callback that,
  // until this task, nothing was listening to, so the button highlighted in
  // yellow and offered no way to write anything.
  const [notesOn, setNotesOn] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [cardFocus, setCardFocus] = useState<CardFocus | null>(null);

  // P2 Task 7. Which orphaned note is waiting for the reader to select its new
  // home, or null. It lives HERE, not inside `<OrphanPanel>`, because it is the
  // one piece of state two siblings disagree about: while it is set, dragging
  // across a paragraph means "put the note here", so Task 5's toolbar must not
  // offer to create a NEW note from the same drag. Both components listen to
  // `selectionchange` on the same document; without a shared owner they both
  // answer, and the reader gets a colour picker on top of the paragraph they
  // were trying to re-anchor. Reattach mode wins — see `OrphanPanel.tsx`'s doc,
  // section 1.
  const [reattaching, setReattaching] = useState<string | null>(null);

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

  // A card being opened from the CHAPTER (a click on a highlight, or "Ghi
  // chú" on the selection toolbar) has to bring the margin back with it. This
  // used to read `setRailTab('notes')`; the switch it flips now is the
  // reader's own "hiện/ẩn ghi chú ở lề", and the rule is the same one for the
  // same reason: opening a card the reader cannot see is a click that appears
  // to do nothing.
  const focusCard = useCallback((next: CardFocus | null) => {
    setCardFocus(next);
    if (next) setNotesOn(true);
  }, []);

  const requestNote = useCallback((id: string) => focusCard({ id, edit: true }), [focusCard]);

  const closeToc = useCallback(() => setTocOpen(false), []);

  const chapterQuery = useQuery({
    queryKey: ['course-chapter', courseId, chapter.id],
    queryFn: () => loadChapter(courseId, chapter.id),
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
  // ChapterView.test.tsx's "navigating between chapters reuses the
  // component instance" test, which proves this via `rerender`),
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
  //
  // It used to be keyed off which TAB was up. There is no second tab any more,
  // so it is keyed off the reader's own notes switch — which is the same
  // condition it always really was: "is `#rail` holding document-positioned
  // cards right now".
  useEffect(() => {
    if (!railEl) return;
    railEl.classList.toggle('rail-notes', notesOn);
    return () => railEl.classList.remove('rail-notes');
  }, [railEl, notesOn]);

  // A new chapter has none of the previous chapter's notes, so an open card
  // there refers to an annotation that is no longer on the page. The same goes
  // for a rescue in progress: the paragraph the reader was about to select is
  // gone, and leaving the mode on would keep the toolbar suspended in a
  // chapter where nothing can be reattached. `notesOn` is deliberately NOT
  // reset (it is a preference, and resetting it every chapter would fight the
  // reader) — the same restraint the two-tab version applied to `railTab`.
  useEffect(() => {
    setCardFocus(null);
    setReattaching(null);
  }, [chapter.id]);

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
  // a node this component's own JSX ever produces. Visual state (`.on`
  // class, ○/✓ icon, label) mirrors v1's `syncMark()` exactly
  // (the v1 single-file source's own mark-btn wiring) and is re-applied
  // whenever `isRead` for THIS chapter changes — including a change that
  // did not originate from this button (e.g. a remote sync pull marking
  // the chapter read from another device while it's open here).
  const isChapterRead = progress.isRead(chapter.id);
  useEffect(() => {
    const markBtn = document.getElementById('mark-btn');
    if (!markBtn) return;

    markBtn.classList.toggle('on', isChapterRead);
    markBtn.title = t(isChapterRead ? 'reader.markUnread' : 'topbar.markRead');
    // `<Topbar>` sets a static `aria-label` on this button, which — per
    // the accessible-name computation rules — takes precedence over its
    // visible text content. Updating only `.mk-lbl`'s text below without
    // also updating `aria-label` here would leave a screen reader
    // announcing "Đánh dấu đã học" (mark as read) forever, even once the
    // chapter IS marked read and the button's real action has flipped to
    // unmark it — so this mirrors `title`'s update exactly.
    markBtn.setAttribute('aria-label', t(isChapterRead ? 'reader.markUnread' : 'topbar.markRead'));
    const icon = markBtn.querySelector('.mk-ico');
    if (icon) icon.textContent = isChapterRead ? '✓' : '○';
    const label = markBtn.querySelector('.mk-lbl');
    if (label) label.textContent = t(isChapterRead ? 'reader.read' : 'topbar.markRead');

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
      markBtn.title = t('topbar.markRead');
      markBtn.setAttribute('aria-label', t('topbar.markRead'));
      const iconEl = markBtn.querySelector('.mk-ico');
      if (iconEl) iconEl.textContent = '○';
      const labelEl = markBtn.querySelector('.mk-lbl');
      if (labelEl) labelEl.textContent = t('topbar.markRead');
    };
    // Deliberately depends on `isChapterRead` (the specific boolean this
    // effect cares about) and `progress.toggleRead` (stable — see
    // useProgress.ts) rather than the whole `progress` object: `progress`
    // also carries `partStats`/`doneChapterIds`, which change on every
    // EXERCISE toggle too — including the whole object here would re-run
    // this effect (tearing down and re-attaching the click listener) on
    // every exercise checkbox click in this chapter, not just on an actual
    // change to whether THIS chapter is marked read.
  }, [chapter.id, isChapterRead, progress.toggleRead, t]);

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

  // Exercise checkboxes (this task's own deliverable): inject into every
  // `.box.ex .box-h` and keep their `checked` state in sync with progress
  // — WITHOUT ever touching `innerHTML` here (that is the main content
  // effect's job, above, and re-running it on every checkbox toggle would
  // tear down and rebuild everything `renderKatex` already set up, plus
  // every widget iframe's live state, completely unrelated to any
  // exercise). This effect only ever mutates nodes inside `.box.ex
  // .box-h`, the same restraint the widget-placeholder code above applies
  // to `[data-widget]` nodes, so the two can never fight over the same
  // element.
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
    injectExerciseCheckboxes(
      container,
      {
        isDone: (n) => progress.exDone(chapter.id, n),
        toggle: (n) => progress.toggleEx(chapter.id, n),
      },
      t,
    );
    // `progress.exDone`/`progress.toggleEx` (stable — see useProgress.ts)
    // plus `progress.partStats` (the change SIGNAL — see the paragraph
    // above) rather than the whole `progress` object: `progress` also
    // carries `isRead`/`doneChapterIds`/`toggleRead`, and including it
    // whole would re-run this effect (and re-walk every `.box.ex` in the
    // chapter) on every chapter-level `isRead` change too, not just an
    // exercise change.
  }, [chapter.id, courseKit.ready, progress.partStats, progress.exDone, progress.toggleEx, chapterQuery.data, t]);

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
      {/* Last in the chapter pipeline (innerHTML → renderKatex → widgets →
          injectExerciseCheckboxes → normalize/resolve/paint → toolbar): it
          watches `selectionchange` and does nothing at all until the reader
          selects something inside `annotationContent.root`, which is the same
          element the store above resolves against and only exists once that
          effect has run. It portals itself into `document.body`, so its
          position in this JSX is about ownership, not layout. */}
      <SelectionToolbar
        content={annotationContent}
        store={annotations}
        onRequestNote={requestNote}
        onDeepDive={
          aiReady
            ? (excerpt) => {
                setAi({ kind: 'dive', excerpt });
              }
            : undefined
        }
        suspended={reattaching !== null}
      />
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

      {/* ── Thanh trên của chế độ đọc, nhóm PHẢI ────────────────────────────
          The old "Ghi chú (N)" TAB, with its tablist taken away and its job
          narrowed to the half that was always real: how much of the reader's
          work is in this chapter, and a switch over whether it is on the page.
          It keeps `id="rail-tab-notes"` and the exact `reader.notesTab` string
          on purpose — `e2e/p2.spec.ts` (×4) and `e2e/s1.spec.ts` (×2) assert
          both, on real data, and they are this feature's own gates. Renaming
          the id would mean editing the two files whose whole job is to notice
          when something about notes changes. The name is now inaccurate (it is
          not in the rail, and it is not a tab); that is a debt worth carrying
          in front of a gate worth keeping. */}
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
            {/* `list` PLUS `orphans`, and the plus is Task 7's, found by
                looking at the real page rather than at a test. Counting only
                what got painted has two bad consequences and no good one:

                  - A chapter whose content was rebuilt shows a note count that
                    has silently DROPPED — which looks exactly like the data
                    loss this whole phase exists to prevent, while the notes
                    are in fact all still there.
                  - The orphan panel lives in the margin this button governs,
                    so a reader whose only notes are orphaned would be told
                    "Ghi chú (0)" with both of them on screen beside it.
                    Measured on the real reader with two orphans seeded.

                A note that could not be placed is still a note in this
                chapter. The margin is where the difference between the two
                kinds is explained; the count's job is to say how much of the
                reader's work is in here. Notes still awaiting the deferred
                fuzzy pass are in neither list and so are not counted yet —
                that is the existing, deliberate behaviour (see
                `useAnnotations`, section 2): reporting a note before it has
                been looked for is what the store goes out of its way not to
                do. */}
            {t('reader.notesTab', String(annotations.list.length + annotations.orphans.length))}
          </button>,
          notesSlotEl,
        )}

      {/* Mục lục — ngăn kéo, không phải cột. Renders into `document.body`
          (its own portal), so its position in this JSX is about ownership. */}
      <TocDrawer
        open={tocOpen}
        onClose={closeToc}
        courseId={courseId}
        courseTitle={courseTitle}
        currentChapterId={chapter.id}
        parts={parts}
        doneChapterIds={progress.doneChapterIds}
        headings={headings}
        currentHeadingId={currentHeadingId}
      />

      {/* ── `#rail` là LỀ, không còn là cột có tab ──────────────────────────
          Chỉ ghi chú, và chỉ ở nơi có ghi chú: `<MarginCards>` places every
          card absolutely at its own highlight's document Y, so a chapter with
          two notes paints two cards and nothing anywhere else.

          Still mounted while `notesOn` is false, and `hidden` rather than
          unmounted, for the reason the two-tab version had: a click on a
          highlight has to be able to open its card — and below 1241px, where
          `#rail` does not exist at all, its bottom sheet — whatever the margin
          is currently showing. `visible` decides whether the COLUMN is built;
          the component has work to do either way. */}
      {railEl &&
        createPortal(
          <div id="reader-notes-margin" hidden={!notesOn}>
            <MarginCards
              content={annotationContent}
              store={annotations}
              visible={notesOn}
              focus={cardFocus}
              onFocusChange={focusCard}
            />
            {/* Last, under the card column, because that is what it is: the
                notes this chapter could NOT place, after the ones it could.
                Same one store instance — a second `useAnnotations` here would
                paint every annotation twice. Mounted unconditionally, like
                `<MarginCards>`: a rescue started here has a bar portalled into
                `document.body`, and a reader who hides the margin mid-rescue
                must not lose the only way out of the mode. */}
            <OrphanPanel
              content={annotationContent}
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
