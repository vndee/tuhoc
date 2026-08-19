import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './routes';
import { Rail } from './shell/Rail';
import { Shell } from './shell/Shell';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import './styles/index.css';
import { useTheme } from './theme/useTheme';

// One QueryClient for the whole app. No queries are defined yet — Task 10+
// add them — this just wires the provider so those tasks don't need to
// touch App.tsx.
const queryClient = new QueryClient();

export default function App() {
  const { theme, toggle } = useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell sidebar={<Sidebar />} topbar={<Topbar theme={theme} onToggleTheme={toggle} />} rail={<Rail />}>
          <AppRoutes />
        </Shell>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
