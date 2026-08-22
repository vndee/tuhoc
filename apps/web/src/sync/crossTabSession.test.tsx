/**
 * Two TABS, one browser, two accounts — debt C-1 (`docs/carried-forward.md`
 * §1, and HC-1 of the subsystem-4 plan).
 *
 * **What this file measures, stated as the harm.** Not "does BroadcastChannel
 * work". The question is whether A's reading data can reach the server under
 * B's cookie. The session cookie is one value per origin; every signal this
 * app had for "who is signed in" was per-tab (`useMe`'s 60-second cache,
 * `<Login>`'s `<Navigate>` guard, the sync engine's `timer`/`inFlight`/
 * `syncEpoch`). So tab 2, left open on A's reader, kept running its cycle
 * after somebody signed in as B in tab 1 — and `POST /sync` carried A's queued
 * progress into B's account while `GET /sync` pulled B's rows into a database
 * tab 2 renders as A's.
 *
 * **Both directions, and why the positive one is not optional.** Every test
 * here asserts that tab 2 DID send before the cross-tab signal, by exact
 * equality on the rows that reached the server, before asserting that it sent
 * nothing after. Without that half, an engine that never syncs at all — or a
 * fixture that quietly emptied the outbox — passes this file completely. This
 * project has measured several green-for-the-wrong-reason gates (see
 * `docs/carried-forward.md`); the same file also re-seeds the outbox AFTER the
 * signal, because tab 1's own `clearLocalData()` empties the shared IndexedDB
 * and "nothing was sent" would otherwise be true because there was nothing
 * left to send.
 *
 * **How two tabs are modelled, and why this is not a stub.** `vi.resetModules()`
 * plus dynamic `import()` gives a genuinely fresh evaluation of this app's
 * modules, while everything the platform shares between tabs of one
 * origin — `BroadcastChannel`, and the IndexedDB behind Dexie — stays shared.
 * That is exactly the split a real pair of tabs has: separate module state,
 * one cookie jar, one database, one bus. It matters here more than usual,
 * because the whole defect is that the sync engine's state is per-tab: a test
 * that let both "tabs" share one engine module would have tab 1's own
 * `stopSync()` stop tab 2's loop, and would pass against an app with no
 * cross-tab coordination whatsoever.
 *
 * Measured in this environment (probe, 2026-08-22): jsdom implements
 * `BroadcastChannel`, delivers to other channel objects, and — like a real
 * browser — never delivers a message back to the object that posted it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Same reason as engine.test.ts and useMe.test.tsx: the api client's 401 path
// is a hard `window.location` navigation jsdom cannot perform, so it is mocked
// at the module boundary. Nothing in this file expects a 401, but a regression
// that produced one should fail on an assertion rather than on jsdom.
vi.mock('../api/navigation', () => ({
  redirectToLogin: vi.fn(),
}));

const A = { id: 'u-a', email: 'a@example.com', name: 'A' };
const B = { id: 'u-b', email: 'b@example.com', name: 'B' };

/**
 * The two rows, named for the moment they were created rather than for their
 * content: one queued while tab 2 was legitimately A's, one queued after
 * somebody else took the cookie. The second is the one whose arrival at the
 * server IS the bug.
 */
const QUEUED_BEFORE_THE_HANDOVER = {
  courseId: 'c-a',
  chapterId: 'truoc-khi-doi-tai-khoan',
  status: 'read',
  done: true,
  updatedAt: '2026-08-22T10:00:00.000Z',
};

const QUEUED_AFTER_THE_HANDOVER = {
  courseId: 'c-a',
  chapterId: 'sau-khi-doi-tai-khoan',
  status: 'read',
  done: true,
  updatedAt: '2026-08-22T10:00:30.000Z',
};

/* ------------------------------------------------------------------ *
 * The wire: every request this file's server ever sees
 * ------------------------------------------------------------------ */

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

let seen: Seen[] = [];

/** Requests to the endpoints a sync cycle uses, and nothing else (`/me`, `/auth/*` are not sync). */
function syncTraffic(): Seen[] {
  return seen.filter((r) => r.path === '/sync' || r.path === '/events/batch');
}

/** Every progress row that actually reached `POST /sync`, in order, flattened across batches. */
function progressRowsThatReachedTheServer(): unknown[] {
  return seen
    .filter((r) => r.method === 'POST' && r.path === '/sync')
    .flatMap((r) => (r.body as { progress?: unknown[] }).progress ?? []);
}

