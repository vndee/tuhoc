import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { packZip } from '@tuhoc/course-format';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/local';
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

/* ------------------------------------------------------------------ *
 * Một GÓI THẬT, để phép kéo về đi hết chặng đường chứ không dừng ở một mock
 * ------------------------------------------------------------------ */

const SAMPLE_ID = 'so-dau-phay-dong';
const encode = (text: string) => new TextEncoder().encode(text);

/**
 * Manifest theo đúng hình dạng `manifest.json` của hai gói mẫu trong
 * `fixtures/courses/` — thứ `tools/tuhoc-cli` thật sự sinh ra, không phải một
 * bản mô phỏng. Nhờ vậy một bài đỏ ở đây đỏ vì lý do nó nêu, chứ không vì
 * thiếu `license`.
 */
function sampleManifest(chapterHtml: string): Map<string, Uint8Array> {
  return new Map([
    [
      'manifest.json',
      encode(
        JSON.stringify({
          id: SAMPLE_ID,
          title: 'Số dấu phẩy động',
          description: 'Vì sao 0.1 + 0.2 không bằng 0.3',
          lang: 'vi',
          version: '1.0.0',
          runtime: '^1',
          tier: 'content',
          license: 'CC-BY-4.0',
          authors: [{ name: 'Ai đó' }],
          generatedBy: 'human',
          parts: [
            {
              title: 'Phần I',
              chapters: [{ id: 'c1', num: '1.1', title: 'Mở đầu', short: 'Mở đầu', file: 'chapters/c1.html' }],
            },
          ],
        }),
      ),
    ],
    ['chapters/c1.html', encode(chapterHtml)],
  ]);
}

const sampleZip = () => packZip(sampleManifest('<h1 class="ch-title">Mở đầu</h1><p>Một số…</p>'));

/** Cùng gói ấy, hạng `content`, mang `<script>` — thứ bộ luật phải từ chối. */
const scriptZip = () => packZip(sampleManifest('<h1>Mở đầu</h1><script>fetch("/tien-cua-ban")</script>'));

/** Mọi địa chỉ .zip mà màn hình thật sự đi hỏi, theo thứ tự. */
let pulledUrls: string[] = [];

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(async () => {
  server.resetHandlers();
  vi.restoreAllMocks();
  await db.packages.clear();
});
afterAll(() => server.close());

