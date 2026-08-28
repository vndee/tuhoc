/**
 * Shared fixture helpers for `validate.test.ts` and `widgets.test.ts`.
 *
 * Two copies of `MANIFEST`/`withChapter` is exactly the drift `WIDGET_DIR_RE`
 * and `WIDGET_INDEX_RE` being exported-and-reused (rather than redefined in
 * `widgets.ts`) was protecting against, just one layer further out: the day a
 * v2 manifest gains a required field, one of the two test files quietly keeps
 * building the old shape and stops exercising the real one. Fix round 1
 * caught this — the original submission redefined all four helpers locally in
 * `widgets.test.ts` against the task brief's explicit instruction to reuse
 * them.
 *
 * NOT exported from `index.ts`: this module is for this package's OWN test
 * suite, not for a consumer of `@tuhoc/course-format`.
 */

import { validatePackage } from './validate';

export const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

// Format v2 has no "tier" — a manifest built by this helper is v2-shaped by
// default, i.e. tier-less. Pass `{ tier: 'content' }` (or any value) to build
// a manifest that still carries the dead field, for the TIER_REMOVED tests.
export const MANIFEST = (over: Record<string, unknown> = {}): Uint8Array =>
  enc(JSON.stringify({
    id: 'demo', title: 'Demo', description: 'd', lang: 'vi', version: '1.0.0',
    runtime: '^1', license: 'CC-BY-4.0',
    authors: [{ name: 'A' }], generatedBy: 'human',
    parts: [{ title: 'P', chapters: [{ id: 'c1', num: '1', title: 'T', short: 'T', file: 'chapters/c1.html' }] }],
    ...over,
  }));

/** A content package that is valid except for whatever `chapter` says. */
export const withChapter = (chapter: string, over: Record<string, unknown> = {}): Map<string, Uint8Array> =>
  new Map([
    ['manifest.json', MANIFEST(over)],
    ['chapters/c1.html', enc(chapter)],
  ]);

export const codesOf = (files: ReadonlyMap<string, Uint8Array>): string[] =>
  validatePackage(files).findings.map((f) => f.code);
