import {
  PROTOCOL_VERSION,
  type VaultErrorCode,
  type VaultRequest,
  type VaultResponse,
} from './protocol';
import { readConfig, readPublicConfig } from './keystore';
import { getProvider, listProviders } from './providers';
import { ProviderError, type ChatMessage, type Provider } from './providers/types';
import { checkAndConsume } from './guard';
import { LANG_PARAM, currentLang, setVaultLang, t } from './lang';
import { defaultSettingsDeps, renderSettings } from './ui/Settings';

export interface HandlerDeps {
  allowedOrigin: string;
  /** Gọi sau mỗi quyết định của người gác, để khung vẽ lại nhật ký.
   *
   *  Tuỳ chọn vì `handleMessage` phải gọi được từ test mà không cần DOM. Không
   *  phải tiện nghi: một nhật ký chỉ vẽ lúc nạp trang là một nhật ký đứng yên
   *  trong đúng lúc đáng nhìn nhất — lúc có thứ gì đó đang gọi liên tục. */
  onActivity?: () => void;
}

/** Tách khỏi `addEventListener` để test gọi thẳng được. Trả về void: mọi hồi đáp
 *  đi qua `event.source.postMessage`, vì đó là đường duy nhất tới đúng khung đã hỏi. */
export function handleMessage(event: MessageEvent, deps: HandlerDeps): void {
  // Kiểm origin TRƯỚC KHI đọc data. Một thông điệp từ origin lạ không được
  // ảnh hưởng tới bất cứ gì, kể cả gây ra một hồi đáp lỗi — hồi đáp lỗi cũng là
  // một kênh thông tin.
  if (event.origin !== deps.allowedOrigin) return;

  const req = event.data as Partial<VaultRequest>;
  if (!req || typeof req !== 'object') return;
  const source = event.source as WindowProxy | null;
  if (!source) return;

  // `targetOrigin` TƯỜNG MINH ở mọi hồi đáp, kể cả từng mảnh của một câu trả
  // lời đang chảy. `'*'` bị cấm tuyệt đối ở cả hai chiều.
  const send = (res: VaultResponse) => source.postMessage(res, deps.allowedOrigin);

  if (req.v !== PROTOCOL_VERSION) {
    if (typeof req.id === 'string') {
      send({ v: PROTOCOL_VERSION, id: req.id, kind: 'error', code: 'protocol_version',
             message: t('vault.protocol.version', String(PROTOCOL_VERSION)) });
    }
    return;
  }
  if (typeof req.id !== 'string') return;

  switch (req.kind) {
    case 'listProviders':
      // `listProviders()` dựng object mới với ĐÚNG hai trường, không trả thẳng
      // `Provider` — `Provider.chat` là một hàm, và *structured clone* của
      // `postMessage` NÉM khi gặp hàm. Xem chú thích ở `providers/index.ts`.
      send({ v: 1, id: req.id, kind: 'providers', providers: listProviders() });
      return;
    case 'status': {
      // `readPublicConfig`, KHÔNG `readConfig`. Đây là đường trang chính gọi
      // được tự do — không giới hạn tần suất, không cần xác nhận — nên nó không
      // được phép nạp key vào bộ nhớ, dù chỉ để rồi vứt đi. Xem chú thích ở
      // `keystore.ts` và bài kiểm "BẪY: đường status KHÔNG ĐỌC ô nhớ chứa key".
      const pub = readPublicConfig();
      send({
        v: 1, id: req.id, kind: 'status', configured: pub !== null,
        providerId: pub?.providerId, model: pub?.model,
      });
      return;
    }
    // `chat` được Task 9 nối vào — và nó đi qua NGƯỜI GÁC, không đi thẳng ra
    // `fetch`. Task 3 cố ý để nhánh này rơi xuống `default` với lý do: nối
    // `chat` trước khi có người gác của HC-3 là dựng đúng cái lỗ *confused
    // deputy*, vì course độc chạy ở trang chính và trang chính được phép nhắn
    // vào đây.
    //
    // Bài kiểm "một yêu cầu `chat` KHÔNG gây ra lời gọi mạng nào" ở
    // `providers/providers.test.ts` vẫn XANH sau khi nối, vì lời gọi đầu phiên
    // dừng ở người gác trước khi chạm `fetch`. **Nhưng nó xanh vì một lý do
    // YẾU HƠN trước:** trong bài kiểm đó kho khoá chưa cắm key, nên nhánh
    // `not_configured` cũng đủ chặn. Bẫy thật của người gác nằm ở
    // `guard.test.ts` ("BẪY TRUNG TÂM"), nơi key ĐÃ được cắm và nhà cung cấp
    // hợp lệ, nên thứ duy nhất còn chặn lời gọi mạng là xác nhận đầu phiên.
    case 'chat':
      handleChat(req, req.id, deps, send);
      return;
    default:
      send({ v: 1, id: req.id, kind: 'error', code: 'unsupported_provider',
             message: t('vault.protocol.unsupported') });
  }
}

