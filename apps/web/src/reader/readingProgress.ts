/**
 * How far through the chapter the reader is, as a fraction — the arithmetic
 * behind the one thin line at the top of the reading view.
 *
 * Kept apart from `ChapterView` for the same reason `annotations/layout.ts` is
 * kept apart from `MarginCards`: it is the only part of the feature that can
 * be judged without a layout engine, and jsdom has no scrolling.
 *
 * ── Why a fraction of the SCROLLABLE distance, not of the document ────────
 * The obvious formula, `scrollY / documentHeight`, can never reach 1: the last
 * viewport-worth of the chapter is on screen when `scrollY` stops, so the bar
 * would sit at ~85% with the reader looking at the final paragraph. Dividing by
 * `documentHeight - viewportHeight` — the distance that can actually be
 * travelled — is what makes "the line is full" mean "you are at the end".
 *
 * ── Why a chapter shorter than the viewport reports 1, not 0 ──────────────
 * When nothing can be scrolled the denominator is zero. Both answers are
 * defensible arithmetically and only one is honest to a reader: the whole
 * chapter is in front of them, so they are through all of it. Reporting 0
 * would leave a permanently empty bar on exactly the chapters that are easiest
 * to finish.
 */

/** The measurements this needs, named so a caller can be read at a glance. */
export interface ScrollMetrics {
  /** `window.scrollY`. */
  readonly scrollY: number;
  /** `document.documentElement.scrollHeight` — the full scrollable content. */
  readonly scrollHeight: number;
  /** `window.innerHeight` — how much of it is on screen at once. */
  readonly viewportHeight: number;
}

/**
 * `0` at the top, `1` at the bottom, clamped to that range at both ends.
 *
 * Clamped rather than trusted: macOS/iOS rubber-band scrolling reports a
 * NEGATIVE `scrollY` at the top and an over-large one at the bottom, and a bar
 * whose width goes negative renders as a CSS error rather than as an empty
 * bar. Non-finite or nonsensical metrics (a `scrollHeight` of 0 before layout
 * has settled, a `NaN` out of a detached document) collapse to the same
 * "nothing to scroll" branch as a short chapter.
 */
export function readingProgress({ scrollY, scrollHeight, viewportHeight }: ScrollMetrics): number {
  const travel = scrollHeight - viewportHeight;
  if (!Number.isFinite(travel) || travel <= 0) return 1;
  if (!Number.isFinite(scrollY)) return 0;
  return Math.min(1, Math.max(0, scrollY / travel));
}

/**
 * The same number as a CSS width, which is the only form `#progbar` wants.
 *
 * Rounded to one decimal place on purpose: `#progbar` has a `width` transition
 * in reader.css, and writing a full-precision percentage on every scroll frame
 * restarts that transition ~60 times a second from a value a tenth of a pixel
 * away — measurable jitter for no visible gain. One decimal is finer than a
 * pixel on any bar narrower than 1000px.
 */
export function readingProgressWidth(metrics: ScrollMetrics): string {
  return `${(readingProgress(metrics) * 100).toFixed(1)}%`;
}
