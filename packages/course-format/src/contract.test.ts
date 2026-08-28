/**
 * The contract test: proves `fixtures/format-v2/` and this module still agree.
 *
 * Task 3 of the server-side pivot builds a corpus of real package directories
 * on disk — `fixtures/format-v2/hostile/<case>/` plus `valid-course/` — that
 * BOTH implementations of the rule set (this TypeScript one, and the Go port
 * `apps/api/internal/pkgcheck` from tasks 6–7) are required to run against.
 * This file is the TypeScript half of that requirement. Its job is to iterate
 * the corpus, not to know anything about individual cases — a case's own
 * `expect.json` is where knowledge about THAT case lives, so the Go suite can
 * read the identical file and this test never has to be edited when a case is
 * added, only when the corpus itself changes shape.
 *
 * Each hostile case directory is a MINIMAL package (a valid v2 manifest plus
 * exactly one file carrying its violation) plus one `expect.json`, shaped
 * `{"codes": ["SCRIPT_TAG"]}`, that sits OUTSIDE the package contents — a
 * case dir is zipped for real, through this package's own `packZip`/
 * `unpackZip`, with `expect.json` excluded, and the resulting bytes are handed
 * to `validatePackage` exactly as a consumer would receive them.
 *
 * The contract is SUBSET, not equality: `expected.codes ⊆ codes(findings)`.
 * The scan deliberately over-reports (see `validate.ts`'s own header), so a
 * case may legitimately trip more rules than the one it was built to name.
 * `valid-course` is the one exception and is checked for EQUALITY with the
 * empty set — it is the package Task 16 serves to a real browser, so it must
 * be flawless, not just "flawless enough for this one rule".
 *
 * Two properties this file exists to guarantee, both load-bearing:
 *  - A case directory with no `expect.json` FAILS loudly instead of being
 *    skipped. The corpus is discovered with `readdirSync`, not a hard-coded
 *    list, so a directory added without its `expect.json` still gets its own
 *    `it(...)` — one that throws instead of quietly doing nothing.
 *  - Every failure names the case. Each generated test's title is
 *    `hostile/<case>`, and the per-code assertion message repeats the case
 *    name and the codes that WERE found — a person diagnosing a disagreement
 *    between this file and the Go port needs the case name first, not last.
 *
 * Paths are relative to the process's CWD, same convention `zip.test.ts`
 * already uses for `fixtures/courses/so-dau-phay-dong` (its `ROOT` constant) —
 * `make test-format` and `bun run test` both run with CWD at
 * `packages/course-format`, two directories below the repo root. This is a
 * second copy of that same convention, not a new one: `node-test-env.d.ts`
 * documents why this package hand-declares only the `node:fs` members its
 * tests use rather than pulling in `"types": ["node"]` wholesale, and reaching
 * for `import.meta.url`/`node:path`/`node:url` here would be exactly the
 * "reaching for anything wider" that file exists to make fail first.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { packZip, unpackZip } from './zip';
import { validatePackage } from './validate';

const FORMAT_V2_ROOT = '../../fixtures/format-v2';
const HOSTILE_ROOT = `${FORMAT_V2_ROOT}/hostile`;
const VALID_COURSE_DIR = `${FORMAT_V2_ROOT}/valid-course`;

const EXPECT_FILE = 'expect.json';

interface ExpectedFindings {
  readonly codes: readonly string[];
}

const utf8 = new TextDecoder('utf-8');

/**
 * Reads every file under `dir` into a package-relative `Map`, the shape
 * `packZip`/`validatePackage` take. `expect.json` — the ONE file a hostile
 * case keeps outside its own package contents — is left out wherever it sits,
 * so a case directory zips exactly what a real course package would contain.
 */
function readDirAsPackage(dir: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();

  const walk = (abs: string, prefix: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absChild = `${abs}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(absChild, rel);
        continue;
      }
      if (entry.name === EXPECT_FILE) continue;
      files.set(rel, readFileSync(absChild));
    }
  };

  walk(dir, '');
  return files;
}

/** Zips `dir` through this package's OWN writer, then reads it back through its OWN reader — the exact round trip a real consumer makes, not a shortcut past it. */
function packAndValidate(dir: string): readonly string[] {
  const files = readDirAsPackage(dir);
  const zipped = packZip(files);
  const unpacked = unpackZip(zipped);
  return validatePackage(unpacked).findings.map((f) => f.code);
}

// Discovered, not hard-coded: a case directory that exists on disk gets a test
// whether or not anyone remembered to list it here. This is what makes "a new
// case with no expect.json fails loudly" true — there is no list to forget to
// update.
const hostileCaseNames = readdirSync(HOSTILE_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

describe('hợp đồng fixtures/format-v2/hostile/*', () => {
  it('kho hostile không rỗng', () => {
    // Nếu ai đó lỡ xoá sạch thư mục hostile, vòng lặp dưới đây sinh ra ĐÚNG
    // KHÔNG `it()` nào — và một describe rỗng là XANH theo vitest. Ca này là
    // thứ duy nhất còn đứng ra nói to hộ điều đó.
    expect(hostileCaseNames.length).toBeGreaterThan(0);
  });

  for (const caseName of hostileCaseNames) {
    it(`hostile/${caseName}: expected.codes ⊆ codes(findings)`, () => {
      const dir = `${HOSTILE_ROOT}/${caseName}`;
      const expectPath = `${dir}/${EXPECT_FILE}`;

      let expectedRaw: string;
      try {
        expectedRaw = utf8.decode(readFileSync(expectPath));
      } catch {
        throw new Error(
          `hostile/${caseName}: thiếu ${EXPECT_FILE} — mỗi case hostile PHẢI khai báo mã mong đợi ` +
            `(vd. {"codes": ["SCRIPT_TAG"]}); một case không có tệp này không được bỏ qua âm thầm.`,
        );
      }
      const expected = JSON.parse(expectedRaw) as ExpectedFindings;
      expect(
        Array.isArray(expected.codes) && expected.codes.length > 0,
        `hostile/${caseName}: ${EXPECT_FILE} phải có trường "codes" là mảng khác rỗng`,
      ).toBe(true);

      const codes = new Set(packAndValidate(dir));
      for (const code of expected.codes) {
        expect(
          codes.has(code),
          `hostile/${caseName}: thiếu mã "${code}" trong findings — có: [${[...codes].sort().join(', ')}]`,
        ).toBe(true);
      }
    });
  }
});

describe('hợp đồng fixtures/format-v2/valid-course', () => {
  it('không có phát hiện nào — đây là gói Task 16 phục vụ cho một trình duyệt thật', () => {
    const codes = packAndValidate(VALID_COURSE_DIR);
    expect(codes, `valid-course phải sạch tuyệt đối, nhưng có: [${codes.join(', ')}]`).toEqual([]);
  });
});
