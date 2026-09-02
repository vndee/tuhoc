/**
 * Phía TRANG CHÍNH của `POST /ai/chat` — Pha 2. AI chạy trên MÁY CHỦ, trả bằng
 * credit; đây là mô-đun DUY NHẤT trong `src/ai/` chạm mạng thật.
 *
 * KHÔNG CÒN KHO KHOÁ RIÊNG ORIGIN. Bản Pha 1 (S2) gửi lời nhắc qua
 * `postMessage` tới một `<iframe>` origin riêng, vì key của người dùng phải
 * ở lại trình duyệt. Pha 2 đổi mô hình: DeepSeek chạy bằng key của NỀN TẢNG,
 * trả bằng credit của người học, nên không còn bí mật nào cần giữ khỏi tầm
 * với của trang chính — chỉ còn một phiên đăng nhập, đi bằng cookie như mọi
 * lời gọi khác của `api/client.ts`. Tệp này gọi thẳng `fetch`, không qua
 * `api.post` (`../api/client.ts`): endpoint trả về SSE (`text/event-stream`),
 * và `api.post` chỉ biết đọc JSON trọn vẹn qua `res.text()` — nó không có chỗ
 * cho một `ReadableStream` đọc dần.
 *
 * HỢP ĐỒNG DÂY, đo từ mã Go đang chạy (`apps/api/internal/ai/handler.go`):
 *
 *   - Thân request CHỈ có hai trường: `question`, `course_slug`. KHÔNG có
 *     trường lịch sử — xem `useAI.ts` cho lý do sản phẩm.
 *   - Mọi từ chối XẢY RA TRƯỚC KHI STREAM BẮT ĐẦU (phiên, hình dạng thân,
 *     rate limit, credit) là một response JSON thường, không phải 200:
 *     `{code, error}`, với `code` là một trong mười giá trị đóng
 *     (`ServerAIErrorCode`).
 *   - Sau khi stream bắt đầu (luôn 200 + `text/event-stream`), MỌI sự kiện là
 *     `event: <kind>\ndata: <json>\n\n` với `kind` ∈ `delta · tool · done ·
 *     error` và JSON mang đúng hai trường `text`, `code` (`code` chỉ có ở
 *     `error`). Xem `writeSSE`/`sseEnvelope` phía Go — từng byte của khung này
 *     có chủ, không phải một quy ước ngầm.
 *
 * KHÔNG CẦN THÔNG ĐIỆP HUỶ RIÊNG NỮA. Bản Pha 1 phải tự dựng một thông điệp
 * huỷ mang `id` riêng vì `AbortSignal` không qua được `postMessage` (không
 * serializable). Ở đây lời gọi là một `fetch` THẬT, và `AbortSignal` là đúng
 * cơ chế `fetch` hiểu: huỷ nó đóng luôn kết nối TCP, `writeSSE` phía Go gặp
 * lỗi ghi ở sự kiện kế tiếp, và `RunStream` dừng — không cần một thông điệp
 * thứ hai đi vòng qua bất kỳ đâu.
 */

import { sessionWasSuperseded } from '../auth/sessionIdentity';

/** Mười mã lỗi Go phát ra (`handler.go`'s `Code*` const), cộng hai mã CHỈ
 *  phía trình duyệt biết — cùng khuôn lớp lỗi phía client của Pha 1 đã dùng
 *  để mở rộng union mã lỗi của giao thức nó nói chuyện cùng:
 *
 *  - `Network`  không có response nào tới, hoặc kết nối đứt GIỮA CHỪNG một
 *    stream đang chạy (server chết, wifi rớt) — Go không bao giờ tự phát mã
 *    này, vì phía Go luôn TRẢ LỜI được (kể cả khi trả lời là một lỗi).
 *  - `Aborted`  người dùng (hoặc component bị tháo) chủ động huỷ.
 */
export type ServerAIErrorCode =
  | 'Unauthenticated'
  | 'InvalidBody'
  | 'FieldRequired'
  | 'FieldTooLong'
  | 'UnknownTool'
  | 'NoCredit'
  | 'RateLimited'
  | 'ProviderFailed'
  | 'Internal'
  | 'ToolBudgetExhausted'
  | 'Network'
  | 'Aborted';

const KNOWN_SERVER_CODES: ReadonlySet<string> = new Set<ServerAIErrorCode>([
  'Unauthenticated',
  'InvalidBody',
  'FieldRequired',
  'FieldTooLong',
  'UnknownTool',
  'NoCredit',
  'RateLimited',
  'ProviderFailed',
  'Internal',
  'ToolBudgetExhausted',
]);

function isKnownServerCode(value: unknown): value is ServerAIErrorCode {
  return typeof value === 'string' && KNOWN_SERVER_CODES.has(value);
}

export class ServerAIError extends Error {
  readonly code: ServerAIErrorCode;

  constructor(code: ServerAIErrorCode, message: string) {
    super(message);
    this.name = 'ServerAIError';
    this.code = code;
  }
}

