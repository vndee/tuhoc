import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './routes';
import { LanguageProvider } from './i18n/LanguageProvider';
import { ThemeProvider } from './theme/ThemeContext';

function Recorder({ paths }: { paths: string[] }) {
  const location = useLocation();
  useEffect(() => {
    paths.push(location.pathname);
  }, [location.pathname, paths]);
  return null;
}

function renderAt(path: string, paths: string[]) {
  return render(
    <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={[path]}>
      <Recorder paths={paths} />
      <AppRoutes />
    </MemoryRouter></LanguageProvider></ThemeProvider>,
  );
}

describe('public special-edition routes', () => {
  it.each([
    ['/stories', 'Các số đặc san'],
    ['/stories/missing', 'Không tìm thấy số đặc san'],
  ])('opens %s without redirecting a visitor to login', async (path, heading) => {
    const paths: string[] = [];
    renderAt(path, paths);

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(paths).toContain(path);
    expect(paths).not.toContain('/login');
  });
});
