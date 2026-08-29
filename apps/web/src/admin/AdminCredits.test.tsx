import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../api/navigation', () => ({
  redirectToLogin: vi.fn(),
}));

import { t as lookup, type Translate } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { AdminCredits } from './AdminCredits';

const t: Translate = (key, ...args) => lookup('vi', key, ...args);

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function userRow(over: Record<string, unknown> = {}) {
  return { id: 'u-1111', email: 'hoc@vidu.test', role: 'user', balance_micro: 733100, ...over };
}

function userDetail(over: Record<string, unknown> = {}) {
  return {
    ...userRow(),
    recent_usage: [],
    recent_adjustments: [],
    ...over,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <AdminCredits />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

/** Every render of this screen fires a GET on mount (empty query = first page). */
function serveInitialList(rows: unknown[]) {
  server.use(http.get('/admin/ai/users', () => HttpResponse.json(rows)));
}

describe('AdminCredits — search results', () => {
  it('renders email, role, and the balance in CREDITS (not raw micro)', async () => {
    serveInitialList([userRow()]);
    renderPage();

    expect(await screen.findByText('hoc@vidu.test')).toBeInTheDocument();
    // 733100 micro-credit -> 0.7331 credit, exactly — this is the number
    // that would leak straight through if formatCredits were ever dropped.
    expect(screen.getByTestId('ai-user-balance-u-1111')).toHaveTextContent('0,7331');
  });

  it('an empty result set shows the empty-state sentence, not a blank table', async () => {
    serveInitialList([]);
    renderPage();
    expect(await screen.findByTestId('admin-ai-users-empty')).toHaveTextContent(t('admin.ai.credits.empty'));
  });

  it('typing and submitting the search box re-queries with ?q=<the typed text>', async () => {
    let lastSearch = '';
    server.use(
      http.get('/admin/ai/users', ({ request }) => {
        lastSearch = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    renderPage();
    await screen.findByTestId('admin-ai-users-empty');

    const user = userEvent.setup();
    await user.type(screen.getByTestId('admin-ai-search-input'), 'hoc@vidu.test');
    await user.click(screen.getByRole('button', { name: t('admin.ai.credits.searchButton') }));

    await waitFor(() => expect(lastSearch).toBe(`?q=${encodeURIComponent('hoc@vidu.test')}`));
  });
});

describe('AdminCredits — chọn người dùng, xem chi tiết', () => {
  it('selecting a row loads and shows that user’s balance, usage, and adjustment history', async () => {
    serveInitialList([userRow()]);
    server.use(
      http.get('/admin/ai/users/:id', () =>
        HttpResponse.json(
          userDetail({
            balance_micro: 1148400,
            recent_usage: [
              {
                at: '2026-08-28T09:00:00Z',
                model: 'deepseek-v4-pro',
                in_tokens: 100,
                cached_in_tokens: 0,
                out_tokens: 50,
                tool_calls: 0,
                web_searches: 0,
                credits_charged: 200,
              },
            ],
            recent_adjustments: [{ at: '2026-08-28T08:00:00Z', who: 'admin-uuid', note: '+415300 micro-credit: top-up' }],
          }),
        ),
      ),
    );
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t('admin.ai.credits.selectButton') }));

    expect(await screen.findByTestId('admin-ai-detail-email')).toHaveTextContent('hoc@vidu.test');
    expect(screen.getByTestId('admin-ai-detail-balance')).toHaveTextContent('1,1484');
    expect(screen.getByText('deepseek-v4-pro')).toBeInTheDocument();
    expect(screen.getByTestId('admin-ai-adjustment-note-0')).toHaveTextContent('+415300 micro-credit: top-up');
  });

  it('a user with no usage and no adjustments shows both empty-state sentences', async () => {
    serveInitialList([userRow()]);
    server.use(http.get('/admin/ai/users/:id', () => HttpResponse.json(userDetail())));
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t('admin.ai.credits.selectButton') }));

    expect(await screen.findByTestId('admin-ai-usage-empty')).toBeInTheDocument();
    expect(screen.getByTestId('admin-ai-adjustments-empty')).toBeInTheDocument();
  });
});

