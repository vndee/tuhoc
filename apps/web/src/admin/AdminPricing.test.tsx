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
    max_signup_grant_micro: 10000000,
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

  // round-2 review, Minor 7: PricingRowEditor built its mutate() call
  // without ever reading the note input at all — every admin_audit row for
  // a pricing change carried only the server's auto-generated "rates set
  // to ..." summary, and an operator's actual REASON had nowhere to go.
  it('typing a per-row note sends it alongside the six rates; an untouched note field sends none at all', async () => {
    let bodyWithNote: unknown = null;
    serve([pricingRow()], settingsRow());
    server.use(
      http.put('/admin/ai/pricing/:model', async ({ request }) => {
        bodyWithNote = await request.json();
        return HttpResponse.json(pricingRow());
      }),
    );
    renderPage();
    await screen.findByTestId('pricing-model-deepseek-v4-pro');

    const user = userEvent.setup();
    await user.type(screen.getByTestId('pricing-note-deepseek-v4-pro'), 'raising the input rate for margin');
    await user.click(screen.getByTestId('pricing-save-deepseek-v4-pro'));

    await waitFor(() =>
      expect(bodyWithNote).toMatchObject({ note: 'raising the input rate for margin' }),
    );
  });

  it('the note field is cleared after a successful save, matching the credit-adjustment form’s own reset-on-success rule', async () => {
    serve([pricingRow()], settingsRow());
    server.use(http.put('/admin/ai/pricing/:model', () => HttpResponse.json(pricingRow())));
    renderPage();
    await screen.findByTestId('pricing-model-deepseek-v4-pro');

    const user = userEvent.setup();
    const noteInput = screen.getByTestId('pricing-note-deepseek-v4-pro');
    await user.type(noteInput, 'a reason');
    await user.click(screen.getByTestId('pricing-save-deepseek-v4-pro'));

    await screen.findByTestId('pricing-success-deepseek-v4-pro');
    expect(noteInput).toHaveValue('');
  });

  // round-2 review, Minor 2: `types.go`'s own doc comment on
  // `Pricing.UpdatedAt` says the CMS screen "shows it" — it did not, on
  // either the initial load OR after a save that changed it.
  it('renders updated_at, and reflects the NEW timestamp the server returns after a save', async () => {
    serve([pricingRow({ updated_at: '2026-08-28T10:00:00.000Z' })], settingsRow());
    server.use(
      http.put('/admin/ai/pricing/:model', () =>
        HttpResponse.json(pricingRow({ updated_at: '2026-08-29T11:30:00.000Z' })),
      ),
    );
    renderPage();

    expect(await screen.findByTestId('pricing-updated-at-deepseek-v4-pro')).toHaveTextContent('2026-08-28 10:00 UTC');

    const user = userEvent.setup();
    await user.click(screen.getByTestId('pricing-save-deepseek-v4-pro'));

    await waitFor(() =>
      expect(screen.getByTestId('pricing-updated-at-deepseek-v4-pro')).toHaveTextContent('2026-08-29 11:30 UTC'),
    );
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

  // round-2 review, Minor 8: the prior version of this test typed 44
  // characters against a cap of 10 — "way over", not "one over" — which
  // proves the warning CAN fire, but not that it fires at the EXACT
  // boundary. Mirrors the precision `TestUpdateBasePromptCharLimitBoundary`
  // (admin_handler_test.go, Go side) already pins: accepted at exactly the
  // cap, rejected at cap+1.
  it('accepts a prompt of exactly the SERVER-DECLARED cap, and rejects exactly one character over it — the cap is read from the server, never a hardcoded client number', async () => {
    serve([], settingsRow({ base_system_prompt: 'x', max_base_prompt_chars: 10 }));
    renderPage();
    await screen.findByTestId('admin-ai-prompt-textarea');

    const user = userEvent.setup();
    const textarea = screen.getByTestId('admin-ai-prompt-textarea');
    await user.clear(textarea);
    await user.type(textarea, 'a'.repeat(10));

    expect(screen.getByTestId('admin-ai-prompt-submit')).toBeEnabled();
    expect(screen.queryByTestId('admin-ai-prompt-too-long')).not.toBeInTheDocument();

    await user.type(textarea, 'a');

    expect(screen.getByTestId('admin-ai-prompt-submit')).toBeDisabled();
    expect(screen.getByTestId('admin-ai-prompt-too-long')).toHaveTextContent(t('settings.ai.promptTooLong'));
  });
});

