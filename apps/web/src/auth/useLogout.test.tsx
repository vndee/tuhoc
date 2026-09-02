import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as eventsModule from '../api/events';
import { meQueryKey } from '../api/useMe';
import { USER_CONTENT_KEYS } from '../db/localStorage';
import { useLogout } from './useLogout';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

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
  it('calls POST /auth/logout, clears user-content localStorage, and navigates to /login', async () => {
    for (const key of USER_CONTENT_KEYS) window.localStorage.setItem(key, 'nháp chưa lưu');

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

    expect(logoutCalled).toBe(true);
    for (const key of USER_CONTENT_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
    expect(queryClient.getQueryData(meQueryKey)).toBeNull();
    await waitFor(() => expect(currentPath()).toBe('/login'));
  });

  it('resets every session-scoped query cache entry, not just `me` (I5)', async () => {
    // Before this fix the ONLY cache write logout did was
    // `setQueryData(meQueryKey, null)`. `['stats']` — the dashboard's
    // streak, total minutes and 30-day chart — survived untouched, so an
    // in-app logout→login on the same browser rendered the DEPARTING
    // user's numbers to the arriving one for as long as the refetch took,
    // and indefinitely if it failed.
    server.use(http.post('/auth/logout', () => new HttpResponse(null, { status: 200 })));

    const queryClient = new QueryClient();
    queryClient.setQueryData(meQueryKey, { id: 'u1', email: 'a@b.com', name: 'A' });
    queryClient.setQueryData(['stats'], { totalMinutes: 123, streakDays: 7, days: [], courses: [] });
    queryClient.setQueryData(['course', 'so-dau-phay-dong'], { title: 'Số dấu phẩy động' });

    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(queryClient) });
    await act(async () => {
      await result.current();
    });

    expect(queryClient.getQueryData(['stats'])).toBeUndefined();
    expect(queryClient.getQueryData(['course', 'so-dau-phay-dong'])).toBeUndefined();
    // `me` is deliberately the one entry NOT removed — it is overwritten
    // with `null` instead, so the app-wide `useMe()` observer that drives
    // <RequireAuth> and the sync lifecycle is never left pointing at a
    // destroyed query. See resetSessionScopedQueries' own doc comment.
    expect(queryClient.getQueryData(meQueryKey)).toBeNull();
  });

  /**
   * Task 10 rewrite: before this task, "the outbox" (`sync/engine.ts`) was
   * what logout waited to flush, proven via a spy on `engine.syncOnce`.
   * That engine is gone — progress/annotation writes are react-query
   * mutations now, sent directly, and the thing worth proving is that a
   * REAL in-flight mutation (not a mock) is genuinely waited for before
   * `POST /auth/logout` runs, using the SAME machinery `useLogout.ts`
   * itself uses (`queryClient.isMutating()`).
   */
  it('waits for an in-flight mutation to settle before calling POST /auth/logout', async () => {
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    const callOrder: string[] = [];
    server.use(http.post('/auth/logout', () => {
      callOrder.push('logout');
      return new HttpResponse(null, { status: 200 });
    }));

    const queryClient = new QueryClient();
    const { result } = renderHook(
      () => ({
        logout: useLogout(),
        mutation: useMutation({
          mutationFn: async () => {
            callOrder.push('mutation-start');
            await gate;
            callOrder.push('mutation-settled');
          },
        }),
      }),
      { wrapper: wrapper(queryClient) },
    );

    act(() => {
      result.current.mutation.mutate();
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(1));

    const logoutPromise = result.current.logout();
    // Give logout's own wait a moment to reach `waitForMutationsToSettle` —
    // proves it genuinely waits rather than racing past the mutation.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callOrder).toEqual(['mutation-start']);

    releaseGate!();
    await act(async () => {
      await logoutPromise;
    });

    expect(callOrder).toEqual(['mutation-start', 'mutation-settled', 'logout']);
  });

  // Same reasoning as the outbox-flush ordering test this replaces: a flush
  // attempted AFTER the cookie is invalidated has no session left to
  // succeed under.
  it('flushes the study-event queue (flushEvents) BEFORE calling POST /auth/logout', async () => {
    const callOrder: string[] = [];
    const flushEventsSpy = vi.spyOn(eventsModule, 'flushEvents').mockImplementation(async () => {
      callOrder.push('flushEvents');
    });
    server.use(
      http.post('/auth/logout', () => {
        callOrder.push('logout');
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current();
    });

    expect(flushEventsSpy).toHaveBeenCalled();
    expect(callOrder).toEqual(['flushEvents', 'logout']);
    vi.restoreAllMocks();
  });

  it('still clears local state and navigates to /login even when POST /auth/logout fails (network error)', async () => {
    window.localStorage.setItem(USER_CONTENT_KEYS[0], 'nháp');
    server.use(http.post('/auth/logout', () => HttpResponse.error()));

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current();
    });

    expect(window.localStorage.getItem(USER_CONTENT_KEYS[0])).toBeNull();
    await waitFor(() => expect(currentPath()).toBe('/login'));
  });

  it('still clears local state and logs out even when the best-effort flushEvents() itself throws', async () => {
    window.localStorage.setItem(USER_CONTENT_KEYS[0], 'nháp');
    vi.spyOn(eventsModule, 'flushEvents').mockRejectedValue(new Error('boom'));
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
    expect(window.localStorage.getItem(USER_CONTENT_KEYS[0])).toBeNull();
    await waitFor(() => expect(currentPath()).toBe('/login'));

    vi.restoreAllMocks();
  });

  // Minor finding, folded into this round: the best-effort flush must not
  // hold the logout UI hostage on a hung connection (a mutation that never
  // settles). Real time, not fake timers — this codebase has a documented
  // reason to avoid `vi.useFakeTimers()` around IndexedDB-adjacent work
  // elsewhere, and this test has no such dependency, but keeping it on real
  // time is what actually exercises `LOGOUT_SYNC_TIMEOUT_MS`. Given a
  // generous per-test timeout so it doesn't race vitest's own default.
  it(
    'proceeds with logout (clears local state, navigates) even when a mutation never settles (Minor finding — bounded, not indefinite)',
    async () => {
      window.localStorage.setItem(USER_CONTENT_KEYS[0], 'nháp');
      let logoutCalled = false;
      server.use(
        http.post('/auth/logout', () => {
          logoutCalled = true;
          return new HttpResponse(null, { status: 200 });
        }),
      );

      const queryClient = new QueryClient();
      const { result } = renderHook(
        () => ({
          logout: useLogout(),
          mutation: useMutation({
            mutationFn: () => new Promise<void>(() => {}), // never resolves
          }),
        }),
        { wrapper: wrapper(queryClient) },
      );

      act(() => {
        result.current.mutation.mutate();
      });
      await waitFor(() => expect(queryClient.isMutating()).toBe(1));

      await act(async () => {
        await result.current.logout();
      });

      expect(logoutCalled).toBe(true);
      expect(window.localStorage.getItem(USER_CONTENT_KEYS[0])).toBeNull();
      await waitFor(() => expect(currentPath()).toBe('/login'));
    },
    10_000,
  );

  /**
   * Task 10 note, replacing two removed tests: the old file carried
   * "a cycle already in flight when logout is called cannot repopulate
   * local data once its late response arrives" and a fix-round-2 sibling —
   * both proved `sync/engine.ts`'s double `stopSync()` closed a race where
   * an ABANDONED cycle's late response wrote the departing user's rows
   * straight into a local Dexie table `clearSession()` had already
   * declared clean.
   *
   * That race cannot be reconstructed here, and not because it was hard to
   * reach — because there is no longer a local table for a late response
   * to write into. A react-query mutation abandoned past
   * `LOGOUT_SYNC_TIMEOUT_MS` keeps running (same as before: no
   * `AbortController` wired through `api/client.ts`), but its `onSuccess`/
   * `onSettled` handlers only ever write to the QUERY CACHE
   * (`invalidateQueries`/`setQueryData`), never to a durable local store —
   * and any query it triggers is answered by the SERVER, scoped to
   * whichever session cookie is valid at the moment that fetch actually
   * runs. If account B has since signed in on this browser, a late
   * `invalidateQueries` from A's abandoned mutation just causes a refetch
   * that the server answers as B's own data — not A's, because the server
   * (not this client) is what decides whose rows a request sees. The class
   * of bug the old tests guarded against — CLIENT CODE deciding whose data
   * a local write belongs to, and getting it wrong under a race — is gone
   * with the architecture that made it possible, not merely untested.
   */
});
