import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Review fix (Task 13, Pha 3): mocked the same way `api/useMe.test.tsx`
// mocks it, and for the identical reason — this file's own regression test
// below proves "no request fired" by watching `redirectToLogin` (a hard
// `window.location.href` navigation, `api/client.ts`'s fallback for a 401
// discovered outside a component tree) never get called, independent of
// whatever jsdom does or does not implement for real navigation.
vi.mock('../api/navigation', () => ({
  redirectToLogin: vi.fn(),
}));

import { redirectToLogin } from '../api/navigation';
import { Sidebar } from '../shell/Sidebar';
import type { Manifest } from '../course/types';
import { clearUserContent } from '../db/localStorage';
import { LanguageProvider } from '../i18n/LanguageProvider';

const manifest: Manifest = {
  id: 'demo',
  title: 'Khóa học demo',
  description: 'Mô tả',
  lang: 'vi',
  version: '1.0.0',
  runtime: '^1',
  parts: [
    {
      title: 'Phần 1',
      chapters: [
        { id: 'c1', num: '1.1', title: 'Chương một', short: 'Chương một', file: 'chapters/c1.html' },
        { id: 'c2', num: '1.2', title: 'Chương hai', short: 'Chương hai', file: 'chapters/c2.html' },
      ],
    },
  ],
};

