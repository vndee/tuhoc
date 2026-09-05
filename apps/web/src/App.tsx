import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { startEventFlusher } from './api/events';
import { useMe } from './api/useMe';
import { drainLegacyDataOnce } from './db/legacyDrain';
import { LanguageProvider } from './i18n/LanguageProvider';
import { LanguageSwitcher } from './i18n/LanguageSwitcher';
import { AppRoutes } from './routes';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { Rail } from './shell/Rail';
import { Shell } from './shell/Shell';
import { Sidebar } from './shell/Sidebar';
import { AccountChip, SidebarTrigger, TopNav, TopSearch } from './shell/TopNav';
import { Topbar } from './shell/Topbar';
import { useMobileNav } from './shell/useMobileNav';
import './styles/index.css';
import { ThemeProvider, useThemeContext } from './theme/ThemeContext';

// One QueryClient for the whole app. No queries are defined yet — Task 10+
// add them — this just wires the provider so those tasks don't need to
// touch App.tsx.
const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* Ngoài <ThemeProvider>: ngôn ngữ là thứ MỌI thứ khác vẽ bằng, kể cả
            nhãn của nút chủ đề khi Task 5 bóc nó. Cả hai đều là tuỳ chọn của
            THIẾT BỊ (db/localStorage.ts's DEVICE_PREFERENCE_KEYS) và không
            phụ thuộc nhau, nên thứ tự này chỉ là chiều phụ thuộc tương lai,
            không phải một ràng buộc hôm nay. */}
        <LanguageProvider>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </LanguageProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * Split out from `App` so hooks that need Router context — `useMobileNav`
 * reads the current location to close the drawer on navigation — run
 * *inside* `<BrowserRouter>` rather than above it.
 */
// Matches `/c/:courseId/:chapterId`. A fourth copy of this regex, and
// deliberately not a shared import: `Topbar`, `Rail` and `Sidebar` each keep
// their own for the reason `Topbar`'s comment gives — all four are chrome
// rendered ALONGSIDE `<AppRoutes>` rather than inside a matched `<Route>`, so
// none of them can ask the router and all of them only ever see a pathname.
const CHAPTER_ROUTE = /^\/c\/[^/]+\/[^/]+/;

// `/c/:courseId` VÀ mọi thứ dưới nó — tức là "đang ở trong một khoá". Rộng hơn
// `CHAPTER_ROUTE` đúng một bậc, và hai câu hỏi ấy khác nhau: trang khoá học có
// mục lục nhưng không phải đang đọc.
const COURSE_ROUTE = /^\/c\/[^/]+/;

// `/login` — và, từ 03/09/2026, `/` khi chưa có phiên. Hai màn hình
// TRƯỚC-TÀI-KHOẢN, cả hai đều không có thanh trên. Xem `ShellProps.authScreen`.
const AUTH_ROUTE = /^\/login/;
const EDITORIAL_ROUTE = /^\/stories(?:\/|$)/;

