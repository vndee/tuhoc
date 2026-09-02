/// <reference types="node" />
import { QueryClient } from '@tanstack/react-query';
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
import {
  clearSession,
  OFFLINE_READ_MAX_AGE_MS,
  offlineSessionIsUsable,
  readSessionVerifiedAt,
  rememberSessionVerified,
  SESSION_VERIFIED_KEY,
} from './session';

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

  it('empties the durable half: every key holding the user’s own words, and the offline marker', async () => {
    for (const key of USER_CONTENT_KEYS) window.localStorage.setItem(key, 'nửa câu đang viết');
    await rememberSessionVerified();
    expect(await offlineSessionIsUsable()).toBe(true);

    await clearSession(new QueryClient());

    for (const key of USER_CONTENT_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem(SESSION_VERIFIED_KEY)).toBeNull();
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

/* ====================================================================== *
 * offlineSessionIsUsable — how long a device may stand in for the server
 * ====================================================================== */

describe('offlineSessionIsUsable — the offline reading window', () => {
  const T = Date.parse('2026-08-21T10:00:00.000Z');

  it('is false on a device nobody has ever signed in on', async () => {
    expect(await offlineSessionIsUsable(T)).toBe(false);
  });

  it('is true immediately after GET /me confirmed a user here', async () => {
    await rememberSessionVerified(new Date(T));

    expect(await offlineSessionIsUsable(T)).toBe(true);
  });

  it('is still true one millisecond before the window closes, and false one millisecond after', async () => {
    await rememberSessionVerified(new Date(T));

    expect(await offlineSessionIsUsable(T + OFFLINE_READ_MAX_AGE_MS - 1)).toBe(true);
    expect(await offlineSessionIsUsable(T + OFFLINE_READ_MAX_AGE_MS)).toBe(false);
    expect(await offlineSessionIsUsable(T + OFFLINE_READ_MAX_AGE_MS + 1)).toBe(false);
  });

  it('stays well inside the server session it stands in for', () => {
    // apps/api/internal/auth/usecase.go's `SessionTTL = 30 * 24 * time.Hour`,
    // and it is NOT sliding — `FindValidSession` never moves `expires_at`.
    // So the longest a server session can live is 30 days from the login
    // that created it. This window has to be a fraction of that, or a
    // device could keep reading long after the cookie it is standing in
    // for became worthless.
    const SERVER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    expect(OFFLINE_READ_MAX_AGE_MS).toBeLessThan(SERVER_SESSION_TTL_MS / 4);
    expect(OFFLINE_READ_MAX_AGE_MS).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it('refuses a marker stamped in the future — a clock that moved fails closed', async () => {
    await rememberSessionVerified(new Date(T + 60_000));

    expect(await offlineSessionIsUsable(T)).toBe(false);
  });

  it('is false again the moment the session ends, because clearSession() took the marker with it', async () => {
    await rememberSessionVerified(new Date(T));
    expect(await offlineSessionIsUsable(T)).toBe(true);

    await clearSession(new QueryClient());

    expect(await offlineSessionIsUsable(T)).toBe(false);
  });
});

/* ====================================================================== *
 * The offline-read marker — storage-level checks (Task 10: moved here from
 * db/local.test.ts's "the 'somebody was signed in here' marker" describe
 * block, adapted from Dexie's db.meta to a localStorage key)
 * ====================================================================== */

describe('the offline-read marker, at the storage level', () => {
  it('round-trips as a parsed instant', async () => {
    await rememberSessionVerified(new Date('2026-08-21T10:00:00.000Z'));

    expect(await readSessionVerifiedAt()).toBe(Date.parse('2026-08-21T10:00:00.000Z'));
  });

  it('is absent until something writes it, and unreadable garbage reads as absent', async () => {
    expect(await readSessionVerifiedAt()).toBeNull();

    window.localStorage.setItem(SESSION_VERIFIED_KEY, 'không phải mốc thời gian');
    // `Date.parse` of junk is NaN, and NaN would sail through every
    // `now - verifiedAt < window` comparison as `false` — which happens to
    // be the safe answer, but only by accident. Answering `null` makes the
    // safe answer deliberate.
    expect(await readSessionVerifiedAt()).toBeNull();
  });

  it('holds NO identity — only an instant, and that is what makes it cheap to be wrong about', async () => {
    // The whole reason `<RequireAuth>` can consult this marker without
    // repeating P2's cross-account leak: even in the worst case (a stale
    // value nothing erased), it says "somebody was signed in on this device
    // at T" and cannot say WHO. There is no name, no email, no user id to
    // render at the next person. If a future edit adds one, this fails.
    await rememberSessionVerified(new Date('2026-08-21T10:00:00.000Z'));

    expect(window.localStorage.getItem(SESSION_VERIFIED_KEY)).toBe('2026-08-21T10:00:00.000Z');
  });

  it('still writes normally when no clear happens around it', async () => {
    await clearSession(new QueryClient());
    await rememberSessionVerified(new Date('2026-08-21T10:00:00.000Z'));

    expect(await readSessionVerifiedAt()).toBe(Date.parse('2026-08-21T10:00:00.000Z'));
  });

  // Removed by Task 10, on purpose, WITH a reason (not "dọn dẹp"):
  // `db/local.test.ts` used to carry
  // "cannot be resurrected by a write that lands AFTER the browser was
  // declared clean" — a test that gated `db.meta.put`'s Dexie transaction
  // behind a manually-controlled promise to prove the (now-removed)
  // generation-counter guard closed the window where a WRITE already in
  // flight when a CLEAR ran could still land afterward. That window existed
  // because a Dexie `put()` is asynchronous — it schedules a transaction
  // that may not commit for one or more further ticks, during which a
  // concurrent `clear()` could run to completion.
  //
  // `rememberSessionVerified`/`clearSessionVerifiedMarker` (session.ts) are
  // both a single synchronous `localStorage.setItem`/`removeItem` call with
  // no `await` anywhere inside them. There is no tick during which either
  // one is "in flight" for the other to race — by the time either function
  // returns, its write has already fully happened. The interleaving this
  // removed test constructed (gate the write, let a clear finish, then
  // release the write) cannot be built against a synchronous store: there
  // is no gate to hold, because there is no async step to intercept. This
  // is verified structurally (reading `rememberSessionVerified`'s body in
  // session.ts — no `await`), not merely assumed.
  //
  // What this does NOT close, and never did: the ordering between two
  // independent event-loop callbacks (`GET /me`'s effect firing vs. a
  // logout click's `clearSession()`) is still whatever order the browser
  // happens to run them in — but that was ALSO true of the old Dexie
  // version, whose generation guard only protected the narrower window
  // during ITS OWN in-flight write, not this broader scheduling question.
  // Nothing was given up here that the old test actually covered.
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

  /**
   * The marker `offlineSessionIsUsable` reads is the ONE durable thing this
   * phase added that says "somebody was signed in on this device". It is a
   * `localStorage` key that `clearSession()` (this file) empties with
   * nothing written for it at either call site — but that only stays true
   * while the set of places that WRITE it stays small enough to reason
   * about.
   *
   * Two files may name it: `auth/session.ts` DEFINES it (Task 10 moved the
   * definition here from `db/local.ts`'s Dexie `db.meta` table, which no
   * longer exists — see session.ts's own doc comment on
   * `rememberSessionVerified`), and `auth/RequireAuth.tsx` is the one
   * surface that both writes and reads it — it writes exactly when
   * `GET /me` has confirmed a user, which is the only fact the marker is
   * allowed to record. A third writer is how this would go wrong: a call
   * from somewhere that has NOT confirmed a user would make the marker mean
   * something weaker than it says, and every offline render downstream
   * would inherit that.
   *
   * Moving the DEFINITION is not a weakening of this check: the invariant
   * is still "exactly these two files may name `rememberSessionVerified`",
   * enforced the same way — only WHICH file holds the definition changed,
   * and `session.ts` replacing `db/local.ts` in this list is that move
   * reflected honestly, not the check being loosened to pass.
   */
  const MARKER_WRITER = 'rememberSessionVerified';
  const MARKER_WRITER_ALLOWED_IN = [
    join('apps', 'web', 'src', 'auth', 'session.ts'),
    join('apps', 'web', 'src', 'auth', 'RequireAuth.tsx'),
  ];

  it('only RequireAuth writes the offline-read marker, and it is the same file that reads it', () => {
    const watched = new Set([MARKER_WRITER]);
    const writers = productionSourceFiles()
      .filter((file) => clearersNamedIn(file, readFileSync(file, 'utf-8'), watched).has(MARKER_WRITER))
      .map(label);

    expect(writers.sort()).toEqual([...MARKER_WRITER_ALLOWED_IN].sort());
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
