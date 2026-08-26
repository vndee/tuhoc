import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMe } from '../api/useMe';

/**
 * Route guard for `/admin`. Reads the SAME `useMe()` every other guarded
 * route reads (`auth/RequireAuth.tsx`) — there is no separate "am I an
 * admin" endpoint, `role` rides on `GET /me`'s own response (Task 8).
 *
 * Deliberately simpler than `RequireAuth`, and that is a decision, not an
 * oversight. `RequireAuth` earns its extra branches from spec §2.6's
 * offline promise: a reader who is mid-chapter with the network down still
 * gets the chapter already on their device. Nothing about `/admin` has an
 * offline promise to keep — publishing a course package needs a live
 * connection to the server no matter what this guard decides — so the
 * offline/optimistic branch would only ever add a way to show the admin
 * screen to someone this device cannot currently confirm is an admin.
 * There is no local, previously-downloaded admin page to protect either.
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
