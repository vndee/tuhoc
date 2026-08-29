import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from './index';
import { tNode } from './tNode';

/**
 * `tNode()` — HÀM THỨ HAI của QĐ-2, và bài kiểm của nó phải nói được đúng thứ
 * `t()` không làm được: một câu có thẻ NẰM GIỮA chừng.
 *
 * Không có bài nào ở đây khẳng định "`t()` trả về `string`" — điều đó là việc
 * của `tsc`, và nó đã là việc của `tsc` từ Task 4.
 */
/**
 * KHOÁ VÍ DỤ: `ann.orphan.barWhat` (`(quote: string) => …`,
 * `annotations/OrphanPanel.tsx`).
 *
 * Bản trước mượn hai khoá của mục Trợ lý AI trong `pages/Settings.tsx`, và cả
 * hai đã bị XOÁ khỏi catalog ở task-14 khi mục ấy được viết lại cho Pha 2 —
 * tức bài kiểm về `tNode()` đỏ vì một thay đổi CHỮ ở một màn hình chẳng liên
 * quan gì tới nó. `ann.orphan.barWhat` giữ đúng thuộc tính bài này cần đo —
 * chỗ trống KHÔNG ở đầu câu, và ở HAI VỊ TRÍ khác nhau giữa hai bản dịch
 * ("Gắn lại: " = 9 ký tự trước nó ở vi, "Reattaching: " = 13 ký tự ở en) —
 * mà không mượn một khoá của một mục có thể còn đổi tiếp.
 */
describe('tNode()', () => {
  it('chèn phần tử vào ĐÚNG chỗ trống, và câu vẫn liền một mạch', () => {
    const { container } = render(<p>{tNode('vi', 'ann.orphan.barWhat', <strong>đoạn trích</strong>)}</p>);
    const p = container.querySelector('p');

    expect(p?.textContent).toBe(t('vi', 'ann.orphan.barWhat', 'đoạn trích'));
    expect(p?.querySelector('strong')?.textContent).toBe('đoạn trích');
  });

  /**
   * BÀI CHỊU LỰC. Chỗ trống nằm ở VỊ TRÍ KHÁC trong hai bản dịch — bản tiếng
   * Việt có 9 ký tự trước nó ("Gắn lại: "), bản tiếng Anh có 13
   * ("Reattaching: ") — và đó là toàn bộ lý do khoá này là MỘT câu có tham số
   * chứ không phải ba khoá `part1/part2/part3` ghép lại trong JSX. Một cài
   * đặt cắt câu ở chỗ vẽ sẽ cho ra cùng chữ ở bản tiếng Việt và **sai trật
   * tự** ở bản tiếng Anh, và không bài kiểm một-ngôn-ngữ nào thấy được điều
   * đó.
   */
  it('vị trí chỗ trống ĐI THEO BẢN DỊCH, không theo chỗ gọi', () => {
    const MARK = 'ĐOẠN TRÍCH ĐÁNH DẤU';
    const offsets = (['vi', 'en'] as const).map((lang) => {
      const { container } = render(<p>{tNode(lang, 'ann.orphan.barWhat', <strong>{MARK}</strong>)}</p>);
      const text = container.querySelector('p')?.textContent ?? '';
      return text.indexOf(MARK);
    });

    // Cả hai đều nằm GIỮA câu (không phải 0, tức không bị đẩy ra đầu)…
    expect(offsets.every((n) => n > 0)).toBe(true);
    // …và ở hai vị trí KHÁC nhau.
    expect(offsets[0]).not.toBe(offsets[1]);
  });

  /**
   * Thẻ đánh dấu là ký tự NUL, và nó KHÔNG ĐƯỢC lọt ra chữ hiện trên trang. Bài
   * này tồn tại vì một cài đặt cắt sai (ví dụ regex không khớp đuôi) sẽ để lại
   * `\u00000\u0000` ngay giữa câu — thấy được bằng mắt, nhưng chỉ khi có ai mở
   * đúng trang ấy.
   */
  it('không rò thẻ đánh dấu ra chữ hiển thị', () => {
    const { container } = render(<p>{tNode('en', 'ann.orphan.barWhat', <em>x</em>)}</p>);
    expect(container.querySelector('p')?.textContent).not.toContain('\u0000');
  });
});
