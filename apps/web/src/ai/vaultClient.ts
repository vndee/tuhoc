import { t, type Lang } from '@tuhoc/i18n';
import { PROTOCOL_VERSION, isVaultResponse } from '@vault-protocol';
import type { VaultErrorCode, VaultRequest, VaultResponse } from '@vault-protocol';

/**
 * Phía TRANG CHÍNH của giao thức `postMessage`. Nó KHÔNG BAO GIỜ chạm tới bí
 * mật của người dùng: nó gửi lời nhắc vào khung kho khoá và nhận chữ về. Nếu
 * một task nào đó cần bí mật ở đây để làm việc gì, thiết kế đã sai — dừng và
 * báo, đừng nới `src/ai/noKeyLeak.test.ts`.
 *
 * ĐIỀU QUAN TRỌNG NHẤT trong tệp này là `#onMessage`, và cụ thể là THỨ TỰ hai
 * câu lệnh đầu của nó. Xem khối chú thích tại chỗ.
 */

/**
 * Mã lỗi giao thức của kho khoá, cộng ba trạng thái mà chỉ phía client biết.
 * Cả ba KHÔNG nằm trong `VaultErrorCode` một cách có chủ ý — union đó là tập
 * mã mà kho khoá phát ra, và kho khoá không bao giờ phát ra ba mã này:
 *
 * - `timeout`   kho khoá không trả lời;
 * - `aborted`   người dùng bấm huỷ;
 * - `unavailable` bản dựng này KHÔNG CÓ kho khoá.
 *
 * `unavailable` tách khỏi `not_configured` có chủ ý, vì hai câu phải nói với
 * người học là khác nhau: "vào cấu hình để cắm key" chỉ đúng khi có chỗ để
 * cắm.
 */
export type VaultClientErrorCode = VaultErrorCode | 'timeout' | 'aborted' | 'unavailable';

export class VaultError extends Error {
  readonly code: VaultClientErrorCode;

