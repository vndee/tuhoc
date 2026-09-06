import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ThemeProvider } from '../theme/ThemeContext';
import { Landing } from './Landing';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

const A_COURSE = {
  slug: 'mot-khoa-nao-do',
  title: 'Một khoá nào đó',
  lang: 'vi',
  description: 'Mô tả của khoá, do máy chủ trả về.',
  version: 1,
};

function renderLanding() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={['/']}>
            <Landing />
          </MemoryRouter>
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

function withCatalog(rows: readonly (typeof A_COURSE)[]) {
  server.use(http.get('/courses', () => HttpResponse.json(rows)));
  return renderLanding();
}

function withBrokenCatalog() {
  server.use(http.get('/courses', () => HttpResponse.error()));
  return renderLanding();
}

describe('Landing — mặt viết tay', () => {
  it('khung đầu: câu hỏi là nhan đề, câu dẫn nói đúng sự thật đọc-miễn-phí', () => {
    withCatalog([A_COURSE]);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Đọc cho kỹ, chạm để thấy, hỏi đến khi hiểu.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(t('vi', 'landing.lede'))).toBeInTheDocument();
  });

  it('kết câu chuyện bằng một footer có lối mở danh mục và tài khoản', () => {
    withCatalog([A_COURSE]);

    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: t('vi', 'landing.catalog.all') })).toHaveAttribute(
      'href',
      '/courses',
    );
    expect(within(footer).getByRole('link', { name: t('vi', 'landing.account.cta') })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  /**
   * Điểm khác biệt của sản phẩm phải được CHỨNG MINH ở màn đầu, không chỉ kể
   * bằng một danh sách tính năng. Thanh kéo là ranh giới hành vi của minh hoạ:
   * nếu nó biến mất hoặc chỉ còn là tranh tĩnh, người mới lại không thấy rằng
   * bài học ở đây có thể tự tay thử.
   */
  it('màn đầu có visualization thật: đổi thanh kéo thì kết luận quan sát cũng đổi', () => {
    withCatalog([A_COURSE]);

    const lab = screen.getByRole('region', { name: 'Chạm để thấy' });
    const spread = screen.getByRole('slider', { name: 'Mức độ phân tán' });
    const observation = screen.getByRole('status', { name: 'Điều đang quan sát' });

    expect(lab).toContainElement(spread);
    expect(observation).toHaveTextContent('Một khả năng đang nổi trội.');

    fireEvent.change(spread, { target: { value: '86' } });

    expect(observation).toHaveTextContent('Các khả năng đang gần ngang nhau.');
  });

  /**
   * YÊU CẦU CHỦ DỰ ÁN 03/09/2026: *"trên trang landing page chúng ta không nên
   * để một khoá học cụ thể như vậy, khoá này không phải ai cũng quan tâm và
   * không phải ai cũng hiểu nó là gì"*.
   *
   * Bản trước viết cứng `bat-bien-vong-lap` vào trích đoạn, ghi chú, biên bản,
   * mục lục VÀ nhan đề. Bài này canh điều đó không quay lại: mọi tên khoá trên
   * trang phải đến từ `GET /courses`, và chỉ từ đó.
   */
  it('KHÔNG viết cứng một khoá nào: mọi tên khoá trên trang đều đến từ danh mục', async () => {
    withCatalog([A_COURSE]);
    await screen.findByText(A_COURSE.title, { selector: '.bd-course-title' });

    const rendered = document.body.textContent ?? '';
    for (const dauVet of [/bất biến/i, /vòng lặp/i, /lon_nhat/, /def /, /python/i, /1\.1/]) {
      expect(rendered).not.toMatch(dauVet);
    }
  });

  it('hành động chính đi theo dữ liệu: có khoá thì trỏ tới khoá đầu tiên cùng tên thật của nó', async () => {
    withCatalog([A_COURSE]);
    const read = screen.getByTestId('landing-read');
    await waitFor(() => expect(read).toHaveAttribute('href', `/c/${A_COURSE.slug}`));
    expect(read).toHaveTextContent(A_COURSE.title);
  });

  it('đặt Đặc san sau danh mục và trước máng phấn, không đổi CTA khoá chính', async () => {
    withCatalog([A_COURSE]);
    const catalog = screen.getByRole('heading', { name: t('vi', 'landing.catalog.h') }).closest('section');
    const stories = screen.getByRole('region', { name: t('vi', 'stories.masthead') });
    const footer = screen.getByRole('contentinfo');
    const read = screen.getByTestId('landing-read');

    expect(catalog).not.toHaveClass('bd-scene-last');
    expect(catalog?.compareDocumentPosition(stories) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(stories.compareDocumentPosition(footer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await waitFor(() => expect(read).toHaveAttribute('href', `/c/${A_COURSE.slug}`));
    expect(read).toHaveTextContent(A_COURSE.title);
    expect(within(stories).getByRole('link', { name: 'Một lời nói đi qua đại dương' }))
      .toHaveAttribute('href', '/stories/across-the-noise');
  });

  it('danh mục rỗng: hành động chính về /courses và KHÔNG hứa một khoá nào', async () => {
    withCatalog([]);
    await screen.findByText(t('vi', 'courses.empty'));
    const read = screen.getByTestId('landing-read');
    expect(read).toHaveAttribute('href', '/courses');
    expect(read).toHaveTextContent(t('vi', 'landing.read.catalog'));
  });

  it('danh mục hỏng: nói ra lỗi, cho một đường thử lại, và hành động chính về /courses', async () => {
    withBrokenCatalog();
    expect(await screen.findByText(t('vi', 'landing.catalog.error'), { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('vi', 'landing.catalog.retry') })).toBeInTheDocument();
    expect(screen.queryByText(t('vi', 'courses.empty'))).not.toBeInTheDocument();
    expect(screen.getByTestId('landing-read')).toHaveAttribute('href', '/courses');
  });

  /**
   * Cơ chế là thứ trang này chứng minh, và nó phải chứng minh bằng cách CẦM
   * cùng một chuỗi ở hai chỗ: ghi chú của người học, rồi câu gia sư trích lại.
   * Nếu hai chỗ ấy rời nhau thì trang chỉ đang nói suông.
   */
  it('gia sư cầm ĐÚNG ghi chú: cùng một chuỗi xuất hiện ở ghi chú và trong câu trích', () => {
    withCatalog([A_COURSE]);
    const note = t('vi', 'landing.demo.note');
    expect(screen.getByText(note, { selector: '.bd-note-quote' })).toBeInTheDocument();
    expect(screen.getByText(note, { selector: 'blockquote' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t('vi', 'landing.demo.h') })).toBeInTheDocument();
    expect(screen.getByText(t('vi', 'landing.demo.example'))).toBeInTheDocument();
    expect(t('vi', 'landing.demo.example')).toMatch(/ví dụ/i);
  });

  /**
   * `/` cho khách KHÔNG có thanh trên (`App.tsx`: `authScreen`), nên nhãn hiệu,
   * hai điều khiển thiết bị và lối đăng nhập phải nằm trong chính trang này —
   * nếu không, một người không đọc được tiếng Việt gặp màn hình đầu tiên của
   * sản phẩm mà không có đường đổi ngôn ngữ.
   */
  it('trang tự mang nhãn hiệu, nút chủ đề, bộ chọn ngôn ngữ và lối đăng nhập', () => {
    withCatalog([A_COURSE]);
    expect(screen.getByText(t('vi', 'app.name'), { selector: '.bd-wordmark' })).toBeInTheDocument();
    expect(document.querySelector('.bd-chrome-btn')).not.toBeNull();
    expect(screen.getByRole('button', { name: t('vi', 'lang.switcher.label') })).toHaveAttribute(
      'id',
      'lang-select',
    );
    expect(screen.getAllByRole('link', { name: t('vi', 'landing.login.cta') }).length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Native `<select>` mở popup xanh của hệ điều hành nên không thể mang ngôn
   * ngữ giấy/phấn của landing. Menu riêng chỉ đáng tồn tại nếu vẫn giữ đủ hành
   * vi thật: mở, cho biết lựa chọn hiện tại, đổi catalog và tự đóng.
   */
  it('mở menu ngôn ngữ riêng, đánh dấu lựa chọn hiện tại và đổi toàn bộ trang', async () => {
    const user = userEvent.setup();
    withCatalog([A_COURSE]);

    const trigger = screen.getByRole('button', { name: t('vi', 'lang.switcher.label') });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(trigger);

    const menu = screen.getByRole('menu', { name: t('vi', 'lang.switcher.label') });
    expect(within(menu).getByRole('menuitemradio', { name: 'VI — Tiếng Việt' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const english = within(menu).getByRole('menuitemradio', { name: 'EN — English' });
    expect(english).toHaveAttribute('aria-checked', 'false');

    await user.click(english);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: t('en', 'landing.question') })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  it('menu ngôn ngữ dùng được bằng phím mũi tên, Escape và tự đóng khi bấm ra ngoài', async () => {
    withCatalog([A_COURSE]);
    const trigger = screen.getByRole('button', { name: t('vi', 'lang.switcher.label') });

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const menu = screen.getByRole('menu', { name: t('vi', 'lang.switcher.label') });
    const vietnamese = within(menu).getByRole('menuitemradio', { name: 'VI — Tiếng Việt' });
    const english = within(menu).getByRole('menuitemradio', { name: 'EN — English' });
    await waitFor(() => expect(vietnamese).toHaveFocus());

    fireEvent.keyDown(vietnamese, { key: 'ArrowDown' });
    expect(english).toHaveFocus();

    fireEvent.keyDown(english, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('danh mục thật: mỗi khoá là một liên kết tới trang khoá, kèm đường vào tài khoản', async () => {
    withCatalog([A_COURSE]);
    const title = await screen.findByText(A_COURSE.title, { selector: '.bd-course-title' });
    expect(title.closest('a')).toHaveAttribute('href', `/c/${A_COURSE.slug}`);
    expect(screen.getAllByRole('link', { name: t('vi', 'landing.account.cta') }).length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Nhãn "Hướng đi" và câu tầm nhìn đã gỡ khỏi trang theo yêu cầu chủ dự án
   * (03/09/2026); tầm nhìn vẫn được ghi ở PRODUCT.md. Bài này canh HAI điều
   * còn lại và cả hai đều đáng canh:
   *
   *  - hình vẫn là hình MANG NGHĨA, không phải trang trí — nó phải có tên trợ
   *    năng thật, vì nó là thứ duy nhất còn nói ra điều trang này tin;
   *  - và câu tầm nhìn KHÔNG lặng lẽ quay lại giữa các mục kể tính năng. Nếu
   *    một lượt sửa lời sau này đưa nó về mà không có nhãn phân biệt, nó sẽ
   *    đọc ra như một lời hứa về thứ chưa chạy (PRODUCT.md, mục Vision).
   */
  it('hình mang tên trợ năng thật, và trang không nói tầm nhìn như một tính năng', () => {
    withCatalog([A_COURSE]);

    const figure = document.querySelector('.bd-figure');
    expect(figure).toHaveAttribute('role', 'img');
    expect(figure).not.toHaveAttribute('aria-hidden');
    expect(figure).toHaveAccessibleName(t('vi', 'landing.vision.figure'));

    const rendered = document.body.textContent ?? '';
    for (const loiHua of [/cá nhân hoá/i, /lộ trình riêng/i, /học thay/i]) {
      expect(rendered).not.toMatch(loiHua);
    }
  });

  /**
   * `.board-room` là lớp mà `test/syncLifecycle.test.tsx` dùng để nhận ra "app
   * đã dựng xong cho một người nó không quen". Đổi tên nó sẽ làm một phép đo về
   * vòng đời ĐỒNG BỘ đỏ ở một tệp khác, vì một lý do THẨM MỸ.
   */
  it('giữ nguyên lớp `.board-room` mà syncLifecycle.test.tsx bám vào', () => {
    withCatalog([A_COURSE]);
    expect(document.querySelectorAll('.board-room')).toHaveLength(1);
  });

  /**
   * ĐIỀU CẤM của chủ dự án (phỏng vấn 02/09/2026): landing không được nghe như
   * SaaS bán khoá học — không giá, không lời chứng thực, không logo đối tác.
   * Quét cả hai ngôn ngữ.
   */
  it.each(['vi', 'en'] as const)('không có giá, lời chứng thực, hay logo đối tác (%s)', async (lang) => {
    localStorage.setItem('itbook-lang', lang);
    withCatalog([A_COURSE]);
    await screen.findByText(A_COURSE.title, { selector: '.bd-course-title' });

    const rendered = document.body.textContent ?? '';
    for (const cam of [
      /\d[\d.]*\s?(₫|vnd|đ\b)/i,
      /\$\s?\d/,
      /\/tháng/i,
      /per month/i,
      /khách hàng nói/i,
      /customers say/i,
      /đối tác/i,
      /trusted by/i,
      /★/,
    ]) {
      expect(rendered).not.toMatch(cam);
    }
  });
});
