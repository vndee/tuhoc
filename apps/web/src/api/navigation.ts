/**
 * Hard browser navigation to /login. This is the api client's fallback for
 * a 401 discovered outside any React component — a `queryFn`/`mutationFn`
 * (Task 13's sync engine, Task 15's heartbeat) has no react-router
 * `navigate()` to call, so this reaches for `window.location` directly.
 * A full navigation is also the right choice on its own merits: a 401
 * here means the previous session is gone, and everything scoped to it
 * (TanStack Query cache, in-memory React state) should not survive into
 * whatever comes next — a full reload guarantees that; a client-side
 * navigation would not.
 *
 * Kept in its own module (rather than inlined in client.ts) purely so
 * tests can mock this one side-effecting call
 * (`vi.mock('./navigation')`) — jsdom does not implement real navigation,
 * so asserting on `window.location` directly is not viable.
 *
 * Carries the current location as a `from` query param so Login can send
 * the visitor back after they sign in again. This is the api client's own
 * (weaker) version of what `<RequireAuth>` gets for free from
 * react-router's `state` — see src/auth/RequireAuth.tsx — reproduced here
 * because a hard navigation cannot carry router state.
 *
 * Guards against redirecting again when already on /login: nothing in
 * this codebase currently calls a 401-redirecting request from the login
 * page (see client.ts's `redirectOn401` option, which useMe and the
 * login/register calls opt out of), but this is a deliberate second line
 * of defense against ever looping there.
 */
export function redirectToLogin(): void {
  const here = window.location.pathname + window.location.search;
  if (window.location.pathname.startsWith('/login')) {
    return;
  }
  window.location.href = `/login?from=${encodeURIComponent(here)}`;
}
