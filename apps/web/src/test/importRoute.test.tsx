import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
 * `/import` → `/courses?import=1`, and — as of Task 12 — reachable whether
 * or not anybody is signed in. This file used to pin the opposite: a
 * logged-out visit bounced to `/login` before Task 12, because its
 * destination, `/courses`, sat behind `<RequireAuth>` (an import writes into
 * `db.packages`, and `clearLocalData()` empties that table on every auth
 * transition — a package pulled while logged out was deleted at the next
 * sign-in). Task 12's brief instructs removing `<RequireAuth>` from
 * `/courses` outright, without an exception for the import dialog it can
 * open — courses are free to read (spec §2.4), and `/courses` is the one
 * screen every reader, signed in or not, needs to reach a public course
 * catalog from. The import-write tension that gating used to paper over
 * still exists (an anonymous import is still wiped at the next sign-in);
 * it just no longer manifests as a login bounce, and closing it is out of
 * this task's scope — see task-12-report.md.
 *
 * So the "bounced to /login" case is gone (removing it, not weakening it: the
 * behavior it pinned no longer exists), and its complement below is joined by
 * a new one proving the CURRENT invariant instead — a logged-out visit reaches
 * the SAME place a logged-in one does, not merely "no longer /login".
 *
 * Driven through `AppRoutes` rather than through `<RequireAuth>` directly:
 * a route-level regression (someone re-wrapping `/courses`) shows up here,
 * where a test of the guard component itself cannot see it.
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

describe('/import — công khai kể từ Task 12', () => {
  it('người CHƯA đăng nhập (GET /me → 401) vẫn tới được, không bị đưa về /login', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const pathnames: string[] = [];

    renderAt('/import', pathnames);

    expect(await screen.findByRole('heading', { name: IMPORT_HEADING })).toBeInTheDocument();
    // `/courses`, because `/import` redirects there — and the redirect carries
    // `?import=1`, which is what makes the heading above appear at all. A bare
    // `/courses` would land on the course list with no importer anywhere, and
    // this test would be red for exactly the right reason.
    expect(pathnames.at(-1)).toBe('/courses');
    expect(pathnames).not.toContain('/login');
  });

  it('người ĐÃ đăng nhập tới đúng nơi ấy — cùng một đích cho cả hai, không phải hai đích khác nhau', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'A' })));
    const pathnames: string[] = [];

    renderAt('/import', pathnames);

    expect(await screen.findByRole('heading', { name: IMPORT_HEADING })).toBeInTheDocument();
    expect(pathnames.at(-1)).toBe('/courses');
  });
});
