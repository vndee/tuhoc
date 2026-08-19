import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { meQueryKey } from '../api/useMe';
import { db } from '../db/local';
import * as engine from '../sync/engine';
import { useLogout } from './useLogout';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function clearAll() {
  await Promise.all([db.progress.clear(), db.annotations.clear(), db.outbox.clear(), db.meta.clear()]);
}

beforeEach(clearAll);
afterEach(clearAll);

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

function currentPath(): string | null {
  return document.querySelector('[data-testid="path"]')?.textContent ?? null;
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<>{children}<LocationProbe /></>} />
            <Route path="/login" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe('useLogout', () => {
  it('stops the sync engine, best-effort flushes the outbox, calls POST /auth/logout, clears every local table, and navigates to /login', async () => {
    await db.progress.put({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: new Date().toISOString() });
    await db.annotations.put({ id: 'a1', courseId: 'c1', chapterId: 'ch1', anchor: {}, note: 'n', createdAt: '', updatedAt: '', deletedAt: null });
    await db.outbox.add({ table: 'progress', row: { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: new Date().toISOString() } });
    await db.meta.put({ key: 'syncCursor', value: 'sometoken' });

    const stopSyncSpy = vi.spyOn(engine, 'stopSync');
    const syncOnceSpy = vi.spyOn(engine, 'syncOnce').mockResolvedValue(undefined);

    let logoutCalled = false;
    server.use(http.post('/auth/logout', () => {
      logoutCalled = true;
      return new HttpResponse(null, { status: 200 });
    }));

    const queryClient = new QueryClient();
    queryClient.setQueryData(meQueryKey, { id: 'u1', email: 'a@b.com', name: 'A' });

    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current();
    });

    expect(stopSyncSpy).toHaveBeenCalled();
    expect(syncOnceSpy).toHaveBeenCalled();
    expect(logoutCalled).toBe(true);

    expect(await db.progress.count()).toBe(0);
    expect(await db.annotations.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);

    expect(queryClient.getQueryData(meQueryKey)).toBeNull();
    await waitFor(() => expect(currentPath()).toBe("/login"));

    stopSyncSpy.mockRestore();
    syncOnceSpy.mockRestore();
  });

  it('flushes the outbox (syncOnce) BEFORE calling POST /auth/logout — the session must still be valid for the flush to have any chance of succeeding', async () => {
    const callOrder: string[] = [];
    const syncOnceSpy = vi.spyOn(engine, 'syncOnce').mockImplementation(async () => {
      callOrder.push('syncOnce');
    });
    server.use(http.post('/auth/logout', () => {
      callOrder.push('logout');
      return new HttpResponse(null, { status: 200 });
    }));

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current();
    });

    expect(callOrder).toEqual(['syncOnce', 'logout']);
    syncOnceSpy.mockRestore();
  });

  it('still clears local tables and navigates to /login even when POST /auth/logout fails (network error)', async () => {
    await db.progress.put({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: new Date().toISOString() });
    server.use(http.post('/auth/logout', () => HttpResponse.error()));
    vi.spyOn(engine, 'syncOnce').mockResolvedValue(undefined);

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current();
    });

    expect(await db.progress.count()).toBe(0);
    await waitFor(() => expect(currentPath()).toBe("/login"));

    vi.restoreAllMocks();
  });

  it('still clears local tables and logs out even when the best-effort syncOnce() flush itself throws', async () => {
    await db.progress.put({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: new Date().toISOString() });
    vi.spyOn(engine, 'syncOnce').mockRejectedValue(new Error('boom'));
    let logoutCalled = false;
    server.use(http.post('/auth/logout', () => {
      logoutCalled = true;
      return new HttpResponse(null, { status: 200 });
    }));

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current();
    });

    expect(logoutCalled).toBe(true);
    expect(await db.progress.count()).toBe(0);
    await waitFor(() => expect(currentPath()).toBe("/login"));

    vi.restoreAllMocks();
  });

  it('does not leave a second account\'s progress readable: a fresh useProgress read after logout sees nothing for a previously-read chapter', async () => {
    await db.progress.put({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: new Date().toISOString() });
    vi.spyOn(engine, 'syncOnce').mockResolvedValue(undefined);
    server.use(http.post('/auth/logout', () => new HttpResponse(null, { status: 200 })));

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current();
    });

    const row = await db.progress.get(['c1', 'ch1', 'read']);
    expect(row).toBeUndefined();

    vi.restoreAllMocks();
  });

  // Fix-round-1, Finding 2: a cycle that was ALREADY in flight (started
  // before logout was clicked — e.g. the 15s timer firing moments before
  // the user hit "Đăng xuất") must never be able to write into the local
  // database after logout has cleared it. This test uses the REAL
  // `engine.syncOnce`/`stopSync`/`waitForInFlight` (no mocking — the race
  // being tested lives inside their actual interaction, not something a
  // mock can stand in for) and a manually-controlled `GET /sync` response
  // so the "request sent, response not yet received" window can be
  // deterministically held open across the exact moment logout runs.
  it('a cycle already in flight when logout is called cannot repopulate local data once its late response arrives', async () => {
    await db.progress.put({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: new Date().toISOString() });

    let releasePull: (() => void) | undefined;
    const pullGate = new Promise<void>((resolve) => {
      releasePull = resolve;
    });
    let pullRequested = false;

    server.use(
      http.post('/sync', () => HttpResponse.json({ applied: 0 })),
      http.get('/sync', async () => {
        pullRequested = true;
        await pullGate;
        // A remote row for the SAME chapter — simulating another device's
        // (or, worse, another account's leftover) progress landing right
        // as this session is logging out.
        return HttpResponse.json({
          progress: [{ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: new Date().toISOString() }],
          annotations: [],
          cursor: 'sometoken',
        });
      }),
      http.post('/auth/logout', () => new HttpResponse(null, { status: 200 })),
    );

    // Simulate the 15s timer firing moments before the user clicks logout
    // — a real cycle, started through the real engine, not through
    // useLogout at all.
    const staleCycle = engine.syncOnce();
    await vi.waitFor(() => expect(pullRequested).toBe(true));

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(queryClient) });

    // Kicked off directly (not wrapped in `act`) so it can run
    // concurrently with the `setTimeout`/`releasePull` below — `act`'s own
    // promise is only awaited once, at the end, in the single call below,
    // which is what actually matters for flushing the `navigate()` call
    // deep inside this promise chain into the DOM.
    const logoutPromise = result.current();

    // Give logout's own bestEffortFinalFlush a moment to reach
    // waitForInFlight() (which is now awaiting the SAME stale cycle)
    // before releasing the gate — proves logout genuinely waits rather
    // than racing past it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    releasePull!();

    await act(async () => {
      await logoutPromise;
    });
    await staleCycle;

    const row = await db.progress.get(['c1', 'ch1', 'read']);
    expect(row).toBeUndefined();
    await waitFor(() => expect(currentPath()).toBe('/login'));
  });

  // Minor finding, folded into this round: the best-effort flush must not
  // hold the logout UI hostage on a hung connection. Real time, not fake
  // timers — this codebase already has a documented reason to avoid
  // `vi.useFakeTimers()` around Dexie/fake-indexeddb operations (see
  // engine.test.ts's own comment on the interval test: fake-indexeddb
  // schedules its callbacks via a REAL `setImmediate`, and faking the
  // clock around a real Dexie transaction is a known deadlock) — this
  // test's own `db.progress.clear()` etc. are exactly such an operation,
  // so it genuinely waits out the real bound instead. Given a generous
  // per-test timeout so it doesn't race vitest's own default.
  it(
    'proceeds with logout (clears local state, navigates) even when the best-effort flush never resolves (Minor finding — bounded, not indefinite)',
    async () => {
      vi.spyOn(engine, 'waitForInFlight').mockReturnValue(new Promise<void>(() => {})); // never resolves
      await db.progress.put({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: new Date().toISOString() });
      let logoutCalled = false;
      server.use(
        http.post('/auth/logout', () => {
          logoutCalled = true;
          return new HttpResponse(null, { status: 200 });
        }),
      );

      const queryClient = new QueryClient();
      const { result } = renderHook(() => useLogout(), { wrapper: wrapper(queryClient) });

      await act(async () => {
        await result.current();
      });

      expect(logoutCalled).toBe(true);
      expect(await db.progress.count()).toBe(0);
      await waitFor(() => expect(currentPath()).toBe('/login'));

      vi.restoreAllMocks();
    },
    10_000,
  );
});
