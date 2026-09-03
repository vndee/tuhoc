import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from './client';
import {
  MalformedEnrollmentsError,
  assertEnrollments,
  createEnrollment,
  deleteEnrollment,
  fetchEnrollments,
} from './enrollments';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function row(over: Record<string, unknown> = {}) {
  return { courseId: 'khoa-a', createdAt: '2026-09-03T00:00:00Z', ...over };
}

describe('assertEnrollments — hình dạng, cùng khuôn assertProgress', () => {
  it('nhận danh sách rỗng — người chưa ghi danh khoá nào là hợp lệ, không phải hỏng', () => {
    expect(assertEnrollments({ enrollments: [] })).toEqual([]);
  });

  it('nhận hàng đủ trường', () => {
    const body = { enrollments: [row()] };
    expect(assertEnrollments(body)).toEqual(body.enrollments);
  });

  it('từ chối mảng trần — máy chủ trả object có khoá', () => {
    expect(() => assertEnrollments([row()])).toThrow(MalformedEnrollmentsError);
  });

  it('từ chối null, thứ mà một slice nil của Go sẽ tạo ra', () => {
    expect(() => assertEnrollments({ enrollments: null })).toThrow(MalformedEnrollmentsError);
  });

  it('từ chối bare string — SPA fallback HTML', () => {
    expect(() => assertEnrollments('<!doctype html>')).toThrow(MalformedEnrollmentsError);
  });

  it('từ chối object rỗng — không có khoá enrollments', () => {
    expect(() => assertEnrollments({})).toThrow(MalformedEnrollmentsError);
  });

  it('nêu ĐÍCH DANH trường courseId sai, không chỉ nói "hỏng"', () => {
    try {
      assertEnrollments({ enrollments: [{ courseId: 42, createdAt: '2026-09-03T00:00:00Z' }] });
      expect.unreachable('phải ném');
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedEnrollmentsError);
      expect((err as MalformedEnrollmentsError).missing).toEqual(['[0].courseId']);
    }
  });

  it('nêu ĐÍCH DANH trường createdAt sai, không để undefined đội lốt string', () => {
    try {
      assertEnrollments({ enrollments: [{ courseId: 'khoa-a', createdAt: 123 }] });
      expect.unreachable('phải ném');
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedEnrollmentsError);
      expect((err as MalformedEnrollmentsError).missing).toEqual(['[0].createdAt']);
    }
  });

  it('nêu hàng không phải object', () => {
    try {
      assertEnrollments({ enrollments: [null, row(), 'string'] });
      expect.unreachable('phải ném');
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedEnrollmentsError);
      expect((err as MalformedEnrollmentsError).missing).toContain('[0] (not an object)');
      expect((err as MalformedEnrollmentsError).missing).toContain('[2] (not an object)');
    }
  });

  it('thân không phải {enrollments: [...]} → MalformedEnrollmentsError', () => {
    expect(() => assertEnrollments(null)).toThrow(MalformedEnrollmentsError);
    expect(() => assertEnrollments(123)).toThrow(MalformedEnrollmentsError);
    expect(() => assertEnrollments('text')).toThrow(MalformedEnrollmentsError);
  });
});

describe('fetchEnrollments', () => {
  it('gọi GET /enrollments và trả về mảng đã qua assertEnrollments', async () => {
    server.use(http.get('/enrollments', () => HttpResponse.json({ enrollments: [row()] })));
    await expect(fetchEnrollments()).resolves.toEqual([row()]);
  });

  it('một 200 mang HTML (SPA fallback) không đi tiếp được', async () => {
    server.use(http.get('/enrollments', () => HttpResponse.html('<!doctype html><p>404</p>')));
    await expect(fetchEnrollments()).rejects.toThrow();
  });

  it('lỗi phía máy chủ tới được chỗ gọi dưới dạng ApiError', async () => {
    server.use(http.get('/enrollments', () => HttpResponse.json({ error: 'server error' }, { status: 500 })));
    await expect(fetchEnrollments()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createEnrollment', () => {
  it('POST tới /enrollments, thân đúng một trường courseId và KHÔNG kèm createdAt — máy chủ tự đóng dấu', async () => {
    let method = '';
    let body: unknown = null;
    server.use(
      http.post('/enrollments', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return new HttpResponse(null, { status: 201 });
      }),
    );

    await createEnrollment('khoa-a');

    expect(method).toBe('POST');
    expect(body).toEqual({ courseId: 'khoa-a' });
    // Verify createdAt is NOT present in the body
    expect(Object.keys(body as Record<string, unknown>)).toEqual(['courseId']);
  });

  it('201 không thân → hoàn thành, không ném', async () => {
    server.use(http.post('/enrollments', () => new HttpResponse(null, { status: 201 })));
    await expect(createEnrollment('khoa-a')).resolves.toBeUndefined();
  });

  it('lỗi phía máy chủ tới được chỗ gọi dưới dạng ApiError', async () => {
    server.use(http.post('/enrollments', () => HttpResponse.json({ error: 'invalid' }, { status: 400 })));
    await expect(createEnrollment('khoa-a')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('deleteEnrollment', () => {
  it('DELETE tới /enrollments/:courseId với đúng path', async () => {
    let method = '';
    let path = '';
    server.use(
      http.delete('/enrollments/:courseId', ({ params, request }) => {
        method = request.method;
        path = `/enrollments/${params.courseId}`;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await deleteEnrollment('khoa-a');

    expect(method).toBe('DELETE');
    expect(path).toBe('/enrollments/khoa-a');
  });

  it('URL-encode courseId chứa ký tự đặc biệt — dấu / hoặc space', async () => {
    let capturedPath = '';
    server.use(
      http.delete('/enrollments/:courseId', ({ request }) => {
        capturedPath = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    // courseId with special characters that need encoding
    await deleteEnrollment('khoa/a');

    expect(capturedPath).toBe('/enrollments/khoa%2Fa');

    // Test with space
    capturedPath = '';
    await deleteEnrollment('khoa a');
    expect(capturedPath).toBe('/enrollments/khoa%20a');
  });

  it('204 không thân → hoàn thành, không ném', async () => {
    server.use(http.delete('/enrollments/:courseId', () => new HttpResponse(null, { status: 204 })));
    await expect(deleteEnrollment('khoa-a')).resolves.toBeUndefined();
  });

  it('lỗi phía máy chủ tới được chỗ gọi dưới dạng ApiError', async () => {
    server.use(
      http.delete('/enrollments/:courseId', () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );
    await expect(deleteEnrollment('khoa-a')).rejects.toBeInstanceOf(ApiError);
  });
});
