import type { Messages } from './vi';

/**
 * Bản tiếng Anh. Chú thích kiểu `: Messages` là CỔNG — không phải tài liệu.
 *
 * ĐO ĐƯỢC ngày 2026-08-22 trong chính `apps/web`, chép nguyên văn, hai chiều —
 * tệp bị đột biến rồi khôi phục trong CÙNG một lệnh shell, `shasum` khớp cả
 * trước lẫn sau (c7e1c51d…):
 *
 *   XOÁ một khoá (`'lang.switcher.label'`):
 *
 *     src/i18n/messages/en.ts(21,14): error TS2741: Property
 *     ''lang.switcher.label'' is missing in type '{ 'lang.name.vi': string;
 *     'lang.name.en': string; 'library.courseCount': (count: number) => string;
 *     }' but required in type '{ 'lang.name.vi': string; 'lang.name.en':
 *     string; 'lang.switcher.label': string; 'library.courseCount': (count:
 *     number) => string; }'.
 *
 *     mã thoát THÔ: 2
 *
 *   THÊM một khoá (`'lang.name.fr'`):
 *
 *     src/i18n/messages/en.ts(25,3): error TS2353: Object literal may only
 *     specify known properties, and ''lang.name.fr'' does not exist in type
 *     '{ 'lang.name.vi': string; … }'.
 *
 *     mã thoát THÔ: 2
 *
 *   Sau khi khôi phục: mã thoát THÔ 0.
 *
 * Hai catalog không trôi dạt được theo chiều nào cả. Và vì `make test-web` từ
 * task này chạy `bun run typecheck` trước vitest, cổng ấy có mặt thật chứ không
 * chỉ tồn tại khi ai đó nhớ gõ `tsc` bằng tay.
 */
export const en: Messages = {
  // Giống hệt bản tiếng Việt, có chủ ý — xem chú thích `lang.name.*` ở `vi.ts`.
  'lang.name.vi': 'Tiếng Việt',
  'lang.name.en': 'English',

  'lang.switcher.label': 'Interface language',

  /**
   * Luật số nhiều nằm TRONG bản dịch, và đây là chỗ nó chứng minh mình cần
   * thiết: tiếng Việt không đổi danh từ theo số, tiếng Anh thì có. Một chuỗi
   * `'{count} courses'` sẽ cho ra "1 courses".
   */
  'library.courseCount': (count: number) => (count === 1 ? '1 course' : `${count} courses`),

  /* ── trang cấu hình TRỢ LÝ AI (`pages/Settings.tsx`) ───────────────────── */

  'settings.ai.title': 'AI assistant',
  /**
   * Chỗ trống nằm ở VỊ TRÍ KHÁC so với bản tiếng Việt, và đó chính là lý do câu
   * này là một khoá chứ không phải ba mảnh ghép trong JSX.
   */
  'settings.ai.blurb': (vault: string) =>
    `You use your own key, and that key is kept in the ${vault} — a separate page served from a separate address, which opens over this one when you come here. The browser forbids code on the lesson page from reading anything inside the key vault, so an interactive course that slipped through review still cannot take your key. That is why the key field lives in the vault and not on this page.`,
  'settings.ai.blurbVault': 'key vault',
  'settings.ai.keyStays':
    'Your key never leaves this browser: it is not synced between devices and never passes through our servers. On a new machine you enter it again; if you delete it, it cannot be recovered.',
  'settings.ai.unavailable':
    'This build has no key vault, so the AI assistant is unavailable. That is a deployment configuration gap, not a problem with your account — reading the course still works normally.',
  'settings.ai.open': 'Open the key vault',
};
