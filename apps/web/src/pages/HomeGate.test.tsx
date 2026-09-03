import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { meQueryKey, type Me } from '../api/useMe';
import { t } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ThemeProvider } from '../theme/ThemeContext';
import { HomeGate } from './HomeGate';

// Học tiếp có bộ test riêng (`test/Dashboard.test.tsx`); ở đây chỉ cần biết
// cổng đã chọn NÓ, không cần dựng bốn nguồn dữ liệu của nó.
vi.mock('./Dashboard', () => ({ Dashboard: () => <h1>dashboard-stub</h1> }));

const server = setupServer(http.get('/courses', () => HttpResponse.json([])));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function mount(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={['/']}>
            <HomeGate />
          </MemoryRouter>
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

/** Phiên đã biết sẵn: nạp thẳng vào cache, không có lượt gọi `/me` nào. */
function renderGate(me: Me | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(meQueryKey, me);
  return mount(queryClient);
}

/** Phiên CHƯA biết: `GET /me` thật, do `server.use()` ở từng bài quyết định. */
function renderGateLive() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(queryClient);
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

  /**
   * Nhánh `isPending` là thứ giữ cho MỌI người đã đăng nhập khỏi thấy một cú
   * nháy landing → Học tiếp ở màn đầu tiên, và nó chưa từng được đo: hai bài
   * trên đều nạp sẵn cache nên `isPending` không bao giờ đúng. Xoá dòng
   * `if (me.isPending) return null` vẫn xanh cả bộ (`/review`, 03/09/2026).
   */
  it('trong lúc GET /me chưa trả lời thì KHÔNG vẽ gì — không nháy landing với người đã đăng nhập', async () => {
    server.use(http.get('/me', () => new Promise<never>(() => {})));
    const { container } = renderGateLive();

    await waitFor(() => expect(container.querySelector('.board-room')).toBeNull());
    expect(screen.queryByRole('heading', { name: t('vi', 'landing.question') })).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard-stub')).not.toBeInTheDocument();
  });

  /**
   * Bậc suy giảm mà doc của `HomeGate` tự khai: mất mạng hoặc máy chủ hỏng thì
   * ra landing, không phải trang trắng. Không có bài này thì đổi thành
   * `if (me.isPending || me.isError) return null` sẽ ship im lặng.
   */
  it('GET /me hỏng thì vẫn ra landing, không phải trang trắng', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    renderGateLive();

    expect(await screen.findByRole('heading', { level: 1, name: t('vi', 'landing.question') })).toBeInTheDocument();
  });
});
