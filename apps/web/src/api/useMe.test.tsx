import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// useMe's whole point is to treat GET /me's 401 as an ordinary, expected
// answer ("nobody is logged in") rather than a session dying mid-use — see
// RequestOptions in client.ts. Mocking navigation here proves that on its
// own: if useMe ever regressed to using the client's default
// redirect-on-401 behavior, this file's 401 test would catch it via
// `redirectToLogin` being called, independent of whatever Login/RequireAuth
// do with the resulting `data: null`.
vi.mock('../api/navigation', () => ({
  redirectToLogin: vi.fn(),
}));

import { redirectToLogin } from './navigation';
import { meQueryKey, useMe } from './useMe';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.mocked(redirectToLogin).mockClear();
});
afterAll(() => server.close());

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

describe('useMe', () => {
  it('resolves with the user on a 200 from GET /me', async () => {
    server.use(
      http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })),
    );
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useMe(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: 'u1', email: 'a@example.com', name: 'A' });
  });

  it('resolves with data: null (not isError) on a 401 from GET /me, and does NOT trigger the client redirect', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useMe(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it('surfaces isError:true (not data:null) on a 500 from GET /me — a server failure is not "logged out"', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useMe(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('uses the shared meQueryKey so other code (Login) can seed this exact cache entry', async () => {
    server.use(
      http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })),
    );
    const { Wrapper, queryClient } = wrapper();

    const { result } = renderHook(() => useMe(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(meQueryKey)).toEqual({ id: 'u1', email: 'a@example.com', name: 'A' });
  });
});
