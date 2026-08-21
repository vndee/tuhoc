import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { meQueryKey } from '../api/useMe';
import { clearLocalData, db } from '../db/local';
import { AppRoutes } from '../routes';
import { Library } from './Library';

/* ====================================================================== *
 * Fixtures
 * ====================================================================== */

/**
 * One entry of `GET /courses`'s response — apps/api/internal/course/
 * handler.go's `courseSummary`, restated here rather than imported for the
 * same reason `Dashboard.test.tsx` restates it: a change to the backend's
 * JSON shape must break a test, not silently produce an empty library.
 */
function catalogEntry(over: {
  id: string;
  title: string;
  lang?: string;
  tier?: string;
  versions?: string[];
  pinned?: string;
}) {
  return {
    id: over.id,
    title: over.title,
    lang: over.lang ?? 'vi',
    tier: over.tier ?? 'content',
    versions: over.versions ?? ['1.0.0'],
    pinned: over.pinned ?? '1.0.0',
  };
}

/** A v2 manifest (packages/course-format's `Manifest`) as it sits in `db.packages`. */
function packageManifest(over: {
  id: string;
  title: string;
  lang?: string;
  version?: string;
  tier?: string;
  registryId?: string;
}): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    id: over.id,
    title: over.title,
    description: 'mô tả',
    lang: over.lang ?? 'vi',
    version: over.version ?? '1.0.0',
    runtime: '^1',
    tier: over.tier ?? 'content',
    license: 'CC-BY-4.0',
    authors: [{ name: 'Người viết' }],
    generatedBy: 'human',
    parts: [
      { title: 'Phần 1', chapters: [{ id: 'c1', num: '1', title: 'Chương một', short: 'Chương một', file: 'chapters/c1.html' }] },
    ],
  };
  if (over.registryId !== undefined) manifest.registryId = over.registryId;
  return manifest;
}

/** Puts one expanded package on this device, the shape Task 8's import writes. */
async function holdPackage(over: {
  id: string;
  title: string;
  lang?: string;
  version?: string;
  tier?: string;
  registryId?: string;
  pinnedAt?: string;
}): Promise<void> {
  const version = over.version ?? '1.0.0';
  const manifest = packageManifest({ ...over, version });
  await db.packages.put({
    key: `${over.id}@${version}`,
    courseId: over.id,
    version,
    manifest,
    files: { 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) },
    pinnedAt: over.pinnedAt ?? new Date().toISOString(),
  });
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(clearLocalData);
afterEach(clearLocalData);

const AUTHENTICATED = http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'Người học' }));

/** msw's network-level failure: `fetch` rejects with a bare `TypeError`, no status, no body — the browser's answer for offline, DNS failure, a refused connection AND a CORS refusal, indistinguishably (ruling S1-F25). */
const NO_RESPONSE = http.get('/courses', () => HttpResponse.error());

function renderLibrary() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(meQueryKey, { id: 'u1', email: 'a@vi.vn', name: 'Người học' });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/library']}>
        <Library />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The course list, addressed by its accessible name so the empty state's own `<ul>` can never be mistaken for it. */
function courseList(): HTMLElement {
  return screen.getByRole('list', { name: /khóa học của bạn/i });
}

async function rowFor(title: string): Promise<HTMLElement> {
  await screen.findByText(title);
  const row = within(courseList())
    .getAllByRole('listitem')
    .find((li) => within(li).queryByText(title) !== null);
  if (row === undefined) throw new Error(`no library row for ${title}`);
  return row;
}

/* ====================================================================== *
 * Step 1 — the three assertions the brief names
 * ====================================================================== */

