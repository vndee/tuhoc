/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearUserContent,
  DEVICE_PREFERENCE_KEYS,
  readLocalStorage,
  USER_CONTENT_KEYS,
  writeLocalStorage,
} from './localStorage';

beforeEach(() => {
  window.localStorage.clear();
});

/* ====================================================================== *
 * clearUserContent — landmine #1: the classification tsc canh
 * ====================================================================== */

describe('clearUserContent', () => {
  // Brief's own Step 3 example, verbatim: this is the load-bearing case —
  // rename either key and this must catch it, because there is no migration
  // for a browser that already has one written under the old name.
  it('clearUserContent giữ ngôn ngữ và theme, xoá nội dung', () => {
    writeLocalStorage('itbook-lang', 'vi');
    writeLocalStorage('itbook-note-draft', 'nháp');

    clearUserContent();

    expect(readLocalStorage('itbook-lang')).toBe('vi');
    expect(readLocalStorage('itbook-note-draft')).toBeNull();
  });

  it("empties every key holding the user's own words, and leaves this device's preferences alone", () => {
    for (const key of USER_CONTENT_KEYS) window.localStorage.setItem(key, 'chữ của người dùng');
    for (const key of DEVICE_PREFERENCE_KEYS) window.localStorage.setItem(key, 'dark');
    // Not ours: another app on the same origin, an extension, a key from a
    // version of this app that no longer exists. Deleting what we did not
    // write is not tidying, it is breaking someone else's software — which
    // is exactly what the one-line `localStorage.clear()` would do.
    window.localStorage.setItem('not-ours', 'nguyên vẹn');

    clearUserContent();

    for (const key of USER_CONTENT_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
    for (const key of DEVICE_PREFERENCE_KEYS) expect(window.localStorage.getItem(key)).toBe('dark');
    expect(window.localStorage.getItem('not-ours')).toBe('nguyên vẹn');
  });
});

/* ====================================================================== *
 * The tripwires: nothing may become a place user data hides
 * ====================================================================== */

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(SRC_DIR, '../../..');
const INDEX_HTML = resolve(SRC_DIR, '../index.html');

/** Repo-relative, so a violation names the file the way a person would open it. */
function label(file: string): string {
  return relative(REPO_ROOT, file);
}

/**
 * Files this scan does NOT read, and why each one is safe to skip.
 *
 * `*.test.ts(x)` — a test's job includes seeding and observing the very
 * stores production code must not multiply; `MarginCards.test.tsx` reads
 * the draft slot on purpose, and `theme.test.tsx` writes the theme key.
 *
 * `test/setup.ts` — installs the in-memory `Storage` that stands in for
 * the one Bun's runtime breaks under vitest. It is the harness, not the
 * app; it ships in no bundle.
 */
function isProductionSource(relativePath: string): boolean {
  if (/\.test\.tsx?$/.test(relativePath)) return false;
  return relativePath !== join('test', 'setup.ts');
}

function appSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && isProductionSource(relative(SRC_DIR, full))) out.push(full);
    }
  };
  walk(SRC_DIR);
  return out.sort();
}

/**
 * Classic-script JavaScript that runs on reader routes, in this origin, with
 * the same access to every store below — loaded as `<script src>` instead of
 * imported (it attaches globals; see `reader/useCourseKit.ts`). A store
 * opened there would be exactly as invisible to `clearUserContent()` as one
 * opened in `src/`, and exactly as easy to miss, since nothing under `src/`
 * would mention it. `vendor/` is excluded: KaTeX, third-party, not ours to
 * police.
 */
const COURSE_KIT_DIR = resolve(REPO_ROOT, 'packages', 'course-kit');
const COURSES_DIR = resolve(REPO_ROOT, 'courses');

/** Every `.js` under `dir`, skipping `vendor/` (KaTeX, third-party) and `node_modules/`. */
function jsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

function classicScripts(): string[] {
  return [...jsFilesUnder(COURSE_KIT_DIR), ...jsFilesUnder(COURSES_DIR)];
}