// ───────────────────── đường `chat`, qua NGƯỜI GÁC ─────────────────────

function errorResponse(id: string, code: VaultErrorCode, message: string): VaultResponse {
  return { v: 1, id, kind: 'error', code, message };
}

interface ChatShape {
  providerId: string;
  model: string;
  messages: ChatMessage[];
}

/**
 * Kiểm hình dạng yêu cầu `chat` ở TẦNG CHẠY, không chỉ tầng kiểu.
 *
 * `req` tới từ `postMessage`, nên kiểu TypeScript ở đây là một lời hứa của
 * trang chính chứ không phải một bảo đảm — và HC-3 nói course độc chạy chính ở
 * đầu bên kia. Không kiểm thì `messages.map(...)` ném ngay trong trình nghe
 * `message`, tức là một thông điệp méo mó giết được cả kho khoá.
 *
 * Dựng LẠI mảng với đúng hai trường, giống `sanitiseMessages` của lớp nhà cung
 * cấp — hai lớp, có chủ ý: lớp này quyết định có gọi hay không (và đếm ký tự
 * cho nhật ký), lớp kia quyết định gửi cái gì ra dây.
 */
function chatShape(req: unknown): ChatShape | null {
  if (typeof req !== 'object' || req === null) return null;
  const r = req as Record<string, unknown>;
  if (typeof r.providerId !== 'string' || typeof r.model !== 'string') return null;
  if (!Array.isArray(r.messages)) return null;
  const messages: ChatMessage[] = [];
  for (const m of r.messages) {
    if (typeof m !== 'object' || m === null) return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== 'system' && role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string') return null;
    messages.push({ role, content });
  }
  return { providerId: r.providerId, model: r.model, messages };
}

/**
 * Thứ tự các phép kiểm ở đây là phần quan trọng nhất của Task 9.
 *
 *   1. **hình dạng** — một thông điệp méo mó không được ném ra ngoài trình nghe;
 *   2. **nhà cung cấp** — id lạ thì dừng trước khi tiêu token của người dùng;
 *   3. **đã cắm key chưa** — hỏi bằng `readPublicConfig()`, thứ KHÔNG đọc ô nhớ
 *      chứa key (Task 2). Trả `not_configured` để trang chính mời đi cấu hình
 *      thay vì hiện một lỗi cụt;
 *   4. **người gác** — xác nhận đầu phiên rồi mới tới hạn mức;
 *   5. **và chỉ khi đó mới `readConfig()`**, tức là chỉ khi đó key mới đi vào bộ
 *      nhớ. Một course độc spam `chat` không làm key được nạp lấy một lần —
 *      `guard.test.ts` cắm bẫy `Storage.getItem` cho đúng tính chất này.
 */
