import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { meQueryKey } from '../api/useMe';
import { clearUserContent, USER_CONTENT_KEYS } from '../db/localStorage';
import { Login } from './Login';
import { t } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ThemeProvider } from '../theme/ThemeContext';

/**
 * `GET /me` is answered 401 ("nobody signed in") by DEFAULT for every test
 * in this file, and it is registered as an INITIAL handler rather than via
 * `server.use(...)` so `resetHandlers()` in `afterEach` restores it rather
 * than removing it.
 *
 * Why this file suddenly needs it: `<Login>` now reads `useMe()` to bounce
 * an already-authenticated visitor away from the sign-in form (see
 * Login.tsx's doc comment) — the no-precondition trigger for the
 * cross-user local-state leak. A logged-out visitor is the state almost
 * every test here is about, and 401 is literally how this app expresses
 * that (see src/api/useMe.ts). The one test that wants the opposite
 * overrides this with its own `server.use(...)`.
 */
const server = setupServer(
  http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(clearUserContent);
afterEach(clearUserContent);

type InitialEntry = { pathname: string; search?: string; state?: unknown } | string;

function renderLogin(initialEntry: InitialEntry = '/login') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {/* `<Login>` nay dựng cả nút chủ đề — trang này không còn thanh trên để
          chứa nó (xem `ShellProps.authScreen`) — nên nó cần provider ấy, đúng
          như `<App/>` vẫn luôn cung cấp. */}
      <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Home dashboard</div>} />
          <Route path="/c/:courseId/:chapterId" element={<div>Chapter content</div>} />
        </Routes>
      </MemoryRouter></LanguageProvider></ThemeProvider>
    </QueryClientProvider>,
  );
  return { queryClient };
}

/**
 * `renderLogin` + a wait for the sign-in form to actually appear.
 *
 * `<Login>` renders NOTHING while `useMe()` is still pending — the same
 * trade `<RequireAuth>` makes on every other route — so that an
 * already-authenticated visitor never sees this form flash before being
 * bounced away from it (see Login.tsx). One consequence: a logged-out
 * visitor's form arrives one tick later than it used to, so every test
 * that drives the form has to wait for it, exactly like a real visitor
 * does. That wait is what this helper is.
 */
async function renderLoginForm(initialEntry: InitialEntry = '/login') {
  const result = renderLogin(initialEntry);
  await screen.findByLabelText(/email/i);
  return result;
}

/**
 * HAI CỘT — và cột trái là nội dung, không phải trang trí.
 *
 * `/login` là màn hình ĐẦU TIÊN của mọi người dùng mới. Trước thay đổi này nó
 * là một thẻ đơn độc giữa màn hình trống: ai chưa có tài khoản đọc hết trang
 * vẫn không biết mình sắp đăng ký cái gì. Đặc tả IA
 * (`docs/superpowers/specs/2026-08-23-ia-redesign.md`) + artboard
 * "S5-DangNhap" trên canvas đã duyệt: nửa trái sản phẩm tự giới thiệu, nửa
 * phải là form.
 *
 * Ba khẳng định, và mỗi cái chặn một cách hỏng khác nhau:
 *   1. lời giới thiệu CÓ MẶT — một `.auth-pitch` rỗng vẫn "là hai cột";
 *   2. cả hai nửa là con của cùng MỘT `.auth-page` — hai khối chồng nhau theo
 *      chiều dọc cũng qua được bài (1);
 *   3. cột trái KHÔNG có ô nhập nào — nó là chữ, không phải một form thứ hai;
 *      và form thật thì nằm trọn trong nửa phải.
 */
