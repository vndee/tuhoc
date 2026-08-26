import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { Courses } from './Courses';

/**
 * `/courses` — MỘT danh mục, không tab, không nút nhập.
 *
 * Đặc tả: `docs/superpowers/specs/2026-08-25-server-side-pivot.md` §1, §2.4.
 * Server là nguồn duy nhất của mọi course, đọc công khai không cần đăng nhập,
 * và không còn gì để "nhập" — nút "Nhập gói" cùng hai tab ("Của bạn" / "Kho
 * cộng đồng") của bản trước đã đi cùng luồng import.
 *
 * `fetchCatalog` (Task 10, `api/catalog.ts`) là nguồn DUY NHẤT màn hình này
 * đọc — không `db.packages`, không `GET /stats`, không `useOwnedCourses`.
 * Mỗi hàng là một course thật của `index.json`/server: `slug`, `title`,
 * `description`, không có trường `tier` (format v2 bỏ nó — xem
 * `api/courses.ts`'s comment về `TIER_REMOVED`), nên màn này không vẽ nhãn
 * hạng nào.
 */

function catalogRow(slug: string, title: string, description = '') {
  return { slug, title, lang: 'vi', description, version: 1 };
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderCourses() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/courses']}>
          <Courses />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('/courses — danh mục công khai', () => {
  it('vẽ tiêu đề, mô tả từng khoá, và mỗi hàng liên kết tới /c/:slug', async () => {
    server.use(
      http.get('/courses', () =>
        HttpResponse.json([
          catalogRow('so-dau-phay-dong', 'Số dấu phẩy động', 'Vì sao 0.1 + 0.2 không bằng 0.3'),
          catalogRow('bat-bien-vong-lap', 'Bất biến vòng lặp', 'Chứng minh một vòng lặp làm đúng việc'),
        ]),
      ),
    );

    renderCourses();

    expect(await screen.findByRole('heading', { name: 'Khoá học', level: 1 })).toBeInTheDocument();

    const rowA = (await screen.findByText('Số dấu phẩy động')).closest('li') as HTMLElement;
    expect(within(rowA).getByText('Vì sao 0.1 + 0.2 không bằng 0.3')).toBeInTheDocument();
    expect(within(rowA).getByRole('link')).toHaveAttribute('href', '/c/so-dau-phay-dong');

    const rowB = (await screen.findByText('Bất biến vòng lặp')).closest('li') as HTMLElement;
    expect(within(rowB).getByRole('link')).toHaveAttribute('href', '/c/bat-bien-vong-lap');
  });

  it('không còn tab nào, không còn nút "Nhập gói" nào — đọc là chỉ đọc', async () => {
    server.use(http.get('/courses', () => HttpResponse.json([catalogRow('demo', 'Demo')])));

    renderCourses();
    await screen.findByText('Demo');

    expect(screen.queryByRole('navigation', { name: /hai kho khoá học/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /nhập gói/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('danh mục rỗng nói ra điều đó, không phải một khoảng trắng', async () => {
    server.use(http.get('/courses', () => HttpResponse.json([])));

    renderCourses();

    expect(await screen.findByText(/chưa có khoá học nào/i)).toBeInTheDocument();
  });

  it('máy chủ không trả lời → describeCourseError nói ra, bằng đúng câu chữ describeCourseError dùng ở mọi nơi khác', async () => {
    // Không có handler nào cho GET /courses: msw ném lỗi bên trong khi xử lý
    // request, và `fetch` phía trình duyệt thấy đúng một `TypeError` không kèm
    // response — cùng hình dạng CORS-hỏng-trông-như-mất-mạng mà
    // `describeCourseError` đã viết ra lý do (ruling S1-F25).
    server.use(http.get('/courses', () => HttpResponse.error()));

    renderCourses();

    expect(await screen.findByText('Không tải được khóa học: đã xảy ra lỗi không xác định.')).toBeInTheDocument();
  });

  it('máy chủ trả lời nhưng báo lỗi (HTTP 500) thì nói đúng mã lỗi ấy — khác với "không trả lời"', async () => {
    server.use(http.get('/courses', () => new HttpResponse(null, { status: 500 })));

    renderCourses();

    expect(await screen.findByText('Không tải được khóa học: máy chủ báo lỗi (HTTP 500).')).toBeInTheDocument();
  });
});
