import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, describeAuthError } from '../api/client';
import { meQueryKey, useMe, type Me } from '../api/useMe';
import { clearSession } from '../auth/session';
import { useLanguage } from '../i18n/LanguageProvider';
import { stopSync } from '../sync/engine';

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
  const [tab, setTab] = useState<Tab>('login');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const meQuery = useMe();
  const loginTabId = useId();
  const registerTabId = useId();

  async function handleAuthenticated(user: Me) {
    // ORDERING IS THE FIX HERE, not an implementation detail. The sync
    // engine starts from `App.tsx`'s `useSyncLifecycle`, which is driven
    // by `useMe()`'s cached user — so the instant
    // `setQueryData(meQueryKey, user)` runs below, a sync cycle for THIS
    // session can begin. Everything that must be true before that
    // happens has to happen strictly before that line:
    //
    //  1. `stopSync()` — bumps `sync/engine.ts`'s epoch, so any cycle
    //     belonging to a PREVIOUS session that is still in flight (its
    //     response not yet back) discards its local write instead of
    //     landing it after step 2's clear. Same mechanism, same reason,
    //     as `useLogout`'s own `stopSync()` calls; the lifecycle effect
    //     restarts sync on its own once `me` changes below.
    //  2. `await clearSession(queryClient)` (src/auth/session.ts) — BOTH
    //     halves of what the previous session left on this machine, through
    //     the one door (ruling P2-F18), and both strictly before the seed:
    //
    //       - the durable half (`clearLocalData()`): the previous user's
    //         rows must be gone before this session can read or push any of
    //         them. The local database is named for the BROWSER (`'tuhoc'`),
    //         not the user, and IndexedDB never expires, so "the cookie
    //         changed" is the only thing that changes here — nothing else
    //         would. Without this, the previous user's queued outbox entries
    //         (progress AND heartbeat events) get POSTed under the new
    //         user's cookie into the NEW user's server account, the previous
    //         user's progress renders as the new user's, and
    //         `db.meta.syncCursor` — still the previous user's watermark —
    //         makes `GET /sync?since=` skip everything of the new user's
    //         older than it, so their own history never downloads at all.
    //       - the in-memory half (`resetSessionScopedQueries()`): `['stats']`
    //         etc. still hold the previous user's numbers. It has to land
    //         before `setQueryData`, or it would wipe the seed.
    //
    //     `useLogout` goes through the same door on the way out.
    //
    // Only then: seed `me`. Seeding it directly rather than invalidating
    // and refetching is the original, still-valid reason — `<RequireAuth>`
    // on the target route reads `useMe` on the very next render, and a
    // refetch would leave it briefly back in its "pending" state
    // (rendering nothing) right after a successful login.
    stopSync();
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
    <div className="auth-page">
      <h1 className="ch-title">{t('login.title')}</h1>
      <p className="ch-lede">{t('login.lede')}</p>

      <div role="tablist" aria-label={t('login.tablist.aria')} className="seg auth-tabs">
        <button
          type="button"
          role="tab"
          id={loginTabId}
          aria-selected={tab === 'login'}
          aria-controls="auth-panel"
          className={tab === 'login' ? 'on' : undefined}
          onClick={() => setTab('login')}
        >
          {t('login.tab.login')}
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
          {t('login.tab.register')}
        </button>
      </div>

      <div role="tabpanel" id="auth-panel" aria-labelledby={tab === 'login' ? loginTabId : registerTabId}>
        {tab === 'login' ? <LoginForm onSuccess={handleAuthenticated} /> : <RegisterForm onSuccess={handleAuthenticated} />}
      </div>
    </div>
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
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor={passwordId}>{t('login.field.password')}</label>
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
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor={passwordId}>{t('login.field.password')}</label>
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
        {t(pending ? 'login.submit.registering' : 'login.submit.register')}
      </button>
    </form>
  );
}

export default Login;