/** Cùng dòng, cùng lý do, ở ba tệp khác của `src/`: `api/client.ts`,
 *  `api/catalog.ts`, `admin/adminApi.ts`. Rỗng ở dev/test — request khớp
 *  origin hiện tại, đúng cái msw và một dev server cùng-origin đều cần. */
const BASE_URL: string = import.meta.env.VITE_API_URL ?? '';

export interface ChatArgs {
  readonly question: string;
  /** `course_slug` trên dây. Rỗng là hợp lệ — Go chỉ dùng nó làm NGỮ CẢNH cho
   *  công cụ `read_course`, không phải một trường bắt buộc. */
  readonly courseSlug: string;
}

interface SSEFrame {
  readonly kind: string;
  readonly text: string;
  readonly code?: string;
}

/**
 * Một "record" là văn bản GIỮA hai dấu `\n\n` — đúng một sự kiện SSE. Khung
 * Go phát ra luôn đúng hai dòng (`event: …`, `data: …`), nhưng đọc bằng vòng
 * lặp qua TỪNG dòng thay vì giả định thứ tự: một proxy chèn dòng trống hay
 * đảo thứ tự trường không nên làm cả lượt hỏng thay vì làm một record hỏng.
 *
 * Trả `null` cho một record thiếu trường hoặc `data:` không phải JSON hợp lệ
 * — BỎ QUA nó thay vì ném, vì một record méo không nên đánh sập cả lượt khi
 * những record khác vẫn đọc được.
 */
function parseSSERecord(record: string): SSEFrame | null {
  let kind: string | null = null;
  let dataLine: string | null = null;
  for (const line of record.split('\n')) {
    if (line.startsWith('event: ')) kind = line.slice('event: '.length);
    else if (line.startsWith('data: ')) dataLine = line.slice('data: '.length);
  }
  if (kind === null || dataLine === null) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(dataLine);
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const obj = payload as { text?: unknown; code?: unknown };
  return {
    kind,
    text: typeof obj.text === 'string' ? obj.text : '',
    code: typeof obj.code === 'string' ? obj.code : undefined,
  };
}

async function readErrorBody(res: Response): Promise<{ code?: unknown; error?: unknown } | null> {
  try {
    return (await res.json()) as { code?: unknown; error?: unknown };
  } catch {
    return null;
  }
}

/**
 * Gửi MỘT lượt hỏi–đáp tới `POST /ai/chat` và đọc SSE trả về, gọi `onChunk`
 * cho từng mảnh `delta` NGAY KHI nó tới — không gom rồi mới trả, vì đó là
 * toàn bộ khác biệt giữa "chảy chữ" và "đợi rồi hiện hết".
 *
 * ĐỨT GIỮA CHỪNG GIỮ LẠI PHẦN ĐÃ NHẬN, có chủ ý: mọi record ĐÃ ĐỦ hai dòng
 * (`event:`/`data:`) khi kết nối còn sống đã được `onChunk` giao đi TRƯỚC KHI
 * hàm này biết kết nối vừa hỏng — thứ tự đó không thể đảo, vì `onChunk` chạy
 * ngay trong vòng lặp đọc, và lỗi (ném hoặc `done: true` sớm) chỉ phát hiện
 * được Ở LẦN ĐỌC KẾ TIẾP. Bên gọi (`useAI.ts`) thừa hưởng bất biến này miễn
 * là nó không tự xoá `turn.answer` khi `Promise` này hỏng — và nó không xoá.
 *
 * Hỏng theo BA đường, phân biệt được cho người gọi:
 *
 *   1. Trước khi stream bắt đầu (401/400/402/429/500…): JSON `{code, error}`
 *      thường, `code` là một trong mười giá trị Go phát ra. Đây là đường
 *      DUY NHẤT `NoCredit` (402) tới — không sự kiện SSE nào mang mã này.
 *   2. Giữa stream, sự kiện `error`: chỉ hai mã Go từng gửi
 *      (`ProviderFailed`, `ToolBudgetExhausted` — xem `errorEnvelope` phía
 *      Go), nhưng hàm này chấp nhận bất kỳ mã đã biết nào, phòng khi Go thêm
 *      một mã lỗi-giữa-stream mới mà không cần sửa tệp này.
 *   3. Kết nối đứt mà KHÔNG một sự kiện cuối nào tới (`done` hay `error`) —
 *      Go không bao giờ tự tạo ra hình dạng này (nó luôn phát đúng một trong
 *      hai trước khi đóng — xem `streamTurn`), nên đây LUÔN LÀ một sự cố
 *      truyền tải, không phải phía Go đang nói "tôi hỏng". Mã `Network`.
 */