describe('Thư viện — liệt kê', () => {
  it('liệt kê đủ course từ GET /courses VÀ từ Dexie, mỗi course một lần, kèm ngôn ngữ / hạng / phiên bản đang ghim / nguồn', async () => {
    server.use(
      http.get('/courses', () =>
        HttpResponse.json([
          catalogEntry({ id: 'tren-may-chu', title: 'Khóa trên máy chủ', lang: 'vi', versions: ['1.0.0', '1.2.0'], pinned: '1.2.0' }),
          // Also held on this device — must appear ONCE, not twice. The
          // server says 3.0.0 is pinned; this device holds 2.5.0.
          catalogEntry({ id: 'ca-hai', title: 'Khóa ở cả hai nơi', pinned: '3.0.0' }),
        ]),
      ),
    );
    await holdPackage({ id: 'goi-tu-nhap', title: 'Gói mang từ ngoài vào', lang: 'en', version: '2.0.0' });
    await holdPackage({ id: 'ca-hai', title: 'Khóa ở cả hai nơi', version: '2.5.0' });

    renderLibrary();

    // Every course, from both sources.
    const server1 = await rowFor('Khóa trên máy chủ');
    const local = await rowFor('Gói mang từ ngoài vào');
    const both = await rowFor('Khóa ở cả hai nơi');

    // Exactly three rows: a course held in both places is one course.
    expect(within(courseList()).getAllByRole('listitem')).toHaveLength(3);

    // Language, pinned version and source, per row.
    expect(within(server1).getByText(/\bvi\b/)).toBeInTheDocument();
    expect(within(server1).getByText(/1\.2\.0/)).toBeInTheDocument();
    expect(within(server1).getByText(/riêng tư/i)).toBeInTheDocument();

    expect(within(local).getByText(/\ben\b/)).toBeInTheDocument();
    expect(within(local).getByText(/2\.0\.0/)).toBeInTheDocument();
    expect(within(local).getByText(/tự nhập/i)).toBeInTheDocument();

    // The version printed is the one that will OPEN, not the one the server
    // recommends. `course/loader.ts` reads the cached package first and never
    // falls back once it hits, so for a course held on this device the local
    // version IS what a reader meets — printing the server's `pinned` beside
    // it would be a lie that looks like a fact. (Independent mutation testing
    // found this: swapping the local version for the server's survived the
    // whole suite while both fixtures happened to say 3.0.0.)
    expect(within(both).getByText(/2\.5\.0/)).toBeInTheDocument();
    expect(within(both).queryByText(/3\.0\.0/)).not.toBeInTheDocument();

    // And every row opens its course.
    expect(within(server1).getByRole('link')).toHaveAttribute('href', '/c/tren-may-chu');
    expect(within(local).getByRole('link')).toHaveAttribute('href', '/c/goi-tu-nhap');
  });

  it('một gói đã có registryId được ghi nguồn là registry, không phải tự nhập', async () => {
    // The registry itself is subsystem 3. The manifest field it stamps
    // (`registryId`, packages/course-format's v2 `Manifest`) exists today,
    // so the lane is wired to something real rather than to a placeholder.
    server.use(http.get('/courses', () => HttpResponse.json([])));
    await holdPackage({ id: 'tu-registry', title: 'Khóa lấy từ kho chung', registryId: 'vndee/khoa' });

    renderLibrary();

    const row = await rowFor('Khóa lấy từ kho chung');
    expect(within(row).getByText(/registry/i)).toBeInTheDocument();
    expect(within(row).queryByText(/tự nhập/i)).not.toBeInTheDocument();
  });
});

describe('Thư viện — nhãn hạng interactive (§1.2, quyết định AN NINH)', () => {
  it('hạng interactive hiện rõ và nói ra rằng khóa học đó CHẠY MÃ; hạng content thì không', async () => {
    server.use(
      http.get('/courses', () =>
        HttpResponse.json([
          catalogEntry({ id: 'chay-ma', title: 'Khóa có mô phỏng', tier: 'interactive' }),
          catalogEntry({ id: 'chi-chu', title: 'Khóa chỉ có chữ', tier: 'content' }),
        ]),
      ),
    );

    renderLibrary();

    const interactive = await rowFor('Khóa có mô phỏng');
    const content = await rowFor('Khóa chỉ có chữ');

    // The label a reader who is about to pull this course needs to see.
    expect(within(interactive).getByText(/interactive/i)).toBeInTheDocument();
    // Not just the word — what the word MEANS, in the reader's language.
    expect(within(interactive).getByText(/chạy mã/i)).toBeInTheDocument();

    // The complement: a rule that only ever warns is satisfied by warning
    // about everything, which is the same as warning about nothing.
    expect(within(content).queryByText(/interactive/i)).not.toBeInTheDocument();
    expect(within(content).queryByText(/chạy mã/i)).not.toBeInTheDocument();
  });

  it('hạng interactive của một gói TRÊN MÁY cũng hiện rõ — không chỉ của catalog', async () => {
    server.use(http.get('/courses', () => HttpResponse.json([])));
    await holdPackage({ id: 'goi-chay-ma', title: 'Gói có mô phỏng', tier: 'interactive' });

    renderLibrary();

    const row = await rowFor('Gói có mô phỏng');
    expect(within(row).getByText(/interactive/i)).toBeInTheDocument();
    expect(within(row).getByText(/chạy mã/i)).toBeInTheDocument();
  });

  it('một gói KHÔNG khai hạng bị cảnh báo như hạng chạy mã, không im lặng', async () => {
    // Failing closed on a security label. A manifest with no `tier` is a
    // package neither the server's CHECK constraint nor course-format's
    // validator ever saw; treating "unknown" as "content" would turn a
    // missing field into a silent all-clear.
    server.use(http.get('/courses', () => HttpResponse.json([])));
    const manifest = packageManifest({ id: 'khong-hang', title: 'Gói không khai hạng' });
    delete manifest.tier;
    await db.packages.put({
      key: 'khong-hang@1.0.0',
      courseId: 'khong-hang',
      version: '1.0.0',
      manifest,
      files: { 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) },
      pinnedAt: new Date().toISOString(),
    });

    renderLibrary();

    const row = await rowFor('Gói không khai hạng');
    expect(within(row).getByText(/chạy mã/i)).toBeInTheDocument();
  });
});

