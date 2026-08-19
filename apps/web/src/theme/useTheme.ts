import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'itbook-theme';

declare global {
  interface Window {
    // Set by packages/course-kit/runtime.js once it has been loaded via
    // <script src="/course-kit/runtime.js"> (Task 11). Not present on every
    // route (e.g. dashboard, login), so every access must be optional.
    CourseKit?: {
      initViz: (root: ParentNode) => void;
      renderKatex: (root: ParentNode) => void;
      REDRAWS: Array<() => void>;
      VIZ: Record<string, (node: Element) => void>;
    };
  }
}

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    // localStorage can throw (private mode, disabled storage, ...)
    return null;
  }
}

function applyThemeToDocument(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

/**
 * Reads/writes the persisted theme (`localStorage['itbook-theme']`), keeps
 * `<html data-theme>` in sync, and — after a toggle — reruns every canvas
 * viz's redraw function (`window.CourseKit.REDRAWS`) so plots repaint with
 * the new palette. `CourseKit` is only loaded on reader routes (Task 11),
 * so its absence here is expected and must not throw.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme() ?? 'light');

  // Keep <html data-theme> in sync with state, including on first mount.
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';

      applyThemeToDocument(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // best-effort persistence; theme still applies for this session
      }

      const redraws = window.CourseKit?.REDRAWS;
      if (redraws) {
        for (const redraw of redraws) {
          try {
            redraw();
          } catch (err) {
            console.warn('CourseKit redraw failed', err);
          }
        }
      }

      return next;
    });
  }, []);

  return { theme, toggle };
}