export async function chat(
  args: ChatArgs,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    // Chưa gửi gì thì không có gì để huỷ, và quan trọng hơn: không gửi một
    // lời gọi mà ta biết chắc sẽ huỷ ngay — nó tốn một vòng round-trip vô ích
    // và (một khi credit đã trừ trước khi stream bắt đầu ở phía Go) tốn tiền
    // của người học.
    throw new ServerAIError('Aborted', 'cancelled before the request was sent');
  }

  // NGƯỜI GHI DUY NHẤT KHÔNG ĐI QUA `useMe` — nên nó tự hỏi, ngay tại chỗ
  // gửi (rà soát toàn nhánh, bước 5).
  //
  // Vòng sửa này chuyển câu hỏi "phiên này của ai" về đúng một nơi:
  // `api/useMe.ts` trả lời "không có ai" khi tab bị thay phiên, và mọi cổng
  // `confirmedLoggedIn` thừa hưởng. Hai lối vào AI của trang đọc CỐ Ý không
  // nằm sau cổng ấy — `ChapterView.tsx` nói thẳng: *"HAI LỐI VÀO AI LUÔN CÓ
  // MẶT, KHÔNG CÒN CỜ NÀO GÁC CHÚNG"*. Hỏi về một chương là việc công khai,
  // và một khách chưa đăng nhập phải nhận một câu 401 tử tế chứ không phải
  // một panel biến mất. Nên chỗ này KHÔNG thể thừa hưởng, và một guard
  // "trông có vẻ trung tâm" mà bỏ sót một lối vòng thì tệ hơn bốn miếng vá
  // thành thật.
  //
  // Lập luận y hệt cái ngay trên, mạnh hơn một bậc: không gửi một lời gọi mà
  // ta BIẾT sẽ bị tính vào nhầm tài khoản. Câu hỏi của A (mang theo cả khối
  // ngữ cảnh chương mà `useAI.ts`'s `buildWireQuestion` ghép vào) sẽ đi dưới
  // cookie của B, tiêu credit của B, và hiện ra trong sổ dùng của B.
  //
  // `Unauthenticated` chứ không phải một mã mới: `useAI.ts`'s
  // `describeFailure` đã dịch mã ấy thành đúng câu người học cần đọc — phiên
  // của tab này không còn hiệu lực, đăng nhập lại để hỏi tiếp — và với TAB
  // NÀY thì đó chính xác là chuyện vừa xảy ra.
  if (sessionWasSuperseded()) {
    throw new ServerAIError(
      'Unauthenticated',
      'another tab replaced this browser session before the question was sent',
    );
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/ai/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: args.question, course_slug: args.courseSlug }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new ServerAIError('Aborted', 'cancelled while sending the request');
    throw new ServerAIError('Network', e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) {
    const body = await readErrorBody(res);
    const code = isKnownServerCode(body?.code) ? body.code : 'Internal';
    const message = typeof body?.error === 'string' ? body.error : `request failed with status ${String(res.status)}`;
    throw new ServerAIError(code, message);
  }

  if (!res.body) {
    // Một 200 không mang stream nào để đọc — không hình dạng nào của Go làm
    // vậy (`c.Context().SetBodyStreamWriter` luôn có thân), nên coi nó như
    // một sự cố truyền tải chứ không phải một lượt "thành công rỗng".
    throw new ServerAIError('Network', 'the response had no body to stream');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawTerminalEvent = false;

  try {
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await reader.read();
      } catch (e) {
        if (signal?.aborted) throw new ServerAIError('Aborted', 'cancelled mid-stream');
        throw new ServerAIError('Network', e instanceof Error ? e.message : String(e));
      }
      if (step.done) break;

      buffer += decoder.decode(step.value, { stream: true });
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const record = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const frame = parseSSERecord(record);
        sep = buffer.indexOf('\n\n');
        if (!frame) continue;

        if (frame.kind === 'delta') {
          onChunk(frame.text);
        } else if (frame.kind === 'done') {
          sawTerminalEvent = true;
          return;
        } else if (frame.kind === 'error') {
          sawTerminalEvent = true;
          const code = isKnownServerCode(frame.code) ? frame.code : 'ProviderFailed';
          throw new ServerAIError(code, frame.text);
        }
        // 'tool' — bỏ qua có chủ ý. Task 13 giữ nguyên giao diện `AITurn[]`
        // (một chuỗi `answer` tích luỹ); chưa có chỗ nào trong đó để hiện
        // "đang tra cứu X" mà không đổi hình dạng ấy. Bỏ record này ĐI KHÔNG
        // đụng `buffer` — nó vẫn được tiêu thụ đúng cách (`sep` đã cắt), chỉ
        // là không gọi `onChunk`.
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // `releaseLock` ném nếu có một read() đang treo — không xảy ra ở đây vì
      // vòng lặp trên luôn `await` xong lần đọc trước khi tới finally, nhưng
      // bọc phòng thân, đúng khuôn best-effort mà writeSSE phía Go dùng.
    }
  }

  if (!sawTerminalEvent) {
    throw new ServerAIError('Network', 'the connection closed before the turn finished');
  }
}
