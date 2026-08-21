/**
 * The ONE place this CLI names the path to `packages/course-format`.
 *
 * The repo has no npm workspaces and no root `package.json` (ruling S1-F1), so
 * there is no `@tuhoc/course-format` specifier to import — the package is
 * reached by relative path, the way `apps/web` reaches `packages/course-kit`
 * through a Vite alias. A tsconfig `paths` alias was the other candidate and
 * was rejected: `vitest` resolves through Vite, which does not read tsconfig
 * `paths` without an extra plugin, so the alias would have worked under `tsc`
 * and `bun` and broken under the test runner — three resolvers, two answers.
 * One relative path in one file is the version of this that cannot drift.
 *
 * `src/index.ts` is the package's declared entry (`"main"`), so this imports
 * the package root, not its internals.
 *
 * Everything the CLI knows about what makes a package valid comes through
 * here. If you find yourself about to answer a validity question in this CLI
 * without calling `validatePackage`, that is the second copy of the rule set
 * this whole subsystem exists to avoid.
 */

export {
  FINDING_CODES,
  MANIFEST_PATH,
  MAX_UNCOMPRESSED_BYTES,
  packZip,
  validatePackage,
} from '../../../packages/course-format/src/index.ts';

export type {
  Finding,
  FindingCode,
  Manifest,
  ValidationResult,
} from '../../../packages/course-format/src/index.ts';
