/**
 * RỜI MỘT CHƯƠNG BẰNG ĐIỀU HƯỚNG SPA — nội dung route phải ĐỔI.
 *
 * ## Bài kiểm này đo cái gì
 *
 * Không phải "hàm dọn dẹp có chạy". Không phải "portal có gỡ đúng nút". Câu
 * hỏi duy nhất ở đây là câu người học hỏi: **bấm một liên kết trong khi đang
 * đọc chương thì có đi đâu không?** Nên mọi khẳng định dưới đây đọc từ màn
 * hình: tiêu đề của trang ĐÍCH phải xuất hiện, chữ của CHƯƠNG phải biến mất,
 * và `<ErrorBoundary>` phải KHÔNG được kích hoạt.
 *
 * ## Vì sao `<ErrorBoundary>` là một khẳng định, không phải một ghi chú
 *
 * `ErrorBoundary` bọc `<AppRoutes>` (App.tsx). Nó là lưới an toàn cuối cùng,
 * không phải phép sửa — và trước bản sửa này nó đang NUỐT đúng lỗi mà bài kiểm
 * này săn. Một bài kiểm chỉ hỏi "URL có đổi không" sẽ xanh trong khi màn hình
 * hiện bảng "Màn hình này gặp lỗi"; một bài kiểm chỉ hỏi "trang đích có hiện
 * không" sẽ đỏ đúng, nhưng không nói được là vì boundary hay vì trang đích
 * hỏng. Ba khẳng định cùng lúc mới ghim được cả hai đầu: **đi tới nơi, VÀ
 * không có lỗi nào chạm tới lưới an toàn.**
 *
 * ## Nguyên nhân bài kiểm này ghim (đo được 2026-08-22, xem báo cáo)
 *
 * `<Topbar>` dựng `<div id="crumb">{!isChapterRoute && 'Tuhoc'}</div>` —
 * và `<ChapterView>` PORTAL nội dung của nó vào đúng nút DOM ấy. Khi rời
 * chương, `children` của `#crumb` đổi từ `false` sang CHUỖI `'Tuhoc'`;
 * react-dom coi một `children` kiểu chuỗi là trường hợp đặc biệt và commit nó
 * bằng `setTextContent(node, 'Tuhoc')` — tức `node.textContent = …`, thứ **xoá
 * sạch mọi con**, kể cả con của portal mà React tin là mình đang giữ. Ngay
 * commit sau đó React gỡ portal và gọi `crumb.removeChild(<span>)` trên một
 * nút đã không còn là con → `NotFoundError`, ném GIỮA giai đoạn commit, nên cả
 * lần commit chuyển route bị bỏ dở: URL đã đổi (history đổi trước), nội dung
 * thì không.
 *
 * Đó là lý do bốn phép đo trong `e2e/s2.spec.ts` khớp đến từng chi tiết: sang
 * `/library` cũng hỏng (mọi route KHÔNG-chương đều bật chuỗi ấy lên), bản dựng
 * không có kho khoá cũng hỏng (`#crumb` chẳng liên quan gì tới AI), còn đi từ
 * bảng điều khiển thì chạy đúng (`#crumb` đã là `'Tuhoc'` sẵn, không có portal
 * nào để xoá).
 *
 * ## Vì sao bài kiểm này ở đây chứ không ở `test/breadcrumb.test.tsx`
 *
 * `breadcrumb.test.tsx` đã dựng đúng bộ đôi Topbar+ChapterView này và vẫn xanh
 * suốt — vì cả ba bài của nó **chưa bao giờ đi từ một route chương sang một
 * route không-chương**: bài thứ ba render THẲNG vào `/c/demo`. Đúng bài học S2
 * Task 9 — một dây bẫy còn xanh không có nghĩa nó còn đo đúng thứ nó từng đo.
 * Chuyển tiếp mới là phép đo, và chuyển tiếp là việc của đường THÁO trong
 * `reader/`, nên nó nằm cạnh `ChapterView`.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { clearLocalData } from '../db/local';

// Bốn script của course-kit không tải được trong jsdom, và bài kiểm này không
// nói gì về chúng — nó nói về đường THÁO. Cùng cách mock như
// `test/breadcrumb.test.tsx`.
vi.mock('./useCourseKit', () => ({
  useCourseKit: () => ({ ready: true, error: null }),
  ensureCourseKitRuntime: () => Promise.resolve(),
}));

const CHAPTER_1_HTML = '<h1 class="ch-title">Chương một</h1><p>NỘI-DUNG-CHƯƠNG-MỘT</p>';

const manifest = {
  id: 'demo',
  title: 'Khóa học demo',
  description: 'desc',
  lang: 'vi',
  version: '1.0.0',
  runtime: '^1',
  parts: [
    {
      title: 'Phần 1',
      chapters: [
        { id: 'c1', num: '1.1', title: 'Chương một', short: 'C1', file: 'chapters/c1.html' },
        { id: 'c2', num: '1.2', title: 'Chương hai', short: 'C2', file: 'chapters/c2.html' },
      ],
    },
  ],
};

const server = setupServer(
  http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'Người học' })),
  http.get('/courses', () => HttpResponse.json([])),
  http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })),
  http.get('/courses/demo/manifest.json', () => HttpResponse.json(manifest)),
  http.get('/courses/demo/chapters/c1.html', () => HttpResponse.text(CHAPTER_1_HTML)),
  // `App` khởi động vòng đồng bộ nền ngay khi `GET /me` trả về một người dùng
  // đã đăng nhập (App.tsx → `useSyncLifecycle`), nên `onUnhandledRequest:
  // 'error'` sẽ nổ ở đây nếu ba đầu này không có mặt. Chúng là NHIỄU với bài
  // kiểm này — không khẳng định gì về chúng — nhưng bỏ `'error'` đi thì mọi
  // lời gọi mạng bất ngờ khác cũng im lặng theo, nên khai báo còn hơn tắt cổng.
  http.get('/sync', () => HttpResponse.json({ progress: [], annotations: [], cursor: '' })),
  http.post('/sync', () => HttpResponse.json({ applied: 0 })),
  http.post('/events/batch', () => HttpResponse.json({ accepted: 0 })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(async () => {
  await clearLocalData();
  window.CourseKit = { renderKatex: vi.fn(), initViz: vi.fn(), REDRAWS: [], VIZ: {} };
  window.history.pushState({}, '', '/c/demo/c1');
});
afterEach(async () => {
  await clearLocalData();
});

/** Màn hình đang thật sự hiển thị một chương — không phải "URL trỏ vào chương". */
async function readingChapterOne(): Promise<void> {
  await screen.findByText('NỘI-DUNG-CHƯƠNG-MỘT');
  // Đối chứng cho chính bài kiểm: portal breadcrumb ĐÃ nằm trong `#crumb`.
  // Không có nó thì "rời chương không hỏng" là vô nghĩa — chẳng có gì để hỏng.
  await waitFor(() =>
    expect(document.getElementById('crumb')?.querySelector('b')?.textContent).toBe('1.1 Chương một'),
  );
}

