import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ErrorBoundary } from '../shell/ErrorBoundary';
import { Catalog } from './Catalog';
import { SUPPORTED_INDEX_SCHEMA } from './index.ts';
import type { RegistryEntry, RegistryIndex } from './types.ts';

const BASE = 'https://registry.example/reg';
const INDEX_URL = `${BASE}/index.json`;
const BOUNDARY_FALLBACK = 'Màn hình này gặp lỗi';

function entry(id: string, over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id,
    title: id,
    description: '',
    lang: 'vi',
    tier: 'content',
    license: 'CC-BY-4.0',
    authors: [{ name: 'Ai đó' }],
    generatedBy: 'human',
    versions: ['1.0.0'],
    latest: '1.0.0',
    bytes: 1,
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...over,
  };
}

function index(courses: readonly RegistryEntry[]): RegistryIndex {
  return { schema: SUPPORTED_INDEX_SCHEMA, generatedAt: '2026-08-22T00:00:00.000Z', courses: [...courses] };
}

/** Mọi chuỗi truy vấn `/ratings` thật sự rời khỏi trang, theo thứ tự. */
let ratingsQueries: string[] = [];
/** Mọi id `/discussions/:id` thật sự được hỏi. */
let discussionCalls: string[] = [];

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

beforeEach(() => {
  ratingsQueries = [];
  discussionCalls = [];
  localStorage.clear();
});

function ratingsHandler(rows: readonly { id: string; average: number; count: number; mine: number }[]) {
  return http.get('/ratings', ({ request }) => {
    const ids = new URL(request.url).searchParams.get('ids') ?? '';
    ratingsQueries.push(ids);
    const wanted = new Set(ids.split(',').filter((s) => s !== ''));
    return HttpResponse.json(rows.filter((r) => wanted.has(r.id)));
  });
}

const discussionsHandler = http.get('/discussions/:id', ({ params }) => {
  discussionCalls.push(String(params.id));
  return HttpResponse.json({ id: String(params.id), loaded: false, reason: 'disabled', url: '', comments: [] });
});

function renderCatalog(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter>
          <ErrorBoundary>{node}</ErrorBoundary>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

const rowTitles = () => screen.getAllByRole('listitem').map((li) => within(li).getByText(/^course-/).textContent);

/* ====================================================================== *
 * 1. CHỈ id CỦA REGISTRY ĐI RA — hàng rào riêng tư, phía gửi
 * ====================================================================== */

describe('/ratings được hỏi về ĐÚNG những gì registry đã liệt kê', () => {
  it('một request duy nhất cho cả trang, mang đúng ba id của index', async () => {
    server.use(
      http.get(INDEX_URL, () => HttpResponse.json(index([entry('course-a'), entry('course-b'), entry('course-c')]))),
      ratingsHandler([]),
      discussionsHandler,
    );
    renderCatalog(<Catalog registryBase={BASE} />);

    await waitFor(() => expect(ratingsQueries).toHaveLength(1));
    expect(ratingsQueries[0].split(',').sort()).toEqual(['course-a', 'course-b', 'course-c']);
  });

  it('index chưa về thì KHÔNG hỏi điểm — không có id nào để hỏi', async () => {
    server.use(
      http.get(INDEX_URL, () => HttpResponse.json({ schema: SUPPORTED_INDEX_SCHEMA, generatedAt: 'x' })),
      ratingsHandler([]),
    );
    renderCatalog(<Catalog registryBase={BASE} />);

    await screen.findByRole('alert');
    expect(ratingsQueries).toEqual([]);
  });

  it('danh mục rỗng → không request điểm nào (một `GET /ratings` trần là 400 ở tầng Go)', async () => {
    server.use(http.get(INDEX_URL, () => HttpResponse.json(index([]))), ratingsHandler([]));
    renderCatalog(<Catalog registryBase={BASE} />);

    await screen.findByText(/chưa có khóa học nào/i);
    expect(ratingsQueries).toEqual([]);
  });
});

/* ====================================================================== *
 * 2. BÀI HỌC TASK 6 — "có prop nào test luôn truyền mà production không?"
 * ====================================================================== */

describe('bản dựng THẬT, không một prop nào', () => {
  /**
   * `routes.tsx` render `<Catalog />` **không prop**. Lỗi production của Task
   * 6 sống sót qua 74 bài test vì mọi bài đều truyền `registryBase`, nên
   * nhánh mà bản dựng thật đi qua chưa từng được chạy.
   *
   * Bài này đi đúng nhánh ấy: biến môi trường được đặt, prop thì không, và
   * ô chấm sao vẫn phải xuất hiện. Nếu một ngày `Rating` chỉ được gắn trên
   * nhánh có prop, bài này đỏ và những bài khác thì không.
   */
  it('<Catalog /> đọc VITE_REGISTRY_URL và vẫn dựng đủ ô chấm sao', async () => {
    vi.stubEnv('VITE_REGISTRY_URL', BASE);
    server.use(
      http.get(INDEX_URL, () => HttpResponse.json(index([entry('course-a')]))),
      ratingsHandler([{ id: 'course-a', average: 4, count: 9, mine: 3 }]),
      discussionsHandler,
    );

    renderCatalog(<Catalog />);

    expect(await screen.findByText('course-a')).toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: '3 sao' })).toBeChecked();
    expect(ratingsQueries).toEqual(['course-a']);
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
  });
});

