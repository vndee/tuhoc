import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { CreditPanel } from './CreditPanel';

/**
 * `CreditPanel` — nửa ĐẦU của mục Trợ lý AI sau khi khung kho khoá bị bỏ
 * (task-14-brief.md). Nó thay hẳn chỗ trước đây là một `<iframe>`: đọc
 * `GET /ai/credits` (`apps/api/internal/ai/handler.go`'s `Credits`) và vẽ số
 * dư cộng sổ dùng gần đây (`recent_usage`).
 *
 * HÌNH DẠNG DÂY, đo từ `creditsResponse`/`usageEntryPayload` (`handler.go`):
 *
 *   { balance_micro: int64,
 *     recent_usage: [{ at, model, in_tokens, cached_in_tokens, out_tokens,
 *                       tool_calls, web_searches, credits_charged }] }
 *
 * `credits_charged` KHÔNG mang hậu tố `_micro` trong tên cột, nhưng nó CÙNG
 * đơn vị với `balance_micro` — đo được ở `credits.go`'s `ChargeTurn`:
 * `credits` (giá trị `Charge()` trả) bị TRỪ THẲNG vào `balance_micro` không
 * qua quy đổi nào (`UPDATE ai_credits SET balance_micro = balance_micro -
 * $2 ... credits_charged) VALUES (..., credits)`), nên cả hai phải cùng
 * thang đo. `formatCredits` áp dụng như nhau cho cả hai.
 *
 * FIXTURE ĐÔI MỘT KHÁC NHAU — bài học của 14 task trước (task-14-brief.md
 * mục "Bài học phương pháp"): một fixture đặt hai trường bằng nhau làm một
 * phép hoán vị giữa chúng vô hình. Mọi con số dưới đây — số dư và TỪNG
 * trường của TỪNG dòng sổ dùng — khác nhau đôi một, nên một đột biến đảo
 * `in_tokens`/`out_tokens`, hay vẽ `credits_charged` của dòng này vào dòng
 * kia, phải làm đúng MỘT bài đỏ, không phải 0 bài.
 */

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(node: ReactNode): ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{node}</LanguageProvider>
    </QueryClientProvider>
  );
}

const CREDITS_FIXTURE = {
  balance_micro: 8_240_000,
  recent_usage: [
    {
      at: '2026-08-20T09:15:00Z',
      model: 'deepseek-v4-pro',
      in_tokens: 1200,
      cached_in_tokens: 300,
      out_tokens: 450,
      tool_calls: 2,
      web_searches: 1,
      credits_charged: 63_000,
    },
    {
      at: '2026-08-19T14:02:00Z',
      model: 'deepseek-v4-flash',
      in_tokens: 800,
      cached_in_tokens: 150,
      out_tokens: 220,
      tool_calls: 0,
      web_searches: 0,
      credits_charged: 17_500,
    },
  ],
};

function mockCredits(body: JsonBodyType = CREDITS_FIXTURE, status = 200): void {
  server.use(http.get('/ai/credits', () => HttpResponse.json(body, { status })));
}

describe('CreditPanel — số dư và sổ dùng gần đây', () => {
  it('vẽ số dư ĐÚNG bằng balance_micro / 1_000_000, không phải một trường khác', async () => {
    mockCredits();
    render(wrap(<CreditPanel />));

    // 8_240_000 micro-credit = 8,24 credit. `findByTestId` chỉ chờ phần tử
    // TỒN TẠI — nó có mặt ngay cả lúc còn hiện "—" (chưa tải xong) — nên
    // đợi ĐÚNG nội dung bằng `waitFor` mới bắt được lúc dữ liệu đã tới.
    await waitFor(() => {
      expect(screen.getByTestId('credit-balance')).toHaveTextContent('8,24');
    });
  });

  it('mỗi dòng sổ dùng vẽ ĐÚNG trường của chính nó — không dòng nào lẫn số của dòng khác', async () => {
    mockCredits();
    render(wrap(<CreditPanel />));

    // `findByTestId` chờ tới khi PHẦN TỬ xuất hiện — `usage-model-0` chỉ
    // được vẽ SAU khi `query.data` đã có, nên chờ nó (không phải
    // `credit-balance`, thứ có mặt ngay cả lúc còn "—") là chờ đúng tín
    // hiệu "đã tải xong".
    await screen.findByTestId('usage-model-0');

    // Dòng 0 (deepseek-v4-pro): mọi số khác dòng 1 và khác số dư.
    expect(screen.getByTestId('usage-model-0')).toHaveTextContent('deepseek-v4-pro');
    expect(screen.getByTestId('usage-in-0')).toHaveTextContent('1200');
    expect(screen.getByTestId('usage-cached-0')).toHaveTextContent('300');
    expect(screen.getByTestId('usage-out-0')).toHaveTextContent('450');
    expect(screen.getByTestId('usage-tools-0')).toHaveTextContent('2');
    expect(screen.getByTestId('usage-search-0')).toHaveTextContent('1');
    // 63_000 micro-credit = 0,063 credit.
    expect(screen.getByTestId('usage-credits-0')).toHaveTextContent('0,063');

    // Dòng 1 (deepseek-v4-flash): bộ số HOÀN TOÀN khác dòng 0.
    expect(screen.getByTestId('usage-model-1')).toHaveTextContent('deepseek-v4-flash');
    expect(screen.getByTestId('usage-in-1')).toHaveTextContent('800');
    expect(screen.getByTestId('usage-cached-1')).toHaveTextContent('150');
    expect(screen.getByTestId('usage-out-1')).toHaveTextContent('220');
    expect(screen.getByTestId('usage-tools-1')).toHaveTextContent('0');
    expect(screen.getByTestId('usage-search-1')).toHaveTextContent('0');
    expect(screen.getByTestId('usage-credits-1')).toHaveTextContent('0,0175');
  });

  it('thời điểm mỗi dòng đọc từ ĐÚNG trường `at` của dòng đó, định dạng UTC ổn định', async () => {
    mockCredits();
    render(wrap(<CreditPanel />));
    await screen.findByTestId('usage-model-0');

    expect(screen.getByTestId('usage-when-0')).toHaveTextContent('2026-08-20 09:15');
    expect(screen.getByTestId('usage-when-1')).toHaveTextContent('2026-08-19 14:02');
  });

  it('sổ dùng RỖNG nói ra điều đó, không hiện một bảng trắng không giải thích', async () => {
    mockCredits({ balance_micro: 0, recent_usage: [] });
    render(wrap(<CreditPanel />));

    // Cùng lý do trên: chờ chính thông báo rỗng, thứ chỉ vẽ SAU khi tải
    // xong — không chờ `credit-balance`, thứ có mặt ngay cả lúc "—".
    expect(await screen.findByTestId('credit-usage-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('usage-model-0')).toBeNull();
  });

  it('lỗi máy chủ (500) hiện một câu — không phải một khối trắng không lời giải thích', async () => {
    mockCredits({ code: 'Internal', error: 'boom' }, 500);
    render(wrap(<CreditPanel />));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
