import { render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Debt #4: startSync()/stopSync() had NO call site before this task — the
// background sync loop never ran. These tests prove App.tsx's
// useSyncLifecycle wiring: started once authenticated, never started for
// a logged-out visitor, and stopped on unmount.
//
// Each test dynamically re-imports both `../sync/engine` and `../App`
// AFTER `vi.resetModules()`: `App.tsx`'s `queryClient` and
// `sync/engine.ts`'s `timer`/`onlineListener` are module-level singletons
// (by design — see their own doc comments), which is exactly right for
// the real app (one QueryClient, one sync loop, for its whole lifetime)
// but means two `<App/>` renders in the SAME test file would otherwise
// share one `me` query cache across tests — a user resolved as
// authenticated in one test would still read back from cache in the
// NEXT test even against a freshly-mocked 401, hiding the very
// distinction these tests exist to check. A fresh module graph per test
// is what real separate page loads would give this code.
const emptyStats = { totalMinutes: 0, streakDays: 0, days: [], courses: [] };

/**
 * The budget every `it` and the warm-up hook below run under, and the
 * reason this file needs one at all.
 *
 * Under `--maxWorkers=24` on an 8-core machine (24 vitest workers sharing 8
 * cores — the shape an oversubscribed CI runner has) the FIRST test here
 * used to die with `Error: Test timed out in 5000ms.` in 3 of 16 full-suite
 * runs. That is vitest's own `testTimeout`, not an assertion: no `expect`
 * in this file has ever been observed to fail, and in particular the
 * "logged-out visitor" test's `expect(startSyncSpy).not.toHaveBeenCalled()`
 * has never gone red. Nothing here is racing; the test body simply does
 * not FIT in 5000 ms once 24 workers fight over 8 cores.
 *
 * Where the time went — probe around each phase of the first test's body,
 * 16 full-suite runs at `--maxWorkers=24`, versus the same probe on an idle
 * machine (raw numbers, not rounded):
 *
 *   phase                              idle          24 workers / 8 cores
 *   ---------------------------------------------------------------------
 *   await import('../sync/engine')     45.5 ms        160.7 – 2675.4 ms
 *   await import('../App')            348.5 ms       2029.5 – 5736.8 ms
 *   render(<App/>)                     30.5 ms         54.0 –  645.0 ms
 *   waitFor(startSync called)          20.6 ms         44.9 –  888.0 ms
 *   ---------------------------------------------------------------------
 *   whole test body                   445.1 ms       3164.1 – 8984.6 ms
 *
 * The two dynamic imports are 91–98% of that, and they are not waiting on
 * anything — they are Vite transforming and evaluating the entire `App`
 * module graph, cold, inside the timed body. `waitFor`, the only phase that
 * actually waits for the app, never exceeded 888.0 ms, and it carries its
 * own 1000 ms bound anyway: a genuine "startSync was never called" still
 * fails in about a second no matter how large this constant is. Which is
 * the point — this budget covers module loading, and cannot mask a hang in
 * anything these tests assert.
 *
 * 30 s is 3.3× the worst body ever measured before the warm-up below, and
 * 4.6× the worst warm-up hook measured after it (2370.5 – 6467.2 ms over 16
 * runs — vitest's default `hookTimeout` is 10000 ms, only 1.55× that worst
 * case, so the hook needs the budget stated explicitly too).
 */
const OVERSUBSCRIBED_MS = 30_000;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

/**
 * Pay for the cold transform+evaluate of the `../App` module graph ONCE,
 * here, instead of inside the first `it`'s timed body.
 *
 * `vi.resetModules()` in `beforeEach` clears vitest's module REGISTRY, so
 * every test still evaluates a genuinely fresh module graph — the isolation
 * the block comment above depends on is untouched. What it does not clear
 * is Vite's transform cache, which is what actually costs seconds. Measured
 * effect on the first test's body, same 16-run `--maxWorkers=24`
 * configuration as the table above: 3164.1 – 8984.6 ms → 122.9 – 729.6 ms,
 * i.e. the worst case drops 12.3× and lands 6.9× under the default 5000 ms
 * even without `OVERSUBSCRIBED_MS`. Second and third tests already paid
 * only 30 – 360 ms for `import('../App')` for exactly this reason; this
 * hook gives the first test the same footing.
 */
beforeAll(async () => {
  await import('../sync/engine');
  await import('../App');
}, OVERSUBSCRIBED_MS);

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.resetModules();
});

describe('sync lifecycle (App.tsx)', () => {
  it('calls startSync() once GET /me resolves to a signed-in user, and stopSync() on unmount', async () => {
    server.use(
      http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@b.com', name: 'A' })),
      http.get('/stats', () => HttpResponse.json(emptyStats)),
    );
    const engine = await import('../sync/engine');
    const startSyncSpy = vi.spyOn(engine, 'startSync');
    const stopSyncSpy = vi.spyOn(engine, 'stopSync');
    const { default: App } = await import('../App');

    const { unmount } = render(<App />);

    await waitFor(() => expect(startSyncSpy).toHaveBeenCalled());

    unmount();
    expect(stopSyncSpy).toHaveBeenCalled();

    engine.stopSync();
  }, OVERSUBSCRIBED_MS);

  it('does NOT call startSync() for a logged-out visitor (GET /me answers 401)', async () => {
    server.use(http.get('/me', () => new HttpResponse(JSON.stringify({ error: 'unauthenticated' }), { status: 401 })));
    const engine = await import('../sync/engine');
    const startSyncSpy = vi.spyOn(engine, 'startSync');
    const { default: App } = await import('../App');

    render(<App />);

    // Let the /me request settle (it resolves to `null`, i.e. logged out —
    // RequireAuth redirects to /login, which never mounts Dashboard, so
    // /stats is never requested either).
    await waitFor(() => expect(document.querySelector('.auth-page')).toBeInTheDocument());
    expect(startSyncSpy).not.toHaveBeenCalled();

    engine.stopSync();
  }, OVERSUBSCRIBED_MS);

  it('startSync() is idempotent under this wiring — mounting once authenticated registers exactly one interval', async () => {
    server.use(
      http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@b.com', name: 'A' })),
      http.get('/stats', () => HttpResponse.json(emptyStats)),
    );
    const engine = await import('../sync/engine');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { default: App } = await import('../App');

    render(<App />);

    // Count only 15s intervals (the sync engine's own interval — see
    // engine.ts's SYNC_INTERVAL_MS) — `waitFor` itself polls via a REAL
    // `setInterval` under the hood, which would otherwise pollute a raw
    // call count with intervals this test has no interest in.
    const syncIntervalCalls = () => setIntervalSpy.mock.calls.filter((call) => call[1] === 15_000).length;

    await waitFor(() => expect(syncIntervalCalls()).toBe(1));
    // Give React a moment for any extra effect passes before asserting the
    // count never grows past one.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(syncIntervalCalls()).toBe(1);

    engine.stopSync();
    setIntervalSpy.mockRestore();
  }, OVERSUBSCRIBED_MS);
});
