import type { Theme } from '../theme/useTheme';

export interface TopbarProps {
  theme: Theme;
  onToggleTheme: () => void;
}

/**
 * Topbar chrome: `#menu-btn`, `#crumb`, `#mark-btn`, `#theme-btn`,
 * `#prev-btn`, `#next-btn` — ids/classes match reader.css exactly.
 *
 * Only `#theme-btn` does anything in this task: it is this task's own
 * `useTheme()` toggle. The rest (mobile nav, mark-as-read, chapter pager)
 * depend on data Tasks 10/11/13/14 own (course nav, progress) and are
 * intentionally inert placeholders here — wiring them now would mean
 * guessing at those tasks' interfaces.
 */
export function Topbar({ theme, onToggleTheme }: TopbarProps) {
  return (
    <>
      <button id="menu-btn" type="button" className="tb-btn" aria-label="Mở menu">
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