function productionSourceFiles(): string[] {
  return [...appSourceFiles(), ...classicScripts()].sort();
}

/** Every place in the app that can outlive a signed-in session, and who is allowed to touch it. */
const PERSISTENCE: readonly { readonly name: string; readonly allowedIn: readonly string[]; readonly why: string }[] = [
  {
    name: 'localStorage',
    // Task 11 (Pha 3) removed the one exception this list used to name —
    // auth/session.ts's offline-read marker (`sessionVerifiedAt`), which
    // went with `<RequireAuth>`'s offline branch, its only reader. Nothing
    // outside db/localStorage.ts has a reason to touch `localStorage`
    // directly any more.
    allowedIn: [join('apps', 'web', 'src', 'db', 'localStorage.ts')],
    why: 'go through readLocalStorage/writeLocalStorage, whose key type forces the key to be classified as content or preference first',
  },
  {
    name: 'sessionStorage',
    allowedIn: [],
    why: 'a third store nothing empties; if a draft needs to survive a reload, the classified localStorage slot already does that',
  },
  {
    name: 'indexedDB',
    allowedIn: [join('apps', 'web', 'src', 'db', 'legacyDrain.ts')],
    why:
      'a database this app has no other reason to touch — the one exception is legacyDrain.ts\'s ONE-TIME read of the Dexie database ' +
      'Task 10 removed, which it is in the middle of deleting, never a persistent store of its own. See that file\'s own doc comment.',
  },
  {
    name: 'caches',
    allowedIn: [],
    why: 'the Cache API keeps whole HTTP responses on disk, per origin, past the end of a session',
  },
];

/** `document.cookie` is checked as a property access rather than by name, so that an unrelated `.cookie` field cannot be mistaken for it. */
function usesDocumentCookie(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'cookie' &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'document'
  );
}

/** Names of the persistence APIs actually referenced by CODE in `source` — comments and string literals are not code, which is the entire reason this reads an AST instead of grepping. */
function persistenceUsedIn(fileName: string, source: string): Set<string> {
  const watched = new Set(PERSISTENCE.map((p) => p.name));
  const found = new Set<string>();
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const walk = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && watched.has(node.text)) found.add(node.text);
    if (usesDocumentCookie(node)) found.add('document.cookie');
    ts.forEachChild(node, walk);
  };
  walk(parsed);
  return found;
}

/**
 * `localStorage` has no enumeration to lean on the way Dexie's `db.tables`
 * used to. Nothing hands you the list of keys the app *can* write, only the
 * ones it happens to have written on this device — so a key that exists but
 * was never classified would be invisible exactly when it matters, on a
 * machine that has not hit the code path yet.
 *
 * So the enumeration is built by hand and defended two ways:
 *
 *   1. **The compiler.** `LocalStorageKey` is the union of the two lists,
 *      and `readLocalStorage`/`writeLocalStorage` take nothing else. A new
 *      key does not typecheck until it has been classified as content or
 *      preference — and classifying it as content is what wires it into
 *      `clearUserContent()`. `bunx tsc -b` is a gate, so this is a wall,
 *      not a note in a doc.
 *   2. **This scan**, which closes the door the compiler cannot: writing
 *      `window.localStorage.setItem(...)` directly, or reaching for
 *      `sessionStorage`, `indexedDB`, the Cache API or `document.cookie` —
 *      any of which would be a place user data lives that
 *      `clearUserContent()` has never heard of.
 *
 * Considered and rejected: an oxlint `no-restricted-globals` rule. It
 * matches bare globals, and every call here is written `window.localStorage`
 * — the rule would sit in the config looking like protection while catching
 * nothing, which is worse than no rule at all.
 */
