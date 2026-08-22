import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../shell/ErrorBoundary';
import { Catalog } from './Catalog.tsx';
import { SUPPORTED_INDEX_SCHEMA } from './index.ts';
import type { RegistryEntry, RegistryIndex } from './types.ts';
import { LanguageProvider } from '../i18n/LanguageProvider';

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

const BASE = 'https://registry.example/reg';
const INDEX_URL = `${BASE}/index.json`;

/**
 * The exact words `shell/ErrorBoundary.tsx` shows when a render threw.
 *
 * Every test below asserts this string is ABSENT. That is the whole
 * measurement discipline of this file: the boundary is the LAST safety net,
 * not the fix. A test that goes green because the boundary caught the throw
 * has proven the net works — which was already proven in
 * `shell/ErrorBoundary.test.tsx` — and has proven nothing at all about this
 * screen. So "not a white screen" is not enough to pass here; the catalog's
 * OWN sentence has to be on the page.
 */
const BOUNDARY_FALLBACK = 'Màn hình này gặp lỗi';

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'so-dau-phay-dong',
    title: 'Số dấu phẩy động',
    description: 'Vì sao 0.1 + 0.2 không bằng 0.3',
    lang: 'vi',
    tier: 'content',
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
  return { schema: SUPPORTED_INDEX_SCHEMA, generatedAt: '2026-08-22T00:00:00.000Z', courses: [entry()], ...over };
}

const PAGES_404_HTML = '<!doctype html>\n<html lang="en"><body><h1>404</h1></body></html>';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

beforeEach(() => {
  localStorage.clear();
});

function renderCatalog() {
  // `retry: false` so a failing query settles once. This is a HARNESS
  // setting, not the app's: `useRegistryIndex` decides retries per error
  // class, and that decision has its own test in `useRegistry.test.tsx`.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider><MemoryRouter>
        <ErrorBoundary>
          <Catalog registryBase={BASE} />
        </ErrorBoundary>
      </MemoryRouter></LanguageProvider>
    </QueryClientProvider>,
  );
}

/** What a reader actually sees. A white screen measures as the empty string. */
function visibleText(): string {
  return document.body.textContent?.trim() ?? '';
}

/* ------------------------------------------------------------------ *
 * The happy path — so the three failure tests below cannot pass by
 * rendering nothing at all
 * ------------------------------------------------------------------ */

