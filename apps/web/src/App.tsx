import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './routes';
import { Rail } from './shell/Rail';
import { Shell } from './shell/Shell';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import { useMobileNav } from './shell/useMobileNav';
import './styles/index.css';
import { useTheme } from './theme/useTheme';

// One QueryClient for the whole app. No queries are defined yet — Task 10+
// add them — this just wires the provider so those tasks don't need to
// touch App.tsx.
const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppShell />
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
  const { theme, toggle: toggleTheme } = useTheme();
  const { toggle: toggleMobileNav } = useMobileNav();

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