describe('AdminCredits — cộng/trừ credit tay', () => {
  async function selectUser() {
    serveInitialList([userRow()]);
    server.use(http.get('/admin/ai/users/:id', () => HttpResponse.json(userDetail())));
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t('admin.ai.credits.selectButton') }));
    await screen.findByTestId('admin-ai-detail-email');
    return user;
  }

  it('the submit button stays disabled until BOTH an amount and a note are filled in', async () => {
    const user = await selectUser();
    const submit = screen.getByTestId('admin-ai-adjust-submit');
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId('admin-ai-amount-input'), '50');
    expect(submit).toBeDisabled(); // amount alone is not enough

    await user.type(screen.getByTestId('admin-ai-note-input'), 'top-up');
    expect(submit).toBeEnabled();
  });

  it('an amount of "0" (or blank) never enables the submit button, even with a note', async () => {
    const user = await selectUser();
    await user.type(screen.getByTestId('admin-ai-amount-input'), '0');
    await user.type(screen.getByTestId('admin-ai-note-input'), 'a note');
    expect(screen.getByTestId('admin-ai-adjust-submit')).toBeDisabled();
  });

  it('"Cộng" sends a POSITIVE delta_micro, converted from credits to micro-credit', async () => {
    let body: unknown = null;
    const user = await selectUser();
    server.use(
      http.post('/admin/ai/users/:id/credit', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ balance_micro: 1148400 });
      }),
    );

    await user.type(screen.getByTestId('admin-ai-amount-input'), '50');
    await user.type(screen.getByTestId('admin-ai-note-input'), 'top-up for ticket #1');
    await user.click(screen.getByTestId('admin-ai-adjust-submit'));

    await waitFor(() => expect(body).toEqual({ delta_micro: 50_000_000, note: 'top-up for ticket #1' }));
  });

  it('"Trừ" sends a NEGATIVE delta_micro of the same magnitude', async () => {
    let body: unknown = null;
    const user = await selectUser();
    server.use(
      http.post('/admin/ai/users/:id/credit', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ balance_micro: 683100 });
      }),
    );

    await user.type(screen.getByTestId('admin-ai-amount-input'), '50');
    await user.selectOptions(screen.getByTestId('admin-ai-direction-select'), 'subtract');
    await user.type(screen.getByTestId('admin-ai-note-input'), 'correction');
    await user.click(screen.getByTestId('admin-ai-adjust-submit'));

    await waitFor(() => expect(body).toEqual({ delta_micro: -50_000_000, note: 'correction' }));
  });

  it('on success, the amount and note fields are CLEARED and a success message appears', async () => {
    const user = await selectUser();
    server.use(http.post('/admin/ai/users/:id/credit', () => HttpResponse.json({ balance_micro: 1148400 })));

    await user.type(screen.getByTestId('admin-ai-amount-input'), '50');
    await user.type(screen.getByTestId('admin-ai-note-input'), 'top-up');
    await user.click(screen.getByTestId('admin-ai-adjust-submit'));

    await screen.findByTestId('admin-ai-adjust-success');
    expect(screen.getByTestId('admin-ai-amount-input')).toHaveValue('');
    expect(screen.getByTestId('admin-ai-note-input')).toHaveValue('');
    // Cleared fields also mean the button goes back to disabled — a second
    // bare click cannot resubmit the same adjustment.
    expect(screen.getByTestId('admin-ai-adjust-submit')).toBeDisabled();
  });

  it('a server rejection (e.g. amount over the ceiling) renders the mapped sentence, EXACTLY — never a raw server string', async () => {
    const user = await selectUser();
    server.use(
      http.post('/admin/ai/users/:id/credit', () =>
        HttpResponse.json({ code: 'AmountOutOfRange', error: 'delta_micro must be within +/-100000000000' }, { status: 400 }),
      ),
    );

    await user.type(screen.getByTestId('admin-ai-amount-input'), '999999999');
    await user.type(screen.getByTestId('admin-ai-note-input'), 'a huge amount');
    await user.click(screen.getByTestId('admin-ai-adjust-submit'));

    const error = await screen.findByTestId('admin-ai-adjust-error');
    expect(error).toHaveTextContent(t('admin.ai.error.amountOutOfRange'));
    // NOT the raw server sentence — the whole point of the code-based mapping.
    expect(error.textContent).not.toContain('within +/-');
  });
});
