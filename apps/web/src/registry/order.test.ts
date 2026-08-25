import { describe, expect, it } from 'vitest';
import type { RatingSummary } from '../api/ratings';
import { PRIOR_COUNT, PRIOR_MEAN, orderByRating, ratingScore } from './order';
import type { RegistryEntry } from './types';

function entry(id: string): RegistryEntry {
  return {
    id,
    title: id,
    description: '',
    lang: 'vi',
    license: 'CC-BY-4.0',
    authors: [{ name: 'Ai đó' }],
    generatedBy: 'human',
    versions: ['1.0.0'],
    latest: '1.0.0',
    bytes: 1,
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
}

function ratings(rows: readonly RatingSummary[]): Map<string, RatingSummary> {
  return new Map(rows.map((r) => [r.id, r]));
}

const rated = (id: string, average: number, count: number): RatingSummary => ({ id, average, count, mine: 0 });

const ids = (list: readonly RegistryEntry[]) => list.map((c) => c.id);

describe('ratingScore', () => {
  /**
   * RÀNG BUỘC 2, nửa THỨ TỰ.
   *
   * "Một course 5 sao / 1 phiếu không được trông giống 5 sao / 200 phiếu" nói
   * về hai thứ, và cả hai đều đo được: những con số được VẼ ra (xem
   * `Rating.test.tsx`) và **thứ tự chúng tạo ra**. Sắp theo trung bình trần
   * đặt 5,0 từ một phiếu lên trên 4,8 từ hai trăm phiếu — tức là một tài
   * khoản mới, một phiếu, cũng đủ chiếm đầu danh mục.
   *
   * Nên điểm sắp xếp là trung bình ĐÃ CO về phía giữa theo số phiếu
   * (`(C·m + tổng) / (C + n)`). Hai hằng số là một LỰA CHỌN, không phải một
   * phép đo — xem `order.ts` — nhưng tính chất mà chúng mua thì được ghim ở
   * đây.
   */
  it('5,0 từ MỘT phiếu xếp DƯỚI 4,8 từ hai trăm phiếu', () => {
    expect(ratingScore(rated('a', 5, 1))).toBeLessThan(ratingScore(rated('b', 4.8, 200)));
  });

  it('cùng số phiếu thì trung bình cao hơn thắng', () => {
    expect(ratingScore(rated('a', 4.9, 50))).toBeGreaterThan(ratingScore(rated('b', 4.1, 50)));
  });

  it('cùng trung bình thì nhiều phiếu hơn thắng — khi trung bình trên mức giữa', () => {
    expect(ratingScore(rated('a', 5, 200))).toBeGreaterThan(ratingScore(rated('b', 5, 1)));
  });

  it('chưa có phiếu nào → đúng bằng trung bình tiên nghiệm, không phải 0 và không phải 5', () => {
    expect(ratingScore(rated('a', 0, 0))).toBe(PRIOR_MEAN);
    expect(ratingScore(undefined)).toBe(PRIOR_MEAN);
  });

  /**
   * Chốt cho chính hai hằng số: nếu ai đó đặt `PRIOR_COUNT = 0`, phép co
   * biến mất và bài đầu tiên của khối này đỏ. Ghi ra để lần sửa ấy là một
   * quyết định chứ không phải một lần "dọn dẹp".
   */
  it('hai hằng số ở trong khoảng có nghĩa', () => {
    expect(PRIOR_COUNT).toBeGreaterThan(0);
    expect(PRIOR_MEAN).toBeGreaterThan(1);
    expect(PRIOR_MEAN).toBeLessThan(5);
  });
});

describe('orderByRating', () => {
  it('sắp giảm dần theo điểm', () => {
    const courses = [entry('thấp'), entry('cao'), entry('giữa')];
    const map = ratings([rated('thấp', 2, 40), rated('cao', 4.9, 40), rated('giữa', 3.5, 40)]);
    expect(ids(orderByRating(courses, map))).toEqual(['cao', 'giữa', 'thấp']);
  });

  /**
   * ỔN ĐỊNH. Không có nó, hai course cùng điểm đổi chỗ cho nhau giữa hai lần
   * vẽ — và trên một danh sách có nút "Kéo về" trên mỗi hàng, một hàng nhảy
   * chỗ dưới con trỏ là một cú bấm vào course khác cái người đọc vừa đọc.
   */
  it('ỔN ĐỊNH: điểm bằng nhau thì giữ nguyên thứ tự của registry', () => {
    const courses = [entry('a'), entry('b'), entry('c')];
    const map = ratings([rated('a', 4, 10), rated('b', 4, 10), rated('c', 4, 10)]);
    expect(ids(orderByRating(courses, map))).toEqual(['a', 'b', 'c']);
  });

  it('chưa có điểm cho course nào → nguyên thứ tự registry, không xáo trộn', () => {
    const courses = [entry('a'), entry('b'), entry('c')];
    expect(ids(orderByRating(courses, new Map()))).toEqual(['a', 'b', 'c']);
  });

  it('course CHƯA AI CHẤM xếp dưới course được chấm cao, và TRÊN course bị chấm thấp', () => {
    const courses = [entry('chưa-chấm'), entry('tốt'), entry('tệ')];
    const map = ratings([rated('tốt', 4.8, 100), rated('tệ', 1.2, 100)]);
    expect(ids(orderByRating(courses, map))).toEqual(['tốt', 'chưa-chấm', 'tệ']);
  });

  it('KHÔNG sửa mảng vào — `courses` giữ nguyên thứ tự của nó', () => {
    const courses = [entry('z'), entry('a')];
    const before = ids(courses);
    orderByRating(courses, ratings([rated('a', 5, 100)]));
    expect(ids(courses)).toEqual(before);
  });
});
