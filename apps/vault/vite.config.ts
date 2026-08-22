import { defineConfig } from 'vitest/config';

// Kho khoá là một ỨNG DỤNG RIÊNG ở một ORIGIN RIÊNG, không phải một route của
// `apps/web`. Đó là toàn bộ lý do nó tồn tại: trình duyệt cấm JS của origin này
// đọc `localStorage` của origin khác, nên một course hạng `interactive` bị duyệt
// sót vẫn không đọc được key. Một thư mục `/vault/` trên cùng cổng sẽ là CÙNG
// origin và phá huỷ đúng cái hàng rào đó.
export default defineConfig({
  server: {
    // 5174, trong khi `apps/web` chạy ở 5173. Origin bao gồm cả cổng, nên hai
    // cổng khác nhau trên localhost là hai origin khác nhau — đủ để trình duyệt
    // cách ly `localStorage`, y như hai subdomain khi chạy thật.
    port: 5174,
    // `strictPort` KHÔNG phải tuỳ chọn tiện nghi ở đây. Mặc định Vite sẽ lặng lẽ
    // nhảy sang 5175 khi 5174 bận — và lúc đó origin của kho khoá không còn là
    // origin mà trang chính được cấu hình để tin, nên mọi thông điệp bị bỏ đúng
    // theo thiết kế và triệu chứng duy nhất là "AI không trả lời". Hỏng ồn ào
    // ngay lúc khởi động tốt hơn nhiều.
    strictPort: true,
  },
  preview: { port: 5174, strictPort: true },
  test: {
    // jsdom chứ không phải node: `localStorage` (Task 2) và `MessageEvent`
    // (task này) là API của trình duyệt.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