  constructor(code: VaultClientErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

export type VaultStatus = Extract<VaultResponse, { kind: 'status' }>;
export type ChatMessage = Extract<VaultRequest, { kind: 'chat' }>['messages'][number];

/** Phần yêu cầu `chat` mà bên gọi cung cấp; `v` và `id` do client tự điền. */
export type ChatArgs = Omit<Extract<VaultRequest, { kind: 'chat' }>, 'v' | 'id' | 'kind'>;

/**
 * Phong bì chung của mọi yêu cầu, LẤY TỪ giao thức thay vì viết lại — nếu kho
 * khoá nâng `PROTOCOL_VERSION`, kiểu này đi theo và `tsc -b` bắt được chỗ lệch.
 */
type Envelope = Pick<Extract<VaultRequest, { kind: 'status' }>, 'v' | 'id'>;

/**
 * THÔNG ĐIỆP HUỶ — và đây là chỗ duy nhất trong tệp này đi trước giao thức.
 *
 * `apps/vault/src/protocol.ts` hôm nay KHÔNG có `kind: 'cancel'`. Nhưng huỷ
 * thật thì bắt buộc phải là một thông điệp: `AbortSignal` không phải kiểu
 * serializable của HTML nên nó không đi qua `postMessage` được — đo ngày
 * 2026-08-22 dưới Bun, `structuredClone(new AbortController().signal)` ném
 * `DataCloneError: The object can not be cloned.`
 *
 * Nên phía này gửi đúng hình dạng ngay từ bây giờ, và phần còn thiếu là MỘT
 * nhánh `case 'cancel'` ở kho khoá. Chừng nào nhánh ấy chưa có, kho khoá trả
 * một hồi đáp lỗi mang `id` của chính thông điệp huỷ — không lời gọi nào đang
 * chờ `id` đó, nên nó bị bỏ qua vô hại — và lời gọi mạng ở phía kho khoá VẪN
 * CHẠY TIẾP. Xem `task-5-report.md`.
 *
 * `v`/`id` lấy từ `Envelope` để hai phía không trôi dạt số phiên bản.
 */
export type VaultCancelRequest = Envelope & { kind: 'cancel'; cancelId: string };

type OutboundMessage = VaultRequest | VaultCancelRequest;

export interface VaultClientOptions {
  /** Ngôn ngữ của các câu lỗi lớp này tự dựng (`timeout`, `aborted`). Bắt
   *  buộc: một mặc định lặng lẽ ở đây là một câu tiếng Việt hiện ra giữa một
   *  giao diện tiếng Anh, và không cổng nào hỏi. */
  lang: Lang;
  /** Origin của khung kho khoá. Vừa là bộ lọc nhận, vừa là `targetOrigin` khi
   *  gửi — nên một giá trị sai một ký tự làm tính năng chết trong im lặng. */
  vaultOrigin: string;
  /** `contentWindow` của khung ẩn. */
  target: Window;
  /**
   * Hạn NHÀN RỖI, không phải hạn tổng: nó được lên lại sau MỖI thông điệp của
   * kho khoá. Một câu trả lời dài chảy chậm không bị giết; một kho khoá không
   * nạp được thì hỏng ồn ào sau ngần này. Mặc định 20 s vì lời gọi đầu tiên
   * phải chờ nhà cung cấp trả gói đầu, không chỉ chờ khung nạp xong.
   */
  timeoutMs?: number;
  /** Chỗ nghe thông điệp. Chỉ để test bơm vào; mặc định là `window` thật. */
  listenTo?: Window;
}

interface Pending {
  /** Giao một mảnh chữ cho bên gọi. Chỉ `chat` có. */
  onChunk?: (text: string) => void;
  settleStatus?: (s: VaultStatus) => void;
  settleDone?: () => void;
  fail: (e: VaultError) => void;
  /** Lên lại đồng hồ nhàn rỗi. */
  arm: () => void;
  /** Gỡ đồng hồ và mọi listener của lời gọi này. */
  release: () => void;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** `scheme://host[:port]` — đúng hình dạng `event.origin` của trình duyệt: không
 *  dấu `/` cuối, không đường dẫn. Cùng biểu thức phía kho khoá đang dùng. */
const ORIGIN_SHAPE = /^https?:\/\/[^/?#\s]+$/;

let counter = 0;

function newId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  counter += 1;
  return `r${String(Date.now())}-${String(counter)}`;
}

/**
 * Đọc origin kho khoá từ CẤU HÌNH BUILD.
 *
 * Nhận `env` làm tham số chứ không đọc thẳng `import.meta.env`, vì hai lý do đã
 * đo được: Vite thay `import.meta.env.X` bằng hằng số LÚC DỊCH (test không đặt
 * lại được lúc chạy), và ở `apps/web` thì `import.meta.env.VITEST` là
 * `undefined` (đo 2026-08-22) — nên mẫu "bọc trong `if (!VITEST)`" mà kho khoá
 * dùng được sẽ KHÔNG hoạt động ở đây.
 *
 * `null` khi KHÔNG cấu hình, NÉM khi cấu hình SAI. Hai chuyện khác nhau: chưa
 * cấu hình là một trạng thái hợp lệ (giáo trình phải đọc được khi không có AI),
 * còn cấu hình sai là một lỗi mà người deploy phải thấy ngay — mọi giá trị sai
 * hình dạng đều dẫn tới đúng một triệu chứng câm: "AI không trả lời".
 */
export function resolveVaultOrigin(env: { VITE_VAULT_ORIGIN?: string }, lang: Lang): string | null {
  const raw = (env.VITE_VAULT_ORIGIN ?? '').trim();
  if (!raw) return null;
  if (!ORIGIN_SHAPE.test(raw)) {
    throw new Error(t(lang, 'ai.vault.originShape', JSON.stringify(raw)));
  }
  return raw;
}

export class VaultClient {
  readonly vaultOrigin: string;

  readonly #lang: Lang;
  readonly #target: Window;
  readonly #listenTo: Window;
  readonly #timeoutMs: number;
  readonly #pending = new Map<string, Pending>();
  #disposed = false;

  constructor(options: VaultClientOptions) {
    this.vaultOrigin = options.vaultOrigin;
    this.#lang = options.lang;
    this.#target = options.target;
    this.#listenTo = options.listenTo ?? window;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#listenTo.addEventListener('message', this.#onMessage);
  }

  /** Gỡ listener. Bắt buộc gọi khi khung bị tháo, nếu không mỗi lần gắn lại là
   *  thêm một listener sống mãi trên `window`. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listenTo.removeEventListener('message', this.#onMessage);
    for (const [, p] of this.#pending) {
      p.release();
      p.fail(new VaultError('timeout', t(this.#lang, 'ai.vault.frameDetached')));
    }
    this.#pending.clear();
  }

  /**
   * Nói cho kho khoá biết người đọc đang dùng tiếng gì.
   *
   * **Một chiều, và vì thế nó không trả về `Promise`.** Giao thức không có hồi
   * đáp nào cho `setLang` (xem `protocol.ts` cho câu trả lời S2-F8 đầy đủ), nên
   * ở đây không có gì để `#track`, không đồng hồ nào để lên, không `id` nào để
   * tương quan. Một chữ ký `Promise<void>` sẽ là một lời hứa rằng có ai đó bên
   * kia đã nhận — và không ai hứa được điều đó.
   *
   * **Vì sao ngôn ngữ đi bằng thông điệp chứ không bằng `?lang=` trong `src`
   * của khung** (đường mà Task 5 đã chọn và Task 7 đã đo): `src` đổi ⇒ trình
   * duyệt nạp lại tài liệu ở origin kho khoá ⇒ **ô nhập key đang gõ dở bị xoá
   * sạch**. Xem `shell/VaultFrame.tsx`.
   *
   * Bên nhận có thể **chưa tồn tại**: một khung chưa nạp xong không có trình
   * nghe nào, và thông điệp rơi vào hư không mà không báo lỗi. Đó là lý do
   * `VaultFrame.tsx` gửi lại ở sự kiện `load` của khung, chứ không phải một
   * lần duy nhất lúc dựng client.
   */
  setLang(lang: Lang): void {
    this.#send({ v: PROTOCOL_VERSION, id: newId(), kind: 'setLang', lang });
  }

  /** Kho khoá đã được cấu hình chưa, và bằng nhà cung cấp/mô hình nào. Không
   *  trả về bí mật — giao thức không có trường nào chở được nó. */
  status(): Promise<VaultStatus> {
    return new Promise<VaultStatus>((resolve, reject) => {
      const id = newId();
      const p = this.#track(id, reject);
      p.settleStatus = resolve;
      this.#send({ v: PROTOCOL_VERSION, id, kind: 'status' });
      p.arm();
    });
  }

  /**
   * Gửi lời nhắc, nhận chữ về từng mảnh.
   *
   * `signal` là `AbortSignal` CỦA TRANG CHÍNH. Nó không đi qua ranh giới origin
   * được (xem `VaultCancelRequest`); khi nó nổ, client gửi một thông điệp huỷ
   * mang `id` của lời gọi này, rồi hỏng với mã `aborted`.
   */
  chat(args: ChatArgs, onChunk: (text: string) => void, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        // Chưa gửi gì thì không có gì để huỷ — và quan trọng hơn, không được
        // gửi một lời gọi mà ta biết chắc sẽ huỷ ngay: nó tốn tiền của người
        // dùng ở phía nhà cung cấp.
        reject(new VaultError('aborted', t(this.#lang, 'ai.vault.abortedBeforeSend')));
        return;
      }

      const id = newId();
      const p = this.#track(id, reject);
      p.onChunk = onChunk;
      p.settleDone = resolve;

      if (signal) {
        const onAbort = (): void => {
          if (!this.#pending.has(id)) return;
          this.#drop(id);
          this.#send({ v: PROTOCOL_VERSION, id: newId(), kind: 'cancel', cancelId: id });
          reject(new VaultError('aborted', t(this.#lang, 'ai.vault.abortedByUser')));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        const releaseTimer = p.release;
        p.release = (): void => {
          releaseTimer();
          signal.removeEventListener('abort', onAbort);
        };
      }

      this.#send({ v: PROTOCOL_VERSION, id, kind: 'chat', ...args });
      p.arm();
    });
  }

  /**
   * PHÉP KIỂM ORIGIN, VÀ THỨ TỰ CỦA NÓ.
   *
   * Đây là chiều đối xứng của phép kiểm mà Task 1 dựng ở kho khoá, và nó quan
   * trọng ngang chiều kia: một trang bất kỳ mở bằng `window.open` `postMessage`
   * được về đây. Nếu trang chính tin, một course độc bơm được chữ giả vào câu
   * trả lời AI — và người học đọc lời khuyên sai mà tưởng là của mô hình họ
   * chọn.
   *
   * `return` phải đứng TRƯỚC mọi lần chạm vào `event.data`, không chỉ trước lần
   * gửi hồi đáp. Task 1 đo được rằng ba bài kiểm của kế hoạch bỏ lọt một cài
   * đặt đọc `event.data` rồi mới im lặng — và mọi thứ làm với dữ liệu của kẻ
   * lạ (đếm, ghi log, đo thời gian) là một kênh y như một hồi đáp. Bất biến ấy
   * được canh bằng BẪY GETTER ở `vaultClient.test.ts`, không bằng lời hứa.
   */
  readonly #onMessage = (event: MessageEvent): void => {
    if (event.origin !== this.vaultOrigin) return;

    const data: unknown = event.data;
    if (!isVaultResponse(data)) return;
    const p = this.#pending.get(data.id);
    if (!p) return;

    switch (data.kind) {
      case 'status':
        this.#drop(data.id);
        p.settleStatus?.(data);
        return;
      case 'chunk':
        // Chữ vẫn chảy ⇒ kho khoá còn sống ⇒ lên lại đồng hồ nhàn rỗi.
        p.arm();
        p.onChunk?.(data.text);
        return;
      case 'done':
        this.#drop(data.id);
        p.settleDone?.();
        return;
      case 'error':
        this.#drop(data.id);
        p.fail(new VaultError(data.code, data.message));
        return;
      default:
        // `providers` — chưa có đường gọi nào ở Task 5. Không đóng lời gọi:
        // một hồi đáp không hiểu được không được im lặng nuốt mất đồng hồ.
        p.arm();
    }
  };

  #track(id: string, reject: (e: VaultError) => void): Pending {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const p: Pending = {
      fail: reject,
      arm: () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          this.#drop(id);
          reject(new VaultError('timeout', t(this.#lang, 'ai.vault.timeout', String(this.#timeoutMs))));
        }, this.#timeoutMs);
      },
      release: () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
      },
    };
    this.#pending.set(id, p);
    return p;
  }

  #drop(id: string): void {
    const p = this.#pending.get(id);
    if (!p) return;
    p.release();
    this.#pending.delete(id);
  }

  /** MỘT đường gửi duy nhất, và `targetOrigin` là tham số bắt buộc của nó.
   *  `'*'` không xuất hiện ở đâu trong tệp này, và không được phép xuất hiện. */
  #send(message: OutboundMessage): void {
    this.#target.postMessage(message, this.vaultOrigin);
  }
}
