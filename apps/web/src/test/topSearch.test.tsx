/**
 * Ô tìm kiếm ở thanh trên, sau khi lời hứa được thu (04/09/2026).
 *
 * Tệp này tồn tại vì trạng thái TRƯỚC nó không phải một lỗi trong mã — nó là
 * một ô `disabled` hoàn toàn đúng cú pháp, có `title` nói ra lý do, và mọi bài
 * test trong repo đều xanh quanh nó. Không có bài test nào hỏi được câu duy
 * nhất quan trọng: **gõ vào đây thì có gì xảy ra không?**
 *
 * Nên những bài dưới đây gõ thật, và đo thứ chỉ thấy được khi gõ: request có
 * đi ra không, kết quả có hiện không, ↑/↓/Enter có mở đúng chương không, và
 * một lượt tìm HỎNG có được nói ra không — thay vì vẽ như "không có kết quả",
 * một câu trả lời SAI chứ không phải một câu trả lời thiếu.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { TopSearch } from '../shell/TopNav';

const ME = { id: 'u1', email: 'a@vi.vn', name: 'Người học' };

function hit(over: Record<string, unknown> = {}) {
  return {
    slug: 'khoa-a',
    courseTitle: 'Khoá A',
    chapterId: 'c1',
    chapterTitle: 'Chương một',
    before: 'Một đại lượng gọi là ',
    match: 'entropy',
    after: ' đo độ bất định.',
    ...over,
  };
}

const server = setupServer(http.get('/me', () => HttpResponse.json(ME)));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function LocationProbe() {
  const loc = useLocation();
  return <p data-testid="loc">{loc.pathname + loc.search}</p>;
}

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/']}>
          <TopSearch />
          <Routes>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

/** Mở ô và gõ. Trả về `user` để bài test gõ tiếp. */
async function openAndType(text: string) {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole('button', { name: /mở ô tìm kiếm/i })).toBeTruthy());
  await user.click(screen.getByRole('button', { name: /mở ô tìm kiếm/i }));
  await user.type(screen.getByRole('combobox'), text);
  return user;
}

