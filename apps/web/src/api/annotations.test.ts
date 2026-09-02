import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from './client';
import {
  MalformedAnnotationsError,
  annotationsQueryKey,
  assertAnnotations,
  createAnnotation,
  deleteAnnotation,
  fetchAnnotations,
  patchAnnotation,
} from './annotations';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function ann(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    courseId: 'c',
    chapterId: 'c1',
    anchor: { offset: 3 },
    note: 'ghi chú',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...over,
  };
}

/**
 * Hai khoá khác nhau là hai câu trả lời khác nhau; gộp chúng là cách chắc
 * chắn để mở khoá B rồi thấy ghi chú của khoá A trong một nhịp — đúng lý do
 * statsQueryKey nhận `year` vào khoá.
 */
describe('annotationsQueryKey', () => {
  it('phân biệt theo course', () => {
    expect(annotationsQueryKey('a')).not.toEqual(annotationsQueryKey('b'));
    expect(annotationsQueryKey()).toEqual(['annotations']);
  });
});

describe('assertAnnotations — hình dạng, cùng khuôn assertStats', () => {
  it('ném khi một hàng thiếu note', () => {
    const bad = ann();
    delete (bad as Record<string, unknown>).note;
    expect(() => assertAnnotations({ annotations: [bad] })).toThrow(MalformedAnnotationsError);
  });

  it('chấp nhận mảng rỗng — chưa ghi chú nào là hợp lệ', () => {
    expect(assertAnnotations({ annotations: [] })).toEqual([]);
  });

  it('giữ nguyên mọi hàng hợp lệ, đúng giá trị, kể cả anchor dạng object bất kỳ', () => {
    expect(assertAnnotations({ annotations: [ann()] })).toEqual([ann()]);
  });

  it('nêu đích danh trường sai, ở đúng chỉ số của nó', () => {
    try {
      assertAnnotations({ annotations: [ann(), ann({ id: 7 })] });
      expect.unreachable('phải ném');
    } catch (error) {
      expect(error).toBeInstanceOf(MalformedAnnotationsError);
      expect((error as MalformedAnnotationsError).message).toContain('[1].id');
    }
  });

  it('thân không phải {annotations: [...]} → MalformedAnnotationsError', () => {
    expect(() => assertAnnotations([ann()])).toThrow(MalformedAnnotationsError);
    expect(() => assertAnnotations(null)).toThrow(MalformedAnnotationsError);
    expect(() => assertAnnotations({})).toThrow(MalformedAnnotationsError);
  });
});

describe('fetchAnnotations', () => {
  it('không tham số → gọi /annotations (mọi course)', async () => {
    let seenPath = '';
    server.use(
      http.get('/annotations', ({ request }) => {
        seenPath = new URL(request.url).pathname + new URL(request.url).search;
        return HttpResponse.json({ annotations: [ann()] });
      }),
    );
    await expect(fetchAnnotations()).resolves.toEqual([ann()]);
    expect(seenPath).toBe('/annotations');
  });

  it("fetchAnnotations('c') → gọi đúng /annotations?course=c", async () => {
    let seenPath = '';
    server.use(
      http.get('/annotations', ({ request }) => {
        seenPath = new URL(request.url).pathname + new URL(request.url).search;
        return HttpResponse.json({ annotations: [ann()] });
      }),
    );
    await expect(fetchAnnotations('c')).resolves.toEqual([ann()]);
    expect(seenPath).toBe('/annotations?course=c');
  });

  it('một 200 mang HTML (SPA fallback) không đi tiếp được', async () => {
    server.use(http.get('/annotations', () => HttpResponse.html('<!doctype html><p>404</p>')));
    await expect(fetchAnnotations()).rejects.toThrow();
  });
});

describe('createAnnotation', () => {
  it('POST /annotations, thân đúng năm trường (kể cả id, do CLIENT sinh) và KHÔNG kèm createdAt/updatedAt', async () => {
    let method = '';
    let body: unknown = null;
    server.use(
      http.post('/annotations', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return new HttpResponse(null, { status: 201 });
      }),
    );

    await createAnnotation({ id: 'a1', courseId: 'c', chapterId: 'c1', anchor: { offset: 3 }, note: 'x' });

    expect(method).toBe('POST');
    expect(body).toEqual({ id: 'a1', courseId: 'c', chapterId: 'c1', anchor: { offset: 3 }, note: 'x' });
  });

  it('201 → hoàn thành, không ném', async () => {
    server.use(http.post('/annotations', () => new HttpResponse(null, { status: 201 })));
    await expect(
      createAnnotation({ id: 'a1', courseId: 'c', chapterId: 'c1', anchor: {}, note: '' }),
    ).resolves.toBeUndefined();
  });

  it('409 (id trùng) tới được chỗ gọi dưới dạng ApiError', async () => {
    server.use(
      http.post('/annotations', () => HttpResponse.json({ error: 'annotation id already exists' }, { status: 409 })),
    );
    await expect(
      createAnnotation({ id: 'a1', courseId: 'c', chapterId: 'c1', anchor: {}, note: '' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('patchAnnotation', () => {
  it('PATCH /annotations/:id, thân đúng những gì được truyền — chỉ note', async () => {
    let method = '';
    let path = '';
    let body: unknown = null;
    server.use(
      http.patch('/annotations/:id', async ({ request, params }) => {
        method = request.method;
        path = String(params.id);
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await patchAnnotation('a1', { note: 'sửa rồi' });

    expect(method).toBe('PATCH');
    expect(path).toBe('a1');
    expect(body).toEqual({ note: 'sửa rồi' });
  });

  it('204 không thân → hoàn thành, không ném', async () => {
    server.use(http.patch('/annotations/:id', () => new HttpResponse(null, { status: 204 })));
    await expect(patchAnnotation('a1', { anchor: { offset: 9 } })).resolves.toBeUndefined();
  });

  it('404 (thuộc tài khoản khác hoặc không tồn tại) tới được chỗ gọi dưới dạng ApiError', async () => {
    server.use(
      http.patch('/annotations/:id', () => HttpResponse.json({ error: 'annotation not found' }, { status: 404 })),
    );
    await expect(patchAnnotation('a1', { note: 'x' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('deleteAnnotation', () => {
  it('DELETE /annotations/:id', async () => {
    let method = '';
    let path = '';
    server.use(
      http.delete('/annotations/:id', ({ request, params }) => {
        method = request.method;
        path = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await deleteAnnotation('a1');

    expect(method).toBe('DELETE');
    expect(path).toBe('a1');
  });

  it('204 không thân → hoàn thành, không ném', async () => {
    server.use(http.delete('/annotations/:id', () => new HttpResponse(null, { status: 204 })));
    await expect(deleteAnnotation('a1')).resolves.toBeUndefined();
  });

  it('404 tới được chỗ gọi dưới dạng ApiError', async () => {
    server.use(
      http.delete('/annotations/:id', () => HttpResponse.json({ error: 'annotation not found' }, { status: 404 })),
    );
    await expect(deleteAnnotation('a1')).rejects.toBeInstanceOf(ApiError);
  });
});
