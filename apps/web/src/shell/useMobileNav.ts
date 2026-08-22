import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const OPEN_CLASS = 'nav-open';

function isOpen(): boolean {
  return document.body.classList.contains(OPEN_CLASS);
}

function close(): void {
  document.body.classList.remove(OPEN_CLASS);
}

function toggle(): void {
  document.body.classList.toggle(OPEN_CLASS);
}

/**
 * Mobile table-of-contents drawer (Ruling #menu-btn — Task 9 left
 * `#menu-btn` inert because no task owned it). Toggles `body.nav-open`,
 * which reader.css already uses to slide `#sidebar` into view under
 * `@media (max-width:980px)` and paint a dimmed backdrop behind it
 * (`body.nav-open #sidebar`, `body.nav-open::after`).
 *
 * Ported from the v1 single-file app's own listeners (see that file's
 * boot script):
 *   - `#menu-btn` click toggles the class;
 *   - Escape closes it;
 *   - tapping the backdrop closes it — v1 detects this the same way, as
 *     any document click that lands outside both `#sidebar` and
 *     `#menu-btn` while open (the backdrop is a `::after` pseudo-element,
 *     which cannot carry its own listener);
 * plus "selecting a chapter closes it too" (a review found this missing in
 * the original), implemented here as closing on every route change — the
 * superset that covers chapter selection, and any other in-app navigation,
 * without this hook needing to know what a chapter link looks like.
 */
export function useMobileNav(): { toggle: () => void } {
  const location = useLocation();

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen()) close();
    }
    function onDocumentClick(e: MouseEvent) {
      if (!isOpen()) return;
      const target = e.target as Element | null;
      if (target?.closest('#sidebar') || target?.closest('#menu-btn')) return;
      close();
    }

    document.addEventListener('keydown', onKeydown);
    document.addEventListener('click', onDocumentClick);
    return () => {
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('click', onDocumentClick);
      close();
    };
  }, []);

  // "Selecting a chapter should close it too" — generalized to "any
  // navigation closes it", since a chapter link is just one of the things
  // that changes the route.
  useEffect(() => {
    close();
  }, [location.pathname]);

  return { toggle };
}
