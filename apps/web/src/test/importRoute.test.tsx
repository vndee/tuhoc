import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../routes';
import { clearUserContent } from '../db/localStorage';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ThemeProvider } from '../theme/ThemeContext';

/**
 * `/import` → `/courses?import=1`, reachable whether or not anybody is
 * signed in (Task 12) — and, as of Task 13, `?import=1` no longer opens
 * anything. `pages/ImportCourse.tsx` is what it used to open, and the
 * import flow it belonged to is dead (spec
 * `2026-08-25-server-side-pivot.md` §1: the server is the only place a
 * course lives now, via `tuhoc publish`, not `/import`). `pages/Courses.tsx`
 * dropped the tab/dialog affordance entirely, so the query parameter is
 * inert — the old redirect is kept alive (a saved link must still resolve),
 * but what it lands on is the plain public catalog, same as a bare
 * `/courses` visit.
 *
 * So this file's job narrows to what is still true: the OLD `/import` link
 * still resolves, still without a login wall, and a logged-out visit reaches
 * the SAME place a logged-in one does. What it resolves TO changed from "the
 * import dialog" to "the catalog" — this file used to assert the former and
 * now asserts the latter, which is why the heading it looks for changed
 * rather than the file being deleted outright: a route that stops resolving
 * silently is the S1-F29 shape this file exists to catch, and `/import`
 * still needs that catch even though nothing opens inside it any more.
 *
 * Driven through `AppRoutes` rather than through `<RequireAuth>` directly:
 * a route-level regression (someone re-wrapping `/courses`) shows up here,
 * where a test of the guard component itself cannot see it.
 */

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(clearUserContent);
afterEach(clearUserContent);

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

const CATALOG_HEADING = /khoá học/i;

describe('/import — vẫn phân giải, nay xuống danh mục công khai (Task 13)', () => {
  it('người CHƯA đăng nhập (GET /me → 401) vẫn tới được, không bị đưa về /login', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    server.use(http.get('/courses', () => HttpResponse.json([])));
    const pathnames: string[] = [];

    renderAt('/import', pathnames);

    expect(await screen.findByRole('heading', { name: CATALOG_HEADING, level: 1 })).toBeInTheDocument();
    // `/courses`, vì `/import` chuyển hướng về đó — nhưng KHÔNG còn hộp thoại
    // nào mở ra kèm theo: `?import=1` nay là một tham số không ai đọc.
    expect(pathnames.at(-1)).toBe('/courses');
    expect(pathnames).not.toContain('/login');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('người ĐÃ đăng nhập tới đúng nơi ấy — cùng một đích cho cả hai, không phải hai đích khác nhau', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'A' })));
    server.use(http.get('/courses', () => HttpResponse.json([])));
    const pathnames: string[] = [];

    renderAt('/import', pathnames);

    expect(await screen.findByRole('heading', { name: CATALOG_HEADING, level: 1 })).toBeInTheDocument();
    expect(pathnames.at(-1)).toBe('/courses');
  });
});
