/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearLocalData,
  db,
  DEVICE_PREFERENCE_KEYS,
  mergeRow,
  type ProgressRow,
  setProgress,
  USER_CONTENT_KEYS,
} from './local';

async function clearAll() {
  await clearLocalData();
}

beforeEach(clearAll);
afterEach(clearAll);

describe('mergeRow (pure LWW)', () => {
  // The four cases the brief names verbatim: incoming newer / incoming
  // older / equal timestamps / local absent.
  it('incoming strictly newer than local wins', () => {
    const local: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: false, updatedAt: '2026-08-20T10:00:00.000Z' };
    const incoming: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:01.000Z' };
    expect(mergeRow(local, incoming)).toEqual(incoming);
  });

  it('incoming strictly older than local loses — local is kept unchanged', () => {
    const local: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:05.000Z' };
    const incoming: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: false, updatedAt: '2026-08-20T10:00:01.000Z' };
    expect(mergeRow(local, incoming)).toEqual(local);
  });

  it('equal updatedAt: local wins (strictly-greater required to overwrite, per server LWW)', () => {
    const local: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' };
    // Same instant, different object identity/fields — simulates the exact
    // re-delivery scenario the safety-lagged cursor guarantees will happen.
    const incoming: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: false, updatedAt: '2026-08-20T10:00:00.000Z' };
    expect(mergeRow(local, incoming)).toEqual(local);
  });

  it('local absent (row never seen before) — incoming wins unconditionally', () => {
    const incoming: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' };
    expect(mergeRow(undefined, incoming)).toEqual(incoming);
  });

  // Go's RFC3339Nano formatter (see apps/api/internal/sync/handler.go's
  // timeLayout) trims TRAILING ZERO fractional digits, and drops the
  // fractional part (and its leading '.') ENTIRELY when a timestamp lands
  // on an exact whole second — e.g. "2026-08-20T10:00:00Z", no ".000000".
  // A naive `incoming.updatedAt > local.updatedAt` STRING comparison
  // breaks exactly here: '.' (0x2E) sorts below 'Z' (0x5A), so
  // "...:00.500Z" (500ms into the second) would lexicographically compare
  // as LESS than "...:00Z" (the exact second boundary, i.e. 0ms) even
  // though 500ms is chronologically LATER. mergeRow must compare parsed
  // instants (Date.parse), not raw strings, or this flips a real ordering
  // backwards and could apply a stale row as if it were newer.
  it('does not mis-order a fractional timestamp against a same-second whole-second timestamp (RFC3339Nano trimming)', () => {
    const local: ProgressRow = {
      courseId: 'c1',
      chapterId: 'ch1',
      status: 'read',
      done: true,
      updatedAt: '2026-08-20T10:00:00.500Z', // 500ms into the second — chronologically LATER
    };
    const incoming: ProgressRow = {
      courseId: 'c1',
      chapterId: 'ch1',
      status: 'read',
      done: false,
      updatedAt: '2026-08-20T10:00:00Z', // exact second boundary, i.e. 0ms — chronologically EARLIER, but a naive string compare would say it's greater ('Z' > '.')
    };
    // incoming is chronologically older, so it must lose — a naive string
    // comparison would (incorrectly) apply it.
    expect(mergeRow(local, incoming)).toEqual(local);

    // And the reverse direction must correctly apply the newer row.
    const olderLocal: ProgressRow = { ...local, done: false, updatedAt: '2026-08-20T10:00:00Z' };
    const newerIncoming: ProgressRow = { ...incoming, done: true, updatedAt: '2026-08-20T10:00:00.500Z' };
    expect(mergeRow(olderLocal, newerIncoming)).toEqual(newerIncoming);
  });

  it('applies the same rule to annotation rows (deletedAt tombstones are just another field, not special-cased)', () => {
    const local = {
      id: 'a1',
      courseId: 'c1',
      chapterId: 'ch1',
      anchor: { x: 1 },
      note: 'note',
      createdAt: '2026-08-20T09:00:00.000Z',
      updatedAt: '2026-08-20T09:00:00.000Z',
      deletedAt: null as string | null,
    };
    const tombstone = { ...local, updatedAt: '2026-08-20T09:05:00.000Z', deletedAt: '2026-08-20T09:05:00.000Z' };
    expect(mergeRow(local, tombstone)).toEqual(tombstone);

    // A replay of the SAME tombstone (identical updatedAt) must not
    // "resurrect" anything — it's already a no-op equal case.
    expect(mergeRow(tombstone, { ...tombstone })).toEqual(tombstone);

    // An OLDER, not-yet-deleted version replayed after the tombstone was
    // already applied locally must never resurrect the row.
    expect(mergeRow(tombstone, local)).toEqual(tombstone);
  });
});

