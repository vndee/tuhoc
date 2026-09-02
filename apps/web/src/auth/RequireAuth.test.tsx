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
import { readSessionVerifiedAt, rememberSessionVerified, SESSION_VERIFIED_KEY } from './session';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ThemeProvider } from '../theme/ThemeContext';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * This guard now WRITES the offline-read marker (`localStorage`, since
 * Task 10 — see `auth/session.ts`), so every test here starts from a
 * browser nobody has ever signed in on. `clearUserContent()` alone would
 * not touch the marker (it is not user CONTENT — see that function's own
 * doc comment), so this also removes it directly, the same way
 * `clearSession()` does.
 */
function resetDevice(): void {
  clearUserContent();
  window.localStorage.removeItem(SESSION_VERIFIED_KEY);
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
});

/* ====================================================================== *
 * Task 7b — a COLD page load with the network down
 * ====================================================================== */

/** msw's network-level failure: `fetch` rejects with a bare `TypeError`, no status, no body — what a browser hands a page when it never reached a server. */
const NETWORK_IS_DOWN = http.get('/me', () => HttpResponse.error());

/** How long ago the last confirmed `GET /me` was, expressed as an absolute instant. */
function verifiedAgo(ms: number): Date {
  return new Date(Date.now() - ms);
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('RequireAuth — reading offline after a cold page load', () => {
  it('renders the protected page when the server is unreachable and this device recently held a confirmed session', async () => {
    // Task 7 made a pinned course readable with the network off, but only
    // for a tab that was ALREADY open: a fresh load could not get past this
    // guard, because `GET /me` failing looked exactly like being logged
    // out. Measured in a real browser — see task-7-report.md §5.5.
    await rememberSessionVerified(verifiedAgo(60_000));
    server.use(NETWORK_IS_DOWN);
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(await screen.findByText('Protected content')).toBeInTheDocument();
    // ...and it stayed. A guard that rendered the page and then bounced
    // would satisfy the line above for one frame.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('Protected content')).toBeInTheDocument();
    expect(pathnames).toEqual(['/']);
  });

  it('does NOT render the protected page on a device where nobody has signed in — an unreachable server is not a key', async () => {
    server.use(NETWORK_IS_DOWN);
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(await screen.findByText(/kết nối/i)).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(pathnames.at(-1)).toBe('/');
  });

  it('does NOT render the protected page once the offline window has run out', async () => {
    await rememberSessionVerified(verifiedAgo(8 * DAY_MS));
    server.use(NETWORK_IS_DOWN);
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(await screen.findByText(/kết nối/i)).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(pathnames.at(-1)).toBe('/');
  });

  it('a 401 still wins over the marker: the server saying "nobody is signed in" is an ANSWER, not an outage', async () => {
    // The sharp edge of this whole change. The marker only ever fills a
    // silence; it may never contradict the server.
    await rememberSessionVerified(verifiedAgo(60_000));
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    await waitFor(() => expect(pathnames.at(-1)).toBe('/login'));
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('a 500 still shows the outage message even with a fresh marker — a reachable, broken server is not an offline device', async () => {
    await rememberSessionVerified(verifiedAgo(60_000));
    server.use(http.get('/me', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(await screen.findByText(/máy chủ|lỗi/i)).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(pathnames.at(-1)).toBe('/');
  });

  it('a confirmed GET /me is what leaves the marker behind, so the NEXT load can be offline', async () => {
    expect(await readSessionVerifiedAt()).toBeNull();
    server.use(http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@example.com', name: 'A' })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    await screen.findByText('Protected content');
    await waitFor(async () => expect(await readSessionVerifiedAt()).not.toBeNull());
  });

  it('a 401 leaves NO marker behind — the offline door never opens for a visitor who was refused', async () => {
    server.use(http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    await waitFor(() => expect(pathnames.at(-1)).toBe('/login'));
    expect(await readSessionVerifiedAt()).toBeNull();
  });

  it('renders nothing — never the login screen — while it is still asking the local database', async () => {
    // The same trade the pending branch above already makes: one blank
    // paint beats flashing a sign-in form at somebody who is merely
    // offline.
    await rememberSessionVerified(verifiedAgo(60_000));
    server.use(NETWORK_IS_DOWN);
    const pathnames: string[] = [];
    renderApp('/', pathnames);

    expect(screen.queryByRole('heading', { name: t('vi', 'login.heading.login') })).not.toBeInTheDocument();
    expect(screen.queryByText(/kết nối/i)).not.toBeInTheDocument();

    await screen.findByText('Protected content');
    expect(pathnames).toEqual(['/']);
  });
});

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
    // Cái mốc ngoại tuyến do chính guard ghi ra sau khi phiên được xác nhận;
    // đợi nó, vì nhánh lạc quan bên dưới đọc đúng nó.
    await waitFor(async () => expect(await readSessionVerifiedAt()).not.toBeNull());
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
