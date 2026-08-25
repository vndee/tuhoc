import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertRegistryIndex,
  describeRegistryError,
  fetchRegistryIndex,
  MalformedRegistryIndexError,
  RegistryHttpError,
  RegistryNotConfiguredError,
  RegistryNotJsonError,
  resolveRegistryBase,
  SUPPORTED_INDEX_SCHEMA,
  UnsupportedRegistrySchemaError,
} from './index.ts';
import type { RegistryEntry, RegistryIndex } from './types.ts';
import { t as lookup, type Translate } from '../i18n';

/**
 * `t` đã gắn tiếng Việt.
 *
 * `describeFinding`, `describeCourseError`, `describeAuthError` và
 * `importCourse` nhận ngôn ngữ bằng THAM SỐ từ Task 5 — chúng không phải
 * component và cố ý không có context nào để đọc. Bơm `t` vào từ đây là cách
 * duy nhất một bài kiểm chứng minh chúng dùng cái được truyền vào.
 */
const t: Translate = (key, ...args) => lookup('vi', key, ...args);


/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const BASE = 'https://registry.example/reg';
const INDEX_URL = `${BASE}/index.json`;

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'so-dau-phay-dong',
    title: 'Số dấu phẩy động',
    description: 'Mô tả',
    lang: 'vi',
    license: 'CC-BY-4.0',
    authors: [{ name: 'Ai đó' }],
    generatedBy: 'human',
    versions: ['1.0.0'],
    latest: '1.0.0',
    bytes: 61790,
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...over,
  };
}

function index(over: Partial<RegistryIndex> = {}): RegistryIndex {
  return {
    schema: SUPPORTED_INDEX_SCHEMA,
    generatedAt: '2026-08-22T00:00:00.000Z',
    courses: [entry()],
    ...over,
  };
}

/**
 * The body GitHub Pages serves for a path it does not have: the site's own
 * 404 page, `200`- or `404`-status, `text/html`. This is the third-party
 * shape of the regression in commit `815a472`.
 */
const PAGES_404_HTML = '<!doctype html>\n<html lang="en"><body><h1>404</h1></body></html>';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  localStorage.clear();
});

/* ------------------------------------------------------------------ *
 * Where the registry lives
 * ------------------------------------------------------------------ */

describe('resolveRegistryBase — ba nhánh, và không nhánh nào đoán', () => {
  it('biến môi trường thắng', () => {
    expect(resolveRegistryBase('https://env.example/r', 'https://fallback.example/r')).toBe('https://env.example/r');
  });

  it('KHÔNG có biến môi trường thì dùng registry công khai — đây là nhánh mà bản tự chạy đi qua', () => {
    // Ràng buộc §1.1: bản tự chạy phải dùng được registry công khai ở chế độ
    // chỉ-đọc, KHÔNG cần cấu hình gì. Nhánh này là cơ chế của lời hứa ấy, nên
    // nó được kiểm bằng một phép đo chứ không bằng một câu văn.
    expect(resolveRegistryBase(undefined, 'https://public.example/r')).toBe('https://public.example/r');
  });

  it('cả hai đều không có → ném, và thông báo NÊU TÊN biến cần đặt', () => {
    expect(() => resolveRegistryBase(undefined, null)).toThrow(RegistryNotConfiguredError);
    try {
      resolveRegistryBase(undefined, null);
    } catch (e) {
      expect((e as Error).message).toContain('VITE_REGISTRY_URL');
    }
  });

  it('bỏ dấu / thừa ở cuối, để `${base}/index.json` không thành `//index.json`', () => {
    expect(resolveRegistryBase('https://env.example/r/', null)).toBe('https://env.example/r');
  });
});

/* ------------------------------------------------------------------ *
 * The boundary check
 * ------------------------------------------------------------------ */

