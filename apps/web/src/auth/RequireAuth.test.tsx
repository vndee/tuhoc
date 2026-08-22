import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearLocalData, readSessionVerifiedAt, rememberSessionVerified } from '../db/local';
import { Login } from '../pages/Login';
import { RequireAuth } from './RequireAuth';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// This guard now WRITES to the local database (the offline-read marker), so
// every test here starts from a browser nobody has ever signed in on.
beforeEach(clearLocalData);
afterEach(clearLocalData);

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

/* ====================================================================== *
 * Task 7b — a COLD page load with the network down
 * ====================================================================== */

/** msw's network-level failure: `fetch` rejects with a bare `TypeError`, no status, no body — what a browser hands a page when it never reached a server. */
const NETWORK_IS_DOWN = http.get('/me', () => HttpResponse.error());

/** How long ago the last confirmed `GET /me` was, expressed as an absolute instant. */
function verifiedAgo(ms: number): Date {
  return new Date(Date.now() - ms);
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('RequireAuth — reading offline after a cold page load', () => {
  it('renders the protected page when the server is unreachable and this device recently held a confirmed session', async () => {
    // Task 7 made a pinned course readable with the network off, but only
    // for a tab that was ALREADY open: a fresh load could not get past this
    // guard, because `GET /me` failing looked exactly like being logged
    // out. Measured in a real browser — see task-7-report.md §5.5.
    await rememberSessionVerified(verifiedAgo(60_000));
    server.use(NETWORK_IS_DOWN);
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(await screen.findByText('Protected content')).toBeInTheDocument();
    // ...and it stayed. A guard that rendered the page and then bounced
    // would satisfy the line above for one frame.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('Protected content')).toBeInTheDocument();
    expect(pathnames).toEqual(['/']);
  });

  it('does NOT render the protected page on a device where nobody has signed in — an unreachable server is not a key', async () => {
    server.use(NETWORK_IS_DOWN);
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(await screen.findByText(/kết nối/i)).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(pathnames.at(-1)).toBe('/');
  });

  it('does NOT render the protected page once the offline window has run out', async () => {
    await rememberSessionVerified(verifiedAgo(8 * DAY_MS));
    server.use(NETWORK_IS_DOWN);
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(await screen.findByText(/kết nối/i)).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(pathnames.at(-1)).toBe('/');
  });

  it('a 401 still wins over the marker: the server saying "nobody is signed in" is an ANSWER, not an outage', async () => {
    // The sharp edge of this whole change. The marker only ever fills a
    // silence; it may never contradict the server.
    await rememberSessionVerified(verifiedAgo(60_000));
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    await waitFor(() => expect(pathnames.at(-1)).toBe('/login'));
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('a 500 still shows the outage message even with a fresh marker — a reachable, broken server is not an offline device', async () => {
    await rememberSessionVerified(verifiedAgo(60_000));
    server.use(http.get('/me', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(await screen.findByText(/máy chủ|lỗi/i)).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(pathnames.at(-1)).toBe('/');
  });

  it('a confirmed GET /me is what leaves the marker behind, so the NEXT load can be offline', async () => {
    expect(await readSessionVerifiedAt()).toBeNull();
    server.use(http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    await screen.findByText('Protected content');
    await waitFor(async () => expect(await readSessionVerifiedAt()).not.toBeNull());
  });

  it('a 401 leaves NO marker behind — the offline door never opens for a visitor who was refused', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    await waitFor(() => expect(pathnames.at(-1)).toBe('/login'));
    expect(await readSessionVerifiedAt()).toBeNull();
  });

  it('renders nothing — never the login screen — while it is still asking the local database', async () => {
    // The same trade the pending branch above already makes: one blank
    // paint beats flashing a sign-in form at somebody who is merely
    // offline.
    await rememberSessionVerified(verifiedAgo(60_000));
    server.use(NETWORK_IS_DOWN);
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(screen.queryByRole('heading', { name: /đăng nhập/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/kết nối/i)).not.toBeInTheDocument();

    await screen.findByText('Protected content');
    expect(pathnames).toEqual(['/']);
  });
});
