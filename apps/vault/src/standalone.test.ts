import { beforeEach, describe, expect, it } from 'vitest';
import { t } from './lang';
import { renderStandaloneNotice } from './main';

/**
 * Kho khoá được làm ra để NHÚNG, và cho tới bản sửa này nó vẽ y hệt nhau dù
 * đang nằm trong khung của trang học hay đang là tài liệu cấp cao nhất. Mở
 * thẳng địa chỉ của nó — một tab còn sót, một dấu trang, hay một URL chép từ
 * chính báo cáo của chúng ta — là vào một trang đầy đủ chức năng mà KHÔNG có
 * một liên kết nào dẫn đi đâu.
 *
 * Người dùng báo bằng đúng hai chữ "stuck", kèm ảnh chụp thanh địa chỉ đang ở
 * origin kho khoá. Bản sửa trước đó (bỏ tự-bung lớp phủ ở `/settings`) không
 * chạm được vào màn hình ấy, vì nó nằm ở MỘT ORIGIN KHÁC — đúng lý do người
 * dùng nói "vẫn vậy mà?".
 */
const APP = 'http://localhost:5173';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('biểu ngữ cho kho khoá mở đứng một mình', () => {
  it('dựng lối ra khi KHÔNG được nhúng', () => {
    renderStandaloneNotice(document.body, APP, true);

    const box = document.querySelector('[data-testid="vault-standalone"]');
    expect(box).not.toBeNull();
    expect(box?.textContent).toContain(t('vault.standalone.notice'));

    const back = box?.querySelector('a');
    // `href` so bằng ĐÚNG chuỗi, không `toContain`: một liên kết trỏ nhầm sang
    // origin khác vẫn "chứa" tên máy, mà đó lại đúng là lỗi đáng sợ nhất ở một
    // trang giữ key.
    expect(back?.getAttribute('href')).toBe(APP);
    expect(back?.textContent).toBe(t('vault.standalone.back'));
  });

  it('KHÔNG dựng gì khi đang được nhúng — trong khung thì lối ra là trang cha', () => {
    renderStandaloneNotice(document.body, APP, false);
    expect(document.querySelector('[data-testid="vault-standalone"]')).toBeNull();
    expect(document.body.children).toHaveLength(0);
  });

  /**
   * Đây là chốt giữ cho bản sửa không tự huỷ về sau.
   *
   * `renderSettings` mở đầu bằng `root.textContent = ''`, nên bất cứ thứ gì nằm
   * TRONG `#vault-ui` đều biến mất ở lần vẽ lại đầu tiên — mà `repaintPanel`
   * chạy mỗi lần trang chính nhắn `chat` vào. Biểu ngữ phải là anh em của
   * `#vault-ui`, không phải con của nó.
   */
  it('sống sót khi #vault-ui bị vẽ lại từ đầu', () => {
    const root = document.createElement('div');
    root.id = 'vault-ui';
    document.body.append(root);

    renderStandaloneNotice(document.body, APP, true);
    expect(document.querySelector('[data-testid="vault-standalone"]')).not.toBeNull();

    // Đúng động tác mà `renderSettings` làm ở đầu mỗi lần vẽ.
    root.textContent = '';

    expect(document.querySelector('[data-testid="vault-standalone"]')).not.toBeNull();
    // và nó đứng TRƯỚC khung, để người ta đọc được trước khi cuộn vào form.
    expect(document.body.firstElementChild?.getAttribute('data-testid')).toBe('vault-standalone');
  });

  it('không chèn HTML từ chuỗi dịch — chỉ chữ', () => {
    // Chuỗi dịch là dữ liệu của chúng ta chứ không phải của người dùng, nhưng
    // trang này giữ key: một `innerHTML` ở đây là thói quen sai ở đúng nơi đắt
    // nhất để sai. `textContent` giữ cho nó không bao giờ thành một lối chèn.
    renderStandaloneNotice(document.body, APP, true);
    const line = document.querySelector('.vault-standalone-line');
    expect(line?.children).toHaveLength(0);
  });
});
