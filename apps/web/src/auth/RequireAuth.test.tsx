import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Login } from '../pages/Login';
import { RequireAuth } from './RequireAuth';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function Protected() {
  return <div>Protected content</div>;
}

/** Records every pathname react-router settles on, in order, so a test can
 * assert "landed once and stayed" versus "kept bouncing back and forth". */
function LocationRecorder({ onChange }: { onChange: (pathname: string) => void }) {
  const location = useLocation();
  useEffect(() => {
    onChange(location.pathname);
  }, [location.pathname, onChange]);
  return null;
}

function renderApp(initialPath: string, pathnames: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationRecorder onChange={(p) => pathnames.push(p)} />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Protected />
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RequireAuth', () => {
  it('renders nothing while the auth check is pending (no flicker of protected content or login)', async () => {
    server.use(
      http.get('/me', async () => {
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' });
      }),
    );
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /đăng nhập/i })).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Protected content')).toBeInTheDocument());
  });

  it('renders children once GET /me resolves with a user', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });

  it('redirects to /login when GET /me answers 401 (nobody logged in)', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    await waitFor(() => expect(pathnames.at(-1)).toBe('/login'));
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('does NOT redirect on a 500 from GET /me — shows an inline Vietnamese error instead, so an outage never looks like "you were logged out"', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    await waitFor(() => expect(screen.queryByText('Protected content')).not.toBeInTheDocument());
    // Give any (incorrect) redirect a chance to happen before asserting it didn't.
    await new Promise((r) => setTimeout(r, 10));
    expect(pathnames.at(-1)).toBe('/');
    expect(screen.getByText(/máy chủ|lỗi/i)).toBeInTheDocument();
  });

  it('a logged-out visitor who lands on /login (via the redirect above) is NOT bounced again — no redirect loop', async () => {
    let meCallCount = 0;
    server.use(
      http.get('/me', () => {
        meCallCount += 1;
        return HttpResponse.json({ error: 'unauthenticated' }, { status: 401 });
      }),
    );
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    // Settle on /login.
    await waitFor(() => expect(pathnames.at(-1)).toBe('/login'));
    expect(await screen.findByRole('heading', { name: /đăng nhập/i })).toBeInTheDocument();

    // Give the app plenty of time to loop if it were going to.
    await new Promise((r) => setTimeout(r, 100));

    expect(pathnames).toEqual(['/', '/login']);
    // Login itself never calls GET /me, so the only call is RequireAuth's
    // original check — this is the concrete guarantee against a loop.
    expect(meCallCount).toBe(1);
    expect(screen.getByRole('heading', { name: /đăng nhập/i })).toBeInTheDocument();
  });
});
