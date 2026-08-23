import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, getConfig, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { meQueryKey } from '../api/useMe';
import { type AnnotationRow, clearLocalData, db } from '../db/local';
import * as engine from '../sync/engine';
import { Dashboard } from '../pages/Dashboard';
import type { Manifest } from '../course/types';
import { LanguageProvider } from '../i18n/LanguageProvider';

/**
 * `/` — **Học tiếp**, sau khi thiết kế lại thứ bậc.
 *
 * Tệp này từng canh một BẢNG SỐ LIỆU: chuỗi ngày, tổng phút, một biểu đồ 30
 * cột, và một thẻ cho mỗi khoá học. Cả bốn thứ ấy đã rời khỏi trang chủ —
 * các con số sang `/progress`, danh sách khoá học sang `/courses` — nên những
 * bài canh chúng ở ĐÂY đã được viết lại chứ không nới ra: mỗi tính chất cũ hoặc
 * còn nguyên với định danh mới (trạng thái rỗng, đăng xuất, không nháy trạng
 * thái rỗng, không trắng trang), hoặc được thay bằng tính chất đã thay thế nó.
 *
 * Bài `không còn một con số học tập nào ở trang chủ` là bài giữ cho việc dọn
 * dẹp ấy không lặng lẽ đi ngược: hai số 0 cỡ lớn quay lại trang chủ sẽ đỏ.
 */

function catalogManifest(): Manifest {
  // The manifest of the course the default `GET /courses` stub below puts
  // in the learner's catalog — every test stubs its manifest endpoint so a
  // stray real network call never happens even for tests that don't care
  // about this course.
  return {
    id: 'so-dau-phay-dong',
    title: 'Số dấu phẩy động',
    description: 'desc',
    lang: 'vi',
    version: '1.0.0',
    runtime: '^1',
    parts: [{ title: 'Phần 0', chapters: [{ id: 'p0-1', num: '0.1', title: 'Mở đầu', short: 'Mở đầu', file: 'chapters/p0-1.html' }] }],
  };
}

function demoManifest(chapterCount: number): Manifest {
  return {
    id: 'demo',
    title: 'Khóa học demo',
    description: 'Mô tả demo',
    lang: 'vi',
    version: '1.0.0',
    runtime: '^1',
    parts: [
      {
        title: 'Phần A',
        chapters: Array.from({ length: chapterCount }, (_, i) => ({
          id: `ch-${i + 1}`,
          num: `${i + 1}`,
          title: `Chương ${i + 1}`,
          short: `Chương ${i + 1}`,
          file: `chapters/ch-${i + 1}.html`,
        })),
      },
    ],
  };
}

