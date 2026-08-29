import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Lang } from '../i18n';
import { useLanguage } from '../i18n/LanguageProvider';

/**
 * `CreditPanel` — nửa ĐẦU của mục Trợ lý AI trong Cài đặt, Pha 2
 * (task-14-brief.md). Nó thay hẳn chỗ trước đây là một `<iframe>` kho khoá:
 * không còn key nào để cắm, chỉ còn SỐ DƯ credit của tài khoản và SỔ DÙNG gần
 * đây — cả hai đọc từ `GET /ai/credits`.
 *
 * HÌNH DẠNG DÂY, đo từ `creditsResponse`/`usageEntryPayload`
 * (`apps/api/internal/ai/handler.go`), KHÔNG đoán tên trường:
 *
 *   { balance_micro: int64,
 *     recent_usage: [{ at, model, in_tokens, cached_in_tokens, out_tokens,
 *                       tool_calls, web_searches, credits_charged }] }
 *
 * ĐƠN VỊ: `balance_micro` là micro-credit (1 credit = 1_000_000 micro). Điều
 * KHÔNG hiển nhiên từ tên trường: `credits_charged` KHÔNG mang hậu tố
 * `_micro`, nhưng nó CÙNG THANG ĐO — đo được ở `credits.go`'s `ChargeTurn`:
 * `credits` (giá trị `Charge()` trả) bị TRỪ THẲNG vào `balance_micro`, không
 * qua một phép quy đổi nào (`UPDATE ai_credits SET balance_micro =
 * balance_micro - $2 ...`, cùng giá trị ấy ghi vào cột `credits_charged`).
 * Hai chỗ dùng CÙNG MỘT hàm `formatCredits` bên dưới vì lý do đó.
 *
 * Dùng `api.get` (`../api/client.ts`), KHÔNG dựng `fetch` riêng như
 * `serverClient.ts`'s `chat()`: đây là JSON thường, không phải SSE, nên
 * không có lý do gì để né `request<T>`'s xử lý 401/lỗi/parse đã có sẵn — lý
 * do duy nhất `serverClient.ts` phải tự viết `fetch` là `POST /ai/chat` trả
 * về một `ReadableStream`, thứ `api.post` không đọc dần được.
 */

interface UsageEntryWire {
  readonly at: string;
  readonly model: string;
  readonly in_tokens: number;
  readonly cached_in_tokens: number;
  readonly out_tokens: number;
  readonly tool_calls: number;
  readonly web_searches: number;
  readonly credits_charged: number;
}

interface CreditsWire {
  readonly balance_micro: number;
  readonly recent_usage: readonly UsageEntryWire[];
}

/**
 * VÒNG SỬA 1 (Minor #4): `export` bị bỏ khỏi năm định danh trong tệp này
 * (`UsageEntry`/`CreditsInfo` ở đây, `AgentConfigInfo` ở `AgentConfigPanel.
 * tsx`, cộng `formatCredits`/`formatUsageWhen` bên dưới) — reviewer grep
 * toàn `apps/web/src` (kể cả hai tệp test): 0 chỗ gọi ngoài tệp gốc. Miễn
 * phí: hết cảnh báo `only-export-components` của oxlint mà KHÔNG đổi hành
 * vi gì (test vẫn chỉ render component rồi đọc DOM, không import các hàm/
 * kiểu này trực tiếp). Nếu một chỗ khác THẬT SỰ cần chúng sau này, thêm lại
 * `export` lúc đó — không giữ sẵn một API không ai gọi.
 */
interface UsageEntry {
  readonly at: string;
  readonly model: string;
  readonly inTokens: number;
  readonly cachedInTokens: number;
  readonly outTokens: number;
  readonly toolCalls: number;
  readonly webSearches: number;
  readonly creditsCharged: number;
}

interface CreditsInfo {
  readonly balanceMicro: number;
  readonly recentUsage: readonly UsageEntry[];
}

async function fetchCredits(): Promise<CreditsInfo> {
  const wire = await api.get<CreditsWire>('/ai/credits');
  return {
    balanceMicro: wire.balance_micro,
    recentUsage: wire.recent_usage.map((u) => ({
      at: u.at,
      model: u.model,
      inTokens: u.in_tokens,
      cachedInTokens: u.cached_in_tokens,
      outTokens: u.out_tokens,
      toolCalls: u.tool_calls,
      webSearches: u.web_searches,
      creditsCharged: u.credits_charged,
    })),
  };
}

