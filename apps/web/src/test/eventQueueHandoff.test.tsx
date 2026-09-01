/**
 * One browser, two accounts — the in-memory study-event queue
 * (`api/events.ts`) must not survive the handover either.
 *
 * Task 8 (Pha 3) built `api/events.ts`'s in-memory queue without ever
 * telling `auth/session.ts`'s `clearSession()` — the established single
 * truth point for "this browser now belongs to somebody else" (ruling
 * P2-F18) — that the queue existed. A heartbeat A queued in the last
 * <90s before the next flush survived `useLogout()` completely untouched:
 * nothing in the departing account's logout path reset it, and the very
 * next `startEventFlusher()` tick under B's freshly-signed-in session
 * would POST it to `/events/batch` under B's cookie. The server has no
 * per-row ownership check of its own — `apps/api/internal/stats/handler.go`'s
 * `EventsBatch` writes every row with `auth.UID(c)`, the SESSION's account
 * — so this would silently attribute A's study minutes to B.
 *
 * Same failure CLASS `test/accountHandoff.test.tsx` already documents at
 * length for the note draft (`db/local.ts:263-272`, `useLogout.ts:156-176`):
 * a store the truth point had never heard of. This file mirrors that
 * file's shape — real `useLogout()`, real `<Login>`, MemoryRouter's two
 * routes — rather than unit-testing `resetEventQueue()` in isolation,
 * because the defect only shows up where "a session ends" and "the next
 * one starts posting" actually meet.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { flushEvents, queueEvent, startEventFlusher, type StudyEvent } from '../api/events';
import { useMe } from '../api/useMe';
import { useLogout } from '../auth/useLogout';
import { clearLocalData } from '../db/local';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { Login } from '../pages/Login';
import { ThemeProvider } from '../theme/ThemeContext';

const A = { id: 'u-a', email: 'a@example.com', name: 'A' };
const B = { id: 'u-b', email: 'b@example.com', name: 'B' };

/** A's stray heartbeat — distinctive `courseId` so any leak into B's batch is unmistakable. */
function aStrayHeartbeat(): StudyEvent {
  return { courseId: 'course-belongs-to-a', chapterId: 'ch1', kind: 'heartbeat', meta: {}, at: '2026-09-01T00:00:00.000Z' };
}

function LogoutButton() {
  const logout = useLogout();
  return (
    <button
      type="button"
      onClick={() => {
        void logout();
      }}
    >
      Đăng xuất
    </button>
  );
}

/**
 * Stands in for `App.tsx`'s `useSyncLifecycle`, narrowed to the one piece
 * this file is about: the real `startEventFlusher()`, gated on the real
 * `useMe()`, torn down the same way. Every function called here is the
 * real, production one (`useMe`, `startEventFlusher`) — only the
 * surrounding page tree is a stand-in, the same choice
 * `test/accountHandoff.test.tsx` makes for `useAnnotations` (a fake
 * `Reader` component, but the real hook).
 */
function EventFlusherLifecycle() {
  const meQuery = useMe();
  const userId = meQuery.data?.id ?? null;
  useEffect(() => {
    if (userId === null) return undefined;
    return startEventFlusher();
  }, [userId]);
  return null;
}