describe('setProgress', () => {
  it('writes the progress row to db.progress with a client-generated updatedAt, and enqueues it in db.outbox', async () => {
    const before = Date.now();
    await setProgress('c1', 'ch1', 'read', true);
    const after = Date.now();

    const row = await db.progress.get(['c1', 'ch1', 'read']);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true });
    const updatedAtMs = Date.parse(row!.updatedAt);
    expect(updatedAtMs).toBeGreaterThanOrEqual(before);
    expect(updatedAtMs).toBeLessThanOrEqual(after);

    const outboxRows = await db.outbox.toArray();
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].table).toBe('progress');
    expect(outboxRows[0].row).toEqual(row);
  });

  it('a second call for the same courseId+chapterId+status overwrites the local row in place (same PK) but adds a SECOND outbox entry', async () => {
    await setProgress('c1', 'ch1', 'read', false);
    await setProgress('c1', 'ch1', 'read', true);

    const rows = await db.progress.where({ courseId: 'c1', chapterId: 'ch1', status: 'read' }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].done).toBe(true);

    const outboxRows = await db.outbox.toArray();
    expect(outboxRows).toHaveLength(2);
  });

  it('different status values for the same course/chapter are independent rows (PK includes status)', async () => {
    await setProgress('c1', 'ch1', 'read', true);
    await setProgress('c1', 'ch1', 'started', true);

    const rows = await db.progress.where({ courseId: 'c1', chapterId: 'ch1' }).toArray();
    expect(rows).toHaveLength(2);
  });
});

