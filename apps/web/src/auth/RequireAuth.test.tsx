import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearUserContent } from '../db/localStorage';
import { t } from '../i18n';
import { Login } from '../pages/Login';
import { RequireAuth } from './RequireAuth';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ThemeProvider } from '../theme/ThemeContext';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * Task 11 removed the offline-read marker along with `<RequireAuth>`'s
 * offline branch (see `auth/session.ts`) — `clearUserContent()` alone is
 * the whole reset now, same as `clearSession()` itself.
 */
function resetDevice(): void {
  clearUserContent();
}

beforeEach(resetDevice);
afterEach(resetDevice);

function Protected() {
  return <div>Protected content</div>;
}

/** Records every pathname react-router settles on, in order, so a test can
 * assert "landed once and stayed" versus "kept bouncing back and forth". */
function LocationRecorder({ onChange }: { onChange: (pathname: string) => void }) {
  const location = useLocation();
  useEffect(() => {
    onChange(location.pathname);
  }, [location.pathname, onChange]);
  return null;
}

function renderApp(initialPath: string, pathnames: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={[initialPath]}>
        <LocationRecorder onChange={(p) => pathnames.push(p)} />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Protected />
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter></LanguageProvider></ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RequireAuth', () => {
  it('renders nothing while the auth check is pending (no flicker of protected content or login)', async () => {
    server.use(
      http.get('/me', async () => {
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' });
      }),
    );
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: t('vi', 'login.heading.login') })).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Protected content')).toBeInTheDocument());
  });

  it('renders children once GET /me resolves with a user', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });

  it('redirects to /login when GET /me answers 401 (nobody logged in)', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    await waitFor(() => expect(pathnames.at(-1)).toBe('/login'));
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('does NOT redirect on a 500 from GET /me — shows an inline Vietnamese error instead, so an outage never looks like "you were logged out"', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    await waitFor(() => expect(screen.queryByText('Protected content')).not.toBeInTheDocument());
    // Give any (incorrect) redirect a chance to happen before asserting it didn't.
    await new Promise((r) => setTimeout(r, 10));
    expect(pathnames.at(-1)).toBe('/');
    expect(screen.getByText(/máy chủ|lỗi/i)).toBeInTheDocument();
  });

  it('a logged-out visitor who lands on /login (via the redirect above) is NOT bounced again — no redirect loop', async () => {
    let meCallCount = 0;
    server.use(
      http.get('/me', () => {
        meCallCount += 1;
        return HttpResponse.json({ error: 'unauthenticated' }, { status: 401 });
      }),
    );
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    // Settle on /login.
    await waitFor(() => expect(pathnames.at(-1)).toBe('/login'));
    expect(await screen.findByRole('heading', { name: t('vi', 'login.heading.login') })).toBeInTheDocument();

    // Give the app plenty of time to loop if it were going to.
    await new Promise((r) => setTimeout(r, 100));

    expect(pathnames).toEqual(['/', '/login']);
    // Login itself never calls GET /me, so the only call is RequireAuth's
    // original check — this is the concrete guarantee against a loop.
    expect(meCallCount).toBe(1);
    expect(screen.getByRole('heading', { name: t('vi', 'login.heading.login') })).toBeInTheDocument();
  });

  /**
   * Task 11 (Pha 3) — RequireAuth's offline branch is gone. The measurement
   * that justifies this: no service worker, no precache, the reader fetches
   * every chapter from the server on each load (`grep -arln
   * 'serviceWorker\|workbox\|precache' apps/web/` returns nothing) — so the
   * old branch was admitting a visitor past the auth gate into a page with
   * nothing on it to read. When `GET /me` gets no response at all (offline,
   * DNS failure, a blocked request — see `serverAnswered` in
   * `api/client.ts`), this is now the ONE outcome, unconditionally: a
   * needs-network message, never `children`.
   */
  it('không có response nào thì hiện màn cần-mạng, không thả vào reader', async () => {
    server.use(http.get('/me', () => HttpResponse.error()));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(await screen.findByText(t('vi', 'auth.needsNetwork'))).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(pathnames.at(-1)).toBe('/');
  });
});

// Task 7b's "RequireAuth — reading offline after a cold page load" describe
// block (`NETWORK_IS_DOWN`, `verifiedAgo`, `DAY_MS`, and eight tests) lived
// here and is gone: Task 11 removed the offline branch it exercised
// (`offlineSessionIsUsable`, `rememberSessionVerified`, the
// `sessionVerifiedAt` marker) along with the branch itself. What replaces
// it is the single "không có response nào..." test above, in the main
// `describe('RequireAuth', ...)` block: on a COLD load with no response,
// the outcome is now unconditional, so there is nothing left to
// distinguish "has a recent marker" from "doesn't" — see `RequireAuth.tsx`'s
// own doc comment for the measurement that justified this.

