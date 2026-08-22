import { t as lookup } from '@tuhoc/i18n';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAndConsume } from './guard';
import { LANG_PARAM, currentLang, currentLocale, setVaultLang, t } from './lang';
import { applyLangFromLocation } from './main';
import { defaultSettingsDeps, renderSettings } from './ui/Settings';

/**
 * KHO KHOÁ NÓI ĐƯỢC HAI THỨ TIẾNG — và nó biết bằng cách nào.
 *
 * Lựa chọn ngôn ngữ sống trong `localStorage` của **origin trang chính**, và
 * trình duyệt cấm mã ở đây đọc nó. Đó không phải một trở ngại phải đi vòng: nó
 * là chính hàng rào mà cả hệ thống con này dựng lên. Nên ngôn ngữ được TRUYỀN
 * VÀO qua `?lang=` trên `src` của khung, chứ không được LẤY.
 *
 * Ba bài dưới đây canh ba nửa khác nhau của cùng một lời hứa, và không bài nào
 * thay được bài nào:
 *
 *   1. tham số URL được đọc, và **rác thì lùi về mặc định** — đầu vào tới từ
 *      ngoài origin này, nên nó là dữ liệu chưa tin được;
 *   2. chữ **THẬT SỰ ĐỔI** trên màn hình cấu hình — nơi có ô nhập key;
 *   3. câu từ chối của **người gác** cũng đổi, vì nó đi ngược qua
 *      `postMessage` tới trang chính và hiện ra ở đó.
 */

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.textContent = '';
  setVaultLang('vi');
});

afterEach(() => {
  setVaultLang('vi');
});

describe('kho khoá đọc ngôn ngữ từ tham số URL', () => {
  it('nhận hai giá trị hợp lệ và LÙI VỀ MẶC ĐỊNH với mọi thứ khác', () => {
    expect(setVaultLang('en')).toBe('en');
    expect(setVaultLang('vi')).toBe('vi');

    // Rác, thiếu, và một giá trị "gần đúng" — cả ba phải cho ra mặc định, chứ
    // không được ném và cũng không được lọt vào `MESSAGES[…]` như một khoá lạ.
    for (const bad of ['fr', 'VI', '', 'vi-VN', null, undefined]) {
      expect(setVaultLang(bad)).toBe('vi');
    }
  });

  it('`applyLangFromLocation` đọc đúng tham số, và ghi vào <html lang>', () => {
    applyLangFromLocation(`?${LANG_PARAM}=en`);
    expect(currentLang()).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    applyLangFromLocation('?something=else');
    expect(currentLang()).toBe('vi');
    expect(document.documentElement.lang).toBe('vi');
  });

  it('thẻ locale đi theo ngôn ngữ — ngày giờ và số của nhật ký dùng nó', () => {
    setVaultLang('vi');
    expect(currentLocale()).toBe('vi-VN');
    setVaultLang('en');
    expect(currentLocale()).toBe('en-US');
  });
});

/**
 * BÀI CHỊU LỰC. Hai bài trên chỉ chứng minh một biến được gán; bài này hỏi câu
 * duy nhất đáng hỏi — **chữ trên màn hình có đổi không**, ở đúng màn hình có ô
 * dán key.
 *
 * So-bằng-đúng với catalog chứ không với một chuỗi chép tay: một bản dịch bị
 * sửa thì bài này đi theo, còn một `renderSettings` quên `t()` ở một nhãn thì
 * nhãn ấy vẫn là tiếng Việt trong lúc phần còn lại đã sang tiếng Anh — và
 * `every`-so-sánh dưới đây đỏ.
 */
describe('màn cấu hình vẽ bằng ĐÚNG ngôn ngữ được truyền vào', () => {
  function renderIn(lang: 'vi' | 'en'): string {
    setVaultLang(lang);
    const root = document.createElement('div');
    document.body.appendChild(root);
    renderSettings(root, defaultSettingsDeps());
    return root.textContent ?? '';
  }

  it('mọi nhãn của màn hình đổi theo, không sót cái nào', () => {
    const keys = [
      'vault.settings.title',
      'vault.settings.why',
      'vault.settings.providerLabel',
      'vault.settings.modelLabel',
      'vault.settings.modelHint',
      'vault.settings.keyLabel',
      'vault.settings.keyHint',
      'vault.settings.save',
      'vault.settings.test',
      'vault.settings.clear',
      'vault.settings.noKey',
      'vault.log.title',
      'vault.consent.askTitle',
      'vault.consent.allow',
    ] as const;

    const viText = renderIn('vi');
    const missingVi = keys.filter((k) => !viText.includes(lookup('vi', k)));
    expect(missingVi).toEqual([]);

    const enText = renderIn('en');
    const missingEn = keys.filter((k) => !enText.includes(lookup('en', k)));
    expect(missingEn).toEqual([]);

    // ĐỐI CHỨNG: bản tiếng Anh không được còn mang chữ tiếng Việt của cùng khoá.
    // Không có nó, một `renderSettings` nối cả hai bản dịch vào nhau cũng đạt.
    const leftOver = keys.filter((k) => enText.includes(lookup('vi', k)));
    expect(leftOver).toEqual([]);
  });

  it('ô dán key giữ nguyên `type="password"` ở cả hai ngôn ngữ', () => {
    for (const lang of ['vi', 'en'] as const) {
      setVaultLang(lang);
      const root = document.createElement('div');
      document.body.appendChild(root);
      renderSettings(root, defaultSettingsDeps());
      const secret = root.querySelector<HTMLInputElement>('input[data-role="secret"]');
      expect(secret?.type).toBe('password');
      expect(secret?.placeholder).toBe(lookup(lang, 'vault.settings.keyPlaceholder'));
    }
  });
});

/**
 * Câu từ chối của người gác đi NGƯỢC qua `postMessage` và hiện ra ở trang
 * chính. Nó phải nói tiếng của người đọc vì đúng lý do mà cả cơ chế xác nhận
 * tồn tại: người dùng chỉ dừng lại được nếu họ đọc hiểu câu đang giải thích vì
 * sao mọi thứ vừa dừng.
 */
describe('câu từ chối của người gác đi theo ngôn ngữ', () => {
  it('cùng một lời gọi bị chặn cho ra hai câu khác nhau ở hai ngôn ngữ', () => {
    setVaultLang('vi');
    const viDecision = checkAndConsume({ chars: 10, providerId: 'deepseek' });
    expect(viDecision.allow).toBe(false);
    expect(viDecision.message).toBe(t('vault.guard.needsConsent'));

    setVaultLang('en');
    const enDecision = checkAndConsume({ chars: 10, providerId: 'deepseek' });
    expect(enDecision.allow).toBe(false);
    expect(enDecision.message).toBe(lookup('en', 'vault.guard.needsConsent'));
    expect(enDecision.message).not.toBe(lookup('vi', 'vault.guard.needsConsent'));
  });
});
