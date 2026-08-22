import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DISCUSSION_REASONS,
  MalformedDiscussionError,
  assertDiscussion,
  discussionQueryKey,
  fetchDiscussion,
  githubHref,
} from './discussions';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function thread(over: Record<string, unknown> = {}) {
  return {
    id: 'so-dau-phay-dong',
    loaded: true,
    reason: '',
    url: 'https://github.com/vndee/tuhoc-registry/discussions/7',
    comments: [
      { id: 'C_1', author: 'ai-do', body: 'Chương 3 có một chỗ khó hiểu.', createdAt: '2026-08-22T00:00:00Z' },
    ],
    ...over,
  };
}

/* ====================================================================== *
 * 1. `comments` KHÔNG BAO GIỜ null — và web không được TIN điều đó
 * ====================================================================== */

describe('assertDiscussion', () => {
  it('đường hạnh phúc đi qua nguyên vẹn', () => {
    const out = assertDiscussion(thread());
    expect(out.loaded).toBe(true);
    expect(out.comments).toHaveLength(1);
    expect(out.comments[0].body).toBe('Chương 3 có một chỗ khó hiểu.');
  });

  /**
   * Hôm nay tầng Go bảo đảm `comments` không bao giờ `null` (mutant M4 của
   * báo cáo Task 5-Go giết bản không bảo đảm). Bài này KHÔNG lặp lại cổng ấy
   * — nó canh chuyện khác: một `null` len tới đây từ BẤT KỲ đâu (proxy, bản
   * máy chủ cũ, một tương lai nào đó) phải thành một thông báo, không thành
   * `.map of null` giữa lúc vẽ. Đúng lớp lỗi đã làm trắng trang ở `815a472`.
   */
  it('`comments: null` → lỗi có tên, KHÔNG phải một crash lúc render', () => {
    expect(() => assertDiscussion(thread({ comments: null }))).toThrow(MalformedDiscussionError);
    expect(() => assertDiscussion(thread({ comments: 'nhiều' }))).toThrow(MalformedDiscussionError);
    expect(() => assertDiscussion('<!doctype html>')).toThrow(MalformedDiscussionError);
    expect(() => assertDiscussion(null)).toThrow(MalformedDiscussionError);
  });

  it('bình luận không đúng hình dạng → lỗi nêu đích danh chỉ số và trường', () => {
    try {
      assertDiscussion(thread({ comments: [{ id: 'C_1', author: 'a', body: 42, createdAt: 'x' }] }));
      expect.unreachable('phải ném');
    } catch (error) {
      expect((error as Error).message).toContain('comments[0].body');
    }
  });

  it('BÓC trường lạ: một bình luận ra khỏi ranh giới với ĐÚNG bốn khoá', () => {
    const out = assertDiscussion(
      thread({
        comments: [
          {
            id: 'C_1',
            author: 'ai-do',
            body: 'x',
            createdAt: '2026-08-22T00:00:00Z',
            // `bodyHTML` là thứ tầng Go cố ý KHÔNG trả về (§4 của báo cáo
            // Task 5-Go). Nếu một ngày nào đó nó xuất hiện trên dây, nó phải
            // chết ở đây chứ không phải chờ ai đó tình cờ không vẽ nó.
            bodyHTML: '<img src=x onerror=alert(1)>',
            authorUrl: 'https://github.com/ai-do',
          },
        ],
      }),
    );
    expect(Object.keys(out.comments[0]).sort()).toEqual(['author', 'body', 'createdAt', 'id']);
    expect(JSON.stringify(out)).not.toContain('onerror');
  });

  it('`author` rỗng là SENTINEL (tài khoản đã bị xoá), không phải dữ liệu hỏng', () => {
    const out = assertDiscussion(thread({ comments: [{ id: 'C_1', author: '', body: 'x', createdAt: 'y' }] }));
    expect(out.comments[0].author).toBe('');
  });

  it('`reason` là TỪ VỰNG ĐÓNG — bốn giá trị, không hơn', () => {
    expect([...DISCUSSION_REASONS].sort()).toEqual(['', 'disabled', 'rate_limited', 'unavailable']);
  });

  /**
   * Một `reason` lạ KHÔNG được ném (nó không làm trang hỏng) và cũng KHÔNG
   * được đi tiếp dưới dạng chính nó — chữ do máy chủ viết không bao giờ được
   * vẽ thẳng lên màn hình, vì nó không dịch được. Xem `Discussion.test.tsx`.
   */
  it('`reason` lạ không ném, và không được coi là một trong bốn từ đã biết', () => {
    const out = assertDiscussion(thread({ loaded: false, reason: 'quota_exceeded_v2' }));
    expect(out.loaded).toBe(false);
    expect(DISCUSSION_REASONS).not.toContain(out.reason);
  });
});

