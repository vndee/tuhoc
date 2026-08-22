import { readLocalStorage, type LocalStorageKey } from '../db/local';
import { en } from './messages/en';
import { vi, type Messages } from './messages/vi';

export type { Messages };

/**
 * Hai ngôn ngữ của GIAO DIỆN NỀN TẢNG (spec §4.2). Ngôn ngữ của một *course*
 * là chuyện khác hẳn và không đi qua đây: course viết bằng ngôn ngữ nào cũng
 * được, và cái người học cần là một **nhãn** để biết mình sắp kéo về thứ gì —
 * xem `registry/types.ts`'s `lang` và HC-3 trong kế hoạch.
 */
export type Lang = 'vi' | 'en';

/** Thứ tự ở đây là thứ tự người dùng thấy trong bộ chọn. */
export const LANGS: readonly Lang[] = ['vi', 'en'];

/**
 * Tiếng Việt là mặc định, không phải tiếng Anh và không phải `navigator.language`.
 *
 * Người học của nền tảng này viết tiếng Việt (mọi course trong `fixtures/`,
 * mọi chuỗi trong 36 tệp mà Task 5 sắp bóc), nên mặc định phải là thứ đúng cho
 * đa số. Và `navigator.language` bị cố ý bỏ qua ở lần tải đầu: nó là một PHỎNG
 * ĐOÁN về người ngồi trước máy dựa trên cấu hình hệ điều hành — một máy tính
 * mua ở nước ngoài, một máy trong phòng lab, một trình duyệt cài sẵn tiếng Anh
 * đều cho ra câu trả lời sai, và cái sai ấy im lặng. Một mặc định cố định thì
 * đoán sai theo cách người dùng sửa được bằng một lần bấm, và lần bấm ấy được
 * nhớ lại.
 */
export const DEFAULT_LANG: Lang = 'vi';

export const MESSAGES: Record<Lang, Messages> = { vi, en };

export type MessageKey = keyof Messages;

/**
 * Tham số mà một khoá đòi hỏi: đúng tham số của hàm khi giá trị là hàm, và
 * KHÔNG tham số nào khi giá trị là chuỗi. Nhờ nó, `t('vi', 'lang.name.en', 3)`
 * không biên dịch được, và `t('vi', 'library.courseCount')` cũng vậy.
 */
export type MessageArgs<Value> = Value extends (...args: infer A) => string ? A : [];

/** `t()` đã gắn sẵn ngôn ngữ hiện tại — thứ `useLanguage()` trả về. */
export type Translate = <K extends MessageKey>(key: K, ...args: MessageArgs<Messages[K]>) => string;

/**
 * Tra cứu THUẦN — không React, không trạng thái toàn cục, ngôn ngữ là tham số.
 *
 * Viết thuần chứ không đọc một biến "ngôn ngữ hiện tại" ở tầm module là quyết
 * định có lý do: một biến như thế là bản sao THỨ HAI của một trạng thái mà
 * React đã giữ, và `theme/ThemeContext.tsx` tồn tại chính vì bản sao thứ hai ấy
 * đã từng lệch pha một lần trong repo này. Ở đây chỉ có một nguồn — state của
 * `<LanguageProvider>`, khởi tạo từ `localStorage`.
 *
 * Hệ quả cho Task 5, nói ra ở đây vì nó là một quyết định chưa ai chốt: mã KHÔNG
 * phải component (`api/client.ts`, `course/import.ts` — riêng tệp sau có 75
 * chuỗi) không có chỗ nào để lấy `lang`. Hai đường, và chúng khác nhau về chất:
 * ném/trả về **mã lỗi** rồi dịch ở chỗ vẽ (đúng hơn: một `Error` không biết ai
 * sẽ đọc nó), hoặc truyền `lang` xuống. Đừng thêm một biến toàn cục để né việc
 * chọn.
 */
export function t<K extends MessageKey>(lang: Lang, key: K, ...args: MessageArgs<Messages[K]>): string {
  const value = MESSAGES[lang][key] as unknown as string | ((...args: readonly unknown[]) => string);
  return typeof value === 'function' ? value(...(args as readonly unknown[])) : value;
}

/**
 * Khoá `localStorage` giữ lựa chọn ngôn ngữ.
 *
 * Khai ở `db/local.ts` và chỉ được ĐẶT TÊN LẠI ở đây, đúng khuôn
 * `theme/useTheme.ts`: ở đó nó được phân loại là **tuỳ chọn của thiết bị**, tức
 * danh sách mà `clearLocalData()` cố ý không đụng tới. Một chuỗi, một chủ sở
 * hữu — và lời hứa "đăng nhập bằng tài khoản khác không đổi ngôn ngữ của máy
 * này" chỉ chắc bằng đúng cái phân loại ấy.
 *
 * Kiểu `LocalStorageKey` là nửa cưỡng chế lúc biên dịch: `readLocalStorage` /
 * `writeLocalStorage` không nhận gì khác, nên không thêm được một khoá chưa
 * phân loại.
 */
export const LANG_STORAGE_KEY: LocalStorageKey = 'itbook-lang';

/**
 * Một chuỗi bất kỳ → `Lang`, hoặc `null` cho "không phải ngôn ngữ ta biết".
 *
 * `null` chứ không phải `DEFAULT_LANG`: chỗ gọi phải tự nói ra nó muốn gì khi
 * gặp rác. `MESSAGES['fr']` là `undefined`, và một `undefined` len được vào đây
 * sẽ ném ở lần tra cứu đầu tiên, giữa lúc vẽ trang.
 */
export function normalizeLang(value: string | null | undefined): Lang | null {
  return value === 'vi' || value === 'en' ? value : null;
}

/** Lựa chọn đã lưu của THIẾT BỊ NÀY, hoặc `null` nếu chưa từng chọn (hoặc giá trị đã lưu không đọc được). */
export function readStoredLang(): Lang | null {
  return normalizeLang(readLocalStorage(LANG_STORAGE_KEY));
}