/**
 * Lưới an toàn có bị chạm không. `role="alert"` là thứ `<ErrorBoundary>` dựng;
 * so bằng `null` chứ không `toContain`, vì một khẳng định kiểu "có chứa" ở đây
 * đúng với cả rác — đúng lớp lỗi mà hai bài kiểm giả trước đó mắc phải.
 */
function errorBoundaryFallback(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.eb-fallback');
}

/**
 * MỘT lối ra, và đây là nó.
 *
 * Hai bài kiểm dưới đây từng bấm vào thanh bên ứng dụng từ bên trong chương.
 * Chế độ đọc (hướng A) không có thanh bên — `styles/reader-layout.css` đặt
 * `#app.reading #sidebar{display:none}`, và vitest chạy với `css: true`, nên
 * ở đây nó cũng thật sự biến mất chứ không chỉ trên trình duyệt. Đó CHÍNH là
 * thay đổi: năm liên kết phẳng trong chương thành một lối ra ở góc trái trên.
 *
 * Chuyển tiếp mà cả tệp này tồn tại để đo — route CHƯƠNG sang route
 * KHÔNG-chương, thứ bật `#crumb`'s `children` từ `false` sang chuỗi `'Tuhoc'`
 * — vẫn nguyên vẹn; nó chỉ đi qua nút này thay vì qua thanh bên.
 */
