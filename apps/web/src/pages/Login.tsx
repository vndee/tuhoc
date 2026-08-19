import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, describeAuthError } from '../api/client';
import { meQueryKey, type Me } from '../api/useMe';

type Tab = 'login' | 'register';

interface FromLocation {
  pathname?: string;
  search?: string;
  hash?: string;
}

/**
 * Where to send the visitor after a successful login/register.
 * `<RequireAuth>` (src/auth/RequireAuth.tsx) sets `state.from` to the
 * location it bounced them from — e.g. a chapter URL visited while logged
 * out — so signing in returns them there instead of dumping them on the
 * dashboard. Arriving at /login directly (no bounce) has no `from`, and
 * falls back to "/".
 */
function redirectTarget(state: unknown): string {
  const from = (state as { from?: FromLocation } | null)?.from;
  if (from?.pathname) {
    return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
  }
  return '/';
}

/**
 * `/login` — sign-in and registration in one page, switched by tab.
 * Deliberately does **not** call `useMe`: that is what keeps a logged-out
 * visitor on this page from ever being redirected in a loop by
 * `<RequireAuth>`/the api client's 401 handling (see RequireAuth.tsx and
 * client.ts's `redirectOn401` doc comments) — this page's own render path
 * has no 401-triggering request on it at all.
 */
export function Login() {
  const [tab, setTab] = useState<Tab>('login');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const loginTabId = useId();
  const registerTabId = useId();

  function handleAuthenticated(user: Me) {
    // Seed the cache directly instead of invalidating-then-refetching:
    // `<RequireAuth>` on the target route reads `useMe` on the very next
    // render, and a refetch would leave it briefly back in its "pending"
    // state (rendering nothing) right after a successful login.
    queryClient.setQueryData(meQueryKey, user);
    navigate(redirectTarget(location.state), { replace: true });
  }

  return (
    <div className="auth-page">
      <h1 className="ch-title">Đăng nhập</h1>
      <p className="ch-lede">Đăng nhập hoặc tạo tài khoản để đồng bộ tiến độ học trên nhiều thiết bị.</p>

      <div role="tablist" aria-label="Đăng nhập hoặc đăng ký" className="seg auth-tabs">
        <button
          type="button"
          role="tab"
          id={loginTabId}
          aria-selected={tab === 'login'}
          aria-controls="auth-panel"
          className={tab === 'login' ? 'on' : undefined}
          onClick={() => setTab('login')}
        >
          Đăng nhập
        </button>
        <button
          type="button"
          role="tab"
          id={registerTabId}
          aria-selected={tab === 'register'}
          aria-controls="auth-panel"
          className={tab === 'register' ? 'on' : undefined}
          onClick={() => setTab('register')}
        >
          Đăng ký
        </button>
      </div>

      <div role="tabpanel" id="auth-panel" aria-labelledby={tab === 'login' ? loginTabId : registerTabId}>
        {tab === 'login' ? <LoginForm onSuccess={handleAuthenticated} /> : <RegisterForm onSuccess={handleAuthenticated} />}
      </div>
    </div>
  );
}

interface AuthFormProps {
  onSuccess: (user: Me) => void;
}

function LoginForm({ onSuccess }: AuthFormProps) {
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
      onSuccess(user);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor={emailId}>Email</label>
      <input
        id={emailId}
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor={passwordId}>Mật khẩu</label>
      <input
        id={passwordId}
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error != null && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
    </form>
  );
}

function RegisterForm({ onSuccess }: AuthFormProps) {
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
      onSuccess(user);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor={nameId}>Tên</label>
      <input id={nameId} type="text" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />

      <label htmlFor={emailId}>Email</label>
      <input
        id={emailId}
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor={passwordId}>Mật khẩu</label>
      <input
        id={passwordId}
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error != null && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? 'Đang đăng ký…' : 'Đăng ký'}
      </button>
    </form>
  );
}

export default Login;
