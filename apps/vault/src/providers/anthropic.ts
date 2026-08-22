import { fetchStream, sanitiseMessages, sseDataPayloads } from './sse';
import type { Provider } from './types';

/** Hình dạng sự kiện stream của Anthropic. `type` là trường phân loại; chữ nằm
 *  ở `delta.text` của sự kiện `content_block_delta`. */
interface AnthropicEvent {
  type?: string;
  delta?: { text?: string };
}

/** Anthropic khác họ OpenAI ở ba điểm, và đây là điểm thứ ba: sự kiện mang chữ
 *  là `content_block_delta` với `delta.text`, và luồng kết thúc bằng
 *  `message_stop` chứ không bằng `[DONE]`. */
export async function* parseAnthropicSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  for await (const payload of sseDataPayloads(stream)) {
    if (payload === '') continue;
    try {
      const j = JSON.parse(payload) as AnthropicEvent;
      if (j.type === 'message_stop') return;
      if (j.type === 'content_block_delta' && j.delta?.text) yield j.delta.text;
    } catch {
      // Xem chú thích cùng nội dung ở `openaiCompatible.ts`: một sự kiện hỏng
      // không giết cả câu trả lời, và payload KHÔNG được log.
    }
  }
}

/** Số token tối đa cho một câu trả lời. Anthropic BẮT BUỘC trường này (khác họ
 *  OpenAI, nơi nó tuỳ chọn) — thiếu nó là 400 cho mọi lời gọi. */
const MAX_TOKENS = 2048;

export const anthropic: Provider = {
  id: 'anthropic',
  label: 'Anthropic',
  defaultModel: 'claude-sonnet-5',
  async *chat(req, key, signal) {
    // Điểm khác thứ nhất: `system` là THAM SỐ RIÊNG, không phải một phần tử
    // trong `messages`. Gộp MỌI thông điệp system lại thay vì chỉ lấy cái đầu —
    // lời nhắc của Task 7/8 dựng từ nhiều mảnh (tiêu đề chương, đoạn bôi đen),
    // và lấy cái đầu sẽ đánh rơi phần còn lại trong im lặng.
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const messages = sanitiseMessages(req.messages.filter((m) => m.role !== 'system'));

    const resBody = await fetchStream('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        // Điểm khác thứ hai: `x-api-key`, KHÔNG phải `authorization`. Key vẫn
        // chỉ đi vào đúng một header — bẫy ở `providers.test.ts` khẳng định
        // không có header thứ hai nào mang nó.
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // Bắt buộc để trình duyệt được phép gọi thẳng; thiếu nó Anthropic trả
        // 403 cho MỌI lời gọi từ trang. Và 403 được ánh xạ thành `bad_key`, nên
        // triệu chứng duy nhất là "key bị từ chối" — người dùng sẽ đi tìm lỗi ở
        // đúng chỗ không có lỗi. Vì vậy header này có bài kiểm riêng.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: MAX_TOKENS,
        stream: true,
        // Không gửi `system: ''` khi không có mảnh system nào.
        ...(system ? { system } : {}),
        messages,
      }),
    });
    yield* parseAnthropicSSE(resBody);
  },
};