describe('Thư viện — course riêng tư', () => {
  it('course riêng tư có dấu hiệu riêng và KHÔNG có nút chia sẻ nào', async () => {
    server.use(
      http.get('/courses', () => HttpResponse.json([catalogEntry({ id: 'cua-toi', title: 'Khóa của riêng tôi' })])),
    );

    renderLibrary();

    const row = await rowFor('Khóa của riêng tôi');

    // Its own mark, said in words rather than implied by an absence.
    expect(within(row).getByText(/riêng tư/i)).toBeInTheDocument();

    // …and the row still does its job, so "render nothing" cannot satisfy
    // the negative assertion below.
    expect(within(row).getByRole('link')).toHaveAttribute('href', '/c/cua-toi');

    // Nothing anywhere offers to share it. §2.4: riêng tư means no other
    // user sees it — a share control on this row would be the one way to
    // undo that by accident.
    const SHARE = /chia sẻ|share|công khai|xuất bản|publish|sao chép liên kết|copy link/i;
    expect(within(row).queryAllByRole('button', { name: SHARE })).toHaveLength(0);
    expect(within(row).queryAllByRole('link', { name: SHARE })).toHaveLength(0);
    expect(within(row).queryByText(SHARE)).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: SHARE })).toHaveLength(0);
    expect(screen.queryAllByRole('link', { name: SHARE })).toHaveLength(0);
  });
});

/* ====================================================================== *
 * The new-user path (ruling S1-F17) — an empty library is the MAIN road
 * ====================================================================== */

describe('Thư viện — người dùng mới tinh (thư viện RỖNG)', () => {
  it('trạng thái rỗng là một hành động: dẫn thẳng tới /import và nói ra ba cách nhập', async () => {
    server.use(http.get('/courses', () => HttpResponse.json([])));

    renderLibrary();

    expect(await screen.findByText(/thư viện của bạn đang trống/i)).toBeInTheDocument();

    // A door, not a sentence. Task 6 deleted the hardcoded course list on
    // purpose (§9.5): a seeded course would hide a broken import path, so
    // this screen is what every new account actually lands on.
    const toImport = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/import');
    expect(toImport.length, 'trạng thái rỗng không có lối vào /import — nền tảng chết ở bước một').toBeGreaterThanOrEqual(1);
    expect(toImport.map((a) => a.textContent).join(' ')).toMatch(/nhập/i);

    // The three ways in, named where the reader is standing.
    expect(screen.getAllByText(/\.zip/).length).toBeGreaterThan(0);
    expect(screen.getByText(/github/i)).toBeInTheDocument();

    // And the registry's place is held, without a link that goes nowhere.
    const registryNote = screen.getByText(/registry|kho khóa học cộng đồng/i);
    expect(registryNote).toBeInTheDocument();
    expect(within(registryNote).queryByRole('link')).not.toBeInTheDocument();

    expect(screen.queryByRole('list', { name: /khóa học của bạn/i })).not.toBeInTheDocument();
  });

  it('KHÔNG chớp trạng thái rỗng khi GET /courses còn đang bay', async () => {
    // Same rule the Dashboard already follows: "chưa biết" is not "không có".
    server.use(http.get('/courses', () => new Promise(() => {})));

    renderLibrary();

    expect(await screen.findByText(/đang tải thư viện/i)).toBeInTheDocument();
    expect(screen.queryByText(/thư viện của bạn đang trống/i)).not.toBeInTheDocument();
  });
});