describe('Login — chỉ còn form: lời giới thiệu đã sang landing (02/09/2026)', () => {
  it('không còn panel giới thiệu; nhãn hiệu, nút chủ đề và bộ chọn ngôn ngữ vẫn ở trong cột form', async () => {
    await renderLoginForm();
    expect(document.querySelector('.auth-pitch')).toBeNull();
    const side = document.querySelector('.auth-side');
    expect(side).toHaveTextContent(t('vi', 'app.name'));
    // Hai điều khiển thiết bị ở lại trên route không có thanh trên — "CỬA"
    // (i18n/LanguageProvider.test.tsx) đo bộ chọn ngôn ngữ qua <App/>; ở đây
    // chỉ cần chúng nằm TRONG cột form, không bị bỏ rơi cùng panel ảnh.
    expect(side?.querySelector('#lang-select')).not.toBeNull();
    expect(side?.querySelector('.auth-chrome-btn')).not.toBeNull();
  });

  /**
   * BẢO VỆ CHỐNG TÁI PHẠM — danh sách LỜI HỨA ĐÃ CHẾT, quét NGUYÊN VĂN chữ
   * render ra chứ không so khớp một khoá cụ thể (thiết kế gốc của bài kiểm
   * này, spec `2026-08-25-server-side-pivot.md` §0.2) — nên nó vẫn đỏ nếu
   * lời hứa cũ quay lại qua bất kỳ khoá nào khác, kể cả một khoá mới không ai
   * đặt tên trước.
   *
   * Sáu mục, hai lời hứa đã chết ở hai pha khác nhau:
   *   - "ngoại tuyến" / "trên máy bạn" / "gói đã tải" / "gói khoá học" —
   *     course từng là một gói tải về, đọc được khi mất mạng; sai từ khi
   *     course chuyển hẳn lên máy chủ (task-14, spec §0.2). Bốn mục chứ
   *     không phải hai: hai mục đầu là NGUYÊN VĂN bản Login từng hứa, hai
   *     mục sau là NGUYÊN VĂN bản Settings từng hứa
   *     (`Settings.copy.test.tsx`) — gộp cả bốn vào MỘT danh sách để bài
   *     kiểm này cũng đỏ nếu lời hứa của Settings trôi dạt sang Login.
   *   - "key của chính bạn" / "không đi qua máy chủ" — trợ lý AI từng chạy
   *     bằng key riêng của người học, và key đó từng không đi qua máy chủ
   *     tuhoc; sai từ khi AI chuyển hẳn lên máy chủ (task-15, cùng spec
   *     §0.1 — bàn giao Pha 1 gọi đích danh câu này ở `login.point.ownKey`).
   *
   * GIỚI HẠN ĐÃ ĐO, KHÔNG SUY ĐOÁN: đây là so khớp CỤM CỐ ĐỊNH, không phải
   * so khớp NGỮ NGHĨA — một câu diễn đạt LẠI cùng nghĩa nhưng né cả sáu cụm
   * dưới đây (đo được ở task-15-report.md, không phải khả năng lý thuyết:
   * "trợ lý AI dùng mã truy cập bạn tự nhập, chữ ở lại trên thiết bị bạn,
   * chẳng ghé qua hạ tầng tuhoc") đi qua danh sách này MÀ KHÔNG BỊ BẮT. Vẫn
   * chọn cách này vì so khớp ngữ nghĩa không làm được trong một unit test
   * đồng bộ không gọi mô hình, và cụm cố định vẫn bắt được ca hồi quy THỰC
   * TẾ NHẤT — ai đó khôi phục lại NGUYÊN VĂN câu cũ.
   *
   * LẶP LẠI (không import) ở `Settings.copy.test.tsx` — cùng lý do docstring
   * của tệp đó đã nói cho việc không dùng chung harness: import một hằng số
   * từ tệp kia vẫn là một điểm chạm.
   */
  const LOI_HUA_DA_CHET_VI = [
    /ngoại tuyến/i,
    /trên máy bạn/i,
    /gói đã tải/i,
    /gói khoá học/i,
    /key của chính bạn/i,
    /không đi qua máy chủ/i,
  ];

  it('không còn hứa đọc ngoại tuyến, giữ gói trên máy bạn, hay chạy AI bằng key riêng — kiến trúc đã đổi ở hai pha (spec §0.2, §0.1)', async () => {
    await renderLoginForm();

    const rendered = document.body.textContent ?? '';
    for (const loiHua of LOI_HUA_DA_CHET_VI) {
      expect(rendered).not.toMatch(loiHua);
    }
  });

  /**
   * CÙNG CỔNG, PHÍA TIẾNG ANH. task-15 sửa câu chữ ở CẢ HAI ngôn ngữ — một
   * cổng chỉ quét bản tiếng Việt sẽ bỏ lọt nếu ai đó lỡ vá lại "your own key"
   * mà không đụng câu tiếng Việt tương ứng.
   *
   * `itbook-lang` là khoá `localStorage` mà `readStoredLang()`
   * (`i18n/index.ts`) đọc TRƯỚC khi `LanguageProvider` khởi tạo state lần
   * đầu (`useState(() => readStoredLang() ?? DEFAULT_LANG)`) — set nó rồi
   * mới render là cách render thẳng bản tiếng Anh mà không cần mô phỏng một
   * cú bấm đổi ngôn ngữ.
   *
   * `try`/`finally` xoá khoá này khi bài kiểm xong: `clearUserContent()`
   * (chạy trong `beforeEach`/`afterEach` của cả tệp) CỐ Ý không đụng tới
   * `itbook-lang` — nó là tuỳ chọn THIẾT BỊ, không phải nội dung người dùng
   * (`i18n/i18n.test.ts` → `'ngôn ngữ được ghi nhớ THEO THIẾT BỊ'`) — nên
   * nếu bài này không tự dọn, mọi bài Login sau nó trong tệp sẽ render bằng
   * tiếng Anh và đỏ ở `getByLabelText(/^mật khẩu$/i)`.
   */
  it('bản tiếng Anh cũng không còn hứa "your own key" hay "never passes through our servers"', async () => {
    localStorage.setItem('itbook-lang', 'en');
    try {
      await renderLoginForm();

      const rendered = document.body.textContent ?? '';
      expect(rendered).not.toMatch(/your own key/i);
      expect(rendered).not.toMatch(/never passes through our servers/i);
    } finally {
      localStorage.removeItem('itbook-lang');
    }
  });

  it('trang chỉ còn MỘT cột: `.auth-page` có đúng một con là `.auth-side`, và form nằm trọn trong đó', async () => {
    await renderLoginForm();
    const page = document.querySelector('.auth-page');
    const side = document.querySelector('.auth-side');
    expect(page).not.toBeNull();
    expect(Array.from(page?.children ?? [])).toEqual([side]);
    expect(side).toContainElement(screen.getByLabelText(/email/i));
    expect(side).toContainElement(screen.getByLabelText(/^mật khẩu$/i));
    expect(side).toContainElement(screen.getByRole('button', { name: /đăng nhập/i }));
  });
  it('giữ nguyên lớp `.auth-page` mà syncLifecycle.test.tsx bám vào', async () => {
    await renderLoginForm();
    expect(document.querySelectorAll('.auth-page')).toHaveLength(1);
  });
});

