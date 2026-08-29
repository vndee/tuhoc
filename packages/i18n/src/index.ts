import { en } from './messages/en';
import { vi, type Messages } from './messages/vi';

export type { Messages };

/**
 * CATALOG DÙNG CHUNG — và một hàm tra cứu THUẦN. Không gì khác.
 *
 * MỘT ứng dụng đọc tệp này hôm nay (`apps/web`), và gói vẫn ĐỨNG RIÊNG. Nó ra
 * đời cho HAI: Pha 1 có thêm một kho khoá ở origin riêng giữ key của người
 * học, và chính ứng dụng thứ hai ấy là lý do gói này không được phép có phụ
 * thuộc nào — mọi thứ nạp vào origin giữ key đều là mã đọc được key, nên danh
 * sách phụ thuộc ở đó là bề mặt tấn công chứ không phải tiện nghi. Ba đường đã
 * được cân (QĐ-1 trong kế hoạch): kho khoá nhập thẳng `apps/web/src/i18n`
 * (ghép nó vào cây nguồn của trang chính — chính thứ kiến trúc kia sinh ra để
 * tách), một catalog thứ hai riêng cho nó (hai bản sẽ trôi khác nhau; repo này
 * đã đo *"một bộ luật, ba bản, bất đồng 7/12 hàng"*), hoặc gói dùng chung này.
 *
 * Task 16 gỡ kho khoá, và gói này KHÔNG bị gộp ngược vào `apps/web/src/i18n`
 * theo. Lý do là thứ nó mua được đã tách khỏi lý do nó ra đời: `packages/
 * course-format` và `tools/registry` đọc được một gói không phụ thuộc gì mà
 * không kéo theo React, còn một catalog nằm trong `apps/web/src` thì không.
 * Gộp lại là một thay đổi kiến trúc có cái giá riêng, không phải hệ quả tự
 * động của việc bớt một người đọc.
 *
 * Ràng buộc làm cho gói này an toàn — **không React, không DOM, không I/O,
 * không phụ thuộc runtime nào** — có CỔNG, không phải chỉ có chú thích này. Xem
 * `apps/web/src/i18n/i18n.test.ts` → `describe('packages/i18n — gói KHÔNG phụ
 * thuộc gì')`. Không có cổng ấy thì nó chỉ là lời hứa.
 *
 * Hệ quả cụ thể của "không DOM": `t()` trả về `string`. Câu có thẻ nằm GIỮA
 * chừng (`<strong>một đoạn trích</strong>`) đi qua `tNode()` ở
 * `apps/web/src/i18n/` — hàm ấy cần React, nên nó không sống được ở đây.
 */

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
 * Người học của nền tảng này viết tiếng Việt (mọi course trong `fixtures/`),
 * nên mặc định phải là thứ đúng cho đa số. Và `navigator.language` bị cố ý bỏ
 * qua ở lần tải đầu: nó là một PHỎNG ĐOÁN về người ngồi trước máy dựa trên cấu
 * hình hệ điều hành — một máy tính mua ở nước ngoài, một máy trong phòng lab,
 * một trình duyệt cài sẵn tiếng Anh đều cho ra câu trả lời sai, và cái sai ấy
 * im lặng. Một mặc định cố định thì đoán sai theo cách người dùng sửa được bằng
 * một lần bấm, và lần bấm ấy được nhớ lại.
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
 * đã từng lệch pha một lần trong repo này. Ở trang chính chỉ có một nguồn —
 * state của `<LanguageProvider>`.
 */
export function t<K extends MessageKey>(lang: Lang, key: K, ...args: MessageArgs<Messages[K]>): string {
  const value = MESSAGES[lang][key] as unknown as string | ((...args: readonly unknown[]) => string);
  return typeof value === 'function' ? value(...(args as readonly unknown[])) : value;
}

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