describe('no third place for user data to hide', () => {
  it('reads its own instrument correctly: code counts, comments and strings do not', () => {
    const decoyed = [
      '// window.localStorage.setItem("x", "y") — a mention, not a use',
      '/** sessionStorage, indexedDB, caches, document.cookie in prose */',
      'const notARealUse = "localStorage";',
      'export const fine = 1;',
    ].join('\n');
    expect([...persistenceUsedIn('decoy.ts', decoyed)]).toEqual([]);

    const real = 'export const v = window.localStorage.getItem("k") ?? document.cookie;';
    expect([...persistenceUsedIn('real.ts', real)].sort()).toEqual(['document.cookie', 'localStorage']);
  });

  it('is looking at the whole app, not at nothing', () => {
    const seen = productionSourceFiles().map(label);
    // A broken glob is the classic way a scan like this goes quietly
    // blind: it keeps passing, because it stops reading anything.
    expect(seen.length).toBeGreaterThan(20);
    expect(seen).toContain(join('apps', 'web', 'src', 'db', 'localStorage.ts'));
    expect(seen).toContain(join('apps', 'web', 'src', 'db', 'legacyDrain.ts'));
    expect(seen).toContain(join('apps', 'web', 'src', 'annotations', 'MarginCards.tsx'));
    expect(seen).toContain(join('packages', 'course-kit', 'runtime.js'));
    expect(seen).not.toContain(join('apps', 'web', 'src', 'db', 'localStorage.test.ts'));
  });

  it('keeps every store that outlives a session inside clearUserContent()’s reach — or names its documented exception', () => {
    const violations: string[] = [];
    for (const file of productionSourceFiles()) {
      const where = label(file);
      const used = persistenceUsedIn(file, readFileSync(file, 'utf-8'));
      for (const api of PERSISTENCE) {
        if (used.has(api.name) && !api.allowedIn.includes(where)) {
          violations.push(`${where} uses ${api.name} — ${api.why}`);
        }
      }
      if (used.has('document.cookie')) {
        violations.push(`${where} uses document.cookie — the session cookie is the server's; nothing here should read or write one`);
      }
    }
    // If this fails: the new store is not the problem, the fact that
    // nothing clears it or accounts for it is. Either route the write
    // through `db/localStorage.ts` (classifying the key), or — if a
    // genuinely different mechanism is needed — add the file to
    // `allowedIn` above with a reason, in the same commit.
    expect(violations).toEqual([]);
  });
});

describe('the localStorage key registry', () => {
  /**
   * Written out in full rather than derived, for the same reason a
   * hard-coded table count would be hard-coded: a list that recomputes
   * itself from the thing it is checking cannot object to anything. Adding
   * a key has to be a decision made HERE, out loud, on one side of the
   * line or the other.
   *
   * The real key names, unchanged by this file's move from `db/local.ts`:
   * `itbook-note-draft` (content), `itbook-theme`/`itbook-lang`
   * (preference). These are live data in people's browsers with no
   * migration path — renaming any of them on this move would be renaming
   * the key underneath data that is already sitting there.
   */
  it('classifies every key, with nothing on both lists', () => {
    expect([...USER_CONTENT_KEYS]).toEqual(['itbook-note-draft']);
    expect([...DEVICE_PREFERENCE_KEYS]).toEqual(['itbook-theme', 'itbook-lang']);

    const all = [...USER_CONTENT_KEYS, ...DEVICE_PREFERENCE_KEYS];
    expect(new Set(all).size).toBe(all.length);
  });

  it("index.html's inline bootstrap reads a key this registry calls a preference", () => {
    // The one reader of localStorage that CANNOT import the registry: a
    // synchronous inline script in <head>, which is what stops a flash of
    // the wrong palette before React loads. Reclassify `itbook-theme` as
    // user content and this fails — which is the point, because
    // `clearUserContent()` would then be deleting the key that script is
    // about to read.
    const html = readFileSync(INDEX_HTML, 'utf-8');
    const keys = [...html.matchAll(/localStorage\.getItem\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(DEVICE_PREFERENCE_KEYS as readonly string[]).toContain(key);
    }
  });
});
