import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, describeAuthError } from '../api/client';
import { meQueryKey, useMe, type Me } from '../api/useMe';
import { clearSession } from '../auth/session';
import { useLanguage } from '../i18n/LanguageProvider';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { Logo } from '../shell/Logo';
import { useThemeContext } from '../theme/ThemeContext';

type Tab = 'login' | 'register';

interface FromLocation {
  pathname?: string;
  search?: string;
  hash?: string;
}

/**
 * Validates a `?from=` value as a SAME-ORIGIN, relative path, returning it
 * normalized, or `null` if it is anything else.
 *
 * This is an open-redirect guard, and it is required rather than merely
 * defensive: `?from=` is attacker-controllable by construction — it lives
 * in a URL, and
 * `https://tuhoc.example/login?from=https://evil.example` is exactly the
 * shape a phishing link takes (sign in on the real, trusted origin, get
 * bounced to the attacker's page immediately afterwards, still looking
 * like part of the flow).
 *
 * The checks, and what each is for:
 *   - must start with `/` — rejects absolute URLs (`https://evil.example`)
 *     and bare hosts alike.
 *   - must NOT start with `//` or `/\` — both are protocol-relative
 *     references to ANOTHER ORIGIN that still begin with a single `/`
 *     (browsers normalize the backslash form to the slash form), i.e.
 *     exactly the case a naive "starts with /" check waves through.
 *   - must NOT be `/login` itself — `?from=/login` would bounce the
 *     visitor back to the page they just successfully left.
 *   - finally, resolve against this document's own origin and confirm the
 *     result really did stay on it, so anything the checks above did not
 *     anticipate (encodings, control characters, URL-parsing quirks) is
 *     still caught by the browser's own parser rather than by this
 *     function's imagination.
 */
