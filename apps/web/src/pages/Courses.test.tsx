import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { clearLocalData } from '../db/local';

/**
 * `/courses` — BA MÀN CŨ GỘP THÀNH MỘT, đo qua `<App/>` thật.
 *
 * Đặc tả: `docs/superpowers/specs/2026-08-23-ia-redesign.md`. Thư viện, kho
 * cộng đồng và phần nhập gói từng là ba mục ngang hàng trên thanh bên dù chúng
 * là **ba loại khác nhau** — hai nơi chốn trùng nghĩa và một hành động. Nay
 * chúng là một nơi chốn, hai tab và một nút.
 *
 * ## Vì sao tệp này chạy `<App/>` chứ không dựng `<Courses/>` một mình
 *
 * Vì hai trong ba khẳng định của nó chỉ đúng khi màn hình được GẮN thật:
 * `?tab=registry` phải sống sót qua router thật, và nút "Nhập gói" phải là thứ
 * người đọc bấm tới được sau khi hai mục thanh bên bị gỡ. `docs/carried-forward.md`
 * ghi lại cổng mù #4 ở đúng hình dạng ngược lại: 775 dòng qua bốn cổng xanh mà
 * không tệp sản phẩm nào nhập chúng. Một `<Courses/>` dựng lẻ sẽ xanh y hệt kể
 * cả khi `routes.tsx` không trỏ vào nó.
 *
 * ## Bộ dữ liệu là MỘT, cố ý
 *
 * `App.tsx` dựng `QueryClient` ở tầm module, nên cache sống xuyên suốt cả tệp.
 * Thay vì `server.use()` từng ca rồi chống lại cache, mọi ca ở đây đọc cùng
 * một thư viện — trong đó có sẵn một khoá hạng `interactive`, thứ ca cuối cần.
 */

/**
 * Một khoá hạng `interactive` — hạng CHẠY MÃ JavaScript trong trình duyệt
 * người đọc. Nó nằm trong bộ dữ liệu nền chứ không phải trong một ca riêng, vì
 * ca cuối tệp này hỏi liệu nhãn ấy có sống sót qua lần gộp màn hình không.
 */
const INTERACTIVE_COURSE = {
  id: 'chay-ma',
  title: 'Khóa có mô phỏng',
  lang: 'vi',
  tier: 'interactive',
  versions: ['1.0.0'],
  pinned: '1.0.0',
};

const server = setupServer(
  http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'Người học' })),
  http.get('/courses', () => HttpResponse.json([INTERACTIVE_COURSE])),
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

function tabs(): HTMLElement {
  return screen.getByRole('navigation', { name: /hai kho khoá học/i });
}

/** Tab đang mở, đọc từ `aria-current` — cùng dấu hiệu `GlobalNav` dùng. */
function openTab(): string {
  const current = within(tabs())
    .getAllByRole('link')
    .find((a) => a.getAttribute('aria-current') === 'page');
  return current?.textContent ?? '(không tab nào)';
}

describe('/courses — hai tab trong một nơi chốn', () => {
  it('mặc định mở tab "Của bạn", và thư viện của người đọc là thứ dựng lên', async () => {
    goTo('/courses');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Khoá học', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Khóa có mô phỏng')).toBeInTheDocument();
    expect(openTab()).toMatch(/của bạn/i);
  });

  it('`?tab=registry` mở thẳng kho cộng đồng — liên kết sâu còn dùng được', async () => {
    // Đây là điều kiện đặc tả đặt ra cho việc gỡ `/catalog`: đường cũ chuyển
    // hướng vào ĐÚNG tham số này, nên nếu tham số ngừng có tác dụng thì mọi
    // dấu trang cũ lặng lẽ rơi xuống nhầm tab.
    goTo('/courses?tab=registry');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /danh mục/i })).toBeInTheDocument();
    expect(openTab()).toMatch(/kho cộng đồng/i);
  });

  it('bấm qua lại giữa hai tab đổi CẢ nội dung LẪN thanh địa chỉ', async () => {
    goTo('/courses');
    render(<App />);
    await screen.findByText('Khóa có mô phỏng');

    const user = userEvent.setup();
    await user.click(within(tabs()).getByRole('link', { name: /kho cộng đồng/i }));

    expect(await screen.findByRole('heading', { name: /danh mục/i })).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe('?tab=registry'));
    // Nửa thứ hai, và không có nó thì "đổi tab" chỉ là "thêm một khối vào
    // trang": thư viện phải THÔI được dựng, không phải bị ẩn đi.
    expect(screen.queryByText('Khóa có mô phỏng')).not.toBeInTheDocument();

    await user.click(within(tabs()).getByRole('link', { name: /của bạn/i }));

    expect(await screen.findByText('Khóa có mô phỏng')).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.queryByRole('heading', { name: /danh mục/i })).not.toBeInTheDocument();
  });
});

