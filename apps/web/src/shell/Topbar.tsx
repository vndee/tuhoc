import type { Theme } from '../theme/useTheme';

export interface TopbarProps {
  theme: Theme;
  onToggleTheme: () => void;
  /** Toggles the mobile TOC drawer (`body.nav-open`) — see `useMobileNav`. */
  onMenuClick: () => void;
}

/**
 * Topbar chrome: `#menu-btn`, `#crumb`, `#mark-btn`, `#theme-btn`,
 * `#prev-btn`, `#next-btn` — ids/classes match reader.css exactly.
 *
 * `#theme-btn` and `#menu-btn` are wired: theme is this task's own
 * `useTheme()` toggle, and menu-btn drives `useMobileNav()` (Ruling
 * #menu-btn — Task 9 left it inert because no task owned it; Task 10
 * does). `#mark-btn`/`#prev-btn`/`#next-btn` depend on data Tasks 11/14
 * own (chapter pager, progress) and are intentionally inert placeholders
 * here — wiring them now would mean guessing at those tasks' interfaces.
 */
export function Topbar({ theme, onToggleTheme, onMenuClick }: TopbarProps) {
  return (
    <>
      <button id="menu-btn" type="button" className="tb-btn" aria-label="Mở menu" onClick={onMenuClick}>
        ☰
      </button>
      <div id="crumb">Tuhoc</div>
      <button id="mark-btn" type="button" className="tb-btn" aria-label="Đánh dấu đã học">
        <span className="mk-ico">○</span>
        <span className="mk-lbl">Đã học</span>
      </button>
      <button
        id="theme-btn"
        type="button"
        className="tb-btn"
        aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
        aria-pressed={theme === 'dark'}
        onClick={onToggleTheme}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button id="prev-btn" type="button" className="tb-btn" aria-label="Chương trước">
        ←
      </button>
      <button id="next-btn" type="button" className="tb-btn" aria-label="Chương sau">
        →
      </button>
    </>
  );
}
