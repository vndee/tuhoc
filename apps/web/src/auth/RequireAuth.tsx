import { useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { describeAuthError, serverAnswered } from '../api/client';
import { useMe } from '../api/useMe';
import { sessionWasSuperseded, subscribeToSessionChanges } from './sessionIdentity';
import { useLanguage } from '../i18n/LanguageProvider';

export interface RequireAuthProps {
  children: ReactNode;
}

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
 *  - data is a user: renders `children`.
 *  - data is `null` (GET /me answered 401 — nobody logged in) →
 *    `<Navigate>` to /login, carrying `state.from` so Login can send the
 *    visitor back where they were headed. This is also the second line of
 *    defense against a loop: even if something did wrap `/login` in
 *    `<RequireAuth>` by mistake, Login's own page never *triggers* this
 *    branch (it reads the same shared `useMe` query with
 *    `redirectOn401: false`, and renders the form rather than navigating).
 *  - the query ERRORED, which is where this splits in two, because
 *    "the server answered badly" and "no server answered" are different
 *    facts:
 *
 *      - a response DID arrive (500, 502, 429, …) → the inline Vietnamese
 *        message, exactly as before. Redirecting would masquerade an
 *        outage as a logout and would not even help — a 500 does not fix
 *        itself by landing on /login. And a reachable, broken server is
 *        not an offline device: a bad deploy must not silently flip every
 *        reader into local-only mode.
 *      - NO response arrived (offline, DNS failure, refused connection, a
 *        blocked request) → a dedicated needs-network message
 *        (`auth.needsNetwork`), unconditionally — see `authorizedOnce`
 *        below for the ONE exception this makes, which is not a
 *        reincarnation of the offline branch this task removed.
 *
 * **Task 11 (Pha 3) removed the optimistic offline branch this guard used
 * to have here** — `offlineSessionIsUsable`, the `sessionVerifiedAt`
 * `localStorage` marker it read, and the effect that wrote it. That branch
 * let a device with a recent-enough marker render `children` on a COLD page
 * load even when no response ever arrived, on the theory that whatever was
 * already cached locally (Task 7's pinned chapters, at the time) was still
 * worth showing. The premise measurably stopped being true earlier in this
 * same phase: Task 9 moved Dashboard's and Progress's own reads off local
 * storage onto the server (see those pages' own doc comments), and Task 10
 * removed Dexie — and the reader's own chapter fetch (`course/loader.ts`)
 * has hit the server on every load since the server-side pivot. Measured
 * before this task touched anything: no service worker, no precache
 * anywhere in this app (`grep -arln 'serviceWorker\|workbox\|precache'
 * apps/web/` returns nothing), so a COLD load with no response has nothing
 * local left to show — the branch was admitting a visitor past this gate
 * into a page with nothing on it to read. That is a real narrowing, not a
 * free cleanup: before Task 9/10, a device with a recent marker could
 * genuinely read its own cached Dashboard/Progress/chapter offline after a
 * cold reload; after this phase it cannot, under any circumstance. See this
 * task's report for the full accounting.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const { t } = useLanguage();
  const location = useLocation();
  const meQuery = useMe();

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
   * Lần mount NÀY đã từng dựng `children` dưới một phiên được server xác nhận
   * chưa. Một `ref`, không phải state: nó chỉ đi một chiều false → true và
   * không được phép tự nó gây thêm một lần render.
   *
   * Nó tồn tại vì một lỗi đo được, không phải vì gọn hơn. `e2e/s3.spec.ts` mở
   * một chương, khẳng định tiêu đề đã hiện, rồi đọc `#content` ngay sau đó và
   * thỉnh thoảng nhận đúng 16 ký tự — "Đang tải chương…", chuỗi 16 ký tự duy
   * nhất trong catalog tiếng Việt lọt được vào `#content`. Tức trang đọc đã
   * dựng xong rồi TỤT LẠI. Đường duy nhất tụt lại được là `<ChapterView>` bị
   * GỠ rồi DỰNG LẠI, và trên route ấy chỉ có một chỗ gỡ được cả cây: nhánh
   * cần-mạng ngay dưới đây, nếu nó thay `children` bằng thông báo mỗi lần
   * `noResponseArrived` bật lên.
   *
   * Nó bị chạm tới bởi một lần `GET /me` làm mới KHÔNG NHẬN ĐƯỢC PHẢN HỒI —
   * mạng chớp, một request bị huỷ, server bận. `useMe` đặt `retry: false` nên
   * một lần như thế đủ đẩy truy vấn sang `isError`. Task 11 gỡ bước tra hỏi
   * cục bộ bất đồng bộ mà nhánh này từng phải đợi (offline-session query cũ)
   * — `authorizedOnce.current` giờ được đọc NGAY trong cùng lượt vẽ mà
   * `noResponseArrived` bật lên, nên không còn khoảng trống nào giữa hai việc
   * đó cho cây bị gỡ nữa: một trang đã cấp phép đứng yên tuyệt đối qua một
   * lần `/me` hỏng thoáng qua. Ở trang đọc, "đứng yên" gồm cả canvas, mô
   * phỏng đã dựng và vị trí cuộn.
   *
   * **Đây không phải nhánh ngoại tuyến mà Task 11 vừa gỡ, dù trông giống.**
   * Khác biệt: nhánh cũ tra một dấu vết `localStorage` và có thể mở cửa cho
   * một trang CHƯA TỪNG được vẽ ở lượt mount này (một lần tải lại nguội).
   * `authorizedOnce.current` không tra gì bền cả — nó chỉ nhớ trong bộ nhớ,
   * của MỘT LẦN MOUNT component này, rằng `children` ĐÃ đứng trên màn hình
   * dưới một phiên server vừa xác nhận. Một lần tải lại nguội luôn bắt đầu
   * với `authorizedOnce.current === false`, nên nhánh này không thể thay thế
   * nhánh ngoại tuyến đã gỡ — nó chỉ giữ nguyên một trang ĐÃ MỞ, không mở một
   * trang mới.
   */
  const authorizedOnce = useRef(false);

  const noResponseArrived = meQuery.isError && !serverAnswered(meQuery.error);

  // Đứng TRƯỚC mọi nhánh khác, kể cả `isPending`: khi một tài khoản khác đã
  // chiếm phiên trên máy này, mọi câu trả lời mà tab này đang cầm đều thuộc
  // về người trước. Không có câu hỏi nào ở dưới còn nghĩa.
  if (superseded) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (meQuery.isPending) {
    return null;
  }

  if (meQuery.isError) {
    if (!noResponseArrived) {
      return <p className="ch-lede">{describeAuthError(meQuery.error, t)}</p>;
    }
    // KHÔNG CÓ CÂU TRẢ LỜI NÀO. `authorizedOnce.current` là ngoại lệ DUY
    // NHẤT — xem doc comment của chính nó ngay trên đây cho việc vì sao nó
    // không phải là nhánh ngoại tuyến đã gỡ. Mọi trường hợp khác: máy không
    // biết phiên còn sống hay không, và đó là "cần mạng", không phải "đã
    // đăng xuất".
    if (authorizedOnce.current) {
      return <>{children}</>;
    }
    return <p className="ch-lede">{t('auth.needsNetwork')}</p>;
  }

  if (meQuery.data == null) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  authorizedOnce.current = true;
  return <>{children}</>;
}

export default RequireAuth;