async function leaveReadingMode(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('link', { name: /thoát chế độ đọc/i }));
}

describe('rời chương bằng điều hướng SPA', () => {
  it('bấm lối ra từ trong chương: nội dung route ĐỔI, chương biến mất, không lỗi — rồi đi tiếp tới Khoá học', async () => {
    render(<App />);
    await readingChapterOne();

    const user = userEvent.setup();
    await leaveReadingMode(user);

    // 1. Trang ĐÍCH đã dựng. Đây là khẳng định chính — không phải `location`,
    //    vì chính lỗi này để URL đổi mà nội dung thì không.
    //
    //    Đích là TRANG CHỦ, không phải /courses: đặc tả IA nói lối ra dẫn
    //    'về CHẾ ĐỘ thư viện', và nhà của chế độ ấy là 'Học tiếp'. Thả người
    //    đọc xuống danh sách toàn bộ khoá học là trả lời một câu hỏi họ
    //    không hỏi.
    expect(await screen.findByRole('heading', { name: /bảng điều khiển|học tiếp/i })).toBeInTheDocument();

    // 2. Chương đã đi khỏi màn hình. Không có nửa này thì hai route chồng lên
    //    nhau vẫn tính là xanh.
    expect(screen.queryByText('NỘI-DUNG-CHƯƠNG-MỘT')).toBeNull();

    // 3. Không có lỗi nào chạm tới lưới an toàn. Sau bản sửa này lỗi
    //    `removeChild` phải KHÔNG tồn tại nữa, chứ không phải bị bắt gọn.
    expect(errorBoundaryFallback()).toBeNull();

    // 4. `#crumb` đã được DỌN SẠCH — so bằng đúng với chuỗi rỗng, không
    //    `toContain`: một `#crumb` còn dính breadcrumb cũ là đúng lỗi mà số 4
    //    này tồn tại để bắt. Nó từng đòi chữ 'Tuhoc' vì Topbar in tên app ở
    //    đó; nhãn hiệu nay đứng ở đầu thanh trên nên `#crumb` rỗng ngoài
    //    trang chương, và phép so bằng đúng giữ nguyên độ chặt.
    expect(document.getElementById('crumb')?.textContent).toBe('');

    // 5. Và lối ra dẫn tới một nơi CÓ đường đi tiếp: điều hướng toàn cục đã
    //    trở lại ở chế độ thư viện (nay trên thanh trên, không phải thanh
    //    bên), nên đích cũ của bài kiểm này vẫn tới được. Không có nửa này,
    //    "thoát được" có thể chỉ là "thoát vào ngõ cụt".
    const nav = screen.getByRole('navigation', { name: /điều hướng chính/i });
    await user.click(within(nav).getByRole('link', { name: /khoá học/i }));
    // 'Khoá học', không phải 'Thư viện': `/courses` gộp thư viện, kho cộng đồng
    // và nút nhập gói (đặc tả IA), nên nhan đề đổi theo. `level: 1` để không
    // khớp nhầm nhan đề của một tab bên trong.
    expect(await screen.findByRole('heading', { name: 'Khoá học', level: 1 })).toBeInTheDocument();
    expect(errorBoundaryFallback()).toBeNull();
  });

  it('rời chương rồi vào Cài đặt: trang thật sự dựng ra, ở mục trung tính', async () => {
    // Chủ đề là CHUYỂN TIẾP ROUTE — `/settings` có dựng ra sau khi rời chương
    // không — chứ không phải mục nào đang hiện; đi bằng lối ra + điều hướng
    // toàn cục thay vì qua panel AI, cùng một chuyển tiếp, không cần kho khoá.
    //
    // Bài này TỪNG đòi nhan đề 'Trợ lý AI', vì đó tình cờ là mục mặc định. Nay
    // mặc định là 'Tài khoản' (xem `pages/Settings.tsx`), và đòi đúng nhan đề
    // ấy làm bài kiểm mạnh lên chứ không yếu đi: nó phải chứng minh đúng điều
    // người dùng báo — bấm 'Cài đặt' không được ném ra một trang cấu hình AI.
    //
    // LỐI VÀO ĐÃ DỜI CHỖ, và điều đó chính là thứ đáng canh nhất ở đây. Nó
    // từng ở đáy thanh bên; thanh bên nay chỉ mang mục lục nên nó không còn
    // sống ở đó được. Nếu nó không mọc lại ở đâu cả thì `/settings` chỉ tới
    // được bằng cách gõ URL — đúng hình dạng "cổng mù #4" mà chính route ấy
    // sinh ra để vá. Nên bài này KHÔNG khoanh vùng vào `<nav>` nữa: câu hỏi là
    // "có tới được bằng một cú bấm không", không phải "cú bấm ấy nằm trong thẻ
    // nào". Hôm nay câu trả lời là `AccountChip` ở mép phải thanh trên.
    render(<App />);
    await readingChapterOne();

    const user = userEvent.setup();
    await leaveReadingMode(user);
    expect(await screen.findByRole('heading', { name: /bảng điều khiển|học tiếp/i })).toBeInTheDocument();
    expect(screen.queryByText('NỘI-DUNG-CHƯƠNG-MỘT')).toBeNull();

    await user.click(screen.getByRole('link', { name: /cài đặt/i }));

    expect(await screen.findByRole('heading', { name: 'Tài khoản' })).toBeInTheDocument();
    expect(document.querySelector('.page-settings')).not.toBeNull();
    // Và không có lớp phủ kho khoá nào bung ra: đây là lỗi người dùng báo,
    // bắt ở đúng lối vào sinh ra nó.
    expect(document.querySelector('.vault-overlay')).toBeNull();
    expect(errorBoundaryFallback()).toBeNull();
  });

  it('trong chương, thanh bên ứng dụng KHÔNG có mặt — một lối ra, không phải năm', async () => {
    // Vấn đề đặc tả nêu đích danh: trang chương mang mô hình điều hướng THỨ
    // HAI (năm liên kết phẳng + mục lục khoá học trong thanh bên) chồng lên
    // mô hình của chính nó. Chốt này là thứ giữ nó đã đi khỏi.
    render(<App />);
    await readingChapterOne();

    expect(screen.queryByRole('navigation', { name: /điều hướng chính/i })).toBeNull();
    expect(screen.getByRole('link', { name: /thoát chế độ đọc/i })).toBeInTheDocument();
  });

  it('đối chứng: đi từ bảng điều khiển sang thư viện vẫn chạy (đường không đi qua chương)', async () => {
    // Phép đo thứ ba của báo cáo S2, dựng lại thành một chốt: nếu bản sửa làm
    // hỏng đường KHÔNG đi qua chương thì phải thấy ở đây, không phải ở e2e.
    window.history.pushState({}, '', '/');
    render(<App />);

    const nav = await waitFor(() => screen.getByRole('navigation', { name: /điều hướng chính/i }));
    const user = userEvent.setup();
    await user.click(within(nav).getByRole('link', { name: /khoá học/i }));

    expect(await screen.findByRole('heading', { name: 'Khoá học', level: 1 })).toBeInTheDocument();
    expect(errorBoundaryFallback()).toBeNull();
  });
});
