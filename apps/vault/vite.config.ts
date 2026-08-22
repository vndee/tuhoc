import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// `loadEnv` tới từ `vite`, không từ `vitest/config` — bản re-export của vitest
// không có nó, và cấu hình hỏng lúc nạp là một cách rất tốn thời gian để phát
// hiện điều đó.
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
// Phần mở rộng `.ts` tường minh: `configLoader: 'native'` (mặc định ở một bản
// Vite sau) không tự đoán phần mở rộng, và cảnh báo của nó rất dễ bị bỏ qua cho
// tới ngày cấu hình đơn giản là không nạp được.
import { applyAppOrigin } from './src/headers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Chép `_headers` vào bản dựng, với `VITE_APP_ORIGIN` đã được điền.
 *
 * `_headers` cố ý KHÔNG nằm trong `public/`: một bản trong `public/` sẽ được
 * chép nguyên xi kèm thẻ giữ chỗ, và deploy sẽ ship một `frame-ancestors` trỏ
 * vào một chuỗi vô nghĩa — hỏng theo đúng chiều im lặng. Ở đây chỉ có một tệp,
 * và `applyAppOrigin` NÉM nếu thiếu origin, nếu `frame-ancestors` biến mất, hay
 * nếu ai đó viết cứng một origin vào tệp. Bản dựng hỏng ồn ào là điều mong
 * muốn: gói production của kho khoá vốn đã ném ngay lúc nạp khi thiếu biến này.
 */
function pagesHeaders(appOrigin: string) {
  return {
    name: 'vault-pages-headers',
    apply: 'build' as const,
    closeBundle() {
      const src = readFileSync(resolve(HERE, '_headers'), 'utf8');
      const out = resolve(HERE, 'dist');
      mkdirSync(out, { recursive: true });
      writeFileSync(resolve(out, '_headers'), applyAppOrigin(src, appOrigin));
    },
  };
}

// Kho khoá là một ỨNG DỤNG RIÊNG ở một ORIGIN RIÊNG, không phải một route của
// `apps/web`. Đó là toàn bộ lý do nó tồn tại: trình duyệt cấm JS của origin này
// đọc `localStorage` của origin khác, nên một course hạng `interactive` bị duyệt
// sót vẫn không đọc được key. Một thư mục `/vault/` trên cùng cổng sẽ là CÙNG
// origin và phá huỷ đúng cái hàng rào đó.
export default defineConfig(({ mode }) => ({
  // `loadEnv` chứ không `process.env`: nó gộp cả `.env*` lẫn biến của shell,
  // nên giá trị mà plugin thấy là ĐÚNG giá trị mà `import.meta.env` của bundle
  // thấy. Hai nguồn khác nhau ở đây nghĩa là CSP và mã có thể nói hai origin
  // khác nhau, và không cổng nào hỏi được.
  plugins: [pagesHeaders(loadEnv(mode, HERE, 'VITE_').VITE_APP_ORIGIN ?? '')],
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
    // Bắt buộc: dưới Node 25, `localStorage` mà vitest để lại trong môi trường
    // jsdom là một `{}` rỗng, không có `getItem`/`setItem`/`clear`. Tệp này lắp
    // lại `Storage` THẬT của jsdom. Phép đo và nguyên nhân nằm ở đầu tệp; chốt
    // "môi trường test có Storage thật" nằm trong `keystore.test.ts`.
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
}));
