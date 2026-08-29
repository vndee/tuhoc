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
 * FIXTURE ĐÔI MỘT KHÁC NHAU — bài học của 14 task trước, dẫn lại trong chỉ
 * thị vòng review Task 14: một fixture đặt hai trường bằng nhau làm một phép
 * hoán vị giữa chúng vô hình. Mọi con số dưới đây — số dư và TỪNG trường của
 * TỪNG dòng sổ dùng, KỂ CẢ giữa hai dòng — khác nhau đôi một (không còn cặp
 * `tool_calls = web_searches = 0` của bản trước — vòng review 1 bắt đúng:
 * đó là MỘT cặp trùng, và báo cáo khi ấy tự nhận "không hai trường nào
 * trùng" trong khi chính fixture ngay bên dưới nó có).
 *
 * VÀ PHÉP KHẲNG ĐỊNH PHẢI KHỚP VỚI Ý ĐỊNH ẤY (vòng review 1, Important 3):
 * `toHaveTextContent(str)` là so khớp CHUỖI CON, không phải so khớp bằng.
 * `expect(cell).toHaveTextContent('2')` được thoả bởi CHÍNH Ô chứa `'1200'`,
 * `'450'`, hay `'0,0175'` — tức fixture đôi-một-khác-nhau không bảo vệ được
 * gì nếu phép so vẫn là "chứa", vì số nhỏ gần như luôn là chuỗi con của một
 * số khác trong bảng. Mọi ô số nguyên dưới đây dùng regex neo hai đầu
 * (`/^…$/`) hoặc so `.textContent` bằng `toBe` — cả hai đều là so khớp TOÀN
 * PHẦN, nên một đột biến đảo cột chỉ còn cách trùng bằng đúng giá trị của
 * chính ô đối diện, điều fixture đôi-một-khác-nhau vừa loại trừ.
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
      tool_calls: 3,
      web_searches: 5,
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
    //
    // `toBe`, không `toHaveTextContent` (so khớp CHUỖI CON — "18,24" hay
    // "8,243" cũng "chứa" "8,24"): ô này không có gì khác để lẫn vào, nhưng
    // giữ cùng kỷ luật so khớp TOÀN PHẦN với mọi ô số khác trong tệp này.
    await waitFor(() => {
      expect(screen.getByTestId('credit-balance').textContent).toBe('8,24');
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

    /**
     * VÒNG SỬA 1 (Important 3): `toHaveTextContent(str)` là so khớp CHUỖI
     * CON — bản trước bị chính bảng "đôi một khác nhau" của mình phản: ô
     * `usage-tools-0` (kỳ vọng `'2'`) cũng "chứa" được bởi số `'1200'` của
     * MỘT Ô KHÁC nếu đột biến đảo cột, vì `toHaveTextContent` không đọc từ
     * đúng ô — nó chỉ kiểm ô ĐƯỢC TRUYỀN VÀO có chứa chuỗi đó không, và một
     * đột biến ghi `entry.outTokens` vào ô `usage-in-0` vẫn "chứa" được số
     * nào đó tình cờ trùng một hậu tố. Đo cụ thể: ô `usage-tools-1` (kỳ vọng
     * `'0'` ở bản cũ) được thoả bởi CHÍNH GIÁ TRỊ SAI `800`/`150`/`220`/
     * `0,0175` — bất kỳ chuỗi nào chứa ký tự `'0'`. `.textContent` so bằng
     * `toBe` là so khớp TOÀN PHẦN; không chuỗi nào "gần đúng" lọt qua được.
     */
    const cell = (testId: string) => screen.getByTestId(testId).textContent;

    // Dòng 0 (deepseek-v4-pro): mọi số khác dòng 1 và khác số dư.
    expect(cell('usage-model-0')).toBe('deepseek-v4-pro');
    expect(cell('usage-in-0')).toBe('1200');
    expect(cell('usage-cached-0')).toBe('300');
    expect(cell('usage-out-0')).toBe('450');
    expect(cell('usage-tools-0')).toBe('2');
    expect(cell('usage-search-0')).toBe('1');
    // 63_000 micro-credit = 0,063 credit.
    expect(cell('usage-credits-0')).toBe('0,063');

    // Dòng 1 (deepseek-v4-flash): bộ số HOÀN TOÀN khác dòng 0 — kể cả
    // `tool_calls`/`web_searches` (3/5), không còn cặp `0/0` của bản trước.
    expect(cell('usage-model-1')).toBe('deepseek-v4-flash');
    expect(cell('usage-in-1')).toBe('800');
    expect(cell('usage-cached-1')).toBe('150');
    expect(cell('usage-out-1')).toBe('220');
    expect(cell('usage-tools-1')).toBe('3');
    expect(cell('usage-search-1')).toBe('5');
    expect(cell('usage-credits-1')).toBe('0,0175');
  });

  it('thời điểm mỗi dòng đọc từ ĐÚNG trường `at` của dòng đó, định dạng UTC ổn định', async () => {
    mockCredits();
    render(wrap(<CreditPanel />));
    await screen.findByTestId('usage-model-0');

    // Chuỗi TOÀN PHẦN (kể cả hậu tố "UTC"), không phải một tiền tố ngày —
    // cùng kỷ luật so khớp bằng `toBe` áp cho các ô còn lại trong tệp này.
    expect(screen.getByTestId('usage-when-0').textContent).toBe('2026-08-20 09:15 UTC');
    expect(screen.getByTestId('usage-when-1').textContent).toBe('2026-08-19 14:02 UTC');
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
