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
 * fields (`license`, `authors`, `generatedBy`), never on a changed one.
 *
 * Measured on the one real v1 manifest that existed — the author's own textbook
 * — the rule set returned exactly four findings, all `MANIFEST_FIELD`, one per
 * new field (there were four then: `tier`, `license`, `authors`,
 * `generatedBy`). Task 11 added those four and the package packed clean; it is
 * not in this repo any more (see `docs/publishing.md`). `tools/extract.py`
 * still emits a v1 manifest on purpose, so that path still exercises the
 * findings — now three of them, `tier` having been removed again below.
 *
 * `tier` is not merely gone from THIS interface — it is gone from the format.
 * A manifest that still carries it fails validation with `TIER_REMOVED` (see
 * `validate.ts`), not because the field is unrecognized but because keeping it
 * around would say the choice still exists. It does not: every package is now
 * what `tier: 'content'` used to mean (see `TIER_REMOVED`'s doc comment and
 * `docs/superpowers/specs/2026-08-25-server-side-pivot.md` §2.3), and the
 * interactive escape hatch is a widget under `widgets/<name>/index.html`, not
 * a manifest field.
 */

export interface Chapter {
  id: string;
  /**
   * Display label, e.g. "0.1" — **may be the empty string** for a chapter that
   * carries no number (the appendix of `fixtures/courses/so-dau-phay-dong`
   * does).
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