describe('clearLocalData', () => {
  it('empties every table in the schema, not a hand-maintained list of four', async () => {
    await db.progress.put({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' });
    await db.annotations.put({
      id: '11111111-1111-4111-8111-111111111111',
      courseId: 'c1',
      chapterId: 'ch1',
      anchor: {},
      note: 'n',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
      deletedAt: null,
    });
    await db.outbox.add({ table: 'progress', row: {} });
    await db.meta.put({ key: 'syncCursor', value: '2026-08-20T10:00:00Z' });

    // Pre-condition: every table genuinely has something in it, so the
    // assertion below can't pass vacuously.
    const before = await Promise.all(db.tables.map((t) => t.count()));
    expect(before.every((n) => n > 0)).toBe(true);
    expect(db.tables).toHaveLength(4);

    await clearLocalData();

    const after = await Promise.all(db.tables.map((t) => t.count()));
    expect(after).toEqual(db.tables.map(() => 0));
  });

  it("empties every key holding the user's own words, and leaves this device's preferences alone", async () => {
    for (const key of USER_CONTENT_KEYS) window.localStorage.setItem(key, 'chữ của người dùng');
    for (const key of DEVICE_PREFERENCE_KEYS) window.localStorage.setItem(key, 'dark');
    // Not ours: another app on the same origin, an extension, a key from a
    // version of this app that no longer exists. Deleting what we did not
    // write is not tidying, it is breaking someone else's software — which
    // is exactly what the one-line `localStorage.clear()` would do.
    window.localStorage.setItem('not-ours', 'nguyên vẹn');

    await clearLocalData();

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
 * `packages/course-kit/runtime.js` runs on every reader route, in this
 * origin, with the same access to every store below — it is just loaded as
 * a classic `<script src>` instead of imported (it attaches globals; see
 * `reader/useCourseKit.ts`). A store opened there would be exactly as
 * invisible to `clearLocalData()` as one opened in `src/`, and exactly as
 * easy to miss, since nothing under `src/` would mention it.
 *
 * `vendor/` next to it is KaTeX, third-party and not ours to police.
 */
const COURSE_KIT_RUNTIME = resolve(SRC_DIR, '../../../packages/course-kit/runtime.js');

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

function productionSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && isProductionSource(relative(SRC_DIR, full))) out.push(full);
    }
  };
  walk(SRC_DIR);
  out.push(COURSE_KIT_RUNTIME);
  return out.sort();
}

/** Every place in the app that can outlive a signed-in session, and who is allowed to touch it. */
const PERSISTENCE: readonly { readonly name: string; readonly allowedIn: readonly string[]; readonly why: string }[] = [
  {
    name: 'localStorage',
    allowedIn: [join('apps', 'web', 'src', 'db', 'local.ts')],
    why: 'go through readLocalStorage/writeLocalStorage, whose key type forces the key to be classified as content or preference first',
  },
  {
    name: 'sessionStorage',
    allowedIn: [],
    why: 'a third store nothing empties; if a draft needs to survive a reload, the classified localStorage slot already does that',
  },
  {
    name: 'indexedDB',
    allowedIn: [],
    why: 'a second database is invisible to clearLocalData(), which enumerates db.tables of the ONE Dexie instance',
  },
  {
    name: 'Dexie',
    allowedIn: [join('apps', 'web', 'src', 'db', 'local.ts')],
    why: 'one database instance for the whole app — see the `db` export',
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
 * The `db.tables` assertion above is a tripwire for a FIFTH TABLE: add one
 * and the count changes, so somebody has to come here and think. It works
 * because Dexie enumerates its own tables, and `clearLocalData()` can
 * therefore be right about a table nobody has written yet.
 *
 * `localStorage` has no such enumeration to lean on. Nothing hands you the
 * list of keys the app *can* write, only the ones it happens to have
 * written on this device — so a key that exists but was never classified
 * would be invisible exactly when it matters, on a machine that has not
 * hit the code path yet. That is how the note draft slipped past: Task 6
 * did not inline a copy of the clearing logic (the failure
 * `docs/carried-forward.md` warns about), it did the equivalent one level
 * up — it opened a store of user content that the truth point had never
 * heard of.
 *
 * So the enumeration is built by hand and defended two ways:
 *
 *   1. **The compiler.** `LocalStorageKey` is the union of the two lists,
 *      and `readLocalStorage`/`writeLocalStorage` take nothing else. A new
 *      key does not typecheck until it has been classified as content or
 *      preference — and classifying it as content is what wires it into
 *      `clearLocalData()`. `bunx tsc -b` is a gate, so this is a wall, not
 *      a note in a doc.
 *   2. **This scan**, which closes the door the compiler cannot: writing
 *      `window.localStorage.setItem(...)` directly, or reaching for
 *      `sessionStorage`, a second IndexedDB database, the Cache API or
 *      `document.cookie` — any of which would be a place user data lives
 *      that `clearLocalData()` has never heard of.
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
    expect(seen).toContain(join('apps', 'web', 'src', 'db', 'local.ts'));
    expect(seen).toContain(join('apps', 'web', 'src', 'annotations', 'MarginCards.tsx'));
    expect(seen).toContain(join('packages', 'course-kit', 'runtime.js'));
    expect(seen).not.toContain(join('apps', 'web', 'src', 'db', 'local.test.ts'));
  });

  it('keeps every store that outlives a session inside clearLocalData()’s reach', () => {
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
    // `clearLocalData()` does not know about it is. Either route the write
    // through `db/local.ts` (classifying the key), or — if a genuinely
    // different mechanism is needed — teach `clearLocalData()` to empty it
    // and add the file to `allowedIn` above, in the same commit.
    expect(violations).toEqual([]);
  });
});

describe('the localStorage key registry', () => {
  /**
   * Written out in full rather than derived, for the same reason the
   * `db.tables` assertion above hard-codes 4: a list that recomputes
   * itself from the thing it is checking cannot object to anything. Adding
   * a key has to be a decision made HERE, out loud, on one side of the
   * line or the other.
   */
  it('classifies every key, with nothing on both lists', () => {
    expect([...USER_CONTENT_KEYS]).toEqual(['itbook-note-draft']);
    expect([...DEVICE_PREFERENCE_KEYS]).toEqual(['itbook-theme']);

    const all = [...USER_CONTENT_KEYS, ...DEVICE_PREFERENCE_KEYS];
    expect(new Set(all).size).toBe(all.length);
  });

  it("index.html's inline bootstrap reads a key this registry calls a preference", () => {
    // The one reader of localStorage that CANNOT import the registry: a
    // synchronous inline script in <head>, which is what stops a flash of
    // the wrong palette before React loads (see
    // test/indexHtmlThemeBootstrap.test.ts). Reclassify `itbook-theme` as
    // user content and this fails — which is the point, because
    // `clearLocalData()` would then be deleting the key that script is
    // about to read.
    const html = readFileSync(INDEX_HTML, 'utf-8');
    const keys = [...html.matchAll(/localStorage\.getItem\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(DEVICE_PREFERENCE_KEYS as readonly string[]).toContain(key);
    }
  });
});
