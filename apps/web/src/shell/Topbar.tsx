import { useLocation } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageProvider';
import type { Theme } from '../theme/useTheme';

export interface TopbarProps {
  theme: Theme;
  onToggleTheme: () => void;
  /**
   * Bật/tắt thanh điều hướng. Dưới 981px là ngăn kéo trượt tạm
   * (`body.nav-open`, xem `useMobileNav`); từ 981px là thu gọn BỀN
   * (`#app.nav-collapsed`, xem `useSidebarCollapse`). `App.tsx` chọn cơ chế
   * theo bề rộng ngay lúc bấm; ở đây chỉ là một cú bấm.
   */
  onMenuClick: () => void;
  /**
   * Thanh bên có đang HIỆN không, dùng cho `aria-expanded`.
   *
   * Mặc định `true` vì `#sidebar` mặc định hiện trên màn rộng, và vì ba tệp
   * test dựng `<Topbar>` trực tiếp — một prop bắt buộc ở đây sẽ bắt cả ba sửa
   * mà không đo thêm được gì.
   */
  navExpanded?: boolean;
}

// Matches the `/c/:courseId/:chapterId` route — same pathname-only check
// (not `useParams`) as Sidebar's `courseIdFromPathname` and Rail's
// `CHAPTER_ROUTE`, for the same reason: <Topbar> is chrome rendered by
// <AppShell> alongside <AppRoutes>, not inside a matched <Route>.
const CHAPTER_ROUTE = /^\/c\/[^/]+\/[^/]+/;

/**
 * Topbar chrome: `#menu-btn`, `#crumb`, `#mark-btn`, `#theme-btn`,
 * `#prev-btn`, `#next-btn` — ids/classes match reader.css exactly.
 *
 * `#theme-btn` and `#menu-btn` are wired here: theme is `AppShell`'s
 * `useThemeContext()` toggle (Task 14 promoted the original per-component
 * `useTheme()` call into a shared Context — see `theme/ThemeContext.tsx`
 * — so the reader's `t`/`T` shortcut can call the exact same toggle
 * without a second, desyncing theme state), and menu-btn drives
 * `useMobileNav()` (Ruling #menu-btn — Task 9 left it inert because no
 * task owned it; Task 10 does). `#mark-btn`, like `#prev-btn`/`#next-btn`,
 * is wired by `ChapterView` (Task 11's pattern, Task 14's data) directly
 * against these DOM nodes rather than through props here — chapter/
 * progress data lives there, not here, and this component only ever
 * renders the static markup + starting ○/"Đánh dấu đã học" state.
 *
 * `#crumb` on chapter routes: same recipe as `Rail.tsx` for `#rail` —
 * `ChapterView` portals the real `part › chapter` breadcrumb directly into
 * this DOM node, so rendering the static "Tuhoc" text here too would
 * concatenate both. This component only needs to know *whether* it's a
 * chapter route (via the pathname), not what the breadcrumb actually says.
 *
 * ── `#reader-nav` / `#reader-notes` — chế độ đọc, hướng A ─────────────────
 * Reading mode has no app sidebar (`styles/reader-layout.css`), so its ONE
 * way out, its table-of-contents button and its notes toggle all live in this
 * bar. All three are built by `ChapterView` — they need the chapter's
 * headings, its note count and its course id, none of which this component
 * can see — and they arrive here through two portals, exactly the way `#rail`
 * and `#crumb` already work.
 *
 * TWO empty hosts rather than one, and rendered UNCONDITIONALLY:
 *
 *   - Two, because the reading bar has a left group (leave, contents) and a
 *     right group (notes), with the breadcrumb stretching between them. One
 *     host plus CSS `order` would put the notes button in the middle of the
 *     TAB order while painting it on the right — a keyboard user would meet
 *     the controls in an order that does not match what they see. Two hosts
 *     put each group where it actually belongs in the DOM, and the CSS then
 *     has no reordering to do at all.
 *   - Unconditionally, because a host that comes and goes with the route is a
 *     host React can delete out from under a portal that is still pointing at
 *     it. `#rail` is rendered on every route for the same reason. Off a
 *     chapter they are two empty `<span>`s with `display:contents`, which
 *     paint nothing and take no space.
 */
export function Topbar({ theme, onToggleTheme, onMenuClick, navExpanded = true }: TopbarProps) {
  const location = useLocation();
  const { t } = useLanguage();
  const isChapterRoute = CHAPTER_ROUTE.test(location.pathname);

  return (
    <>
      <button
        id="menu-btn"
        type="button"
        className="tb-btn"
        aria-label={t('topbar.menu')}
        /*
          `aria-expanded` + `aria-controls`: nút này nay bật/tắt một vùng còn ở
          NGUYÊN trong tài liệu, nên trình đọc màn hình phải nói được nó đang
          mở hay đóng. Không có cặp này thì một nút "☰" chỉ là một ký tự.
        */
        aria-expanded={navExpanded}
        aria-controls="sidebar"
        onClick={onMenuClick}
      >
        ☰
      </button>
      <span id="reader-nav" className="rd-slot" />
      {/*
        Ba nút dưới đây — đánh dấu đã học, chương trước, chương sau — chỉ có
        nghĩa KHI ĐANG ĐỌC. Chúng từng hiện trên mọi màn hình, kể cả Bảng
        điều khiển, nơi không có chương nào để đánh dấu hay để lùi/tiến.
        `hidden` chứ không phải bỏ khỏi cây: `reader.css` gắn id vào chúng và
        `Reader` nối hành vi theo id, nên tháo ra sẽ đứt đường ấy.
      */}
      {/*
        `#crumb` nay RỖNG ngoài trang chương.

        Nó từng in "Tuhoc" ở đó — hợp lý khi thanh trên chưa có gì khác, nhưng
        nhãn hiệu đã đứng ở đầu thanh (`shell/TopNav.tsx`) kể từ lúc điều hướng
        chuyển lên đây, nên in tên app lần nữa cách đó vài chục pixel là nói hai
        lần. Phần tử vẫn ở lại vì `flex:1` của nó là thứ đẩy nhóm nút bên phải
        về mép phải, và vì `ChapterView` portal breadcrumb thật vào chính nó.
      */}
      <div id="crumb" />
      <button id="mark-btn" type="button" className="tb-btn" hidden={!isChapterRoute} aria-label={t('topbar.markRead')}>
        <span className="mk-ico">○</span>
        <span className="mk-lbl">{t('topbar.markRead')}</span>
      </button>
      <span id="reader-notes" className="rd-slot" />
      <button
        id="theme-btn"
        type="button"
        className="tb-btn"
        aria-label={t(theme === 'dark' ? 'topbar.themeToLight' : 'topbar.themeToDark')}
        aria-pressed={theme === 'dark'}
        onClick={onToggleTheme}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button id="prev-btn" type="button" className="tb-btn" hidden={!isChapterRoute} aria-label={t('topbar.prevChapter')}>
        ←
      </button>
      <button id="next-btn" type="button" className="tb-btn" hidden={!isChapterRoute} aria-label={t('topbar.nextChapter')}>
        →
      </button>
    </>
  );
}
