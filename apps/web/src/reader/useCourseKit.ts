import { useEffect, useState } from 'react';
import { resolveVizScriptUrl } from '../course/loader';

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

/**
 * The shared trio, loaded at most once per app lifetime, as a plain promise.
 *
 * Exported (Task 10) because `useCourseKit` is not the only thing that needs
 * `window.CourseKit`, and the second caller is not a component. `course/version.ts`
 * resolves a reader's anchors against a chapter of a version they have not taken
 * yet, and an anchor's stored quote describes the chapter AFTER
 * `CourseKit.renderKatex` has run — one `'￼'` per formula rather than the
 * literal `$…$` source. Measured on the real p1-5 with 30 notes: previewing
 * without the trio reported 26 orphans where 4 was the truth, and 17 of those
 * were paragraphs the update did not touch at all.
 *
 * A second injector living in that file would be a second copy of the
 * "these globals must be attached exactly once, in this order" rule — the
 * rule the module-level singleton below exists to enforce.
 */
export function ensureCourseKitRuntime(): Promise<void> {
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
// Keyed by the script's own URL instead: each course's viz.js loads
// exactly once, and loading is chained after the shared trio (not raced
// against it) so viz.js — which references `Plot`/`defineViz`/etc. as
// globals at its own top level — never starts executing before runtime.js
// has defined them, even when two different courses' viz.js are first
// requested concurrently.
//
// Keyed by URL rather than by courseId because the URL is now what varies:
// `course/loader.ts` decides where (or whether) a given course's viz.js
// lives, and two courses can no longer collide on one key without also
// being one script.
const vizPromisesBySrc = new Map<string, Promise<void>>();

/**
 * The trio, plus `vizSrc` if there is one.
 *
 * `vizSrc === null` means this course HAS no viz.js — a `content`-tier
 * package, which is most of them — and the trio alone is then the whole
 * runtime. Not an error case and not a degraded one: KaTeX and the
 * chapter renderer are what a prose course needs.
 */
function injectCourseKit(vizSrc: string | null): Promise<void> {
  if (vizSrc === null) return ensureCourseKitRuntime();

  const cached = vizPromisesBySrc.get(vizSrc);
  if (cached) return cached;

  // ensureCourseKitRuntime() must be called synchronously here (not inside the
  // .then below) so a second synchronous call for the same script — the
  // StrictMode double-invoke case — sees this Map entry already set
  // before either promise has had a chance to settle.
  const promise = ensureCourseKitRuntime().then(() => loadScript(vizSrc));

  promise.catch(() => {
    vizPromisesBySrc.delete(vizSrc);
  });

  vizPromisesBySrc.set(vizSrc, promise);
  return promise;
}

export interface UseCourseKitResult {
  /** True once katex.js, auto-render.js, runtime.js and — if this course has one — its viz.js have all loaded and attached their globals. */
  ready: boolean;
  /** Set if any of them failed to load. `ready` stays false in that case — surface this rather than hanging silently. */
  error: Error | null;
}

/**
 * Loads the course-kit runtime for `courseId`: the shared katex/auto-
 * render/runtime trio once per app lifetime, plus this course's own viz.js
 * — IF it has one — once per distinct script, and reports readiness.
 * `ChapterView` must not touch `window.CourseKit` until `ready` is true.
 *
 * "If it has one" is the whole of ruling S1-F14. This hook used to request
 * `/courses/<id>/viz.js` unconditionally, which is correct for the courses
 * this repo ships and wrong for every `content`-tier package — the tier
 * that has no JavaScript by definition, and the one the registry
 * recommends. `resolveVizScriptUrl` answers the question properly, using
 * the same two-source rule the manifest and the chapters go through; see
 * `course/loader.ts`.
 *
 * That answer is asynchronous (it reads `db.packages`), so a mount now
 * begins with a local lookup rather than with a `<script>` tag. Nothing
 * downstream changes: the trio singleton and the per-script map are both
 * populated synchronously inside `injectCourseKit`, so concurrent mounts
 * still share one injection each.
 */
export function useCourseKit(courseId: string): UseCourseKitResult {
  const [result, setResult] = useState<UseCourseKitResult>({ ready: false, error: null });

  useEffect(() => {
    let cancelled = false;

    resolveVizScriptUrl(courseId)
      .then((vizSrc) => injectCourseKit(vizSrc))
      .then(
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
  vizPromisesBySrc.clear();
}
