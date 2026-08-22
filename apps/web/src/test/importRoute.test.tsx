import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../routes';
import { clearLocalData } from '../db/local';

/**
 * `/import` is not reachable while logged out — pinned, not merely written
 * down.
 *
 * `routes.tsx` spends seven lines explaining why this route MUST be guarded,
 * and the reason is not tidiness: an import writes into `db.packages`, and
 * `clearLocalData()` walks `db.tables` and empties every one of them on
 * every auth transition. A package imported while logged out is therefore
 * deleted by the next sign-in — the reader loses a course they watched
 * arrive. Independent mutation testing removed the `<RequireAuth>` wrapper
 * from this one route and all 632 tests stayed green, so the argument had
 * nothing holding it. It does now.
 *
 * Driven through `AppRoutes` rather than through `<RequireAuth>` directly:
 * the mutant deletes the wrapper at the ROUTE, which a test of the guard
 * component itself cannot see.
 */

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(clearLocalData);
afterEach(clearLocalData);

function Recorder({ onChange }: { onChange: (pathname: string) => void }) {
  const location = useLocation();
  useEffect(() => {
    onChange(location.pathname);
  }, [location.pathname, onChange]);
  return null;
}

function renderAt(path: string, pathnames: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Recorder onChange={(p) => pathnames.push(p)} />
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const IMPORT_HEADING = /nhập khóa học/i;

describe('/import nằm sau RequireAuth', () => {
  it('người chưa đăng nhập bị đưa về /login, và KHÔNG thấy trang nhập', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const pathnames: string[] = [];

    renderAt('/import', pathnames);

    await waitFor(() => expect(pathnames.at(-1)).toBe('/login'));
    expect(screen.queryByRole('heading', { name: IMPORT_HEADING })).not.toBeInTheDocument();
  });

  it('người đã đăng nhập thì vào được — chốt này cấm đúng thứ cần cấm, không cấm tất', async () => {
    // The complement, and it is not decoration: a rule that only ever
    // forbids is satisfied by deleting the route altogether.
    server.use(http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'A' })));
    const pathnames: string[] = [];

    renderAt('/import', pathnames);

    expect(await screen.findByRole('heading', { name: IMPORT_HEADING })).toBeInTheDocument();
    expect(pathnames.at(-1)).toBe('/import');
  });
});
