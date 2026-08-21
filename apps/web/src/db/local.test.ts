/// <reference types="node" />
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearLocalData,
  db,
  DEVICE_PREFERENCE_KEYS,
  mergeRow,
  type PackageRow,
  type ProgressRow,
  setProgress,
  USER_CONTENT_KEYS,
} from './local';

async function clearAll() {
  await clearLocalData();
}

beforeEach(clearAll);
afterEach(clearAll);

/** A minimal, valid cached course package — enough to seed `db.packages`. */
function packageRow(courseId = 'demo', version = '1.0.0'): PackageRow {
  const manifest = {
    id: courseId,
    title: 'Khóa học đã lưu',
    description: '',
    lang: 'vi',
    version,
    runtime: '^1',
    tier: 'content',
    parts: [{ title: 'Phần 1', chapters: [{ id: 'c1', num: '1.1', title: 'Chương một', short: 'C1', file: 'chapters/c1.html' }] }],
  };
  const encode = (s: string) => new TextEncoder().encode(s);
  return {
    key: `${courseId}@${version}`,
    courseId,
    version,
    manifest,
    files: {
      'manifest.json': encode(JSON.stringify(manifest)),
      'chapters/c1.html': encode('<h1 class="ch-title">Chương một</h1>'),
    },
    pinnedAt: '2026-08-21T10:00:00.000Z',
  };
}

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
  /**
   * THE TRIPWIRE, and the number it guards.
   *
   * Five, as of Task 7's `packages` table. It was four
   * (`progress`/`annotations`/`outbox`/`meta`) and the count was raised
   * DELIBERATELY, which is the only way it is ever allowed to move —
   * `docs/carried-forward.md`'s standing warning is "change the number,
   * do not 'fix' the helper," because the helper (`clearLocalData`
   * enumerating `db.tables`) being right about a table nobody has written
   * yet is precisely what makes this assertion cheap enough to keep.
   *
   * What the fifth table holds and why it belongs on the clearing side of
   * the line: an imported course package is the reader's own copy of
   * somebody's course, sitting in a browser-scoped database that never
   * expires. A private course surviving into the next person's session on
   * a shared laptop is the same failure as their half-typed note doing so
   * — see USER_CONTENT_KEYS's comment for the incident that rule came
   * from. `packages` is user CONTENT, not a device preference.
   *
   * Written out by name rather than only counted: `toHaveLength(5)` would
   * also pass if somebody added a sixth table and deleted a different one.
   */
  it('has exactly five tables, and they are the five this file knows about', () => {
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'annotations',
      'meta',
      'outbox',
      'packages',
      'progress',
    ]);
  });

  it('signing out deletes cached course packages too — a private course is user data, not a device setting', async () => {
    await db.packages.put(packageRow());
    expect(await db.packages.count()).toBe(1);

    await clearLocalData();

    expect(await db.packages.count()).toBe(0);
  });

  it('empties every table in the schema, not a hand-maintained list of five', async () => {
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
    await db.packages.put(packageRow());

    // Pre-condition: every table genuinely has something in it, so the
    // assertion below can't pass vacuously.
    const before = await Promise.all(db.tables.map((t) => t.count()));
    expect(before.every((n) => n > 0)).toBe(true);
    expect(db.tables).toHaveLength(5);

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
 * Classic-script JavaScript that runs on reader routes, in this origin, with
 * the same access to every store below — loaded as `<script src>` instead of
 * imported (it attaches globals; see `reader/useCourseKit.ts`). A store
 * opened there would be exactly as invisible to `clearLocalData()` as one
 * opened in `src/`, and exactly as easy to miss, since nothing under `src/`
 * would mention it.
 *
 * This is a GLOB, not a file list, and that is the point. The first version
 * of this scan named `packages/course-kit/runtime.js` alone. Every word of
 * its reasoning applied verbatim to `courses/<id>/viz.js` — 3,159 lines,
 * same origin, same `<script src>`, equally unmentioned in `src/` — which
 * was simply not scanned. P2's overall review caught it. A rule that names
 * one file instead of the class it belongs to holds only until the second
 * member of the class appears, and here the count grows with every course
 * the registry ever accepts.
 *
 * `vendor/` is excluded: KaTeX, third-party, not ours to police.
 */
function classicScripts(): string[] {
  const roots = [resolve(SRC_DIR, '../../../packages/course-kit'), resolve(SRC_DIR, '../../../courses')];
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  roots.forEach(walk);
  return out;
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

/**
 * Every non-test `.ts`/`.tsx` file under `apps/web/src` — this application's
 * own code, and nothing else's.
 *
 * Split out from `productionSourceFiles` because the two scans in this file
 * have different jurisdictions. The persistence scan has to include the
 * classic scripts (a store opened in `runtime.js` outlives a session exactly
 * as hard as one opened here). The HTML-sink scan at the bottom must NOT:
 * `runtime.js` builds tooltips and control panels out of HTML strings by
 * design, that is what a rendering runtime does, and it never sees a
 * manifest field. Pointing a rule at code it was not written about produces
 * violations with no correct resolution — the same category error ruling
 * S1-F8 refused when it kept the markup rules off `manifest.json`.
 */
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

function productionSourceFiles(): string[] {
  return [...appSourceFiles(), ...classicScripts()].sort();
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
 * The `db.tables` assertion above is a tripwire for the NEXT table: add one
 * and the count changes, so somebody has to come here and think. It works
 * because Dexie enumerates its own tables, and `clearLocalData()` can
 * therefore be right about a table nobody has written yet. It has now been
 * tripped exactly once, by Task 7's `packages`, and it did its job — the
 * count was raised on purpose and the sign-out test above was written to
 * PROVE the new table gets emptied, rather than left to be true by luck.
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

/* ====================================================================== *
 * The other tripwire: a manifest field must never become markup
 * ====================================================================== */

/**
 * Names of the HTML SINKS — the expressions that turn a STRING into
 * MARKUP — actually reached by CODE in `source`, one entry per occurrence,
 * in source order. Comments and string literals do not count, which is
 * why this reads an AST rather than grepping.
 *
 * Reads are deliberately not sinks. `reader/getContext.ts` concatenates
 * `node.outerHTML` to build the "copy this section" payload; reading
 * markup out of the DOM is the opposite of injecting a string into it,
 * and a rule that could not tell the two apart would either have to
 * exempt that file — weakening it for the real case — or be argued with
 * every time somebody serializes a node.
 *
 * Known blind spot, written down rather than papered over: a sink reached
 * through a computed member (`el[k] = s`) or spread into JSX
 * (`<div {...props} />`) is invisible here. Both are unusual enough that
 * catching the ordinary spelling is worth having; neither appears in this
 * codebase today.
 */
function htmlSinksUsedIn(fileName: string, source: string): string[] {
  const found: string[] = [];
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /** The property name being ASSIGNED to (`=` or `+=`), or null — a read returns null. */
  const assignedProperty = (node: ts.Node): string | null => {
    if (!ts.isBinaryExpression(node)) return null;
    const op = node.operatorToken.kind;
    if (op !== ts.SyntaxKind.EqualsToken && op !== ts.SyntaxKind.PlusEqualsToken) return null;
    return ts.isPropertyAccessExpression(node.left) ? node.left.name.text : null;
  };

  /** The method name being CALLED on some object, or null. */
  const calledMethod = (node: ts.Node): string | null =>
    ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;

  const isDocumentCall = (node: ts.Node): boolean =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'document';

  const propertyName = (node: ts.Node): string | null => {
    if (ts.isJsxAttribute(node)) return ts.isIdentifier(node.name) ? node.name.text : null;
    if (ts.isPropertyAssignment(node)) {
      return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
    }
    if (ts.isShorthandPropertyAssignment(node)) return node.name.text;
    return null;
  };

  const walk = (node: ts.Node): void => {
    const assigned = assignedProperty(node);
    if (assigned === 'innerHTML' || assigned === 'outerHTML') found.push(assigned);

    const called = calledMethod(node);
    if (called === 'insertAdjacentHTML' || called === 'createContextualFragment') found.push(called);
    if ((called === 'write' || called === 'writeln') && isDocumentCall(node)) found.push('document.write');

    if (propertyName(node) === 'dangerouslySetInnerHTML') found.push('dangerouslySetInnerHTML');

    ts.forEachChild(node, walk);
  };
  walk(parsed);
  return found;
}

/** Every HTML sink this app is allowed to contain, where, and how many times. */
const HTML_SINKS_ALLOWED: readonly {
  readonly sink: string;
  readonly file: string;
  readonly times: number;
  readonly why: string;
}[] = [
  {
    sink: 'innerHTML',
    file: join('apps', 'web', 'src', 'reader', 'ChapterView.tsx'),
    times: 1,
    why: 'the chapter fragment — the one string in this app that IS markup, and the only one a course author is allowed to write',
  },
];

/**
 * THE FLOOR RULING S1-F8 STANDS ON.
 *
 * The shared rule set (`packages/course-format/src/validate.ts`) scans a
 * package's HTML with the markup rules and deliberately does NOT scan
 * `manifest.json` with them. That was the right call, and it is worth
 * restating why: a manifest is DATA. Running `<script>` / `on*=` /
 * `javascript:` detectors over a JSON document reports a course whose
 * DESCRIPTION happens to mention `<script>` — a false positive with no fix
 * available to the author, since that sentence is simply what their course
 * is about. Refusing to make that category error is what ruling S1-F8
 * decided.
 *
 * But the decision is CONDITIONAL, and this is the condition: it holds
 * exactly as long as no manifest field ever reaches an HTML sink. Today the
 * app satisfies that with room to spare — every manifest string (`title`,
 * `description`, part and chapter titles, `num`) is rendered as a React
 * text node in `Dashboard`, `CourseHome`, `Sidebar`, `Reader` and
 * `ChapterView`'s breadcrumb, and React escapes text nodes. That is not a
 * property anyone had written down, though; it is a property that happened
 * to be true — the kind that stops being true in a hurry once manifests
 * arrive from strangers' packages instead of from this repo.
 *
 * Task 7 is where manifests started arriving from strangers: an imported
 * package's manifest goes into `db.packages` and comes back out through
 * `course/loader.ts` with no markup scan anywhere along the way — by
 * design, per the ruling. So the ruling's floor gets a test.
 *
 * If this goes red, the fix is almost never "add the file to the
 * allowlist." It is: render the string as text. And if some future feature
 * genuinely must inject markup built from a manifest, then S1-F8 has to be
 * REOPENED in the same commit — at that moment the manifest stops being
 * data the reader only ever reads, and the validator's decision not to scan
 * it stops being free.
 */
describe('a manifest field is text, never markup (the floor under ruling S1-F8)', () => {
  it('reads its own instrument correctly: writing markup counts, reading it does not', () => {
    const decoyed = [
      '// el.innerHTML = manifest.title — a mention, not a use',
      '/** dangerouslySetInnerHTML, insertAdjacentHTML, document.write in prose */',
      'const notARealUse = "innerHTML";',
      'export const serialized = node.outerHTML;',
      'export const current = el.innerHTML;',
      'export const same = el.innerHTML === other.innerHTML;',
    ].join('\n');
    expect(htmlSinksUsedIn('decoy.ts', decoyed)).toEqual([]);

    const real = [
      'el.innerHTML = m.title;',
      'el.outerHTML = m.description;',
      'el.innerHTML += m.title;',
      'el.insertAdjacentHTML("beforeend", m.title);',
      'document.write(m.title);',
      'range.createContextualFragment(m.title);',
    ].join('\n');
    expect(htmlSinksUsedIn('real.ts', real).sort()).toEqual([
      'createContextualFragment',
      'document.write',
      'innerHTML',
      'innerHTML',
      'insertAdjacentHTML',
      'outerHTML',
    ]);

    expect(
      htmlSinksUsedIn('real.tsx', 'export const V = () => <div dangerouslySetInnerHTML={{ __html: m.title }} />;'),
    ).toEqual(['dangerouslySetInnerHTML']);
  });

  it('is looking at the whole app, and at the one sink it allows', () => {
    const seen = appSourceFiles().map(label);
    expect(seen.length).toBeGreaterThan(20);
    for (const allowed of HTML_SINKS_ALLOWED) expect(seen).toContain(allowed.file);

    // Not vacuous: the allowlisted sink is genuinely found where it is
    // allowed. A scanner that quietly stopped matching anything would
    // otherwise keep this suite green while protecting nothing.
    for (const allowed of HTML_SINKS_ALLOWED) {
      const file = resolve(REPO_ROOT, allowed.file);
      const used = htmlSinksUsedIn(file, readFileSync(file, 'utf-8')).filter((s) => s === allowed.sink);
      expect(used).toHaveLength(allowed.times);
    }
  });

  it('has no HTML sink anywhere else — no manifest string can become markup', () => {
    const violations: string[] = [];
    for (const file of appSourceFiles()) {
      const where = label(file);
      const sinks = htmlSinksUsedIn(file, readFileSync(file, 'utf-8'));
      for (const sink of new Set(sinks)) {
        const allowed = HTML_SINKS_ALLOWED.find((a) => a.sink === sink && a.file === where);
        const times = sinks.filter((s) => s === sink).length;
        if (!allowed) {
          violations.push(
            `${where} turns a string into markup via ${sink} — a manifest arrives inside a stranger's package and is never scanned for markup (ruling S1-F8); render it as text instead`,
          );
        } else if (times !== allowed.times) {
          violations.push(`${where} uses ${sink} ${times}× (expected ${allowed.times}: ${allowed.why})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
