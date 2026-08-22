import { t } from '../lang';
import { ProviderError } from './types';

/**
 * Đọc một luồng SSE và trả về payload của từng dòng `data:`.
 *
 * **Đây là chỗ dễ sai nhất của cả hệ thống con, và nó chỉ nên tồn tại MỘT bản.**
 * Kế hoạch chép nguyên vòng lặp đệm này vào cả `openaiCompatible.ts` lẫn
 * `anthropic.ts`; bản này tách nó ra vì bốn phép sửa dưới đây đều phải đúng ở cả
 * hai nhà cung cấp, và hai bản sao thì sớm muộn cũng lệch nhau — chỉ là bản
 * Anthropic sẽ lệch trong im lặng, vì nó ít được dùng hơn.
 *
 * Bốn tính chất, mỗi cái có bài kiểm riêng ở `providers.test.ts`:
 *
 * 1. **Đệm qua các gói.** `ReadableStream` cắt theo biên giới GÓI MẠNG, không
 *    theo biên giới dòng. Một sự kiện JSON có thể tới làm nhiều mảnh — kể cả
 *    đứt ngay giữa dấu `\n\n` phân tách.
 *
 * 2. **`decode(value, { stream: true })`.** Gói mạng cũng không cắt theo biên
 *    giới KÝ TỰ. Tiếng Việt có dấu là hai–ba byte, nên bỏ cờ này sinh ký tự
 *    thay thế `�` ngay giữa câu trả lời. Chú ý: một fixture kiểu
 *    `['Xin ch', 'ào']` KHÔNG đo được điều này — `TextEncoder` mã hoá từng mảnh
 *    một cách độc lập nên mảnh nào cũng là UTF-8 hợp lệ. Phải cắt ở BYTE.
 *
 * 3. **CRLF.** Chuẩn SSE cho phép `\r\n`, và một proxy đứng giữa có thể đổi
 *    dòng. Một bộ phân tích chỉ tìm `'\n\n'` sẽ không bao giờ thấy biên giới sự
 *    kiện trong luồng `\r\n\r\n` — nó trả về chuỗi rỗng mà không ném lỗi nào,
 *    tức là "AI không trả lời" và không có gì để lần theo. Chuẩn hoá trên CẢ bộ
 *    đệm (không phải trên từng gói) nên một `\r` nằm cuối gói này và `\n` nằm
 *    đầu gói sau vẫn ghép đúng.
 *
 * 4. **Xả nốt khi luồng đóng.** Sự kiện cuối có thể không có dòng trống đóng
 *    khi kết nối đóng ngay sau mảnh cuối. Vứt nó đi làm câu trả lời cụt mất một
 *    đoạn mà không lỗi nào được ném — kiểu hỏng khó phát hiện nhất trong họ này.
 *
 * Và một tính chất về TÀI NGUYÊN: `finally` **huỷ** luồng chứ không chỉ
 * `releaseLock()`. Cả hai lối ra sớm — `[DONE]` và người dùng bấm huỷ — bỏ lại
 * một kết nối HTTP đang mở nếu không ai huỷ. `releaseLock()` một mình không làm
 * điều đó.
 */
export async function* sseDataPayloads(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        // `decode()` không tham số xả nốt trạng thái còn dở của bộ giải mã.
        buf += dec.decode();
        yield* dataLines(normalise(buf));
        return;
      }
      buf = normalise(buf + dec.decode(value, { stream: true }));
      let sep: number;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        yield* dataLines(block);
      }
    }
  } finally {
    // Thứ tự quan trọng: huỷ TRƯỚC, nhả khoá SAU. `cancel()` đóng luồng phía
    // dưới (và với `res.body` thì đó là kết nối HTTP); `releaseLock()` chỉ nhả
    // cái khoá của bộ đọc và để kết nối treo.
    try {
      await reader.cancel();
    } catch {
      // Luồng đã hỏng thì không còn gì để dọn — và một lỗi lúc dọn dẹp không
      // được che mất lỗi thật đang trên đường ném ra.
    }
    reader.releaseLock();
  }
}

/** `\r\n` → `\n`. Chạy trên cả bộ đệm, xem tính chất 3 ở trên. */
function normalise(s: string): string {
  return s.includes('\r') ? s.replace(/\r\n/g, '\n') : s;
}