/* ====================================================================== *
 * MỘT LẦN `GET /me` HỎNG THOÁNG QUA KHÔNG ĐƯỢC PHÁ TRANG ĐANG MỞ
 * ====================================================================== */

/**
 * Đây là nửa NGUYÊN NHÂN của một bài e2e chập chờn, và nó là một lỗi thật chứ
 * không phải một phép đo quá nghiêm.
 *
 * Triệu chứng đo được: `e2e/s3.spec.ts` mở một chương, khẳng định TIÊU ĐỀ của
 * chương đã hiện, rồi đọc `#content` ngay sau đó và thỉnh thoảng nhận đúng 16
 * ký tự. Trong toàn bộ catalog tiếng Việt chỉ có một chuỗi 16 ký tự lọt được
 * vào `#content`: `reader.chapterLoading` — "Đang tải chương…". Tức trang đọc
 * đã dựng xong rồi TỤT LẠI về trạng thái đang tải.
 *
 * Đường duy nhất tụt lại được là `<ChapterView>` bị GỠ rồi DỰNG LẠI:
 * `useCourseKit` giữ `ready` trong state của component, nên một lần dựng lại
 * đưa nó về `false` (nửa kia của bản sửa này — xem `reader/useCourseKit.ts`).
 * Và trên route ấy chỉ có MỘT chỗ gỡ được cả cây: `RequireAuth` trả `null`.
 *
 * Kịch bản dưới đây dựng lại đúng chuỗi ấy: phiên đã được xác nhận, trang đã
 * vẽ, rồi một lần `GET /me` làm mới KHÔNG NHẬN ĐƯỢC PHẢN HỒI NÀO (mạng chớp,
 * một request bị huỷ, server bận). `useMe` đặt `retry: false` nên nó thành
 * `isError` ngay, `noResponseArrived` thành true, và truy vấn ngoại tuyến bắt
 * đầu — trong lúc nó `isPending`, guard trả `null`.
 *
 * ĐẾM SỐ LẦN DỰNG chứ không chỉ hỏi "chữ còn trên màn hình không": chớp một
 * cái rồi hiện lại thì ảnh chụp cuối cùng vẫn xanh, mà chính CÁI CHỚP mới là
 * lỗi — nó ném đi mọi state của cây bên dưới (ở trang đọc: canvas, mô phỏng đã
 * dựng, vị trí cuộn).
 */
describe('RequireAuth — một lần /me hỏng thoáng qua', () => {
  function MountCounter({ log }: { log: string[] }) {
    useEffect(() => {
      log.push('mount');
      return () => {
        log.push('unmount');
      };
    }, [log]);
    return <div>Protected content</div>;
  }

  it('không gỡ trang đã được cấp phép khi một lần làm mới /me không nhận được phản hồi', async () => {
    let calls = 0;
    server.use(
      http.get('/me', () => {
        calls += 1;
        // Lần đầu: phiên thật. Lần sau: mạng im lặng — KHÔNG phải 401, không
        // phải 500. Đây là ca mà `serverAnswered()` trả false.
        return calls === 1
          ? HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })
          : HttpResponse.error();
      }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const log: string[] = [];
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider><LanguageProvider>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <MountCounter log={log} />
                  </RequireAuth>
                }
              />
            </Routes>
          </MemoryRouter>
        </LanguageProvider></ThemeProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Protected content')).toBeInTheDocument();
    // `authorizedOnce.current` (`RequireAuth.tsx`) is set synchronously in
    // the very render that returns `children` here — no marker, no async
    // step to wait on since Task 11 (it used to be gated behind an
    // offline-session query's own `isPending`, which is gone). By the time
    // `findByText` above resolves, it is already `true`.
    expect(log).toEqual(['mount']);

    // Một lần làm mới thất bại, đúng như `refetchOnWindowFocus` sẽ gây ra.
    await queryClient.invalidateQueries({ queryKey: ['me'] });

    await waitFor(() => expect(calls).toBeGreaterThan(1));
    // Đợi thêm một nhịp để mọi commit sau đó kịp chạy.
    await waitFor(() => expect(screen.getByText('Protected content')).toBeInTheDocument());

    expect(
      log,
      'trang đã được cấp phép bị gỡ rồi dựng lại vì một lần /me hỏng — mọi state bên dưới mất theo',
    ).toEqual(['mount']);
  });
});
