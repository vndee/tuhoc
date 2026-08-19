import { useQuery } from '@tanstack/react-query';
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
  return useQuery({
    queryKey: meQueryKey,
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });
}
