import { normalizeLang } from '@tuhoc/i18n';
import { readLocalStorage, type LocalStorageKey } from '../db/local';

/**
 * NỬA "CÓ TRẠNG THÁI" của i18n ở trang chính.
 *
 * Catalog và hàm tra cứu thuần sống ở `packages/i18n` — một gói KHÔNG phụ thuộc
 * gì, dùng chung với kho khoá (QĐ-1). Tệp này chỉ thêm thứ duy nhất mà gói ấy
 * không được phép biết: `localStorage` của trang chính.
 *
 * Re-export chứ không bắt mọi chỗ gọi nhập từ hai nơi: `useLanguage()` là đường
 * chính, và những chỗ cần `t()` thuần (mã không phải component) nhập
 * `@tuhoc/i18n` thẳng.
 */
export {
  DEFAULT_LANG,
  LANGS,
  MESSAGES,
  normalizeLang,
  t,
  type Lang,
  type MessageArgs,
  type MessageKey,
  type Messages,
  type Translate,
} from '@tuhoc/i18n';

import type { Lang } from '@tuhoc/i18n';

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

/** Lựa chọn đã lưu của THIẾT BỊ NÀY, hoặc `null` nếu chưa từng chọn (hoặc giá trị đã lưu không đọc được). */
export function readStoredLang(): Lang | null {
  return normalizeLang(readLocalStorage(LANG_STORAGE_KEY));
}