/* ====================================================================== *
 * 2. `url` — RÀNG BUỘC 3 mở rộng: nút "đăng bình luận" là một ĐÍCH ĐẾN
 * ====================================================================== */

describe('githubHref — lớp thứ HAI, sau lớp của tầng Go', () => {
  /**
   * Tầng Go đã ghim `url` vào repo đã cấu hình ở ranh giới, và có ca `url`
   * là `javascript:` trong bảng 22 ca suy giảm của nó. Lớp này vẫn cần thiết
   * và không phải phòng thủ thừa: `href` là một SINK — một `javascript:` URL
   * chạy trong phiên của người đọc — và lớp duy nhất canh nó hôm nay nằm ở
   * một tiến trình khác, một kho mã khác, một vòng đời triển khai khác.
   *
   * `db/local.test.ts` từ chối đúng kiểu lập luận "chỗ khác đã canh rồi" cho
   * `innerHTML`; `href` cùng hạng.
   */
  it.each([
    'javascript:alert(1)',
    // eslint-disable-next-line no-script-url
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://github.com/x/y',
    'https://github.com.kẻ-xấu.vn/x',
    'https://kẻ-xấu.vn/github.com',
    '//kẻ-xấu.vn/x',
    '/discussions/7',
    '',
  ])('từ chối %s', (bad) => {
    expect(githubHref(bad)).toBeNull();
  });

  it.each([null, undefined, 7, {}])('từ chối thứ không phải chuỗi: %s', (bad) => {
    expect(githubHref(bad)).toBeNull();
  });

  /** Chiều ngược lại — nếu không có nó, một hàm trả `null` mãi cũng xanh. */
  it('nhận đúng địa chỉ github.com qua https', () => {
    expect(githubHref('https://github.com/vndee/tuhoc-registry/discussions/7')).toBe(
      'https://github.com/vndee/tuhoc-registry/discussions/7',
    );
    expect(githubHref('https://github.com/vndee/tuhoc-registry/discussions')).not.toBeNull();
  });
});

/* ====================================================================== *
 * 3. Trên dây thật
 * ====================================================================== */

describe('fetchDiscussion', () => {
  it('gọi GET /discussions/:registryId với id đã được mã hoá', async () => {
    let path = '';
    server.use(
      http.get('/discussions/:id', ({ params }) => {
        path = String(params.id);
        return HttpResponse.json(thread());
      }),
    );

    await fetchDiscussion('so-dau-phay-dong');
    expect(path).toBe('so-dau-phay-dong');
  });

  it('trạng thái HÔM NAY — `disabled`, `comments: []`, `url: ""` — đọc được, không ném', async () => {
    server.use(
      http.get('/discussions/:id', () =>
        HttpResponse.json({ id: 'x', loaded: false, reason: 'disabled', url: '', comments: [] }),
      ),
    );

    const out = await fetchDiscussion('x');
    expect(out).toEqual({ id: 'x', loaded: false, reason: 'disabled', url: '', comments: [] });
  });
});

describe('discussionQueryKey', () => {
  it('mỗi course một khoá riêng — hai course không dùng chung cache', () => {
    expect(discussionQueryKey('a')).not.toEqual(discussionQueryKey('b'));
    expect(discussionQueryKey('a')).toEqual(discussionQueryKey('a'));
  });
});
