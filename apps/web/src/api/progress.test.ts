import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { MalformedProgressError, assertProgress, fetchProgress, progressQueryKey, putProgress } from './progress';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function row(over: Record<string, unknown> = {}) {
  return { courseId: 'c', chapterId: 'c1', status: 'read', done: true, updatedAt: '2026-09-01T00:00:00Z', ...over };
}

describe('assertProgress — hình dạng, cùng khuôn assertStats', () => {
  it('ném khi một hàng thiếu chapterId — không để undefined đội lốt string', () => {
    expect(() =>
      assertProgress({ progress: [{ courseId: 'c', status: 'read', done: true, updatedAt: 'x' }] }),
    ).toThrow(MalformedProgressError);
  });

  it('chấp nhận mảng rỗng — người học mới là hợp lệ', () => {
    expect(assertProgress({ progress: [] })).toEqual([]);
  });

  it('giữ nguyên mọi hàng hợp lệ, đúng giá trị', () => {
    expect(assertProgress({ progress: [row()] })).toEqual([row()]);
  });

  it('nêu đích danh trường sai, ở đúng chỉ số của nó', () => {
    try {
      assertProgress({ progress: [row(), row({ done: 'yes' })] });
      expect.unreachable('phải ném');
    } catch (error) {
      expect(error).toBeInstanceOf(MalformedProgressError);
      expect((error as MalformedProgressError).message).toContain('[1].done');
    }
  });

  it('thân không phải {progress: [...]} → MalformedProgressError, không phải một crash lúc render', () => {
    expect(() => assertProgress([row()])).toThrow(MalformedProgressError);
    expect(() => assertProgress(null)).toThrow(MalformedProgressError);
    expect(() => assertProgress('<!doctype html>')).toThrow(MalformedProgressError);
    expect(() => assertProgress({})).toThrow(MalformedProgressError);
  });
});

describe('progressQueryKey', () => {
  it('luôn là cùng một khoá — không có tham số nào để tách theo', () => {
    expect(progressQueryKey()).toEqual(['progress']);
  });
});

describe('fetchProgress', () => {
  it('gọi GET /progress và trả về mảng đã qua assertProgress', async () => {
    server.use(http.get('/progress', () => HttpResponse.json({ progress: [row()] })));
    await expect(fetchProgress()).resolves.toEqual([row()]);
  });

  it('một 200 mang HTML (SPA fallback) không đi tiếp được', async () => {
    server.use(http.get('/progress', () => HttpResponse.html('<!doctype html><p>404</p>')));
    await expect(fetchProgress()).rejects.toThrow();
  });
});

describe('putProgress', () => {
  it('PUT tới /progress, thân đúng bốn trường và KHÔNG kèm updatedAt — máy chủ tự đóng dấu', async () => {
    let method = '';
    let body: unknown = null;
    server.use(
      http.put('/progress', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await putProgress({ courseId: 'c', chapterId: 'c1', status: 'read', done: true });

    expect(method).toBe('PUT');
    expect(body).toEqual({ courseId: 'c', chapterId: 'c1', status: 'read', done: true });
  });

  it('204 không thân → hoàn thành, không ném', async () => {
    server.use(http.put('/progress', () => new HttpResponse(null, { status: 204 })));
    await expect(
      putProgress({ courseId: 'c', chapterId: 'c1', status: 'read', done: true }),
    ).resolves.toBeUndefined();
  });

  it('lỗi phía máy chủ tới được chỗ gọi dưới dạng ApiError', async () => {
    server.use(http.put('/progress', () => HttpResponse.json({ error: 'invalid progress item' }, { status: 400 })));
    await expect(
      putProgress({ courseId: 'c', chapterId: 'c1', status: 'read', done: true }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
