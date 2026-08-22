import type { VaultErrorCode } from '../protocol';

/** Một lượt trong hội thoại. Cùng hình dạng với `messages` của
 *  `VaultRequest['chat']` — và `providers.test.ts` có một dòng kiểm ở tầng KIỂU
 *  khẳng định hai bên bằng nhau, vì không có gì khác giữ chúng khớp. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
}

/**
 * Mã lỗi của lớp nhà cung cấp là một TẬP CON của `VaultErrorCode`, lấy bằng
 * `Extract` chứ không chép tay ba chuỗi.
 *
 * Vì sao đáng làm: mọi lỗi ở đây rồi sẽ được `main.ts` chuyển thành một
 * `VaultResponse` gửi về trang chính. Nếu ai đó đổi tên một mã trong
 * `protocol.ts`, `Extract` biến kiểu này thành `never` và **`tsc -b` đỏ ngay
 * tại chỗ** — thay vì để một chuỗi lạ trôi qua kênh và trang chính im lặng rơi
 * vào nhánh `default`.
 */
export type ProviderErrorCode = Extract<
  VaultErrorCode,
  'bad_key' | 'rate_limited' | 'provider_error'
>;

/**
 * Lỗi của nhà cung cấp.
 *
 * **KHÔNG BAO GIỜ dựng thông điệp từ thân hồi đáp.** Nhà cung cấp ECHO key lại
 * trong lỗi xác thực — OpenAI trả nguyên văn `Incorrect API key provided:
 * sk-…`. Dán thân hồi đáp vào `message` là đưa key vào một `Error`, và `Error`
 * đi thẳng vào `console`, vào báo cáo lỗi, vào `postMessage` gửi về trang
 * chính. Đó là đúng lớp lỗi M3 của Task 2, chỉ khác bề mặt.
 *
 * `providers.test.ts` cắm bẫy cho điều này: hồi đáp giả ECHO key, rồi bài kiểm
 * đi bộ qua toàn bộ đồ thị giá trị của lỗi (kể cả `stack`, `cause`, getter) và
 * qua sáu phương thức `console`.
 *
 * Viết `readonly code` chứ không dùng tham số-thuộc tính
 * (`constructor(public code: …)`) như kế hoạch: `tsconfig.json` của kho khoá bật
 * `erasableSyntaxOnly`, và tham số-thuộc tính là cú pháp KHÔNG xoá được — mã của
 * kế hoạch không dịch được ở đây (TS1294, đo ở task-3-report §5).
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ProviderError';
  }
}

export interface Provider {
  readonly id: string;
  readonly label: string;
  readonly defaultModel: string;
  /** Trả về từng mảnh chữ. Ném `ProviderError` khi nhà cung cấp từ chối. */
  chat(req: ChatRequest, key: string, signal?: AbortSignal): AsyncIterable<string>;
}
