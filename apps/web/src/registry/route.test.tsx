/**
 * Can a reader GET there?
 *
 * `Catalog.test.tsx` renders the component directly, which is exactly the
 * thing `docs/carried-forward.md`'s blind gate #4 warns about: a component
 * can pass every assertion in its own suite while being mounted nowhere.
 * That happened in this repo at 775 lines, and independent review once
 * deleted BOTH links to `/import` with all 632 tests staying green.
 *
 * So this file drives the REAL `<App/>` — real router, real shell, real
 * `<ErrorBoundary>` — and asks two questions no isolated render can:
 * is `/catalog` mounted, and is there a door to it.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { clearLocalData } from '../db/local';

const server = setupServer(
  http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'Người học' })),
  http.get('/courses', () => HttpResponse.json([])),
  http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(clearLocalData);
afterEach(clearLocalData);

function goTo(path: string) {
  window.history.pushState({}, '', path);
}

describe('/catalog trong ứng dụng THẬT', () => {
  it('route được gắn: mở thẳng /catalog thì màn hình danh mục dựng lên', async () => {
    goTo('/catalog');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /danh mục/i })).toBeInTheDocument();
  });

  it('có CỬA tới nó: điều hướng toàn cục mang liên kết, và bấm được từ /import', async () => {
    goTo('/import');
    render(<App />);

    const nav = await waitFor(() => screen.getByRole('navigation', { name: /điều hướng chính/i }));
    const user = userEvent.setup();
    await user.click(within(nav).getByRole('link', { name: /danh mục/i }));

    await waitFor(() => expect(window.location.pathname).toBe('/catalog'));
    expect(await screen.findByRole('heading', { name: /danh mục/i })).toBeInTheDocument();
  });

  it('KHÔNG cấu hình registry → nêu đích danh biến cần đặt, và KHÔNG gọi mạng', async () => {
    // `VITE_REGISTRY_URL` không được đặt khi chạy test, và
    // `PUBLIC_REGISTRY_BASE` hôm nay là `null`. Đây chính là cái một bản dựng
    // chưa cấu hình gặp phải — nên nó được đo, chứ không để mặc.
    //
    // `onUnhandledRequest: 'error'` ở trên là nửa thứ hai của bài này: nếu
    // màn hình lỡ đi gọi một địa chỉ nào đó, MSW làm test đỏ.
    goTo('/catalog');
    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('VITE_REGISTRY_URL');
    expect(screen.queryByText('Màn hình này gặp lỗi')).not.toBeInTheDocument();
  });
});