describe('assertRegistryIndex — chốt hình dạng Ở RANH GIỚI', () => {
  it('index hợp lệ đi qua nguyên vẹn', () => {
    const good = index();
    expect(assertRegistryIndex(good)).toBe(good);
  });

  it('thân là CHUỖI (HTML) → RegistryNotJsonError, không phải "thiếu trường"', () => {
    // Đây là hồi quy 815a472 ở dạng bên-thứ-ba: `api.get<T>` từng trao một
    // chuỗi HTML dưới danh nghĩa `T`. Một chuỗi khác rỗng là truthy, nên mọi
    // phép `?.` phía dưới KHÔNG ngắn mạch, và `.map` ném khi render.
    expect(() => assertRegistryIndex(PAGES_404_HTML)).toThrow(RegistryNotJsonError);
  });

  it('thân là null / mảng / số → RegistryNotJsonError', () => {
    expect(() => assertRegistryIndex(null)).toThrow(RegistryNotJsonError);
    expect(() => assertRegistryIndex([])).toThrow(RegistryNotJsonError);
    expect(() => assertRegistryIndex(42)).toThrow(RegistryNotJsonError);
  });

  it('thiếu `courses` → MalformedRegistryIndexError, và thông báo GỌI TÊN trường thiếu', () => {
    try {
      assertRegistryIndex({ schema: SUPPORTED_INDEX_SCHEMA, generatedAt: '2026-08-22T00:00:00.000Z' });
      expect.unreachable('phải ném');
    } catch (e) {
      expect(e).toBeInstanceOf(MalformedRegistryIndexError);
      expect((e as MalformedRegistryIndexError).missing).toContain('courses');
      expect((e as Error).message).toContain('courses');
    }
  });

  it('`schema` lạ (999) → UnsupportedRegistrySchemaError, KHÔNG phải "thiếu trường"', () => {
    const e = (() => {
      try {
        assertRegistryIndex({ schema: 999, generatedAt: 'x', courses: [entry()] });
      } catch (err) {
        return err;
      }
    })();
    expect(e).toBeInstanceOf(UnsupportedRegistrySchemaError);
    expect((e as UnsupportedRegistrySchemaError).found).toBe(999);
    expect((e as UnsupportedRegistrySchemaError).supported).toBe(SUPPORTED_INDEX_SCHEMA);
  });

  it('schema lạ được kiểm TRƯỚC hình dạng — index 999 mà thiếu `courses` vẫn báo "cần cập nhật"', () => {
    // Thứ tự là một quyết định, không phải tình cờ. Một index của định dạng
    // tương lai gần như CHẮC CHẮN sẽ "thiếu trường" theo mắt của bản cũ; báo
    // "danh mục hỏng" ở đó là đổ lỗi cho registry vì lỗi của chính nền tảng,
    // và nó dẫn người đọc đi sai hướng.
    expect(() => assertRegistryIndex({ schema: 999 })).toThrow(UnsupportedRegistrySchemaError);
  });

  it('`schema` thiếu hẳn → Malformed, không phải Unsupported', () => {
    // Không có `schema` nghĩa là tệp này không phải index của registry — có
    // thể là JSON của thứ khác hoàn toàn. "Nền tảng cần cập nhật" là chẩn
    // đoán SAI cho ca ấy.
    expect(() => assertRegistryIndex({ generatedAt: 'x', courses: [] })).toThrow(MalformedRegistryIndexError);
  });

  it('`courses` là object chứ không phải mảng → Malformed', () => {
    expect(() => assertRegistryIndex({ schema: SUPPORTED_INDEX_SCHEMA, generatedAt: 'x', courses: {} })).toThrow(
      MalformedRegistryIndexError,
    );
  });

  it('danh mục RỖNG là hợp lệ — "chưa có course nào" không phải lỗi', () => {
    expect(assertRegistryIndex({ schema: SUPPORTED_INDEX_SCHEMA, generatedAt: 'x', courses: [] }).courses).toEqual([]);
  });

  it('một MỤC hỏng cũng bị bắt ở ranh giới, và thông báo chỉ đúng mục nào', () => {
    // Bài học đắt của lần trước: vá `?.` ở chỗ dùng thì ca đối chứng ngay sau
    // đó tìm ra chỗ hở thứ hai. `Catalog` đọc `versions.length`; nếu mục thiếu
    // `versions` thì `.length` ném KHI RENDER — nơi không có đường lỗi nào.
    const bad = { ...entry(), versions: undefined };
    try {
      assertRegistryIndex({ schema: SUPPORTED_INDEX_SCHEMA, generatedAt: 'x', courses: [entry(), bad] });
      expect.unreachable('phải ném');
    } catch (e) {
      expect(e).toBeInstanceOf(MalformedRegistryIndexError);
      const msg = (e as Error).message;
      expect(msg).toContain('courses[1]');
      expect(msg).toContain('versions');
    }
  });

  it('mục thiếu `id`, `title`, `lang`, `latest` đều bị bắt', () => {
    for (const field of ['id', 'title', 'lang', 'latest'] as const) {
      const bad: Record<string, unknown> = { ...entry() };
      delete bad[field];
      try {
        assertRegistryIndex({ schema: SUPPORTED_INDEX_SCHEMA, generatedAt: 'x', courses: [bad] });
        expect.unreachable(`thiếu ${field} phải ném`);
      } catch (e) {
        expect(e, field).toBeInstanceOf(MalformedRegistryIndexError);
        expect((e as Error).message).toContain(field);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * The fetch
 * ------------------------------------------------------------------ */

describe('fetchRegistryIndex — một tệp, một request', () => {
  it('tải đúng MỘT tệp: `<base>/index.json`, và không gọi gì khác', async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${BASE}/*`, ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json(index());
      }),
    );

    const got = await fetchRegistryIndex({ base: BASE });

    expect(got.courses).toHaveLength(1);
    expect(seen).toEqual(['/reg/index.json']);
  });

  it('KHÔNG gửi cookie phiên sang origin của registry', async () => {
    // Registry là origin của BÊN THỨ BA. `api.get` dùng `credentials:
    // 'include'` vì nó nói chuyện với máy chủ của chính ta; dùng lại nó ở đây
    // là gửi cookie phiên của người học tới một máy chủ mà ta không sở hữu.
    let credentials: RequestCredentials | undefined;
    server.use(
      http.get(INDEX_URL, ({ request }) => {
        credentials = request.credentials;
        return HttpResponse.json(index());
      }),
    );

    await fetchRegistryIndex({ base: BASE });

    expect(credentials).toBe('omit');
  });

  it('index.json trả HTML (Pages 404 fallback) → RegistryNotJsonError', async () => {
    server.use(http.get(INDEX_URL, () => HttpResponse.html(PAGES_404_HTML)));
    await expect(fetchRegistryIndex({ base: BASE })).rejects.toBeInstanceOf(RegistryNotJsonError);
  });

  it('HTML kèm status 404 → RegistryHttpError mang status', async () => {
    server.use(http.get(INDEX_URL, () => new HttpResponse(PAGES_404_HTML, { status: 404 })));
    try {
      await fetchRegistryIndex({ base: BASE });
      expect.unreachable('phải ném');
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryHttpError);
      expect((e as RegistryHttpError).status).toBe(404);
    }
  });

  it('thiếu trường `courses` → MalformedRegistryIndexError', async () => {
    server.use(http.get(INDEX_URL, () => HttpResponse.json({ schema: SUPPORTED_INDEX_SCHEMA, generatedAt: 'x' })));
    await expect(fetchRegistryIndex({ base: BASE })).rejects.toBeInstanceOf(MalformedRegistryIndexError);
  });

  it('schema 999 → UnsupportedRegistrySchemaError', async () => {
    server.use(http.get(INDEX_URL, () => HttpResponse.json({ schema: 999, generatedAt: 'x', courses: [] })));
    await expect(fetchRegistryIndex({ base: BASE })).rejects.toBeInstanceOf(UnsupportedRegistrySchemaError);
  });

  it('KHÔNG ghi bất kỳ khoá localStorage nào — kể cả khi index hợp lệ', async () => {
    // Xem chú thích đầu `index.ts`: lớp cache ETag bằng localStorage ĐÃ được
    // dựng rồi bị gỡ, vì hai phép đo. Bài này giữ cho nó không lặng lẽ quay
    // lại. `db/local.test.ts` cũng sẽ đỏ nếu nó quay lại, nhưng ở một tệp khác
    // và với một thông báo về "user data", nên chốt ở đây nói thẳng lý do.
    server.use(http.get(INDEX_URL, () => HttpResponse.json(index(), { headers: { ETag: '"v1"' } })));

    localStorage.clear();
    await fetchRegistryIndex({ base: BASE });

    expect(localStorage.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * The cache
 * ------------------------------------------------------------------ */

describe('không có cache do JavaScript tự giữ', () => {
  it('mỗi lần gọi là một request THẬT — tầng cache nằm ở TanStack Query và ở HTTP cache của trình duyệt', async () => {
    // Đây là HIỆU CHỈNH so với kế hoạch, vốn nói "cache theo ETag".
    // Đo 2026-08-22 trên một host GitHub Pages thật:
    //
    //   $ curl -s -D - -o /dev/null -H "Origin: https://example.com" https://pages.github.com/
    //   HTTP/2 200
    //   access-control-allow-origin: *
    //   etag: "689c7eee-386e"
    //   cache-control: max-age=600
    //
    // KHÔNG có `access-control-expose-headers`. Theo Fetch, JS chỉ đọc được
    // các header nằm trong danh sách an toàn, và `ETag` không nằm trong đó —
    // nên `res.headers.get('etag')` là `null` ở trình duyệt, và một cache
    // ETag viết tay sẽ KHÔNG BAO GIỜ chạy trên chính mục tiêu nó nhắm tới.
    // Còn `cache-control: max-age=600` thì trình duyệt tự dùng, bằng cơ chế
    // của chính nó, không qua preflight.
    let calls = 0;
    server.use(
      http.get(INDEX_URL, () => {
        calls++;
        return HttpResponse.json(index(), { headers: { ETag: '"v1"' } });
      }),
    );

    await fetchRegistryIndex({ base: BASE });
    await fetchRegistryIndex({ base: BASE });

    expect(calls).toBe(2);
  });

  it('KHÔNG đặt header nào lên request — đó là thứ giữ nó ở dạng CORS ĐƠN GIẢN, không preflight', async () => {
    // `If-None-Match` cũng không nằm trong danh sách an toàn của header
    // REQUEST, nên gắn nó vào sẽ kích hoạt preflight `OPTIONS` mà GitHub
    // Pages không trả lời. Hậu quả sẽ là "danh mục chạy ở lần tải đầu rồi
    // hỏng mãi mãi ở những lần sau" — loại lỗi đắt nhất để chẩn đoán.
    let conditional: string | null = null;
    let cacheControl: string | null = null;
    server.use(
      http.get(INDEX_URL, ({ request }) => {
        conditional = request.headers.get('if-none-match');
        cacheControl = request.headers.get('cache-control');
        return HttpResponse.json(index());
      }),
    );

    await fetchRegistryIndex({ base: BASE });

    expect(conditional).toBeNull();
    expect(cacheControl).toBeNull();
  });

  it('KHÔNG đọc localStorage: một khoá rác ở đó không ảnh hưởng gì', async () => {
    localStorage.setItem('tuhoc.registry.index.v1', 'không-phải-json{{{');
    server.use(http.get(INDEX_URL, () => HttpResponse.json(index())));
    await expect(fetchRegistryIndex({ base: BASE })).resolves.toBeTruthy();
    localStorage.clear();
  });

  it('mạng hỏng KHÔNG được lặng lẽ trả về một bản cũ nào đó', async () => {
    // Một danh mục cũ hiện ra như thật trong khi registry không với tới được
    // là đúng loại sai-mà-im-lặng mà repo này đã ăn năm lần. Và nó dẫn thẳng
    // tới một nút "kéo về" chắc chắn hỏng.
    server.use(http.get(INDEX_URL, () => HttpResponse.json(index())));
    await fetchRegistryIndex({ base: BASE });

    server.use(http.get(INDEX_URL, () => HttpResponse.error()));
    await expect(fetchRegistryIndex({ base: BASE })).rejects.toBeTruthy();
  });
});

/* ------------------------------------------------------------------ *
 * The sentence a reader sees
 * ------------------------------------------------------------------ */

describe('describeRegistryError — mỗi cách hỏng một câu KHÁC NHAU', () => {
  it('HTML: nói rõ nhận được trang web chứ không phải danh mục', () => {
    const msg = describeRegistryError(new RegistryNotJsonError(INDEX_URL, 200, 'text/html', PAGES_404_HTML.slice(0, 60)), t);
    expect(msg).toMatch(/không phải JSON|không phải danh mục/i);
    expect(msg).toContain('index.json');
  });

  it('thiếu trường: nêu đích danh trường thiếu', () => {
    expect(describeRegistryError(new MalformedRegistryIndexError(['courses']), t)).toContain('courses');
  });

  it('schema lạ: nói NỀN TẢNG cần cập nhật, và nói rõ đã KHÔNG đọc thử', () => {
    const msg = describeRegistryError(new UnsupportedRegistrySchemaError(999, SUPPORTED_INDEX_SCHEMA), t);
    expect(msg).toMatch(/cập nhật/i);
    expect(msg).toContain('999');
    // "đã KHÔNG cố đọc" phải nằm trong câu, ở dạng nào cũng được.
    expect(msg).toMatch(/không (được |cố )?đọc|chưa đọc/i);
  });

  it('chưa cấu hình: nêu tên biến', () => {
    expect(describeRegistryError(new RegistryNotConfiguredError(), t)).toContain('VITE_REGISTRY_URL');
  });

  it('không có phản hồi nào: nêu CẢ HAI khả năng, không đổ tại wifi', () => {
    // Ruling S1-F25: một lần từ chối CORS ở production giống hệt một lần mất
    // mạng ở phía trang, và bản cũ nói chắc nịch "kiểm tra kết nối mạng".
    const msg = describeRegistryError(new TypeError('Failed to fetch'), t);
    expect(msg).toMatch(/ngoại tuyến|mạng/i);
    expect(msg).toMatch(/CORS|cấu hình/i);
  });

  it('bốn câu ấy khác nhau từng đôi một', () => {
    const msgs = [
      describeRegistryError(new RegistryNotJsonError(INDEX_URL, 200, 'text/html', ''), t),
      describeRegistryError(new MalformedRegistryIndexError(['courses']), t),
      describeRegistryError(new UnsupportedRegistrySchemaError(999, SUPPORTED_INDEX_SCHEMA), t),
      describeRegistryError(new RegistryNotConfiguredError(), t),
      describeRegistryError(new TypeError('Failed to fetch'), t),
    ];
    expect(new Set(msgs).size).toBe(msgs.length);
  });
});
