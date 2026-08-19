import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { meQueryKey } from '../api/useMe';
import { Login } from './Login';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderLogin(initialEntry: { pathname: string; state?: unknown } | string = '/login') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Home dashboard</div>} />
          <Route path="/c/:courseId/:chapterId" element={<div>Chapter content</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { queryClient };
}

describe('Login page', () => {
  it('shows the sign-in form by default, and switches to the register form on the register tab', async () => {
    const user = userEvent.setup();
    renderLogin();

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
    const { queryClient } = renderLogin();

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
    renderLogin({ pathname: '/login', state: { from: { pathname: '/c/demo/c1', search: '', hash: '' } } });

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
    renderLogin();

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
    renderLogin();

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
    renderLogin();

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
    const { queryClient } = renderLogin();

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
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/mật khẩu/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('tab', { name: /đăng ký/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