/**
 * `signup_grant_micro` — ô nhập, đợt 2 của vòng sửa sau review tổng nhánh.
 *
 * Vòng sửa 1 (A1) cho `PUT /admin/ai/settings` NHẬN cột này, kèm kiểm biên,
 * audit riêng, và một giá trị seed ở migration `0008`. Thứ duy nhất còn
 * thiếu là ô nhập — nó cần khoá i18n mới, tức câu chữ người dùng, tức đợt
 * này. Hình dạng "cột có route nhưng không ai bấm được" là quan ngại số 1
 * của báo cáo đợt 1.
 */
describe('AdminPricing — credit tặng khi đăng ký', () => {
  it('ô nhập được gieo bằng giá trị máy chủ đang giữ, không phải một hằng của client', async () => {
    serve([], settingsRow({ signup_grant_micro: 777 }));
    renderPage();

    expect(await screen.findByTestId('admin-ai-grant-input')).toHaveValue('777');
    expect(screen.getByTestId('admin-ai-grant-hint')).toHaveTextContent(t('admin.ai.pricing.grantHint'));
  });

  /**
   * BÀI CHỊU LỰC của cả nhóm, và là lý do màn này gửi grant CÓ ĐIỀU KIỆN.
   *
   * `UpdateSettings` (credits.go) ghi một hàng `ai.settings.signup_grant`
   * mỗi khi trường CÓ MẶT trong request — không phải mỗi khi giá trị ĐỔI.
   * Một màn echo grant hiện tại ở mọi lần lưu prompt sẽ nộp một hàng audit
   * "set to 50000" cho mỗi lần sửa chữ, chôn vùi đúng những hàng ghi một
   * thay đổi chính sách thật.
   */
  it('lưu prompt mà KHÔNG đụng ô grant thì không gửi `signup_grant_micro` — vắng, không phải 0', async () => {
    let body: unknown = null;
    serve([], settingsRow({ base_system_prompt: 'old prompt', signup_grant_micro: 50000 }));
    server.use(
      http.put('/admin/ai/settings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(settingsRow({ base_system_prompt: 'old prompt!' }));
      }),
    );
    renderPage();
    await screen.findByTestId('admin-ai-prompt-textarea');

    const user = userEvent.setup();
    await user.type(screen.getByTestId('admin-ai-prompt-textarea'), '!');
    await user.click(screen.getByTestId('admin-ai-prompt-submit'));

    await waitFor(() => expect(body).not.toBeNull());
    expect(Object.keys(body as object)).not.toContain('signup_grant_micro');
  });

  it('đổi ô grant thì gửi con số mới, cùng một PUT với prompt nền', async () => {
    let body: unknown = null;
    serve([], settingsRow({ base_system_prompt: 'a prompt', signup_grant_micro: 50000 }));
    server.use(
      http.put('/admin/ai/settings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(settingsRow({ signup_grant_micro: 120000 }));
      }),
    );
    renderPage();
    await screen.findByTestId('admin-ai-grant-input');

    const user = userEvent.setup();
    const input = screen.getByTestId('admin-ai-grant-input');
    await user.clear(input);
    await user.type(input, '120000');
    await user.type(screen.getByTestId('admin-ai-prompt-note-input'), 'tăng grant');
    await user.click(screen.getByTestId('admin-ai-prompt-submit'));

    await waitFor(() =>
      expect(body).toEqual({ base_system_prompt: 'a prompt', note: 'tăng grant', signup_grant_micro: 120000 }),
    );
    expect(await screen.findByTestId('admin-ai-grant-input')).toHaveValue('120000');
  });

  it('MỘT SỐ 0 CÓ CHỦ Ý vẫn đi được — tắt grant là một lựa chọn hợp lệ, không phải một lỗi', async () => {
    let body: unknown = null;
    serve([], settingsRow({ base_system_prompt: 'a prompt', signup_grant_micro: 50000 }));
    server.use(
      http.put('/admin/ai/settings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(settingsRow({ signup_grant_micro: 0 }));
      }),
    );
    renderPage();
    await screen.findByTestId('admin-ai-grant-input');

    const user = userEvent.setup();
    const input = screen.getByTestId('admin-ai-grant-input');
    await user.clear(input);
    await user.type(input, '0');
    await user.click(screen.getByTestId('admin-ai-prompt-submit'));

    await waitFor(() => expect(body).toMatchObject({ signup_grant_micro: 0 }));
  });

  /**
   * TRẦN ĐỌC TỪ SERVER, không gõ lại — cùng luật `max_pricing_rate_micro`
   * và `max_base_prompt_chars` đã theo. Con số trong bài cố ý NHỎ và LẺ
   * (5000) để một client lén dùng hằng `MaxSignupGrantMicro` thật
   * (10.000.000) sẽ cho ô 5001 đi qua và bài này ĐỎ.
   */
  it('từ chối đúng ở trần MÁY CHỦ khai, và cho qua đúng ở trần ấy', async () => {
    serve([], settingsRow({ signup_grant_micro: 1, max_signup_grant_micro: 5000 }));
    renderPage();
    await screen.findByTestId('admin-ai-grant-input');

    const user = userEvent.setup();
    const input = screen.getByTestId('admin-ai-grant-input');
    await user.clear(input);
    await user.type(input, '5000');

    expect(screen.getByTestId('admin-ai-prompt-submit')).toBeEnabled();
    expect(screen.queryByTestId('admin-ai-grant-invalid')).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '5001');

    expect(screen.getByTestId('admin-ai-prompt-submit')).toBeDisabled();
    expect(screen.getByTestId('admin-ai-grant-invalid')).toHaveTextContent(
      t('admin.ai.pricing.grantInvalid', '5000'),
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('một ô không phải số nguyên ("abc", "-1", "1.5") chặn nút Lưu', async () => {
    serve([], settingsRow());
    renderPage();
    await screen.findByTestId('admin-ai-grant-input');

    const user = userEvent.setup();
    const input = screen.getByTestId('admin-ai-grant-input');
    for (const bad of ['abc', '-1', '1.5']) {
      await user.clear(input);
      await user.type(input, bad);
      expect(screen.getByTestId('admin-ai-prompt-submit')).toBeDisabled();
    }
  });
});

