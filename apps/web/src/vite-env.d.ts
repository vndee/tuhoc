/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin the api client (src/api/client.ts) prefixes onto every request
   * path. Unset in dev/test — requests resolve against the current
   * origin. Set in production (apps/web's Pages deploy) to the API's own
   * origin, since the static site and the API are deployed separately —
   * see docs/deploy.md.
   */
  readonly VITE_API_URL?: string;

  /**
   * Origin của kho khoá (`apps/vault`) — khung ẩn giữ key của người học ở một
   * origin RIÊNG, để `localStorage` của nó nằm ngoài tầm với của mọi thứ chạy
   * trên trang chính.
   *
   * Dev: `http://localhost:5174` (xem `.env.development`). Prod: origin thật
   * mà kho khoá được deploy tới. Không đặt ⇒ tính năng AI vắng mặt và
   * `useAI` báo mã `unavailable`; đặt SAI hình dạng ⇒ `resolveVaultOrigin`
   * ném, `VaultFrameProvider` bắt và hét vào console. Cả hai nhánh đều có bài
   * kiểm — vì mọi cách hỏng khác đều cho đúng một triệu chứng câm: "AI không
   * trả lời".
   *
   * Phải khớp `VITE_APP_ORIGIN` của kho khoá theo chiều ngược lại: kho khoá
   * chỉ nói chuyện với đúng một origin, và ở dev đó là `http://localhost:5173`
   * (`strictPort: true` trong `vite.config.ts` giữ cho nó không trôi).
   */
  readonly VITE_VAULT_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
