import { render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Task 10 rewrite: this file used to prove `App.tsx`'s `useSyncLifecycle`
 * wiring for `sync/engine.ts`'s `startSync()`/`stopSync()` — started once
 * authenticated, never started for a logged-out visitor, stopped on
 * unmount. `sync/engine.ts` is deleted by Task 10 (the Dexie removal); there
 * is no more background sync loop for anything here to start or stop.
 *
 * What replaced it in `App.tsx` is `drainLegacyDataOnce()`
 * (`db/legacyDrain.ts`), and this file's tests for it were REVERSED by the
 * final whole-branch review's Critical 2.
 *
 * They used to pin the drain firing for a logged-out visitor, and said why:
 * *the legacy outbox belongs to whichever account was signed in on THIS
 * browser under the OLD build, not to whoever `GET /me` currently answers*.
 * Every clause of that is true; the conclusion drawn from it was not. The
 * outbox does not travel with a name, and the very next sentence of the old
 * comment — *`POST /sync` carries whatever session cookie is currently
 * valid at the moment it fires* — is the leak stated out loud:
 * `apps/api/internal/sync/handler.go` files every row it receives under
 * `auth.UID(c)`. "Flush it for whoever wrote it" and "flush it under
 * whoever is signed in" are the same line of code, and only the second is
 * what it does. So B signing in on A's browser meant A's private, never-
 * sent notes were INSERTed into B's account on B's next page load.
 *
 * These tests now pin the opposite of what they pinned before: a settled,
 * SIGNED-IN `useMe` is a precondition of the drain running at all. The
 * account-handoff proof that this is not merely a preference lives in
 * `test/legacyDrainHandoff.test.tsx`; what stays here is the `<App/>`-level
 * "the real wiring does this" half.
 *
 * The event flusher's real wiring (`startEventFlusher()`, still gated on
 * auth, unchanged by this task) keeps ONE test here proving the REAL
 * `<App/>` wires it — `test/eventQueueHandoff.test.tsx` already covers the
 * same behaviour through a local stand-in component, not through `<App/>`
 * itself; this is the complementary "the door is actually used" proof.
 */
const emptyStats = { totalMinutes: 0, streakDays: 0, days: [], courses: [] };

/**
 * See this file's own git history (pre-Task-10) for the full measurement
 * this budget is based on: real `<App/>` mounts cost seconds under an
 * oversubscribed CI runner because of Vite's cold module transform, not
 * because anything here is slow to settle. Kept unchanged by Task 10 — the
 * `<App/>` module graph this pays for is still large (routes, shell,
 * providers), even with `sync/engine.ts` gone.
 */
const OVERSUBSCRIBED_MS = 30_000;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

/** Pay for the cold transform+evaluate of the `../App` module graph ONCE — see this file's own header for why. */
beforeAll(async () => {
  await import('../db/legacyDrain');
  await import('../App');
}, OVERSUBSCRIBED_MS);

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.resetModules();
});

describe('App startup wiring (App.tsx)', () => {
  it('drains the legacy local database once on mount, for a SIGNED-IN visitor', async () => {
    server.use(
      http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@b.com', name: 'A' })),
      http.get('/stats', () => HttpResponse.json(emptyStats)),
    );
    const legacyDrain = await import('../db/legacyDrain');
    const drainSpy = vi.spyOn(legacyDrain, 'drainLegacyDataOnce').mockResolvedValue(undefined);
    const { default: App } = await import('../App');

    render(<App />);

    await waitFor(() => expect(drainSpy).toHaveBeenCalledTimes(1));
  }, OVERSUBSCRIBED_MS);

  // The sharp edge this file exists to pin, and the one the review turned
  // around: the drain is gated on `GET /me` exactly the way `startSync()`
  // was, because a request with no account behind it is not a request with
  // no OWNER behind it — it is a request the server will file under
  // whichever cookie happens to be valid. A browser holding an old outbox
  // and no session keeps it: the outbox stays on disk, and the one page
  // load that may send it is one where its own account is signed in (or,
  // failing that, `clearSession()` deletes it at the next sign-in — see
  // `db/legacyDrain.ts`'s `clearLegacyLocalData`).
  it('does NOT drain the legacy local database for a logged-out visitor', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const legacyDrain = await import('../db/legacyDrain');
    const drainSpy = vi.spyOn(legacyDrain, 'drainLegacyDataOnce').mockResolvedValue(undefined);
    const { default: App } = await import('../App');

    render(<App />);

    // `.board-room` — from 02/09/2026 a logged-out visitor at `/` sees the
    // landing page (`pages/HomeGate.tsx`), no longer a redirect to `/login`,
    // and from 03/09 that page is the blackboard world whose root class this
    // is (`pages/Landing.tsx`, pinned by `pages/Landing.test.tsx`). It is the
    // witness that startup actually settled on a rendered landing for somebody
    // the app does not know, not merely that some render happened.
    await waitFor(() => expect(document.querySelector('.board-room')).toBeInTheDocument());
    expect(drainSpy).not.toHaveBeenCalled();
  }, OVERSUBSCRIBED_MS);

  it('starts the event flusher once GET /me resolves to a signed-in user, and stops it on unmount', async () => {
    server.use(
      http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@b.com', name: 'A' })),
      http.get('/stats', () => HttpResponse.json(emptyStats)),
    );
    const legacyDrain = await import('../db/legacyDrain');
    vi.spyOn(legacyDrain, 'drainLegacyDataOnce').mockResolvedValue(undefined);
    const events = await import('../api/events');
    const stopFlusher = vi.fn();
    const startFlusherSpy = vi.spyOn(events, 'startEventFlusher').mockReturnValue(stopFlusher);
    const { default: App } = await import('../App');

    const { unmount } = render(<App />);

    await waitFor(() => expect(startFlusherSpy).toHaveBeenCalled());

    unmount();
    expect(stopFlusher).toHaveBeenCalled();
  }, OVERSUBSCRIBED_MS);

  it('does NOT start the event flusher for a logged-out visitor (GET /me answers 401)', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const legacyDrain = await import('../db/legacyDrain');
    vi.spyOn(legacyDrain, 'drainLegacyDataOnce').mockResolvedValue(undefined);
    const events = await import('../api/events');
    const startFlusherSpy = vi.spyOn(events, 'startEventFlusher');
    const { default: App } = await import('../App');

    render(<App />);

    await waitFor(() => expect(document.querySelector('.board-room')).toBeInTheDocument());
    expect(startFlusherSpy).not.toHaveBeenCalled();
  }, OVERSUBSCRIBED_MS);
});