function handleChat(
  req: unknown,
  id: string,
  deps: HandlerDeps,
  send: (res: VaultResponse) => void,
): void {
  const shape = chatShape(req);
  if (!shape) {
    // `unsupported_provider` là mã GẦN NHẤT có sẵn, không phải mã đúng nghĩa.
    // `VaultErrorCode` là một union ĐÓNG mà trang chính phân nhánh theo, và
    // thêm một thành viên là một thay đổi giao thức — theo S2-F8 nó phải được
    // đọc bằng mắt người, và Task 5 đang được viết ngay lúc này dựa trên đúng
    // union hiện tại. Đã ghi vào `docs/carried-forward.md` như một món nợ có tên.
    send(errorResponse(id, 'unsupported_provider', t('vault.protocol.badChatShape')));
    return;
  }

  const provider = getProvider(shape.providerId);
  if (!provider) {
    send(errorResponse(id, 'unsupported_provider', t('vault.provider.unknown')));
    return;
  }

  if (readPublicConfig() === null) {
    send(errorResponse(id, 'not_configured', t('vault.provider.notConfigured')));
    return;
  }

  const chars = shape.messages.reduce((n, m) => n + m.content.length, 0);
  const decision = checkAndConsume({ chars, providerId: shape.providerId });
  deps.onActivity?.();
  if (!decision.allow) {
    send(errorResponse(id, decision.code ?? 'rate_limited', decision.message ?? ''));
    return;
  }

  const cfg = readConfig();
  if (!cfg) {
    // Chỉ tới được đây nếu ô nhớ đổi giữa hai phép đọc. Token đã tiêu — chấp
    // nhận, vì chiều ngược lại (đọc key trước khi qua người gác) đắt hơn nhiều.
    send(errorResponse(id, 'not_configured', t('vault.provider.notConfigured')));
    return;
  }

  startStream(id, provider, cfg.apiKey, shape, send);
}

/**
 * Chảy câu trả lời về trang chính, từng mảnh một.
 *
 * `send` được gọi nhiều lần với cùng `id`; trang chính tương quan theo `id` và
 * kết thúc ở `done` hoặc `error`.
 *
 * **Thông điệp lỗi KHÔNG BAO GIỜ dựng từ lỗi lạ.** `ProviderError` của Task 3
 * đã được chứng minh là dựng hoàn toàn từ hằng số (thân hồi đáp 401 của nhà
 * cung cấp có nguyên văn key trong đó). Mọi lỗi khác được thay bằng một câu
 * hằng — `String(err)` ở đây là đường ngắn nhất để một `TypeError` mang URL,
 * `cause`, hay cả đối tượng yêu cầu đi thẳng ra trang chính.
 *
 * **Chưa có huỷ.** Giao thức v1 không có `kind` nào để trang chính nói "dừng",
 * nên không có `AbortSignal` nào để chuyển vào đây. Đó là một khoảng trống của
 * giao thức, không phải một thiếu sót của tệp này — đã ghi vào
 * `docs/carried-forward.md`.
 */
function startStream(
  id: string,
  provider: Provider,
  apiKey: string,
  shape: ChatShape,
  send: (res: VaultResponse) => void,
): void {
  void (async () => {
    try {
      for await (const text of provider.chat({ model: shape.model, messages: shape.messages }, apiKey)) {
        send({ v: 1, id, kind: 'chunk', text });
      }
      send({ v: 1, id, kind: 'done' });
    } catch (e) {
      const code: VaultErrorCode = e instanceof ProviderError ? e.code : 'provider_error';
      const message = e instanceof ProviderError
        ? e.message
        : t('vault.provider.callFailed');
      try {
        send(errorResponse(id, code, message));
      } catch {
        // Khung đã đóng giữa chừng. Không còn ai để báo, và một lỗi ở đây sẽ
        // thành một promise bị từ chối không ai bắt.
      }
    }
  })();
}

/** Origin của trình duyệt luôn có đúng hình dạng `scheme://host[:port]` — không
 *  dấu `/` cuối, không đường dẫn. `event.origin` được so sánh bằng `!==`, nên một
 *  giá trị cấu hình sai một ký tự sẽ không khớp với BẤT KỲ thông điệp nào. */
