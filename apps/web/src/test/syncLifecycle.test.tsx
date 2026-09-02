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
 * (`db/legacyDrain.ts`), fired once on mount — and DELIBERATELY NOT gated on
 * auth state the way `startSync()` was: the legacy outbox belongs to
 * whichever account was signed in on THIS browser under the OLD build, not
 * to whoever GET /me currently answers, and `POST /sync` (inside the drain)
 * carries whatever session cookie is currently valid at the moment it
 * fires — including none. A logged-out visitor still needs the drain to run
 * (their browser may hold the old outbox from before they signed out), so
 * this file's replacement tests pin the OPPOSITE of what the old ones did:
 * the drain fires regardless of `GET /me`'s answer.
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

  // The sharp edge this file exists to pin: unlike the old `startSync()`,
  // the drain is NOT gated on `GET /me`. A browser that ran the old build,
  // then signed out (or whose 30-day cookie simply expired) before this
  // build ever loaded, still needs its outbox flushed — `POST /sync` inside
  // the drain sends under whatever cookie is currently valid, which may be
  // none, and the drain's own retry-next-load behaviour (see
  // `legacyDrain.test.ts`) covers a currently-unauthenticated attempt that
  // cannot reach an account at all.
  it('drains the legacy local database once on mount, EVEN for a logged-out visitor', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const legacyDrain = await import('../db/legacyDrain');
    const drainSpy = vi.spyOn(legacyDrain, 'drainLegacyDataOnce').mockResolvedValue(undefined);
    const { default: App } = await import('../App');

    render(<App />);

    // `.auth-page` — same witness `Login.test.tsx` cites this file for
    // (`giữ nguyên lớp .auth-page mà syncLifecycle.test.tsx bám vào`):
    // proof the app actually settled on the sign-in screen, not merely that
    // some render happened.
    await waitFor(() => expect(document.querySelector('.auth-page')).toBeInTheDocument());
    expect(drainSpy).toHaveBeenCalledTimes(1);
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

    await waitFor(() => expect(document.querySelector('.auth-page')).toBeInTheDocument());
    expect(startFlusherSpy).not.toHaveBeenCalled();
  }, OVERSUBSCRIBED_MS);
});
