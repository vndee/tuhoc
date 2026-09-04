import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { courseAssets } from './vite-plugins/courseAssets.ts';
import { storyStaticGraphEvidencePlugin } from './scripts/story-static-graph.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  build: { manifest: true },
  // `tailwindcss()` là plugin RIÊNG của Tailwind v4, không phải qua PostCSS —
  // v4 bỏ `tailwind.config.js`, token khai bằng `@theme` ngay trong CSS (xem
  // `src/styles/tokens.css`). Nó phải có mặt ở đây thì `@import "tailwindcss"`
  // mới được biên dịch; thiếu nó thì dòng import ấy lọt xuống trình duyệt
  // nguyên văn và im lặng không làm gì.
  plugins: [tailwindcss(), react(), courseAssets(), storyStaticGraphEvidencePlugin()],
  // `strictPort` xuất hiện ở đây vì hệ thống con 2 (Pha 1) làm cổng 5173 CÓ
  // TẢI TRỌNG: kho khoá ở origin thứ hai chỉ tin đúng một origin, và ở dev đó
  // là `http://localhost:5173`. Mặc định của Vite là lặng lẽ nhảy sang cổng kế
  // tiếp khi cổng đang bận — đo được ngày 2026-08-22 trên chính máy này: 5173
  // bị một tiến trình khác giữ, `vite dev` khởi động ở **5175** và không nói gì
  // ngoài một dòng log. Origin lệch ⇒ mọi thông điệp bị bỏ đúng theo thiết kế,
  // và triệu chứng duy nhất là "AI không trả lời".
  //
  // Task 16 gỡ origin thứ hai, nên LÝ DO GỐC ĐÃ CHẾT. Dòng này vẫn ở lại, và
  // lý do thay thế MẠNH HƠN lý do tôi viết ở vòng đầu — vòng ấy nói "không có
  // gì ở nơi khác trong repo còn ghim con số 5173", và đó là một khẳng định
  // SAI, đã đo:
  //
  //   apps/api/internal/config/config.go:15   DefaultCORSOrigin = "http://localhost:5173"
  //   .env.example:54                          CORS_ORIGIN=http://localhost:5173
  //   apps/web/src/api/catalog.test.ts:43      (giải thích `VITE_API_URL` chưa đặt
  //                                            thì `/courses` giải về chính 5173)
  //
  // Tức 5173 vẫn là một hằng số ĐƯỢC CHIA SẺ, chỉ là bên kia của nó đổi từ kho
  // khoá sang API: `dev-web` trôi sang 5175 thì trình duyệt gửi `Origin:
  // http://localhost:5175`, không khớp `CORS_ORIGIN` mặc định, và MỌI lời gọi
  // có cookie hỏng — cùng một triệu chứng câm như trước, chỉ đổi tính năng bị
  // câm. Nên `strictPort` không phải di sản: nó vẫn canh đúng một hằng số hai
  // bên đang chia nhau.
  //
  // Chỉ áp cho `vite dev`. Cổng e2e không đi qua đây: nó dùng `vite preview` ở
  // 5183 với `--strictPort` của riêng nó (xem playwright.config.ts).
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      // CSS-only alias: reader.css + vendor/katex.css are imported through
      // this and bundled/hashed by Vite normally. The classic-script assets
      // next to them (runtime.js, vendor/*.js) are NOT imported through this
      // alias — they are served as plain files by the courseAssets plugin
      // and loaded via <script src> at runtime (Task 11), because they
      // attach globals and would break if run through Vite's module
      // pipeline.
      '@course-kit': path.resolve(HERE, '../../packages/course-kit'),
      // The course-package RULE SET, shared with the packaging CLI and
      // registry CI — see packages/course-format/src/index.ts's own header,
      // which names this alias as the way a consumer reaches it (the repo
      // has no npm workspaces and no root package.json, so there is nothing
      // for `bun install` to link).
      //
      // Aliased to `src/index.ts` and not to the directory: the package's
      // `main` field points there, but Vite's alias is a plain path rewrite
      // and does not read package.json, so a directory alias would resolve
      // to `.../course-format/index.ts`, which does not exist.
      //
      // Its own two dependencies (`parse5`, `fflate`) resolve out of
      // `packages/course-format/node_modules`, because Node/Vite resolution
      // walks up from the IMPORTING file, not from this app. That directory
      // has to exist — `cd packages/course-format && bun install` — which is
      // what the Makefile's test-format target already says.
      '@tuhoc/course-format': path.resolve(HERE, '../../packages/course-format/src/index.ts'),
      // CATALOG DỊCH (QĐ-1). Cùng khuôn alias-tới-TỆP như mục trên, cùng lý do.
      //
      // Gói này KHÔNG có phụ thuộc nào — `dependencies` rỗng, không
      // `node_modules`, không React, không DOM. Ràng buộc ấy có cổng ở
      // `src/i18n/i18n.test.ts`; nó không phải một quy ước.
      '@tuhoc/i18n': path.resolve(HERE, '../../packages/i18n/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    // 30s, not vitest's 5s default. This is a HARNESS budget, not an
    // assertion: nothing here waits on a bare timer. Every wait inside a
    // test is a `waitFor`/`findBy*` with its own bound (1000ms by
    // default), so a genuinely stuck test still fails on ITS OWN clock —
    // raising this cannot mask a hang, it can only stop the harness from
    // killing a test that is doing real, slow work.
    //
    // Why it was needed: under `--maxWorkers=24` on 8 cores, Vite
    // transforming a cold module graph *inside* a timed test body was
    // measured at 8,984ms (445ms idle). That produced red runs with NO
    // failing assertion — the most misleading signal a suite can give,
    // and it cost this phase three separate investigations before the
    // cause was found. See `syncLifecycle.test.tsx`'s beforeAll for the
    // complementary fix: warm the imports so the work leaves the body.
    testTimeout: 30_000,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // `apps/web/e2e/p1.spec.ts` (Task 17) is a Playwright spec, run only
    // via `bunx playwright test` (see playwright.config.ts's own
    // `testDir: './e2e'`) — never by vitest. Without this exclude,
    // vitest's own default include glob (`**/*.{test,spec}.*`) would
    // match it too (its filename ends in `.spec.ts`, same as every other
    // spec/test file in this repo) and `bun run test` would try to run
    // Playwright's `test`/`expect` against jsdom, an incompatible API
    // surface. `node_modules`/`dist` are listed explicitly alongside
    // `e2e` rather than left to vitest's own default `exclude` —
    // specifying this option replaces that default rather than
    // extending it.
    exclude: ['**/node_modules/**', '**/dist/**', './e2e/**'],
  },
});
