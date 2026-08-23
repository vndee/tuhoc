import { describe, expect, it } from 'vitest';
import { readingProgress, readingProgressWidth } from './readingProgress';

describe('readingProgress', () => {
  it('is 0 at the top and 1 at the bottom of a scrollable chapter', () => {
    const page = { scrollHeight: 5000, viewportHeight: 1000 };
    expect(readingProgress({ ...page, scrollY: 0 })).toBe(0);
    // 4000, not 5000: the last viewport-worth is on screen when scrolling
    // stops, so that IS the bottom. Dividing by scrollHeight would report
    // 0.8 here and never reach 1 at all.
    expect(readingProgress({ ...page, scrollY: 4000 })).toBe(1);
    expect(readingProgress({ ...page, scrollY: 2000 })).toBe(0.5);
  });

  it('clamps rubber-band overscroll at both ends instead of going out of range', () => {
    const page = { scrollHeight: 5000, viewportHeight: 1000 };
    // macOS/iOS report a negative scrollY while the page is pulled past the
    // top. A negative width is a CSS error, not an empty bar.
    expect(readingProgress({ ...page, scrollY: -120 })).toBe(0);
    expect(readingProgress({ ...page, scrollY: 4600 })).toBe(1);
  });

  it('reports a chapter shorter than the viewport as fully read, not as unread', () => {
    // The whole chapter is in front of the reader; nothing can be scrolled.
    // Reporting 0 would leave an empty bar on the easiest chapters to finish.
    expect(readingProgress({ scrollY: 0, scrollHeight: 600, viewportHeight: 900 })).toBe(1);
    expect(readingProgress({ scrollY: 0, scrollHeight: 900, viewportHeight: 900 })).toBe(1);
  });

  it('does not produce NaN from metrics taken before layout has settled', () => {
    // A `scrollHeight` of 0 (measured against a detached/blank document) and a
    // NaN `scrollY` both used to travel straight into `style.width`, where the
    // browser silently keeps the previous value — a bar frozen at the last
    // chapter's position.
    expect(readingProgress({ scrollY: 0, scrollHeight: 0, viewportHeight: 0 })).toBe(1);
    expect(readingProgress({ scrollY: Number.NaN, scrollHeight: 5000, viewportHeight: 1000 })).toBe(0);
  });
});

describe('readingProgressWidth', () => {
  it('renders a CSS percentage rounded to one decimal place', () => {
    expect(readingProgressWidth({ scrollY: 0, scrollHeight: 5000, viewportHeight: 1000 })).toBe('0.0%');
    expect(readingProgressWidth({ scrollY: 4000, scrollHeight: 5000, viewportHeight: 1000 })).toBe('100.0%');
    // 1/3 of the travel — the case that shows the rounding is doing something.
    expect(readingProgressWidth({ scrollY: 1000, scrollHeight: 4000, viewportHeight: 1000 })).toBe('33.3%');
  });

  it('never emits a negative or >100% width', () => {
    expect(readingProgressWidth({ scrollY: -500, scrollHeight: 5000, viewportHeight: 1000 })).toBe('0.0%');
    expect(readingProgressWidth({ scrollY: 99999, scrollHeight: 5000, viewportHeight: 1000 })).toBe('100.0%');
  });
});
