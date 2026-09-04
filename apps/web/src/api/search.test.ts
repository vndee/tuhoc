import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from './client';
import {
  MalformedSearchError,
  assertSearchResults,
  fetchSearch,
  isQueryLongEnough,
  searchQueryKey,
} from './search';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function chapter(over: Record<string, unknown> = {}) {
  return {
    slug: 'khoa-a',
    courseTitle: 'Khoá A',
    chapterId: 'c1',
    chapterTitle: 'Chương một',
    before: 'trước ',
    match: 'entropy',
    after: ' sau',
    ...over,
  };
}

function body(over: Record<string, unknown> = {}) {
  return { courses: [], chapters: [], truncated: false, ...over };
}

describe('assertSearchResults — hàng rào ở BIÊN', () => {
  it('nhận hai mảng rỗng — không tìm thấy gì là câu trả lời hợp lệ', () => {
    expect(assertSearchResults(body())).toEqual({ courses: [], chapters: [], truncated: false });
  });

  it('nhận thân đủ trường', () => {
    const b = body({ chapters: [chapter()], truncated: true });
    expect(assertSearchResults(b).chapters).toEqual(b.chapters);
    expect(assertSearchResults(b).truncated).toBe(true);
  });

  it('từ chối mảng trần', () => {
    expect(() => assertSearchResults([chapter()])).toThrow(MalformedSearchError);
  });

  it('từ chối null ở courses — thứ mà một slice nil của Go sẽ tạo ra', () => {
    expect(() => assertSearchResults(body({ courses: null }))).toThrow(MalformedSearchError);
  });

  it('từ chối SPA fallback HTML', () => {
    expect(() => assertSearchResults('<!doctype html>')).toThrow(MalformedSearchError);
  });

  it('từ chối `truncated` thiếu — cờ này lái nút "Xem tất cả", không phải trang trí', () => {
    const b = body();
    delete (b as Record<string, unknown>).truncated;
    expect(() => assertSearchResults(b)).toThrow(MalformedSearchError);
  });

  it('nêu ĐÍCH DANH trường thiếu của một hit chương', () => {
    try {
      assertSearchResults(body({ chapters: [chapter({ match: undefined })] }));
      expect.unreachable('phải ném');
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedSearchError);
      expect((err as MalformedSearchError).missing).toEqual(['chapters[0].match']);
    }
  });

  it('đòi cả ba mảnh đoạn trích, kể cả khi chúng là chuỗi RỖNG', () => {
    // Chuỗi rỗng là hợp lệ: chỗ khớp có thể nằm ngay đầu chương, khi ấy
    // `before` rỗng. Cái không hợp lệ là trường KHÔNG CÓ.
    expect(() => assertSearchResults(body({ chapters: [chapter({ before: '' })] }))).not.toThrow();
    const missing = chapter();
    delete (missing as Record<string, unknown>).after;
    expect(() => assertSearchResults(body({ chapters: [missing] }))).toThrow(MalformedSearchError);
  });
});

describe('isQueryLongEnough — đếm bằng ký tự, không bằng đơn vị UTF-16', () => {
  it('từ chối chuỗi rỗng và một ký tự', () => {
    expect(isQueryLongEnough('')).toBe(false);
    expect(isQueryLongEnough('   ')).toBe(false);
    expect(isQueryLongEnough('a')).toBe(false);
  });

  it('nhận hai ký tự, kể cả sau khi cắt khoảng trắng', () => {
    expect(isQueryLongEnough('ab')).toBe(true);
    expect(isQueryLongEnough('  ab  ')).toBe(true);
  });

  it('MỘT emoji là MỘT ký tự — `.length` sẽ đếm nó thành hai và nhận nhầm', () => {
    // '🙂'.length === 2. Máy chủ đếm rune và sẽ trả 400 cho truy vấn này, nên
    // nhận nó ở đây là gọi mạng để lấy về một lỗi.
    expect('🙂'.length).toBe(2);
    expect(isQueryLongEnough('🙂')).toBe(false);
  });
});

describe('searchQueryKey', () => {
  it('mang cả truy vấn lẫn limit — limit đổi nội dung câu trả lời, không chỉ độ dài', () => {
    expect(searchQueryKey('entropy', 8)).toEqual(['search', 'entropy', 8]);
    expect(searchQueryKey('entropy', 30)).not.toEqual(searchQueryKey('entropy', 8));
  });

  it('cắt khoảng trắng, để "  a  " và "a" dùng chung một mục cache', () => {
    expect(searchQueryKey('  entropy  ', 8)).toEqual(searchQueryKey('entropy', 8));
  });
});

describe('fetchSearch', () => {
  it('mã hoá truy vấn — người dùng gõ & và # là chuyện thường', async () => {
    let seen = '';
    server.use(
      http.get('/search', ({ request }) => {
        seen = new URL(request.url).searchParams.get('q') ?? '';
        return HttpResponse.json(body());
      }),
    );
    await fetchSearch('a&b#c', 8);
    expect(seen).toBe('a&b#c');
  });

  it('gửi limit đi', async () => {
    let seen = '';
    server.use(
      http.get('/search', ({ request }) => {
        seen = new URL(request.url).searchParams.get('limit') ?? '';
        return HttpResponse.json(body());
      }),
    );
    await fetchSearch('entropy', 30);
    expect(seen).toBe('30');
  });

  it('để lỗi HTTP đi qua thành ApiError, không nuốt thành kết quả rỗng', async () => {
    server.use(http.get('/search', () => HttpResponse.json({ error: 'nope' }, { status: 500 })));
    await expect(fetchSearch('entropy', 8)).rejects.toBeInstanceOf(ApiError);
  });

  it('ném MalformedSearchError khi 200 nhưng sai hình dạng', async () => {
    server.use(http.get('/search', () => HttpResponse.json({ courses: [] })));
    await expect(fetchSearch('entropy', 8)).rejects.toBeInstanceOf(MalformedSearchError);
  });
});
