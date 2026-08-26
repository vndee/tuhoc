import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { meQueryKey } from '../api/useMe';
import { clearLocalData, db } from '../db/local';
import { AppRoutes } from '../routes';
import { Library } from './Library';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ThemeProvider } from '../theme/ThemeContext';

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

/**
 * `GET /stats` with nothing in it.
 *
 * A DEFAULT handler (survives `resetHandlers`) rather than a line in every
 * test: `/library` reads the same four sources the Dashboard does since ruling
 * S1-F31, and `stats.courses` is one of them — a course studied on another
 * device is still the reader's course. Empty here so that every test written
 * before that ruling still describes exactly the situation it meant to;
 * the tests that care about this source override it.
 */
const NO_STATS = http.get('/stats', () =>
  HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] }),
);

const server = setupServer(NO_STATS);
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
      <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={['/library']}>
        <Library />
      </MemoryRouter></LanguageProvider></ThemeProvider>
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

/**
 * MỌI liên kết trong một hàng phải trỏ đúng khoá của hàng ấy.
 *
 * Bản trước hỏi `getByRole('link')` — ngầm định một hàng có ĐÚNG MỘT liên kết.
 * Bản dựng đã duyệt cho mỗi hàng hai lối vào cùng một chỗ: tên khoá, và nút
 * "Đọc tiếp"/"Bắt đầu đọc" ở mép phải. Hai affordance cho một đích là bình
 * thường trong một thẻ; `getByRole` số ít thì không.
 *
 * Hỏi TẤT CẢ thay vì hỏi cái đầu tiên, nên câu hỏi mạnh lên chứ không yếu đi:
 * bản cũ chỉ chứng minh "có một liên kết đúng", bản này chứng minh "không có
 * liên kết nào SAI" — thứ bắt được một hàng lỡ trỏ sang khoá bên cạnh.
 */
function expectRowLinksTo(row: HTMLElement, href: string): void {
  const links = within(row).getAllByRole('link');
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) expect(link).toHaveAttribute('href', href);
}

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
    //
    // Asserted against the METADATA LINE rather than against the whole row,
    // which is what it used to be. The server's 3.0.0 now appears elsewhere in
    // this row on purpose — as the update on offer (ruling S1-F29) — and a
    // row-wide "3.0.0 must not appear" would forbid the correct sentence along
    // with the wrong one. The mutation it was written to kill (print
    // `catalog.pinned` as the version that opens) still fails here.
    const bothMeta = both.querySelector('.lib-meta');
    expect(bothMeta?.textContent).toMatch(/phiên bản 2\.5\.0/);
    expect(bothMeta?.textContent).not.toMatch(/3\.0\.0/);

    // And every row opens its course.
    expectRowLinksTo(server1, '/c/tren-may-chu');
    expectRowLinksTo(local, '/c/goi-tu-nhap');
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

/* ====================================================================== *
 * Ruling S1-F31 — "mọi course bạn có" phải là CÙNG MỘT câu trả lời
 * ====================================================================== */