describe('ô tìm kiếm ở thanh trên', () => {
  it('GÕ ĐƯỢC — ô không còn `disabled`, và đó là toàn bộ báo cáo ban đầu', async () => {
    server.use(http.get('/search', () => HttpResponse.json({ courses: [], chapters: [], truncated: false })));
    renderSearch();
    await openAndType('entropy');
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('entropy');
    expect((screen.getByRole('combobox') as HTMLInputElement).disabled).toBe(false);
  });

  it('KHÔNG gọi mạng dưới hai ký tự — máy chủ trả 400 cho những truy vấn ấy', async () => {
    let calls = 0;
    server.use(
      http.get('/search', () => {
        calls += 1;
        return HttpResponse.json({ courses: [], chapters: [], truncated: false });
      }),
    );
    renderSearch();
    await openAndType('e');
    // Đợi quá hạn hoãn (200ms) rồi mới kết luận "không gọi".
    await new Promise((r) => setTimeout(r, 350));
    expect(calls).toBe(0);
  });

  it('hiện tên chương, tên khoá, và đoạn trích với chỗ khớp được tô', async () => {
    server.use(
      http.get('/search', () =>
        HttpResponse.json({ courses: [], chapters: [hit()], truncated: false }),
      ),
    );
    renderSearch();
    await openAndType('entropy');

    const option = await screen.findByRole('option', {}, { timeout: 3000 });
    expect(option.textContent).toContain('Chương một');
    expect(option.textContent).toContain('Khoá A');
    // `<mark>` bọc ĐÚNG mảnh máy chủ trả về — không phải kết quả của một phép
    // tìm lại phía client (xem `api/search.ts`).
    const mark = option.querySelector('mark');
    expect(mark?.textContent).toBe('entropy');
    expect(option.textContent).toContain('Một đại lượng gọi là');
  });

  it('↓ rồi Enter mở đúng chương được tô sáng', async () => {
    server.use(
      http.get('/search', () =>
        HttpResponse.json({
          courses: [],
          chapters: [hit(), hit({ chapterId: 'c2', chapterTitle: 'Chương hai' })],
          truncated: false,
        }),
      ),
    );
    renderSearch();
    const user = await openAndType('entropy');
    await screen.findAllByRole('option', {}, { timeout: 3000 });

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/c/khoa-a/c2'));
  });

  it('Enter khi chưa chọn gì thì sang trang kết quả đầy đủ', async () => {
    server.use(
      http.get('/search', () =>
        HttpResponse.json({ courses: [], chapters: [hit()], truncated: true }),
      ),
    );
    renderSearch();
    const user = await openAndType('entropy');
    await screen.findByRole('option', {}, { timeout: 3000 });

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/search?q=entropy'));
  });

  it('⌘K mở ô và đưa con trỏ vào — gợi ý ấy đã in trên ô từ lâu mà không có handler', async () => {
    server.use(http.get('/search', () => HttpResponse.json({ courses: [], chapters: [], truncated: false })));
    renderSearch();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('button', { name: /mở ô tìm kiếm/i })).toBeTruthy());

    await user.keyboard('{Meta>}k{/Meta}');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox')));
  });

  it('Escape xoá chữ trước, đóng ô sau — một cú Escape không cuốn theo thứ vừa gõ', async () => {
    server.use(http.get('/search', () => HttpResponse.json({ courses: [], chapters: [], truncated: false })));
    renderSearch();
    const user = await openAndType('entropy');

    await user.keyboard('{Escape}');
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /đóng ô tìm kiếm/i })).toBeTruthy();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: /mở ô tìm kiếm/i })).toBeTruthy());
  });

  it('LƯỢT TÌM HỎNG được nói ra, không vẽ như "không tìm thấy gì"', async () => {
    // Phân biệt này là toàn bộ lý do nhánh lỗi tồn tại: "không có kết quả" nói
    // với người dùng rằng thứ họ tìm KHÔNG TỒN TẠI. Đó là một câu trả lời sai.
    server.use(http.get('/search', () => HttpResponse.json({ error: 'nope' }, { status: 500 })));
    renderSearch();
    await openAndType('entropy');

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert.textContent).toMatch(/không tìm được/i);
    expect(screen.queryByText(/không tìm thấy gì/i)).toBeNull();
  });

  it('"Xem tất cả" chỉ hiện khi máy chủ nói còn nữa', async () => {
    server.use(
      http.get('/search', () =>
        HttpResponse.json({ courses: [], chapters: [hit()], truncated: false }),
      ),
    );
    renderSearch();
    await openAndType('entropy');
    await screen.findByRole('option', {}, { timeout: 3000 });
    expect(screen.queryByText(/xem tất cả/i)).toBeNull();
  });

  it('listbox chỉ chứa option — ghi chú và "Xem tất cả" nằm ngoài nó', async () => {
    server.use(
      http.get('/search', () =>
        HttpResponse.json({
          courses: [{ slug: 'khoa-a', title: 'Khoá A', description: 'mô tả' }],
          chapters: [hit()],
          truncated: true,
        }),
      ),
    );
    renderSearch();
    await openAndType('entropy');

    const list = await screen.findByRole('listbox', {}, { timeout: 3000 });
    // Hai hit = hai option, và "Xem tất cả" KHÔNG phải một trong số đó: một
    // listbox có con không phải option nói dối về số lựa chọn mà ↑/↓ đi qua.
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(list.textContent).not.toMatch(/xem tất cả/i);
    expect(screen.getByText(/xem tất cả/i)).toBeTruthy();
  });

  it('không hiện gì cho khách chưa đăng nhập', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })));
    const { container } = renderSearch();
    await waitFor(() => expect(container.querySelector('.tn-search-wrap')).toBeNull());
  });
});
