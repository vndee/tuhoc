/**
 * The app's global navigation — asked the one question no automated gate in
 * this project can ask on its own: **can a reader get there from here?**
 *
 * Two mutation results are the reason this file exists rather than a couple of
 * assertions bolted onto an existing suite:
 *
 *  - Independent review deleted BOTH links to `/import` from the Dashboard and
 *    all 632 tests stayed green.
 *  - `/library` arrived with the same exposure — one door, on `/` — and Task
 *    9's brief listed `shell/` under "Modify: … (điều hướng)" while a grep for
 *    `Link|to=|href` across all four `shell/` files returned nothing at all.
 *    So from a chapter, or from `/import`, the way to any other screen was the
 *    browser's back button.
 *
 * The first two tests drive the REAL `<App/>` — real router, real shell, real
 * click — because a component rendered in isolation can pass every assertion
 * here while being mounted nowhere (docs/carried-forward.md's blind gate #4 is
 * exactly that failure, at 775 lines).
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { meQueryKey } from '../api/useMe';
import { clearUserContent } from '../db/localStorage';
import { TopNav } from '../shell/TopNav';
import { LanguageProvider } from '../i18n/LanguageProvider';

const server = setupServer(
  http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'Người học' })),
  http.get('/courses', () => HttpResponse.json([])),
  http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(clearUserContent);
afterEach(clearUserContent);

function goTo(path: string) {
  window.history.pushState({}, '', path);
}

function globalNav(): HTMLElement {
  return screen.getByRole('navigation', { name: /điều hướng chính/i });
}

describe('điều hướng toàn cục (shell)', () => {
  it('có mặt trên MỌI màn hình, không chỉ trên "/" — kể cả sau khi /import chuyển hướng', async () => {
    // The measured gap: `/import` and `/library` were reachable from exactly
    // one place each, both on the Dashboard. A reader standing on `/import`
    // had no way to the library that did not involve the back button.
    //
    // `/import` giờ chuyển hướng vào `/courses?import=1` (đặc tả IA), nên ca
    // này đo thêm một điều nữa mà nó không đo được trước đây: thanh điều hướng
    // vẫn còn đó SAU một lần chuyển hướng, và hộp thoại nhập gói không nuốt
    // mất nó. Ba nơi chốn được gọi đích danh — đó là toàn bộ danh sách bây giờ.
    goTo('/import');
    render(<App />);

    const nav = await waitFor(() => globalNav());
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/courses');
    expect(hrefs).toContain('/progress');

    // ĐỐI CHỨNG: hai mục cũ đã RỜI thanh bên. Không có chiều này, một bản gộp
    // nửa vời (dựng tab và nút, nhưng để nguyên hai mục cũ) vẫn xanh — mà đó
    // đúng là thứ đặc tả gọi là "năm mục phẳng ngang hàng".
    expect(hrefs).not.toContain('/import');
    expect(hrefs).not.toContain('/catalog');
  });

  it('có mặt trên "/" — chỗ mà hai bài trong Dashboard.test.tsx từng canh', async () => {
    // Trước GlobalNav, `Dashboard.tsx` tự mang nút tới `/library` và `/import`,
    // và `Dashboard.test.tsx` canh chúng — đúng ở thời điểm ấy, vì đó là cửa
    // DUY NHẤT. Nay thanh bên mang cả hai trên mọi màn hình, nên hai nút kia là
    // **hai cửa cho cùng một chỗ** và đã bị gỡ (phần đầu trang đọc như một hàng
    // nút rời rạc vì chúng).
    //
    // Ca này tồn tại để việc gỡ ấy KHÔNG làm mất phủ sóng: thứ bài cũ chứng
    // minh — "từ màn hình Bảng điều khiển, có đường tới /library và /import" —
    // nay được chứng minh ở đây, trên chính route đó, qua `<App/>` thật.
    goTo('/');
    render(<App />);

    const nav = await waitFor(() => globalNav());
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs, 'không còn lối vào danh sách khoá học từ Bảng điều khiển').toContain('/courses');
    expect(hrefs, 'không còn lối vào /progress').toContain('/progress');

    // Lối vào phần NHẬP GÓI từ Bảng điều khiển từng được canh ở đây, bằng một
    // mục thanh bên. Mục ấy đã đi, nhưng yêu cầu thì không: nó nay là cửa ngữ
    // cảnh trong chính lời nhắn "thư viện của bạn đang trống"
    // (`test/Dashboard.test.tsx`) cộng với nút "Nhập gói" ở đầu `/courses`
    // (`pages/Courses.test.tsx`, bấm thật qua `<App/>` thật). Hai chỗ ấy là nơi
    // phủ sóng chuyển đến — không phải nơi nó bị xoá.
  });

  it('bấm được: từ Bảng điều khiển sang màn Khoá học, bằng chuột, trong ứng dụng thật', async () => {
    goTo('/');
    render(<App />);

    const nav = await waitFor(() => globalNav());
    const user = userEvent.setup();
    await user.click(within(nav).getByRole('link', { name: /khoá học/i }));

    await waitFor(() => expect(window.location.pathname).toBe('/courses'));
    // Nhan đề của chính màn Khoá học — `h1` của nó, không phải của một tab.
    expect(await screen.findByRole('heading', { name: 'Khoá học', level: 1 })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * The signed-out gate, on an isolated render
 * ------------------------------------------------------------------ *
 * `App` builds its QueryClient at module scope, so a `me` seeded by the tests
 * above would still be cached here. This one owns its cache.
 *
 * DỰNG `<TopNav>` CHỨ KHÔNG PHẢI `<Sidebar>` kể từ vòng thiết kế lại: điều
 * hướng chung đã chuyển lên thanh trên, vì thanh bên nay chỉ mang mục lục.
 *
 * Đổi mục tiêu chứ không nới câu hỏi, và bài "đối chứng" ngay dưới là lý do
 * phải đổi cho đúng: sau khi nav rời đi, `<Sidebar>` trả `null` trên `/login`
 * nên bài "KHÔNG hiện gì" vẫn XANH — xanh vì không dựng gì cả, đúng thứ mà
 * chính bài đối chứng tồn tại để bắt. Nó đã bắt được.
 */

