import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { useMe } from './api/useMe';
import { AppRoutes } from './routes';
import { Rail } from './shell/Rail';
import { Shell } from './shell/Shell';
import { Sidebar } from './shell/Sidebar';
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
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * Split out from `App` so hooks that need Router context — `useMobileNav`
 * reads the current location to close the drawer on navigation — run
 * *inside* `<BrowserRouter>` rather than above it.
 */
function AppShell() {
  const { theme, toggle: toggleTheme } = useThemeContext();
  const { toggle: toggleMobileNav } = useMobileNav();

  useSyncLifecycle();

  return (
    <Shell
      sidebar={<Sidebar />}
      topbar={<Topbar theme={theme} onToggleTheme={toggleTheme} onMenuClick={toggleMobileNav} />}
      rail={<Rail />}
    >
      <AppRoutes />
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
