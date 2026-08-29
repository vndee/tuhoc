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
import { AdminPricing } from './AdminPricing';

const t: Translate = (key, ...args) => lookup('vi', key, ...args);

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function pricingRow(over: Record<string, unknown> = {}) {
  return {
    model: 'deepseek-v4-pro',
    cost_micro_per_1k_in: 1320,
    cost_micro_per_1k_cached_in: 44,
    cost_micro_per_1k_out: 3960,
    credits_per_1k_in: 1320,
    credits_per_1k_cached_in: 44,
    credits_per_1k_out: 3960,
    updated_at: '2026-08-28T10:00:00.000Z',
    ...over,
  };
}

function settingsRow(over: Record<string, unknown> = {}) {
  return {
    base_system_prompt: 'You are a patient tutor.',
    credits_per_web_search: 700,
    cost_micro_per_web_search: 250,
    signup_grant_micro: 50000,
    max_tokens_per_turn: 8192,
    max_tool_rounds_per_turn: 6,
    max_base_prompt_chars: 20000,
    ...over,
  };
}

function serve(pricing: unknown[], settings: Record<string, unknown>) {
  server.use(
    http.get('/admin/ai/pricing', () => HttpResponse.json(pricing)),
    http.get('/admin/ai/settings', () => HttpResponse.json(settings)),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <AdminPricing />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('AdminPricing — bảng quy đổi credit', () => {
  it('renders one row per model, pre-filled with the SIX current rates', async () => {
    serve([pricingRow()], settingsRow());
    renderPage();

    expect(await screen.findByTestId('pricing-model-deepseek-v4-pro')).toHaveTextContent('deepseek-v4-pro');
    expect(screen.getByTestId('pricing-cost-in-deepseek-v4-pro')).toHaveValue('1320');
    expect(screen.getByTestId('pricing-cost-cached-deepseek-v4-pro')).toHaveValue('44');
    expect(screen.getByTestId('pricing-cost-out-deepseek-v4-pro')).toHaveValue('3960');
    expect(screen.getByTestId('pricing-credits-in-deepseek-v4-pro')).toHaveValue('1320');
    expect(screen.getByTestId('pricing-credits-cached-deepseek-v4-pro')).toHaveValue('44');
    expect(screen.getByTestId('pricing-credits-out-deepseek-v4-pro')).toHaveValue('3960');
  });

  it('editing one rate and saving sends all SIX current values, not just the changed one', async () => {
    let body: unknown = null;
    serve([pricingRow()], settingsRow());
    server.use(
      http.put('/admin/ai/pricing/:model', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(pricingRow({ credits_per_1k_in: 4170 }));
      }),
    );
    renderPage();
    await screen.findByTestId('pricing-model-deepseek-v4-pro');

    const user = userEvent.setup();
    const creditsIn = screen.getByTestId('pricing-credits-in-deepseek-v4-pro');
    await user.clear(creditsIn);
    await user.type(creditsIn, '4170');
    await user.click(screen.getByTestId('pricing-save-deepseek-v4-pro'));

    await waitFor(() =>
      expect(body).toEqual({
        cost_micro_per_1k_in: 1320,
        cost_micro_per_1k_cached_in: 44,
        cost_micro_per_1k_out: 3960,
        credits_per_1k_in: 4170,
        credits_per_1k_cached_in: 44,
        credits_per_1k_out: 3960,
      }),
    );
    expect(await screen.findByTestId('pricing-success-deepseek-v4-pro')).toHaveTextContent(t('admin.ai.pricing.saved'));
  });

  it('an empty or non-numeric rate field disables ONLY that row’s Save button', async () => {
    serve([pricingRow(), pricingRow({ model: 'deepseek-v4-flash', cost_micro_per_1k_in: 440 })], settingsRow());
    renderPage();
    await screen.findByTestId('pricing-model-deepseek-v4-pro');

    const user = userEvent.setup();
    const proSave = screen.getByTestId('pricing-save-deepseek-v4-pro');
    const flashSave = screen.getByTestId('pricing-save-deepseek-v4-flash');
    expect(proSave).toBeEnabled();
    expect(flashSave).toBeEnabled();

    await user.clear(screen.getByTestId('pricing-cost-in-deepseek-v4-pro'));
    await user.type(screen.getByTestId('pricing-cost-in-deepseek-v4-pro'), 'not-a-number');

    expect(proSave).toBeDisabled();
    expect(flashSave).toBeEnabled(); // untouched sibling row is unaffected
  });

  it('a negative-rate rejection from the server renders the mapped sentence for THAT row only', async () => {
    serve([pricingRow()], settingsRow());
    server.use(
      http.put('/admin/ai/pricing/:model', () =>
        HttpResponse.json({ code: 'AmountOutOfRange', error: 'credits_per_1k_in must not be negative' }, { status: 400 }),
      ),
    );
    renderPage();
    await screen.findByTestId('pricing-model-deepseek-v4-pro');

    const user = userEvent.setup();
    await user.click(screen.getByTestId('pricing-save-deepseek-v4-pro'));

    const error = await screen.findByTestId('pricing-error-deepseek-v4-pro');
    expect(error).toHaveTextContent(t('admin.ai.error.amountOutOfRange'));
  });
});

describe('AdminPricing — prompt nền', () => {
  it('pre-fills the textarea with the current base_system_prompt and shows the char counter', async () => {
    serve([], settingsRow({ base_system_prompt: 'the current base prompt' }));
    renderPage();

    const textarea = await screen.findByTestId('admin-ai-prompt-textarea');
    expect(textarea).toHaveValue('the current base prompt');
    expect(screen.getByTestId('admin-ai-prompt-counter')).toHaveTextContent(
      t('settings.ai.promptCounter', String('the current base prompt'.length), '20000'),
    );
  });

  it('clearing the textarea to empty disables Save and shows the empty-prompt warning — it can NEVER be submitted', async () => {
    serve([], settingsRow({ base_system_prompt: 'something' }));
    renderPage();
    await screen.findByTestId('admin-ai-prompt-textarea');

    const user = userEvent.setup();
    await user.clear(screen.getByTestId('admin-ai-prompt-textarea'));

    expect(screen.getByTestId('admin-ai-prompt-submit')).toBeDisabled();
    expect(screen.getByTestId('admin-ai-prompt-empty-warning')).toHaveTextContent(t('admin.ai.pricing.promptEmptyWarning'));
  });

  it('a whitespace-only textarea ALSO disables Save — trimmed emptiness, not merely `=== ""`', async () => {
    serve([], settingsRow({ base_system_prompt: 'something' }));
    renderPage();
    await screen.findByTestId('admin-ai-prompt-textarea');

    const user = userEvent.setup();
    const textarea = screen.getByTestId('admin-ai-prompt-textarea');
    await user.clear(textarea);
    await user.type(textarea, '   ');

    expect(screen.getByTestId('admin-ai-prompt-submit')).toBeDisabled();
  });

  it('saving sends {base_system_prompt, note} and shows the saved sentence on success', async () => {
    let body: unknown = null;
    serve([], settingsRow({ base_system_prompt: 'old prompt' }));
    server.use(
      http.put('/admin/ai/settings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(settingsRow({ base_system_prompt: 'old prompt, plus a new rule' }));
      }),
    );
    renderPage();
    await screen.findByTestId('admin-ai-prompt-textarea');

    const user = userEvent.setup();
    await user.type(screen.getByTestId('admin-ai-prompt-textarea'), ', plus a new rule');
    await user.type(screen.getByTestId('admin-ai-prompt-note-input'), 'adding a rule');
    await user.click(screen.getByTestId('admin-ai-prompt-submit'));

    await waitFor(() =>
      expect(body).toEqual({ base_system_prompt: 'old prompt, plus a new rule', note: 'adding a rule' }),
    );
    expect(await screen.findByTestId('admin-ai-prompt-success')).toHaveTextContent(t('admin.ai.pricing.saved'));
  });

  it('typing past the SERVER-DECLARED cap (max_base_prompt_chars) disables Save and warns — the cap is read from the server, never a hardcoded client number', async () => {
    serve([], settingsRow({ base_system_prompt: 'x', max_base_prompt_chars: 10 }));
    renderPage();
    await screen.findByTestId('admin-ai-prompt-textarea');

    const user = userEvent.setup();
    const textarea = screen.getByTestId('admin-ai-prompt-textarea');
    await user.clear(textarea);
    await user.type(textarea, 'this is definitely more than ten characters');

    expect(screen.getByTestId('admin-ai-prompt-submit')).toBeDisabled();
    expect(screen.getByTestId('admin-ai-prompt-too-long')).toHaveTextContent(t('settings.ai.promptTooLong'));
  });
});