/* ====================================================================== *
 * The offline-read indicator (ruling S1-F25)
 * ====================================================================== */

describe('Thư viện — chỉ báo đang đọc ngoại tuyến', () => {
  it('khi KHÔNG có phản hồi nào từ máy chủ: vẫn liệt kê gói trên máy, và nói rõ đang đọc bản lưu — kể cả khả năng cấu hình sai', async () => {
    server.use(NO_RESPONSE);
    await holdPackage({ id: 'goi-tren-may', title: 'Gói trên máy' });

    renderLibrary();

    // What is on the device is still readable…
    expect(await rowFor('Gói trên máy')).toBeInTheDocument();

    // …and the page says so, instead of looking like a complete library.
    const notice = await screen.findByText(/đang đọc bản lưu trên máy/i);
    expect(notice).toBeInTheDocument();
    // Both readings of a bare `TypeError`, because the browser refuses to
    // say which one it was. Naming only "ngoại tuyến" is what makes a
    // misconfigured deploy invisible to everybody, operator included.
    expect(notice.textContent).toMatch(/ngoại tuyến/i);
    expect(notice.textContent).toMatch(/CORS/i);
  });

  it('khi máy chủ CÓ trả lời nhưng lỗi (500): KHÔNG gọi đó là ngoại tuyến', async () => {
    // The distinction `serverAnswered` exists to preserve: a reachable,
    // broken server is not an offline device, and labelling it one would
    // hide a bad deploy behind "chắc mạng bạn yếu".
    server.use(http.get('/courses', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    await holdPackage({ id: 'goi-tren-may', title: 'Gói trên máy' });

    renderLibrary();

    expect(await rowFor('Gói trên máy')).toBeInTheDocument();
    expect(await screen.findByText(/HTTP 500/)).toBeInTheDocument();
    expect(screen.queryByText(/đang đọc bản lưu trên máy/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/CORS/i)).not.toBeInTheDocument();
  });

  it('khi máy chủ trả lời bình thường: KHÔNG có chỉ báo ngoại tuyến nào', async () => {
    // The other direction. An indicator that is always on says nothing.
    server.use(http.get('/courses', () => HttpResponse.json([catalogEntry({ id: 'binh-thuong', title: 'Khóa bình thường' })])));

    renderLibrary();

    await rowFor('Khóa bình thường');
    expect(screen.queryByText(/đang đọc bản lưu trên máy/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/HTTP/)).not.toBeInTheDocument();
  });
});

/* ====================================================================== *
 * Route + navigation
 * ====================================================================== */

function Recorder({ onChange }: { onChange: (pathname: string) => void }) {
  const location = useLocation();
  useEffect(() => {
    onChange(location.pathname);
  }, [location.pathname, onChange]);
  return null;
}

function renderRouteAt(path: string, pathnames: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Recorder onChange={(p) => pathnames.push(p)} />
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('/library', () => {
  it('người chưa đăng nhập bị đưa về /login, và KHÔNG thấy thư viện', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const pathnames: string[] = [];

    renderRouteAt('/library', pathnames);

    await waitFor(() => expect(pathnames.at(-1)).toBe('/login'));
    // Exact name: the empty state's own <h2> also contains "Thư viện", and a
    // loose matcher here would be asking about two headings at once.
    expect(screen.queryByRole('heading', { name: 'Thư viện' })).not.toBeInTheDocument();
  });

  it('người đã đăng nhập thì vào được', async () => {
    server.use(AUTHENTICATED, http.get('/courses', () => HttpResponse.json([])));
    const pathnames: string[] = [];

    renderRouteAt('/library', pathnames);

    expect(await screen.findByRole('heading', { name: 'Thư viện' })).toBeInTheDocument();
    expect(pathnames.at(-1)).toBe('/library');
  });
});