function AppShell() {
  const { theme, toggle: toggleTheme } = useThemeContext();
  const { open: mobileNavOpen, toggle: toggleMobileNav } = useMobileNav();
  const location = useLocation();
  const me = useMe();
  /**
   * Thanh trên mang nhãn hiệu, ba đích điều hướng, ô tìm kiếm và chip tài
   * khoản — bốn thứ mà một người CHƯA ĐĂNG NHẬP không dùng được cái nào. Lý
   * do ấy đã bỏ thanh trên khỏi `/login`; từ 03/09/2026 nó cũng đúng y hệt ở
   * `/`, nơi khách gặp landing (`pages/HomeGate.tsx`). Landing có thế giới
   * hình riêng và tự mang nhãn hiệu, hai điều khiển thiết bị và lối đăng nhập
   * viết bằng phấn trên bảng của nó; để lại một dải 64px của vỏ app phía trên
   * là đúng điều chủ dự án gọi tên — "nhìn giống trang đã đăng nhập".
   *
   * Điều kiện là `!me.data`, KHÔNG phải `me.data === null`: trong lúc `GET
   * /me` chưa trả lời thì `HomeGate` chưa vẽ gì cả, nên dựng thanh trên ở
   * quãng ấy chỉ để gỡ nó đi ngay sau đó là một cú nháy chrome cho đúng những
   * người đã đăng nhập. `useMe()` là truy vấn dùng chung (`meQueryKey`,
   * `staleTime: 60_000`) mà `RequireAuth`, `TopNav` và `useSyncLifecycle`
   * cùng đọc — hỏi thêm ở đây không tốn một request nào.
   */
  const authScreen = AUTH_ROUTE.test(location.pathname) || (location.pathname === '/' && !me.data);
  const editorialScreen = EDITORIAL_ROUTE.test(location.pathname);

  useSyncLifecycle();
  useLegacyDrain();

  return (
    <Shell
      // HAI CHẾ ĐỘ, không phải năm mục phẳng — đặc tả
      // `docs/superpowers/specs/2026-08-23-ia-redesign.md`. Đây là chỗ duy
      // nhất trong repo biết mình đang ở chế độ nào; mọi khác biệt còn lại là
      // luật CSS treo dưới `#app.reading`.
      reading={CHAPTER_ROUTE.test(location.pathname)}
      inCourse={COURSE_ROUTE.test(location.pathname)}
      authScreen={authScreen}
      editorialScreen={editorialScreen}
      sidebar={<Sidebar />}
      topbar={
        authScreen || editorialScreen ? null : (
        <>
          {/* NÚT NGĂN KÉO CỦA MÀN HẸP, đứng trước nhãn hiệu — chỗ mọi người
              tìm nó trên điện thoại. `reader.css` giữ nó ẩn từ 981px trở lên,
              nên trên máy bàn hàng này bắt đầu thẳng bằng nhãn hiệu, đúng như
              bản dựng đã duyệt. */}
          <SidebarTrigger onMenuClick={toggleMobileNav} navExpanded={mobileNavOpen} />
          {/* TRƯỚC `<Topbar>`, nên nhãn hiệu và ba đích là thứ đầu tiên cả
              trong thứ tự đọc lẫn thứ tự tab. Ở đây chứ không trong `<Topbar>`
              vì `TopNav` đọc `useMe()` — xem doc của chính nó, và lý do y hệt
              cái đã giữ `<LanguageSwitcher>` ở ngoài. */}
          <TopNav />
          <Topbar theme={theme} onToggleTheme={toggleTheme} />
          {/* Gắn ở khe `topbar` chứ không trong <Topbar>: <Topbar> nhận mọi
              thứ qua props và được ba tệp test render trực tiếp, nên cho nó
              đọc Context sẽ bắt ba tệp ấy phải dựng provider mà chẳng đo thêm
              được gì. Ở đây điều khiển vẫn nằm trong `#topbar` thật, và
              LanguageProvider.test.tsx's "CỬA" chứng minh người dùng bấm tới
              được nó qua <App/>. */}
          {/* Ô tìm kiếm đứng ĐẦU nhóm phải: nó là thứ rộng nhất bên ấy, nên
              nó phải là thứ co lại trước khi các nút bị đẩy đi. */}
          <TopSearch />
          <LanguageSwitcher />
          {/* SAU `<LanguageSwitcher>`: `#crumb` mang `flex:1` nên mọi thứ đứng
              sau nó bị đẩy về mép phải, và tài khoản là thứ cuối cùng bên ấy. */}
          <AccountChip />
        </>
        )
      }
      rail={<Rail />}
    >
      {/* Inside <Shell>, not outside: a render error in one page should leave
          the sidebar, topbar and rail standing so the reader can navigate away.
          A boundary above <Shell> would take the whole chrome down with it. */}
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>
    </Shell>
  );
}

/**
 * Debt carried from Task 13, narrowed by Task 10: this used to also start
 * `sync/engine.ts`'s background push/pull loop (`startSync()`/`stopSync()`)
 * once a user was authenticated. Task 10 deletes that engine entirely —
 * progress and annotations are exclusively server-side now, read and
 * written directly through `api/*` and react-query, with no local outbox
 * left to flush on a timer. What remains here is `startEventFlusher()`
 * (`./api/events.ts`) — the study-heartbeat queue, which was ALREADY off
 * the Dexie outbox before this task (Task 8, this phase) and is unrelated
 * to the engine that just left.
 *
 * Driven by `useMe()` — the same query `<RequireAuth>` reads — rather
 * than route location: `AppShell` renders on every route including
 * `/login`, and `useMe()`'s cached result (shared `meQueryKey`, `useMe`'s
 * own `staleTime: 60_000`) is the single source of truth this whole app
 * already uses for "is anyone logged in," so this doesn't introduce a
 * second, potentially-inconsistent way to answer that question.
 *
 * `startEventFlusher` is NOT a module-level singleton (see its own doc
 * comment) — its teardown is whatever THIS effect's own call returned,
 * captured in `stopFlusher` below, not a shared top-level
 * `stopEventFlusher()`.
 */
