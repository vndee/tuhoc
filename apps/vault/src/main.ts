import { PROTOCOL_VERSION, type VaultRequest, type VaultResponse } from './protocol';
import { readPublicConfig } from './keystore';
import { listProviders } from './providers';

export interface HandlerDeps { allowedOrigin: string }

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

  const send = (res: VaultResponse) => source.postMessage(res, deps.allowedOrigin);

  if (req.v !== PROTOCOL_VERSION) {
    if (typeof req.id === 'string') {
      send({ v: PROTOCOL_VERSION, id: req.id, kind: 'error', code: 'protocol_version',
             message: `Kho khoá dùng giao thức v${PROTOCOL_VERSION}.` });
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
    // `chat` rơi vào đây, và đó là CỐ Ý của Task 3.
    //
    // Lớp nhà cung cấp (`providers/`) đã xong và đã được kiểm; thứ còn thiếu
    // không phải mã gọi mạng mà là NGƯỜI GÁC trước nó. HC-3 nói rõ: kho khoá
    // chặn TRỘM key chứ không chặn DÙNG key, và một course độc chạy ở trang
    // chính vẫn `postMessage` được vào đây. Nối `chat` thẳng vào `fetch` lúc
    // này là dựng đúng cái lỗ *confused deputy* mà Task 9 sinh ra để bịt: gọi
    // bao nhiêu lần cũng được (đốt tiền người dùng) và gửi đi bất cứ gì (ghi
    // chú riêng tư dưới danh nghĩa lời nhắc).
    //
    // Task 9 nối đường này, và khi nối thì nó đi qua token bucket + xác nhận
    // phiên. Bài kiểm "một yêu cầu `chat` KHÔNG gây ra lời gọi mạng nào" ở
    // `providers/providers.test.ts` canh đúng chỗ đó — và nó vẫn phải XANH sau
    // Task 9, vì lời gọi đầu phiên trả `needs_consent` mà không gọi mạng.
    default:
      send({ v: 1, id: req.id, kind: 'error', code: 'unsupported_provider',
             message: 'Chưa hỗ trợ.' });
  }
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
    throw new Error(
      'VITE_APP_ORIGIN bắt buộc — kho khoá từ chối chạy khi không biết tin ai.',
    );
  }
  if (!ORIGIN_SHAPE.test(raw)) {
    // `'*'` rơi vào đây, và đó là điều quan trọng nhất mà phép kiểm này làm:
    // giá trị này vừa là bộ lọc nhận, vừa là `targetOrigin` khi gửi.
    throw new Error(
      `VITE_APP_ORIGIN phải là một origin đúng nghĩa (scheme://host[:port]), ` +
      `không dấu "/" cuối, không đường dẫn, không "*" — nhận được ${JSON.stringify(raw)}.`,
    );
  }
  return raw;
}

if (typeof window !== 'undefined' && !import.meta.env.VITEST) {
  const allowedOrigin = resolveAllowedOrigin(import.meta.env);
  window.addEventListener('message', (e) => handleMessage(e, { allowedOrigin }));
}
