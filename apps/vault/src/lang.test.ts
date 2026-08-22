import { t as lookup } from '@tuhoc/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkAndConsume } from './guard';
import { currentLang, currentLocale, setVaultLang, t } from './lang';
import { applyLang, handleMessage } from './main';
import { defaultSettingsDeps, renderSettings } from './ui/Settings';

/**
 * KHO KHOÁ NÓI ĐƯỢC HAI THỨ TIẾNG — và nó biết bằng cách nào.
 *
 * Lựa chọn ngôn ngữ sống trong `localStorage` của **origin trang chính**, và
 * trình duyệt cấm mã ở đây đọc nó. Đó không phải một trở ngại phải đi vòng: nó
 * là chính hàng rào mà cả hệ thống con này dựng lên. Nên ngôn ngữ được TRUYỀN
 * VÀO — bằng một thông điệp `kind: 'setLang'` — chứ không được LẤY.
 *
 * ── ĐƯỜNG CŨ, VÀ VÌ SAO NÓ ĐI ─────────────────────────────────────────────
 * Task 5 truyền ngôn ngữ bằng `?lang=` trên `src` của khung. Task 7 đo được
 * cái giá: `src` đổi ⇒ trình duyệt nạp lại tài liệu ở origin này ⇒ **ô dán key
 * đang gõ dở trống trơn**. Bài *"dịch lại KHÔNG được xoá key đang gõ dở"* dưới
 * đây là nửa đơn vị của cổng e2e đã bắt được lỗi ấy.
 *
 * Bốn bài dưới đây canh bốn nửa khác nhau của cùng một lời hứa, và không bài
 * nào thay được bài nào:
 *
 *   1. mã ngôn ngữ được áp, và **rác thì lùi về mặc định** — đầu vào tới từ
 *      ngoài origin này, nên nó là dữ liệu chưa tin được;
 *   2. thông điệp `setLang` **đi vào được, và KHÔNG có gì đi ra** — đó là câu
 *      trả lời S2-F8 cho thành viên mới của giao thức, dưới dạng một phép đo;
 *   3. chữ **THẬT SỰ ĐỔI** trên màn hình cấu hình — nơi có ô nhập key — và ô
 *      key **còn nguyên** sau khi đổi;
 *   4. câu từ chối của **người gác** cũng đổi, vì nó đi ngược qua
 *      `postMessage` tới trang chính và hiện ra ở đó.
 */

const APP_ORIGIN = 'http://localhost:5173';

/** Một thông điệp tới từ trang chính, đúng hình dạng `handleMessage` nhận. */
function fromApp(data: unknown, reply = (): void => {}): MessageEvent {
  return {
    origin: APP_ORIGIN,
    data,
    source: { postMessage: reply },
  } as unknown as MessageEvent;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.textContent = '';
  setVaultLang('vi');
});

afterEach(() => {
  setVaultLang('vi');
});

