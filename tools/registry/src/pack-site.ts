#!/usr/bin/env bun
/**
 * The `.zip` a reader actually pulls — one per published VERSION.
 *
 * ## Why this file has to exist at all
 *
 * The publish job lays `index.json` beside a copy of the course tree, which is
 * the right thing for a human browsing the site and the wrong thing for the
 * platform: `apps/web` brings a package in through exactly three doors — a
 * `.zip` on disk, a `.zip` at a URL, and a public GitHub repo — and a
 * *directory of loose files on a static host* is none of them. Measured on the
 * tree as it stood before this file: `_site/courses/<id>/manifest.json` and
 * `_site/courses/<id>/chapters/*.html`, and no archive anywhere.
 *
 * The alternatives were both worse, and both were rejected on measurements
 * this repo already owns:
 *
 *   - **Open a fourth import path** that walks a manifest and fetches loose
 *     files. Subsystem 1 measured all three existing doors arriving at ONE
 *     funnel — `runImport` → `rootPackage` → `validatePackage` → a single
 *     `db.packages.put` — and that convergence is the property that makes
 *     "nothing reaches the library unchecked" a sentence anyone can verify. A
 *     fourth door is a second funnel however carefully it is written.
 *   - **Pull through the `gitUrl` door** at the registry's own GitHub repo.
 *     It works today with no new artifact, and it is the wrong trade: the
 *     anonymous GitHub API allows 60 requests an hour per IP and the repo
 *     route spends one request per file, so a 10-file course is 11 of them.
 *     The publish job's own comment says why the tree ships here in the first
 *     place — *"with no GitHub API call and no per-IP rate limit"*.
 *
 * So the registry publishes the artifact the existing door already accepts.
 *
 * ## `packZip` was built for this, before this
 *
 * `packages/course-format/src/zip.test.ts` pins a fixed DOS timestamp under the
 * heading *"packZip: đầu ra phải TÁI LẬP ĐƯỢC, vì sổ đăng ký sẽ băm nó"* —
 * packing the same files twice produces identical bytes. That is what makes
 * these archives safe to publish on a CDN: a rebuild of an unchanged commit
 * does not invalidate anybody's cached copy.
 *
 * ## Same rule set, still one copy
 *
 * Nothing here decides what a valid package is. `inspectCourse` runs
 * `validatePackage` and this file packs only what came back clean, so a
 * package that could not pass the PR gate cannot acquire a download URL
 * either.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { packZip } from './course-format.ts';
import { isEntryPoint } from './entry.ts';
import { courseDirsUnder, inspectCourse, renderFinding } from './tree.ts';
import type { RegistryFinding } from './tree.ts';

/**
 * Where one package sits, relative to the site root.
 *
 * **This is the shared half of a contract with `apps/web`.** The platform
 * cannot import this module — it pulls in `node:fs/promises` and, through
 * `tree.ts`, the CLI's `readdir.ts`, none of which may enter a browser bundle
 * — so `apps/web/src/registry/pull.ts` restates the same path and
 * `apps/web/src/registry/pull.test.ts` asserts the two agree, running in Node
 * where the import is harmless. Exactly the arrangement `INDEX_SCHEMA` and
 * `SUPPORTED_INDEX_SCHEMA` already use, for the same reason.
 *
 * Addressed by VERSION, not by course: a version-addressed URL never changes
 * meaning, so it can be cached hard and a reader who asked for `1.2.0` cannot
 * be handed `1.3.0` by a stale CDN edge.
 */
export function sitePackagePath(id: string, version: string): string {
  return `courses/${id}/${version}.zip`;
}

export interface PackedPackage {
  readonly id: string;
  readonly version: string;
  /** Path relative to the site root — {@link sitePackagePath}. */
  readonly path: string;
  readonly bytes: number;
}

export class InvalidPackageTreeError extends Error {
  readonly findings: readonly RegistryFinding[];

  constructor(findings: readonly RegistryFinding[]) {
    super(`không đóng gói được: ${findings.length} phát hiện\n${findings.map(renderFinding).join('\n')}`);
    this.name = 'InvalidPackageTreeError';
    this.findings = findings;
  }
}

export class NothingToPackError extends Error {
  constructor(root: string) {
    super(
      `${root}: không đóng gói được gói nào. ` +
        'Publish một site không có gói nào để kéo về là một cổng mù — index.json sẽ liệt kê ' +
        'course mà mọi nút "kéo về" đều 404. Kiểm lại --root và bản checkout.',
    );
    this.name = 'NothingToPackError';
  }
}

/**
 * Packs every clean version under `root` into `<outDir>/courses/<id>/<v>.zip`.
 *
 * @throws {InvalidPackageTreeError} any package has a finding — the same refusal
 * `buildIndex` makes, for the same reason: the gate and the published bytes
 * may not disagree.
 * @throws {NothingToPackError} the walk produced no package at all.
 */
export async function packSite(root: string, outDir: string): Promise<PackedPackage[]> {
  const courseDirs = await courseDirsUnder(resolve(root));

  const findings: RegistryFinding[] = [];
  const packed: PackedPackage[] = [];

  for (const dir of courseDirs) {
    const inspection = await inspectCourse(dir);
    if (inspection.findings.length > 0) {
      findings.push(...inspection.findings);
      continue;
    }
    for (const pkg of inspection.packages) {
      const rel = sitePackagePath(inspection.id, pkg.manifest.version);
      const dest = join(outDir, rel);
      const bytes = packZip(new Map(pkg.files));
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, bytes);
      packed.push({ id: inspection.id, version: pkg.manifest.version, path: rel, bytes: bytes.byteLength });
    }
  }

  if (findings.length > 0) throw new InvalidPackageTreeError(findings);
  if (packed.length === 0) throw new NothingToPackError(root);

  packed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return packed;
}

interface Args {
  root: string;
  out: string;
}

function parseArgs(argv: string[]): Args | { error: string } {
  let root: string | null = null;
  let out: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--root' || arg === '--out') {
      if (value === undefined || value.startsWith('--')) return { error: `"${arg}" cần một đường dẫn đi kèm` };
      if (arg === '--root') root = value;
      else out = value;
      i++;
      continue;
    }
    return { error: `tuỳ chọn không nhận ra: "${arg}"` };
  }

  if (root === null) return { error: 'thiếu --root <thư-mục-registry>' };
  if (out === null) return { error: 'thiếu --out <thư-mục-site>' };
  return { root, out };
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    process.stderr.write(`pack-site: ${parsed.error}\n`);
    return 1;
  }

  let packed: PackedPackage[];
  try {
    packed = await packSite(parsed.root, parsed.out);
  } catch (e) {
    process.stderr.write(`pack-site: KHÔNG đóng gói được — ${(e as Error).message}\n`);
    return 1;
  }

  process.stdout.write(`pack-site: OK — ${packed.length} gói → ${parsed.out}\n`);
  for (const p of packed) process.stdout.write(`  ${p.path}  (${p.bytes} byte)\n`);
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