const server = setupServer(
  // Task 13, Pha 3: `Sidebar.tsx` now gates its `useProgress` call behind a
  // confirmed session (`useProgress`'s own `enabled` option — see its doc
  // for the bug this closes), which means it also calls `useMe()`
  // unconditionally on every render. A signed-in baseline here is what
  // keeps every pre-existing test in this file exercising the SAME
  // "logged in, `doneChapterIds` fetched" path it always did — same
  // pattern `test/CourseHome.test.tsx`'s own server setup uses for the
  // identical reason.
  http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'Người học' })),
  // `GET /progress` fires on every render site in this file that reaches
  // the `courseId != null` branch, not just the one test that seeds a
  // "chapter already read" row — see `reader/ChapterView.test.tsx`'s and
  // `test/CourseHome.test.tsx`'s server setup for the same baseline
  // handler. No progress by default; the one test that needs a specific
  // row overrides this with `server.use(...)`.
  http.get('/progress', () => HttpResponse.json({ progress: [] })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(async () => {
  await clearUserContent();
});
afterEach(() => {
  server.resetHandlers();
  vi.mocked(redirectToLogin).mockClear();
});
afterAll(() => server.close());

function renderSidebar(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider><MemoryRouter initialEntries={[initialPath]}>
        <Sidebar />
      </MemoryRouter></LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('Sidebar real course outline', () => {
  // Bài này TỪNG canh trạng thái rỗng "Chưa có khóa học nào được tải." trên
  // `/`. Trạng thái ấy đã đi, cùng với cả thanh bên: nó nay chỉ mang mục lục,
  // nên ngoài một khoá nó không có gì để mang.
  //
  // Câu hỏi thay thế MẠNH HƠN câu cũ, chứ không nới ra: cũ chỉ đòi "đừng vẽ
  // liên kết nào", mới đòi "đừng vẽ GÌ CẢ". Một bản gộp nửa vời — bỏ trạng
  // thái rỗng nhưng để nguyên ô tìm chương bị disabled và dòng giữ chỗ tiến
  // độ — vẫn xanh với câu cũ.
  it('không dựng GÌ ngoài một khoá (e.g. "/") — thanh bên chỉ dành cho mục lục', () => {
    const { container } = renderSidebar('/');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the course outline in #nav on /c/:courseId', async () => {
    server.use(http.get('/courses/demo', () => HttpResponse.json(manifest)));
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    const links = await within(nav).findAllByRole('link');
    expect(links).toHaveLength(2);
    expect(within(nav).queryByText('Chưa có khóa học nào được tải.')).not.toBeInTheDocument();
  });

  it('also renders the course outline on a chapter sub-route /c/:courseId/:chapterId', async () => {
    server.use(http.get('/courses/demo', () => HttpResponse.json(manifest)));
    renderSidebar('/c/demo/c1');

    const nav = document.getElementById('nav')!;
    expect(await within(nav).findAllByRole('link')).toHaveLength(2);
  });

  it('every chapter link in #nav carries data-ch and the .nav-item class', async () => {
    server.use(http.get('/courses/demo', () => HttpResponse.json(manifest)));
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    const links = await within(nav).findAllByRole('link');
    expect(links.map((a) => a.getAttribute('data-ch')).sort()).toEqual(['c1', 'c2']);
    for (const link of links) {
      expect(link.className).toContain('nav-item');
    }
  });

  it('marks chapters read in local progress with the done class inside #nav (Ruling F4 / debt #1)', async () => {
    // Task 6, Pha 3: "read" now comes from `GET /progress` (the server),
    // not a pre-seeded Dexie row — see `reader/ChapterView.test.tsx`'s
    // server setup for the same change.
    server.use(
      http.get('/courses/demo', () => HttpResponse.json(manifest)),
      http.get('/progress', () =>
        HttpResponse.json({
          progress: [{ courseId: 'demo', chapterId: 'c2', status: 'read', done: true, updatedAt: new Date().toISOString() }],
        }),
      ),
    );
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    const links = await within(nav).findAllByRole('link');
    await waitFor(() => {
      expect(links.find((a) => a.getAttribute('data-ch') === 'c2')?.className).toContain('done');
    });
    expect(links.find((a) => a.getAttribute('data-ch') === 'c1')?.className).not.toContain('done');
  });

  it('shows a visible failure message in #nav — not silence — when the manifest 404s', async () => {
    server.use(http.get('/courses/demo', () => new HttpResponse(null, { status: 404 })));
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    // User-visible outcome, not an internal query flag: some text shows up
    // in #nav once the fetch settles, and it must not be empty and must
    // not be mistaken for "no course loaded" (a different, wrong message —
    // a course *was* selected, it just failed to load).
    await within(nav).findByText(/không tải được/i);
    expect(within(nav).queryByText('Chưa có khóa học nào được tải.')).not.toBeInTheDocument();
    expect(within(nav).queryAllByRole('link')).toHaveLength(0);
  });

  it('shows a distinct loading message in #nav while the manifest is pending, before it resolves', async () => {
    server.use(
      http.get('/courses/demo', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json(manifest);
      }),
    );
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    expect(within(nav).getByText('Đang tải khóa học…')).toBeInTheDocument();
    expect(within(nav).queryByText('Chưa có khóa học nào được tải.')).not.toBeInTheDocument();

    expect(await within(nav).findAllByRole('link')).toHaveLength(2);
  });
});

/**
 * `.sb-title` is the course name in the sidebar head. Nó TỪNG là `.sb-title` —
 * một dòng phụ đề dưới chữ "Tự học" — cho tới khi điều hướng chung rời thanh
 * bên: tên app đi cùng nó lên thanh trên, nên tên KHOÁ lên làm dòng chính.
 * Đổi tên lớp, không đổi luật.
 *
 * Bản gốc của khối này: It used to be
 * one course's title, written into the JSX — correct back when the app
 * shipped exactly one course, and a lie on every screen afterwards: it
 * named a course on `/library` (where it read as the name of the library
 * itself), on `/import`, on the dashboard, and — worst — named the WRONG
 * course while a different one was open.
 *
 * The rule these tests pin: the sidebar head names the course that is actually
 * open, and does not exist otherwise. "Otherwise" deliberately includes
 * the two in-between states of a course route, because a placeholder that
 * guesses is how the original bug got in — the sidebar must not name a
 * course until it has that course's own manifest in hand.
 */
describe('Sidebar course name (.sb-title)', () => {
  it('names the open course on /c/:courseId, from that course’s own manifest', async () => {
    server.use(http.get('/courses/demo', () => HttpResponse.json(manifest)));
    renderSidebar('/c/demo');

    await waitFor(() => expect(document.querySelector('.sb-title')?.textContent).toBe('Khóa học demo'));
  });

  it('names no course on a route without one (e.g. /library)', () => {
    renderSidebar('/library');
    expect(document.querySelector('.sb-title')).toBeNull();
  });

  it('names no course while the manifest is still loading, rather than guessing one', async () => {
    server.use(
      http.get('/courses/demo', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json(manifest);
      }),
    );
    renderSidebar('/c/demo');

    expect(document.querySelector('.sb-title')).toBeNull();
    await waitFor(() => expect(document.querySelector('.sb-title')?.textContent).toBe('Khóa học demo'));
  });

  it('names no course when the manifest fails to load', async () => {
    server.use(http.get('/courses/demo', () => new HttpResponse(null, { status: 404 })));
    renderSidebar('/c/demo');

    await within(document.getElementById('nav')!).findByText(/không tải được/i);
    expect(document.querySelector('.sb-title')).toBeNull();
  });
});