/**
 * Ngân sách CHỜ của mọi `findBy*`/`waitFor` trong file này, và ngân sách
 * của mỗi `it`. Không phải một khẳng định nào cả — đây là hai cái trần an
 * toàn, và lý do phải nới chúng đo được chứ không đoán.
 *
 * Bài `Ruling F5` hỏng **3 / 64** lần chạy bộ đầy đủ ở `--maxWorkers=24`
 * (24 worker vitest trên 8 lõi — hình dạng của một CI bị oversubscribe) ở
 * vòng trước, và chưa ai chẩn đoán nó. Nó KHÔNG cùng loại với hai bài
 * `normalize.test.ts`/`anchor.test.ts` được sửa cùng vòng: ở đây không có
 * `performance.now()` nào, không có khẳng định nào về chi phí, và không có
 * cuộc đua commit kiểu P2-F15. Đồng hồ duy nhất trong bài là **trần
 * `asyncUtilTimeout` mặc định 1000 ms của testing-library**, và việc thật
 * mà nó bao không vừa cái trần đó khi máy bị ép.
 *
 * Đo trực tiếp — probe quanh từng chặng của thân bài F5, 16 lần chạy bộ
 * đầy đủ ở `--maxWorkers=24`, so với cùng probe lúc máy nhàn (số thô,
 * không làm tròn):
 *
 *   chặng                                  máy nhàn    24 worker / 8 lõi
 *   ---------------------------------------------------------------------
 *   render(<Dashboard/>)                     28,5 ms     79,3 –  900,2 ms
 *   findByText('Khóa học demo')              32,0 ms    100,8 – 1026,5 ms
 *   waitFor(vòng hoàn thành 2/4)              2,7 ms      2,7 –  247,4 ms
 *   ---------------------------------------------------------------------
 *   cả thân test                             63,3 ms    293,0 – 1859,8 ms
 *
 * `findByText` **1 lần trong 16 vượt 1000 ms** (1026,5 ms) — đó chính là
 * lần hỏng, đúng tần suất bậc 3/64 đã ghi. Chuỗi nó chờ là việc thật, không
 * phải một tín hiệu bị lỡ: `liveQuery` của Dexie trên fake-indexeddb phải
 * phát ra danh sách courseId, rồi thẻ mới mount và mới đi hỏi manifest qua
 * msw. Cả hai chặng đó phồng ~32× khi 24 worker giành 8 lõi.
 *
 * Vì sao nới trần này KHÔNG phải làm yếu: `findByText`/`waitFor` là
 * MutationObserver, chúng trả lời ngay khi DOM đổi; con số dưới đây chỉ là
 * lúc chúng bỏ cuộc. Một trang chủ thật sự hỏng — thẻ "Học tiếp" không bao
 * giờ render, số chương không bao giờ ra 2/4 — vẫn đỏ với **đúng cùng một
 * thông báo và đúng cùng một khẳng định**, chỉ muộn hơn. Cái duy nhất bị nới
 * là thời gian chờ, và ở đây không có khẳng định nào về thời gian.
 *
 * 15 s là 14,6× lần chờ tệ nhất từng đo được; 30 s cho mỗi `it` là 16,1×
 * thân test tệ nhất từng đo được, và phải lớn hơn 15 s ở trên nếu không
 * `testTimeout` mặc định (5 s) sẽ cắt ngang trước khi lần chờ kịp bỏ cuộc.
 *
 * Áp cho MỌI bài chứ không riêng bài F5 — cùng lý do ruling P2-F12 đã chốt:
 * các bài chạy SAU nên cache transform và module graph đã nóng, tức chúng an
 * toàn **do thứ tự**, không phải do bản chất. Ai thêm một bài mới lên đầu
 * file, hoặc đổi thứ tự, là bài đó thành bài trả tiền.
 */
const OVERSUBSCRIBED_WAIT_MS = 15_000;
const OVERSUBSCRIBED_MS = 30_000;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const defaultAsyncUtilTimeout = getConfig().asyncUtilTimeout;
beforeAll(() => configure({ asyncUtilTimeout: OVERSUBSCRIBED_WAIT_MS }));
afterAll(() => configure({ asyncUtilTimeout: defaultAsyncUtilTimeout }));

async function clearAll() {
  await clearLocalData();
}

/**
 * One entry of `GET /courses`'s response — apps/api/internal/course/
 * handler.go's `courseSummary`. Written out here rather than imported so
 * the wire contract has to be restated on this side: a change to the
 * backend's JSON shape should break a test, not silently produce a home
 * screen with nothing to continue.
 */
function catalogEntry(id: string, title: string) {
  return { id, title, lang: 'vi', tier: 'content', versions: ['1.0.0'], pinned: '1.0.0' };
}

/** Một hàng progress cục bộ — nguồn DUY NHẤT của "chương nào đã đọc" (ruling F5). */
async function markRead(courseId: string, chapterId: string, updatedAt = new Date().toISOString()) {
  await db.progress.put({ courseId, chapterId, status: 'read', done: true, updatedAt });
}

