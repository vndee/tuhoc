import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { meQueryKey, type Me } from '../api/useMe';
import { t } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { HomeGate } from './HomeGate';

// Học tiếp có bộ test riêng (`test/Dashboard.test.tsx`); ở đây chỉ cần biết
// cổng đã chọn NÓ, không cần dựng bốn nguồn dữ liệu của nó.
vi.mock('./Dashboard', () => ({ Dashboard: () => <h1>dashboard-stub</h1> }));

const server = setupServer(http.get('/courses', () => HttpResponse.json([])));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderGate(me: Me | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(meQueryKey, me);
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/']}>
          <HomeGate />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('HomeGate — `/` là landing cho khách, Học tiếp cho người đã đăng nhập', () => {
  it('khách chưa đăng nhập thấy landing, KHÔNG bị đẩy sang /login', async () => {
    renderGate(null);
    expect(await screen.findByRole('heading', { level: 1, name: t('vi', 'landing.question') })).toBeInTheDocument();
    expect(screen.queryByText('dashboard-stub')).not.toBeInTheDocument();
  });

  it('người đã đăng nhập thấy Học tiếp, không thấy landing', () => {
    renderGate({ id: 'u1', email: 'hoc@vidu.vn', name: 'Người học' });
    expect(screen.getByText('dashboard-stub')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: t('vi', 'landing.question') })).not.toBeInTheDocument();
  });
});
