import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, getConfig, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { meQueryKey } from '../api/useMe';
import { clearLocalData, db } from '../db/local';
import * as engine from '../sync/engine';
import { Dashboard } from '../pages/Dashboard';
import type { Manifest } from '../course/types';
import { LanguageProvider } from '../i18n/LanguageProvider';

function catalogManifest(): Manifest {
  // The manifest of the course the default `GET /courses` stub below puts
  // in the learner's catalog — every test stubs its manifest endpoint so a
  // stray real network call never happens even for tests that don't care
  // about this course.
  //
  // This used to be the app's own hardcoded known-course fallback
  // (`Dashboard.tsx`'s `KNOWN_COURSE_IDS`), which existed only because
  // `GET /courses` had not been built. It has been; the constant is gone,
  // and the course reaches the Dashboard the same way every other course
  // does now — because the catalog endpoint named it.
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
 * phát ra danh sách courseId, rồi `CourseCard` mới mount và mới đi hỏi
 * manifest qua msw. Cả hai chặng đó phồng ~32× khi 24 worker giành 8 lõi.
 *
 * Khẳng định nào đỏ, kiểm được TẤT ĐỊNH theo cả hai chiều thay vì ngồi đợi
 * xác suất: đặt hằng số dưới đây bằng `1` thì bài F5 đỏ 100%, nguyên văn
 *     TestingLibraryElementError: Unable to find an element with the text:
 *     Khóa học demo.
 * ở đúng dòng `findByText` — không phải `waitFor` của vòng 2/4, không phải
 * `testTimeout` của vitest. Đặt lại 15_000 thì xanh.
 *
 * Vì sao nới trần này KHÔNG phải làm yếu: `findByText`/`waitFor` là
 * MutationObserver, chúng trả lời ngay khi DOM đổi; con số dưới đây chỉ là
 * lúc chúng bỏ cuộc. Một Dashboard thật sự hỏng — thẻ khoá học không bao
 * giờ render, vòng hoàn thành không bao giờ ra 2/4 — vẫn đỏ với **đúng
 * cùng một thông báo và đúng cùng một khẳng định**, chỉ muộn hơn. Cái duy
 * nhất bị nới là thời gian chờ, và ở đây không có khẳng định nào về thời
 * gian.
 *
 * 15 s là 14,6× lần chờ tệ nhất từng đo được; 30 s cho mỗi `it` là 16,1×
 * thân test tệ nhất từng đo được, và phải lớn hơn 15 s ở trên nếu không
 * `testTimeout` mặc định (5 s) sẽ cắt ngang trước khi lần chờ kịp bỏ cuộc.
 *
 * Áp cho CẢ SÁU bài chứ không riêng bài F5 — cùng lý do ruling P2-F12 đã
 * chốt: năm bài kia chạy SAU nên cache transform và module graph đã nóng,
 * tức chúng an toàn **do thứ tự**, không phải do bản chất. Ai thêm một bài
 * mới lên đầu file, hoặc đổi thứ tự, là bài đó thành bài trả tiền.
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
 * backend's JSON shape should break a test, not silently produce a
 * Dashboard with no cards.
 */
function catalogEntry(id: string, title: string) {
  return { id, title, lang: 'vi', tier: 'content', versions: ['1.0.0'], pinned: '1.0.0' };
}

beforeEach(() => {
  server.use(http.get('/courses/so-dau-phay-dong/manifest.json', () => HttpResponse.json(catalogManifest())));
  // The default catalog. Tests that care about the catalog itself
  // override this; the rest get a learner who holds one course, which is
  // the same starting state every test in this file had back when the
  // Dashboard hardcoded that id.
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

describe('Dashboard', () => {
  it('renders a card for a course known ONLY from local progress (Ruling F5 — offline-first, even when /stats and /courses never resolve)', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(4))));
    server.use(http.get('/stats', () => new Promise(() => {}))); // never resolves — simulate offline
    // The catalog is a network call too, so "offline" has to mean it is
    // unreachable as well. A Dashboard that learned which courses exist
    // ONLY from the server would show nothing here — Ruling F5 is exactly
    // about that not happening.
    server.use(http.get('/courses', () => new Promise(() => {})));
    await db.progress.put({ courseId: 'demo', chapterId: 'ch-1', status: 'read', done: true, updatedAt: new Date().toISOString() });
    await db.progress.put({ courseId: 'demo', chapterId: 'ch-2', status: 'read', done: true, updatedAt: new Date().toISOString() });

    renderDashboard();

    expect(await screen.findByText('Khóa học demo')).toBeInTheDocument();
    // 2 of 4 chapters done, computed from LOCAL progress, not the (never
    // resolving) /stats call — Ruling F5.
    await waitFor(() => expect(screen.getByText(/2\s*\/\s*4/)).toBeInTheDocument());
  }, OVERSUBSCRIBED_MS);

  it('shows the ring/course card correctly even when GET /stats and GET /courses 500 — must not blank the whole panel', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(2))));
    server.use(http.get('/stats', () => new HttpResponse(null, { status: 500 })));
    server.use(http.get('/courses', () => new HttpResponse(null, { status: 500 })));
    await db.progress.put({ courseId: 'demo', chapterId: 'ch-1', status: 'read', done: true, updatedAt: new Date().toISOString() });

    renderDashboard();

    expect(await screen.findByText('Khóa học demo')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument());
    // A visible, non-crashing explanation instead of a blank stats panel.
    expect(await screen.findByText(/không tải được|ngoại tuyến|offline/i)).toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('shows streak, total minutes and a 30-day bar for each day once GET /stats succeeds', async () => {
    const days = Array.from({ length: 30 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, minutes: i === 29 ? 45 : 0 }));
    server.use(
      http.get('/stats', () =>
        HttpResponse.json({
          totalMinutes: 372,
          streakDays: 5,
          days,
          courses: [{ courseId: 'demo', minutes: 120, chaptersDone: 3 }],
        }),
      ),
    );
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(4))));
    await db.progress.put({ courseId: 'demo', chapterId: 'ch-1', status: 'read', done: true, updatedAt: new Date().toISOString() });

    renderDashboard();

    expect(await screen.findByText('5')).toBeInTheDocument(); // streak
    expect(await screen.findByText('372')).toBeInTheDocument(); // total minutes

    const chart = document.querySelector('.dash-chart')!;
    expect(chart.querySelectorAll('.dash-bar')).toHaveLength(30);
  }, OVERSUBSCRIBED_MS);

  it('derives the course card set from stats.courses[] too, not only local progress or the known-course fallback', async () => {
    server.use(
      http.get('/stats', () =>
        HttpResponse.json({ totalMinutes: 10, streakDays: 1, days: [], courses: [{ courseId: 'demo', minutes: 10, chaptersDone: 0 }] }),
      ),
    );
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(3))));
    // No local progress row for "demo" at all — the card must still appear
    // because /stats named it.

    renderDashboard();

    expect(await screen.findByText('Khóa học demo')).toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('renders a card for every course GET /courses lists, with no local progress and no matching stats.courses entry', async () => {
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));

    renderDashboard();

    expect(await screen.findByText('Số dấu phẩy động')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/0\s*\/\s*1/)).toBeInTheDocument());
  }, OVERSUBSCRIBED_MS);

  it('says the library is empty rather than rendering a blank card area when GET /courses returns nothing', async () => {
    server.use(http.get('/courses', () => HttpResponse.json([])));
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));

    renderDashboard();

    expect(await screen.findByText(/chưa có khóa học nào/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.dash-card')).toHaveLength(0);
  }, OVERSUBSCRIBED_MS);

  it('có lối vào /import — cả nút ở đầu trang lẫn liên kết trong lời nhắn thư viện rỗng', async () => {
    // `/import` (Task 8) has exactly one door in the whole app and it is
    // here. Independent mutation testing removed BOTH of these links and all
    // 632 tests stayed green: a route nobody can reach is a feature nobody
    // has, and this page's own empty state has told readers to "nhập một gói
    // course" since Task 7 without ever saying where.
    server.use(http.get('/courses', () => HttpResponse.json([])));
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));

    renderDashboard();

    await screen.findByText(/chưa có khóa học nào/i);
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/import');
    expect(links.length, 'không còn lối vào /import nào trên Bảng điều khiển').toBeGreaterThanOrEqual(2);
    expect(links.map((a) => a.textContent).join(' ')).toMatch(/nhập/i);
  }, OVERSUBSCRIBED_MS);

  it('có lối vào /library — Task 9 thêm một route, và một route không ai bấm tới được là một tính năng không tồn tại', async () => {
    // Same argument as the /import test directly above, which was written
    // after mutation testing deleted both of THOSE links with the whole
    // suite staying green. `/library` arrives with the identical exposure:
    // one door, on this page.
    server.use(http.get('/courses', () => HttpResponse.json([])));
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));

    renderDashboard();

    await screen.findByText(/chưa có khóa học nào/i);
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/library');
    expect(links.length, 'không còn lối vào /library nào trên Bảng điều khiển').toBeGreaterThanOrEqual(1);
    expect(links.map((a) => a.textContent).join(' ')).toMatch(/thư viện/i);
  }, OVERSUBSCRIBED_MS);

  it('trạng thái rỗng của Bảng điều khiển là MÀN HÌNH ĐẦU TIÊN của người dùng mới — phải nói ba cách nhập, không chỉ một dòng chữ (ruling S1-F17)', async () => {
    // Task 6 deleted `KNOWN_COURSE_IDS`, so this is literally what a brand
    // new account opens onto. Before Task 9 it was one sentence with a link;
    // the sentence stays (the assertion above still passes) but the state now
    // also says WHY the library is empty — §9.5 chose to ship no course,
    // because a seeded one would hide a broken import path — and names the
    // three ways in, including the one that works with no network at all.
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

    // The streak panel proves the page has rendered; the note must not be
    // there yet, because "no courses came back" is not yet true.
    expect(await screen.findByText('ngày liên tục')).toBeInTheDocument();
    expect(screen.queryByText(/chưa có khóa học nào/i)).not.toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('shows the signed-in user\'s name and a working logout control that stops sync, clears local data, and returns to /login', async () => {
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })));
    await db.progress.put({ courseId: 'demo', chapterId: 'ch-1', status: 'read', done: true, updatedAt: new Date().toISOString() });

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

describe('Dashboard khi /stats trả thứ không phải JSON (hồi quy trang trắng)', () => {
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
    expect(await screen.findByText(/bảng điều khiển/i)).toBeInTheDocument();
  });

  it('/courses cũng trả HTML thì vẫn không sập — hai nguồn cùng hỏng là ca thật khi API chết', async () => {
    server.use(http.get('/stats', () => HttpResponse.html(SPA_HTML)));
    server.use(http.get('/courses', () => HttpResponse.html(SPA_HTML)));
    renderDashboard();
    expect(await screen.findByText(/bảng điều khiển/i)).toBeInTheDocument();
  });

  it('ĐỐI CHỨNG: /stats trả JSON thiếu hẳn trường courses', async () => {
    // Không phải giả định — đây là hình dạng mà kiểu `Stats` hứa là không thể
    // (`courses: CourseStat[]` bắt buộc) nhưng dây mạng vẫn giao được.
    server.use(http.get('/stats', () => HttpResponse.json({ totalMinutes: 0 })));
    renderDashboard();
    expect(await screen.findByText(/bảng điều khiển/i)).toBeInTheDocument();
  });
});
