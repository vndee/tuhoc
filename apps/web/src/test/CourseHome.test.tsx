import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CourseHome } from '../pages/CourseHome';
import { Sidebar } from '../shell/Sidebar';
import type { Chapter, Manifest } from '../course/types';
import { clearUserContent } from '../db/localStorage';
import { LanguageProvider } from '../i18n/LanguageProvider';

function buildManifest(chapterCount: number): Manifest {
  const chapters: Chapter[] = Array.from({ length: chapterCount }, (_, i) => ({
    id: `ch-${i + 1}`,
    num: `${i + 1}`,
    title: `Chương thứ ${i + 1}`,
    short: `Chương ${i + 1}`,
    file: `chapters/ch-${i + 1}.html`,
  }));
  const half = Math.ceil(chapterCount / 2);
  return {
    id: 'demo',
    title: 'Khóa học demo',
    description: 'Mô tả khóa học demo',
    lang: 'vi',
    version: '1.0.0',
    runtime: '^1',
    parts: [
      { title: 'Phần A', chapters: chapters.slice(0, half) },
      { title: 'Phần B', chapters: chapters.slice(half) },
    ],
  };
}

const server = setupServer(
  // Task 12: `CourseHome` now calls `useMe()` itself, to decide whether to
  // mount the child that reads local progress. Every test in this file
  // predates that and asserts on progress as a signed-in reader would see
  // it, so a default authenticated `/me` here keeps them describing the same
  // behaviour as before; Task 12's own block overrides it per-test.
  http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'Người học' })),
  // Task 6, Pha 3: `useProgress` (behind `Sidebar`'s `doneChapterIds`) now
  // reads `GET /progress` instead of a local `db.progress` row — see
  // `reader/ChapterView.test.tsx`'s server setup for the same change. No
  // progress by default; the one test that needs a chapter already marked
  // read overrides this with `server.use(...)`.
  http.get('/progress', () => HttpResponse.json({ progress: [] })),
  // Task 5: `CourseHome` now also asks "is this course already mine" via
  // `GET /enrollments`, to decide between "Bắt đầu học" and "Bỏ khỏi khoá của
  // tôi". Default: chưa ghi danh khoá nào — the case every pre-Task-5 test in
  // this file implicitly assumes. The Task 5 tests below override this per
  // case with `server.use(...)`.
  http.get('/enrollments', () => HttpResponse.json({ enrollments: [] })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(async () => {
  clearUserContent();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * DỰNG CẢ `<Sidebar>` LẪN `<CourseHome>`, đúng như route thật.
 *
 * Trước vòng thiết kế lại, `<CourseHome>` tự in trọn mục lục ở giữa màn — cùng
 * lúc thanh bên bên trái in y hệt. Hai bản sao của một danh sách cách nhau ba
 * trăm pixel. Bản dựng đã duyệt bỏ bản ở giữa và giữ bản ở thanh bên, nơi mục
 * lục là nghĩa DUY NHẤT của cột ấy.
 *
 * Năm bài dưới đây canh `CourseNav` — `data-ch`, lớp `done`, `.nav-part`, số
 * liên kết, phạm vi theo courseId. Chúng KHÔNG mất giá trị vì danh sách chỉ
 * đổi chỗ, nên cách sửa đúng là dựng đúng cái route thật dựng, chứ không phải
 * hạ câu hỏi xuống cho vừa một component đã hẹp đi.
 *
 * `<Sidebar>` đọc `useLocation`, nên nó phải nằm TRONG `<MemoryRouter>` chứ
 * không nằm trong `<Routes>` — nó là chrome dựng CẠNH route, đúng như `App.tsx`.
 */
function renderCourseHome(initialPath = '/c/demo') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider><MemoryRouter initialEntries={[initialPath]}>
        <Sidebar />
        <Routes>
          <Route path="/c/:courseId" element={<CourseHome />} />
        </Routes>
      </MemoryRouter></LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('CourseHome', () => {
  it('renders the manifest title and description', async () => {
    server.use(http.get('/courses/demo', () => HttpResponse.json(buildManifest(4))));

    renderCourseHome();

    expect(await screen.findByRole('heading', { name: 'Khóa học demo' })).toBeInTheDocument();
    expect(await screen.findByText('Mô tả khóa học demo')).toBeInTheDocument();
  });

  it('renders one link per chapter across every part — 44 chapters, 44 links', async () => {
    server.use(http.get('/courses/demo', () => HttpResponse.json(buildManifest(44))));

    renderCourseHome();

    // KHOANH VÙNG vào `#nav` — mục lục. Ngoài nó, trang khoá học nay có thêm
    // một liên kết: nút "Đọc tiếp"/"Bắt đầu đọc" trên thẻ ĐANG DỞ. Đếm cả nó
    // là đếm hai loại khác nhau vào một con số.
    await screen.findByRole('heading', { name: 'Khóa học demo' });
    const nav = document.getElementById('nav')!;
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(44);
  });

  it('every chapter link carries data-ch=<chapterId> and links to /c/:courseId/:chapterId', async () => {
    server.use(http.get('/courses/demo', () => HttpResponse.json(buildManifest(3))));

    renderCourseHome();

    // Cùng lý do bài trên: khoanh vùng vào mục lục, vì nút "Bắt đầu đọc" cũng
    // là một liên kết và nó cố ý KHÔNG mang `data-ch`.
    await screen.findByRole('heading', { name: 'Khóa học demo' });
    const links = within(document.getElementById('nav')!).getAllByRole('link');
    expect(links).toHaveLength(3);
    for (const [i, link] of links.entries()) {
      const id = `ch-${i + 1}`;
      expect(link).toHaveAttribute('data-ch', id);
      expect(link).toHaveAttribute('href', `/c/demo/${id}`);
      expect(link.className).toContain('nav-item');
    }
  });

  it('marks chapters read in LOCAL progress (Ruling F4 / debt #1 — real data, not a prop) with the "done" class', async () => {
    server.use(
      http.get('/courses/demo', () => HttpResponse.json(buildManifest(3))),
      // Task 6, Pha 3: "already read" now comes from the server, not a
      // pre-seeded Dexie row.
      http.get('/progress', () =>
        HttpResponse.json({
          progress: [{ courseId: 'demo', chapterId: 'ch-2', status: 'read', done: true, updatedAt: new Date().toISOString() }],
        }),
      ),
    );

    renderCourseHome();

    const links = await screen.findAllByRole('link');
    await waitFor(() => {
      expect(links.find((a) => a.getAttribute('data-ch') === 'ch-2')?.className).toContain('done');
    });
    expect(links.find((a) => a.getAttribute('data-ch') === 'ch-1')?.className).not.toContain('done');
    expect(links.find((a) => a.getAttribute('data-ch') === 'ch-3')?.className).not.toContain('done');
  });

  it('does NOT mark a chapter done from a DIFFERENT course\'s progress row (courseId scoping)', async () => {
    server.use(
      http.get('/courses/demo', () => HttpResponse.json(buildManifest(3))),
      http.get('/progress', () =>
        HttpResponse.json({
          progress: [{ courseId: 'other-course', chapterId: 'ch-2', status: 'read', done: true, updatedAt: new Date().toISOString() }],
        }),
      ),
    );

    renderCourseHome();

    const links = await screen.findAllByRole('link');
    expect(links.find((a) => a.getAttribute('data-ch') === 'ch-2')?.className).not.toContain('done');
  });

  it('renders every part title as a .nav-part heading', async () => {
    server.use(http.get('/courses/demo', () => HttpResponse.json(buildManifest(4))));

    renderCourseHome();

    await screen.findAllByRole('link');
    const partHeadings = document.querySelectorAll('.nav-part');
    expect(Array.from(partHeadings).map((el) => el.textContent)).toEqual(['Phần A', 'Phần B']);
  });

  it('shows a non-crashing message instead of chapters when the manifest 404s', async () => {
    server.use(http.get('/courses/demo', () => new HttpResponse(null, { status: 404 })));

    renderCourseHome();

    // `findAllByText`: câu lỗi xuất hiện ở HAI chỗ, và cả hai đều đúng chỗ của
    // nó — thanh bên nói vì sao cột mục lục trống, trang nói vì sao thân trang
    // trống. Một cột im lặng khi tải hỏng thì không phân biệt được với "đang
    // tải mãi mãi"; `Sidebar` đã ghi lại đúng lập luận ấy.
    expect((await screen.findAllByText(/không tải được|not found|lỗi/i)).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  // "shows a non-crashing message when the manifest is a runtime the app does
  // not support" ĐÃ XOÁ Ở ĐÂY. Nó gửi `manifest.runtime: '^2'` và đòi một câu
  // lỗi, đúng hành vi khi client còn tự kiểm `RuntimeMismatchError`. Lớp đó
  // không còn tồn tại: cú xoay trục server-side (spec
  // `2026-08-25-server-side-pivot.md` §2.4, đã merge ở Task 9-10) làm máy chủ
  // thành nguồn được tin — `course/loader.ts` không còn kiểm `manifest.runtime`
  // ở phía client nữa (`grep -rn "RuntimeMismatchError" apps/web/src` không
  // còn khớp gì ngoài chú thích lịch sử). Bài này bị bỏ sót khỏi sổ xoá của cả
  // Task 9-12 lẫn Task 13 — không do task nào cụ thể xoá nó khi lớp kia mất —
  // và gỡ ở đây, không sửa: không có gì để "sửa lại cho đúng", vì hành vi nó
  // đòi (từ chối một manifest báo `runtime` khác) không còn là một quyết định
  // của client nữa.
});

/**
 * Task 12 — `/c/:courseId` is public now (spec §2.4), but the progress it
 * shows (the "Bắt đầu"/"Đọc tiếp" resume card, each part's read count) is
 * server-recorded, per-account state.
 *
 * The "chưa đăng nhập" test below used to also seed a Dexie `db.progress`
 * row and prove it was NOT read back for an anonymous visitor — Task 10
 * removed Dexie, and with it every local progress row of any kind, so
 * there is no longer a local row for this app to mis-attribute. What
 * remains, and is what this test still proves: an anonymous visitor's
 * resume card renders as if nothing were ever read, because the anonymous
 * branch never even asks the server for progress.
 */
describe('Task 12 — tiến độ chỉ hiện khi có phiên', () => {
  it('người đọc CHƯA đăng nhập: trang hiện như chưa từng đọc gì', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    server.use(http.get('/courses/demo', () => HttpResponse.json(buildManifest(4))));

    renderCourseHome();
    await screen.findByRole('heading', { name: 'Khóa học demo' });

    // As if nothing were ever marked read: the eyebrow reads "Bắt đầu đọc",
    // not "Đang đọc", and every part shows `data-state="none"`.
    //
    // A short grace period, not an immediate read: this is the one place a
    // WRONG implementation (calling `useProgress` unconditionally, the way
    // `ChapterView` used to) would still pass on the very first tick, before
    // its `liveQuery` subscription has resolved — the same race the "marks
    // chapters read" test above deliberately waits out in the other
    // direction. Here there is nothing to wait FOR (the anonymous branch
    // never subscribes at all), so waiting proves the state never arrives
    // rather than merely hasn't yet.
    await new Promise((resolve) => setTimeout(resolve, 30));

    // `.ch-resume-verb`, không còn `.ch-resume-eyebrow`: từ 03/09/2026 nhãn
    // này là RUN-IN bên trong chính đầu mục thay vì một dòng đứng trên nó —
    // sàn craft của thế giới viết tay cấm eyebrow. Chữ nó nói không đổi, và
    // đó mới là thứ bài này canh.
    expect(document.querySelector('.ch-resume-verb')?.textContent).toBe('Bắt đầu đọc');
    const counts = Array.from(document.querySelectorAll('.ch-part-count'));
    expect(counts.length).toBe(2);
    for (const el of counts) {
      expect(el.getAttribute('data-state')).toBe('none');
    }
  });

  it('người đọc ĐÃ đăng nhập: cùng dòng tiến độ ấy hiện đúng trên trang', async () => {
    server.use(
      http.get('/courses/demo', () => HttpResponse.json(buildManifest(4))),
      http.get('/progress', () =>
        HttpResponse.json({
          progress: [{ courseId: 'demo', chapterId: 'ch-1', status: 'read', done: true, updatedAt: new Date().toISOString() }],
        }),
      ),
    );

    renderCourseHome();
    await screen.findByRole('heading', { name: 'Khóa học demo' });

    await waitFor(() => expect(document.querySelector('.ch-resume-verb')?.textContent).toBe('Đang đọc'));
    const counts = Array.from(document.querySelectorAll('.ch-part-count'));
    expect(counts[0]?.getAttribute('data-state')).toBe('partial'); // Phần A: 1/2 (ch-1)
    expect(counts[1]?.getAttribute('data-state')).toBe('none'); // Phần B: 0/2
  });
});

/**
 * Task 5 — trước task này KHÔNG có nơi nào trong app gọi `createEnrollment`
 * ngoài chính test của nó (Task 2); nghĩa là "Học tiếp" của MỌI tài khoản
 * trống vĩnh viễn. `/c/:courseId` là nơi hành động ấy xuất hiện.
 *
 * Cả ba bài canh trên REQUEST thật app gửi ra (method + path/param + body),
 * không chỉ trên chuyện nút có mặt hay bấm được — một cú `mutationFn` gọi sai
 * hàm, sai `courseId`, hoặc quên `await` vẫn có thể để nút "trông đúng" mà
 * không gửi gì cả.
 */
describe('Task 5 — ghi danh và bỏ ghi danh ngay tại trang khoá', () => {
  it('chưa ghi danh: hiện "Bắt đầu học"; bấm gửi đúng POST /enrollments {courseId}, rồi chuyển sang lối bỏ ghi danh', async () => {
    server.use(http.get('/courses/demo', () => HttpResponse.json(buildManifest(4))));

    const posted: unknown[] = [];
    let enrolled = false;
    server.use(
      http.get('/enrollments', () =>
        HttpResponse.json({ enrollments: enrolled ? [{ courseId: 'demo', createdAt: '2026-01-01T00:00:00Z' }] : [] }),
      ),
      http.post('/enrollments', async ({ request }) => {
        posted.push(await request.json());
        enrolled = true;
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderCourseHome();

    const btn = await screen.findByRole('button', { name: 'Bắt đầu học' });
    await user.click(btn);

    // REQUEST thật, không phải chỉ "nút đã bấm được": đúng method (POST, qua
    // `http.post`), đúng thân ({courseId: 'demo'} — của khoá đang mở, không
    // phải một chuỗi rỗng hay `undefined` lọt qua enabled-guard).
    await waitFor(() => expect(posted).toEqual([{ courseId: 'demo' }]));
    // `invalidateQueries` phải thật sự khiến trang đọc lại — nút đổi thành lối
    // bỏ ghi danh, không kẹt ở trạng thái cũ.
    expect(await screen.findByRole('button', { name: 'Bỏ khỏi khoá của tôi' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bắt đầu học' })).not.toBeInTheDocument();
  });

  it('đã ghi danh: hiện lối "Bỏ khỏi khoá của tôi"; bấm gửi đúng DELETE /enrollments/demo, rồi quay lại "Bắt đầu học"', async () => {
    let enrolled = true;
    server.use(
      http.get('/courses/demo', () => HttpResponse.json(buildManifest(4))),
      http.get('/enrollments', () =>
        HttpResponse.json({ enrollments: enrolled ? [{ courseId: 'demo', createdAt: '2026-01-01T00:00:00Z' }] : [] }),
      ),
    );

    let deletedCourseId: string | undefined;
    server.use(
      http.delete('/enrollments/:courseId', ({ params }) => {
        deletedCourseId = String(params.courseId);
        enrolled = false;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    renderCourseHome();

    const btn = await screen.findByRole('button', { name: 'Bỏ khỏi khoá của tôi' });
    // KHÔNG hộp xác nhận nào đứng giữa cú bấm và request: một cú click duy
    // nhất phải đủ để gửi DELETE.
    await user.click(btn);

    await waitFor(() => expect(deletedCourseId).toBe('demo'));
    expect(await screen.findByRole('button', { name: 'Bắt đầu học' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bỏ khỏi khoá của tôi' })).not.toBeInTheDocument();
  });

  it('người đọc CHƯA đăng nhập: không gọi /enrollments, không thấy nút ghi danh hay bỏ ghi danh nào (tránh bị hất sang /login)', async () => {
    let enrollmentsCallCount = 0;
    server.use(
      http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })),
      http.get('/courses/demo', () => HttpResponse.json(buildManifest(4))),
      // Đếm lời gọi thay vì chỉ nhìn nút: nếu component lỡ bật query này cho
      // khách ẩn danh (chỉ khoá theo `courseId`, quên khoá theo
      // `confirmedLoggedIn`), `api.get`'s `redirectOn401` mặc định sẽ ném
      // sang /login — thứ mất đi chính là ý định đang đọc trang này. Đếm số
      // lần gọi bắt được cả trường hợp ấy lẫn trường hợp trùng hợp nút vẫn
      // ẩn dù request đã bay ra.
      http.get('/enrollments', () => {
        enrollmentsCallCount += 1;
        return HttpResponse.json({ enrollments: [] });
      }),
    );

    renderCourseHome();
    await screen.findByRole('heading', { name: 'Khóa học demo' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(enrollmentsCallCount).toBe(0);
    expect(screen.queryByRole('button', { name: 'Bắt đầu học' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bỏ khỏi khoá của tôi' })).not.toBeInTheDocument();
  });
});
