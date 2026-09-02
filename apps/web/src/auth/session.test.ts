/// <reference types="node" />
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same shape as `sync/engine.test.ts`'s `vi.mock('../api/navigation', ...)`
// and `api/events.test.ts`'s own `vi.mock('./client', ...)`: mocked at the
// network boundary so this file can assert exactly whether the event queue
// was still populated (i.e. `flushEvents()` would still have something to
// send) without a real network anywhere in it.
vi.mock('../api/client', () => ({
  api: { post: vi.fn() },
}));

import { api } from '../api/client';
import { flushEvents, queueEvent } from '../api/events';
import { meQueryKey } from '../api/useMe';
import { USER_CONTENT_KEYS } from '../db/localStorage';
import { clearSession } from './session';

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue(undefined);
});
afterEach(() => window.localStorage.clear());

describe('clearSession — the one door out of a session', () => {
  // Critical finding (Task 8 review): `api/events.ts`'s in-memory
  // study-event queue is a THIRD half of ending a session, alongside the
  // durable Dexie/localStorage half and the in-memory query-cache half
  // this file already tests above and below. Proven end-to-end (real
  // `useLogout`, real `<Login>`) in `test/eventQueueHandoff.test.tsx`;
  // this is the narrow claim `clearSession()` itself makes.
  it('empties the queued-but-unflushed study-event half too — a heartbeat that never got flushed does not survive', async () => {
    queueEvent({ courseId: 'c', chapterId: 'ch1', kind: 'heartbeat', meta: {}, at: '2026-08-21T00:00:00.000Z' });

    await clearSession(new QueryClient());

    await flushEvents();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('empties the durable half: every key holding the user’s own words', async () => {
    for (const key of USER_CONTENT_KEYS) window.localStorage.setItem(key, 'nửa câu đang viết');

    await clearSession(new QueryClient());

    for (const key of USER_CONTENT_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('empties the in-memory half too — the cache entries that really do hold the departing user’s data', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['stats'], { streak: 9, totalMinutes: 420 });
    queryClient.setQueryData(['course', 'so-dau-phay-dong'], { title: 'của người trước' });

    await clearSession(queryClient);

    expect(queryClient.getQueryData(['stats'])).toBeUndefined();
    expect(queryClient.getQueryData(['course', 'so-dau-phay-dong'])).toBeUndefined();
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

  /**
   * Task 10 note, replacing the old version of this test: before this task,
   * `clearLocalData()` was an awaited Dexie round trip, so `clearSession`
   * genuinely had a "still running" window a probe taken right after calling
   * it (before awaiting) could observe — that is what the old version of
   * this test sampled. As of Task 10 there is no Dexie left, and every step
   * `clearSession` itself performs (`clearUserContent()`, the offline
   * marker's clear, `resetSessionScopedQueries`, `resetEventQueue`) is
   * synchronous, so calling it — even WITHOUT awaiting — already runs the
   * entire body to completion before the next line executes. That is a
   * STRONGER guarantee than the old one, not a weaker one: there is no
   * window left in which the durable half is cleared but the cache is not
   * (or vice versa), because there is no window at all. This test asserts
   * exactly that: the durable half and the cache are both already gone
   * immediately after the (unawaited) call returns.
   */
  it('clears the durable half and the cache synchronously — no window where one is done and the other is not', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['stats'], { streak: 1 });
    window.localStorage.setItem(USER_CONTENT_KEYS[0], 'nửa câu đang viết');

    // Deliberately not awaited — see this test's own doc comment above.
    void clearSession(queryClient);

    expect(window.localStorage.getItem(USER_CONTENT_KEYS[0])).toBeNull();
    expect(queryClient.getQueryData(['stats'])).toBeUndefined();
  });
});

/**
 * Task 11 review finding (Pha 3): TanStack Query's default
 * `networkMode: 'online'` (this repo configures nothing else — see
 * `App.tsx`'s bare `new QueryClient()`) PAUSES a mutation that is sent while
 * offline, rather than failing it, and AUTO-RESUMES every paused mutation
 * the instant `onlineManager` reports connectivity again
 * (`@tanstack/query-core`'s `QueryClient.mount()` subscribes to
 * `onlineManager` and calls `resumePausedMutations()` on it — see that
 * package's own `queryClient.ts`). A resumed mutation replays through
 * `api/client.ts`'s `send()`, which always sends `credentials: 'include'` —
 * i.e. whatever cookie is valid AT RESUME TIME, not the account that
 * started the write.
 *
 * Concretely, in the same tab, on the ONE `queryClient` `App.tsx` ever
 * builds: learner A goes offline mid-write, the mutation pauses, A logs
 * out, learner B signs in, connectivity returns — and without this,
 * A's paused write would replay and reach the server under B's cookie.
 * This phase has already paid two fix rounds for exactly this shape of bug
 * (a queue of A's study events POSTed under B's session — see
 * `api/events.ts`'s `queueGeneration` and `test/eventQueueHandoff.test.tsx`)
 * — the mutation cache was the one queue nothing had wired into the door
 * yet.
 *
 * The fix is `getMutationCache().clear()`, called from `clearSession()`
 * itself (see that function, above) — not a new clearing path: emptying the
 * cache's tracked mutation set is what makes `resumePausedMutations()`
 * find nothing to resume, because it iterates `getAll()` on that same set.
 * The paused request's own promise is simply never continued; nothing
 * cancels an in-flight `fetch`, because there isn't one — a PAUSED mutation
 * with `networkMode: 'online'` never called `fetch` in the first place (see
 * `@tanstack/query-core`'s `retryer.ts`: `canStart()` is false while
 * offline, so `start()` calls `pause()` before `run()` ever executes).
 */
describe('clearSession — the mutation half (TanStack’s auto-resume hazard)', () => {
  afterEach(() => {
    // Every other describe block in this file runs "online" implicitly
    // (jsdom's default); restore that so a failure here cannot leak into
    // an unrelated test run after it in the same file.
    onlineManager.setOnline(true);
  });

  it('a paused mutation belonging to A must not replay under B’s session once connectivity returns', async () => {
    const queryClient = new QueryClient();

    // A is mid-write when the network drops. `networkMode: 'online'`
    // (the default, unconfigured here) means the mutation PAUSES rather
    // than sends — `fetch` is never called while offline.
    onlineManager.setOnline(false);
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => api.post('/progress/toggle', { chapterId: 'ch1' }),
    });
    void mutation.execute({ chapterId: 'ch1' }).catch(() => {});
    await vi.waitFor(() => expect(mutation.state.isPaused).toBe(true));
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();

    // A logs out — same tab, same queryClient — exactly clearSession()'s job.
    await clearSession(queryClient);

    // B signs in (irrelevant to this test which account, if any, is
    // current — the hazard is that the SAME queryClient carries A's
    // mutation forward regardless), then connectivity returns.
    onlineManager.setOnline(true);
    await queryClient.resumePausedMutations();

    // If A's paused mutation was still tracked, TanStack would have
    // auto-resumed it here and sent it with `credentials: 'include'` —
    // under WHATEVER cookie is valid now, B's.
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    expect(queryClient.getMutationCache().getAll()).toEqual([]);
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
 * The three halves of ending a session, and the ONLY files allowed to name
 * each one: the module that defines it, and `auth/session.ts`, which is the
 * door.
 *
 * This is the enforcement half of ruling P2-F18. The merge itself restored
 * "one truth point"; without this, the next task that needs to clear
 * something on an auth transition can import either half directly, call one
 * and not the other, and be correct on the day it is written — which is
 * exactly the state this ruling was made about. Every "correct today, with
 * nothing pinning it" item in this phase has eventually broken.
 *
 * `resetEventQueue` (Task 8's fix round) is the newest entry, and the exact
 * shape of what this array exists to prevent: Task 8's original diff built
 * `api/events.ts`'s in-memory queue with no third half wired into this
 * door at all, not merely wired into the wrong place — the review that
 * caught it is `test/eventQueueHandoff.test.tsx`'s own header. Watching
 * the name here is what stops a FUTURE call site from "fixing" a similar
 * leak by importing `resetEventQueue` directly instead of routing through
 * `clearSession()`.
 */
const SESSION_CLEARERS: readonly { readonly name: string; readonly allowedIn: readonly string[]; readonly why: string }[] = [
  {
    // Renamed by Task 10 from `clearLocalData` (`db/local.ts`, Dexie +
    // localStorage) to `clearUserContent` (`db/localStorage.ts`,
    // localStorage only — Dexie is gone). This is a RENAME of the watched
    // identifier, not a weakening: the invariant this entry enforces (only
    // `session.ts` may call the durable-clearing function directly) is
    // unchanged, and leaving the OLD name here after nothing in the
    // codebase calls it anymore would make this entry permanently vacuous
    // — every scan would report zero violations for a name nobody uses,
    // which looks identical to protection while providing none.
    name: 'clearUserContent',
    allowedIn: [join('apps', 'web', 'src', 'db', 'localStorage.ts'), join('apps', 'web', 'src', 'auth', 'session.ts')],
    why: 'the durable half of ending a session — call clearSession() from src/auth/session.ts, which also clears the query cache',
  },
  {
    name: 'resetSessionScopedQueries',
    allowedIn: [join('apps', 'web', 'src', 'api', 'useMe.ts'), join('apps', 'web', 'src', 'auth', 'session.ts')],
    why: 'the in-memory half of ending a session — call clearSession() from src/auth/session.ts, which also clears the durable stores',
  },
  {
    name: 'resetEventQueue',
    allowedIn: [join('apps', 'web', 'src', 'api', 'events.ts'), join('apps', 'web', 'src', 'auth', 'session.ts')],
    why: 'the queued-but-unflushed study-event half of ending a session — call clearSession() from src/auth/session.ts, which also clears the other two halves',
  },
  {
    // Added by the final whole-branch review, and the one entry here whose
    // store predates the list itself: the Dexie-era `'tuhoc'` database was
    // cleared on every auth transition until Task 10 deleted Dexie and the
    // `db.tables.map(t => t.clear())` line with it. `clearLegacyLocalData`
    // puts it back behind the same door as the other three, so the next
    // reader of that database (there is one — `db/legacyDrain.ts`) cannot
    // be handed a departed account's rows.
    name: 'clearLegacyLocalData',
    allowedIn: [join('apps', 'web', 'src', 'db', 'legacyDrain.ts'), join('apps', 'web', 'src', 'auth', 'session.ts')],
    why: 'the legacy Dexie-database half of ending a session — call clearSession() from src/auth/session.ts, which also clears the other three halves',
  },
];

/**
 * Files this scan does NOT read, and why each is safe to skip.
 *
 * `*.test.ts(x)` — a test's job includes exercising the individual halves
 * directly: `api/events.test.ts` calls `resetEventQueue` on its own to test
 * IT, and should not have to route through `clearSession()` just to do so.
 *
 * `packages/course-kit/runtime.js` is deliberately NOT skipped, for the same
 * reason `db/localStorage.test.ts` scans it: it runs on every reader route
 * in this origin, is loaded as a classic `<script src>` so nothing under
 * `src/` mentions it, and would be exactly as invisible here as it was
 * there.
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
function clearersNamedIn(
  fileName: string,
  source: string,
  watched: ReadonlySet<string> = new Set(SESSION_CLEARERS.map((c) => c.name)),
): Set<string> {
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
      '// clearUserContent() and resetSessionScopedQueries() — a mention, not a use',
      '/** both halves: clearUserContent, resetSessionScopedQueries */',
      'const notARealUse = "clearUserContent";',
      'export const fine = 1;',
    ].join('\n');
    expect([...clearersNamedIn('decoy.ts', decoyed)]).toEqual([]);

    const real = 'import { clearUserContent } from "x"; export const go = () => clearUserContent();';
    expect([...clearersNamedIn('real.ts', real)]).toEqual(['clearUserContent']);
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

  // Task 11 removed the offline-read marker (`rememberSessionVerified`,
  // `SESSION_VERIFIED_KEY`, and the "only RequireAuth writes it" scan that
  // used to live here) along with `<RequireAuth>`'s offline branch — the
  // marker had exactly one reader, that branch, and no reader means nothing
  // left to protect the marker's meaning for.

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
