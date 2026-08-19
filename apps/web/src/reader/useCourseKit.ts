import { useEffect, useState } from 'react';

/**
 * The three course-kit runtime scripts every course shares, in the order
 * they must execute: `katex.js` defines `window.katex`; `auto-render.js`
 * reads `window.katex` and defines `window.renderMathInElement`;
 * `runtime.js` defines `window.CourseKit` (whose `renderKatex` wraps
 * `renderMathInElement`) and the `Plot`/`defineViz` machinery a course's
 * own viz.js needs. These are classic scripts that attach globals, not ES
 * modules — see vite.config.ts's `@course-kit` alias comment for why they
 * must be loaded via `<script src>` rather than `import`.
 */
const RUNTIME_SCRIPT_URLS = [
  '/course-kit/vendor/katex.js',
  '/course-kit/vendor/auto-render.js',
  '/course-kit/runtime.js',
] as const;

function vizScriptUrl(courseId: string): string {
  return `/courses/${encodeURIComponent(courseId)}/viz.js`;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error(`useCourseKit: failed to load ${src}`)));
    document.head.appendChild(script);
  });
}

// Module-level, not component state: these scripts attach GLOBALS
// (window.katex, window.renderMathInElement, window.CourseKit), and
// loading the course's viz.js registers all 59 defineViz() calls into a
// freshly-created window.CourseKit.VIZ/REDRAWS. Injecting the four scripts
// a second time — from a second <ChapterView> mount, or React 18
// StrictMode's dev-only mount->cleanup->mount cycle — would not just be
// wasted network requests: runtime.js would re-run and silently replace
// window.CourseKit.REDRAWS with a brand-new empty array, orphaning every
// canvas already registered against the old one (they would stop
// repainting on the next theme toggle). A promise cached at module scope,
// not per-render state, is what survives that: every caller across the
// app's lifetime awaits the SAME promise instead of re-triggering the
// injection — this is what "once per app lifetime" (not "once per
// component instance") requires.
let injectPromise: Promise<void> | null = null;

function injectCourseKit(courseId: string): Promise<void> {
  if (injectPromise) return injectPromise;

  injectPromise = (async () => {
    for (const src of RUNTIME_SCRIPT_URLS) {
      await loadScript(src);
    }
    await loadScript(vizScriptUrl(courseId));
  })();

  // A failed load must not wedge the whole app forever on a rejected
  // singleton — reset it so a *later* mount (e.g. after a transient
  // network blip, or a route revisit) gets a clean retry. This call's own
  // caller still observes the rejection via the promise it already holds.
  injectPromise.catch(() => {
    injectPromise = null;
  });

  return injectPromise;
}

export interface UseCourseKitResult {
  /** True once katex.js, auto-render.js, runtime.js and the course's viz.js have all loaded and attached their globals. */
  ready: boolean;
  /** Set if any of the four failed to load. `ready` stays false forever in that case — surface this rather than hanging silently. */
  error: Error | null;
}

/**
 * Loads the course-kit runtime for `courseId`, once per app lifetime (see
 * `injectCourseKit` above), and reports readiness. `ChapterView` must not
 * touch `window.CourseKit` until `ready` is true.
 */
export function useCourseKit(courseId: string): UseCourseKitResult {
  const [result, setResult] = useState<UseCourseKitResult>({ ready: false, error: null });

  useEffect(() => {
    let cancelled = false;

    injectCourseKit(courseId).then(
      () => {
        if (!cancelled) setResult({ ready: true, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setResult({ ready: false, error: err instanceof Error ? err : new Error(String(err)) });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [courseId]);

  return result;
}

/** Test-only: reset the module-level singleton between test files/cases. Not exported for app code. */
export function __resetCourseKitForTests(): void {
  injectPromise = null;
}
