/**
 * Course package format — **v2**.
 *
 * v1 lived in `apps/web/src/course/types.ts` and described a course that was a
 * directory checked into this repo. v2 describes a course that is a *detachable
 * package*: built by the packaging CLI, checked by registry CI, imported by the
 * browser from a file the user picked. The extra fields are all in service of
 * that move — see the per-field comments.
 *
 * v2 is a strict superset of v1: every v1 field survives unchanged with the
 * same meaning, so a v1 manifest fails v2 validation only on the *new* required
 * fields (`tier`, `license`, `authors`, `generatedBy`), never on a changed one.
 * `courses/***REMOVED***/manifest.json` is still a v1 manifest at the time
 * of writing; task 11 adds the v2 fields to it.
 */

export interface Chapter {
  id: string;
  /**
   * Display label, e.g. "0.1" — **may be the empty string** for a chapter that
   * carries no number (the appendix of `courses/***REMOVED***` does).
   * The reader already branches on that; see `CourseNav.tsx`'s `num || '·'`.
   */
  num: string;
  title: string;
  short: string;
  /** Path to the chapter's HTML fragment, relative to the package root — e.g. "chapters/p0-1.html". */
  file: string;
}

export interface Part {
  title: string;
  chapters: Chapter[];
}

/**
 * What a course package is allowed to ship, and therefore how much trust
 * importing one costs the reader.
 *
 * - `content` — HTML/CSS/images only. No JavaScript of any kind: the
 *   content-tier rules in `validate.ts` reject `<script>`, `on*=` handlers,
 *   `javascript:` URLs, frames, forms, and `*.js` files outright. A `content`
 *   package that passes validation cannot execute code in the reader.
 * - `interactive` — may ship JavaScript (the simulations in
 *   `courses/***REMOVED***/viz.js` are why this tier exists). Validation
 *   deliberately does NOT try to sanitize that code; the guarantee for this
 *   tier comes from human review at the registry, not from this module.
 *
 * The two tiers exist so that the cheap, mechanical guarantee (`content`) is
 * available without paying for the expensive, human one (`interactive`).
 */
export type Tier = 'content' | 'interactive';

/** Who wrote the prose — surfaced in the catalog so a reader knows what to expect. */
export type GeneratedBy = 'ai' | 'human' | 'mixed';

export interface Author {
  name: string;
  url?: string;
}

export interface Manifest {
  id: string;
  title: string;
  description: string;
  /**
   * Display label in the catalog, e.g. "vi". Nothing in the platform
   * translates or localizes based on this — it is metadata, not a switch.
   */
  lang: string;
  /** semver, e.g. "1.0.0" — checked by the `SEMVER` rule. */
  version: string;
  /** Caret range this package requires from the reader runtime, e.g. "^1" — checked by `RUNTIME_RANGE`. */
  runtime: string;
  /** NEW in v2, required. See {@link Tier}. */
  tier: Tier;
  /** NEW in v2, required for anything published to the registry — e.g. "CC-BY-4.0". */
  license: string;
  /** NEW in v2. At least one author. */
  authors: Author[];
  /** NEW in v2. */
  generatedBy: GeneratedBy;
  /**
   * NEW in v2. A translation is its OWN course with its own `id`, not a
   * variant of the original; this field only records the ancestry so the
   * catalog can link the two.
   */
  translationOf?: string;
  /** Present only once the package has been accepted by a registry. */
  registryId?: string;
  parts: Part[];
}
