import { useLocation } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageProvider';
import type { Theme } from '../theme/useTheme';

export interface TopbarProps {
  theme: Theme;
  onToggleTheme: () => void;
  /** Toggles the mobile TOC drawer (`body.nav-open`) — see `useMobileNav`. */
  onMenuClick: () => void;
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
 */
export function Topbar({ theme, onToggleTheme, onMenuClick }: TopbarProps) {
  const location = useLocation();
  const { t } = useLanguage();
  const isChapterRoute = CHAPTER_ROUTE.test(location.pathname);

  return (
    <>
      <button id="menu-btn" type="button" className="tb-btn" aria-label={t('topbar.menu')} onClick={onMenuClick}>
        ☰
      </button>
      <div id="crumb">{!isChapterRoute && 'Tuhoc'}</div>
      <button id="mark-btn" type="button" className="tb-btn" aria-label={t('topbar.markRead')}>
        <span className="mk-ico">○</span>
        <span className="mk-lbl">{t('topbar.markRead')}</span>
      </button>
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
      <button id="prev-btn" type="button" className="tb-btn" aria-label={t('topbar.prevChapter')}>
        ←
      </button>
      <button id="next-btn" type="button" className="tb-btn" aria-label={t('topbar.nextChapter')}>
        →
      </button>
    </>
  );
}