describe('/courses — nút "Nhập gói"', () => {
  /**
   * CỬA THAY CHO MỤC THANH BÊN ĐÃ GỠ.
   *
   * `test/globalNav.test.tsx` từng chứng minh "từ Bảng điều khiển có đường tới
   * `/import`" bằng một mục thanh bên. Mục ấy đã đi trong cùng commit này, và
   * phủ sóng ấy chuyển về đây — không bị xoá. Một route chỉ tới được bằng cách
   * gõ URL là một tính năng không tồn tại (S1-F29), và cú bấm dưới đây là thứ
   * duy nhất chứng minh điều ngược lại.
   */
  it('bấm được từ màn Khoá học, và mở ra ĐÚNG màn nhập gói với ô chọn tệp', async () => {
    goTo('/courses');
    render(<App />);
    await screen.findByRole('heading', { name: 'Khoá học', level: 1 });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /nhập gói/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /nhập khóa học/i })).toBeInTheDocument();
    // Không phải một hộp thoại rỗng có đúng cái tên: ba lối vào của
    // `pages/ImportCourse.tsx` phải thật sự ở trong đó.
    expect(within(dialog).getByText(/nhập từ repo/i)).toBeInTheDocument();
    expect(dialog.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('mở bằng URL `?import=1` — đó là thứ chuyển hướng của /import bám vào', async () => {
    goTo('/courses?import=1');
    render(<App />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('Escape đóng hộp thoại VÀ dọn tham số khỏi URL', async () => {
    // Hai nửa, vì bỏ nửa sau là để lại một URL nói rằng hộp thoại đang mở
    // trong khi nó đã đóng — tải lại trang là nó bật lên lần nữa.
    goTo('/courses?import=1');
    render(<App />);
    await screen.findByRole('dialog');

    const user = userEvent.setup();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.search).toBe('');
  });

  it('nút "Đóng" làm đúng việc ấy', async () => {
    goTo('/courses?import=1');
    render(<App />);
    const dialog = await screen.findByRole('dialog');

    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('button', { name: /đóng/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.search).toBe('');
  });
});

/* ====================================================================== *
 * NHÃN HẠNG SỐNG SÓT QUA LẦN GỘP MÀN HÌNH
 *
 * `pages/Library.test.tsx` và `registry/Catalog.test.tsx` canh nhãn hạng trên
 * hai component dựng LẺ. Cả hai vẫn xanh kể cả khi màn hình gộp không dựng
 * component ấy ra nữa — nên chốt dưới đây hỏi câu mà chúng không hỏi được:
 * trên `/courses` THẬT, người đọc có còn thấy rằng khoá này chạy mã không.
 * Đặc tả đổi CÁCH TRÌNH BÀY (một dòng chữ kèm biểu tượng, thay cho viên màu
 * đỏ) và nói thẳng rằng nó KHÔNG đổi việc nhãn luôn hiện.
 * ====================================================================== */

describe('/courses — nhãn hạng interactive (quyết định AN NINH)', () => {
  it('nhãn "chạy mã" hiện ngay trên màn gộp, không chỉ trong test của component lẻ', async () => {
    goTo('/courses');
    render(<App />);

    const title = await screen.findByText('Khóa có mô phỏng');
    const row = title.closest('li');
    expect(row).not.toBeNull();

    expect(within(row as HTMLElement).getByText(/interactive/i)).toBeInTheDocument();
    // Không phải chỉ cái từ, mà NGHĨA của cái từ — đúng thứ đặc tả đòi: nhãn
    // phải tự nói ra, không bắt người đọc học nghĩa của một màu.
    expect(within(row as HTMLElement).getByText(/chạy mã/i)).toBeInTheDocument();
  });
});
