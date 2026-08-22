import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from './client';
import {
  MalformedRatingsError,
  assertRatings,
  fetchRatings,
  putRating,
  ratingsPath,
  ratingsQueryKey,
} from './ratings';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function summary(over: Record<string, unknown> = {}) {
  return { id: 'so-dau-phay-dong', average: 4.5, count: 12, mine: 5, ...over };
}

/* ====================================================================== *
 * 1. RÀNG BUỘC 2 — KHÔNG LỘ DANH TÍNH NGƯỜI CHẤM
 * ====================================================================== */

describe('assertRatings — hàng rào ẩn danh ở RANH GIỚI', () => {
  /**
   * Đây là bài chịu lực của ràng buộc "không lộ danh tính người chấm".
   *
   * Tầng Go chốt tập khoá JSON bằng `TestListReturnsAggregateNotVoters`, và
   * mutant M4 của nó — thêm trường `voters` — chết ở đó. Nhưng cổng ấy canh
   * MÁY CHỦ CỦA TA. Bài này canh thứ khác: cái gì đi được vào cây React.
   * Một máy chủ cũ hơn, một proxy, hay chính một thay đổi tương lai ở
   * `apps/api` gửi kèm `voters` thì mọi màn hình ở dưới đều có sẵn dữ liệu
   * để lỡ vẽ ra.
   *
   * Phép chống KHÔNG phải là từ chối trường lạ (thứ làm hỏng khả năng tiến
   * hoá của giao thức), mà là **dựng lại object từ đúng bốn trường đã biết**.
   * Sau ranh giới này, `voters` không tồn tại — không phải "không được vẽ".
   */
  it('BÓC trường lạ đi: một hồi đáp kèm `voters` ra khỏi ranh giới với ĐÚNG bốn khoá', () => {
    const out = assertRatings([
      summary({ voters: [{ id: 'u1', email: 'alice@vi.vn' }], ratedBy: 'alice' }),
    ]);

    expect(Object.keys(out[0]).sort()).toEqual(['average', 'count', 'id', 'mine']);
    expect(JSON.stringify(out)).not.toContain('alice');
    expect(JSON.stringify(out)).not.toContain('voters');
  });

  /** Chiều ngược lại — nếu không có nó, một hàm trả `[]` cũng xanh. */
  it('giữ NGUYÊN bốn trường thật, đúng giá trị', () => {
    expect(assertRatings([summary()])).toEqual([
      { id: 'so-dau-phay-dong', average: 4.5, count: 12, mine: 5 },
    ]);
  });

  it('`mine` là phiếu của chính người gọi, và 0 nghĩa là chưa chấm', () => {
    expect(assertRatings([summary({ mine: 0 })])[0].mine).toBe(0);
  });
});

describe('assertRatings — hình dạng, cùng khuôn assertStats', () => {
  it('thân không phải mảng → MalformedRatingsError, không phải một crash lúc render', () => {
    expect(() => assertRatings({ items: [] })).toThrow(MalformedRatingsError);
    expect(() => assertRatings(null)).toThrow(MalformedRatingsError);
    expect(() => assertRatings('<!doctype html>')).toThrow(MalformedRatingsError);
  });

  it('nêu ĐÍCH DANH trường sai, ở đúng chỉ số của nó', () => {
    try {
      assertRatings([summary(), summary({ count: 'nhiều' })]);
      expect.unreachable('phải ném');
    } catch (error) {
      expect(error).toBeInstanceOf(MalformedRatingsError);
      expect((error as MalformedRatingsError).message).toContain('[1].count');
    }
  });

  it.each([
    ['average không phải số', summary({ average: '4.5' })],
    ['average là NaN', summary({ average: Number.NaN })],
    ['average ngoài 0..5', summary({ average: 6 })],
    ['count âm', summary({ count: -1 })],
    ['count không nguyên', summary({ count: 1.5 })],
    ['mine ngoài 0..5', summary({ mine: 7 })],
    ['id không phải chuỗi', summary({ id: 7 })],
    ['phần tử là null', null],
  ])('từ chối: %s', (_name, bad) => {
    expect(() => assertRatings([bad])).toThrow(MalformedRatingsError);
  });

  it('mảng rỗng là câu trả lời HỢP LỆ — "chưa ai chấm" không phải một lỗi', () => {
    expect(assertRatings([])).toEqual([]);
  });
});

