/// <reference types="node" />
import Dexie from 'dexie';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLocalData,
  db,
  DEVICE_PREFERENCE_KEYS,
  mergeRow,
  type PackageRow,
  type ProgressRow,
  readSessionVerifiedAt,
  rememberSessionVerified,
  SESSION_VERIFIED_KEY,
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
 * The offline-read marker (Task 7b)
 * ====================================================================== */

describe('the "somebody was signed in here" marker', () => {
  it('round-trips through db.meta as a parsed instant', async () => {
    await rememberSessionVerified(new Date('2026-08-21T10:00:00.000Z'));

    expect(await readSessionVerifiedAt()).toBe(Date.parse('2026-08-21T10:00:00.000Z'));
  });

  it('is absent until something writes it, and unreadable garbage reads as absent', async () => {
    expect(await readSessionVerifiedAt()).toBeNull();

    await db.meta.put({ key: SESSION_VERIFIED_KEY, value: 'không phải mốc thời gian' });
    // `Date.parse` of junk is NaN, and NaN would sail through every
    // `now - verifiedAt < window` comparison as `false` — which happens to
    // be the safe answer, but only by accident. Answering `null` makes the
    // safe answer deliberate.
    expect(await readSessionVerifiedAt()).toBeNull();
  });

  it('holds NO identity — only an instant, and that is what makes it cheap to be wrong about', async () => {
    // The whole reason `<RequireAuth>` can consult this marker without
    // repeating P2's cross-account leak: even in the worst case (a stale
    // row nothing erased), it says "somebody was signed in on this device
    // at T" and cannot say WHO. There is no name, no email, no user id to
    // render at the next person. If a future edit adds one, this fails.
    await rememberSessionVerified(new Date('2026-08-21T10:00:00.000Z'));

    const row = await db.meta.get(SESSION_VERIFIED_KEY);
    expect(row?.value).toBe('2026-08-21T10:00:00.000Z');
  });

  it('is erased by clearLocalData() without a line being written for it — it lives in db.meta', async () => {
    await rememberSessionVerified();
    expect(await readSessionVerifiedAt()).not.toBeNull();

    await clearLocalData();

    expect(await readSessionVerifiedAt()).toBeNull();
  });

  it('is gone when the clear happens to run AFTER the write has landed', async () => {
    // The easy interleaving, and the one IndexedDB gives you by default:
    // the `put` transaction is created first, so it commits first and the
    // `clear` that follows sweeps it up. Nothing but `clearLocalData()`
    // itself is doing any work here — which is exactly why this test alone
    // is NOT enough. See the next one.
    const inFlight = rememberSessionVerified();
    await clearLocalData();
    await inFlight;

    expect(await readSessionVerifiedAt()).toBeNull();
    expect(await db.meta.count()).toBe(0);
  });

  it('cannot be resurrected by a write that lands AFTER the browser was declared clean', async () => {
    // The hard interleaving, and the only one that is actually dangerous:
    // `GET /me` settles a moment after `useLogout` finished clearing, and
    // its write lands in a database somebody has already been told is
    // empty. That is the P2 cross-account leak's exact shape, and the shape
    // `sync/engine.ts`'s `syncEpoch` exists for one layer down.
    //
    // The `put` is gated rather than raced: an interleaving that depends on
    // which promise wins is a test that passes for luck. This one pins the
    // order — capture the generation, let the whole clear finish, THEN let
    // the write through.
    const realPut = db.meta.put.bind(db.meta);
    let letTheWriteLand!: () => void;
    const gate = new Promise<void>((resolve) => {
      letTheWriteLand = resolve;
    });
    // `Dexie.Promise`, not a native `async` function: `Table.put` is typed
    // to return Dexie's own `PromiseExtended`, and `bunx tsc -b` — a real
    // gate here — rejects a plain `Promise` in its place.
    const put = vi.spyOn(db.meta, 'put').mockImplementation((row) => Dexie.Promise.resolve(gate).then(() => realPut(row)));

    try {
      const inFlight = rememberSessionVerified();
      await clearLocalData();
      // Nothing has been written yet: the clear ran against an empty table
      // and would have swept nothing even if it wanted to.
      expect(await db.meta.count()).toBe(0);

      letTheWriteLand();
      await inFlight;

      expect(put).toHaveBeenCalledTimes(1);
      expect(await readSessionVerifiedAt()).toBeNull();
      expect(await db.meta.count()).toBe(0);
    } finally {
      put.mockRestore();
    }
  });

  it('still writes normally when no clear happens around it', async () => {
    // The complement of the test above — a guard that refused every write
    // would also pass it.
    await clearLocalData();
    await rememberSessionVerified(new Date('2026-08-21T10:00:00.000Z'));

    expect(await readSessionVerifiedAt()).toBe(Date.parse('2026-08-21T10:00:00.000Z'));
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
 * Every non-test `.ts`/`.tsx` file under `apps/web/src` — the React half of
 * this application, and nothing else's code.
 *
 * This is ONE root of the HTML-sink scan's jurisdiction, not the whole of it;
 * see `BROWSER_CODE_ROOTS`. It used to be the whole of it, and that is the
 * bug this comment exists to keep from coming back.
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
 * The other tripwire: no data a COURSE PACKAGE controls may become markup
 * in code we ship to the reader's browser
 * ====================================================================== */

/**
 * WHAT THIS SCAN IS ABOUT, AND WHY THE HEADING ABOVE CHANGED.
 *
 * It used to say "a manifest field must never become markup", and its
 * jurisdiction was `appSourceFiles()` — ONE DIRECTORY (`apps/web/src`) and
 * TWO EXTENSIONS (`.ts`, `.tsx`) — while the test that asserted the
 * jurisdiction called itself "is looking at the whole app". It was not. The
 * gap was written down in prose, and the prose was TRUE BUT IRRELEVANT:
 * `packages/course-kit/runtime.js` was exempted because "it never sees a
 * manifest field". That is correct. It is also beside the point, because
 * `runtime.js:340` concatenated a CHAPTER field — `data-viz`, typed by the
 * course author — straight into `innerHTML` on the LIVE document.
 *
 * Measured, in real Chromium, on a package that `tuhoc pack` exits 0 on and
 * `validatePackage` returns `ok: true, findings: []` for, declaring the tier
 * that promises readers "không có JavaScript":
 *
 *     img after container.innerHTML = chapter : 0
 *     img after CourseKit.initViz(container)  : 1
 *     typeof img.onerror                      : function
 *     handler ACTUALLY RAN (count)            : 1
 *     request that left the browser           : 1
 *
 * So the rule is restated one level up, where it was always supposed to be:
 *
 *     NO DATA A COURSE PACKAGE CONTROLS MAY BECOME MARKUP IN CODE WE SHIP.
 *
 * A manifest field is one KIND of package-controlled data. A chapter's
 * attribute values are another. Framing the rule around the kind instead of
 * the class is what let this through fourteen tasks and five gates.
 *
 * And the jurisdiction is restated as a LAYER rather than as a path shape:
 * every FIRST-PARTY file that runs inside the reader's page, whatever
 * directory it lives in and whatever extension it carries. `.tsx` modules,
 * a classic `<script src>`, an inline `<script>` in the shell — same page,
 * same origin, same access, therefore same rule.
 *
 * WHAT IS DELIBERATELY OUT OF JURISDICTION, and this one IS a real
 * distinction rather than a path accident: `courses/<id>/viz.js`. That file
 * is not code we ship — it is the PAYLOAD, and `tier: "interactive"` exists
 * precisely to let a package execute code (spec §1.2). Reporting its
 * `innerHTML` calls would produce violations with no correct resolution,
 * which is the category error ruling S1-F8 refused. What governs a payload
 * is the tier gate and the rule set, not this scan. What governs OUR code is
 * this scan.
 */
const BROWSER_CODE_ROOTS: readonly {
  /** How a person would name this root. */
  readonly name: string;
  /** The files it contributes, already absolute. */
  readonly files: () => string[];
  /** Why code here runs in the reader's page. */
  readonly why: string;
}[] = [
  {
    name: 'apps/web/src/**/*.ts(x)',
    files: appSourceFiles,
    why: 'the React application itself',
  },
  {
    name: 'packages/course-kit/**/*.js (minus vendor/)',
    files: () => jsFilesUnder(COURSE_KIT_DIR),
    why: 'the reader runtime, loaded as a classic <script src> on every reader route (reader/useCourseKit.ts) — same origin, same document, and the file C1 was hiding in',
  },
];

/** Every first-party file that runs in the reader's browser. */
function browserCodeFiles(): string[] {
  return BROWSER_CODE_ROOTS.flatMap((root) => root.files()).sort();
}

/**
 * The bodies of the inline `<script>` blocks in the app shell, as source
 * text the same AST scanner can read.
 *
 * `apps/web/index.html` carries the synchronous theme bootstrap. It is
 * first-party code, it runs in the reader's page before anything else does,
 * and it lives in a file with neither of the two extensions the old
 * jurisdiction accepted — which is exactly the kind of thing a
 * directory-and-extension rule cannot see and a LAYER rule must.
 */
function inlineShellScripts(): { readonly label: string; readonly source: string }[] {
  const html = readFileSync(INDEX_HTML, 'utf-8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  return blocks.map((m, i) => ({ label: `${relative(REPO_ROOT, INDEX_HTML)} <script> #${i + 1}`, source: m[1] }));
}

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
  {
    sink: 'innerHTML',
    file: join('apps', 'web', 'src', 'course', 'version.ts'),
    times: 1,
    // Added by S1 Task 10, and deliberately NOT a reopening of ruling S1-F8.
    // The ruling's condition is "no MANIFEST field ever reaches an HTML sink",
    // and this sink is fed the same category of string ChapterView's is: a
    // chapter fragment, read out of `PackageRow.files[...]`. The manifest
    // supplies the KEY into that record (`chapter.file`), never the value —
    // so every manifest string is still a React text node everywhere in this
    // app, and the validator's decision not to scan manifests for markup is
    // still free.
    //
    // Two further properties of THIS use, neither of which ChapterView's has:
    // it parses into an INERT document (`document.implementation.
    // createHTMLDocument`, see `parseChapterInert`), and it exists to measure
    // notes against a chapter the reader has not taken yet, which has to
    // project to the SAME string the reader's page projected (see
    // `course/version.ts`'s `CourseKitUnavailableError` for the measurement).
    //
    // RULING S1-F30 — this entry used to say the container was "detached …
    // so no handler on it can ever fire", and that was measured FALSE in
    // Chromium: an image/media load is started by the `src` attribute, not by
    // being in a rendered tree, and the package's own `onerror` runs on it. A
    // false security claim inside the very test that guards the area is worse
    // than no claim, because it tells the next reader not to look. What makes
    // this use safe is the inert DOCUMENT, and nothing else.
    //
    // The scanner above still sees this sink, which is the point: the fix
    // changed WHICH document is written to, not the fact that a string becomes
    // markup, so `times: 1` still counts it. (The rejected alternative,
    // `DOMParser`, WOULD hide the sink from this scanner — that, not inertness,
    // is the reason not to use it.)
    why: 'the chapter fragment again, parsed into an inert document (no browsing context) to resolve anchors against a version not yet taken',
  },
  {
    sink: 'innerHTML',
    file: join('packages', 'course-kit', 'runtime.js'),
    times: 2,
    // Brought INTO jurisdiction by the C1 fix. There were four `innerHTML`
    // assignments here and the scan could not see any of them. Two are gone
    // (`initViz`'s two notices now go through `vizNotice` → `textContent`,
    // which is what closed C1); these two remain, and each is allowed on a
    // REACHABILITY argument, which is the only kind of argument this file
    // accepts after ruling S1-F30 — a claim about what code CAN be reached,
    // not a claim about what a string happens to contain.
    //
    //   `el(tag, {html})`      — line ~19
    //   `Plot#showTip(px,py,html)` — line ~259
    //
    // The argument, and it is checkable rather than asserted: the ONLY place
    // in this file that reads package-authored DATA is `initViz`, and the only
    // datum it reads is `node.dataset.viz` (measured: `grep -n 'dataset\|
    // getAttribute' runtime.js` returns lines 337/338/341 and nothing else).
    // That path now ends in `textContent`. Everything that feeds these two
    // sinks — `readout`, `button`, tooltip bodies — is called BY a course's
    // `viz.js`, and `viz.js` is loaded only for `tier: "interactive"`
    // (`course/loader.ts`'s `resolveVizScriptUrl`). A `tier: "content"`
    // package cannot reach them, because reaching them requires executing
    // JavaScript, which is the exact thing that tier does not get. An
    // `interactive` package can reach them and gains nothing by it: it is
    // already running its own code in this page, by design (spec §1.2).
    //
    // WHAT WOULD MAKE THIS ENTRY WRONG, so the next reader knows where to
    // look instead of trusting this paragraph: a second reader of
    // package-authored data appearing in this file (another `dataset.*`,
    // a `getAttribute`, a `textContent` read off the chapter), or `el` /
    // `Plot` being called from `initViz`'s own branch. Either one breaks the
    // reachability claim and this entry has to be re-argued, not renumbered.
    why: 'two markup affordances for `viz.js` (el({html}), Plot#showTip) — reachable only by executing package code, i.e. only by `tier: "interactive"`, which already runs its own code by design',
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
 *
 * AND THE MANIFEST IS ONLY HALF OF IT. C1 was a CHAPTER field — an attribute
 * value the rule set passes through as data, correctly, because it only reads
 * start tags — reaching `innerHTML` in `runtime.js`. Everything above about
 * manifests is still true; it is just not the whole rule. The whole rule is
 * the class both belong to: NO DATA A COURSE PACKAGE CONTROLS BECOMES MARKUP
 * IN CODE WE SHIP. See `BROWSER_CODE_ROOTS` for the jurisdiction that follows
 * from it.
 */
describe('no package-controlled data becomes markup in code we ship to the reader', () => {
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

  /**
   * THE SELF-CHECK, and it is the point of this test rather than a preamble
   * to it.
   *
   * The shape that has now cost this project five separate blind gates is: a
   * gate measures what it can reach, and is SILENT where it cannot. A scan
   * whose roots quietly resolve to nothing reports zero violations and looks
   * identical to a codebase with zero violations. So every root must be
   * asserted non-empty INDIVIDUALLY — a total-count floor is not enough,
   * because `apps/web/src` alone clears any total floor while
   * `packages/course-kit` silently contributes nothing, which is precisely
   * the state this suite was in while C1 shipped.
   */
  it('scans every root of first-party reader-page code, and goes red if any root scans nothing', () => {
    for (const root of BROWSER_CODE_ROOTS) {
      const count = root.files().length;
      expect(count, `${root.name} scanned 0 files — this scan is now blind there (${root.why})`).toBeGreaterThan(0);
    }
    expect(inlineShellScripts().length, 'no inline <script> found in the app shell').toBeGreaterThan(0);

    const seen = browserCodeFiles().map(label);
    expect(seen.length).toBeGreaterThan(20);

    // Named on purpose, not left to a glob: this is the file the previous
    // jurisdiction missed, and a rename or a move must reopen the argument
    // rather than silently drop it out of scope.
    expect(seen).toContain(join('packages', 'course-kit', 'runtime.js'));

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

  it('has no HTML sink anywhere else — no package-controlled string can become markup', () => {
    const violations: string[] = [];
    const scanned: { where: string; source: string }[] = [
      ...browserCodeFiles().map((file) => ({ where: label(file), source: readFileSync(file, 'utf-8') })),
      ...inlineShellScripts().map((s) => ({ where: s.label, source: s.source })),
    ];

    for (const { where, source } of scanned) {
      const sinks = htmlSinksUsedIn(where, source);
      for (const sink of new Set(sinks)) {
        const allowed = HTML_SINKS_ALLOWED.find((a) => a.sink === sink && a.file === where);
        const times = sinks.filter((s) => s === sink).length;
        if (!allowed) {
          violations.push(
            `${where} turns a string into markup via ${sink} — this code runs in the reader's page, where a stranger's package supplies the manifest AND every chapter attribute, and neither is scanned for markup by the rule set (ruling S1-F8 reads start tags only); build a node and assign textContent instead`,
          );
        } else if (times !== allowed.times) {
          violations.push(`${where} uses ${sink} ${times}× (expected ${allowed.times}: ${allowed.why})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