/** micro-credit → credit đọc được, theo dấu phân cách thập phân của ngôn ngữ
 *  đang hiển thị — cùng khuôn `formatBytes` (`pages/Settings.tsx`). */
function formatCredits(micro: number, lang: Lang): string {
  return (micro / 1_000_000).toLocaleString(lang === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: 4 });
}

/**
 * `at` (RFC3339, Go `time.Time`) → "YYYY-MM-DD HH:mm UTC".
 *
 * CỐ Ý không dùng `toLocaleString` ở đây (khác `formatCredits`): định dạng
 * ngày-giờ theo múi giờ của MÁY chạy sẽ làm chuỗi kỳ vọng trong bài kiểm phụ
 * thuộc múi giờ của máy chạy CI — số thì không (locale chỉ đổi dấu phân
 * cách, không đổi giá trị), giờ-ngày thì có (múi giờ dịch cả giá trị). Cắt
 * chuỗi ISO và gắn nhãn "UTC" cho ra cùng một chuỗi trên MỌI máy.
 */
function formatUsageWhen(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function CreditPanel() {
  const { t, lang } = useLanguage();
  const query = useQuery({ queryKey: ['ai', 'credits'], queryFn: fetchCredits, retry: false });

  return (
    <div className="set-credit">
      <dl className="set-stats" aria-label={t('settings.ai.creditTitle')}>
        <div className="set-stat">
          <dt className="set-stat-v" data-testid="credit-balance">
            {query.data ? formatCredits(query.data.balanceMicro, lang) : '—'}
          </dt>
          <dd className="set-stat-k">{t('settings.ai.creditBalanceLabel')}</dd>
        </div>
      </dl>

      {query.isPending && <p className="set-note">{t('settings.ai.creditLoading')}</p>}
      {query.isError && (
        <p className="set-note" role="alert">
          {t('settings.ai.creditError')}
        </p>
      )}

      {query.data && (
        <section className="set-sub">
          <h3 className="set-eyebrow">{t('settings.ai.usageTitle')}</h3>
          {query.data.recentUsage.length === 0 ? (
            <p className="set-note" data-testid="credit-usage-empty">
              {t('settings.ai.usageEmpty')}
            </p>
          ) : (
            <div className="set-usage-scroll">
              <table className="set-usage-table">
                <thead>
                  <tr>
                    <th scope="col">{t('settings.ai.usageColWhen')}</th>
                    <th scope="col">{t('settings.ai.usageColModel')}</th>
                    <th scope="col">{t('settings.ai.usageColTokensIn')}</th>
                    <th scope="col">{t('settings.ai.usageColTokensCached')}</th>
                    <th scope="col">{t('settings.ai.usageColTokensOut')}</th>
                    <th scope="col">{t('settings.ai.usageColToolCalls')}</th>
                    <th scope="col">{t('settings.ai.usageColWebSearches')}</th>
                    <th scope="col">{t('settings.ai.usageColCredits')}</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.recentUsage.map((entry, index) => (
                    // `at` không đảm bảo là duy nhất (hai lượt cùng giây), nên
                    // `key` là chỉ số — mảng này chỉ VẼ, không sắp xếp lại.
                    // eslint-disable-next-line react/no-array-index-key
                    <tr key={index}>
                      <td data-testid={`usage-when-${index}`}>{formatUsageWhen(entry.at)}</td>
                      <td data-testid={`usage-model-${index}`}>{entry.model}</td>
                      <td data-testid={`usage-in-${index}`}>{entry.inTokens}</td>
                      <td data-testid={`usage-cached-${index}`}>{entry.cachedInTokens}</td>
                      <td data-testid={`usage-out-${index}`}>{entry.outTokens}</td>
                      <td data-testid={`usage-tools-${index}`}>{entry.toolCalls}</td>
                      <td data-testid={`usage-search-${index}`}>{entry.webSearches}</td>
                      <td data-testid={`usage-credits-${index}`}>{formatCredits(entry.creditsCharged, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default CreditPanel;