describe('Login page', () => {
  it('shows the sign-in form by default, and switches to the register form on the register tab', async () => {
    const user = userEvent.setup();
    await renderLoginForm();

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^mật khẩu$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/tên/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^tạo tài khoản$/i }));

    expect(screen.getByLabelText(/tên/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^mật khẩu$/i)).toBeInTheDocument();
  });

  it('successful login populates the useMe cache and navigates to "/" by default', async () => {
    server.use(
      http.post('/auth/login', () => HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })),
    );
    const user = userEvent.setup();
    const { queryClient } = await renderLoginForm();

    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));

    await waitFor(() => expect(screen.getByText('Home dashboard')).toBeInTheDocument());
    expect(queryClient.getQueryData(meQueryKey)).toEqual({ id: 'u1', email: 'a@example.com', name: 'A' });
  });

  it('after login, returns the visitor to the chapter URL they were redirected from (state.from)', async () => {
    server.use(
      http.post('/auth/login', () => HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })),
    );
    const user = userEvent.setup();
    await renderLoginForm({ pathname: '/login', state: { from: { pathname: '/c/demo/c1', search: '', hash: '' } } });

    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(await screen.findByText('Chapter content')).toBeInTheDocument();
  });

  it('wrong password shows a Vietnamese error that does not reveal whether the email is registered, and does not navigate away', async () => {
    server.use(
      http.post('/auth/login', () => HttpResponse.json({ error: 'invalid email or password' }, { status: 401 })),
    );
    const user = userEvent.setup();
    await renderLoginForm();

    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/email|mật khẩu/i);
    expect(alert.textContent?.toLowerCase()).not.toMatch(/không tồn tại|not found/);
    expect(screen.queryByText('Home dashboard')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('login rate-limited (429) shows a distinct "try again later" message', async () => {
    server.use(http.post('/auth/login', () => HttpResponse.json({ error: 'rate limited' }, { status: 429 })));
    const user = userEvent.setup();
    await renderLoginForm();

    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/thử lại|đợi/i);
  });

  it('registering with an email already in use (409) shows a distinct inline Vietnamese error', async () => {
    server.use(
      http.post('/auth/register', () => HttpResponse.json({ error: 'email already registered' }, { status: 409 })),
    );
    const user = userEvent.setup();
    await renderLoginForm();

    await user.click(screen.getByRole('button', { name: /^tạo tài khoản$/i }));
    await user.type(screen.getByLabelText(/tên/i), 'A');
    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng ký/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/email/i);
    expect(screen.queryByText('Home dashboard')).not.toBeInTheDocument();
  });

  it('successful registration also authenticates (populates useMe cache) and navigates away', async () => {
    server.use(
      http.post('/auth/register', () => HttpResponse.json({ id: 'u2', email: 'b@example.com', name: 'B' })),
    );
    const user = userEvent.setup();
    const { queryClient } = await renderLoginForm();

    await user.click(screen.getByRole('button', { name: /^tạo tài khoản$/i }));
    await user.type(screen.getByLabelText(/tên/i), 'B');
    await user.type(screen.getByLabelText(/email/i), 'b@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng ký/i }));

    await waitFor(() => expect(screen.getByText('Home dashboard')).toBeInTheDocument());
    expect(queryClient.getQueryData(meQueryKey)).toEqual({ id: 'u2', email: 'b@example.com', name: 'B' });
  });

  it('switching tabs after a failed submission clears the previous tab\'s error', async () => {
    server.use(
      http.post('/auth/login', () => HttpResponse.json({ error: 'invalid email or password' }, { status: 401 })),
    );
    const user = userEvent.setup();
    await renderLoginForm();

    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: /^tạo tài khoản$/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/**
 * Puts a value in the ONE local store left after Task 10 — the
 * user-content `localStorage` keys — so "nothing survives" can never pass
 * vacuously.
 *
 * Task 10 note, replacing the old version of this fixture: it used to seed
 * Dexie's `progress`/`annotations`/`outbox`/`meta` tables too. Those
 * tables, and Dexie itself, are gone — progress and annotations are
 * exclusively server-side now, scoped by session cookie at the SERVER, so
 * there is no local row of either that a change of signed-in user could
 * possibly inherit. What remains capable of surviving on THIS BROWSER,
 * across an auth transition, is `localStorage` — which is exactly what
 * `clearSession()` (`auth/session.ts`) still exists to clear.
 *
 * Task 11 note: this used to also seed `SESSION_VERIFIED_KEY`, the
 * offline-read marker — removed along with `<RequireAuth>`'s offline
 * branch, its only reader. `USER_CONTENT_KEYS` is the whole of what
 * survives an auth transition now.
 */
function seedPreviousUsersLocalData(): void {
  for (const key of USER_CONTENT_KEYS) window.localStorage.setItem(key, "previous user's private note");
}

/**
 * C1 — before this fix `useLogout` was the ONLY thing that ever cleared
 * local content, so any change of signed-in user that did not go through
 * an in-app logout — a second person signing in while the first was still
 * signed in, or a first person's 30-day cookie simply expiring — left the
 * arriving user sitting on the departing user's `localStorage` content.
 *
 * Task 10 narrowed WHAT can survive (Dexie's tables are gone; only
 * `localStorage` remains) but not the shape of the guarantee: `<Login>`
 * must clear it before seeding the arriving user, on both the sign-in and
 * the register path.
 */
describe('Login — local state does not survive a change of signed-in user (C1)', () => {
  it('clears local content before seeding the new session', async () => {
    server.use(http.post('/auth/login', () => HttpResponse.json({ id: 'u-new', email: 'new@example.com', name: 'New' })));
    seedPreviousUsersLocalData();

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<div>Home dashboard</div>} />
          </Routes>
        </MemoryRouter></LanguageProvider></ThemeProvider>
      </QueryClientProvider>,
    );

    await screen.findByLabelText(/email/i);
    await user.type(screen.getByLabelText(/email/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));

    await waitFor(() => expect(screen.getByText('Home dashboard')).toBeInTheDocument());

    for (const key of USER_CONTENT_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('registering on a browser that still holds a previous user\'s data clears it too', async () => {
    server.use(http.post('/auth/register', () => HttpResponse.json({ id: 'u-reg', email: 'reg@example.com', name: 'Reg' })));
    seedPreviousUsersLocalData();

    const user = userEvent.setup();
    await renderLoginForm();

    await user.click(screen.getByRole('button', { name: /^tạo tài khoản$/i }));
    await user.type(screen.getByLabelText(/tên/i), 'Reg');
    await user.type(screen.getByLabelText(/email/i), 'reg@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng ký/i }));

    await waitFor(() => expect(screen.getByText('Home dashboard')).toBeInTheDocument());
    for (const key of USER_CONTENT_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('an already-authenticated visitor to /login never renders the sign-in form (deferred-minor #18)', async () => {
    // `/login` is the one route outside <RequireAuth> (routes.tsx), so
    // without this guard a second person can reach the form while a first
    // person's session is live — the no-precondition trigger for
    // everything above.
    server.use(http.get('/me', () => HttpResponse.json({ id: 'u-signed-in', email: 'a@example.com', name: 'A' })));

    renderLogin();

    await waitFor(() => expect(screen.getByText('Home dashboard')).toBeInTheDocument());
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /đăng nhập/i })).not.toBeInTheDocument();
  });

  it('resets the query cache, so a previous session\'s cached data cannot render for the new user (I5)', async () => {
    server.use(http.post('/auth/login', () => HttpResponse.json({ id: 'u-new', email: 'new@example.com', name: 'New' })));

    const user = userEvent.setup();
    const { queryClient } = await renderLoginForm();
    // The dashboard's own cache entry, holding the PREVIOUS user's streak
    // and minutes — `setQueryData(meQueryKey, ...)` alone never touched it.
    queryClient.setQueryData(['stats'], { totalMinutes: 999, streakDays: 42, days: [], courses: [] });

    await user.type(screen.getByLabelText(/email/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));

    await waitFor(() => expect(screen.getByText('Home dashboard')).toBeInTheDocument());
    expect(queryClient.getQueryData(['stats'])).toBeUndefined();
    expect(queryClient.getQueryData(meQueryKey)).toEqual({ id: 'u-new', email: 'new@example.com', name: 'New' });
  });
});

/**
 * Deferred-minor #17 — `src/api/navigation.ts`'s `redirectToLogin()` (the
 * api client's 401 path, which fires from the sync engine's every cycle
 * and the heartbeat, and cannot use react-router state because it does a
 * hard `window.location` navigation) emits `?from=<path>`. Nothing read
 * it, so a reader whose session expired mid-chapter came back to `/`.
 */
describe('Login — ?from= redirect target (deferred-minor #17)', () => {
  it('returns the visitor to the ?from= path a hard 401 redirect left behind', async () => {
    server.use(http.post('/auth/login', () => HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })));

    const user = userEvent.setup();
    await renderLoginForm(`/login?from=${encodeURIComponent('/c/demo/c1')}`);

    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(await screen.findByText('Chapter content')).toBeInTheDocument();
  });

  it.each([
    ['//evil.example/phish', 'protocol-relative — a different origin that still starts with a single "/"'],
    ['/\\evil.example/phish', 'backslash form of the same thing, which browsers normalize to //'],
    ['https://evil.example/phish', 'an outright absolute URL'],
    ['/login', 'the login page itself — would bounce straight back'],
  ])('refuses %s as a redirect target (%s) and falls back to "/"', async (from) => {
    server.use(http.post('/auth/login', () => HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })));

    const user = userEvent.setup();
    await renderLoginForm(`/login?from=${encodeURIComponent(from)}`);

    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(await screen.findByText('Home dashboard')).toBeInTheDocument();
  });

  it('prefers react-router state.from over ?from= when both are present', async () => {
    server.use(http.post('/auth/login', () => HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })));

    const user = userEvent.setup();
    await renderLoginForm({
      pathname: '/login',
      search: `?from=${encodeURIComponent('/some/other/place')}`,
      state: { from: { pathname: '/c/demo/c1', search: '', hash: '' } },
    });

    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(await screen.findByText('Chapter content')).toBeInTheDocument();
  });
});