function safeRelativePath(raw: string | null): string | null {
  if (raw == null || raw === '') return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  if (parsed.origin !== window.location.origin) return null;
  if (parsed.pathname === '/login' || parsed.pathname.startsWith('/login/')) return null;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Where to send the visitor after a successful login/register.
 *
 * TWO mechanisms carry "where they were headed," because there are two
 * genuinely different ways to arrive here and each can only carry one of
 * them:
 *
 *  1. `state.from` — `<RequireAuth>` (src/auth/RequireAuth.tsx) sets it to
 *     the location it bounced them from, via a react-router client-side
 *     navigation. Preferred when present: it is structured, and it can
 *     never have come from outside this app.
 *  2. `?from=` — `src/api/navigation.ts`'s `redirectToLogin()` emits it.
 *     That is the api client's 401 path, which has no react-router
 *     `navigate()` to reach for (it fires from a `queryFn` — the sync
 *     engine, the heartbeat) and so does a hard `window.location`
 *     navigation, which CANNOT carry router state. Nothing read this
 *     param before, so the whole mechanism was inert: a reader whose
 *     session expired mid-chapter (the sync engine 401-redirects on every
 *     cycle, so this path is live, not theoretical) signed back in and
 *     landed on `/` instead of the chapter they were reading. Validated
 *     through `safeRelativePath` above — unlike (1), this one arrives in
 *     a URL.
 *
 * Neither present (a direct visit to /login) falls back to "/".
 */
function redirectTarget(state: unknown, search: string): string {
  const from = (state as { from?: FromLocation } | null)?.from;
  if (from?.pathname) {
    return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
  }
  return safeRelativePath(new URLSearchParams(search).get('from')) ?? '/';
}

/**
 * `/login` — sign-in and registration in one page, switched by tab.
 *
 * This page DOES call `useMe`, but only through the shared, already-cached
 * `meQueryKey` query with `redirectOn401: false` (see src/api/useMe.ts):
 * a 401 here resolves to `null` ("nobody is signed in"), never to a
 * redirect, so the loop this page's original comment worried about still
 * cannot happen. It costs no extra request either — `App.tsx`'s
 * `useSyncLifecycle` already calls `useMe()` on every route including this
 * one.
 *
 * It reads it for a reason that turned out to be load-bearing rather than
 * cosmetic: an ALREADY-AUTHENTICATED visitor must not be shown this form.
 * `/login` is deliberately the one route outside `<RequireAuth>`
 * (routes.tsx), so without this guard a second person could reach the form
 * while a first person's session was live, sign in, replace the cookie —
 * and inherit the first person's still-populated IndexedDB, whose outbox
 * would then be pushed into the SECOND account under the second account's
 * cookie. The clear in `handleAuthenticated` below is the other half of
 * that fix; this guard removes the no-precondition way to trigger it.
 *
 * Rendering nothing while `useMe` is pending (rather than the form) is the
 * same trade `<RequireAuth>` already makes on every other route: at most
 * one blank paint for a logged-out visitor, versus never flashing this
 * form at someone who is already signed in.
 */
export function Login() {
  const { t } = useLanguage();
  const { theme, toggle: toggleTheme } = useThemeContext();
  const [tab, setTab] = useState<Tab>('login');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const meQuery = useMe();

  async function handleAuthenticated(user: Me) {
    // ORDERING IS THE FIX HERE, not an implementation detail. Task 10
    // removed `sync/engine.ts` (progress/annotations are exclusively
    // server-side now, read and written directly, no local outbox to race)
    // — before that removal, this comment also explained a `stopSync()`
    // call that had to run before the seed below, for exactly the same
    // "a stale cycle must not write after the clear" reason `clearSession`'s
    // own doc comment still gives for its own ordering. That call and that
    // reasoning are gone WITH the engine, not merely unused — there is no
    // background cycle left anywhere in this app for a previous session's
    // response to race.
    //
    // What is still load-bearing: `await clearSession(queryClient)`
    // (src/auth/session.ts) — every half of what the previous session left
    // on this machine, through the one door (ruling P2-F18), strictly
    // before the seed:
    //
    //       - the durable half (`clearUserContent()`): the previous
    //         user's `localStorage` content must be gone before the
    //         arriving user's session renders anything — a note draft is
    //         scoped to the BROWSER (there is no per-user namespace in
    //         `localStorage`), and it never expires on its own, so "the
    //         cookie changed" is the only thing that changes here —
    //         nothing else would. (Task 11 removed a second thing this
    //         bullet used to name here, the offline-read marker —
    //         `<RequireAuth>`'s offline branch, its only reader, is gone,
    //         and `clearUserContent()` never cleared that marker anyway;
    //         a separate call inside `clearSession()` did, and that call
    //         is gone too — see `session.ts`'s own doc comment.)
    //       - the in-memory half (`resetSessionScopedQueries()`): `['stats']`
    //         etc. still hold the previous user's numbers. It has to land
    //         before `setQueryData`, or it would wipe the seed.
    //       - the queued-but-unflushed study-event half
    //         (`resetEventQueue()`, `../api/events`): DELIBERATELY dropped
    //         here, never flushed first. Unlike `useLogout.ts`'s own
    //         `bestEffortFinalFlush()`, which flushes BEFORE invalidating
    //         the departing session's cookie, this function is only ever
    //         called AFTER `POST /auth/login` has already succeeded — the
    //         browser's cookie jar already carries the ARRIVING user's
    //         session by the time this line runs. A flush attempted here
    //         would POST the PREVIOUS user's queued heartbeats under the
    //         NEW user's cookie: not a fix for the cross-account leak this
    //         whole door exists to close, but a straight-line cause of it.
    //         Dropping is the only correct choice at this specific call
    //         site; see `clearSession()`'s own doc for why it is
    //         unconditional (it never waits on or attempts a flush itself).
    //       - the paused-but-unresumed mutation half
    //         (`queryClient.getMutationCache().clear()`, Task 11's fix
    //         round): a mutation the PREVIOUS session left paused offline
    //         (TanStack's default `networkMode: 'online'`) would otherwise
    //         auto-resume the moment connectivity returns and replay under
    //         whatever cookie is valid then — the ARRIVING user's, by this
    //         point. Same shape of leak as the event queue above, one
    //         layer up the stack; see `session.ts`'s own doc comment.
    //
    //     `useLogout` goes through the same door on the way out, but flushes
    //     the event queue ITSELF, first, while its own cookie is still
    //     valid — see that hook's `bestEffortFinalFlush`.
    //
    // Only then: seed `me`. Seeding it directly rather than invalidating
    // and refetching is the original, still-valid reason — `<RequireAuth>`
    // on the target route reads `useMe` on the very next render, and a
    // refetch would leave it briefly back in its "pending" state
    // (rendering nothing) right after a successful login.
    await clearSession(queryClient);
    queryClient.setQueryData(meQueryKey, user);
    navigate(redirectTarget(location.state, location.search), { replace: true });
  }

  // Already signed in — see this component's doc comment. `replace` so the
  // bounce doesn't leave /login in the history for the back button.
  if (meQuery.isPending) {
    return null;
  }
  if (meQuery.data != null) {
    return <Navigate to={redirectTarget(location.state, location.search)} replace />;
  }

  return (
    /*
      HAI CỘT, và cột trái không phải trang trí.
      Đặc tả IA: `docs/superpowers/specs/2026-08-23-ia-redesign.md`; hình:
      artboard "S5-DangNhap" trên canvas đã duyệt.

      `/login` là màn hình ĐẦU TIÊN của mọi người dùng mới, và trước đây nó là
      một thẻ đơn độc giữa màn hình trống: người chưa có tài khoản đọc hết trang
      vẫn không biết mình sắp đăng ký cái gì. Một trang đăng nhập trống là cơ hội
      bỏ phí — nên nửa trái là sản phẩm tự giới thiệu, nửa phải là form.

      `.auth-page` GIỮ NGUYÊN TÊN dù bố cục đổi hẳn: `test/syncLifecycle.test.tsx`
      dùng đúng lớp này để nhận ra "đã về tới trang đăng nhập". Đổi tên nó là
      làm hỏng một phép đo về vòng đời đồng bộ vì một lý do thẩm mỹ.
    */
    <div className="auth-page">
      <section className="auth-side">
        {/* Hai điều khiển của thiết bị — chủ đề và ngôn ngữ — ở góc trên phải
            của cột form. Chúng từng nằm trên panel ảnh bên phải; panel ấy đã
            rời sang landing (02/09/2026: `/login` chỉ còn form), nhưng hai
            điều khiển thì không đi được: `App.tsx` không dựng thanh trên trên
            route này, và `i18n/LanguageProvider.test.tsx` ("CỬA") đo đúng
            rằng một người chưa đọc được tiếng Việt vẫn đổi được ngôn ngữ ở
            màn hình đầu tiên họ gặp. */}
        <div className="auth-chrome auth-chrome-top">
          <button
            type="button"
            className="auth-chrome-btn"
            aria-label={t(theme === 'dark' ? 'topbar.themeToLight' : 'topbar.themeToDark')}
            aria-pressed={theme === 'dark'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? (
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth="1.6" />
                <path
                  d="M10 2.4v1.9M10 15.7v1.9M17.6 10h-1.9M4.3 10H2.4M15.4 4.6l-1.3 1.3M6 14l-1.4 1.4M15.4 15.4l-1.3-1.3M6 6L4.6 4.6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M16.5 12.4A6.8 6.8 0 017.6 3.5a6.9 6.9 0 108.9 8.9z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
          <LanguageSwitcher />
        </div>
        <div className="auth-side-inner">
          {/* Nhãn hiệu ĐỨNG GIỮA, ngay trên nhan đề — chỗ mẫu Untitled UI đặt
              nó, và nó ở cột trái đúng như người dùng yêu cầu. Ba dòng đầu cột
              (mark, nhan đề, câu dẫn) căn giữa; từ hàng tab trở xuống căn trái,
              vì một ô nhập căn giữa thì mắt không có mép nào để bám. */}
          <p className="auth-brand">
            <Logo size={34} boxed />
            <span>{t('app.name')}</span>
          </p>
          {/*
            MỘT nhan đề, và nó đổi theo form đang mở.

            HAI TAB "Đăng nhập / Đăng ký" ĐÃ BỎ. Chúng nói cùng một điều với
            dòng "Chưa có tài khoản? Tạo tài khoản" ở chân cột — và người dùng
            gọi đúng tên chỗ thừa ấy: "chúng ta có nút tạo tài khoản ở dưới rồi
            mà". Hai điều khiển cho một việc, cách nhau bốn trăm pixel, là thứ
            cả vòng thiết kế lại này tồn tại để gỡ.

            Bỏ tab thì `role="tablist"` và `role="tabpanel"` cũng phải đi theo:
            một `tabpanel` không còn `tab` nào trỏ vào là ARIA hỏng, và một
            trình đọc màn hình sẽ khai một cấu trúc không tồn tại.

            Nhan đề PHẢI đổi theo tab, vì nó là thứ duy nhất còn nói ra bạn
            đang ở form nào — trước đây tab đang sáng làm việc đó.
          */}
          <h2 className="auth-h">{t(tab === 'login' ? 'login.heading.login' : 'login.heading.register')}</h2>

          {tab === 'login' ? (
            <LoginForm onSuccess={handleAuthenticated} />
          ) : (
            <RegisterForm onSuccess={handleAuthenticated} />
          )}

          {/*
            CÂU TRẢ LỜI CHO "TÔI CÓ PHẢI ĐĂNG KÝ KHÔNG" — và nó là KHÔNG.

            Panel bên trái đã nói HẾT lợi ích của việc đăng nhập (nhan đề + ba
            gạch đầu dòng, đọc từ chính mảng ở `:275`: đọc miễn phí không cần
            tài khoản; trợ lý AI chạy trên máy chủ của nền tảng, trả bằng
            credit; tiến độ + ghi chú theo bạn qua thiết bị).

            Bản trước của chú thích này gọi gạch thứ hai là "key riêng" — câu
            chữ Pha 1, đã đổi ở Task 15 trong CHÍNH tệp render nó
            (`login.point.ownKey` nay nói ngược lại: "không cần key của riêng
            bạn"). Tên KHOÁ giữ nguyên nên chú thích trôi mà không ai vấp
            (review tổng nhánh Pha 2, F4).

            fix-round-1 (task-14) từng rút câu
            này xuống còn một vế nói lại đúng lợi ích ấy — vẫn là lặp, chỉ lặp
            với MỘT bullet thay vì lặp với cả panel. fix-round-2 đổi góc: câu ở
            đây không nói lợi ích nữa, nó nói thứ panel bên trái không nói —
            KHÔNG MẤT GÌ nếu chưa đăng nhập ngay, cho người chỉ đọc cột form mà
            bỏ qua panel bên trái.
          */}
          <p className="auth-reassure">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M10 2.6l5.7 2.2v4.6c0 3.4-2.3 6.5-5.7 7.9-3.4-1.4-5.7-4.5-5.7-7.9V4.8L10 2.6z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span>{t('login.reassure')}</span>
          </p>

          {/*
            ĐỔI TAB, KHÔNG PHẢI ĐIỀU HƯỚNG: hai form là hai tab của cùng một
            trang, nên đây là một `<button>`. Một `<a href="/register">` sẽ hứa
            một route không tồn tại.

            Nhãn của nó luôn là hành động của tab KIA, nên nó không bao giờ
            trùng tên với nút gửi đang hiện — điều kiện để `getByRole('button',
            { name: /đăng nhập/i })` trong `Login.test.tsx` và
            `{ name: 'Đăng ký', exact: true }` trong `e2e/helpers.ts` vẫn chỉ
            khớp đúng một phần tử.
          */}
          <p className="auth-switch">
            {t(tab === 'login' ? 'login.switch.noAccount' : 'login.switch.hasAccount')}{' '}
            <button
              type="button"
              className="auth-switch-link"
              onClick={() => setTab(tab === 'login' ? 'register' : 'login')}
            >
              {t(tab === 'login' ? 'login.switch.toRegister' : 'login.switch.toLogin')}
            </button>
          </p>
        </div>
      </section>
    </div>
  );
}

/**
 * Ô mật khẩu kèm nút hiện/ẩn — bản dựng đã duyệt vẽ con mắt ấy ở mép phải ô.
 *
 * KHÔNG phải một nút "đẹp hơn": một người gõ mật khẩu dài trên bàn phím ảo mà
 * không xem lại được thì hoặc gõ sai rồi đoán, hoặc chọn một mật khẩu ngắn hơn
 * để đỡ sai. Đây là một trong vài chỗ mà một điều khiển giao diện thật sự đổi
 * được chất lượng của thứ người dùng nhập vào.
 *
 * `type` đổi giữa `password` và `text`, KHÔNG dùng `-webkit-text-security`:
 * trình quản lý mật khẩu nhận diện ô theo `type` + `autoComplete`, và một ô
 * `text` giả dạng sẽ không được điền tự động.
 *
 * `aria-pressed` chứ không đổi `aria-label` theo trạng thái ẩn/hiện: nút giữ
 * MỘT tên, còn trạng thái thì nói bằng đúng thuộc tính sinh ra để nói nó.
 */
function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  autoComplete: string;
  minLength?: number;
}) {
  const { t } = useLanguage();
  const [shown, setShown] = useState(false);

  return (
    <span className="auth-pw">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="auth-pw-eye"
        aria-label={t(shown ? 'login.password.hide' : 'login.password.show')}
        aria-pressed={shown}
        aria-controls={id}
        onClick={() => setShown((on) => !on)}
      >
        {shown ? (
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 3l14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path
              d="M7.3 7.4A2.7 2.7 0 0010 12.7c.7 0 1.4-.3 1.9-.8M5.2 5.6C3.6 6.7 2.4 8.2 1.8 10c1.3 3.3 4.5 5.5 8.2 5.5 1.4 0 2.7-.3 3.9-.9M8.4 4.7A9.4 9.4 0 0110 4.5c3.7 0 6.9 2.2 8.2 5.5-.5 1.4-1.4 2.6-2.5 3.6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M1.8 10C3.1 6.7 6.3 4.5 10 4.5s6.9 2.2 8.2 5.5c-1.3 3.3-4.5 5.5-8.2 5.5S3.1 13.3 1.8 10z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <circle cx="10" cy="10" r="2.7" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        )}
      </button>
    </span>
  );
}

interface AuthFormProps {
  /**
   * Async on purpose, and both forms `await` it: it clears this browser's
   * local database before seeding the new session (see
   * `handleAuthenticated`). Not awaiting would let `setPending(false)`
   * re-enable the form — and let a second submit start — while that clear
   * was still running, which is the same race the clear exists to close.
   */
  onSuccess: (user: Me) => Promise<void>;
}

function LoginForm({ onSuccess }: AuthFormProps) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      // redirectOn401: false — a wrong password or unknown email is this
      // form's normal, expected failure mode (see client.ts's
      // RequestOptions doc comment), not a session dying; the backend
      // itself uses one status/body for both cases on purpose (anti
      // email-enumeration — apps/api/internal/auth/usecase.go), and
      // describeAuthError below mirrors that ambiguity in the copy.
      const user = await api.post<Me>('/auth/login', { email, password }, { redirectOn401: false });
      await onSuccess(user);
    } catch (err) {
      setError(describeAuthError(err, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor={emailId}>{t('login.field.email')}</label>
      <input
        id={emailId}
        type="email"
        required
        autoComplete="email"
        placeholder={t('login.field.emailPlaceholder')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor={passwordId}>{t('login.field.password')}</label>
      <PasswordField
        id={passwordId}
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
      />

      {error != null && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      <button type="submit" className="btn primary" disabled={pending}>
        {t(pending ? 'login.submit.loggingIn' : 'login.submit.login')}
      </button>
    </form>
  );
}

function RegisterForm({ onSuccess }: AuthFormProps) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const user = await api.post<Me>('/auth/register', { email, password, name });
      await onSuccess(user);
    } catch (err) {
      setError(describeAuthError(err, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor={nameId}>{t('login.field.name')}</label>
      <input id={nameId} type="text" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />

      <label htmlFor={emailId}>{t('login.field.email')}</label>
      <input
        id={emailId}
        type="email"
        required
        autoComplete="email"
        placeholder={t('login.field.emailPlaceholder')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor={passwordId}>{t('login.field.password')}</label>
      <PasswordField
        id={passwordId}
        autoComplete="new-password"
        minLength={8}
        value={password}
        onChange={setPassword}
      />

      {error != null && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      <button type="submit" className="btn primary" disabled={pending}>
        {t(pending ? 'login.submit.registering' : 'login.submit.register')}
      </button>
    </form>
  );
}

export default Login;