/**
 * Review fix (Task 13, Pha 3) — the fast, non-Docker regression test for
 * the `Sidebar.tsx`/`useProgress.ts` fix in this same commit. The e2e
 * suite (`p1.spec.ts` §5) proves the end-to-end symptom is gone, but it
 * needs Docker and takes minutes — not something a developer editing
 * `Sidebar.tsx` runs on every save. The Go fix in this same commit got an
 * equivalent fast assertion (`annotations_test.go`'s `doRaw`, checked on
 * every 201/204 call site); this is that same shape for the web half.
 *
 * Asserts on the REQUEST NOT BEING FIRED, not on the absence of a
 * rendered error — the bug was a fired `GET /progress` (which then 401s
 * and hard-redirects), not a rendering symptom, so a gate that only
 * checked "nothing looks wrong on screen" would not have caught it: the
 * old, broken code also rendered nothing wrong for a signed-out visitor
 * (the `doneCount`/`totalChapters` math degrades gracefully to 0/N), and
 * MSW would have answered the errant request from the SAME baseline
 * `/progress` handler above regardless — the request happening at all is
 * the whole bug.
 */
describe('Sidebar — chưa đăng nhập thì không gọi GET /progress (Task 13, Pha 3)', () => {
  it('signed-out trên /c/:courseId: không có request GET /progress nào, và không điều hướng /login', async () => {
    server.use(
      // `/me` answering 401 (not just an override that omits the handler
      // — `onUnhandledRequest: 'error'` would fail this test for the
      // wrong reason otherwise) is what `useMe()` treats as "nobody is
      // signed in" — see `api/useMe.ts`'s own `fetchMe` doc.
      http.get('/me', () => new HttpResponse(null, { status: 401 })),
      http.get('/courses/demo', () => HttpResponse.json(manifest)),
    );
    let progressCalls = 0;
    server.use(
      http.get('/progress', () => {
        progressCalls += 1;
        return HttpResponse.json({ progress: [] });
      }),
    );

    renderSidebar('/c/demo');

    // Let the manifest resolve (real signal: the course outline is on
    // screen) so `useMe()`'s own query has had a real turn to settle too
    // — both queries start on mount, and there is no user-visible event
    // to await for "useMe finished answering false." A short, bounded
    // wait after that is the same shape `test/CourseHome.test.tsx`'s
    // "chưa đăng nhập" test uses for the identical reason (its own
    // comment: "there is nothing to wait FOR ... waiting proves the
    // state never arrives rather than merely hasn't yet").
    const nav = document.getElementById('nav')!;
    await within(nav).findAllByRole('link');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(progressCalls, 'GET /progress must not fire for a signed-out visitor').toBe(0);
    expect(redirectToLogin, 'a signed-out visitor on a public course page must not be redirected').not.toHaveBeenCalled();
  });
});