function note(overrides: Partial<AnnotationRow> & Pick<AnnotationRow, 'id'>): AnnotationRow {
  return {
    courseId: 'demo',
    chapterId: 'ch-1',
    anchor: { exact: 'một đoạn được bôi đen', color: 'y' },
    note: 'ghi chú',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  server.use(http.get('/courses/so-dau-phay-dong/manifest.json', () => HttpResponse.json(catalogManifest())));
  // The default catalog. Tests that care about the catalog itself
  // override this; the rest get a learner who holds one course.
  server.use(http.get('/courses', () => HttpResponse.json([catalogEntry('so-dau-phay-dong', 'Số dấu phẩy động')])));
});
beforeEach(clearAll);
afterEach(clearAll);

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

function currentPath(): string | null {
  return document.querySelector('[data-testid="path"]')?.textContent ?? null;
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(meQueryKey, { id: 'u1', email: 'hoc@vien.vn', name: 'Người học' });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider><MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<><Dashboard /><LocationProbe /></>} />
          <Route path="/login" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter></LanguageProvider>
    </QueryClientProvider>,
  );
}

/** Nút/liên kết hành động chính của thẻ "Học tiếp". */
function cta(): HTMLElement {
  return screen.getByRole('link', { name: /đọc tiếp|bắt đầu đọc|đọc lại/i });
}

