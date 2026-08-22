/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin của TRANG CHÍNH — origin duy nhất mà kho khoá chịu nói chuyện, và
   * cũng là `targetOrigin` của mọi hồi đáp. Dev: `http://localhost:5173`.
   * Prod: origin thật của `apps/web`.
   *
   * Không có mặc định và cố ý không có: `resolveAllowedOrigin()` trong
   * `src/main.ts` NÉM khi thiếu. Một mặc định ở đây sẽ biến một cấu hình sai
   * thành một kho khoá vẫn chạy mà tin nhầm người.
   */
  readonly VITE_APP_ORIGIN?: string;

  /**
   * Do vitest đặt. Đo được ngày 2026-08-22 dưới vitest 4.1.11: giá trị là
   * **chuỗi** `"true"`, không phải boolean (`MODE` khi đó là `"test"`). Khối
   * khởi động ở cuối `src/main.ts` dùng nó để không tự gắn listener và không
   * đòi `VITE_APP_ORIGIN` khi đang chạy test.
   */
  readonly VITEST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
