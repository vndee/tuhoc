import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { Landing } from './Landing';
import { DEMO_COURSE, EXAMPLE_NOTE, EXAMPLE_QA } from './landingExcerpt';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const DEMO_ROW = {
  slug: DEMO_COURSE.slug,
  title: DEMO_COURSE.title,
  lang: 'vi',
  description: 'Ba chương về cách chứng minh một vòng lặp đúng cho MỌI đầu vào.',
  version: 1,
};

function renderLanding(catalog: readonly (typeof DEMO_ROW)[]) {
  server.use(http.get('/courses', () => HttpResponse.json(catalog)));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/']}>
          <Landing />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('Landing — hành trình của một câu hỏi', () => {
  it('khung đầu: câu hỏi là nhan đề, câu dẫn nói đúng sự thật đọc-miễn-phí, và hành động chính trỏ tới CHƯƠNG khi khoá mẫu đã xuất bản', async () => {
    renderLanding([DEMO_ROW]);

    expect(screen.getByRole('heading', { level: 1, name: t('vi', 'landing.question') })).toBeInTheDocument();
    expect(screen.getByText(t('vi', 'landing.lede'))).toBeInTheDocument();

    // Hành động chính đổi ĐÍCH theo danh mục: có khoá mẫu → chương 1.1 thật.
    const read = screen.getByTestId('landing-read');
    await waitFor(() => expect(read).toHaveAttribute('href', `/c/${DEMO_COURSE.slug}/${DEMO_COURSE.chapters[0].id}`));
    expect(read).toHaveTextContent(DEMO_COURSE.chapters[0].title);
  });

  it('không có khoá mẫu trong danh mục thì hành động chính về /courses và KHÔNG hứa một chương', async () => {
    renderLanding([]);

    const read = screen.getByTestId('landing-read');
    // Danh mục rỗng vẫn là một trạng thái đã tải xong — chờ nó, không chờ href.
    await screen.findByText(t('vi', 'landing.catalog.empty'));
    expect(read).toHaveAttribute('href', '/courses');
    expect(read).toHaveTextContent(t('vi', 'landing.read.catalog'));
    expect(read).not.toHaveTextContent(DEMO_COURSE.chapters[0].title);
  });

  it('bằng chứng là ví dụ và NÓI vậy: ghi chú lề mang nhãn ví dụ, biên bản hỏi đáp trích đúng ghi chú, hai đầu mục ghi "(ví dụ)"', async () => {
    renderLanding([DEMO_ROW]);
    await screen.findByText(DEMO_ROW.title, { selector: '.courses-item-title' });

    expect(screen.getByText(EXAMPLE_NOTE.text)).toBeInTheDocument();
    expect(screen.getByText(t('vi', 'landing.example'))).toBeInTheDocument();
    // Câu trả lời của gia sư cầm ĐÚNG ghi chú ấy — cùng chuỗi, trong blockquote.
    expect(screen.getByText(EXAMPLE_QA.answerQuote, { selector: 'blockquote' })).toBeInTheDocument();
    expect(EXAMPLE_NOTE.text).toContain(EXAMPLE_QA.answerQuote);
    for (const key of ['landing.note.h', 'landing.ask.h', 'landing.progress.h'] as const) {
      expect(screen.getByRole('heading', { name: t('vi', key) })).toBeInTheDocument();
      expect(t('vi', key)).toMatch(/ví dụ/i);
    }
  });

  it('câu được bôi đen trong trích đoạn là câu ghi chú neo vào', () => {
    renderLanding([DEMO_ROW]);
    const mark = document.querySelector('mark.ld-hl');
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toContain(EXAMPLE_NOTE.quote);
  });

  it('danh mục thật: mỗi khoá là một liên kết tới trang khoá, kèm đường vào tài khoản và đăng nhập', async () => {
    renderLanding([DEMO_ROW]);
    const title = await screen.findByText(DEMO_ROW.title, { selector: '.courses-item-title' });
    expect(title.closest('a')).toHaveAttribute('href', `/c/${DEMO_ROW.slug}`);
    expect(screen.getAllByRole('link', { name: t('vi', 'landing.account.cta') }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('link', { name: t('vi', 'landing.login.cta') })).toHaveAttribute('href', '/login');
  });

  /**
   * ĐIỀU CẤM của chủ dự án (phỏng vấn 02/09/2026): landing không được nghe
   * như SaaS bán khoá học — không giá, không lời chứng thực, không logo đối
   * tác. Quét nguyên văn như `Login.test.tsx`/`Settings.copy.test.tsx`.
   */
  it('không có giá, lời chứng thực, hay logo đối tác ở bất cứ đâu trên trang', async () => {
    renderLanding([DEMO_ROW]);
    await screen.findByText(DEMO_ROW.title, { selector: '.courses-item-title' });
    const rendered = document.body.textContent ?? '';
    for (const cam of [/\d[\d.]*\s?(₫|vnd|đ\b)/i, /\/tháng/i, /khách hàng nói/i, /đối tác/i, /đánh giá \d/i, /★/]) {
      expect(rendered).not.toMatch(cam);
    }
  });
});
