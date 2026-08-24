import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { useMe } from './api/useMe';
import { LanguageProvider } from './i18n/LanguageProvider';
import { LanguageSwitcher } from './i18n/LanguageSwitcher';
import { AppRoutes } from './routes';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { Rail } from './shell/Rail';
import { Shell } from './shell/Shell';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import { useMobileNav } from './shell/useMobileNav';
import { useSidebarCollapse, WIDE_QUERY } from './shell/useSidebarCollapse';
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

function AppShell() {
  const { theme, toggle: toggleTheme } = useThemeContext();
  const { toggle: toggleMobileNav } = useMobileNav();
  const { collapsed, toggle: toggleCollapse } = useSidebarCollapse();
  const location = useLocation();

  /**
   * MỘT nút, hai cơ chế, chọn theo bề rộng NGAY LÚC BẤM.
   *
   * Với người dùng đây là cùng một câu — "cho tôi thấy / đừng cho tôi thấy
   * thanh điều hướng" — nên hai nút sẽ là hai cách nói một điều, đặt cạnh nhau,
   * và đó đúng là thứ đặc tả IA gọi là mô hình điều hướng thứ hai.
   *
   * Hỏi `matchMedia` lúc bấm chứ không giữ bề rộng trong state: không cần
   * listener `resize`, không có state lệch pha sau khi xoay máy, và câu hỏi chỉ
   * có nghĩa đúng vào khoảnh khắc người ta bấm. `matchMedia` được bọc vì jsdom
   * cũ có thể không có nó — thiếu thì coi như màn hẹp, tức giữ nguyên hành vi
   * ngăn kéo vốn có.
   */
  const onMenuClick = useCallback(() => {
    const wide =
      typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches;
    if (wide) toggleCollapse();
    else toggleMobileNav();
  }, [toggleCollapse, toggleMobileNav]);

  useSyncLifecycle();

  return (
    <Shell
      // HAI CHẾ ĐỘ, không phải năm mục phẳng — đặc tả
      // `docs/superpowers/specs/2026-08-23-ia-redesign.md`. Đây là chỗ duy
      // nhất trong repo biết mình đang ở chế độ nào; mọi khác biệt còn lại là
      // luật CSS treo dưới `#app.reading`.
      reading={CHAPTER_ROUTE.test(location.pathname)}
      navCollapsed={collapsed}
      sidebar={<Sidebar />}
      topbar={
        <>
          <Topbar
            theme={theme}
            onToggleTheme={toggleTheme}
            onMenuClick={onMenuClick}
            navExpanded={!collapsed}
          />
          {/* Gắn ở khe `topbar` chứ không trong <Topbar>: <Topbar> nhận mọi
              thứ qua props và được ba tệp test render trực tiếp, nên cho nó
              đọc Context sẽ bắt ba tệp ấy phải dựng provider mà chẳng đo thêm
              được gì. Ở đây điều khiển vẫn nằm trong `#topbar` thật, và
              LanguageProvider.test.tsx's "CỬA" chứng minh người dùng bấm tới
              được nó qua <App/>. */}
          <LanguageSwitcher />
        </>
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
 */
function useSyncLifecycle(): void {
  const meQuery = useMe();
  const userId = meQuery.data?.id ?? null;

  useEffect(() => {
    if (userId !== null) {
      startSync();
    }
    return () => {
      stopSync();
    };
  }, [userId]);
}
