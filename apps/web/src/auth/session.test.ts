/// <reference types="node" />
import { QueryClient } from '@tanstack/react-query';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { meQueryKey } from '../api/useMe';
import { clearLocalData, db, setProgress, USER_CONTENT_KEYS } from '../db/local';
import { clearSession } from './session';

beforeEach(clearLocalData);
afterEach(clearLocalData);

describe('clearSession — the one door out of a session', () => {
  it('empties the durable half: every local table, and the keys holding the user’s own words', async () => {
    await setProgress('c', 'ch', 'read', true);
    await db.annotations.put({
      id: 'a1',
      courseId: 'c',
      chapterId: 'ch',
      anchor: { exact: 'x', prefix: '', suffix: '', color: 'y' },
      note: 'riêng tư',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      deletedAt: null,
    });
    await db.meta.put({ key: 'syncCursor', value: 'c1' });
    for (const key of USER_CONTENT_KEYS) window.localStorage.setItem(key, 'nửa câu đang viết');

    await clearSession(new QueryClient());

    for (const table of db.tables) expect(await table.count(), `${table.name} still has rows`).toBe(0);
    for (const key of USER_CONTENT_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('empties the in-memory half too — the cache entries that really do hold the departing user’s data', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['stats'], { streak: 9, totalMinutes: 420 });
    queryClient.setQueryData(['course', '***REMOVED***'], { title: 'của người trước' });

    await clearSession(queryClient);

    expect(queryClient.getQueryData(['stats'])).toBeUndefined();
    expect(queryClient.getQueryData(['course', '***REMOVED***'])).toBeUndefined();
  });

  it('spares `me`, because both call sites overwrite it on the very next line', async () => {
    // Not a detail: `App.tsx`'s always-mounted `useMe()` observer is what
    // starts the sync engine, and a full `queryClient.clear()` orphans it
    // until something unrelated happens to re-render `AppShell`. See
    // `resetSessionScopedQueries`' own doc comment — this test is here so
    // that reasoning cannot be lost behind the new front door.
    const queryClient = new QueryClient();
    queryClient.setQueryData(meQueryKey, { id: 'u1', name: 'A', email: 'a@b.c' });
    queryClient.setQueryData(['stats'], { streak: 9 });

    await clearSession(queryClient);

    expect(queryClient.getQueryData(meQueryKey)).toEqual({ id: 'u1', name: 'A', email: 'a@b.c' });
    expect(queryClient.getQueryData(['stats'])).toBeUndefined();
  });

  it('clears the durable half BEFORE the cache, and does not resolve until the durable half is done', async () => {
    // The ordering both call sites relied on, now asserted once here instead
    // of being a comment at each of them. `useLogout` seeds `me` on the line
    // after this call and `Login` seeds the arriving user there; if
    // `clearSession` resolved while `clearLocalData()` was still running, the
    // new session could read or push the previous user's rows.
    const queryClient = new QueryClient();
    const order: string[] = [];
    queryClient.setQueryData(['stats'], { streak: 1 });
    await setProgress('c', 'ch', 'read', true);

    const pending = clearSession(queryClient).then(() => order.push('resolved'));
    // Sampled before awaiting: the cache reset is synchronous and happens
    // after an awaited clear, so it cannot have run yet.
    order.push(queryClient.getQueryData(['stats']) === undefined ? 'cache-cleared-early' : 'cache-still-warm');
    await pending;

    expect(order).toEqual(['cache-still-warm', 'resolved']);
    expect(await db.progress.count()).toBe(0);
    expect(queryClient.getQueryData(['stats'])).toBeUndefined();
  });
});

/* ====================================================================== *
 * The tripwire: there may not be a third place that ends a session
 * ====================================================================== */

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(SRC_DIR, '../../..');

/** Repo-relative, so a violation names the file the way a person would open it. */
function label(file: string): string {
  return relative(REPO_ROOT, file);
}

/**
 * The two halves of ending a session, and the ONLY files allowed to name
 * each one: the module that defines it, and `auth/session.ts`, which is the
 * door.
 *
 * This is the enforcement half of ruling P2-F18. The merge itself restored
 * "one truth point"; without this, the next task that needs to clear
 * something on an auth transition can import either half directly, call one
 * and not the other, and be correct on the day it is written — which is
 * exactly the state this ruling was made about. Every "correct today, with
 * nothing pinning it" item in this phase has eventually broken.
 */
const SESSION_CLEARERS: readonly { readonly name: string; readonly allowedIn: readonly string[]; readonly why: string }[] = [
  {
    name: 'clearLocalData',
    allowedIn: [join('apps', 'web', 'src', 'db', 'local.ts'), join('apps', 'web', 'src', 'auth', 'session.ts')],
    why: 'the durable half of ending a session — call clearSession() from src/auth/session.ts, which also clears the query cache',
  },
  {
    name: 'resetSessionScopedQueries',
    allowedIn: [join('apps', 'web', 'src', 'api', 'useMe.ts'), join('apps', 'web', 'src', 'auth', 'session.ts')],
    why: 'the in-memory half of ending a session — call clearSession() from src/auth/session.ts, which also clears the durable stores',
  },
];

/**
 * Files this scan does NOT read, and why each is safe to skip.
 *
 * `*.test.ts(x)` — a test's job includes driving each half on its own:
 * `db/local.test.ts` and `useLogout.test.tsx` both call `clearLocalData()`
 * directly as a fixture, and this very file calls both.
 *
 * `packages/course-kit/runtime.js` is deliberately NOT skipped, for the same
 * reason `db/local.test.ts` scans it: it runs on every reader route in this
 * origin, is loaded as a classic `<script src>` so nothing under `src/`
 * mentions it, and would be exactly as invisible here as it was there.
 */
function isProductionSource(relativePath: string): boolean {
  if (/\.test\.tsx?$/.test(relativePath)) return false;
  return relativePath !== join('test', 'setup.ts');
}

const COURSE_KIT_RUNTIME = resolve(SRC_DIR, '../../../packages/course-kit/runtime.js');

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

/**
 * Names actually referenced by CODE in `source`.
 *
 * An AST walk rather than a grep, for the reason `db/local.test.ts`'s own
 * scan gives and which is even sharper here: both of these names appear in
 * PROSE all over this codebase — `useLogout.ts` and `Login.tsx` each explain
 * at length what the two halves do, and `session.ts` names them in its own
 * doc comment. A grep would fire on every one of those and be switched off
 * within a week.
 *
 * A deliberately separate scan from the one in `db/local.test.ts` rather
 * than a shared helper: that one asks "which persistence APIs does this file
 * touch", this one asks "which session-clearing functions does it name", and
 * the two watch lists are unrelated. What they share is a dozen lines of AST
 * walking; extracting that would mean editing the file that holds the
 * cross-account-leak tripwire in order to add a second one, and the risk of
 * that trade runs the wrong way. Each scan therefore proves its own
 * instrument works, immediately below.
 */
function clearersNamedIn(fileName: string, source: string): Set<string> {
  const watched = new Set(SESSION_CLEARERS.map((c) => c.name));
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
    ts.forEachChild(node, walk);
  };
  walk(parsed);
  return found;
}

