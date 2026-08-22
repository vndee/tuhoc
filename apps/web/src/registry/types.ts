/**
 * The ONE place `apps/web` names the path to `tools/registry`.
 *
 * Same shape, and the same reasoning, as `tools/registry/src/course-format.ts`
 * and `tools/tuhoc-cli/src/course-format.ts`: this repo has no npm workspaces
 * and no root `package.json` (ruling S1-F1), so there is no package specifier
 * to import and the sibling project is reached by relative path. One file
 * writes that path down; everything else imports from here.
 *
 * ## Why the platform imports the producer's types instead of restating them
 *
 * `index.json` is written by `tools/registry/src/build-index.ts` and read
 * here. Two hand-written declarations of one file format is one declaration
 * too many — the second copy is where the drift lives. The measured version
 * of that lesson in this repo is *"one rule set, three places"* turning out
 * to be **three copies disagreeing on 7 of 12 rows**, with the Go side
 * asserting in prose that it had the "same four clauses". So: one definition,
 * `tsc -b` enforces it, and adding a field on the producing side is a red
 * build here rather than a field the catalog silently never learned about.
 *
 * Measured 2026-08-22 that this is a REAL check and not a path that quietly
 * resolves to `any`: a probe file assigning `{ id: 'x' }` to `RegistryEntry`
 * exits `tsc -b` with **2** and `error TS2740: Type '{ id: string; }' is
 * missing the following properties from type 'RegistryEntry': title,
 * description, lang, tier, and 7 more`.
 *
 * ## `import type`, never a value import — this is load-bearing
 *
 * `build-index.ts` pulls in `node:child_process`, `node:fs/promises` and
 * (through `tree.ts`) `tools/tuhoc-cli/src/readdir.ts`. None of that may
 * enter a browser bundle. `import type` is erased entirely at transpile time,
 * so nothing here reaches the wire — but a single `import { … }` without the
 * `type` keyword would drag the whole subtree in, and it would do so
 * silently until someone read a bundle report.
 *
 * The one thing that therefore CANNOT come through here is `INDEX_SCHEMA`,
 * which is a value. `./index.ts` restates it as `SUPPORTED_INDEX_SCHEMA`, and
 * `./schemaContract.test.ts` — a test, running in Node, where the node
 * imports are harmless — asserts the two numbers are equal.
 */

export type { RegistryEntry, RegistryIndex } from '../../../../tools/registry/src/build-index.ts';
