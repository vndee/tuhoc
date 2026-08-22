import { anthropic } from './anthropic';
import { openAICompatible } from './openaiCompatible';
import type { Provider } from './types';

/**
 * Danh sách nhà cung cấp được hỗ trợ.
 *
 * **Điều kiện để có mặt ở đây là DUY NHẤT một điều: nhà cung cấp cho gọi thẳng
 * từ trình duyệt.** Spec §3.2(3) nói thẳng — nhà cung cấp nào không cho thì
 * "đơn giản là không được hỗ trợ"; không có đường dự phòng qua máy chủ của ta,
 * và đó là chỉ thị trực tiếp của chủ dự án, đã nhắc lại hai lần.
 *
 * Rủi ro đã biết và cách xử đúng: một nhà cung cấp có thể đổi chính sách và
 * chặn trình duyệt sau này. Khi đó nó **rời danh sách này** — KHÔNG phải khi đó
 * ta mở đường qua server. Cách dò lại: gọi endpoint của họ TỪ MỘT TRANG THẬT
 * bằng key giả; đọc được hồi đáp 401 là qua, `TypeError: Failed to fetch` là
 * trượt.
 *
 * ─── DÒ LẠI 2026-08-22, từ một origin trình duyệt thật, key giả ───────────
 *
 * | nhà cung cấp | `POST` sinh chữ, từ trình duyệt        |
 * |---|---|
 * | DeepSeek     | 401 đọc được ✅                        |
 * | OpenRouter   | 401 đọc được ✅                        |
 * | Groq         | 401 đọc được ✅                        |
 * | Anthropic    | 401 đọc được ✅ (cần header `…direct-browser-access`) |
 * | **OpenAI**   | **BỊ CHẶN** ❌                          |
 *
 * OpenAI, nguyên văn console của trình duyệt:
 *
 *     Access to fetch at 'https://api.openai.com/v1/chat/completions' from
 *     origin '…' has been blocked by CORS policy: No
 *     'Access-Control-Allow-Origin' header is present on the requested resource.
 *
 * Điều này **mâu thuẫn với bảng ở spec §1.4** (ghi OpenAI "cho phép", 401). Đo
 * kỹ hơn cho thấy vì sao bảng cũ có thể đã đúng lúc ấy và vẫn sai hôm nay:
 *
 *   - `OPTIONS` (preflight) của OpenAI **có** trả `Access-Control-Allow-Origin`;
 *   - `POST /v1/chat/completions` trả 401 **không** có header ấy ⇒ trình duyệt
 *     chặn hồi đáp sau khi preflight đã qua;
 *   - `GET /v1/models` từ CÙNG origin ấy đọc được 401 bình thường ⇒ vấn đề nằm
 *     ở riêng đường sinh chữ, không phải ở cả tên miền;
 *   - một phép dò chỉ đọc mã trạng thái mà KHÔNG chạy trong trình duyệt sẽ thấy
 *     401 và kết luận "cho phép" — đúng cái bẫy đang bàn.
 *
 * **Chưa đo được, và đó là lý do mục này CHƯA bị gỡ:** hồi đáp **200** (key
 * thật) có kèm `Access-Control-Allow-Origin` hay không. Nếu có, OpenAI vẫn dùng
 * được nhưng mọi lỗi xác thực sẽ hiện ra là `provider_error` chứ không phải
 * `bad_key`. Nếu không, OpenAI **phải rời danh sách này** theo đúng spec
 * §3.2(3) — chứ không phải ta mở đường qua server. Quyết định ấy cần một key
 * OpenAI thật để đo; xem `task-3-report.md` §6.
 *
 * DeepSeek đứng đầu vì spec §3.3 gợi ý nó làm mặc định (rẻ). Thứ tự ở đây LÀ
 * thứ tự hiện ra trong giao diện chọn, nên nó có một bài kiểm.
 */
const ALL: Provider[] = [
  openAICompatible('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-chat'),
  openAICompatible('openai', 'OpenAI', 'https://api.openai.com/v1', 'gpt-4o-mini'),
  openAICompatible(
    'openrouter',
    'OpenRouter',
    'https://openrouter.ai/api/v1',
    'deepseek/deepseek-chat',
  ),
  openAICompatible('groq', 'Groq', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile'),
  anthropic,
];

export function getProvider(id: string): Provider | null {
  return ALL.find((p) => p.id === id) ?? null;
}

/**
 * Danh sách cho giao diện chọn. Trả về ĐÚNG hai trường, dựng mới — không trả
 * thẳng `Provider`.
 *
 * Không phải chuyện gọn gàng: kết quả này đi qua `postMessage` về trang chính,
 * và `postMessage` dùng *structured clone*, thứ **NÉM** khi gặp một hàm. Trả
 * thẳng `Provider` (có `chat`) làm hỏng cả kênh chứ không chỉ gửi thừa.
 */
export function listProviders(): Array<{ id: string; label: string }> {
  return ALL.map((p) => ({ id: p.id, label: p.label }));
}