/** Lấy payload của các dòng `data:` trong một khối sự kiện. Bỏ qua `:` (dòng
 *  comment giữ kết nối), `event:`, `id:`, `retry:` — chúng không mang chữ. */
function* dataLines(block: string): Generator<string> {
  for (const line of block.split('\n')) {
    if (!line.startsWith('data:')) continue;
    yield line.slice(5).trim();
  }
}

/**
 * Gọi nhà cung cấp và trả về thân luồng, hoặc ném `ProviderError`.
 *
 * Vì sao `fetch` phải được bọc, đo được ngày 2026-08-22: khi trình duyệt CHẶN
 * hồi đáp vì CORS, `fetch` **từ chối bằng `TypeError`**, không trả về một
 * `Response` có mã trạng thái. Không bọc, cái `TypeError` ấy đi thẳng lên
 * `main.ts` và ra trang chính dưới dạng một lỗi không có `code` — trong khi
 * `VaultErrorCode` là một union ĐÓNG mà trang chính dựa vào để phân nhánh.
 *
 * Và nó còn là một bề mặt rò: thông điệp lỗi mạng của nền tảng có thể mang
 * URL đầy đủ, còn `cause` có thể mang cả đối tượng yêu cầu. Vì vậy hàm này
 * **không chuyển tiếp** lỗi gốc — nó ném một lỗi MỚI dựng hoàn toàn từ hằng số.
 */
export async function fetchStream(
  url: string,
  init: RequestInit,
): Promise<ReadableStream<Uint8Array>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    // Huỷ của người dùng phải đi tiếp NGUYÊN TRẠNG. Task 5 phân biệt "người
    // dùng bấm dừng" với "nhà cung cấp hỏng"; nuốt `AbortError` vào
    // `provider_error` làm hai thứ đó trông giống hệt nhau, và người dùng nhận
    // một thông báo lỗi cho hành động của chính họ.
    if ((err as { name?: string } | null)?.name === 'AbortError') throw err;
    if (init.signal?.aborted) throw err;
    throw new ProviderError(
      'provider_error',
      t('vault.provider.unreachable'),
    );
  }
  return bodyOrThrow(res);
}

/**
 * Chuyển mã trạng thái HTTP thành `ProviderError`, và trả về thân luồng.
 *
 * **Chỗ này là cửa duy nhất mà một thân hồi đáp có thể lọt vào thông điệp lỗi,
 * nên nó chỉ có một bản và có bẫy canh.** Cám dỗ rất cụ thể: khi gỡ lỗi, thêm
 * `await res.text()` vào thông điệp là việc đầu tiên ai cũng nghĩ ra — và thân
 * lỗi 401 của OpenAI có nguyên văn key trong đó (đo được: `Incorrect API key
 * provided: sk-khong*…*0000`). Muốn thêm ngữ cảnh thì thêm `res.status`, đừng
 * thêm nội dung.
 *
 * Không xuất ra ngoài: mọi đường vào đây đều đi qua `fetchStream`, và giữ nó
 * riêng tư nghĩa là không có đường thứ hai bỏ qua phép bọc lỗi mạng.
 */
function bodyOrThrow(res: Response): ReadableStream<Uint8Array> {
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('bad_key', t('vault.provider.badKey'));
  }
  if (res.status === 429) {
    throw new ProviderError('rate_limited', t('vault.provider.rateLimited'));
  }
  if (!res.ok || !res.body) {
    throw new ProviderError('provider_error', `HTTP ${res.status}`);
  }
  return res.body as ReadableStream<Uint8Array>;
}

/**
 * Dựng LẠI danh sách thông điệp với đúng hai trường.
 *
 * `req` tới từ trang chính qua `postMessage`, nên nội dung của nó do trang chính
 * quyết định — và từ HC-3 ta biết một course độc chạy chính ở đó. Chuyển thẳng
 * `req.messages` vào thân yêu cầu là để trang chính viết vào thân ấy những
 * trường mà kho khoá không hề biết. Cùng lập luận `readPublicConfig` của Task 2
 * đã viết khi nó dựng object mới thay vì trả thẳng cái vừa phân tích.
 */
export function sanitiseMessages(
  messages: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): Array<{ role: string; content: string }> {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}