function Browser({ at = '/' }: { at?: string }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageProvider>
          <MemoryRouter initialEntries={[at]}>
            <EventFlusherLifecycle />
            <Routes>
              <Route path="/" element={<LogoutButton />} />
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** Every `/events/batch` request this "server" ever received, tagged with
 * whichever account was actually current AT THE MOMENT the request
 * resolved — tied to `POST /auth/login`'s own response resolving, the same
 * timing model `test/accountHandoff.test.tsx`'s `rowOwners`/
 * `currentAccountId` use, and for the identical reason: a real backend
 * scopes a request to whichever session cookie it carries, not to
 * whenever the TEST happened to call a helper. */
let currentAccountId = 'u-a';
let batches: { accountId: string; events: StudyEvent[] }[];

const server = setupServer(
  http.get('/me', () => HttpResponse.json(A)),
  // `useLogout`'s real `bestEffortFinalFlush()` touches these two.
  http.post('/sync', () => HttpResponse.json({ applied: 0 })),
  http.get('/sync', () => HttpResponse.json({ progress: [], annotations: [], cursor: '' })),
  http.post('/auth/logout', () => new HttpResponse(null, { status: 200 })),
  http.post('/auth/login', () => {
    currentAccountId = 'u-b';
    return HttpResponse.json(B);
  }),
  // FAILS while A is still the current account, SUCCEEDS once B is —
  // deliberately, not incidentally. This is what makes the test actually
  // exercise `resetEventQueue()` (the unconditional half of the fix) and
  // not merely the pre-logout `flushEvents()` attempt (the best-effort
  // half, which has its own dedicated ordering test in
  // `auth/useLogout.test.tsx`): if the pre-logout flush always succeeded
  // in this test, A's event would already be gone from the queue by the
  // time `clearSession()` ran, and removing `resetEventQueue()` would not
  // turn this test red — exactly the "decorative test" failure mode Task
  // 8's own brief warned about, caught here by a mutation run (see the
  // fix report). Modelling a real network blip right as A logs out, which
  // has cleared up by the time B is signed in and the flusher ticks, is
  // also the literal case the reviewer's fix design names: "clear the
  // queue unconditionally, whether or not that flush succeeded."
  http.post('/events/batch', async ({ request }) => {
    if (currentAccountId === 'u-a') return HttpResponse.error();
    const body = (await request.json()) as { events: StudyEvent[] };
    batches.push({ accountId: currentAccountId, events: body.events });
    return HttpResponse.json({ accepted: body.events.length });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(async () => {
  await clearLocalData();
  currentAccountId = 'u-a';
  batches = [];
});

afterEach(async () => {
  await clearLocalData();
});

/** B fills in the real sign-in form and submits it — same helper shape as `test/accountHandoff.test.tsx`'s `bSignsIn`. */
async function bSignsIn(): Promise<void> {
  const user = userEvent.setup();
  await screen.findByLabelText(/email/i);
  await user.type(screen.getByLabelText(/email/i), B.email);
  await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
  await user.click(screen.getByRole('button', { name: /đăng nhập/i }));
}

describe('one browser, two accounts — the study-event queue must not survive the handover', () => {
  it('A’s heartbeat fails to flush while logging out (a network blip); after B signs in, it never reaches /events/batch under B’s session', async () => {
    queueEvent(aStrayHeartbeat());

    render(<Browser />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument(), { timeout: 10_000 });

    // Sanity check on the mock itself, not on the fix: `/events/batch`
    // above is wired to fail for as long as `currentAccountId` is still
    // 'u-a' — confirming NO batch landed under A proves that failure
    // actually happened, rather than the pre-logout `flushEvents()` call
    // quietly having already carried A's event away (which would make the
    // rest of this test pass for the wrong reason — see the mock's own
    // comment on why this scenario is deliberately the FAILED-flush one).
    expect(batches.some((b) => b.accountId === 'u-a')).toBe(false);

    await bSignsIn();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument());

    // "Let the flusher run": `EventFlusherLifecycle` above has already
    // started the REAL `startEventFlusher()` under B's now-current
    // `useMe()` — its interval calls exactly this function
    // (`api/events.ts`'s own `startEventFlusher`: `setInterval(() => {
    // void flushEvents(); }, FLUSH_INTERVAL_MS)`), so invoking it directly
    // is a deterministic stand-in for "wait for the next tick" rather than
    // a real 90s wall-clock wait, the same simulation this codebase's own
    // `heartbeat.test.ts`/`events.test.ts` use for their own interval
    // ticks. `/events/batch` now succeeds (B is current) — if
    // `resetEventQueue()` had not already emptied the queue during
    // `clearSession()`, A's stray heartbeat would go out HERE, under B.
    await flushEvents();

    const underB = batches.filter((b) => b.accountId === 'u-b');
    expect(underB).toEqual([]);
  }, 20_000);
});