describe('Thư viện — bốn nguồn, một câu trả lời (S1-F31)', () => {
  it('liệt kê course mà người đọc ĐANG HỌC dù catalog rỗng và máy không giữ gói nào', async () => {
    // The measured bug, restated as a test. A reader partway through a course
    // that came from `course/loader.ts`'s SOURCE 2 (the static `courses/`
    // directory) had: `GET /courses` → [], `db.packages` → empty,
    // `db.progress` → rows. The Dashboard drew them a card reading
    // "1/44 chương · 42 phút"; `/library`, seconds later, told them their
    // library was empty and advised them to import the course they were
    // reading.
    server.use(
      http.get('/courses', () => HttpResponse.json([])),
      http.get('/courses/dang-doc/manifest.json', () =>
        HttpResponse.json({
          id: 'dang-doc',
          title: 'Khóa đang đọc dở',
          description: '',
          lang: 'vi',
          version: '1.4.0',
          runtime: '^1',
          parts: [{ title: 'P', chapters: [{ id: 'c1', num: '1', title: 'Một', short: 'Một', file: 'chapters/c1.html' }] }],
        }),
      ),
    );
    await db.progress.put({
      courseId: 'dang-doc',
      chapterId: 'c1',
      status: 'read',
      done: true,
      updatedAt: new Date().toISOString(),
    });

    renderLibrary();

    const row = await rowFor('Khóa đang đọc dở');
    expectRowLinksTo(row, '/c/dang-doc');
    // Named from its own manifest rather than printed as a raw id.
    expect(row.textContent).toMatch(/1\.4\.0/);
    expect(screen.queryByText(/thư viện của bạn đang trống/i)).not.toBeInTheDocument();
  });

  it('liệt kê course mà chỉ GET /stats biết — đã học trên MÁY KHÁC', async () => {
    server.use(
      http.get('/courses', () => HttpResponse.json([])),
      http.get('/stats', () =>
        HttpResponse.json({
          totalMinutes: 42,
          streakDays: 1,
          days: [],
          courses: [{ courseId: 'may-khac', minutes: 42, chaptersDone: 1 }],
        }),
      ),
      http.get('/courses/may-khac/manifest.json', () => new HttpResponse(null, { status: 404 })),
    );

    renderLibrary();

    // No manifest anywhere for it, so the id is all there is to print — and
    // printing the id beats leaving the reader's own course off the list.
    const row = await rowFor('may-khac');
    expectRowLinksTo(row, '/c/may-khac');
    expect(within(row).getByText(/không rõ nguồn/i)).toBeInTheDocument();
  });

  it('KHÔNG nói "đang trống" khi mới chỉ có /courses trả lời — /stats còn đang bay', async () => {
    // The empty state is a CLAIM, and it may only be made once every source
    // has answered. Before S1-F31 this page watched one query; a reader whose
    // only course lives in `stats.courses` would have been told they had none
    // for as long as that request took.
    server.use(
      http.get('/courses', () => HttpResponse.json([])),
      http.get('/stats', () => new Promise(() => {})),
    );

    renderLibrary();

    expect(await screen.findByText(/đang tải thư viện/i)).toBeInTheDocument();
    expect(screen.queryByText(/thư viện của bạn đang trống/i)).not.toBeInTheDocument();
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

  it('gói cục bộ KHÔNG khai hạng thì KHÔNG thừa kế lời khai "content" của máy chủ', async () => {
    // The fail-open lane review found (F6). Every other field falls back to
    // the catalog, because a wrong `lang` is cosmetic. A tier is not: the two
    // claims are about two DIFFERENT artifacts — the server describes the
    // package IT holds, and the one that opens is the one on this device
    // (`course/loader.ts` reads the cached package first and never falls back
    // once it hits). Inheriting `content` here is a silent all-clear issued
    // about something nobody looked at.
    server.use(
      http.get('/courses', () =>
        HttpResponse.json([catalogEntry({ id: 'cung-id', title: 'Khóa cùng id', tier: 'content' })]),
      ),
    );
    const manifest = packageManifest({ id: 'cung-id', title: 'Khóa cùng id' });
    delete manifest.tier;
    await db.packages.put({
      key: 'cung-id@2.0.0',
      courseId: 'cung-id',
      version: '2.0.0',
      manifest,
      files: { 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) },
      pinnedAt: new Date().toISOString(),
    });

    renderLibrary();

    const row = await rowFor('Khóa cùng id');
    expect(within(row).getByText(/chạy mã/i)).toBeInTheDocument();
    expect(within(row).queryByText(/^content$/i)).not.toBeInTheDocument();
  });
});

/* ====================================================================== *
 * Ruling S1-F29 — UpdateDialog phải CÓ NGƯỜI BẤM TỚI ĐƯỢC
 * ====================================================================== */

describe('Thư viện — cửa vào hộp thoại cập nhật (S1-F29)', () => {
  /** Held at 1.0.0, catalog pinned at 1.1.0 — the only shape that offers one. */
  async function heldBehindCatalog() {
    server.use(
      http.get('/courses', () =>
        HttpResponse.json([
          catalogEntry({ id: 'co-ban-moi', title: 'Khóa có bản mới', versions: ['1.0.0', '1.1.0'], pinned: '1.1.0' }),
        ]),
      ),
    );
    await holdPackage({ id: 'co-ban-moi', title: 'Khóa có bản mới', version: '1.0.0' });
  }

  it('mở được hộp thoại cập nhật từ một hàng — 775 dòng của Task 10 trước đây KHÔNG tệp sản phẩm nào import', async () => {
    // The fourth blind gate (docs/carried-forward.md): `UpdateDialog.tsx` and
    // `course/version.ts` shipped with 713 tests green, `tsc -b` clean, `build`
    // clean, `lint` clean — and no product file importing either of them. No
    // automated gate this project has can ask "can a reader reach this", so the
    // question is asked here, through the real row, with a real click.
    await heldBehindCatalog();
    renderLibrary();

    const row = await rowFor('Khóa có bản mới');
    expect(within(row).getByText(/có bản mới: v1\.1\.0/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: /xem thay đổi/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /cập nhật .*Khóa có bản mới/i })).toBeInTheDocument();
    // The version pair it is deciding between: held → offered, in that order.
    expect(dialog.textContent).toMatch(/v1\.0\.0\s*→\s*v1\.1\.0/);
    // And it really ran the dry run rather than sitting on its opening state.
    expect(within(dialog).getByRole('button', { name: /^cập nhật$/i })).toBeEnabled();
  });

  it('đóng lại được, và KHÔNG ghi gì: gói đang ghim vẫn nguyên sau khi xem thử', async () => {
    // `previewUpdate` writes nothing (`course/version.ts` rule 1) and that is
    // what lets the button above be offered without an "are you sure". Checked
    // from the outside, through the UI, because the module's own tests check it
    // from the inside and neither knows whether the two are connected.
    await heldBehindCatalog();
    renderLibrary();

    const row = await rowFor('Khóa có bản mới');
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: /xem thay đổi/i }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: /ở lại v1\.0\.0/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(await db.packages.count()).toBe(1);
    expect(await db.packages.get('co-ban-moi@1.0.0')).toBeDefined();
  });

  it('KHÔNG mời cập nhật khi bản trên máy đã đúng bản máy chủ ghim', async () => {
    // The complement. An offer that is always on the screen is not an offer.
    server.use(
      http.get('/courses', () =>
        HttpResponse.json([catalogEntry({ id: 'dung-ban', title: 'Khóa đúng bản', pinned: '1.0.0' })]),
      ),
    );
    await holdPackage({ id: 'dung-ban', title: 'Khóa đúng bản', version: '1.0.0' });

    renderLibrary();

    const row = await rowFor('Khóa đúng bản');
    expect(within(row).queryByRole('button', { name: /xem thay đổi/i })).not.toBeInTheDocument();
    expect(within(row).queryByText(/có bản mới/i)).not.toBeInTheDocument();
  });

  it('KHÔNG mời cập nhật cho một course máy chưa giữ gói nào', async () => {
    // For a course this device does not hold, `catalog.pinned` is not an
    // update — it is simply the version that will be downloaded on first open.
    // Offering to "update" to it would be a dialog measuring notes that do not
    // exist against a version nobody has.
    server.use(
      http.get('/courses', () =>
        HttpResponse.json([catalogEntry({ id: 'chua-tai', title: 'Khóa chưa tải', pinned: '9.9.9' })]),
      ),
    );

    renderLibrary();

    const row = await rowFor('Khóa chưa tải');
    expect(within(row).queryByRole('button', { name: /xem thay đổi/i })).not.toBeInTheDocument();
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
    expectRowLinksTo(row, '/c/cua-toi');

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
  it('trạng thái rỗng là một hành động: mở thẳng hộp thoại nhập gói và nói ra ba cách nhập', async () => {
    server.use(http.get('/courses', () => HttpResponse.json([])));

    renderLibrary();

    expect(await screen.findByText(/thư viện của bạn đang trống/i)).toBeInTheDocument();

    // A door, not a sentence. Task 6 deleted the hardcoded course list on
    // purpose (§9.5): a seeded course would hide a broken import path, so
    // this screen is what every new account actually lands on.
    //
    // Đích là `/courses?import=1`, không phải `/import`: màn nhập gói nay là
    // một hộp thoại của `/courses`, và tham số ấy là thứ mở nó ra. `/import`
    // vẫn chuyển hướng về đúng đây, nhưng một liên kết TRONG ứng dụng trỏ vào
    // đường cũ là bắt người đọc đi qua một lần chuyển hướng không cần thiết —
    // và làm bài này xanh kể cả khi chuyển hướng ấy bị gỡ mất tham số.
    const toImport = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/courses?import=1');
    expect(toImport.length, 'trạng thái rỗng không có lối vào phần nhập gói — nền tảng chết ở bước một').toBeGreaterThanOrEqual(1);
    expect(toImport.map((a) => a.textContent).join(' ')).toMatch(/nhập/i);

    // The three ways in, named where the reader is standing.
    expect(screen.getAllByText(/\.zip/).length).toBeGreaterThan(0);
    expect(screen.getByText(/github/i)).toBeInTheDocument();

    // And the registry's place is held, without a link that goes nowhere.
    const registryNote = screen.getByText(/registry/i);
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
      <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={[path]}>
        <Recorder onChange={(p) => pathnames.push(p)} />
        <AppRoutes />
      </MemoryRouter></LanguageProvider></ThemeProvider>
    </QueryClientProvider>,
  );
}

/**
 * `/library` nay là một CHUYỂN HƯỚNG sang `/courses`, nơi thư viện là tab "Của
 * bạn" (`docs/superpowers/specs/2026-08-23-ia-redesign.md`).
 *
 * Trước Task 12, cặp ca dưới đây canh CẢ HAI câu hỏi — đường cũ có còn đưa
 * người đọc tới thư viện của họ không, VÀ có còn nằm sau `RequireAuth` không.
 * Câu hỏi thứ hai không còn ý nghĩa: Task 12 gỡ `<RequireAuth>` khỏi
 * `/courses` (đọc là công khai, spec §2.4), nên "người chưa đăng nhập bị đưa
 * về /login" không còn là hành vi thật — case đó bị GỠ ở đây, không sửa
 * thành yếu hơn, vì cái nó từng canh đã không còn tồn tại. Case còn lại
 * (dưới) được ghép với một case mới canh đúng bất biến HIỆN TẠI: người chưa
 * đăng nhập tới ĐÚNG cùng một nơi người đã đăng nhập tới, không phải "không
 * còn /login" một cách mơ hồ.
 */
describe('/library → /courses', () => {
  it('người CHƯA đăng nhập (GET /me → 401) vẫn tới được /courses, không bị đưa về /login', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    server.use(http.get('/courses', () => HttpResponse.json([])));
    const pathnames: string[] = [];

    renderRouteAt('/library', pathnames);

    expect(await screen.findByRole('heading', { name: 'Khoá học', level: 1 })).toBeInTheDocument();
    expect(pathnames.at(-1)).toBe('/courses');
    expect(pathnames).not.toContain('/login');
  });

  it('người đã đăng nhập thì vào được', async () => {
    server.use(AUTHENTICATED, http.get('/courses', () => HttpResponse.json([])));
    const pathnames: string[] = [];

    renderRouteAt('/library', pathnames);

    // Nhan đề chứng minh màn hình dựng lên; cái TAB đang mở chứng minh nó dựng
    // lên đúng nửa mà `/library` từng trỏ tới. Chuyển hướng nhầm sang
    // `?tab=registry` vẫn cho ra `h1` y hệt, nên riêng nhan đề là chưa đủ.
    expect(await screen.findByRole('heading', { name: 'Khoá học', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /của bạn/i })).toHaveAttribute('aria-current', 'page');
    expect(pathnames.at(-1)).toBe('/courses');
  });
});
