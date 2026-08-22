/** Tăng khi hình dạng thông điệp đổi theo cách không tương thích ngược. Bên nhận
 *  từ chối phiên bản lạ thay vì đoán — một trang chính cũ gặp kho khoá mới phải
 *  hỏng ồn ào, không được im lặng gửi sai. */
export const PROTOCOL_VERSION = 1 as const;

export type VaultRequest =
  | { v: 1; id: string; kind: 'listProviders' }
  | { v: 1; id: string; kind: 'status' }
  | { v: 1; id: string; kind: 'chat'; providerId: string; model: string;
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> }
  /**
   * ─────────────────────────────────────────────────────────────────────────
   * `setLang` — THÊM Ở TASK "vault-lang". ĐỌC ĐOẠN NÀY TRƯỚC KHI ĐỌC MÃ.
   * ─────────────────────────────────────────────────────────────────────────
   *
   * `docs/carried-forward.md` (S2-F8) buộc mọi thay đổi tệp này phải được một
   * người đọc với **đúng một câu hỏi**, và đây là câu trả lời, viết ra để người
   * sau không phải tự suy:
   *
   *   > **"Thông điệp mới này có mang được key RA KHỎI origin kho khoá không?"**
   *   >
   *   > **KHÔNG.** Ba lý do, và cả ba đều kiểm được bằng mắt ngay trong tệp này:
   *   >
   *   > 1. **Nó là một chiều ĐI VÀO.** `VaultResponse` **không** có thành viên
   *   >    nào tương ứng, và `main.ts` **không gửi gì** ở nhánh `setLang` —
   *   >    không hồi đáp, không `error`, không cả một `ack`. Một thông điệp
   *   >    không có đường về thì không có kênh nào để chở dữ liệu về.
   *   > 2. **Nó mang đúng một mã ngôn ngữ.** Trường duy nhất là `lang`, một
   *   >    chuỗi mà kho khoá lọc qua `normalizeLang` và **vứt** nếu lạ; giá trị
   *   >    còn lại chỉ có thể là `'vi'` hoặc `'en'`. Nó không có chỗ để cõng
   *   >    thêm gì.
   *   > 3. **Nhánh xử lý nó KHÔNG ĐỌC keystore.** `setLang` không gọi
   *   >    `readConfig`, không gọi `readPublicConfig`, không chạm `localStorage`
   *   >    của origin này. Nó đổi một biến ở tầm module và vẽ lại CHỮ.
   *   >
   *   > Chiều ngược cũng đáng nói ra: thứ xấu nhất một trang thù địch nhúng
   *   > được khung này đạt được bằng cách spam `setLang` là **hiển thị sai
   *   > ngôn ngữ** — đúng bằng thứ nó đã đạt được qua `?lang=` trước đây. Bề
   *   > mặt tấn công không rộng ra; nó chỉ đổi chỗ.
   *
   * **Vì sao thứ này đáng một thay đổi giao thức, trong khi Task 5 đã cân và
   * thấy KHÔNG đáng.** Task 5 định giá `?lang=` là *"một thứ chỉ đổi chữ"*.
   * Task 7 đo được cái giá thật: `?lang=` nằm trong `src` của `<iframe>`, nên
   * đổi ngôn ngữ ⇒ trình duyệt **nạp lại tài liệu ở origin kho khoá** ⇒ **ô
   * nhập key đang gõ dở bị xoá sạch**, không một lời cảnh báo. Cái giá không
   * phải chữ, mà là một key gõ dở. Giao thức là chỗ duy nhất trả được nó tận
   * gốc: khung không còn lý do nào để remount, nên **cả lớp lỗi** biến mất chứ
   * không riêng đường bàn phím mà Task 7 đo được.
   *
   * `lang` là `string`, KHÔNG phải một union đóng `'vi' | 'en'`, và đó là chủ
   * ý: giá trị này tới từ `postMessage`, tức là từ bên kia một ranh giới
   * origin, nên một kiểu hẹp ở đây sẽ là một **lời hứa của trang chính** chứ
   * không phải một bảo đảm — cùng lập luận mà `chatShape()` ở `main.ts` đã
   * viết ra cho `chat`. Phép lọc thật nằm ở `setVaultLang` → `normalizeLang`.
   *
   * `id` có mặt vì phong bì `{v, id}` là đồng nhất cho mọi yêu cầu và
   * `handleMessage` bỏ qua thông điệp không có `id`. **Không ai tương quan
   * theo nó** — không có hồi đáp để tương quan.
   */
  | { v: 1; id: string; kind: 'setLang'; lang: string };

export type VaultResponse =
  | { v: 1; id: string; kind: 'providers'; providers: Array<{ id: string; label: string }> }
  | { v: 1; id: string; kind: 'status'; configured: boolean; providerId?: string; model?: string }
  | { v: 1; id: string; kind: 'chunk'; text: string }
  | { v: 1; id: string; kind: 'done' }
  | { v: 1; id: string; kind: 'error'; code: VaultErrorCode; message: string };

/** Mã lỗi là một union đóng, không phải chuỗi tự do: trang chính phải phân biệt được
 *  "chưa cắm key" (hiện lời mời cấu hình) với "nhà cung cấp từ chối" (hiện lỗi thật). */
export type VaultErrorCode =
  | 'not_configured' | 'bad_key' | 'rate_limited' | 'provider_error'
  | 'needs_consent' | 'unsupported_provider' | 'protocol_version';

export function isVaultResponse(x: unknown): x is VaultResponse {
  return typeof x === 'object' && x !== null
    && (x as { v?: unknown }).v === PROTOCOL_VERSION
    && typeof (x as { id?: unknown }).id === 'string'
    && typeof (x as { kind?: unknown }).kind === 'string';
}