/* ====================================================================== *
 * 3. SẮP XẾP
 * ====================================================================== */

describe('danh mục sắp theo điểm', () => {
  it('điểm cao lên trước — và 5 sao/1 phiếu KHÔNG vượt 4,8/200 phiếu', async () => {
    server.use(
      http.get(INDEX_URL, () =>
        HttpResponse.json(index([entry('course-mot-phieu'), entry('course-nhieu-phieu'), entry('course-te')])),
      ),
      ratingsHandler([
        { id: 'course-mot-phieu', average: 5, count: 1, mine: 0 },
        { id: 'course-nhieu-phieu', average: 4.8, count: 200, mine: 0 },
        { id: 'course-te', average: 1.5, count: 40, mine: 0 },
      ]),
      discussionsHandler,
    );
    renderCatalog(<Catalog registryBase={BASE} />);

    await waitFor(() => expect(rowTitles()).toEqual(['course-nhieu-phieu', 'course-mot-phieu', 'course-te']));
  });

  it('chưa có điểm nào → giữ nguyên thứ tự registry, không xáo trộn vô cớ', async () => {
    server.use(
      http.get(INDEX_URL, () => HttpResponse.json(index([entry('course-z'), entry('course-a')]))),
      ratingsHandler([]),
      discussionsHandler,
    );
    renderCatalog(<Catalog registryBase={BASE} />);

    await screen.findByText('course-z');
    expect(rowTitles()).toEqual(['course-z', 'course-a']);
  });
});

/* ====================================================================== *
 * 4. `/ratings` HỎNG KHÔNG ĐƯỢC LÀM HỎNG DANH MỤC
 * ====================================================================== */

describe('điểm hỏng — danh mục vẫn dùng được', () => {
  /**
   * Spec §1.1: *"bản tự chạy dùng được registry công khai ở chế độ chỉ-đọc"*.
   * Một bản dựng như thế không có `apps/api` nào cả, nên `/ratings` sẽ luôn
   * hỏng — và danh mục vẫn phải liệt kê course và vẫn phải KÉO VỀ được.
   *
   * Đây là lý do danh sách KHÔNG chờ điểm mới vẽ: nếu chờ, tính năng chính
   * của màn hình này trở thành con tin của một máy chủ mà kiến trúc nói rõ
   * là không bắt buộc.
   */
  it.each([
    ['500', () => HttpResponse.json({ error: 'boom' }, { status: 500 })],
    ['mạng chết (không có apps/api nào)', () => HttpResponse.error()],
    ['thân là HTML', () => HttpResponse.html('<!doctype html><h1>404</h1>')],
    ['thân là một object chứ không phải mảng', () => HttpResponse.json({ items: [] })],
  ])('%s → vẫn liệt kê course, vẫn có nút kéo về, không trắng trang', async (_name, make) => {
    server.use(
      http.get(INDEX_URL, () => HttpResponse.json(index([entry('course-a')]))),
      http.get('/ratings', ({ request }) => {
        ratingsQueries.push(new URL(request.url).search);
        return make();
      }),
      discussionsHandler,
    );
    renderCatalog(<Catalog registryBase={BASE} />);

    expect(await screen.findByText('course-a')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /kéo về/i })).toBeInTheDocument();
    expect(screen.queryByText(BOUNDARY_FALLBACK)).not.toBeInTheDocument();
    // Không ô chấm sao nào khi không đọc được điểm: một ô chấm rỗng nói dối
    // rằng người đọc chưa chấm, trong khi sự thật là ta không biết.
    await waitFor(() => expect(ratingsQueries.length).toBeGreaterThan(0));
    expect(screen.queryAllByRole('radio')).toEqual([]);
  });
});

/* ====================================================================== *
 * 5. THẢO LUẬN — KHÔNG tải sẵn cho từng hàng
 * ====================================================================== */

describe('thảo luận trong danh mục', () => {
  it('hai mươi hàng, KHÔNG một lượt gọi /discussions nào cho tới khi người đọc mở', async () => {
    const many = Array.from({ length: 20 }, (_, i) => entry(`course-${String(i).padStart(2, '0')}`));
    server.use(
      http.get(INDEX_URL, () => HttpResponse.json(index(many))),
      ratingsHandler([]),
      discussionsHandler,
    );
    renderCatalog(<Catalog registryBase={BASE} />);

    await screen.findByText('course-00');
    await waitFor(() => expect(ratingsQueries).toHaveLength(1));
    expect(discussionCalls).toEqual([]);

    // Đối chứng NGƯỢC: mở MỘT hàng thì đúng MỘT lượt gọi được phát.
    await userEvent.click(screen.getAllByRole('button', { name: /thảo luận/i })[0]);
    await waitFor(() => expect(discussionCalls).toEqual(['course-00']));
  });
});
