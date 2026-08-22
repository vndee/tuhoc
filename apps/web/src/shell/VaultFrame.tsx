import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { VaultClient, resolveVaultOrigin } from '../ai/vaultClient';

/**
 * KHUNG KHO KHOÁ — một khung ẩn, gắn ĐÚNG MỘT LẦN cho cả ứng dụng.
 *
 * Bí mật của người học sống trong `localStorage` của origin kho khoá
 * (`apps/vault`, cổng 5174 khi dev). Trình duyệt cấm JS của origin trang chính
 * đọc `localStorage` của origin khác, nên một course hạng `interactive` bị
 * duyệt sót vẫn không đọc được nó. Trang chính chỉ gửi lời nhắc vào khung này
 * và nhận chữ về.
 *
 * MỘT khung, không phải một khung mỗi panel: mỗi khung là một lần nạp tài liệu
 * ở origin kia, và nhiều khung nghĩa là nhiều `VaultClient` cùng nghe trên
 * `window` — mỗi cái sẽ thấy hồi đáp của tất cả các cái khác. Tương quan theo
 * `id` khiến chuyện đó vô hại hôm nay, nhưng nó là thứ không có lý do gì để tồn tại.
 */

export interface VaultFrameHandle {
  /** `null` khi bản build này không có kho khoá. */
  client: VaultClient | null;
  origin: string | null;
  /**
   * Khung ẩn khi chỉ dùng để hỏi–đáp. Task 6 dựng form nhập bí mật BÊN TRONG
   * khung — ô nhập phải nằm ở origin kho khoá, không phải một ô trên trang
   * chính rồi gửi vào, vì một ô trên trang chính đi qua DOM của trang chính và
   * một course độc đọc được nó bằng một listener `input`. Lúc ấy khung phải
   * hiện ra, và đây là chỗ nối sẵn cho việc đó.
   */
  expanded: boolean;
  setExpanded: (v: boolean) => void;
}

const EMPTY: VaultFrameHandle = {
  client: null,
  origin: null,
  expanded: false,
  setExpanded: () => {},
};

/**
 * Mặc định là "không có kho khoá" chứ không phải `undefined`: một `useAI` gọi
 * ngoài provider phải báo tính năng vắng mặt, không được ném và làm trắng trang
 * giáo trình.
 */
export const VaultFrameContext = createContext<VaultFrameHandle>(EMPTY);

export function useVaultFrame(): VaultFrameHandle {
  return useContext(VaultFrameContext);
}

/**
 * `undefined` ⇒ đọc từ cấu hình build. `null` ⇒ cố ý không có kho khoá.
 * Truyền tường minh là chỗ để test bơm giá trị vào.
 */
export interface VaultFrameProviderProps {
  origin?: string | null;
  children: ReactNode;
}

/**
 * VÌ SAO CẤU HÌNH SAI Ở ĐÂY KHÔNG NÉM, TRONG KHI Ở KHO KHOÁ THÌ CÓ.
 *
 * Task 1 cho kho khoá **từ chối chạy** khi thiếu `VITE_APP_ORIGIN`, và đó là
 * đúng: việc duy nhất của kho khoá là biết tin ai, nên một kho khoá không biết
 * tin ai mà vẫn chạy là kho khoá tin nhầm người.
 *
 * Việc của trang chính là giáo trình. Một biến môi trường AI đặt sai không
 * được lấy đi khả năng đọc sách. Nên ở đây: ném từ `resolveVaultOrigin` (có
 * bài kiểm), bắt ngay tại biên này, hét vào console, và chạy tiếp KHÔNG có AI.
 *
 * Và nó không im lặng: `origin === null` ⇒ `useAI` hỏng ngay với mã
 * `unavailable`, tức là giao diện nói được "bản này không có AI" thay vì quay
 * một vòng tròn mãi mãi.
 */
function originFromBuildConfig(): string | null {
  try {
    return resolveVaultOrigin(import.meta.env);
  } catch (e) {
    console.error('[kho khoá] cấu hình sai, tính năng AI bị tắt:', e);
    return null;
  }
}

