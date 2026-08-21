/**
 * `@tuhoc/course-format` — the course package format and its rule set.
 *
 * This repo has no npm workspaces (there is no root `package.json`), so
 * consumers reach this package through a bundler/tsconfig **alias**, the same
 * way `apps/web` reaches `packages/course-kit` — see `apps/web/vite.config.ts`.
 * Import from the package root; `src/validate.ts` and `src/types.ts` are
 * implementation detail.
 */

export type { Author, Chapter, GeneratedBy, Manifest, Part, Tier } from './types';

export {
  FINDING_CODES,
  MANIFEST_PATH,
  MAX_UNCOMPRESSED_BYTES,
  parseManifest,
  validatePackage,
} from './validate';
export type { Finding, FindingCode, ValidationResult } from './validate';

export { UnsafeArchiveError, packZip, unpackZip } from './zip';
export type { UnsafeArchiveCode } from './zip';