const server = setupServer(
  http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })),
  http.post('/sync', async ({ request }) => {
    seen.push({ method: 'POST', path: '/sync', body: await request.json() });
    return HttpResponse.json({ applied: 0 });
  }),
  http.get('/sync', () => {
    seen.push({ method: 'GET', path: '/sync', body: null });
    return HttpResponse.json({ progress: [], annotations: [], cursor: 'c0' });
  }),
  http.post('/events/batch', async ({ request }) => {
    seen.push({ method: 'POST', path: '/events/batch', body: await request.json() });
    return HttpResponse.json({ accepted: 0 });
  }),
  http.post('/auth/login', () => HttpResponse.json(B)),
  http.post('/auth/logout', () => new HttpResponse(null, { status: 200 })),
  // What the dashboard asks for once the positive control below lands on it.
  // An empty library is fine — this file has no opinion about the dashboard,
  // it just must not leave a request unanswered (`onUnhandledRequest: 'error'`
  // is on precisely so an unnoticed request cannot become an unnoticed
  // assumption).
  http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })),
  http.get('/courses', () => HttpResponse.json([])),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

interface Tab {
  readonly engine: typeof import('./engine');
  readonly identity: typeof import('../auth/sessionIdentity');
  readonly local: typeof import('../db/local');
  readonly useMe: typeof import('../api/useMe').useMe;
}

/** Every tab this test opened, so `afterEach` can tear each one down in its own module graph. */
let openTabs: Tab[] = [];

/**
 * A new tab: a fresh evaluation of this app's modules, on top of the
 * platform state (bus, IndexedDB) every tab of an origin shares.
 */
async function openTab(): Promise<Tab> {
  vi.resetModules();
  const tab: Tab = {
    engine: await import('./engine'),
    identity: await import('../auth/sessionIdentity'),
    local: await import('../db/local'),
    useMe: (await import('../api/useMe')).useMe,
  };
  openTabs.push(tab);
  return tab;
}

function withQueryClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/**
 * Brings `tab` to the state a real second tab is in: signed in as A, because
 * a real `GET /me` said so.
 *
 * Deliberately NOT `announceSessionUser(A.id)` by hand. The production path
 * from "the server answered" to "every other tab knows" is part of what this
 * file is checking; calling the announcement directly would test the guard
 * against a fixture rather than against the app, and would stay green if
 * `useMe` stopped announcing entirely.
 */
async function signedInAs(tab: Tab, user: typeof A): Promise<void> {
  server.use(http.get('/me', () => HttpResponse.json(user)));
  const { result } = renderHook(() => tab.useMe(), { wrapper: withQueryClient() });
  await waitFor(() => expect(result.current.data).toEqual(user));
}

/**
 * The cookie A's session was riding on is gone — expired, or signed out
 * somewhere this tab never saw. `GET /me` now answers 401, which is what puts
 * a sign-in form on the screen in the first place.
 *
 * Tab 2 does not notice: `useMe`'s `staleTime` is 60 s and nothing has asked
 * it to refetch, so its cached `me` is still A and its sync loop is still
 * running. That gap is not incidental to the bug — it IS the bug.
 */
function theCookieDies(): void {
  server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
}

/**
 * A SECOND tab — its own module graph, its own engine, its own bus endpoint —
 * shows the real `<Login>` and B signs in on it.
 *
 * `react-router-dom` is imported here, after `openTab()`'s module reset,
 * rather than at the top of this file: `<Login>` calls `useNavigate` from ITS
 * graph's copy, and a router provider from a different graph would be a
 * different context object, so the component would render against a provider
 * it cannot see.
 */
async function bSignsInAnotherTab(): Promise<void> {
  theCookieDies();
  await openTab();
  const { Login } = await import('../pages/Login');
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div data-testid="tab1-landed" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await bSignsInThroughTheRealForm();
}

/** B fills in the real sign-in form and submits it. */
async function bSignsInThroughTheRealForm(): Promise<void> {
  const user = userEvent.setup();
  await screen.findByLabelText(/email/i);
  await user.type(screen.getByLabelText(/email/i), B.email);
  await user.type(screen.getByLabelText(/mật khẩu/i), 'secret123');
  await user.click(screen.getByRole('button', { name: /đăng nhập/i }));
  // The form is gone: `handleAuthenticated` ran to completion — `stopSync()`,
  // `clearSession()`, the `me` seed, the navigate — so everything this tab
  // does on the way in has already happened when the assertions below run.
  await waitFor(() => expect(screen.queryByLabelText(/mật khẩu/i)).not.toBeInTheDocument());
}

