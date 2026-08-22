/**
 * Semver **precedence**. Not semver validity — that belongs to
 * `packages/course-format/src/validate.ts` and its `SEMVER` finding, and this
 * file must never become a second opinion about it.
 *
 * ## Why this is not the fourth copy of the rule set
 *
 * The rule set answers *"is this string a version?"*. It has no opinion on
 * *"which of these two versions is newer"*, because nothing in a single package
 * needs one. The registry does, because an index has to name a `latest`.
 *
 * The seam is kept honest two ways:
 *
 *   1. **Order is only ever asked of strings the rule set already accepted.**
 *      `buildIndex` validates every package before it sorts anything.
 *   2. **An unparseable version throws.** There is deliberately no
 *      "fall back to string comparison" branch, because that fallback is
 *      exactly the bug this file exists to prevent, and a silent one.
 *
 * ## The bug this file exists to prevent
 *
 * `"1.10.0" < "1.9.0"` is **true** in JavaScript, in Go, and in Python — `'1'`
 * then `'.'` then `'1'` vs `'9'`, and `'1' < '9'`. This repo has walked into it
 * twice: once on the Go side, and once in `scripts/course_workspace.py`, whose
 * comment at line 173 names the trap in so many words. It looks correct on
 * every version anyone tests by hand, right up to the tenth minor release.
 *
 * Precedence follows https://semver.org/#spec-item-11:
 *   - major, then minor, then patch, compared as NUMBERS;
 *   - a pre-release version has LOWER precedence than the normal version
 *     (`1.0.0-rc.1 < 1.0.0`);
 *   - pre-release identifiers compare left to right; numeric identifiers
 *     compare numerically (so `rc.2 < rc.10`, the same trap one level down),
 *     alphanumeric ones compare as ASCII, numeric always ranks lower than
 *     alphanumeric, and a longer identifier list wins when all else is equal;
 *   - **build metadata is ignored** (`1.0.0+a` and `1.0.0+b` have equal
 *     precedence). That is the spec, not an omission.
 */

/** Same shape as `validate.ts`'s `SEMVER_RE`, and used only after it has passed. */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const NUMERIC_RE = /^(0|[1-9]\d*)$/;

export class NotSemverError extends Error {
  readonly value: string;

  constructor(value: string) {
    super(`không phải semver, không sắp thứ tự được: "${value}"`);
    this.name = 'NotSemverError';
    this.value = value;
  }
}

interface Parsed {
  major: number;
  minor: number;
  patch: number;
  /** `[]` for a normal release; identifiers, in order, for a pre-release. */
  pre: string[];
}

function parse(value: string): Parsed {
  const m = SEMVER_RE.exec(value);
  if (m === null) throw new NotSemverError(value);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] === undefined || m[4] === '' ? [] : m[4].split('.'),
  };
}

function comparePre(a: string[], b: string[]): number {
  // "a pre-release version has lower precedence than a normal version".
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as string;
    const y = b[i] as string;
    if (x === y) continue;

    const xNum = NUMERIC_RE.test(x);
    const yNum = NUMERIC_RE.test(y);
    // `rc.2` before `rc.10` — the same lexicographic trap, one level down.
    if (xNum && yNum) return Number(x) - Number(y);
    // "Numeric identifiers always have lower precedence than alphanumeric".
    if (xNum) return -1;
    if (yNum) return 1;
    return x < y ? -1 : 1;
  }
  // "A larger set of pre-release fields has a higher precedence".
  return a.length - b.length;
}

/**
 * `< 0` when `a` is older, `0` when the two have equal precedence, `> 0` when
 * `a` is newer.
 *
 * @throws {NotSemverError} either side is not a semver string.
 */
export function compareSemver(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (x.major !== y.major) return x.major - y.major;
  if (x.minor !== y.minor) return x.minor - y.minor;
  if (x.patch !== y.patch) return x.patch - y.patch;
  return comparePre(x.pre, y.pre);
}

/** A new array, oldest first. Never sorts in place; never falls back to string order. */
export function sortSemverAscending(versions: readonly string[]): string[] {
  return [...versions].sort(compareSemver);
}
