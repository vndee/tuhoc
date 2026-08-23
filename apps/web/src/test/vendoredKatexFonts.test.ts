/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const KATEX_CSS_PATH = resolve(HERE, '../../../../packages/course-kit/vendor/katex.css');

/**
 * `vendor/katex.css` is committed to git with its 20 fonts inlined as base64,
 * so a packaged course reads offline from a static directory with no bundler.
 * It had no generator script, and it rotted without a single gate noticing:
 *
 *   1. All 20 `@font-face` blocks had been collapsed into ONE. Within a single
 *      declaration block the last of each duplicated property wins, so the
 *      whole thing resolved to a lone usable face — `KaTeX_AMS` with the last
 *      payload's `src`. The other 11 families were never registered at all.
 *   2. The base `.katex{font:normal 1.21em KaTeX_Main,…}` rule was missing, so
 *      `.katex` inherited the page's font and upright text inside formulas
 *      (`\mathrm{…}`) rendered in the reading serif.
 *
 * Every formula therefore rendered in fallback fonts. Nothing failed: the
 * markup was correct, the elements existed, `.mathnormal` still *computed* to
 * `font-family: KaTeX_Math` — a declared family computes the same whether or
 * not any face backs it. Counting `.katex` elements (which the e2e suite does)
 * cannot see this; only comparing rendered metrics against a family that does
 * not exist can, and that needs a real browser.
 *
 * So this guard asserts the file's structure instead, anchored on the exact
 * signature of the rot: one `src` per block, one family per block. Regenerate
 * with `node scripts/vendor-katex.mjs`, which enforces the same invariants
 * before it writes.
 */
describe('vendored katex.css', () => {
  const css = readFileSync(KATEX_CSS_PATH, 'utf-8');
  const blocks = css.match(/@font-face\{[^}]*\}/g) ?? [];

  it('declares all 20 faces as separate @font-face blocks', () => {
    // The rot collapsed these into 1. Counting the at-rule keyword alone is
    // not enough — that stayed at 1 too, which is what made it invisible.
    expect(blocks).toHaveLength(20);
  });

  it('gives every block exactly one family and one src', () => {
    // This is the collapse signature: the broken file had one block carrying
    // 20 `src:` declarations, of which only the last survived the cascade.
    for (const block of blocks) {
      const families = block.match(/font-family:/g) ?? [];
      const sources = block.match(/src:/g) ?? [];
      expect(families).toHaveLength(1);
      expect(sources).toHaveLength(1);
    }
  });

  it('covers the 12 families the stylesheet references', () => {
    const declared = new Set(
      [...css.matchAll(/@font-face\{font-family:"?(KaTeX_[A-Za-z0-9]+)"?/g)].map((m) => m[1]),
    );
    // KaTeX_SansSerif is the one upstream writes quoted, so the optional
    // quotes above are load-bearing, not defensive.
    const used = new Set([...css.matchAll(/\b(KaTeX_[A-Za-z0-9]+)\b/g)].map((m) => m[1]));
    expect(declared.size).toBe(12);
    for (const family of used) expect(declared).toContain(family);
  });

  it('keeps the base rule that puts formulas in KaTeX_Main', () => {
    // Without this, `.katex` inherits --sans from the page and `\mathrm{…}`
    // renders in whatever the surrounding prose uses.
    expect(css).toMatch(/\.katex\{font:normal [^}]*KaTeX_Main/);
  });

  it('embeds every font rather than linking a file next to the CSS', () => {
    // A packaged course is served as a static directory; a relative
    // `url(fonts/…)` would 404 there and fail silently, exactly as above.
    expect(css).not.toMatch(/url\(fonts\//);
    expect(css.match(/data:font\/woff2;base64,/g) ?? []).toHaveLength(20);
  });
});
