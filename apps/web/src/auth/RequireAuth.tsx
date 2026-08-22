import { useQuery } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { describeAuthError, serverAnswered } from '../api/client';
import { useMe } from '../api/useMe';
import { rememberSessionVerified } from '../db/local';
import { offlineSessionIsUsable } from './session';
import { sessionWasSuperseded, subscribeToSessionChanges } from './sessionIdentity';

export interface RequireAuthProps {
  children: ReactNode;
}

/**
 * Cache key for "may this device open a protected page on its own
 * authority" — the local, durable answer, read only when no HTTP response
 * arrived.
 *
 * It is a query rather than a `useState`/`useEffect` pair so that
 * `resetSessionScopedQueries` (see `api/useMe.ts`) drops it along with
 * everything else belonging to a session that ends. A hand-rolled piece of
 * component state would be invisible to that, which is the shape of bug
 * this whole area keeps producing.
 *
 * Not exported: nothing outside this file seeds or invalidates it, and
 * `resetSessionScopedQueries` drops it by predicate rather than by key.
 * Exporting a non-component from a component module also costs a react
 * fast-refresh lint warning — the same call `0a733cb` made for
 * `coursesQueryKey`.
 */
const offlineSessionQueryKey = ['offline-session'] as const;

/**
 * Route guard for pages that require a signed-in user. `/login` itself is
 * deliberately never wrapped in this (see routes.tsx) — that separation,
 * not anything in this component, is the main defense against a redirect
 * loop; see the `null` case below for the second line of defense this
 * component does own.
 *
 * The question this guard actually answers is not "is this person
 * authenticated" — a page cannot know that; the session cookie is
 * `HttpOnly` and only `GET /me` can tell it. It is "what did the server
 * say, and if it said nothing at all, what may this device do about it".
 * `useMe`'s settled shapes therefore map to FOUR renders, not three:
 *
 *  - pending: renders nothing. Rendering the login page for the split
 *    second before the first response arrives would flicker for every
 *    already-authenticated visitor, on *every* page load — worse than a
 *    blank frame, which is on screen for at most one paint (`useMe` sets
 *    `retry: false`, so pending never lasts more than one request; it
 *    does not hang forever on failure — see the error cases below).
 *  - data is a user: renders `children`, and records that this device held
 *    a confirmed session (see the effect below).
 *  - data is `null` (GET /me answered 401 — nobody logged in) →
 *    `<Navigate>` to /login, carrying `state.from` so Login can send the
 *    visitor back where they were headed. This is also the second line of
 *    defense against a loop: even if something did wrap `/login` in
 *    `<RequireAuth>` by mistake, Login's own page never *triggers* this
 *    branch (it reads the same shared `useMe` query with
 *    `redirectOn401: false`, and renders the form rather than navigating).
 *  - the query ERRORED, which is where this splits in two, because
 *    "the server answered badly" and "no server answered" are different
 *    facts and collapsing them is what made spec §2.6's offline promise
 *    half-true (task-7-report.md §5.5 measured it in a real browser: a
 *    fully cached chapter, unreadable after F5 with the network off):
 *
 *      - a response DID arrive (500, 502, 429, …) → the inline Vietnamese
 *        message, exactly as before. Redirecting would masquerade an
 *        outage as a logout and would not even help — a 500 does not fix
 *        itself by landing on /login. And a reachable, broken server is
 *        not an offline device: a bad deploy must not silently flip every
 *        reader into local-only mode.
 *      - NO response arrived (offline, DNS failure, refused connection, a
 *        blocked request) → the honest state is "unknown", not "logged
 *        out". So this asks the DEVICE: did anybody sign in here recently
 *        (`offlineSessionIsUsable`)? If yes, render `children` — every
 *        network call inside them is failing anyway, so what they can show
 *        is precisely what Task 7 already put on this machine. If no,
 *        the same inline message as before.
 *
 * **Why the optimistic branch cannot show one account's data to another,
 * which is the constraint this component is standing on** (see
 * `docs/carried-forward.md`, and `test/accountHandoff.test.tsx` for the
 * two-account proof):
 *
 *  1. The marker it consults is a `db.meta` row, so `clearLocalData()`
 *     erases it on BOTH auth transitions — sign-out via `useLogout`, and
 *     sign-in via `Login` — with no line written for it and nothing to
 *     remember. A browser that changed hands has no marker until the
 *     arriving user's own `GET /me` writes one.
 *  2. The marker holds an INSTANT and no identity. There is no name, no
 *     email, no id in it to render at anybody. What it unlocks is the rest
 *     of this browser's local database — emptied by the very same call.
 *  3. It never contradicts the server. A 401 is an answer and wins
 *     outright; the marker only ever fills a silence.
 *  4. It does not start sync. `App.tsx`'s `useSyncLifecycle` keys on
 *     `meQuery.data?.id`, which is `undefined` on this path — so nothing
 *     is pushed or pulled under a session nobody has confirmed.
 *
 * The residual case is written down rather than papered over: a browser
 * whose owner never signed out, handed to somebody else who is offline,
 * opens the owner's own cached reading for up to
 * `OFFLINE_READ_MAX_AGE_MS`. That is not an escalation — the same bytes
 * are in that profile's IndexedDB and readable with devtools either way,
 * and nothing new can be fetched — but it IS a change from the previous
 * behaviour, and the window (see `./session.ts`) is what bounds it.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const location = useLocation();
  const meQuery = useMe();
  const confirmedUserId = meQuery.data?.id ?? null;

  /**
   * Đã có tab khác đăng nhập bằng tài khoản khác chưa?
   *
   * C-1 đóng nửa **dữ liệu**: tab bị thay thế ngừng đồng bộ ngay, nên không
   * hàng nào của A tới server dưới cookie của B. Nhưng nó để lại nửa **màn
   * hình**: tab ấy vẫn hiển thị cây đã render của A cho tới khi `useMe` của
   * chính nó làm mới. Nếu A rời máy và B đăng nhập, B **nhìn thấy ghi chú và
   * tiến độ của A** — không có dữ liệu chảy đi, nhưng vẫn là phơi lộ chéo
   * tài khoản, và là thứ người dùng nhìn thấy được.
   *
   * `useSyncExternalStore` chứ không phải `useState` + `useEffect`: dự án đã
   * mất trọn một vòng vì `setState` trong thân effect rơi vào **commit sau**
   * so với thao tác mệnh lệnh, và React Scheduler chỉ nhường sau **ngân sách
   * 5 ms**. Đây đúng là bài toán mà primitive này sinh ra để giải — và nó đọc
   * cùng một sự thật mà `sessionIdentity` công bố cho đường đồng bộ, không
   * phải một bản sao thứ hai có thể lệch.
   */
  const superseded = useSyncExternalStore(
    subscribeToSessionChanges,
    sessionWasSuperseded,
    sessionWasSuperseded,
  );

  /**
   * The ONE writer of the offline marker (pinned by `session.test.ts`).
   *
   * Keyed on the confirmed user's id, so it writes when a session is first
   * confirmed on this device and not on every render. It fires only for a
   * user `GET /me` actually returned — never for `null`, never for an
   * error — so the marker cannot come to mean anything weaker than
   * "the server confirmed somebody here at this instant".
   *
   * Fire-and-forget: an unwritable database (quota, a blocked upgrade)
   * costs offline reading on the NEXT load, which is exactly the failure
   * this app had before. It is not a reason to block the render of a page
   * the server has just authorized.
   */
  useEffect(() => {
    if (confirmedUserId === null) return;
    void rememberSessionVerified();
  }, [confirmedUserId]);

  const noResponseArrived = meQuery.isError && !serverAnswered(meQuery.error);
  const offlineSession = useQuery({
    queryKey: offlineSessionQueryKey,
    queryFn: () => offlineSessionIsUsable(),
    // Only asked when it can matter: on every other path the server has
    // spoken, and what this device believes is irrelevant.
    enabled: noResponseArrived,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  // Đứng TRƯỚC mọi nhánh khác, kể cả `isPending` và nhánh ngoại tuyến lạc
  // quan: khi một tài khoản khác đã chiếm phiên trên máy này, mọi câu trả lời
  // mà tab này đang cầm đều thuộc về người trước. Không có câu hỏi nào ở dưới
  // còn nghĩa.
  if (superseded) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (meQuery.isPending) {
    return null;
  }

  if (meQuery.isError) {
    if (!noResponseArrived) {
      return <p className="ch-lede">{describeAuthError(meQuery.error)}</p>;
    }
    // Same trade as the pending branch above: one blank paint while the
    // local read settles, rather than flashing an outage message at a
    // reader who is about to get their chapter.
    if (offlineSession.isPending) {
      return null;
    }
    if (offlineSession.data === true) {
      return <>{children}</>;
    }
    return <p className="ch-lede">{describeAuthError(meQuery.error)}</p>;
  }

  if (meQuery.data == null) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

export default RequireAuth;