describe('Học tiếp — MỘT hành động', () => {
  it('mở đúng chương đang dở, và biết được điều đó KHÔNG cần mạng (ruling F5)', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(4))));
    // Ngoại tuyến: cả hai lời gọi mạng đều không bao giờ trả lời. Một trang chủ
    // học "mình có khoá nào" CHỈ từ máy chủ sẽ không có gì để mời đọc tiếp —
    // ruling F5 tồn tại đúng để chuyện ấy không xảy ra.
    server.use(http.get('/stats', () => new Promise(() => {})));
    server.use(http.get('/courses', () => new Promise(() => {})));
    await markRead('demo', 'ch-1');
    await markRead('demo', 'ch-2');

    renderDashboard();

    expect(await screen.findByText('Khóa học demo')).toBeInTheDocument();
    // Chương 3 — chương ĐẦU TIÊN chưa đọc, không phải chương sau chương vừa đọc.
    expect(await screen.findByText('Chương 3')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/2\s*\/\s*4/)).toBeInTheDocument());
    expect(cta()).toHaveAttribute('href', '/c/demo/ch-3');
  }, OVERSUBSCRIBED_MS);

  it('MỘT thẻ, không phải một thẻ cho mỗi khoá — và thẻ ấy là khoá vừa đọc gần nhất', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(4))));
    server.use(http.get('/courses/so-dau-phay-dong/manifest.json', () => HttpResponse.json(catalogManifest())));
    server.use(
      http.get('/stats', () =>
        HttpResponse.json({
          totalMinutes: 90,
          streakDays: 3,
          days: [],
          courses: [{ courseId: 'demo', minutes: 60, chaptersDone: 1 }],
        }),
      ),
    );
    // Hai khoá, hai mốc thời gian. `so-dau-phay-dong` cũ hơn ba ngày.
    await markRead('so-dau-phay-dong', 'p0-1', '2026-08-17T09:00:00Z');
    await markRead('demo', 'ch-1', '2026-08-20T09:00:00Z');

    renderDashboard();

    expect(await screen.findByText('Khóa học demo')).toBeInTheDocument();
    expect(cta()).toHaveAttribute('href', '/c/demo/ch-2');
    // Khoá kia KHÔNG có mặt: trang này không còn là danh sách khoá học. Chỗ đó
    // là `/courses`, và `test/globalNav.test.tsx` canh đường tới nó.
    expect(screen.queryByText('Số dấu phẩy động')).not.toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('đọc hết khoá là một TRẠNG THÁI, không phải ngõ cụt — nút mở lại chương cuối', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(2))));
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));
    await markRead('demo', 'ch-1');
    await markRead('demo', 'ch-2');

    renderDashboard();

    expect(await screen.findByText('Khóa học demo')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/2\s*\/\s*2/)).toBeInTheDocument());
    expect(screen.getByText(/đã đọc hết khoá này/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /đọc lại/i });
    expect(link).toHaveAttribute('href', '/c/demo/ch-2');
  }, OVERSUBSCRIBED_MS);

  it('chưa đọc chương nào thì lời mời là "bắt đầu", và nó trỏ vào chương đầu', async () => {
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));

    renderDashboard();

    expect(await screen.findByText('Số dấu phẩy động')).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /bắt đầu đọc/i });
    expect(link).toHaveAttribute('href', '/c/so-dau-phay-dong/p0-1');
  }, OVERSUBSCRIBED_MS);

  it('một manifest hỏng vẫn cho ra một lối đi, không phải một câu lỗi cụt', async () => {
    // 404 trên manifest: gói không mở được. Câu giải thích là cần, nhưng một
    // câu giải thích không kèm lối đi tiếp thì vẫn là ngõ cụt.
    server.use(http.get('/courses/demo/manifest.json', () => new HttpResponse(null, { status: 404 })));
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));
    await markRead('demo', 'ch-1');

    renderDashboard();

    expect(await screen.findByText(/không tìm thấy/i)).toBeInTheDocument();
    const out = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/courses');
    expect(out.length, 'thẻ lỗi không có đường nào đi tiếp').toBeGreaterThanOrEqual(1);
  }, OVERSUBSCRIBED_MS);

  it('KHÔNG còn một con số học tập nào ở trang chủ — chúng đã sang /progress', async () => {
    // Bài chống-đi-ngược. Trang này từng mở đầu bằng `streakDays` và
    // `totalMinutes` cỡ lớn; với một tài khoản mới đó là HAI SỐ 0 to đùng, và
    // đó là màn hình đầu tiên của cả sản phẩm. Con số nào quay lại đây sẽ đỏ.
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(4))));
    server.use(
      http.get('/stats', () =>
        HttpResponse.json({
          totalMinutes: 372,
          streakDays: 5,
          days: Array.from({ length: 30 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, minutes: 45 })),
          courses: [{ courseId: 'demo', minutes: 120, chaptersDone: 3 }],
        }),
      ),
    );
    await markRead('demo', 'ch-1');

    renderDashboard();

    // Đối chứng dương trước: trang đã dựng xong và ĐÃ ĐỌC `/stats` (nó là một
    // trong bốn nguồn của `useOwnedCourses`), nên "không thấy con số" dưới đây
    // không phải vì trang còn trống.
    expect(await screen.findByText('Khóa học demo')).toBeInTheDocument();

    expect(screen.queryByText('372')).not.toBeInTheDocument();
    expect(screen.queryByText('120')).not.toBeInTheDocument();
    expect(screen.queryByText(/ngày liên tục/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/phút đã học/i)).not.toBeInTheDocument();
    expect(document.querySelector('.dash-chart'), 'biểu đồ 30 cột vẫn còn trên trang chủ').toBeNull();
    expect(document.querySelectorAll('.dash-bar')).toHaveLength(0);
  }, OVERSUBSCRIBED_MS);
});

