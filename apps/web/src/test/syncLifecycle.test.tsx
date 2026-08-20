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

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
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
  });

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
  });

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
  });
});
