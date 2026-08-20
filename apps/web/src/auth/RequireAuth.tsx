import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { describeAuthError } from '../api/client';
import { useMe } from '../api/useMe';

export interface RequireAuthProps {
  children: ReactNode;
}

/**
 * Route guard for pages that require a signed-in user. `/login` itself is
 * deliberately never wrapped in this (see routes.tsx) — that separation,
 * not anything in this component, is the main defense against a redirect
 * loop; see the last case below for the second line of defense this
 * component does own.
 *
 * `useMe` is the only thing this reads, and its three settled shapes map
 * to three different renders:
 *
 *  - pending: renders nothing. Rendering the login page for the split
 *    second before the first response arrives would flicker for every
 *    already-authenticated visitor, on *every* page load — worse than a
 *    blank frame, which is on screen for at most one paint (`useMe` sets
 *    `retry: false`, so pending never lasts more than one request; it
 *    does not hang forever on failure — see the error case below).
 *  - data is a user: renders `children`.
 *  - data is `null` vs. the query erroring are handled *differently*, on
 *    purpose — collapsing them would make a backend outage look exactly
 *    like "you were logged out" (the same principle as `ApiError` keeping
 *    401 and 500 apart on the wire — see client.ts):
 *      - `null` (GET /me answered 401 — nobody logged in) → `<Navigate>`
 *        to /login, carrying `state.from` so Login can send the visitor
 *        back where they were headed. This is also the second line of
 *        defense against a loop: even if something did wrap `/login` in
 *        `<RequireAuth>` by mistake, Login's own page never calls
 *        `useMe` (see src/pages/Login.tsx), so nothing on that page can
 *        ever re-trigger this branch.
 *      - error (GET /me answered 500, or the network failed) → renders
 *        an inline Vietnamese message via `describeAuthError` instead of
 *        navigating anywhere. Redirecting here would silently masquerade
 *        a server outage as a normal logout, and it wouldn't even help —
 *        a 500 doesn't fix itself by landing on /login.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const location = useLocation();
  const meQuery = useMe();

  if (meQuery.isPending) {
    return null;
  }

  if (meQuery.isError) {
    return <p className="ch-lede">{describeAuthError(meQuery.error)}</p>;
  }

  if (meQuery.data == null) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

export default RequireAuth;