/* ====================================================================== *
 * 2. HỢP ĐỒNG DÂY — `?ids=` là BẮT BUỘC
 * ====================================================================== */

describe('ratingsPath', () => {
  /**
   * Tầng Go trả **400** cho `GET /ratings` trần, có chủ ý: mảng rỗng không
   * phân biệt được với "chưa ai chấm gì" và mời người sau "sửa" nó thành trả
   * về tất cả — thứ sẽ công khai id của mọi course riêng tư từng được chấm
   * (báo cáo Task 2+3 §2.5, mutant M3).
   *
   * Nên phía web KHÔNG BAO GIỜ được phép gửi một request không có `ids`.
   */
  it('luôn mang `ids=`, và mã hoá từng id', () => {
    expect(ratingsPath(['a', 'b'])).toBe('/ratings?ids=a%2Cb');
    expect(ratingsPath(['có dấu/lạ'])).toBe(`/ratings?ids=${encodeURIComponent('có dấu/lạ')}`);
  });

  it('KHÔNG gọi mạng khi không có id nào — danh sách rỗng là 0 request, không phải một 400', async () => {
    // MSW ở chế độ `onUnhandledRequest: 'error'`, và KHÔNG handler nào được
    // đăng ký ở đây. Nếu `fetchRatings([])` lỡ gọi mạng, bài này đỏ.
    await expect(fetchRatings([])).resolves.toEqual([]);
  });
});

describe('ratingsQueryKey', () => {
  it('cùng tập id, khác thứ tự → CÙNG một khoá cache', () => {
    expect(ratingsQueryKey(['b', 'a'])).toEqual(ratingsQueryKey(['a', 'b']));
  });

  it('khác tập id → khác khoá', () => {
    expect(ratingsQueryKey(['a'])).not.toEqual(ratingsQueryKey(['a', 'b']));
  });
});

/* ====================================================================== *
 * 3. fetchRatings / putRating trên dây thật (MSW)
 * ====================================================================== */

describe('fetchRatings', () => {
  it('gửi đúng những id được hỏi, và không gửi gì khác', async () => {
    let seen: string | null = null;
    server.use(
      http.get('/ratings', ({ request }) => {
        seen = new URL(request.url).searchParams.get('ids');
        return HttpResponse.json([summary()]);
      }),
    );

    await fetchRatings(['so-dau-phay-dong']);
    expect(seen).toBe('so-dau-phay-dong');
  });

  it('một 200 mang HTML (SPA fallback) không đi tiếp được — đúng lớp lỗi 815a472', async () => {
    server.use(http.get('/ratings', () => HttpResponse.html('<!doctype html><p>404</p>')));
    await expect(fetchRatings(['x'])).rejects.toThrow();
  });
});

describe('putRating', () => {
  it('PUT tới /ratings/:registryId, thân đúng {"stars"} và KHÔNG gì khác', async () => {
    let method = '';
    let body: unknown = null;
    let path = '';
    server.use(
      http.put('/ratings/:id', async ({ request, params }) => {
        method = request.method;
        path = String(params.id);
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await putRating('so-dau-phay-dong', 4);

    expect(method).toBe('PUT');
    expect(path).toBe('so-dau-phay-dong');
    // `toEqual` trên CẢ object, không `body.stars === 4`: bài thứ hai vẫn
    // xanh cho một thân lỡ mọc thêm `user_id`. Tầng Go không đọc nó, nhưng
    // gửi đi một định danh mà máy chủ có lý do để bỏ qua là cách một trường
    // như thế sống sót tới ngày ai đó đọc nó.
    expect(body).toEqual({ stars: 4 });
  });

  it('204 không thân → hoàn thành, không ném', async () => {
    server.use(http.put('/ratings/:id', () => new HttpResponse(null, { status: 204 })));
    await expect(putRating('x', 5)).resolves.toBeUndefined();
  });

  it('507 (quá nhiều course đã chấm) tới được chỗ gọi dưới dạng ApiError', async () => {
    server.use(
      http.put('/ratings/:id', () =>
        HttpResponse.json({ error: 'too many rated courses' }, { status: 507 }),
      ),
    );
    await expect(putRating('x', 5)).rejects.toBeInstanceOf(ApiError);
    await expect(putRating('x', 5)).rejects.toMatchObject({ status: 507 });
  });
});
