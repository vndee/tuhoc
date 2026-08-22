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
 * ── Đường đã chọn: THAM SỐ URL, đọc MỘT LẦN lúc nạp ────────────────────────
 * Trang chính gắn `?lang=` vào `src` của khung (`apps/web/src/shell/VaultFrame.tsx`).
 *
 * Ba lý do, theo thứ tự quan trọng:
 *
 *   1. **Không đổi giao thức.** `VaultRequest` là một union ĐÓNG mà cả hai phía
 *      phân nhánh theo, và S2-F8 xếp việc thêm thành viên vào đó là một thay
 *      đổi giao thức phải được người đọc bằng mắt. Ngôn ngữ hiển thị không đáng
 *      giá ấy.
 *   2. **Không có gì để mất khi sai.** Một `?lang=` bịa ra chỉ đổi CHỮ; nó
 *      không mở thêm quyền nào, không chạm key, không qua được `event.origin`.
 *      `normalizeLang` vứt mọi giá trị lạ về `null` và ta lùi về mặc định — nên
 *      giá trị xấu nhất mà một trang thù địch nhúng khung này đạt được là hiển
 *      thị tiếng Anh.
 *   3. **Đổi ngôn ngữ KHÔNG xoá key đang gõ dở.** Đây là điểm dễ sai nhất, và
 *      nó đúng vì một lý do đo được chứ không phải may: `src` của khung đổi thì
 *      trình duyệt NẠP LẠI tài liệu, tức là xoá ô nhập. Nhưng bộ chọn ngôn ngữ
 *      nằm trên thanh công cụ của trang chính, còn khung kho khoá **khi mở ra
 *      là một lớp phủ che kín trang bên dưới** (`VaultFrame.tsx` ghi lại chính
 *      điều đó khi giải thích vì sao nút "Đóng" phải nằm trên lớp phủ). Người
 *      dùng không với tới bộ chọn trong lúc đang gõ key, nên lần nạp lại duy
 *      nhất có thể xảy ra là lúc khung đang ẩn và trống.
 *
 * ── Vì sao một biến ở tầm module ───────────────────────────────────────────
 * Kho khoá không có React và không có context. Nhưng vẫn chỉ có MỘT nguồn: hàm
 * `setVaultLang` được gọi đúng một lần trong khối khởi động của `main.ts`, từ
 * `location.search`. Đó là cùng ràng buộc mà `LanguageProvider` giữ ở trang
 * chính — một trạng thái, một chủ sở hữu — chỉ là bằng một cơ chế đơn giản hơn,
 * vì origin này cố ý không có cơ chế nào phức tạp hơn.
 */

let current: Lang = DEFAULT_LANG;

/** Tên tham số truy vấn. Trang chính điền nó; ghim ở đây và ở `VaultFrame.tsx`. */
export const LANG_PARAM = 'lang';

/**
 * Đặt ngôn ngữ hiển thị. Nhận **chuỗi bất kỳ** chứ không nhận `Lang`: đầu vào
 * tới từ URL, tức là từ bên ngoài, nên nó là dữ liệu chưa tin được và phép lọc
 * phải nằm ở đây thay vì ở chỗ gọi. Trả về giá trị đã áp dụng.
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