describe('Học tiếp — ghi chú gần đây', () => {
  it('liệt kê ghi chú mới nhất trước, mỗi ghi chú mở đúng chương của nó', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(4))));
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));
    await markRead('demo', 'ch-1');
    await db.annotations.put(
      note({ id: 'a-cu', chapterId: 'ch-1', note: 'ghi chú cũ', updatedAt: '2026-08-10T08:00:00Z' }),
    );
    await db.annotations.put(
      note({ id: 'a-moi', chapterId: 'ch-3', note: 'ghi chú mới', updatedAt: '2026-08-21T08:00:00Z' }),
    );

    renderDashboard();

    const list = await screen.findByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('ghi chú mới');
    expect(rows[1]).toHaveTextContent('ghi chú cũ');
    // Đường về đúng chương, không phải về trang khoá học.
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/c/demo/ch-3');
    // Đoạn được bôi đen đi kèm: một ghi chú không có ngữ cảnh thì phải mở
    // chương ra mới hiểu được, tức là nó không giúp gì ở đây.
    expect(rows[0]).toHaveTextContent('một đoạn được bôi đen');
  }, OVERSUBSCRIBED_MS);

  it('ghi chú đã xoá là BIA MỘ, không phải một hàng để hiển thị', async () => {
    // `deletedAt` khác null vẫn nằm trong bảng để lan sang thiết bị khác
    // (`db/local.ts`'s `AnnotationRow`). Vẽ nó ra là dựng lại thứ người dùng
    // vừa xoá, trên chính màn hình đầu tiên họ nhìn thấy.
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(4))));
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));
    await markRead('demo', 'ch-1');
    await db.annotations.put(note({ id: 'a-song', note: 'còn sống', updatedAt: '2026-08-10T08:00:00Z' }));
    await db.annotations.put(
      note({ id: 'a-xoa', note: 'đã xoá rồi', updatedAt: '2026-08-21T08:00:00Z', deletedAt: '2026-08-21T09:00:00Z' }),
    );

    renderDashboard();

    expect(await screen.findByText('còn sống')).toBeInTheDocument();
    expect(screen.queryByText('đã xoá rồi')).not.toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('chưa có ghi chú nào thì nói ra CÁCH tạo ghi chú, không chỉ nói là trống', async () => {
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));

    renderDashboard();

    expect(await screen.findByText(/bôi đen một đoạn khi đọc/i)).toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);
});

describe('Học tiếp — trạng thái rỗng và tài khoản', () => {
  it('says the library is empty rather than rendering a blank area when GET /courses returns nothing', async () => {
    server.use(http.get('/courses', () => HttpResponse.json([])));
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));

    renderDashboard();

    expect(await screen.findByText(/chưa có khóa học nào/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.home-card')).toHaveLength(0);
  }, OVERSUBSCRIBED_MS);

  it('có lối vào /import trong lời nhắn thư viện rỗng — cửa ngữ cảnh, hiện đúng lúc cần', async () => {
    // Cửa NGỮ CẢNH: liên kết nằm trong chính lời nhắn "thư viện của bạn đang
    // trống", nên nó xuất hiện đúng lúc người đọc cần. Bài này ra đời sau khi
    // mutation testing xoá cả hai liên kết `/import` mà 632 test vẫn xanh —
    // một route không ai bấm tới được là một tính năng không tồn tại.
    server.use(http.get('/courses', () => HttpResponse.json([])));
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));

    renderDashboard();

    await screen.findByText(/chưa có khóa học nào/i);
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/import');
    expect(links.length, 'lời nhắn thư viện rỗng không còn liên kết tới /import').toBeGreaterThanOrEqual(1);
    expect(links.map((a) => a.textContent).join(' ')).toMatch(/nhập/i);
  }, OVERSUBSCRIBED_MS);

  it('trạng thái rỗng của trang chủ là MÀN HÌNH ĐẦU TIÊN của người dùng mới — phải nói ba cách nhập, không chỉ một dòng chữ (ruling S1-F17)', async () => {
    // Task 6 deleted `KNOWN_COURSE_IDS`, so this is literally what a brand
    // new account opens onto — và đặc tả IA nhắc lại nó thành ràng buộc thứ 5:
    // "Trang chủ khi chưa có khoá học nào vẫn phải thành hành động, không phải
    // ngõ cụt." Câu chữ nằm ở `<EmptyLibrary>`, dùng chung với `/courses`, vì
    // hai bản sao của một cánh cửa thì bản không ai đi qua sẽ trôi.
    server.use(http.get('/courses', () => HttpResponse.json([])));
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));

    renderDashboard();

    await screen.findByText(/chưa có khóa học nào/i);
    expect(screen.getAllByText(/\.zip/).length).toBeGreaterThan(0);
    expect(screen.getByText(/github/i)).toBeInTheDocument();
    // The registry's place is held by words, not by a link that goes
    // nowhere: subsystem 3 has not built it.
    const registryNote = screen.getByText(/registry|kho khóa học cộng đồng/i);
    expect(within(registryNote).queryByRole('link')).not.toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('does not flash the empty-library note while GET /courses is still in flight', async () => {
    server.use(http.get('/courses', () => new Promise(() => {}))); // never resolves
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));

    renderDashboard();

    // Nhan đề chứng minh trang đã dựng; lời nhắn kia chưa được phép có mặt, vì
    // "không khoá nào trả về" vẫn chưa đúng.
    expect(await screen.findByRole('heading', { name: /học tiếp/i })).toBeInTheDocument();
    expect(screen.queryByText(/chưa có khóa học nào/i)).not.toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('shows the signed-in user\'s name and a working logout control that stops sync, clears local data, and returns to /login', async () => {
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));
    await markRead('demo', 'ch-1');
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(2))));

    const stopSyncSpy = vi.spyOn(engine, 'stopSync');
    vi.spyOn(engine, 'syncOnce').mockResolvedValue(undefined);
    server.use(http.post('/auth/logout', () => new HttpResponse(null, { status: 200 })));

    renderDashboard();

    expect(await screen.findByText(/Người học/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /đăng xuất/i }));

    await waitFor(() => expect(currentPath()).toBe('/login'));
    expect(stopSyncSpy).toHaveBeenCalled();
    expect(await db.progress.count()).toBe(0);

    vi.restoreAllMocks();
  }, OVERSUBSCRIBED_MS);
});

