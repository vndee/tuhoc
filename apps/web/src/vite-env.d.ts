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

  /**
   * Địa chỉ GỐC của registry course — thư mục chứa `index.json`, và bên cạnh
   * nó là cây `courses/` (xem bước "gom cây course vào _site" trong
   * `.github/workflows/registry.yml`). Ví dụ:
   * `https://<tổ-chức>.github.io/<repo>`. KHÔNG kèm `/index.json`: một biến
   * cho cả hai đường, để Task 6 kéo gói về từ đúng nơi đã duyệt catalog.
   *
   * Không đặt ⇒ nền tảng dùng `PUBLIC_REGISTRY_BASE` trong
   * `src/registry/index.ts`. Hôm nay hằng số đó là `null` vì repo registry
   * công khai CHƯA tồn tại (xem chú thích của chính nó), nên màn `/catalog`
   * hiện một thông báo nêu đích danh biến này thay vì một lỗi mạng khó hiểu.
   *
   * Là địa chỉ của BÊN THỨ BA: `src/registry/index.ts` gọi nó bằng `fetch`
   * với `credentials: 'omit'`, KHÔNG qua `api/client.ts` — client ấy gửi
   * cookie phiên, và cookie phiên không có việc gì ở một máy chủ ta không sở
   * hữu.
   */
  readonly VITE_REGISTRY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