beforeEach(() => {
  localStorage.clear();
  pulledUrls = [];
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

/* ====================================================================== *
 * HC-3 — nửa "LỌC" của spec §4.2, thứ chưa từng tồn tại
 *
 * Đo trước khi viết: `lang` chỉ xuất hiện hai chỗ trong `pages/Library.tsx`,
 * cả hai để VẼ CHỮ. Không một dòng nào đọc nó để quyết định gì.
 * ====================================================================== */

/** Ba course, ba ngôn ngữ khác nhau — hai trong số đó trùng nhau, để "lọc" khác "chọn một". */
function multilingualIndex(): RegistryIndex {
  return index({
    courses: [
      entry({ id: 'so-dau-phay-dong', title: 'Số dấu phẩy động', lang: 'vi' }),
      entry({ id: 'loop-invariants', title: 'Loop Invariants', lang: 'en' }),
      entry({ id: 'bat-bien-vong-lap', title: 'Bất biến vòng lặp', lang: 'vi' }),
    ],
  });
}

/** Nhan đề của mọi hàng đang hiện, theo đúng thứ tự trên màn hình. */
function visibleTitles(): string[] {
  return screen.queryAllByRole('listitem').map((li) => li.querySelector('.lib-item-title')?.textContent ?? '');
}

describe('lọc theo ngôn ngữ', () => {
  /**
   * Bộ chọn liệt kê ĐÚNG những ngôn ngữ có thật trong index — so bằng ĐÚNG.
   *
   * `toContain('vi')` cũng đúng với một bộ chọn ghi cứng `['vi','en']`, tức
   * đúng với một bộ chọn không hề đọc dữ liệu. Và `lang` của course là một
   * NHÃN TỰ DO từ manifest (`registry/types.ts`: *"Nothing translates on it"*)
   * — course viết bằng tiếng nào cũng được — nên danh sách chỉ có thể đến từ
   * dữ liệu, không từ `LANGS` của giao diện.
   */
  it('bộ chọn liệt kê ĐÚNG các ngôn ngữ có trong index, không phải một danh sách ghi cứng', async () => {
    server.use(http.get(INDEX_URL, () => HttpResponse.json(multilingualIndex())));
    renderCatalog();
    await screen.findByText('Số dấu phẩy động');

    const select = screen.getByRole('combobox', { name: /ngôn ngữ/i });
    const values = [...select.querySelectorAll('option')].map((o) => o.getAttribute('value'));
    // '' là "tất cả". Hai nhãn, không ba: `vi` xuất hiện hai lần trong dữ liệu.
    expect(values).toEqual(['', 'en', 'vi']);
  });

  it('ĐỐI CHỨNG: ngôn ngữ KHÔNG có trong index thì không có trong bộ chọn', async () => {
    server.use(http.get(INDEX_URL, () => HttpResponse.json(index({ courses: [entry({ lang: 'fr' })] }))));
    renderCatalog();
    await screen.findByText('Số dấu phẩy động');

    const values = [...screen.getByRole('combobox', { name: /ngôn ngữ/i }).querySelectorAll('option')].map((o) =>
      o.getAttribute('value'),
    );
    expect(values).toEqual(['', 'fr']);
  });

  it('chọn một ngôn ngữ thì danh sách còn ĐÚNG các course của ngôn ngữ ấy', async () => {
    const user = userEvent.setup();
    server.use(http.get(INDEX_URL, () => HttpResponse.json(multilingualIndex())));
    renderCatalog();
    await screen.findByText('Số dấu phẩy động');

    expect(visibleTitles()).toEqual(['Số dấu phẩy động', 'Loop Invariants', 'Bất biến vòng lặp']);

    await user.selectOptions(screen.getByRole('combobox', { name: /ngôn ngữ/i }), 'vi');

    // So bằng ĐÚNG cả danh sách. `expect(titles).not.toContain('Loop
    // Invariants')` cũng xanh với một bộ lọc xoá sạch màn hình.
    expect(visibleTitles()).toEqual(['Số dấu phẩy động', 'Bất biến vòng lặp']);

    await user.selectOptions(screen.getByRole('combobox', { name: /ngôn ngữ/i }), 'en');
    expect(visibleTitles()).toEqual(['Loop Invariants']);
  });

  /**
   * Một bộ lọc làm course BIẾN MẤT. Đó chính là hình dạng mà
   * `registry/index.ts` từ chối ở ranh giới — *"dropping bad entries and
   * rendering the rest makes a course silently invisible with no message
   * anywhere"* — nên phép lọc phải tự nói ra nó đang giấu bao nhiêu, và phải
   * gỡ lại được bằng một lần bấm.
   */
  it('nói rõ đang hiện bao nhiêu trên tổng bao nhiêu, không giấu im lặng', async () => {
    const user = userEvent.setup();
    server.use(http.get(INDEX_URL, () => HttpResponse.json(multilingualIndex())));
    renderCatalog();
    await screen.findByText('Số dấu phẩy động');

    await user.selectOptions(screen.getByRole('combobox', { name: /ngôn ngữ/i }), 'en');
    const status = screen.getByTestId('catalog-filter-count');
    expect(status).toHaveTextContent('1');
    expect(status).toHaveTextContent('3');
  });

  it('quay lại "tất cả" thì mọi course trở lại, ĐÚNG danh sách ban đầu', async () => {
    const user = userEvent.setup();
    server.use(http.get(INDEX_URL, () => HttpResponse.json(multilingualIndex())));
    renderCatalog();
    await screen.findByText('Số dấu phẩy động');

    const select = screen.getByRole('combobox', { name: /ngôn ngữ/i });
    await user.selectOptions(select, 'en');
    expect(visibleTitles()).toEqual(['Loop Invariants']);
    await user.selectOptions(select, '');
    expect(visibleTitles()).toEqual(['Số dấu phẩy động', 'Loop Invariants', 'Bất biến vòng lặp']);
  });

  /**
   * "Lọc ra rỗng" là trạng thái mà một bộ lọc ghi cứng sẽ có và bộ lọc này
   * KHÔNG ĐƯỢC PHÉP có: nếu mọi lựa chọn đều đến từ dữ liệu, thì không lựa
   * chọn nào giấu được hết mọi thứ, và màn hình không bao giờ nói dối rằng
   * *"registry chưa có khóa học nào"* trong khi nó có.
   *
   * Bài này duyệt QUA TỪNG lựa chọn thay vì thử một cái — một bộ lọc hỏng ở
   * đúng một nhãn (chữ hoa/thường, khoảng trắng thừa trong manifest) chỉ lộ ra
   * ở nhãn ấy.
   */
  it('KHÔNG lựa chọn nào lọc ra danh sách rỗng — mọi nhãn đều đến từ dữ liệu', async () => {
    const user = userEvent.setup();
    server.use(http.get(INDEX_URL, () => HttpResponse.json(multilingualIndex())));
    renderCatalog();
    await screen.findByText('Số dấu phẩy động');

    const select = screen.getByRole('combobox', { name: /ngôn ngữ/i });
    const values = [...select.querySelectorAll('option')].map((o) => o.getAttribute('value') ?? '');
    expect(values.length).toBeGreaterThan(1); // chống rỗng: bài dưới phải thật sự chạy vài vòng

    for (const value of values) {
      await user.selectOptions(select, value);
      expect(visibleTitles().length).toBeGreaterThan(0);
      expect(screen.queryByText(/chưa có khóa học nào/i)).not.toBeInTheDocument();
    }
  });
});

/* ====================================================================== *
 * NHÃN PHẢI NÓI RÕ **TRƯỚC KHI** KÉO VỀ
 *
 * Yêu cầu nguyên văn của chủ dự án: *"cần nhãn để user biết nên expect như thế
 * nào khi pull về thư viện cá nhân"*. Và hạng `interactive` là một quyết định
 * AN NINH — hạng ấy CHẠY MÃ trong trình duyệt người đọc.
 * ====================================================================== */

describe('nhãn hiện TRƯỚC khi kéo về', () => {
  it('hàng có nút kéo về, và nhãn NGÔN NGỮ + nhãn HẠNG đã ở đó khi chưa ai bấm', async () => {
    server.use(http.get(INDEX_URL, () => HttpResponse.json(index({ courses: [entry({ tier: 'interactive' })] }))));
    renderCatalog();
    await screen.findByText('Số dấu phẩy động');

    const row = screen.getByRole('listitem');
    const pull = within(row).getByRole('button', { name: /kéo về/i });

    // Thứ tự trong DOM là thứ chịu lực: cả nhãn LẪN câu cảnh báo phải nằm
    // TRƯỚC nút trong cùng hàng, vì đó là thứ người đọc quét qua trên đường
    // tới nút. Sau khi bấm thì mã đã nằm trên máy họ.
    expect(within(row).getByText('vi')).toBeInTheDocument();

    // Hai thứ KHÁC NHAU, và cả hai đều được đo:
    //   - nhãn hạng, `interactive — chạy mã JavaScript`;
    //   - câu nói ra hậu quả, cạnh cái nút.
    // Bài này từng chỉ đo cái thứ nhất, và một mutant dán câu cảnh báo lên
    // MỌI hàng sống sót — bộ đo khi ấy xanh vì lý do khác lý do nó tuyên bố.
    const badge = within(row).getByText(/chạy mã JavaScript/i);
    const warning = within(row).getByText(/được phép chạy JavaScript/i);
    expect(badge).not.toBe(warning);
    for (const before of [badge, warning]) {
      expect(before.compareDocumentPosition(pull) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    // Và chưa có gì được kéo về: nhãn là thứ hiện TRƯỚC, không phải hậu quả.
    expect(pulledUrls).toEqual([]);
  });

  /**
   * ĐỐI CHỨNG cho bài trên, và nó phải phủ CẢ HAI thứ bài trên khẳng định.
   * Không có nó, một cài đặt dán cảnh báo an ninh vào MỌI hàng cũng xanh — và
   * một cảnh báo hiện ở khắp nơi là một cảnh báo không còn nói gì, đúng thứ
   * nhãn hạng sinh ra để tránh.
   */
  it('ĐỐI CHỨNG: hạng `content` KHÔNG nói "chạy mã" và KHÔNG mang câu cảnh báo', async () => {
    server.use(http.get(INDEX_URL, () => HttpResponse.json(index({ courses: [entry({ tier: 'content' })] }))));
    renderCatalog();
    await screen.findByText('Số dấu phẩy động');

    const row = screen.getByRole('listitem');
    expect(within(row).queryByText(/chạy mã JavaScript/i)).not.toBeInTheDocument();
    expect(within(row).queryByText(/được phép chạy JavaScript/i)).not.toBeInTheDocument();
    expect(within(row).getByText('content')).toBeInTheDocument();
  });

  /**
   * Hạng LẠ cũng phải cảnh báo. Một gói khai `tier: "plugin"` không có gì bảo
   * đảm nó không chạy mã, và đọc một hạng không biết thành `content` là biến
   * *"ta không biết gói này chở gì"* thành một lời cho qua im lặng.
   */
  it('hạng LẠ được cảnh báo chứ không cho qua', async () => {
    server.use(
      http.get(INDEX_URL, () =>
        HttpResponse.json(index({ courses: [{ ...entry(), tier: 'plugin' } as unknown as RegistryEntry] })),
      ),
    );
    renderCatalog();
    await screen.findByText('Số dấu phẩy động');

    const row = screen.getByRole('listitem');
    expect(within(row).queryByText('content')).not.toBeInTheDocument();
    expect(within(row).getByText(/có thể chạy mã/i)).toBeInTheDocument();
  });
});

/* ====================================================================== *
 * KÉO VỀ — QUA ĐÚNG ĐƯỜNG `zipUrl` ĐÃ CÓ
 * ====================================================================== */

describe('kéo course về thư viện', () => {
  it('bấm kéo về → GET đúng địa chỉ .zip, và gói vào db.packages qua phễu cũ', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(INDEX_URL, () => HttpResponse.json(index({ courses: [entry({ id: SAMPLE_ID, latest: '1.0.0' })] }))),
      http.get(`${BASE}/courses/${SAMPLE_ID}/1.0.0.zip`, ({ request }) => {
        pulledUrls.push(request.url);
        return HttpResponse.arrayBuffer(sampleZip().buffer as ArrayBuffer, {
          headers: { 'content-type': 'application/zip' },
        });
      }),
    );
    renderCatalog();
    await screen.findByText('Số dấu phẩy động');

    await user.click(screen.getByRole('button', { name: /kéo về/i }));

    // 1. Đi qua MẠNG, tới đúng một địa chỉ — so bằng ĐÚNG cả danh sách, nên
    //    một cài đặt gọi thêm GitHub API hay tải rời từng tệp sẽ đỏ.
    await waitFor(() => expect(pulledUrls).toEqual([`${BASE}/courses/${SAMPLE_ID}/1.0.0.zip`]));

    // 2. Và tới ĐÚNG CHỖ mà cả ba đường cũ tới: một hàng trong `db.packages`.
    await waitFor(async () => {
      expect(await db.packages.get(`${SAMPLE_ID}@1.0.0`)).toBeDefined();
    });
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
  });

  it('gói hỏng → hiện câu người đọc hiểu được, KHÔNG trắng trang và KHÔNG lưu gì', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(INDEX_URL, () => HttpResponse.json(index({ courses: [entry({ id: SAMPLE_ID, latest: '1.0.0' })] }))),
      http.get(`${BASE}/courses/${SAMPLE_ID}/1.0.0.zip`, () =>
        HttpResponse.arrayBuffer(scriptZip().buffer as ArrayBuffer, {
          headers: { 'content-type': 'application/zip' },
        }),
      ),
    );
    renderCatalog();
    await screen.findByText('Số dấu phẩy động');

    await user.click(screen.getByRole('button', { name: /kéo về/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').not.toBe('');
    expect(await db.packages.get(`${SAMPLE_ID}@1.0.0`)).toBeUndefined();
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
  });

  it('mạng chết giữa chừng → một câu, không trắng trang', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(INDEX_URL, () => HttpResponse.json(index({ courses: [entry({ id: SAMPLE_ID, latest: '1.0.0' })] }))),
      http.get(`${BASE}/courses/${SAMPLE_ID}/1.0.0.zip`, () => HttpResponse.error()),
    );
    renderCatalog();
    await screen.findByText('Số dấu phẩy động');

    await user.click(screen.getByRole('button', { name: /kéo về/i }));

    expect((await screen.findByRole('alert')).textContent ?? '').not.toBe('');
    await waitFor(() => expect(visibleText()).not.toBe(''));
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
  });
});