describe('no third way to end a session', () => {
  it('reads its own instrument correctly: code counts, comments and strings do not', () => {
    const decoyed = [
      '// clearLocalData() and resetSessionScopedQueries() — a mention, not a use',
      '/** both halves: clearLocalData, resetSessionScopedQueries */',
      'const notARealUse = "clearLocalData";',
      'export const fine = 1;',
    ].join('\n');
    expect([...clearersNamedIn('decoy.ts', decoyed)]).toEqual([]);

    const real = 'import { clearLocalData } from "x"; export const go = () => clearLocalData();';
    expect([...clearersNamedIn('real.ts', real)]).toEqual(['clearLocalData']);
  });

  it('is looking at the whole app, not at nothing', () => {
    // A broken walk is the classic way a scan like this goes quietly blind:
    // it keeps passing, because it stops reading anything.
    const seen = productionSourceFiles().map(label);
    expect(seen.length).toBeGreaterThan(20);
    expect(seen).toContain(join('apps', 'web', 'src', 'auth', 'session.ts'));
    expect(seen).toContain(join('apps', 'web', 'src', 'auth', 'useLogout.ts'));
    expect(seen).toContain(join('apps', 'web', 'src', 'pages', 'Login.tsx'));
    expect(seen).toContain(join('packages', 'course-kit', 'runtime.js'));
    expect(seen).not.toContain(join('apps', 'web', 'src', 'auth', 'session.test.ts'));
  });

  it('keeps both halves of clearing a session behind the one door in auth/session.ts', () => {
    const violations: string[] = [];
    for (const file of productionSourceFiles()) {
      const where = label(file);
      const named = clearersNamedIn(file, readFileSync(file, 'utf-8'));
      for (const clearer of SESSION_CLEARERS) {
        if (named.has(clearer.name) && !clearer.allowedIn.includes(where)) {
          violations.push(`${where} calls ${clearer.name} directly — ${clearer.why}`);
        }
      }
    }
    // If this fails: calling one half is not wrong because it is untidy, it
    // is wrong because the OTHER half will be forgotten. Route the new call
    // site through `clearSession()`; if it genuinely needs only one half,
    // that is a decision to make out loud, here, by adding the file to
    // `allowedIn` above with a reason.
    expect(violations).toEqual([]);
  });

  it('the door is actually used: both auth transitions go through it', () => {
    // The complement of the scan above. Without this, deleting BOTH call
    // sites' clearing entirely would leave the tripwire green — a rule that
    // only forbids and never requires can be satisfied by doing nothing.
    for (const site of [join('auth', 'useLogout.ts'), join('pages', 'Login.tsx')]) {
      const source = readFileSync(resolve(SRC_DIR, site), 'utf-8');
      expect([...clearersNamedIn(site, source)], `${site} no longer clears anything`).toEqual([]);
      expect(source, `${site} does not call clearSession()`).toContain('clearSession(queryClient)');
    }
  });
});