describe('Sidebar — ô lọc mục lục (04/09/2026)', () => {
  // Ô "Tìm chương…" nằm `disabled` qua nhiều vòng, và không bài test nào ở
  // đây hỏi tại sao — nó là chrome hợp lệ, chỉ không làm gì. Những bài dưới
  // đây gõ vào nó.

  it('lọc mục lục ngay tại chỗ, KHÔNG gọi mạng', async () => {
    let searchCalls = 0;
    server.use(
      http.get('/courses/demo', () => HttpResponse.json(manifest)),
      // Nếu ô này lỡ đi qua `GET /search`, handler này bắt được. Manifest đã
      // nằm trong bộ nhớ; hỏi máy chủ thứ mình đang cầm là một vòng mạng
      // thừa và một trạng thái tải người dùng phải nhìn.
      http.get('/search', () => {
        searchCalls += 1;
        return HttpResponse.json({ courses: [], chapters: [], truncated: false });
      }),
    );
    const user = userEvent.setup();
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    expect(await within(nav).findAllByRole('link')).toHaveLength(2);

    await user.type(screen.getByRole('searchbox', { name: /tìm chương/i }), 'hai');
    await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(1));
    expect(within(nav).getByRole('link').textContent).toContain('Chương hai');
    expect(searchCalls, 'ô lọc mục lục không được gọi mạng').toBe(0);
  });

  it('lọc được cả theo SỐ chương, không chỉ theo tên', async () => {
    server.use(http.get('/courses/demo', () => HttpResponse.json(manifest)));
    const user = userEvent.setup();
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    await within(nav).findAllByRole('link');
    await user.type(screen.getByRole('searchbox', { name: /tìm chương/i }), '1.2');
    await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(1));
    expect(within(nav).getByRole('link').textContent).toContain('Chương hai');
  });

  it('không khớp gì thì NÓI RA — mục lục trống trơn trông y hệt một khoá rỗng', async () => {
    server.use(http.get('/courses/demo', () => HttpResponse.json(manifest)));
    const user = userEvent.setup();
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    await within(nav).findAllByRole('link');
    await user.type(screen.getByRole('searchbox', { name: /tìm chương/i }), 'zzz-không-có');

    await waitFor(() => expect(within(nav).queryAllByRole('link')).toHaveLength(0));
    expect(within(nav).getByText(/không có chương nào khớp/i)).toBeInTheDocument();
  });

  it('nút xoá và phím Escape đều trả mục lục về đủ', async () => {
    server.use(http.get('/courses/demo', () => HttpResponse.json(manifest)));
    const user = userEvent.setup();
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    await within(nav).findAllByRole('link');
    const box = screen.getByRole('searchbox', { name: /tìm chương/i });

    await user.type(box, 'hai');
    await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /xoá bộ lọc/i }));
    await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(2));

    await user.type(box, 'hai');
    await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(1));
    await user.type(box, '{Escape}');
    await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(2));
  });

  it('bỏ luôn tiêu đề phần khi phần ấy không còn chương nào', async () => {
    server.use(
      http.get('/courses/demo', () =>
        HttpResponse.json({
          ...manifest,
          parts: [
            manifest.parts[0],
            { title: 'Phần 2', chapters: [{ id: 'c3', num: '2.1', title: 'Chương ba', short: '', file: 'chapters/c3.html' }] },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderSidebar('/c/demo');

    const nav = document.getElementById('nav')!;
    await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(3));
    expect(within(nav).getByText('Phần 2')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: /tìm chương/i }), 'ba');
    await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(1));
    // Giữ lại "Phần 1" với một danh sách trống dưới nó là vẽ ra một ngăn kéo
    // rỗng — người đọc phải tự suy ra rằng nó rỗng vì bộ lọc.
    expect(within(nav).queryByText('Phần 1')).not.toBeInTheDocument();
    expect(within(nav).getByText('Phần 2')).toBeInTheDocument();
  });
});