export function VaultFrameProvider({ origin, children }: VaultFrameProviderProps) {
  const resolved = origin === undefined ? originFromBuildConfig() : origin;

  const [frameEl, setFrameEl] = useState<HTMLIFrameElement | null>(null);
  const [client, setClient] = useState<VaultClient | null>(null);
  const [expanded, setExpanded] = useState(false);

  /**
   * `oxlint` cảnh báo `react(set-state-in-effect)` ở đây, và cảnh báo ấy được
   * GIỮ có chủ ý. Chính lời khuyên của luật nói ra ngoại lệ: "Use an effect
   * only when synchronizing with an external system." `contentWindow` của một
   * khung LÀ một hệ thống ngoài, và nó không tồn tại trước khi commit — nên
   * không có cách nào "derive during render".
   *
   * Cái giá phải trả, đo được và có thật: `client` rơi vào một commit SAU so
   * với lúc phần tử `<iframe>` vào DOM. Đó đúng là cái bẫy ruling P2 Task 5 đã
   * ghi (React Scheduler chỉ nhả sau ngân sách 5 ms, nên `waitFor` thắng vì
   * may chứ không vì đúng). Cách chống ở phía test là KHÔNG chờ: `render()` và
   * `act()` của RTL xả hàng đợi Scheduler đồng bộ, nên `VaultFrame.test.tsx`
   * và `useAI.test.tsx` không dùng `waitFor` một lần nào.
   *
   * Cách viết bằng `useMemo` bỏ được commit thừa VÀ bỏ được cảnh báo, nhưng nó
   * dựng `VaultClient` trong lúc render — mà `VaultClient` gắn listener lên
   * `window` ngay trong constructor. Dưới StrictMode, React gọi hàm `useMemo`
   * hai lần và vứt kết quả đầu; kết quả bị vứt ấy giữ một listener KHÔNG AI GỠ.
   * Đổi một cảnh báo lint lấy một rò rỉ listener là đổi sai chiều.
   */
  useEffect(() => {
    const target = frameEl?.contentWindow;
    if (resolved === null || !target) {
      setClient(null);
      return;
    }
    const c = new VaultClient({ vaultOrigin: resolved, target });
    setClient(c);
    return () => {
      // Bắt buộc: mỗi `VaultClient` gắn một listener trên `window`, và một
      // listener không được gỡ sẽ sống lâu hơn khung nó phục vụ.
      c.dispose();
      setClient(null);
    };
  }, [resolved, frameEl]);

  const value = useMemo<VaultFrameHandle>(
    () => ({ client, origin: resolved, expanded, setExpanded }),
    [client, resolved, expanded],
  );

  return (
    <VaultFrameContext.Provider value={value}>
      {children}
      {resolved !== null && (
        <iframe
          ref={setFrameEl}
          // Origin, không đường dẫn: cổng khác = origin khác = trình duyệt cách
          // ly `localStorage`. Một đường dẫn `/vault/` trên cùng cổng sẽ là
          // CÙNG origin và phá huỷ toàn bộ mục đích của hệ thống con này.
          src={`${resolved}/`}
          title="Kho khoá"
          // `allow-same-origin` ở đây là same-origin với CHÍNH KHO KHOÁ, không
          // phải với trang chính. Thiếu nó, khung nhận một origin mờ đục và
          // `localStorage` của nó ném — kho khoá không cất được gì. Vì khung
          // khác origin với trang chính, cờ này không trả lại cho nó quyền nào
          // trên trang chính.
          sandbox="allow-scripts allow-same-origin"
          aria-hidden={expanded ? undefined : 'true'}
          // Khung `display:none` VẪN nạp tài liệu và VẪN chạy script — đó là lý
          // do dùng nó thay vì không gắn khung khi chưa cần.
          style={expanded ? { width: '100%', height: '100%', border: 0 } : { display: 'none' }}
          data-testid="vault-frame"
        />
      )}
    </VaultFrameContext.Provider>
  );
}
