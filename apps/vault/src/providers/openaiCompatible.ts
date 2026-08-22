import { fetchStream, sanitiseMessages, sseDataPayloads } from './sse';
import type { Provider } from './types';

/** Hình dạng mảnh stream của họ OpenAI. Mọi trường đều tuỳ chọn: một nhà cung
 *  cấp tương thích có thể gửi mảnh không có `content` (mảnh mở đầu chỉ có
 *  `role`, mảnh cuối chỉ có `finish_reason`). */
interface OpenAIChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}

/**
 * Phân tích luồng SSE hình dạng OpenAI thành từng mảnh chữ.
 *
 * Việc ĐỆM nằm ở `sse.ts` và có bốn tính chất được ghi ở đó; hàm này chỉ diễn
 * giải payload. Tách như vậy vì hai nhà cung cấp dùng chung đúng phần khó.
 */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  for await (const payload of sseDataPayloads(stream)) {
    if (payload === '') continue;
    // `return`, không `break`: lối ra này chạy `finally` của `sseDataPayloads`,
    // và `finally` là chỗ luồng bị huỷ. Đọc tiếp sau `[DONE]` không chỉ thừa —
    // nhà cung cấp có thể gửi thêm và ta sẽ nối nhầm vào câu trả lời.
    if (payload === '[DONE]') return;
    try {
      const j = JSON.parse(payload) as OpenAIChunk;
      const t = j.choices?.[0]?.delta?.content;
      if (t) yield t;
    } catch {
      // Một sự kiện hỏng không được giết cả câu trả lời đang chảy. KHÔNG log
      // `payload` ở đây, kể cả để gỡ lỗi: đây là mã chạy ở origin giữ key, và
      // thói quen in nội dung thô ra console là thứ sẽ theo người sửa sang
      // đường khác — xem chú thích cùng nội dung ở `keystore.ts`.
    }
  }
}

/**
 * Một hàm dựng, bốn nhà cung cấp trong registry (và mọi endpoint tự chạy nói
 * đúng hình dạng này). Khác nhau chỉ ở host và model mặc định.
 *
 * `baseUrl` phải là URL TUYỆT ĐỐI tới nhà cung cấp. Một đường dẫn tương đối
 * (`/api/ai`) sẽ trỏ về máy chủ của chính ta — đúng cái "đường dự phòng qua
 * server" đã bị cấm hai lần. `providers.test.ts` cắm bẫy cho điều đó bằng cách
 * dựng `new URL(...)` trên URL mà `fetch` thật sự nhận và kiểm host.
 */
export function openAICompatible(
  id: string,
  label: string,
  baseUrl: string,
  defaultModel: string,
): Provider {
  return {
    id,
    label,
    defaultModel,
    async *chat(req, key, signal) {
      const resBody = await fetchStream(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        // Key đi vào ĐÚNG MỘT chỗ: header `authorization`. Không vào URL, không
        // vào thân, không vào log. Bẫy ở `providers.test.ts` liệt kê mọi header
        // mang key và khẳng định danh sách đó đúng bằng `['authorization']`.
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: req.model,
          messages: sanitiseMessages(req.messages),
          stream: true,
        }),
      });
      yield* parseSSE(resBody);
    },
  };
}