describe('Học tiếp khi /stats trả thứ không phải JSON (hồi quy trang trắng)', () => {
  // Đo 2026-08-22 trên bản dựng production, API không chạy: máy chủ SPA trả
  // `200 text/html` cho `/stats`. `parseBody` lùi về trả VĂN BẢN, `request<Stats>`
  // trao chuỗi ấy dưới danh nghĩa `Stats`, `data?.courses` KHÔNG ngắn mạch vì
  // chuỗi khác rỗng là truthy, `.courses` là undefined, `.map` ném khi render,
  // và không có error boundary nên cả cây unmount:
  //     document.body.innerHTML === '<div id="root"></div>'
  // Trang trắng, không một chữ. Mọi cổng đơn vị vẫn xanh suốt thời gian đó.
  const SPA_HTML = '<!doctype html>\n<html lang="vi"><body></body></html>';

  it('vẫn vẽ ra chữ đọc được, không trắng trang', async () => {
    server.use(http.get('/stats', () => HttpResponse.html(SPA_HTML)));
    renderDashboard();
    // Khẳng định thứ người dùng thật sự thấy. Trang trắng đo được là chuỗi rỗng.
    await waitFor(() => {
      expect(document.body.textContent?.trim()).not.toBe('');
    });
    expect(await screen.findByRole('heading', { name: /học tiếp/i })).toBeInTheDocument();
  });

  it('/courses cũng trả HTML thì vẫn không sập — hai nguồn cùng hỏng là ca thật khi API chết', async () => {
    server.use(http.get('/stats', () => HttpResponse.html(SPA_HTML)));
    server.use(http.get('/courses', () => HttpResponse.html(SPA_HTML)));
    renderDashboard();
    expect(await screen.findByRole('heading', { name: /học tiếp/i })).toBeInTheDocument();
  });

  it('ĐỐI CHỨNG: /stats trả JSON thiếu hẳn trường courses', async () => {
    // Không phải giả định — đây là hình dạng mà kiểu `Stats` hứa là không thể
    // (`courses: CourseStat[]` bắt buộc) nhưng dây mạng vẫn giao được.
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0 })));
    renderDashboard();
    expect(await screen.findByRole('heading', { name: /học tiếp/i })).toBeInTheDocument();
  });
});
