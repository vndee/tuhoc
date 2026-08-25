import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../routes';
import { clearLocalData } from '../db/local';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ThemeProvider } from '../theme/ThemeContext';

/**
 * `/import` is not reachable while logged out — pinned, not merely written
 * down.
 *
 * ## `/import` is now a redirect, and this file still measures the same thing
 *
 * The IA redesign folded the import screen into `/courses` as a dialog, so
 * `/import` is `<Navigate to="/courses?import=1" replace/>`
 * (`docs/superpowers/specs/2026-08-23-ia-redesign.md`). The guard did not move
 * and neither did the risk: the destination is behind the same `<RequireAuth>`,
 * so a logged-out visit still ends at `/login` having rendered no import UI,
 * and a logged-in visit still ends with the importer on screen.
 *
 * What changed is the FINAL PATHNAME, and only that — `/courses` instead of
 * `/import`. The assertion was re-pointed rather than dropped: it is what
 * proves the logged-in case actually arrived somewhere instead of being
 * bounced, and deleting it would leave the complement below asserting nothing
 * about where the reader ended up.
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
      <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={[path]}>
        <Recorder onChange={(p) => pathnames.push(p)} />
        <AppRoutes />
      </MemoryRouter></LanguageProvider></ThemeProvider>
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
    // `/courses`, because `/import` redirects there — and the redirect carries
    // `?import=1`, which is what makes the heading above appear at all. A bare
    // `/courses` would land on the course list with no importer anywhere, and
    // this test would be red for exactly the right reason.
    expect(pathnames.at(-1)).toBe('/courses');
  });
});
