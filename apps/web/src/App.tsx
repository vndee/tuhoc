import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { startEventFlusher } from './api/events';
import { useMe } from './api/useMe';
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
import { startSync, stopSync } from './sync/engine';
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
            THIẾT BỊ (db/local.ts's DEVICE_PREFERENCE_KEYS) và không phụ thuộc
            nhau, nên thứ tự này chỉ là chiều phụ thuộc tương lai, không phải
            một ràng buộc hôm nay. */}
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
 * Debt carried from Task 13: `startSync()`/`stopSync()` (src/sync/engine.ts)
 * had no call site at all — nothing synced. This starts the background
 * sync loop once a user is authenticated, and stops it the moment that
 * stops being true (logout, session death) or this component unmounts.
 *
 * Driven by `useMe()` — the same query `<RequireAuth>` reads — rather
 * than route location: `AppShell` renders on every route including
 * `/login`, and `useMe()`'s cached result (shared `meQueryKey`, `useMe`'s
 * own `staleTime: 60_000`) is the single source of truth this whole app
 * already uses for "is anyone logged in," so this doesn't introduce a
 * second, potentially-inconsistent way to answer that question.
 *
 * `startSync`/`stopSync` are both idempotent (see their own doc
 * comments in src/sync/engine.ts) — calling `startSync()` on every render
 * where `meQuery.data` is still the same signed-in user is a safe no-op,
 * not a second interval stacking on top of the first.
 *
 * Task 8 (Pha 3) adds `startEventFlusher()` (`./api/events.ts`) right
 * alongside `startSync()`, gated by the exact same `userId` — a
 * heartbeat can only be queued from a chapter route, which sits behind
 * `<RequireAuth>`, so there is nothing to flush before this same
 * condition is true anyway, and gating it identically means a logout
 * that stops the sync loop stops the flusher in the same tick rather
 * than leaving it posting against a session that just died. Unlike
 * `startSync`/`stopSync`, `startEventFlusher` is NOT a module-level
 * singleton (see its own doc comment) — its teardown is whatever THIS
 * effect's own call returned, captured in `stopFlusher` below, not a
 * shared top-level `stopEventFlusher()`.
 */
function useSyncLifecycle(): void {
  const meQuery = useMe();
  const userId = meQuery.data?.id ?? null;

  useEffect(() => {
    let stopFlusher: (() => void) | null = null;
    if (userId !== null) {
      startSync();
      stopFlusher = startEventFlusher();
    }
    return () => {
      stopSync();
      stopFlusher?.();
    };
  }, [userId]);
}
