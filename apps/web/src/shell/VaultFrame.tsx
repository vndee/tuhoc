import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { VaultClient, resolveVaultOrigin } from '../ai/vaultClient';
import { DEFAULT_LANG, readStoredLang, t } from '../i18n';
import { useLanguage } from '../i18n/LanguageProvider';

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
  // Ngôn ngữ đọc thẳng từ thiết bị: hàm này là hàm tự do, chạy trước mọi hook
  // của component gọi nó, nên `useLanguage()` không dùng được ở đây.
  const lang = readStoredLang() ?? DEFAULT_LANG;
  try {
    return resolveVaultOrigin(import.meta.env, lang);
  } catch (e) {
    console.error(t(lang, 'vault.frame.configError'), e);
    return null;
  }
}

/**
 * Ổ KHOÁ NHỎ trên thanh tiêu đề của khung. Trang trí? Không hẳn: nó là thứ
 * phân biệt thanh này với mọi thanh tiêu đề khác của ứng dụng trong một cái
 * liếc, và nó nằm cạnh ĐỊA CHỈ THẬT — nghĩa là cái nhìn đầu tiên đã nói được
 * "chỗ này khác chỗ kia".
 */
function LockGlyph() {
  return (
    <svg
      className="vault-lock"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="6.5" rx="1.5" />
      <path d="M5.5 7V4.8a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

export function VaultFrameProvider({ origin, children }: VaultFrameProviderProps) {
  const resolved = origin === undefined ? originFromBuildConfig() : origin;
  const { lang, t: translate, tNode } = useLanguage();

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
    if (resolved === null || !frameEl || !target) {
      setClient(null);
      return;
    }
    const c = new VaultClient({ vaultOrigin: resolved, target, lang });
    setClient(c);

    /**
     * NGÔN NGỮ ĐI VÀO BẰNG THÔNG ĐIỆP, VÀ ĐƯỢC GỬI HAI LẦN CÓ CHỦ Ý.
     *
     * Một `postMessage` tới một khung **chưa nạp xong** rơi vào hư không: chưa
     * có trình nghe nào ở đầu kia, và không có lỗi nào báo. Nên:
     *
     *   - **gửi ngay** — đúng cho mọi lần effect chạy lại SAU lần đầu (đổi ngôn
     *     ngữ), lúc tài liệu đã nạp từ lâu;
     *   - **gửi lại ở `load`** — đúng cho lần đầu, và cho mọi lần khung nạp lại
     *     vì bất kỳ lý do nào (người dùng bấm reload trong khung, khung bị treo
     *     rồi tự nạp lại).
     *
     * Hai chiều này phủ được cả hai thứ tự có thể xảy ra giữa "effect chạy" và
     * "khung nạp xong", nên không có cửa sổ nào để kho khoá kẹt ở tiếng mặc
     * định.
     */
    c.setLang(lang);
    const onLoad = (): void => {
      c.setLang(lang);
    };
    frameEl.addEventListener('load', onLoad);

    return () => {
      frameEl.removeEventListener('load', onLoad);
      // Bắt buộc: mỗi `VaultClient` gắn một listener trên `window`, và một
      // listener không được gỡ sẽ sống lâu hơn khung nó phục vụ.
      c.dispose();
      setClient(null);
    };
    // `lang` nằm trong danh sách vì HAI lý do bây giờ: các câu lỗi mà
    // `VaultClient` tự dựng (`timeout`, `aborted`) được gắn ngôn ngữ lúc dựng
    // client, và đây là chỗ duy nhất báo cho kho khoá biết ngôn ngữ đã đổi.
  }, [resolved, frameEl, lang]);

  const value = useMemo<VaultFrameHandle>(
    () => ({ client, origin: resolved, expanded, setExpanded }),
    [client, resolved, expanded],
  );

  return (
    <VaultFrameContext.Provider value={value}>
      {children}
      {resolved !== null && (
        /*
         * Bọc CỐ ĐỊNH, không đổi theo `expanded`: React sẽ THÁO VÀ GẮN LẠI một
         * `<iframe>` bị đổi cha, và gắn lại một khung nghĩa là nạp lại tài liệu
         * ở origin kia — tức là xoá sạch key mà người dùng đang gõ dở trong đó.
         * Chỉ `className` đổi, nên phần tử khung giữ nguyên qua mọi lần mở/đóng.
         */
        <div className={expanded ? 'vault-overlay' : undefined}>
          {/*
            THẺ, không phải một mặt phẳng tràn viền — và cái bọc này CÓ MẶT ở
            cả hai trạng thái, chỉ `className` đổi.

            Đó là cùng một luật với lớp bọc bên ngoài, vì cùng một lý do: React
            THÁO VÀ GẮN LẠI một `<iframe>` bị đổi cha, và gắn lại nghĩa là nạp
            lại tài liệu ở origin kia — xoá sạch key mà người dùng đang gõ dở.
            Một `{expanded && <div className="vault-card">…}` bọc quanh khung sẽ
            đúng như thế. Nên `<div>` này luôn ở đây; chỉ lớp CSS của nó đổi.

            Vì sao là THẺ chứ không phải cả màn hình: lớp phủ VẪN che kín trang
            (`inset: 0`, và `s3.spec.ts` kịch bản 5a đo đúng điều đó bằng
            `elementFromPoint`), nhưng nền của nó nay trong mờ. Người dùng nhìn
            thấy trang Cài đặt còn nguyên ở phía dưới và một tấm khác nổi lên
            trên — tức là **thấy** hai mặt phẳng, thay vì được kể rằng có hai.
          */}
          <div className={expanded ? 'vault-card' : undefined}>
            {expanded && (
              <div className="vault-overlay-bar">
                {/*
                  ĐỊA CHỈ THẬT, không phải chữ "một địa chỉ riêng": `resolved` là
                  chính origin mà `src` của khung trỏ tới, nên nhãn này không thể
                  đúng trong khi cơ chế đã hỏng. Một bản dựng lỡ trỏ kho khoá về
                  origin trang chính sẽ TỰ NÓI RA điều đó ngay tại chỗ người dùng
                  sắp dán key.
                */}
                <span className="vault-overlay-title">
                  <LockGlyph />
                  {tNode('vault.frame.overlayLabel', <strong data-testid="vault-origin">{resolved}</strong>)}
                </span>
                {/*
                  Nút đóng nằm ở ĐÂY chứ không ở trang cấu hình: lớp phủ che kín
                  trang bên dưới, nên một nút "Đóng" nằm dưới lớp phủ là một nút
                  không ai bấm được.
                */}
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setExpanded(false);
                  }}
                >
                  {translate('vault.frame.close')}
                </button>
              </div>
            )}
            <iframe
            ref={setFrameEl}
            // Origin, không đường dẫn: cổng khác = origin khác = trình duyệt
            // cách ly `localStorage`. Một đường dẫn `/vault/` trên cùng cổng sẽ
            // là CÙNG origin và phá huỷ toàn bộ mục đích của hệ thống con này.
            //
            // ─────────────────────────────────────────────────────────────────
            // KHÔNG THAM SỐ TRUY VẤN. `src` NÀY LÀ MỘT HẰNG SỐ, VÀ ĐÓ LÀ CẢ CƠ
            // CHẾ — ĐỪNG GẮN GÌ VÀO ĐÂY.
            // ─────────────────────────────────────────────────────────────────
            //
            // Task 5 gắn `?lang=` vào đây để nói cho kho khoá biết ngôn ngữ
            // người đọc, với lập luận rằng ngôn ngữ hiển thị không đáng một
            // thay đổi giao thức (S2-F8) vì *"sai lệch tệ nhất của nó là chữ
            // sai tiếng"*.
            //
            // **Task 7 đo, và sai lệch tệ nhất KHÔNG phải chữ sai tiếng.** Bất
            // cứ thứ gì trong `src` mà đổi theo trạng thái đều làm trình duyệt
            // NẠP LẠI tài liệu ở origin kho khoá — và tài liệu ấy chứa ô dán
            // key. Đổi ngôn ngữ trong lúc đang gõ key ⇒ **ô trống trơn, không
            // một lời cảnh báo.**
            //
            // Lập luận chống đỡ của Task 5 là bố cục: *"khung khi mở là lớp phủ
            // che kín trang, nên không ai với tới bộ chọn ngôn ngữ"*. Nó chỉ
            // đúng cho CON TRỎ. Hai đường khác đo được:
            //
            //   · BÀN PHÍM — `z-index` quyết định chuyện vẽ và chuyện bấm,
            //     không quyết định chuyện tiêu điểm. 16 lần Tab từ ô key là tới
            //     `#lang-select` (đường đi in nguyên văn ở `task-7-report.md`);
            //   · CHUỘT, qua nút "Đóng" ngay trên — đóng lớp phủ KHÔNG tháo
            //     khung và KHÔNG xoá ô key, nên gõ dở → đóng → đổi ngôn ngữ
            //     bằng chuột cũng mất trắng.
            //
            // Nên ngôn ngữ đi bằng **thông điệp** (`kind: 'setLang'`, gửi ở
            // effect ngay trên). Đó là một thay đổi giao thức, và câu trả lời
            // cho câu hỏi mà S2-F8 bắt buộc — *"thông điệp này có mang được key
            // ra khỏi origin kho khoá không"* — được viết ra tại chỗ khai báo
            // trong `apps/vault/src/protocol.ts`. Tóm tắt: **không** — nó một
            // chiều đi vào, không có hồi đáp nào trong `VaultResponse`, và
            // nhánh xử lý nó không đọc keystore.
            //
            // Cái mua được không chỉ là đường bàn phím: khung **không còn lý do
            // nào để remount**, nên cả lớp lỗi biến mất thay vì bị vá một
            // nhánh.
            src={`${resolved}/`}
            title={translate('vault.frame.title')}
            // `allow-same-origin` ở đây là same-origin với CHÍNH KHO KHOÁ,
            // không phải với trang chính. Thiếu nó, khung nhận một origin mờ
            // đục và `localStorage` của nó ném — kho khoá không cất được gì. Vì
            // khung khác origin với trang chính, cờ này không trả lại cho nó
            // quyền nào trên trang chính.
            //
            // `allow-forms` KHÔNG có mặt, và điều đó có chủ ý: form cấu hình
            // của kho khoá dựng DOM bằng tay và không dùng phần tử `<form>`
            // nào, nên nó không cần cờ này — còn cờ này thì cho phép gửi dữ
            // liệu đi bằng một `<form action=…>`, tức là đúng một đường mang
            // key ra ngoài mà không cần `fetch`.
            sandbox="allow-scripts allow-same-origin"
            aria-hidden={expanded ? undefined : 'true'}
            // Khung `display:none` VẪN nạp tài liệu và VẪN chạy script — đó là
            // lý do dùng nó thay vì không gắn khung khi chưa cần.
            style={expanded ? { width: '100%', height: '100%', border: 0 } : { display: 'none' }}
            data-testid="vault-frame"
            />
          </div>
        </div>
      )}
    </VaultFrameContext.Provider>
  );
}
