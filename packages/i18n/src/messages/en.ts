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

  /* ══════════════════════════════════════════════════════════════════════ *
   * KHO KHOÁ (`apps/vault`)
   * ══════════════════════════════════════════════════════════════════════ */

  'vault.guard.needsConsent': 'The first call of a session needs one confirming click inside the key vault panel.',
  'vault.guard.unmeasurable': 'The key vault could not measure the length of this prompt, so it refused to send it.',
  'vault.guard.promptTooLong': 'This prompt is longer than an entire session budget, so the key vault will not send it.',
  'vault.guard.budgetSpent': 'This session has spent its character budget. Confirm again in the key vault panel.',
  'vault.guard.rateLimited': 'The key vault is rate-limiting so nobody can make calls on your key.',
  'vault.guard.bucketWriteFailed': 'The key vault could not record the rate-limit state, so it refused this call.',
  'vault.guard.budgetWriteFailed': 'The key vault could not record the character budget, so it refused this call.',

  'vault.keystore.missingProviderOrModel': 'writeConfig: providerId or model is missing.',
  'vault.keystore.emptyKey': 'writeConfig: empty key — the key vault does not store an unusable configuration.',

  'vault.protocol.version': (version: string) => `The key vault speaks protocol v${version}.`,
  'vault.protocol.unsupported': 'Not supported.',
  'vault.protocol.badChatShape': 'The chat request does not match the protocol shape.',
  'vault.provider.unknown': 'The key vault does not know this provider.',
  'vault.provider.notConfigured': 'No key is plugged into the key vault.',
  'vault.provider.callFailed': 'The key vault could not complete the call to the provider.',
  'vault.provider.unreachable': 'Could not reach the provider from the browser (network or CORS).',
  'vault.provider.badKey': 'The key was rejected.',
  'vault.provider.rateLimited': 'The provider is rate-limiting.',

  'vault.boot.originRequired': 'VITE_APP_ORIGIN is required — the key vault refuses to run without knowing whom to trust.',
  'vault.boot.originShape': (received: string) =>
    `VITE_APP_ORIGIN must be a proper origin (scheme://host[:port]) — no trailing "/", no path, no "*". Received ${received}.`,

  /** Ngắn ngang bản tiếng Việt: `settings.test.ts` ghim độ dài lời nhắc thử. */
  'vault.settings.testPrompt': 'Answer in exactly one word: OK',
  'vault.settings.openaiWarning':
    'Measured warning (2026-08-22): OpenAI blocks its text-generation endpoint with CORS when called directly from a browser — their error responses carry no Access-Control-Allow-Origin. The success path has not been measured, so OpenAI may not work here, and if it does, a wrong key will show up as "could not reach the provider" rather than "the key was rejected". Try "Test the connection" before trusting it. DeepSeek, OpenRouter, Groq and Anthropic have all been measured to work directly from a browser.',
  'vault.settings.title': 'An AI assistant running on your own key',
  'vault.settings.why':
    'The key field lives inside this frame, and this frame is a separate page on a separate origin. The browser forbids code on the lesson page from reading anything here — including the field below, including where the key is kept. The lesson page only sends questions in and receives text back; it never sees the key. That is why this field is not on the settings page outside.',
  'vault.settings.providerLabel': 'Provider',
  'vault.settings.modelLabel': 'Model',
  'vault.settings.modelHint': 'Leave it alone unless you have a specific reason to change it.',
  'vault.settings.keyPlaceholder': 'Paste your key here',
  'vault.settings.keyLabel': 'Your key',
  'vault.settings.keyHint':
    'The key stays in this browser, on this device. It is not synced, it never passes through our servers, and there is no way to recover it if you delete it — keep the original on your provider’s site.',
  'vault.settings.save': 'Save the key on this device',
  'vault.settings.test': 'Test the connection',
  'vault.settings.clear': 'Delete the key from this device',
  'vault.settings.currentKey': (providerId: string, model: string) =>
    `This device already has a key: ${providerId} · ${model}.`,
  'vault.settings.noKey': 'This device has no key yet.',
  'vault.settings.noKeyTyped': 'No key has been pasted into the field above.',
  'vault.settings.noModel': 'No model name.',
  'vault.settings.saved': 'The key is saved in this browser. Press "Test the connection" to be sure it works.',
  'vault.settings.clearArmed': 'Press again to delete',
  'vault.settings.clearWarning': 'Press again to delete the key from this browser for good. There is no way back.',
  'vault.settings.cleared': 'The key has been deleted from this browser.',
  'vault.settings.noKeyAnywhere': 'No key was pasted, and this device has no saved key for the selected provider.',
  'vault.settings.needsConsent':
    'The key vault has not been confirmed in this session. Press "Allow for this session" just below, then try again.',
  'vault.settings.denied': 'The key vault is refusing this call.',
  'vault.settings.calling': 'Calling the provider…',
  'vault.settings.emptyReply': 'The provider answered, but the model returned no text. Try another model.',
  'vault.settings.reply': (reply: string) => `The provider answered. The model said: «${reply}»`,
  'vault.settings.openaiHint': (message: string) =>
    `${message} (With OpenAI, see the CORS warning above — this error may not be about your key.)`,

  'vault.log.title': 'What the AI assistant has sent',
  'vault.log.blurb':
    'The log records when, and HOW MANY CHARACTERS, were sent. Prompt contents are not recorded here — a second copy of your private notes sitting next to your key is exactly what this key vault refuses to create.',
  'vault.log.empty': 'No calls yet.',
  'vault.log.total': (chars: string, calls: string) =>
    `${chars} characters have left this device in total, across ${calls} calls.`,
  'vault.log.entry': (when: string, chars: string, provider: string) => `${when} · ${chars} characters sent · ${provider}`,
  'vault.log.unknownProvider': 'unknown provider',
  'vault.log.denied': (rateLimited: string, needsConsent: string) =>
    `The key vault REFUSED ${rateLimited} calls for exceeding the rate limit and ${needsConsent} calls for not being confirmed.`,
  'vault.log.clear': 'Clear the log',
  'vault.consent.askAgainTitle': 'The AI assistant asks to keep calling on your key',
  'vault.consent.askTitle': 'The AI assistant wants to call out on your key',
  'vault.consent.askAgainBody':
    'The key vault stopped and asked again before sending more. The log just below shows how much text has left this device — look at it before pressing this time, because every press opens the way for roughly that much again. If the number is larger than what you remember asking, do not press.',
  'vault.consent.askBody':
    'The lesson page has asked the key vault to call an AI provider. The key vault lets no call out until you press the button below, and that press only holds for the current session.',
  'vault.consent.allow': 'Allow for this session',
};