const ORIGIN_SHAPE = /^https?:\/\/[^/?#\s]+$/;

/** Tách khỏi khối khởi động bên dưới để kiểm được — đây là **đi lệch kế hoạch có
 *  chủ ý**, xem `task-1-report.md`. Kế hoạch đọc `VITE_APP_ORIGIN` ngay trong
 *  khối `if (… && !import.meta.env.VITEST)`, mà khối đó theo định nghĩa không
 *  bao giờ chạy dưới vitest — nên điều tuyệt đối "kho khoá từ chối chạy khi
 *  không biết tin ai" sẽ không có một bài kiểm nào.
 *
 *  Nhận `env` làm tham số chứ không đọc thẳng `import.meta.env`: Vite thay
 *  `import.meta.env.X` bằng hằng số **lúc dịch**, nên test không thể đặt lại giá
 *  trị đó khi chạy. */
export function resolveAllowedOrigin(env: { VITE_APP_ORIGIN?: string }): string {
  const raw = (env.VITE_APP_ORIGIN ?? '').trim();
  if (!raw) {
    throw new Error(t('vault.boot.originRequired'));
  }
  if (!ORIGIN_SHAPE.test(raw)) {
    // `'*'` rơi vào đây, và đó là điều quan trọng nhất mà phép kiểm này làm:
    // giá trị này vừa là bộ lọc nhận, vừa là `targetOrigin` khi gửi.
    throw new Error(t('vault.boot.originShape', JSON.stringify(raw)));
  }
  return raw;
}

/**
 * Ngôn ngữ hiển thị của kho khoá, đọc từ `?lang=` mà trang chính gắn vào `src`
 * của khung. Xem `./lang.ts` cho lý do đầy đủ; ba điểm cần nhớ ở đây:
 *
 *   - **đọc TRƯỚC `resolveAllowedOrigin`**, vì hàm ấy ném bằng chữ của catalog;
 *   - **không tin đầu vào**: `setVaultLang` lọc qua `normalizeLang`, và giá trị
 *     xấu nhất một trang lạ đạt được là hiển thị sai ngôn ngữ;
 *   - **không đi qua giao thức**: `VaultRequest` là union đóng, và ngôn ngữ
 *     hiển thị không đáng một thay đổi giao thức (S2-F8).
 *
 * Tách khỏi khối khởi động để test gọi được — cùng lý do và cùng khuôn với
 * `resolveAllowedOrigin`.
 */
export function applyLangFromLocation(search: string): void {
  setVaultLang(new URLSearchParams(search).get(LANG_PARAM));
  if (typeof document !== 'undefined') document.documentElement.lang = currentLang();
}

if (typeof window !== 'undefined' && !import.meta.env.VITEST) {
  applyLangFromLocation(window.location.search);
  const allowedOrigin = resolveAllowedOrigin(import.meta.env);

  // Màn cấu hình (form nhập key) + khung xác nhận + nhật ký được vẽ ngay lúc
  // nạp, chứ không đợi lời gọi đầu tiên: `needs_consent` chỉ hữu ích nếu người
  // dùng có chỗ để bấm khi trang chính mở rộng khung ra.
  //
  // ĐIỂM NỐI ĐÃ KHÉP (Task 6). Task 9 để lại cảnh báo ở đúng chỗ này: khung chỉ
  // NHÌN THẤY được khi trang chính mở rộng iframe, và phần đó chưa tồn tại, nên
  // `needs_consent` là ngõ cụt — đúng hình dạng "cổng mù #4" (S1-F29). Hai nửa
  // giờ đã nối: `apps/web/src/pages/Settings.tsx` là một route thật, có liên
  // kết trong thanh điều hướng, và nó mở rộng khung ra. Câu "người dùng có bấm
  // tới được không" vẫn thuộc cổng e2e của Task 10; điều task này làm là biến
  // câu ấy từ "không" thành một câu đáng hỏi.
  //
  // `repaintPanel`, KHÔNG vẽ lại cả màn: `onActivity` chạy sau mọi quyết định
  // của người gác, tức là mỗi lần trang chính nhắn `chat` vào — vẽ lại cả màn
  // ở đó sẽ xoá sạch key người dùng đang gõ dở mỗi lần một course gọi hộ.
  const root = document.getElementById('vault-ui');
  const ui = root ? renderSettings(root, defaultSettingsDeps()) : null;
  const repaint = ui
    ? () => {
        ui.repaintPanel();
      }
    : undefined;

  window.addEventListener('message', (e) => handleMessage(e, { allowedOrigin, onActivity: repaint }));
}
