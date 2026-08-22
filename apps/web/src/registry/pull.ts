/**
 * Bringing a catalog course into this browser's library.
 *
 * ## This file adds a SOURCE, not a door
 *
 * `course/import.ts` opens exactly three doors — a `.zip` on disk, a `.zip` at
 * a URL, and a public GitHub repo — and subsystem 1 measured all three
 * arriving at ONE funnel: `runImport` → `rootPackage` → `validatePackage` →
 * a single `db.packages.put`. That convergence is what makes *"nothing reaches
 * the library unchecked"* a sentence somebody can verify by reading one
 * function instead of four.
 *
 * So the registry does not get a door. It gets a URL, handed to the door that
 * already exists, and `pull.test.ts` asserts the source object this builds is
 * **exactly** `{ kind: 'zipUrl', url }` — `toEqual` on the whole object, not
 * `expect(src.kind).toBe(...)`, because the second still passes for a source
 * that quietly grew a "skip validation" flag. A second test reads
 * `ImportSource` out of the syntax tree and pins the union at three members,
 * so a fourth door cannot be added anywhere in the app without going red here.
 *
 * The consequence worth stating plainly: a package pulled from the registry is
 * validated **again**, in this browser, by the same rule set the registry's CI
 * ran. That is not redundancy. The registry is a third-party host and its
 * bytes are as untrusted here as a link a stranger pasted; the CI run proves
 * what the maintainers saw, not what the CDN just served.
 *
 * ## Where the `.zip` comes from
 *
 * `tools/registry/src/pack-site.ts` writes one per published version into the
 * Pages site, next to `index.json`, and {@link registryPackagePath} restates
 * the layout it uses. The two are held together by a test rather than by
 * hope — see that file's note, and `SUPPORTED_INDEX_SCHEMA` for the same
 * arrangement one level up.
 *
 * A URL nobody publishes is not a smaller version of this feature: `fetch`
 * fails on a wrong path with a bare `TypeError`, which ruling S1-F25 records
 * as indistinguishable from being offline. It is the same reason
 * `PUBLIC_REGISTRY_BASE` is `null` rather than a plausible-looking guess.
 */

import { importCourse, type ImportOptions, type ImportResult } from '../course/import.ts';
import type { RegistryEntry } from './types.ts';

/**
 * Where one published package sits, relative to the registry base.
 *
 * Must equal `sitePackagePath` in `tools/registry/src/pack-site.ts`. It is
 * restated rather than imported because that module is Node-only — it reaches
 * `node:fs/promises` and the CLI's `readdir.ts`, none of which may enter a
 * browser bundle — and `pull.test.ts`, which runs in Node where those imports
 * are harmless, asserts the two produce the same string.
 */
export function registryPackagePath(id: string, version: string): string {
  return `courses/${id}/${version}.zip`;
}

/**
 * The full address of one published package.
 *
 * The trailing-slash trim is not defensive noise: `resolveRegistryBase` cuts
 * them for the base it returns, but `<Catalog registryBase=…>` takes a value
 * straight from a caller, and `https://host/reg//courses/…` is a DIFFERENT
 * path on most static hosts — a 404 that would arrive as
 * `HTTP_ERROR` and read like the course had been withdrawn.
 */
export function registryPackageUrl(base: string, id: string, version: string): string {
  return `${base.replace(/\/+$/, '')}/${registryPackagePath(id, version)}`;
}

export interface PullOptions extends ImportOptions {
  /** Which registry to pull from — the same base `fetchRegistryIndex` read. */
  base: string;
  /** Which version. Defaults to the entry's `latest`. */
  version?: string;
}

/**
 * Pulls one catalog course into the library, through the existing zip-URL door.
 *
 * Returns `importCourse`'s result **untouched**. Nothing here inspects
 * `findings`, shortens them, or converts a refusal into a success: the whole
 * value of routing through one funnel is that the answer a reader gets for a
 * registry package is the same answer, in the same words, as for a file they
 * dragged onto the page.
 */
export function pullFromRegistry(
  entry: Pick<RegistryEntry, 'id' | 'latest'>,
  options: PullOptions,
): Promise<ImportResult> {
  const { base, version, ...importOptions } = options;
  const url = registryPackageUrl(base, entry.id, version ?? entry.latest);
  return importCourse({ kind: 'zipUrl', url }, importOptions);
}
