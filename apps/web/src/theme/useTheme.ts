import { useCallback, useEffect, useState } from 'react';
import { type LocalStorageKey, readLocalStorage, writeLocalStorage } from '../db/local';

export type Theme = 'light' | 'dark';

/**
 * Declared in `db/local.ts`, where it is classified as a DEVICE PREFERENCE
 * — the one list `clearLocalData()` deliberately leaves alone. Aliased here
 * rather than re-declared so there is one string with one owner: signing in
 * as somebody else must not flip a shared laptop back to a blinding white
 * page, and that promise is only as good as the classification behind it.
 */
const STORAGE_KEY: LocalStorageKey = 'itbook-theme';

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
  // `readLocalStorage` already swallows the private-mode/storage-disabled
  // throw; what is left here is this module's own validation of the value.
  const stored = readLocalStorage(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

function readAppliedTheme(): Theme | null {
  const applied = document.documentElement.dataset.theme;
  return applied === 'light' || applied === 'dark' ? applied : null;
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
 *
 * `index.html` runs a synchronous inline bootstrap script, before React
 * even loads, that applies a stored theme to `<html data-theme>` — this
 * is what prevents a flash of the wrong palette on load (the browser
 * paints before any `useEffect` can run). This hook must not fight that:
 * its initial state reads back whatever the bootstrap already applied
 * (`readAppliedTheme`) rather than re-deriving it from localStorage
 * independently, so the two can never disagree. Only when the bootstrap
 * found nothing (no stored preference) does this hook fall back to
 * localStorage directly, then to the `light` default — which is also
 * what bare `:root` in reader.css already renders as, so there is no
 * flicker in that case either.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readAppliedTheme() ?? readStoredTheme() ?? 'light');

  // Keep <html data-theme> in sync with state, including on first mount.
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';

      applyThemeToDocument(next);
      // Best-effort persistence (see `writeLocalStorage`); the theme still
      // applies for this session even where storage refuses to keep it.
      writeLocalStorage(STORAGE_KEY, next);

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