describe('Catalog khi registry khoẻ', () => {
  it('liệt kê course, kèm nhãn NGÔN NGỮ và nhãn HẠNG', async () => {
    server.use(http.get(INDEX_URL, () => HttpResponse.json(index())));
    renderCatalog();

    expect(await screen.findByText('Số dấu phẩy động')).toBeInTheDocument();
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('vi');
    // Hạng là một quyết định AN NINH, không phải phân loại nội dung — cùng lý
    // do `pages/Library.tsx`'s TierBadge đã ghi.
    expect(item).toHaveTextContent('content');
    expect(item).toHaveTextContent('1.0.0');
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
  });

  it('danh mục rỗng nói "chưa có course nào", không phải một lỗi', async () => {
    server.use(http.get(INDEX_URL, () => HttpResponse.json(index({ courses: [] }))));
    renderCatalog();

    expect(await screen.findByText(/chưa có khóa học nào/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * KHẲNG ĐỊNH CHỊU LỰC: index hỏng KHÔNG được làm trắng trang
 * ------------------------------------------------------------------ */

describe('index.json hỏng — ba ca bắt buộc', () => {
  // Hồi quy có thật, commit `815a472`: `api.get<T>` trao một chuỗi HTML dưới
  // danh nghĩa `T`, `.map` trên nó ném khi render, và không có error boundary
  // nên cả cây React unmount:
  //     document.body.innerHTML === '<div id="root"></div>'
  // Trang trắng, không một chữ. MỌI cổng đơn vị vẫn xanh suốt thời gian đó.
  //
  // Registry là nguồn dữ liệu BÊN THỨ BA — đúng lớp rủi ro ấy, nhưng nằm
  // ngoài tầm kiểm soát của ta, nên nó không thể được sửa bằng cách sửa máy
  // chủ. Chỉ chốt ở ranh giới mới đóng được.

  it('CA 1 — index.json trả HTML (Pages 404 fallback) → thông báo CỦA CATALOG, không trắng trang', async () => {
    server.use(http.get(INDEX_URL, () => HttpResponse.html(PAGES_404_HTML)));
    renderCatalog();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/không phải JSON|không phải danh mục/i);
    expect(alert).toHaveTextContent('index.json');

    // Ba chốt, và cả ba đều cần:
    expect(visibleText()).not.toBe(''); // không trắng trang
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument(); // KHÔNG phải nhờ boundary
    expect(screen.getByRole('heading', { name: /danh mục/i })).toBeInTheDocument(); // màn hình vẫn đứng
  });

  it('CA 2 — thiếu trường `courses` → thông báo CỦA CATALOG nêu đích danh trường', async () => {
    server.use(
      http.get(INDEX_URL, () => HttpResponse.json({ schema: SUPPORTED_INDEX_SCHEMA, generatedAt: '2026-08-22' })),
    );
    renderCatalog();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('courses');
    expect(visibleText()).not.toBe('');
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
  });

  it('CA 3 — schema lạ (999) → nói NỀN TẢNG cần cập nhật, và KHÔNG cố đọc', async () => {
    // `courses` ở đây HỢP LỆ và đọc được. Nếu màn hình vẽ ra "Số dấu phẩy
    // động" thì nó đã cố đọc một định dạng nó không biết — chính xác là điều
    // bị cấm.
    server.use(http.get(INDEX_URL, () => HttpResponse.json({ schema: 999, generatedAt: 'x', courses: [entry()] })));
    renderCatalog();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/cập nhật/i);
    expect(alert).toHaveTextContent('999');

    expect(screen.queryByText('Số dấu phẩy động')).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(visibleText()).not.toBe('');
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * Ca thứ tư và thứ năm: hình dạng hỏng mà một chốt "chỉ kiểm cấp cao nhất"
 * sẽ bỏ lọt
 * ------------------------------------------------------------------ */

describe('index.json hỏng ở BÊN TRONG một mục', () => {
  it('một mục thiếu `versions` → thông báo, không trắng trang', async () => {
    // Đây là chỗ hở THỨ HAI của lần trước: vá `?.` ở `stats.courses` xong thì
    // ca kế tiếp tìm ra `stats.days` vẫn hở. Một chốt ở ranh giới phải phủ cả
    // bên trong mục, không chỉ cấp cao nhất.
    const bad = { ...entry(), versions: undefined };
    server.use(
      http.get(INDEX_URL, () => HttpResponse.json({ schema: SUPPORTED_INDEX_SCHEMA, generatedAt: 'x', courses: [bad] })),
    );
    renderCatalog();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('versions');
    expect(visibleText()).not.toBe('');
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
  });

  it('`courses` là một CHUỖI (không phải mảng) → thông báo, không trắng trang', async () => {
    // Một chuỗi khác rỗng là truthy và có `.length`, nên nó đi lọt qua mọi
    // phép `?.` và mọi phép kiểm "có dữ liệu chưa". Đây đúng là hình dạng đã
    // làm trắng trang một lần.
    server.use(
      http.get(INDEX_URL, () =>
        HttpResponse.json({ schema: SUPPORTED_INDEX_SCHEMA, generatedAt: 'x', courses: '<html>' }),
      ),
    );
    renderCatalog();

    expect(await screen.findByRole('alert')).toHaveTextContent('courses');
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * Danh mục CŨ không được đứng cạnh thông báo lỗi
 * ------------------------------------------------------------------ */

describe('registry hỏng SAU một lần tải thành công', () => {
  it('lần tải hỏng thứ hai: hiện thông báo và GỠ danh mục cũ, không hiện cả hai', async () => {
    // TanStack Query GIỮ `data` của lần thành công trước khi lần sau hỏng.
    // Không có chốt `!query.isError` ở `Catalog.tsx`, màn hình sẽ vẽ "nền tảng
    // cần được cập nhật" ngay bên trên một danh sách course lấy từ định dạng
    // CŨ — vừa cảnh báo, vừa bày ra đúng thứ đang cảnh báo.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const ui = (
      <QueryClientProvider client={client}>
        <LanguageProvider><MemoryRouter>
          <ErrorBoundary>
            <Catalog registryBase={BASE} />
          </ErrorBoundary>
        </MemoryRouter></LanguageProvider>
      </QueryClientProvider>
    );

    server.use(http.get(INDEX_URL, () => HttpResponse.json(index())));
    const { unmount } = render(ui);
    expect(await screen.findByText('Số dấu phẩy động')).toBeInTheDocument();
    unmount();

    // Registry được publish lại dưới một schema bản dựng này không đọc được.
    server.use(http.get(INDEX_URL, () => HttpResponse.json({ schema: 999, generatedAt: 'x', courses: [entry()] })));
    await client.refetchQueries();
    render(ui);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/cập nhật/i);
    await waitFor(() => expect(screen.queryByText('Số dấu phẩy động')).not.toBeInTheDocument());
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * ĐỐI CHỨNG cho chính bộ đo: boundary CÓ bắt được, nên "không thấy
 * BOUNDARY_FALLBACK" là một phép đo, không phải một chuỗi chết
 * ------------------------------------------------------------------ */

describe('đối chứng — dây đo còn sống', () => {
  it('một component NÉM thật thì boundary hiện ra, và chuỗi đối chứng khớp', () => {
    // Không có bài này thì `expect(queryByText(BOUNDARY_FALLBACK)).not
    // .toBeInTheDocument()` ở tám chỗ bên trên vẫn xanh kể cả khi chuỗi bị gõ
    // sai — tức là tám khẳng định chết. Cùng lập luận `noKeyLeak.test.ts`
    // dùng cho "dây bẫy cho chính dây bẫy".
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // React re-throws a caught render error as an uncaught `error` event so
    // devtools still see it; jsdom then prints the whole stack. Swallowed here
    // so a DELIBERATE throw does not look like a failure in the run output.
    const swallow = (e: Event) => e.preventDefault();
    window.addEventListener('error', swallow);
    function Boom(): never {
      throw new Error('nổ');
    }
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(BOUNDARY_FALLBACK)).toBeInTheDocument();
    window.removeEventListener('error', swallow);
  });

  it('màn hình hỏng THẬT vẫn đỏ: không handler nào khớp → hiện thông báo mạng, vẫn không trắng', async () => {
    server.use(http.get(INDEX_URL, () => HttpResponse.error()));
    renderCatalog();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').not.toBe('');
    await waitFor(() => expect(visibleText()).not.toBe(''));
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
  });
});
