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
// (window.katex, window.renderMathInElement, window.CourseKit). Injecting
// the shared trio a second time — from a second <ChapterView> mount, or
// React 18 StrictMode's dev-only mount->cleanup->mount cycle — would not
// just be wasted network requests: runtime.js would re-run and silently
// replace window.CourseKit.REDRAWS with a brand-new empty array, orphaning
// every canvas already registered against the old one (they would stop
// repainting on the next theme toggle). A promise cached at module scope,
// not per-render state, is what survives that: every caller across the
// app's lifetime awaits the SAME promise instead of re-triggering the
// injection.
let runtimeTrioPromise: Promise<void> | null = null;

function injectRuntimeTrio(): Promise<void> {
  if (runtimeTrioPromise) return runtimeTrioPromise;

  runtimeTrioPromise = (async () => {
    for (const src of RUNTIME_SCRIPT_URLS) {
      await loadScript(src);
    }
  })();

  // A failed load must not wedge the whole app forever on a rejected
  // singleton — reset it so a *later* mount (e.g. after a transient
  // network blip, or a route revisit) gets a clean retry.
  runtimeTrioPromise.catch(() => {
    runtimeTrioPromise = null;
  });

  return runtimeTrioPromise;
}

// Unlike the trio above, a course's viz.js is course-SPECIFIC — it calls
// defineViz() 59 times for THIS course's simulations. Caching it in a
// single bare variable (as an earlier version of this file did) meant
// that once any course's viz.js had loaded, `useCourseKit('some-other-
// course')` would resolve `ready: true` immediately without ever
// requesting that course's own viz.js — silently wiring up the WRONG
// visualizations (or none) with no error surfaced. The platform is
// designed to host many courses (spec §1), so this isn't hypothetical.
// Keyed by courseId instead: each course's viz.js loads exactly once,
// and loading is chained after the shared trio (not raced against it) so
// viz.js — which references `Plot`/`defineViz`/etc. as globals at its own
// top level — never starts executing before runtime.js has defined them,
// even when two different courses' viz.js are first requested concurrently.
const vizPromisesByCourseId = new Map<string, Promise<void>>();

function injectCourseViz(courseId: string): Promise<void> {
  const cached = vizPromisesByCourseId.get(courseId);
  if (cached) return cached;

  // injectRuntimeTrio() must be called synchronously here (not inside the
  // .then below) so a second synchronous call for the same courseId — the
  // StrictMode double-invoke case — sees this Map entry already set
  // before either promise has had a chance to settle.
  const promise = injectRuntimeTrio().then(() => loadScript(vizScriptUrl(courseId)));

  promise.catch(() => {
    vizPromisesByCourseId.delete(courseId);
  });

  vizPromisesByCourseId.set(courseId, promise);
  return promise;
}

export interface UseCourseKitResult {
  /** True once katex.js, auto-render.js, runtime.js and this course's viz.js have all loaded and attached their globals. */
  ready: boolean;
  /** Set if any of the four failed to load. `ready` stays false forever in that case — surface this rather than hanging silently. */
  error: Error | null;
}

/**
 * Loads the course-kit runtime for `courseId`: the shared katex/auto-
 * render/runtime trio once per app lifetime, plus `courseId`'s own viz.js
 * once per distinct courseId (see `injectCourseViz` above), and reports
 * readiness. `ChapterView` must not touch `window.CourseKit` until `ready`
 * is true.
 */
export function useCourseKit(courseId: string): UseCourseKitResult {
  const [result, setResult] = useState<UseCourseKitResult>({ ready: false, error: null });

  useEffect(() => {
    let cancelled = false;

    injectCourseViz(courseId).then(
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

/** Test-only: reset the module-level singleton/map between test files/cases. Not exported for app code. */
export function __resetCourseKitForTests(): void {
  runtimeTrioPromise = null;
  vizPromisesByCourseId.clear();
}
