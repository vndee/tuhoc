import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AdminGuard } from './AdminGuard';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function Protected() {
  return <div>Admin content</div>;
}

function Home() {
  return <div>Home page</div>;
}

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/admin"
            element={
              <AdminGuard>
                <Protected />
              </AdminGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminGuard', () => {
  /**
   * THE FLASH BUG this task's own brief calls out by name: collapsing
   * useMe's three settled shapes (pending / admin / not-admin) into two
   * reads "pending" as "not admin yet" and renders the redirect (or worse,
   * a flash of "access denied") for every already-admin visitor on every
   * page load. Neither "Admin content" nor "Home page" may be on screen
   * while GET /me is still in flight — this is the assertion that would
   * fail if that collapsing regressed.
   */
  it('renders NOTHING while GET /me is pending — no flash of the guarded page, no flash of the redirect target', async () => {
    server.use(
      http.get('/me', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json({ id: 'u1', email: 'admin@example.com', name: 'Admin', role: 'admin' });
      }),
    );
    renderApp();

    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Admin content')).toBeInTheDocument());
  });

  it('role "admin" renders the guarded children, in place, at /admin', async () => {
    server.use(
      http.get('/me', () =>
        HttpResponse.json({ id: 'u1', email: 'admin@example.com', name: 'Admin', role: 'admin' }),
      ),
    );
    renderApp();

    expect(await screen.findByText('Admin content')).toBeInTheDocument();
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
  });

  it('role "user" (a signed-in, non-admin account) is redirected to "/"', async () => {
    server.use(
      http.get('/me', () => HttpResponse.json({ id: 'u2', email: 'a@example.com', name: 'A', role: 'user' })),
    );
    renderApp();

    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
  });

  it('a logged-out visitor (GET /me → 401, data: null) is redirected to "/"', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    renderApp();

    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
  });

  /**
   * Fail CLOSED. RequireAuth's own offline branch would let an already-
   * authorized visitor keep a page that is already on screen when a
   * refetch fails with no response — there is no such page here (nothing
   * about /admin is meant to work offline; publishing needs a live
   * connection regardless), so an errored `/me` gets the exact same
   * treatment as a confirmed non-admin: away, not "stay just in case".
   */
  it('a `/me` that errors (500) is treated as NOT admin — redirected to "/", not left showing the guarded page', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    renderApp();

    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
  });
});