describe('kho khoá nhận ngôn ngữ từ một thông điệp', () => {
  it('nhận hai giá trị hợp lệ và LÙI VỀ MẶC ĐỊNH với mọi thứ khác', () => {
    expect(setVaultLang('en')).toBe('en');
    expect(setVaultLang('vi')).toBe('vi');

    // Rác, thiếu, và một giá trị "gần đúng" — cả ba phải cho ra mặc định, chứ
    // không được ném và cũng không được lọt vào `MESSAGES[…]` như một khoá lạ.
    for (const bad of ['fr', 'VI', '', 'vi-VN', null, undefined]) {
      expect(setVaultLang(bad)).toBe('vi');
    }
  });

  it('`applyLang` ghi vào <html lang>, và rác cũng ghi — về mặc định', () => {
    applyLang('en');
    expect(currentLang()).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    // Không ném, không để `<html lang>` kẹt ở giá trị cũ: một thẻ ngôn ngữ nói
    // dối còn tệ hơn một thẻ nói mặc định, vì trình đọc màn hình chọn giọng
    // theo nó.
    applyLang('klingon');
    expect(currentLang()).toBe('vi');
    expect(document.documentElement.lang).toBe('vi');

    applyLang(undefined);
    expect(currentLang()).toBe('vi');
  });

  /**
   * CÂU TRẢ LỜI S2-F8, DƯỚI DẠNG MỘT PHÉP ĐO.
   *
   * `docs/carried-forward.md` buộc mọi thành viên mới của `VaultRequest` phải
   * được một người đọc với đúng một câu hỏi: *"thông điệp này có mang được key
   * ra khỏi origin kho khoá không?"*. Câu trả lời cho `setLang` là **không**,
   * và lý do quan trọng nhất — **nó không có đường về** — là thứ đo được chứ
   * không phải thứ phải tin: nhánh này KHÔNG gọi `send` lấy một lần.
   *
   * Chốt `reply` không được gọi cũng chính là chốt "không có kênh nào để chở
   * gì về": nếu một ngày ai đó thêm một `ack`, dù chỉ mang `{ok: true}`, bài
   * này đỏ và người ấy phải quay lại đọc đoạn văn ở `protocol.ts`.
   */
  it('`setLang` đi VÀO được, và KHÔNG một byte nào đi ra', () => {
    const reply = vi.fn();
    handleMessage(fromApp({ v: 1, id: 'm1', kind: 'setLang', lang: 'en' }, reply), {
      allowedOrigin: APP_ORIGIN,
    });

    expect(currentLang()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    // KHÔNG hồi đáp. Không `ack`, không `error`, không gì cả.
    expect(reply).not.toHaveBeenCalled();
  });

  it('`setLang` KHÔNG đọc ô nhớ chứa key — nhánh này không chạm keystore', () => {
    // Cùng khuôn bẫy mà `keystore.test.ts` dùng cho đường `status`: liệt kê TÊN
    // ô nhớ là vô hại, chỉ `getItem` mới lấy được giá trị ra.
    const read: string[] = [];
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = function patched(this: Storage, k: string): string | null {
      read.push(k);
      return real.call(this, k);
    };
    try {
      handleMessage(fromApp({ v: 1, id: 'm2', kind: 'setLang', lang: 'en' }), {
        allowedOrigin: APP_ORIGIN,
      });
    } finally {
      Storage.prototype.getItem = real;
    }

    expect(read).not.toContain('tuhoc.vault.key');
    // Và không cả ô nhớ CÔNG KHAI: nhánh này không có lý do gì để hỏi kho khoá
    // đã cắm key chưa. Một cài đặt "tiện thể làm mới màn hình" sẽ hỏng chốt này
    // trước khi nó kịp hỏng thứ gì khác.
    expect(read).not.toContain('tuhoc.vault.config');
  });

  it('một thông điệp `setLang` từ origin LẠ không đổi được gì', () => {
    setVaultLang('vi');
    handleMessage(
      {
        origin: 'https://evil.example',
        data: { v: 1, id: 'm3', kind: 'setLang', lang: 'en' },
        source: { postMessage: () => {} },
      } as unknown as MessageEvent,
      { allowedOrigin: APP_ORIGIN },
    );
    expect(currentLang()).toBe('vi');
  });

  it('`setLang` thiếu trường `lang`, hoặc mang rác, lùi về mặc định — không ném', () => {
    setVaultLang('en');
    handleMessage(fromApp({ v: 1, id: 'm4', kind: 'setLang' }), { allowedOrigin: APP_ORIGIN });
    expect(currentLang()).toBe('vi');

    setVaultLang('en');
    handleMessage(fromApp({ v: 1, id: 'm5', kind: 'setLang', lang: { toString: () => 'en' } }), {
      allowedOrigin: APP_ORIGIN,
    });
    expect(currentLang()).toBe('vi');
  });

  it('`onLangChange` được gọi — nếu không, màn hình đứng yên ở tiếng cũ', () => {
    const onLangChange = vi.fn();
    handleMessage(fromApp({ v: 1, id: 'm6', kind: 'setLang', lang: 'en' }), {
      allowedOrigin: APP_ORIGIN,
      onLangChange,
    });
    expect(onLangChange).toHaveBeenCalledOnce();
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

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * BÀI CHỊU LỰC CỦA CẢ THAY ĐỔI NÀY — nửa đơn vị của kịch bản 5b.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Lỗi mà Task 7 đo được: đổi ngôn ngữ trong lúc đang gõ key **xoá sạch ô
   * nhập**, vì `?lang=` nằm trong `src` của khung và `src` đổi thì trình duyệt
   * nạp lại tài liệu. Bỏ `?lang=` đi đóng được nửa ấy — nhưng nó mở ra một
   * cách thứ hai để mắc đúng lỗi cũ ở đúng chỗ mới: **dịch lại màn hình bằng
   * cách vẽ lại nó**. `renderSettings` mở đầu bằng `root.textContent = ''`.
   *
   * Nên bài này hỏi cả hai vế trong một lần, và cả hai đều phải đúng:
   *
   *   · chữ ĐÃ đổi (nếu không, `retranslate` là một hàm rỗng và mọi chốt dưới
   *     đây xanh một cách vô nghĩa);
   *   · ô key còn nguyên, và **vẫn là đúng cái node cũ** — không phải một node
   *     mới tình cờ mang lại giá trị cũ, vì một cài đặt "vẽ lại rồi chép giá
   *     trị sang" cũng qua được phép so-bằng-chuỗi, và nó tạo ra một bản sao
   *     thứ hai của key trong bộ nhớ, đúng thứ tệp này tồn tại để chống.
   */
  it('dịch lại KHÔNG được xoá key đang gõ dở — và chữ vẫn phải đổi thật', () => {
    setVaultLang('vi');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const handle = renderSettings(root, defaultSettingsDeps());

    const secret = root.querySelector<HTMLInputElement>('input[data-role="secret"]');
    const model = root.querySelector<HTMLInputElement>('input[data-role="model"]');
    if (!secret || !model) throw new Error('không tìm thấy ô nhập — mọi chốt dưới đây rỗng');
    secret.value = 'sk-nua-chung-dang-go';
    model.value = 'mo-hinh-tu-go';
    // Một câu trạng thái đang hiện, để đo cả nửa "chữ động".
    root.querySelector<HTMLButtonElement>('button[data-role="save"]')?.click();

    // ĐỐI CHỨNG: màn hình ĐANG là tiếng Việt.
    expect(root.textContent).toContain(lookup('vi', 'vault.settings.keyLabel'));

    setVaultLang('en');
    handle.retranslate();

    // ── vế 1: chữ đã đổi thật, ở cả nhãn TĨNH lẫn chữ ĐỘNG ────────────────
    const after = root.textContent ?? '';
    for (const k of ['vault.settings.title', 'vault.settings.keyLabel', 'vault.settings.save'] as const) {
      expect(after, k).toContain(lookup('en', k));
      expect(after, k).not.toContain(lookup('vi', k));
    }
    // `noKey` là chữ ĐỘNG (đọc keystore), `saved` là câu trạng thái đã nói —
    // hai lớp mà một `retranslate` chỉ dịch phần tĩnh sẽ bỏ sót.
    expect(after).toContain(lookup('en', 'vault.settings.saved'));
    expect(secret.placeholder).toBe(lookup('en', 'vault.settings.keyPlaceholder'));

    // ── vế 2: ô key còn nguyên, và vẫn là ĐÚNG CÁI NODE CŨ ────────────────
    //
    // `save` ở trên đã xoá ô key có chủ ý (key vừa được cất đi), nên phép đo
    // thật nằm ở ô MÔ HÌNH — thứ người dùng cũng đang gõ dở và không có lý do
    // nào để mất. Và chốt danh tính node là chốt nói lên nhiều nhất.
    expect(root.querySelector('input[data-role="secret"]')).toBe(secret);
    expect(root.querySelector('input[data-role="model"]')).toBe(model);
    expect(model.value).toBe('mo-hinh-tu-go');
  });

  it('gõ dở một key rồi đổi ngôn ngữ: ô key KHÔNG bị đụng tới', () => {
    setVaultLang('vi');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const handle = renderSettings(root, defaultSettingsDeps());

    const secret = root.querySelector<HTMLInputElement>('input[data-role="secret"]');
    if (!secret) throw new Error('không tìm thấy ô key — mọi chốt dưới đây rỗng');
    secret.value = 'sk-s3gate-nua-chung';

    setVaultLang('en');
    handle.retranslate();

    // Đây là đúng câu mà cổng e2e hỏi qua một trình duyệt thật, hỏi lại ở tầng
    // rẻ nhất: sau khi đổi ngôn ngữ, thứ người dùng đang gõ vẫn còn.
    expect(secret.value).toBe('sk-s3gate-nua-chung');
    expect(root.querySelector('input[data-role="secret"]')).toBe(secret);
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
