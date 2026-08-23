import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { meQueryKey, useMe } from '../api/useMe';
import { clearLocalData, db } from '../db/local';
import { Login } from './Login';
import { t } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';

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

beforeEach(clearLocalData);
afterEach(clearLocalData);

type InitialEntry = { pathname: string; search?: string; state?: unknown } | string;

function renderLogin(initialEntry: InitialEntry = '/login') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider><MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Home dashboard</div>} />
          <Route path="/c/:courseId/:chapterId" element={<div>Chapter content</div>} />
        </Routes>
      </MemoryRouter></LanguageProvider>
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
describe('Login — hai cột: sản phẩm tự giới thiệu bên trái, form bên phải', () => {
  it('nửa trái nói ra sản phẩm này là gì: tên, một câu lớn, và ba gạch đầu dòng', async () => {
    await renderLoginForm();

    const pitch = document.querySelector('.auth-pitch');
    expect(pitch).not.toBeNull();
    expect(pitch).toHaveTextContent(t('vi', 'app.name'));
    expect(screen.getByRole('heading', { name: t('vi', 'login.pitch.headline') })).toBeInTheDocument();
    expect(pitch).toHaveTextContent(t('vi', 'login.pitch.lede'));

    const points = screen.getByRole('list', { name: t('vi', 'login.pitch.aria') });
    expect(Array.from(points.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      t('vi', 'login.point.offline'),
      t('vi', 'login.point.ownKey'),
      t('vi', 'login.point.private'),
    ]);
  });

  it('hai nửa là hai con của cùng MỘT trang, không phải hai trang xếp chồng', async () => {
    await renderLoginForm();

    const page = document.querySelector('.auth-page');
    const pitch = document.querySelector('.auth-pitch');
    const side = document.querySelector('.auth-side');

    expect(page).not.toBeNull();
    expect(pitch?.parentElement).toBe(page);
    expect(side?.parentElement).toBe(page);
  });

  it('form nằm TRỌN trong nửa phải, và nửa trái không có một ô nhập nào', async () => {
    await renderLoginForm();

    const pitch = document.querySelector('.auth-pitch');
    const side = document.querySelector('.auth-side');

    expect(pitch?.querySelectorAll('input')).toHaveLength(0);
    expect(side).toContainElement(screen.getByLabelText(/email/i));
    expect(side).toContainElement(screen.getByLabelText(/mật khẩu/i));
    expect(side).toContainElement(screen.getByRole('button', { name: /đăng nhập/i }));
  });

  /**
   * `.auth-page` là lớp mà `test/syncLifecycle.test.tsx` dùng để nhận ra "đã về
   * tới trang đăng nhập". Bố cục đổi hẳn ở thay đổi này, nên lớp ấy được ghim
   * lại đây: đổi tên nó sẽ làm một phép đo về vòng đời ĐỒNG BỘ đỏ ở một tệp
   * khác, vì một lý do THẨM MỸ — và người sửa sẽ không hiểu vì sao.
   */
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
    expect(screen.getByLabelText(/mật khẩu/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/tên/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /đăng ký/i }));

    expect(screen.getByLabelText(/tên/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/mật khẩu/i)).toBeInTheDocument();
  });

  it('successful login populates the useMe cache and navigates to "/" by default', async () => {
    server.use(
      http.post('/auth/login', () => HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })),
    );
    const user = userEvent.setup();
    const { queryClient } = await renderLoginForm();

    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/mật khẩu/i), 'secret123');
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
    await user.type(screen.getByLabelText(/mật khẩu/i), 'secret123');
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
    await user.type(screen.getByLabelText(/mật khẩu/i), 'wrong-password');
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
    await user.type(screen.getByLabelText(/mật khẩu/i), 'secret123');
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

    await user.click(screen.getByRole('tab', { name: /đăng ký/i }));
    await user.type(screen.getByLabelText(/tên/i), 'A');
    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/mật khẩu/i), 'secret123');
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

    await user.click(screen.getByRole('tab', { name: /đăng ký/i }));
    await user.type(screen.getByLabelText(/tên/i), 'B');
    await user.type(screen.getByLabelText(/email/i), 'b@example.com');
    await user.type(screen.getByLabelText(/mật khẩu/i), 'secret123');
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
    await user.type(screen.getByLabelText(/mật khẩu/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('tab', { name: /đăng ký/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/**
 * A stand-in for `App.tsx`'s `useSyncLifecycle`, and deliberately an exact
 * structural copy of it: `useMe()` → `meQuery.data?.id ?? null` → an
 * effect keyed on that id. In the real app that effect calls
 * `startSync()`; here it just records what the local database looked like
 * AT THAT INSTANT.
 *
 * That is the whole point. "Clear the database on login" is only a fix if
 * the clear finishes BEFORE a sync cycle for the new session can start,
 * and the thing that starts one is precisely this effect firing. Asserting
 * "the tables are empty once the dust settles" would pass even for a fix
 * that cleared asynchronously after seeding `me` — the exact race the
 * ordering is designed to avoid. Sampling here, in the same effect the
 * engine starts from, is what makes the ordering itself the thing under
 * test.
 */
function SyncLifecycleProbe({ onSyncCouldStart }: { onSyncCouldStart: () => void }) {
  const meQuery = useMe();
  const userId = meQuery.data?.id ?? null;

  useEffect(() => {
    if (userId !== null) onSyncCouldStart();
  }, [userId, onSyncCouldStart]);

  return null;
}

/** Puts one row in every local table, so "the tables are empty" can never pass vacuously. */
async function seedPreviousUsersLocalData(): Promise<void> {
  await db.progress.put({
    courseId: 'so-dau-phay-dong',
    chapterId: 'p2-10',
    status: 'read',
    done: true,
    updatedAt: '2026-08-19T10:00:00.000Z',
  });
  await db.annotations.put({
    id: '22222222-2222-4222-8222-222222222222',
    courseId: 'so-dau-phay-dong',
    chapterId: 'p2-10',
    anchor: {},
    note: "previous user's private note",
    createdAt: '2026-08-19T10:00:00.000Z',
    updatedAt: '2026-08-19T10:00:00.000Z',
    deletedAt: null,
  });
  await db.outbox.add({ table: 'progress', row: { courseId: 'so-dau-phay-dong', chapterId: 'p2-10' } });
  await db.outbox.add({ table: 'events', row: { kind: 'heartbeat' } });
  await db.meta.put({ key: 'syncCursor', value: '2026-08-19T10:00:00Z' });
}

/**
 * C1 — the local database is named for the BROWSER (`'tuhoc'`, see
 * src/db/local.ts), not for a user, and IndexedDB never expires. Before
 * this fix `useLogout` was the ONLY thing that ever cleared it, so any
 * change of signed-in user that did not go through an in-app logout —
 * a second person signing in while the first was still signed in, or a
 * first person's 30-day cookie simply expiring — left the arriving user
 * sitting on the departing user's rows: their queued outbox entries got
 * POSTed under the ARRIVING user's cookie into the ARRIVING user's server
 * account, their progress rendered as the arriving user's, and their
 * `syncCursor` made `GET /sync?since=` skip everything of the arriving
 * user's older than it.
 */
describe('Login — local state does not survive a change of signed-in user (C1)', () => {
  it('clears every local table before a sync cycle for the new session can start', async () => {
    server.use(http.post('/auth/login', () => HttpResponse.json({ id: 'u-new', email: 'new@example.com', name: 'New' })));
    await seedPreviousUsersLocalData();

    // Sampled inside the very effect the sync engine starts from — see
    // SyncLifecycleProbe. Captured as a promise so the read is ISSUED at
    // that instant rather than after the test has moved on.
    const samplesAtSyncStart: Promise<number[]>[] = [];
    const onSyncCouldStart = () => {
      samplesAtSyncStart.push(Promise.all(db.tables.map((t) => t.count())));
    };

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <SyncLifecycleProbe onSyncCouldStart={onSyncCouldStart} />
        <LanguageProvider><MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<div>Home dashboard</div>} />
          </Routes>
        </MemoryRouter></LanguageProvider>
      </QueryClientProvider>,
    );

    await screen.findByLabelText(/email/i);
    await user.type(screen.getByLabelText(/email/i), 'new@example.com');
    await user.type(screen.getByLabelText(/mật khẩu/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));

    await waitFor(() => expect(screen.getByText('Home dashboard')).toBeInTheDocument());

    // The previous user's rows are gone...
    expect(await Promise.all(db.tables.map((t) => t.count()))).toEqual(db.tables.map(() => 0));
    // ...and they were already gone at the moment sync could first run.
    expect(samplesAtSyncStart.length).toBeGreaterThan(0);
    for (const sample of samplesAtSyncStart) {
      expect(await sample).toEqual(db.tables.map(() => 0));
    }
  });

  it('registering on a browser that still holds a previous user\'s data clears it too', async () => {
    server.use(http.post('/auth/register', () => HttpResponse.json({ id: 'u-reg', email: 'reg@example.com', name: 'Reg' })));
    await seedPreviousUsersLocalData();

    const user = userEvent.setup();
    await renderLoginForm();

    await user.click(screen.getByRole('tab', { name: /đăng ký/i }));
    await user.type(screen.getByLabelText(/tên/i), 'Reg');
    await user.type(screen.getByLabelText(/email/i), 'reg@example.com');
    await user.type(screen.getByLabelText(/mật khẩu/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng ký/i }));

    await waitFor(() => expect(screen.getByText('Home dashboard')).toBeInTheDocument());
    expect(await Promise.all(db.tables.map((t) => t.count()))).toEqual(db.tables.map(() => 0));
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
    await user.type(screen.getByLabelText(/mật khẩu/i), 'secret123');
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
    await user.type(screen.getByLabelText(/mật khẩu/i), 'secret123');
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
    await user.type(screen.getByLabelText(/mật khẩu/i), 'secret123');
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
    await user.type(screen.getByLabelText(/mật khẩu/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(await screen.findByText('Chapter content')).toBeInTheDocument();
  });
});