function useSyncLifecycle(): void {
  const meQuery = useMe();
  const userId = meQuery.data?.id ?? null;

  useEffect(() => {
    if (userId === null) return undefined;
    const stopFlusher = startEventFlusher();
    return () => {
      stopFlusher();
    };
  }, [userId]);
}

/**
 * Fires `drainLegacyDataOnce()` (`./db/legacyDrain.ts`) at most once per
 * page load, and only for a SETTLED, SIGNED-IN `useMe()` — this is what
 * replaced `startSync()`'s call site here (Task 10).
 *
 * **The gate this used to not have, and what its absence cost.** The first
 * cut ran on `[]` deps with no auth condition at all, and said so on
 * purpose: *the legacy outbox belongs to whichever account was signed in
 * on THIS BROWSER under the OLD build, which has nothing to do with who
 * `GET /me` currently answers — a browser that has since signed out still
 * needs its old outbox flushed*. Every clause of that is true and the
 * conclusion is still wrong, because the outbox does not travel with a
 * name: `api/client.ts`'s `send()` carries whatever cookie the browser has
 * NOW, and `apps/api/internal/sync/handler.go` files every row under
 * `auth.UID(c)`. "Flush it for whoever wrote it" and "flush it under
 * whoever is signed in" are the same line of code, and the second is what
 * it actually does. The final whole-branch review measured the
 * consequence: B signs in on A's browser, and on B's next page load A's
 * private notes are INSERTed into B's account (see `legacyDrain.ts`'s
 * header for why the server's owner-scoping cannot catch that, and
 * `test/legacyDrainHandoff.test.tsx` for the end-to-end proof).
 *
 * `useSyncLifecycle` above only ever started the old sync engine for a
 * signed-in user, and that engine's `runCycle` also asked
 * `sessionWasSuperseded()` before every push. This hook is the same shape:
 * the auth half here, the supersession half inside
 * `drainLegacyDataOnce()` itself, where the drain's own await points are.
 *
 * **`decided`, and why the decision is per PAGE LOAD rather than per
 * user.** `useMe()` settles once per load and can then change (a login on
 * this very tab). Re-running the drain on that change is exactly the leak
 * again in slow motion — the arriving account would flush the departing
 * one's outbox. So the FIRST settled answer of a load decides, once, and
 * nothing later in that load reopens the question: sign in as B and B's
 * own next page load is the earliest this can run again, by which point
 * `clearSession()` has already deleted the database (see
 * `db/legacyDrain.ts`'s `clearLegacyLocalData`). `isError` deliberately
 * does NOT decide — a 500 or a dead network is "unknown", not "logged
 * out", the same distinction `<RequireAuth>` draws — so a later successful
 * refetch still gets its one chance.
 *
 * What this strands, stated plainly: a browser whose old-build session
 * ended and whose owner never signs in on it again keeps its outbox
 * unsent, and the next account to sign in deletes rather than sends it.
 * That is strictly better than the alternative it replaces, which was
 * sending one learner's private notes into another learner's account.
 *
 * Exported for `test/legacyDrainHandoff.test.tsx`, which drives THIS hook
 * rather than a copy of it — a gate this size is worth nothing if the
 * thing under test is a re-implementation that can stay green while the
 * real wiring rots.
 *
 * Not awaited, and any failure is swallowed here as a second, defensive
 * layer on top of `drainLegacyDataOnce()`'s own internal try/catch (which
 * already never rejects — see that function's doc comment): this must
 * never block or blank this component's render. The worst case of a
 * drain failing is that it retries on the next page load, which is exactly
 * what "no delete on failure" is for.
 */
export function useLegacyDrain(): void {
  const meQuery = useMe();
  const settled = meQuery.isSuccess;
  const userId = meQuery.data?.id ?? null;
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current || !settled) return;
    decided.current = true;
    if (userId === null) return;
    drainLegacyDataOnce().catch((err: unknown) => {
      console.error('tuhoc: legacy local database drain failed unexpectedly', err);
    });
  }, [settled, userId]);
}
