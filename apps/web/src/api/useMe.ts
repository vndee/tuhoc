import { hashKey, useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { announceSessionUser, sessionWasSuperseded, subscribeToSessionChanges } from '../auth/sessionIdentity';
import { api, ApiError } from './client';

/**
 * Shape returned by GET /me — see apps/api/internal/auth/handler.go's
 * meResponse (id/email/name/role only, never a password hash).
 *
 * `role` is Task 8/15's addition (`"user"` or `"admin"` on the wire today,
 * per `meResponse`'s own doc comment) and it is the ONLY thing
 * `admin/AdminGuard.tsx` trusts to decide who may reach `/admin` — never a
 * client-side guess. Declared OPTIONAL rather than required on purpose: a
 * bunch of this file's own tests (and several other suites —
 * `pages/Settings.test.tsx` in particular) construct a `Me` literal by hand
 * with no `role` at all, predating Task 15, and a required field would make
 * every one of them a compile error for a field they have no reason to
 * care about. Optional also happens to be the SAFE shape for a guard that
 * must fail closed: `data?.role !== 'admin'` reads `undefined` exactly like
 * any other non-admin value.
 */
export interface Me {
  id: string;
  email: string;
  name: string;
  role?: string;
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
 * mounted `useMe()` observer, and it is what starts the study-event
 * flusher (`startEventFlusher()` — the background sync engine this
 * comment used to also name here was deleted by Task 10; see that hook's
 * own doc comment). Under `clear()` that observer is orphaned — pointing
 * at a destroyed query — until something unrelated happens to re-render
 * `AppShell`. It does happen to re-render today (`useMobileNav` reads
 * `useLocation`, and both transitions navigate), but "the flusher starts
 * after login because a drawer hook subscribes to the router" is an
 * accident, not a guarantee: it would disappear silently the day that hook
 * changed. Sparing `me` — which the caller overwrites on the very next
 * line anyway — removes the accident.
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
 * The result shape `useMe` reports while another tab holds this browser's
 * session — see `useMe`'s own doc comment, "the superseded answer".
 *
 * Built by overriding a REAL query result rather than by inventing one from
 * nothing: everything a caller might read that is not about the answer
 * (`refetch`, `isFetching`, `dataUpdatedAt`, …) stays exactly what TanStack
 * says it is, and only the four fields that carry the ANSWER are replaced.
 *
 * The cast is unavoidable and is the narrowest one available:
 * `UseQueryResult` is a discriminated union over `status`, so an object
 * literal spreading one member and overriding fields of another cannot be
 * checked structurally. The overrides below are exactly the success
 * member's own invariants (`status: 'success'` ⇒ `isSuccess`, not pending,
 * not error, `error: null`), written out rather than assumed.
 */
function nobodyResult(query: UseQueryResult<Me | null, Error>): UseQueryResult<Me | null, Error> {
  return {
    ...query,
    data: null,
    error: null,
    status: 'success',
    isSuccess: true,
    isPending: false,
    isLoading: false,
    isError: false,
    isLoadingError: false,
    isRefetchError: false,
  } as UseQueryResult<Me | null, Error>;
}

/**
 * The single source of truth for "who (if anyone) is logged in," backed by
 * GET /me. Resolves to the user, or `null` for a logged-out visitor —
 * `null` is data, not an error, so `.isPending`/`.isError` stay reserved
 * for "still asking" and "the server couldn't answer" (e.g. a 500), which
 * `<RequireAuth>` needs to tell apart from "definitely logged out" (see
 * src/auth/RequireAuth.tsx).
 *
 * ## The superseded answer — one place asks whose session this is
 *
 * When another tab has replaced this browser's session
 * (`auth/sessionIdentity.ts`), this hook reports **nobody**: settled,
 * `data: null`, exactly the shape a logged-out visitor gets.
 *
 * It is here, and not in each caller, because of what the final
 * whole-branch review's step-5 search found. Three writers had already been
 * patched one at a time — the deleted sync engine's `runCycle`,
 * `api/events.ts`'s flusher, `db/legacyDrain.ts`'s drain — and the fourth
 * was `reader/ChapterView.tsx`'s `AuthedReaderExtras`, which hosts
 * `useAnnotations` (POST/PATCH/DELETE /annotations) and `useProgress`
 * (PUT /progress) and is mounted on the PUBLIC reader route, outside
 * `<RequireAuth>`, on nothing but `me.isSuccess && me.data != null`. A note
 * A typed and saved after a handoff was INSERTed into B's account. Patching
 * a fourth call site would have been accepting a fifth.
 *
 * Every gate in this app already derives from this one query — `RequireAuth`,
 * `AdminGuard`, `ChapterView`/`CourseHome`/`Sidebar`'s `confirmedLoggedIn`,
 * `App.tsx`'s flusher and legacy-drain lifecycles, `TopNav`, `Settings`,
 * `Login` — so answering the question ONCE, here, is what makes them all
 * inherit it instead of each re-deriving it. That is `runCycle`'s shape
 * restored: one place asks *whose session is this* and everything
 * downstream is told.
 *
 * **It is not a lockout, and that distinction is load-bearing — with one
 * open exception, measured and tracked as debt rather than assumed away**
 * (`docs/carried-forward.md`, Pha 3, "Mặt nạ `superseded` DÍNH khi trình
 * duyệt quay lại ĐÚNG người cũ"). `superseded` is one-way only until this
 * tab establishes an identity FIRST-HAND (`announceSessionUser`, below)
 * that DIFFERS from what it already believed. That is exactly what happens
 * the moment its own `GET /me` answers with a DIFFERENT user — refocus the
 * tab, or sign in on it as somebody else, and it is an ordinary signed-in
 * tab again with no special case anywhere. It is NOT what happens when
 * `GET /me` answers with the SAME user this tab already believed in (the
 * browser can reach that state without this tab's belief ever changing —
 * e.g. that account signing out and back in from another tab while this
 * one sat in the background): `announceSessionUser` early-returns on
 * `localUser === user` before touching `superseded`, and — because
 * `settledUser` below has not changed either, across the whole detour —
 * the announce effect does not even run again to try. Measured: this hook
 * keeps reporting `nobody` after such a round trip until the tab reloads
 * or the visitor establishes a DIFFERENT identity by hand. The arriving
 * learner is never trapped by a DIFFERENT identity, though: the tab
 * performing an auth transition never marks ITSELF superseded
 * (`BroadcastChannel` does not echo a tab's own message), so `<Login>` and
 * `useLogout` are untouched by this.
 *
 * **What it deliberately does NOT do.** It does not clear the cached `me`
 * entry, and it does not refetch. The cache still holds whatever the last
 * `GET /me` said; only the ANSWER this hook reports is masked. Clearing
 * would be this tab performing half a `clearSession()` it has no business
 * performing — `clearSession()` belongs to the tab where the transition
 * actually happened, and the masked answer is what makes it unnecessary
 * here.
 *
 * `useSyncExternalStore`, not `useState` + `useEffect`: the same choice
 * `<RequireAuth>` makes and for the reason written there — a `setState`
 * inside an effect body lands a commit LATER than the imperative fact, and
 * this fact gates network writes.
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
  // alone left the old cross-tab race test fully green (Task 10 deleted that
  // file, `sync/crossTabSession.test.tsx`, along with the sync engine it was
  // built to race against — see that task's report), because the other was
  // still establishing the same fact. Two writers of one truth, neither of
  // which any test can hold responsible, is the shape this codebase has
  // already been bitten by (`icTZOffset`, `clearLocalData`'s eight copies).
  //
  // What the query function could not have covered on its own: both auth
  // transitions SEED this cache rather than refetch it — `src/pages/Login.tsx`
  // with the user `POST /auth/login` just returned, `src/auth/useLogout.ts`
  // with `null` — so on the one tab that performs a transition no `GET /me`
  // runs at all. The ordering the query function would have bought
  // (announcing before `App.tsx`'s `useSyncLifecycle` calls `startEventFlusher`
  // in its own, later-declared effect — React runs a component's effects in
  // declaration order) is a smaller stake post-Task-10 than it used to be:
  // the sync engine this used to also race (`startSync()`) is gone, and the
  // event flusher does not read this announcement at all. What remains load-
  // bearing is `sessionWasSuperseded()` (`auth/sessionIdentity.ts`), read by
  // `<RequireAuth>` and (pre-Task-10) the sync engine's own guard — see
  // `test/accountHandoff.test.tsx` for the current end-to-end proof.
  //
  // `isSuccess`, not `data != null`: `null` is this query's ordinary answer
  // for a logged-out visitor and is worth announcing, while `isError` (a
  // 500, a dead network) means "unknown" — announcing anything there would
  // be this tab inventing a fact about the browser out of a failure.
  //
  // Read from the RAW query, deliberately, and computed BEFORE the mask
  // below is applied. Announcing from the masked answer would be this tab
  // telling every other tab that the browser belongs to nobody — which
  // would clear its own `superseded` flag (see `announceSessionUser`), and
  // the guard would erase itself one render after it engaged.
  const settledUser = query.isSuccess ? (query.data?.id ?? null) : undefined;
  useEffect(() => {
    if (settledUser === undefined) return;
    announceSessionUser(settledUser);
  }, [settledUser]);

  const superseded = useSyncExternalStore(
    subscribeToSessionChanges,
    sessionWasSuperseded,
    sessionWasSuperseded,
  );

  return superseded ? nobodyResult(query) : query;
}

/**
 * Hai chữ cái đại diện cho một tài khoản.
 *
 * Ở đây, cạnh chính hình dạng `Me`, chứ không ở component đầu tiên cần nó: đĩa
 * tròn trên thanh trên (`shell/TopNav.tsx`) và thẻ danh tính ở trang Cài đặt
 * (`pages/Settings.tsx`) phải hiện ĐÚNG hai chữ giống nhau — nếu không thì với
 * người dùng chúng là hai tài khoản khác nhau.
 *
 * Lấy tên trước, email sau: một tài khoản chưa đặt tên vẫn phải ra được hai
 * chữ, và `name` rỗng là trạng thái có thật (`POST /auth/register` nhận tên,
 * nhưng dữ liệu cũ có thể không có).
 */
export function accountInitials(name: string, email: string): string {
  return (name || email).slice(0, 2).toUpperCase();
}
