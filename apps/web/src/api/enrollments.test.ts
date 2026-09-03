import { describe, expect, it } from 'vitest';
import { MalformedEnrollmentsError, assertEnrollments } from './enrollments';

describe('assertEnrollments', () => {
  it('nhận danh sách rỗng — người chưa ghi danh khoá nào là hợp lệ, không phải hỏng', () => {
    expect(assertEnrollments({ enrollments: [] })).toEqual([]);
  });

  it('nhận hàng đủ trường', () => {
    const body = { enrollments: [{ courseId: 'khoa-a', createdAt: '2026-09-03T00:00:00Z' }] };
    expect(assertEnrollments(body)).toEqual(body.enrollments);
  });

  it('từ chối mảng trần — máy chủ trả object có khoá', () => {
    expect(() => assertEnrollments([{ courseId: 'khoa-a', createdAt: 'x' }])).toThrow(
      MalformedEnrollmentsError,
    );
  });

  it('từ chối null, thứ mà một slice nil của Go sẽ tạo ra', () => {
    expect(() => assertEnrollments({ enrollments: null })).toThrow(MalformedEnrollmentsError);
  });

  it('nêu ĐÍCH DANH trường sai, không chỉ nói "hỏng"', () => {
    try {
      assertEnrollments({ enrollments: [{ courseId: 42, createdAt: '2026-09-03T00:00:00Z' }] });
      expect.unreachable('phải ném');
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedEnrollmentsError);
      expect((err as MalformedEnrollmentsError).missing).toEqual(['[0].courseId']);
    }
  });
});
