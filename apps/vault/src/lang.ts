import {
  DEFAULT_LANG,
  normalizeLang,
  t as lookup,
  type Lang,
  type MessageArgs,
  type MessageKey,
  type Messages,
} from '@tuhoc/i18n';

/**
 * NGÔN NGỮ CỦA KHO KHOÁ — và làm sao nó biết được.
 *
 * ── Vấn đề ────────────────────────────────────────────────────────────────
 * Lựa chọn ngôn ngữ của người học sống trong `localStorage` của **origin trang
 * chính**. Trình duyệt cấm mã ở đây đọc nó — đó là toàn bộ lý do kho khoá tồn
 * tại, nên "đọc ké" không phải một lựa chọn và cũng không nên là một mong muốn.
 *
 * ── Đường đã chọn: MỘT THÔNG ĐIỆP `postMessage`, `kind: 'setLang'` ─────────
 * Trang chính gửi ngôn ngữ vào bằng giao thức (`apps/vault/src/protocol.ts`,
 * gửi từ `apps/web/src/ai/vaultClient.ts#setLang`, nối ở `VaultFrame.tsx`).
 *
 * ── ĐƯỜNG CŨ, VÀ VÌ SAO NÓ BỊ BỎ ──────────────────────────────────────────
 * Task 5 truyền ngôn ngữ bằng `?lang=` trong `src` của khung, với lập luận:
 * *"ngôn ngữ hiển thị không đáng một thay đổi giao thức (S2-F8), vì sai lệch
 * tệ nhất của nó là chữ sai tiếng"*, và với một lập luận về bố cục để chống
 * lại hệ quả nạp lại: *"bộ chọn ngôn ngữ nằm trên thanh công cụ, khung khi mở
 * là một lớp phủ che kín trang, nên không ai với tới bộ chọn trong lúc đang gõ
 * key"*. Chính báo cáo ấy nói thẳng rằng lập luận này *"đúng bằng đúng cái CSS
 * đang đúng"*.
 *
 * **Task 7 đo, và nó không đúng.** `src` đổi ⇒ trình duyệt NẠP LẠI tài liệu ở
 * origin này ⇒ **ô nhập key đang gõ dở trống trơn**. Lớp phủ chặn CON TRỎ,
 * không chặn TIÊU ĐIỂM: 16 lần Tab từ ô key là tới bộ chọn ngôn ngữ (đường đi
 * in nguyên văn ở `task-7-report.md` §4). Và đường bàn phím không phải đường
 * duy nhất — lớp phủ có nút "Đóng" của chính nó, nên gõ dở → đóng → đổi ngôn
 * ngữ bằng CHUỘT cũng xoá sạch ô ấy, vì khung vẫn gắn và vẫn giữ giá trị đang
 * gõ khi lớp phủ đóng.
 *
 * Nên cái giá thật của `?lang=` không phải *"chữ sai tiếng"* mà là **một key
 * gõ dở**, và giao thức là chỗ duy nhất trả được nó tận gốc: `src` từ nay là
 * một hằng số, khung **không còn lý do nào để nạp lại**, và cả lớp lỗi biến
 * mất chứ không riêng đường bàn phím. Câu trả lời S2-F8 cho thông điệp mới
 * nằm ngay tại chỗ khai báo nó, trong `protocol.ts`.
 *
 * ── Vì sao một biến ở tầm module ───────────────────────────────────────────
 * Kho khoá không có React và không có context. Nhưng vẫn chỉ có MỘT nguồn:
 * `setVaultLang` được gọi từ đúng một chỗ — nhánh `setLang` của `handleMessage`
 * trong `main.ts`. Đó là cùng ràng buộc mà `LanguageProvider` giữ ở trang chính
 * — một trạng thái, một chủ sở hữu — chỉ là bằng một cơ chế đơn giản hơn, vì
 * origin này cố ý không có cơ chế nào phức tạp hơn.
 *
 * ── Cái giá đã nhận, nói ra thay vì để im ─────────────────────────────────
 * Lần vẽ ĐẦU TIÊN của kho khoá dùng `DEFAULT_LANG`, vì thông điệp chỉ tới sau
 * khi tài liệu đã nạp xong. Điều đó không tới mắt ai: khung được gắn MỘT LẦN
 * lúc ứng dụng khởi động và **ẩn**, còn `setLang` được gửi ngay ở sự kiện
 * `load` của khung — rất lâu trước lần đầu người dùng mở lớp phủ ra.
 */

let current: Lang = DEFAULT_LANG;

/**
 * Đặt ngôn ngữ hiển thị. Nhận **chuỗi bất kỳ** chứ không nhận `Lang`: đầu vào
 * tới qua `postMessage`, tức là từ bên kia một ranh giới origin, nên nó là dữ
 * liệu chưa tin được và phép lọc phải nằm ở đây thay vì ở chỗ gọi. Trả về giá
 * trị đã áp dụng.
 */
export function setVaultLang(raw: string | null | undefined): Lang {
  current = normalizeLang(raw) ?? DEFAULT_LANG;
  return current;
}

/** Ngôn ngữ đang hiển thị. Dùng cho `toLocaleString` và `<html lang>`. */
export function currentLang(): Lang {
  return current;
}

/** Thẻ ngôn ngữ đầy đủ cho `toLocaleString` — ngày giờ và số có dấu phân nhóm. */
export function currentLocale(): string {
  return current === 'vi' ? 'vi-VN' : 'en-US';
}

/** `t()` đã gắn ngôn ngữ hiện tại của kho khoá. */
export function t<K extends MessageKey>(key: K, ...args: MessageArgs<Messages[K]>): string {
  return lookup(current, key, ...args);
}
