import { hashKey, useQuery, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { announceSessionUser } from '../auth/sessionIdentity';
import { api, ApiError } from './client';

/** Shape returned by GET /me — see apps/api/internal/auth/handler.go's meResponse (id/email/name only, never a password hash). */
export interface Me {
  id: string;
  email: string;
  name: string;
}

/**
 * Shared TanStack Query cache key for the current session's user. Exported
 * so `Login` can seed this exact entry with `queryClient.setQueryData` the
 * instant login/register succeeds — see src/pages/Login.tsx — rather than
 * invalidating and waiting on a refetch, which would leave `<RequireAuth>`
 * briefly back in its "pending" state right after a successful login.
 */
export const meQueryKey = ['me'] as const;

/**
 * Drops every cached query belonging to the session that is ending —
 * `['stats']`, course/progress entries, everything — EXCEPT `me` itself.
 * Call it on BOTH auth transitions (src/pages/Login.tsx on the way in,
 * src/auth/useLogout.ts on the way out), immediately before seeding `me`
 * with the new value.
 *
 * Why it exists at all: nothing ever reset this cache. Overwriting
 * `meQueryKey` alone left the dashboard's `['stats']` entry — the previous
 * user's streak, total minutes and 30-day chart — sitting in memory, to be
 * rendered to the NEXT user while a refetch was in flight, or indefinitely
 * if that refetch failed.
 *
 * Why it is not simply `queryClient.clear()`: `clear()` removes the `me`
 * query object too, and a `QueryObserver` only re-points at a
 * newly-built query when its component next renders
 * (`QueryObserver.setOptions` → `#updateQuery`, see @tanstack/query-core).
 * `App.tsx`'s `useSyncLifecycle` holds exactly such an app-wide, always-
 * mounted `useMe()` observer, and it is what starts the sync engine. Under
 * `clear()` that observer is orphaned — pointing at a destroyed query —
 * until something unrelated happens to re-render `AppShell`. It does
 * happen to re-render today (`useMobileNav` reads `useLocation`, and both
 * transitions navigate), but "sync starts after login because a drawer
 * hook subscribes to the router" is an accident, not a guarantee: it would
 * disappear silently the day that hook changed. Sparing `me` — which the
 * caller overwrites on the very next line anyway — removes the accident.
 */
export function resetSessionScopedQueries(queryClient: QueryClient): void {
  const meHash = hashKey(meQueryKey);
  queryClient.removeQueries({ predicate: (query) => query.queryHash !== meHash });
}

async function fetchMe(): Promise<Me | null> {
  try {
    // redirectOn401: false — see RequestOptions' doc comment in
    // ./client.ts. A 401 here just means "nobody is logged in," which is
    // this hook's entire reason to exist (the session cookie is HttpOnly,
    // so calling GET /me is the *only* way to learn whether anyone is
    // signed in) — it is not a session dying mid-use, and must not be
    // treated like one, or /login's own page load would 401 and redirect
    // to /login again.
    return await api.get<Me>('/me', { redirectOn401: false });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    // Anything else (500, network failure) is a real failure to surface
    // as `isError`, not as "logged out" — see ApiError's own doc comment.
    throw error;
  }
}

/**
 * The single source of truth for "who (if anyone) is logged in," backed by
 * GET /me. Resolves to the user, or `null` for a logged-out visitor —
 * `null` is data, not an error, so `.isPending`/`.isError` stay reserved
 * for "still asking" and "the server couldn't answer" (e.g. a 500), which
 * `<RequireAuth>` needs to tell apart from "definitely logged out" (see
 * src/auth/RequireAuth.tsx).
 */
export function useMe() {
  const query = useQuery({
    queryKey: meQueryKey,
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });

  // Debt C-1: this query's answer, told to every other tab of this origin —
  // see `src/auth/sessionIdentity.ts` for the leak it closes.
  //
  // **This is the ONE place identity is announced from, and it is here rather
  // than inside `fetchMe` for a measured reason.** Announcing from the query
  // function as well was tried and is the better-looking option — a promise
  // resolving is ordered by data flow rather than by React's commit order.
  // But it covers a strict subset of what this covers, and having both made
  // each one individually unkillable: mutants deleting either announcement
  // alone left `sync/crossTabSession.test.tsx` fully green, because the other
  // was still establishing the same fact. Two writers of one truth, neither
  // of which any test can hold responsible, is the shape this codebase has
  // already been bitten by (`icTZOffset`, `clearLocalData`'s eight copies).
  //
  // What the query function could not have covered on its own: both auth
  // transitions SEED this cache rather than refetch it — `src/pages/Login.tsx`
  // with the user `POST /auth/login` just returned, `src/auth/useLogout.ts`
  // with `null` — so on the one tab that performs a transition no `GET /me`
  // runs at all. The ordering the query function would have bought is not
  // needed either: `App.tsx`'s `useSyncLifecycle` calls `useMe()` and then
  // declares its own effect, and React runs a component's effects in
  // declaration order, so this announcement always lands before that
  // `startSync()`. `crossTabSession.test.tsx`'s positive control drives that
  // exact path through the real `<App/>`.
  //
  // `isSuccess`, not `data != null`: `null` is this query's ordinary answer
  // for a logged-out visitor and is worth announcing, while `isError` (a
  // 500, a dead network) means "unknown" — announcing anything there would
  // be this tab inventing a fact about the browser out of a failure.
  const settledUser = query.isSuccess ? (query.data?.id ?? null) : undefined;
  useEffect(() => {
    if (settledUser === undefined) return;
    announceSessionUser(settledUser);
  }, [settledUser]);

  return query;
}