function renderNavAt(path: string, me: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(meQueryKey, me);
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider><MemoryRouter initialEntries={[path]}>
        <TopNav />
      </MemoryRouter></LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('điều hướng toàn cục — khi chưa đăng nhập', () => {
  it('KHÔNG hiện gì: AppShell dựng cả trên /login, và một liên kết chỉ quay về chính nó thì tệ hơn là không có', () => {
    renderNavAt('/login', null);
    expect(screen.queryByRole('navigation', { name: /điều hướng chính/i })).not.toBeInTheDocument();
  });

  it('hiện khi đã đăng nhập — đối chứng, để bài trên không xanh vì không dựng gì cả', () => {
    renderNavAt('/login', { id: 'u1', email: 'a@vi.vn', name: 'Người học' });
    expect(screen.getByRole('navigation', { name: /điều hướng chính/i })).toBeInTheDocument();
  });

  it('đánh dấu trang hiện tại bằng aria-current, không bằng một class thứ hai', () => {
    renderNavAt('/courses', { id: 'u1', email: 'a@vi.vn', name: 'Người học' });
    const nav = globalNav();
    expect(within(nav).getByRole('link', { name: /khoá học/i })).toHaveAttribute('aria-current', 'page');
    // ĐỐI CHỨNG: một mục KHÁC trên cùng thanh không được mang dấu ấy. Trước
    // đây đối chứng là mục "Nhập khóa học", vốn đã rời thanh bên — "Tiến độ"
    // thế chỗ, và nó chứng minh đúng điều cũ: dấu hiệu này chọn MỘT mục, chứ
    // không phải dán lên tất cả.
    expect(within(nav).getByRole('link', { name: /tiến độ/i })).not.toHaveAttribute('aria-current');
  });
});
