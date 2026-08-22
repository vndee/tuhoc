import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { clearLocalData, db } from '../db/local';
import { LanguageProvider, useLanguage } from './LanguageProvider';
import { LANG_STORAGE_KEY } from './index';

function wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('lang');
});

describe('<LanguageProvider>', () => {
  it('mặc định là tiếng Việt khi thiết bị này chưa chọn gì', () => {
    const { result } = renderHook(() => useLanguage(), { wrapper });
    expect(result.current.lang).toBe('vi');
    expect(result.current.t('lang.switcher.label')).toBe('Ngôn ngữ giao diện');
  });

  it('đọc lại lựa chọn đã lưu của thiết bị', () => {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'en');
    const { result } = renderHook(() => useLanguage(), { wrapper });
    expect(result.current.lang).toBe('en');
    expect(result.current.t('lang.switcher.label')).toBe('Interface language');
  });

  /**
   * Một giá trị rác trong `localStorage` (bản cũ của ứng dụng, một extension,
   * một người gõ tay vào devtools) phải đọc thành "chưa chọn", không thành một
   * ngôn ngữ không tồn tại — `MESSAGES['fr']` là `undefined` và mọi lần tra cứu
   * sau đó sẽ ném ngay giữa lúc vẽ trang.
   */
  it('giá trị rác đọc thành "chưa chọn", không làm hỏng lúc vẽ', () => {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'fr');
    const { result } = renderHook(() => useLanguage(), { wrapper });
    expect(result.current.lang).toBe('vi');
  });

  it('setLang ghi vào ĐÚNG khoá của thiết bị và cập nhật <html lang>', () => {
    const { result } = renderHook(() => useLanguage(), { wrapper });

    act(() => {
      result.current.setLang('en');
    });

    expect(result.current.lang).toBe('en');
    expect(result.current.t('lang.switcher.label')).toBe('Interface language');
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('lựa chọn sống sót qua một lần tải lại trang', () => {
    const first = renderHook(() => useLanguage(), { wrapper });
    act(() => {
      first.result.current.setLang('en');
    });
    first.unmount();

    const second = renderHook(() => useLanguage(), { wrapper });
    expect(second.result.current.lang).toBe('en');
  });

  /**
   * Đây là nửa "theo thiết bị, không đồng bộ" viết thành phép đo. Đăng xuất gọi
   * `clearLocalData()`, thứ xoá sạch mọi khoá NỘI DUNG NGƯỜI DÙNG và mọi bảng
   * Dexie. Ngôn ngữ giao diện là TUỲ CHỌN CỦA THIẾT BỊ — cùng lập luận với chủ
   * đề sáng/tối trong `db/local.ts`: bàn giao máy cho người khác không phải một
   * yêu cầu đổi ngôn ngữ.
   */
  it('sống sót qua clearLocalData() — nó là tuỳ chọn thiết bị, không phải dữ liệu người dùng', async () => {
    const { result } = renderHook(() => useLanguage(), { wrapper });
    act(() => {
      result.current.setLang('en');
    });

    await clearLocalData();

    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');
  });

  it('không đẩy lựa chọn vào hàng đợi đồng bộ — không có gì rời khỏi máy này', async () => {
    const { result } = renderHook(() => useLanguage(), { wrapper });
    await db.outbox.clear();

    act(() => {
      result.current.setLang('en');
    });

    expect(await db.outbox.count()).toBe(0);
    expect(await db.meta.get('lang')).toBeUndefined();
  });

  /**
   * Ném chứ không lặng lẽ trả về mặc định, theo đúng khuôn `useThemeContext()`.
   * Một component dùng `t()` mà không có provider sẽ vẽ bằng ngôn ngữ mặc định
   * TRONG KHI phần còn lại của trang vẽ bằng ngôn ngữ đã chọn — một trang hai
   * thứ tiếng, hỏng theo chiều khó nhìn ra nhất.
   */
  it('useLanguage() ngoài provider thì NÉM, không trả mặc định', () => {
    expect(() => renderHook(() => useLanguage())).toThrowError(/LanguageProvider/);
  });
});

/**
 * CỬA — ruling S1-F29 / cổng mù #4.
 *
 * Một provider có thể đạt mọi khẳng định trong bộ test của chính nó **trong khi
 * không được gắn ở đâu cả**; chuyện đó đã xảy ra ở repo này ở quy mô 775 dòng,
 * và một vòng review từng xoá cả hai liên kết tới `/import` mà 632 test vẫn
 * xanh. Bài dưới đây lái `<App/>` THẬT và hỏi hai câu mà một bài render cô lập
 * không hỏi được: provider có được gắn không, và người dùng có **bấm** tới được
 * chỗ đổi ngôn ngữ không.
 */
describe('CỬA: đổi được ngôn ngữ trong ứng dụng thật', () => {
  it('bộ chọn có mặt trong <App/>, bấm được, và chữ ĐỔI', async () => {
    const user = userEvent.setup();
    render(<App />);

    const selector = screen.getByLabelText('Ngôn ngữ giao diện');
    expect(document.documentElement.lang).toBe('vi');

    await user.selectOptions(selector, 'en');

    // Cùng một điều khiển, nhãn của nó bây giờ là tiếng Anh — tức catalog thật
    // sự được tra cứu lại, chứ không phải chỉ một biến state đổi giá trị.
    expect(screen.getByLabelText('Interface language')).toBe(selector);
    expect(screen.queryByLabelText('Ngôn ngữ giao diện')).toBeNull();
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');
  });
});
