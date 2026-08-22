/**
 * The ONE place this tool names the path to `packages/course-format`.
 *
 * Same shape, and the same reasoning, as `tools/tuhoc-cli/src/course-format.ts`:
 * the repo has no npm workspaces and no root `package.json` (ruling S1-F1), so
 * there is no `@tuhoc/course-format` specifier to import and the package is
 * reached by relative path. A tsconfig `paths` alias was rejected there because
 * `vitest` resolves through Vite, which does not read tsconfig `paths` — the
 * alias would work under `tsc` and `bun` and break under the test runner.
 *
 * ## Why this file exists at all, given the CLI already has one
 *
 * Because the alternative is worse in exactly the way this subsystem exists to
 * prevent. The measured failure is *"one rule set, three places"* turning into
 * **three copies that disagree on 7 of 12 rows**, with the Go side asserting in
 * prose that it had the "same four clauses". A fourth copy of the RULES is
 * forbidden. A second copy of the eleven-character *import path* is not a copy
 * of the rules: it names the same module, and if it ever named a different one
 * the type checker says so immediately.
 *
 * Everything this tool knows about what makes a package valid comes through
 * here. If you find yourself about to answer a validity question in
 * `validate-pr.ts` or `build-index.ts` without calling `validatePackage`, that
 * is the fourth copy.
 */

export { MANIFEST_PATH, parseManifest, validatePackage } from '../../../packages/course-format/src/index.ts';

export type { Author, Finding, GeneratedBy, Manifest, Tier } from '../../../packages/course-format/src/index.ts';