/**
 * D1 của review tổng nhánh, nửa CLIENT.
 *
 * Máy chủ nay từ chối mọi đơn giá vượt `max_pricing_rate_micro`
 * (`MaxPricingRateMicro`, admin_handler.go). Màn này phải từ chối TRƯỚC —
 * cùng lý do `AgentConfigPanel.tsx` đã giữ cho `max_system_prompt_chars`:
 * "TRẦN LÀ CỦA SERVER, KỂ CẢ Ở CLIENT". Con số được ĐỌC TỪ RESPONSE, không
 * gõ lại thành hằng thứ hai ở đây — một bản sao gõ tay là đúng thứ sẽ lệch
 * lần tới ai đó đổi hằng ở Go.
 *
 * Hình dạng từ chối khớp CHÍNH XÁC hình dạng đã có cho một ô số hỏng ("abc",
 * "-1"): nút Lưu tắt. Không thêm câu chữ mới ở vòng này — câu chữ người dùng
 * thuộc đợt 2 — nhưng ô sai được đánh dấu `aria-invalid` để người dùng bàn
 * phím/đọc màn hình biết ô NÀO sai, thay vì một nút tắt không giải thích.
 */
describe('AdminPricing — trần đơn giá (D1)', () => {
  it('một đơn giá vượt max_pricing_rate_micro làm tắt nút Lưu và đánh dấu đúng ô', async () => {
    const user = userEvent.setup();
    serve([pricingRow()], settingsRow({ max_pricing_rate_micro: 1_000_000_000 }));
    renderPage();

    const field = await screen.findByTestId('pricing-credits-out-deepseek-v4-pro');
    const save = screen.getByTestId('pricing-save-deepseek-v4-pro');
    expect(save).toBeEnabled();

    await user.clear(field);
    await user.type(field, '1000000001'); // trần + 1
    expect(save).toBeDisabled();
    expect(field).toHaveAttribute('aria-invalid', 'true');

    // Đúng bằng trần thì hợp lệ — biên phải mở ở đúng con số server chấp nhận.
    await user.clear(field);
    await user.type(field, '1000000000');
    expect(save).toBeEnabled();
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('trần đến TỪ server, không phải một hằng gõ lại trong tệp này', async () => {
    const user = userEvent.setup();
    // Một trần cố ý nhỏ và "không tròn": nếu màn này dùng hằng riêng thì
    // 5001 sẽ được coi là hợp lệ và bài kiểm đỏ.
    serve([pricingRow()], settingsRow({ max_pricing_rate_micro: 5000 }));
    renderPage();

    const field = await screen.findByTestId('pricing-cost-in-deepseek-v4-pro');
    const save = screen.getByTestId('pricing-save-deepseek-v4-pro');

    await user.clear(field);
    await user.type(field, '5001');
    expect(save).toBeDisabled();

    await user.clear(field);
    await user.type(field, '5000');
    expect(save).toBeEnabled();
  });
});
