import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMe } from '../api/useMe';

/**
 * Route guard for `/admin`. Reads the SAME `useMe()` every other guarded
 * route reads (`auth/RequireAuth.tsx`) — there is no separate "am I an
 * admin" endpoint, `role` rides on `GET /me`'s own response (Task 8).
 *
 * Deliberately simpler than `RequireAuth`, and that is a decision, not an
 * oversight. **Task 11 (Pha 3) removed the offline promise this comment
 * used to cite here** — `RequireAuth`'s old optimistic-offline branch
 * (spec §2.6, pre-server-side-pivot) is gone; see `RequireAuth.tsx`'s own
 * doc comment for what replaced it. `RequireAuth` still earns two branches
 * this guard does not need, for reasons that have nothing to do with
 * offline reading any more: it tells "the server answered with an error"
 * apart from "no response arrived at all" (`auth.needsNetwork`), and it
 * keeps an already-rendered, already-authorized page on screen through a
 * transient `/me` blip (`authorizedOnce`) rather than tearing the reader's
 * chapter down mid-read. Nothing about `/admin` needs either: publishing a
 * course package needs a live connection to the server no matter what this
 * guard decides, and there is no already-open admin screen worth protecting
 * through a network blip the way a reader's open chapter is — so collapsing
 * every non-confirmed-admin state (pending aside) into one `<Navigate>`
 * loses nothing this screen was ever promising to keep.
 *
 * Three renders, matching `useMe`'s three settled shapes — and this is the
 * one place a two-way collapse is a NAMED bug, not a hypothetical one (see
 * this task's own brief): reading "pending" as "not admin yet" would flash
 * `<Navigate>` at every already-admin visitor on every single page load,
 * for the one request `useMe` needs to answer.
 *
 *  - **pending** (`meQuery.isPending`): renders `null`. Not a redirect, not
 *    an "access denied" — there is nothing here to redirect FROM yet, `/me`
 *    has not answered.
 *  - **confirmed admin** (`meQuery.data?.role === 'admin'`): renders
 *    `children`.
 *  - **everything else**: `<Navigate to="/" replace>`. This is where a
 *    confirmed non-admin, a confirmed logged-out visitor (`data === null`,
 *    a 401), AND an ERRORED query (a 500, a dead network) all land on the
 *    same branch — a deliberate FAIL-CLOSED choice. `RequireAuth` gives an
 *    errored query its own inline message and an offline exception;
 *    `/admin` gives it nothing but the door out, because "the server could
 *    not confirm you are an admin" and "the server confirmed you are not"
 *    must not be treated differently by a gate whose entire job is keeping
 *    non-admins out.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
  const meQuery = useMe();

  if (meQuery.isPending) {
    return null;
  }

  if (meQuery.data?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default AdminGuard;
