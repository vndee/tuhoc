import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
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

// `/login` — màn hình duy nhất KHÔNG có thanh trên. Xem `ShellProps.authScreen`.
const AUTH_ROUTE = /^\/login/;

function AppShell() {
  const { theme, toggle: toggleTheme } = useThemeContext();
  const { open: mobileNavOpen, toggle: toggleMobileNav } = useMobileNav();
  const location = useLocation();
  const authScreen = AUTH_ROUTE.test(location.pathname);

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
      sidebar={<Sidebar />}
      topbar={
        authScreen ? null : (
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
 * Fires `drainLegacyDataOnce()` (`./db/legacyDrain.ts`) exactly once, at
 * mount — this is what replaced `startSync()`'s call site here (Task 10).
 *
 * Deliberately NOT gated on `useMe()` the way `useSyncLifecycle` above is:
 * the legacy outbox this drains belongs to whichever account was signed in
 * on THIS BROWSER under the OLD build, which has nothing to do with who
 * `GET /me` currently answers on this load — a browser that has since
 * signed out, or whose cookie has since expired, still needs its old
 * outbox flushed before this app is allowed to delete it. Gating this on
 * auth would strand that browser's unsent work behind a session that may
 * never come back.
 *
 * Empty dependency array: this must run once per app mount, not once per
 * change of signed-in user — `drainLegacyDataOnce()` is itself idempotent
 * (a second call after a successful drain is a cheap no-op — see that
 * function's own doc comment), so nothing is lost by NOT re-running it on
 * every auth transition; re-running it anyway would just be wasted work on
 * every login/logout for the overwhelming majority of readers who never
 * had a legacy database to begin with.
 *
 * Not awaited, and any failure is swallowed here as a second, defensive
 * layer on top of `drainLegacyDataOnce()`'s own internal try/catch (which
 * already never rejects — see that function's doc comment): this must
 * never block or blank this component's render. The worst case of a
 * drain failing is that it retries on the next page load, which is exactly
 * what "no delete on failure" is for.
 */
function useLegacyDrain(): void {
  useEffect(() => {
    drainLegacyDataOnce().catch((err: unknown) => {
      console.error('tuhoc: legacy local database drain failed unexpectedly', err);
    });
  }, []);
}