beforeEach(() => {
  seen = [];
  openTabs = [];
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

afterEach(async () => {
  cleanup();
  for (const tab of openTabs) {
    tab.engine.stopSync();
    tab.identity.__resetSessionIdentityForTests();
  }
  if (openTabs.length > 0) await openTabs[0].local.clearLocalData();
  openTabs = [];
  server.resetHandlers();
});

/* ====================================================================== *
 * The leak
 * ====================================================================== */

describe('C-1 — a second tab must not push its account’s data under another account’s cookie', () => {
  it('A’s data does not reach the server under B’s cookie — and demonstrably DID reach it before the handover', async () => {
    /* ---- tab 2: A's reader, open and syncing ---------------------- */
    const tab2 = await openTab();
    await tab2.local.clearLocalData();
    await signedInAs(tab2, A);
    await tab2.local.db.outbox.add({ table: 'progress', row: QUEUED_BEFORE_THE_HANDOVER });
    tab2.engine.startSync();

    /* ---- the reverse assertion: it really does sync -------------- */
    // Not "eventually" and not "at least one" — the exact set of rows that
    // reached the server. A `toContain` here would be satisfied by junk, and
    // this repo has shipped that mistake twice.
    await tab2.engine.syncOnce();
    expect(progressRowsThatReachedTheServer()).toEqual([QUEUED_BEFORE_THE_HANDOVER]);
    const trafficBefore = syncTraffic().length;
    expect(trafficBefore).toBeGreaterThan(0);

    /* ---- tab 1: a different person signs in ----------------------- */
    await bSignsInAnotherTab();

    /* ---- A keeps reading in tab 2, and marks another chapter ------ */
    // Re-seeded AFTER the handover on purpose: tab 1's `clearSession()`
    // emptied the shared IndexedDB, so without this the outbox would be empty
    // and "tab 2 sent nothing" would be true for a reason that has nothing to
    // do with the fix.
    await tab2.local.db.outbox.add({ table: 'progress', row: QUEUED_AFTER_THE_HANDOVER });
    expect(await tab2.local.db.outbox.count()).toBe(1);

    /* ---- THE ASSERTION ------------------------------------------- */
    // A deliberate, direct cycle — not a timer tick — so this is not "the
    // timer happened not to fire yet", and not a `waitFor`, which can only
    // ever say "not yet" about a negative. Asked point-blank, tab 2 refuses.
    await tab2.engine.syncOnce();

    // The exact set of rows the server ever saw is unchanged — the row queued
    // after the handover is not among them. This is the sentence in
    // `docs/carried-forward.md` turned into an assertion.
    expect(progressRowsThatReachedTheServer()).toEqual([QUEUED_BEFORE_THE_HANDOVER]);
    // And nothing at all was sent: no push (A's rows into B's account) and no
    // pull either (B's rows into a database tab 2 renders as A's, plus B's
    // cursor into `db.meta` — the leak runs in both directions).
    expect(syncTraffic().length).toBe(trafficBefore);
    // Refused, not discarded: A's mutation is still queued for whenever A
    // signs in again. "Stopped syncing" must not mean "silently lost".
    expect(await tab2.local.db.outbox.count()).toBe(1);
  }, 30_000);

  it('tab 2’s loop is torn down when it is TOLD, not only when it next happens to look', async () => {
    // A separate test from the one above, deliberately: there, the refusal is
    // measured by asking for a cycle, which the synchronous guard in
    // `runCycle` answers on its own. That means the subscription could be
    // deleted entirely and the test above would stay green — the exact shape
    // of "a tripwire that is still green for a different reason than the one
    // its author wrote down" (docs/carried-forward.md, S2 Task 9).
    //
    // This one asserts the OTHER half, by timer identity and before any cycle
    // is asked for: the interval `startSync` registered is cleared as a
    // consequence of the announcement arriving.
    //
    // **It was written with `waitFor` first, and that version was measured to
    // be worthless** — mutant M2 (subscription deleted) SURVIVED it, green in
    // 15 091 ms. The reason is the whole lesson: `startSync` registers a real
    // 15 000 ms interval, `src/test/setup.ts` sets `asyncUtilTimeout` to
    // 15 000 ms, and so the wait outlived the first real tick — which called
    // `runCycle`, hit the synchronous guard, and cleared the timer itself. The
    // assertion was satisfied by the very mechanism it was supposed to be
    // measuring independently of.
    //
    // So there is no wait here. The announcement is posted synchronously
    // inside `clearSession()` and jsdom queues its delivery as a task, while
    // `bSignsInAnotherTab()` below awaits many macrotasks after that point
    // (`userEvent` types character by character, `waitFor` polls). One
    // `setTimeout(0)` is therefore an ORDERING guarantee — a task queued
    // earlier runs earlier — not a timing bet, and the whole test finishes two
    // orders of magnitude before the 15 s tick this assertion must not be able
    // to borrow.
    const tab2 = await openTab();
    await tab2.local.clearLocalData();
    await signedInAs(tab2, A);

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    tab2.engine.startSync();
    const syncTimerIds = setIntervalSpy.mock.calls
      .map((call, index) => ({ every: call[1], id: setIntervalSpy.mock.results[index].value }))
      .filter((entry) => entry.every === 15_000)
      .map((entry) => entry.id);
    setIntervalSpy.mockRestore();
    expect(syncTimerIds).toHaveLength(1);

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    await bSignsInAnotherTab();

    await new Promise((resolve) => setTimeout(resolve, 0));
    const cleared = clearIntervalSpy.mock.calls.map((call) => call[0]);
    clearIntervalSpy.mockRestore();
    // Timer IDENTITY, not a count: `waitFor` and `userEvent` register
    // intervals of their own, so "some interval was cleared" would be true in
    // every run of every test in this file.
    expect(cleared).toContain(syncTimerIds[0]);
  }, 30_000);

  it('clearSession() alone tells the other tabs, with no component mounted to do it for them', async () => {
    // Isolates the announcement in `auth/session.ts` from the one in
    // `api/useMe.ts`. In the end-to-end test above both fire, so deleting
    // either leaves the other establishing the same fact and the mutant
    // survives — which is exactly what was measured before this test existed
    // (mutant M3, green in 4/4).
    //
    // Here tab 1 has no React tree at all: it calls the one door both auth
    // transitions already go through, and nothing else. `clearSession()` is
    // the EARLIEST honest signal in the whole flow — `POST /auth/login` has
    // already replaced the cookie by the time either call site reaches it,
    // and it lands a full `clearLocalData()` IndexedDB round trip plus a
    // React commit ahead of `useMe`'s announcement. That gap is tens of
    // milliseconds on a slow device, and a 15-second tick in another tab can
    // land inside it.
    const tab2 = await openTab();
    await tab2.local.clearLocalData();
    await signedInAs(tab2, A);
    await tab2.local.db.outbox.add({ table: 'progress', row: QUEUED_BEFORE_THE_HANDOVER });
    tab2.engine.startSync();

    await tab2.engine.syncOnce();
    expect(progressRowsThatReachedTheServer()).toEqual([QUEUED_BEFORE_THE_HANDOVER]);
    const trafficBefore = syncTraffic().length;
    expect(trafficBefore).toBeGreaterThan(0);

    await openTab();
    const { clearSession } = await import('../auth/session');
    await clearSession(new QueryClient());
    await new Promise((resolve) => setTimeout(resolve, 0));

    await tab2.local.db.outbox.add({ table: 'progress', row: QUEUED_AFTER_THE_HANDOVER });
    await tab2.engine.syncOnce();

    expect(progressRowsThatReachedTheServer()).toEqual([QUEUED_BEFORE_THE_HANDOVER]);
    expect(syncTraffic().length).toBe(trafficBefore);
  }, 30_000);

  it('a tab that only OVERHEARS its own session is untouched — the guard is about change, not about noise', async () => {
    // The control for over-blocking. A guard that stopped on any announcement
    // whatsoever would pass every assertion in the test above and would also
    // break sync for everybody the first time a second tab of the SAME
    // account said hello. Two tabs, same person: both keep syncing.
    const tab2 = await openTab();
    await tab2.local.clearLocalData();
    await signedInAs(tab2, A);
    tab2.engine.startSync();

    const tab1 = await openTab();
    await signedInAs(tab1, A);

    await tab2.local.db.outbox.add({ table: 'progress', row: QUEUED_AFTER_THE_HANDOVER });
    await tab2.engine.syncOnce();

    expect(tab2.identity.sessionWasSuperseded()).toBe(false);
    expect(progressRowsThatReachedTheServer()).toEqual([QUEUED_AFTER_THE_HANDOVER]);
  }, 30_000);

  it('positive control: the tab that DOES the signing in keeps syncing, for the account that just arrived', async () => {
    // The failure this rules out is self-inflicted and would be invisible in
    // the test above: if the announcement reached the announcing tab's own
    // engine, or landed after `useSyncLifecycle` had already bound it, the
    // tab that just signed in would stop syncing forever and nothing would
    // say so. This runs the REAL wiring — `<App/>`'s `useSyncLifecycle`,
    // driven by `useMe` — through a real sign-in, and then asks for a cycle.
    const tab = await openTab();
    await tab.local.clearLocalData();
    const { default: App } = await import('../App');

    render(<App />);
    await bSignsInThroughTheRealForm();

    await tab.local.db.outbox.add({ table: 'progress', row: QUEUED_AFTER_THE_HANDOVER });
    await tab.engine.syncOnce();

    expect(tab.identity.sessionWasSuperseded()).toBe(false);
    expect(progressRowsThatReachedTheServer()).toEqual([QUEUED_AFTER_THE_HANDOVER]);
  }, 30_000);
});
