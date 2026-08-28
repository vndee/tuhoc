import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

/**
 * Chữ đi vào bộ dựng này do một MÔ HÌNH NGÔN NGỮ sinh ra, và mô hình ấy đọc nội
 * dung chương — tức một tệp do người khác đóng gói. Nên tệp kiểm này có hai
 * nửa, và nửa thứ nhất mới là nửa chịu lực:
 *
 *   1. Không có đường nào từ chuỗi của mô hình sang một THẺ trên trang.
 *   2. Những gì câu trả lời thật sự dùng thì dựng ra đúng.
 */

function draw(source: string) {
  return render(<div data-testid="out">{renderMarkdown(source)}</div>);
}

describe('markdown của câu trả lời AI — cổng an toàn', () => {
  it('HTML trong câu trả lời hiện ra thành CHỮ, không thành thẻ', () => {
    const { container } = draw('Thử: <script>alert(1)</script> và <img src=x onerror=alert(2)>');

    // Không một thẻ nào trong hai thứ trên được vào cây.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    // Và chữ thì vẫn còn nguyên — người đọc thấy đúng thứ mô hình viết.
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('<img src=x onerror=alert(2)>');
  });

  it('HTML nằm TRONG một khối mã cũng chỉ là chữ', () => {
    const { container } = draw('```html\n<script>alert(1)</script>\n```');

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('<script>alert(1)</script>');
  });

  /**
   * Liên kết là bước cuối của một đường lái mô hình: nội dung chương là tệp do
   * người khác đóng gói, nên một `[bấm vào đây](https://…)` trong câu trả lời có
   * thể không phải ý của người đọc. Địa chỉ được VẼ RA đầy đủ; nó không bấm được.
   */
  it('liên kết hiện ra đầy đủ địa chỉ và KHÔNG bấm được', () => {
    const { container } = draw('Xem [tài liệu](https://vi-du.com/abc) nhé.');

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('tài liệu');
    expect(container.textContent).toContain('https://vi-du.com/abc');
  });

  it('`javascript:` không lọt qua mẫu liên kết', () => {
    const { container } = draw('[bấm](javascript:alert(1))');

    expect(container.querySelector('a')).toBeNull();
    // Không khớp mẫu ⇒ hiện nguyên văn, chứ không bị nuốt mất.
    expect(container.textContent).toContain('[bấm](javascript:alert(1))');
  });
});

describe('markdown của câu trả lời AI — thứ câu trả lời thật sự dùng', () => {
  it('đậm, nghiêng và mã nội dòng', () => {
    const { container } = draw('Số **0,1** thật ra là *xấp xỉ*, xem `format(0.1)`.');

    expect(container.querySelector('strong')?.textContent).toBe('0,1');
    expect(container.querySelector('em')?.textContent).toBe('xấp xỉ');
    expect(container.querySelector('code')?.textContent).toBe('format(0.1)');
  });

  /**
   * Mã nội dòng đứng TRƯỚC mọi mẫu khác, và bài này là thứ giữ nó ở đó: dấu sao
   * bên trong dấu huyền phải hiện ra nguyên vẹn, vì trong một khối mã chúng là
   * mã chứ không phải định dạng.
   */
  it('dấu sao bên trong mã nội dòng KHÔNG thành chữ đậm', () => {
    const { container } = draw('Toán tử `**` là luỹ thừa.');

    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('**');
  });

  it('khối mã giữ nguyên xuống dòng và khoảng trắng đầu dòng', () => {
    const { container } = draw('```python\ndef f():\n    return 1\n```');

    expect(container.querySelector('pre code')?.textContent).toBe('def f():\n    return 1');
    expect(container.querySelector('pre')?.getAttribute('data-lang')).toBe('python');
  });

  /**
   * Câu trả lời được vẽ lại sau MỖI mẩu stream, nên một khối mã chưa đóng ``` là
   * trạng thái thường gặp nhất chứ không phải ca hiếm. Nuốt phần chữ còn lại ở
   * đó nghĩa là người đọc nhìn một khoảng trống lớn dần trong lúc mô hình viết.
   */
  it('khối mã chưa đóng (đang stream) vẫn hiện ra phần đã nhận', () => {
    const { container } = draw('Đây:\n```python\ndef f():');

    expect(container.querySelector('pre code')?.textContent).toBe('def f():');
  });

  it('danh sách có dấu đầu dòng và danh sách đánh số', () => {
    const bullets = draw('- một\n- hai').container;
    expect(Array.from(bullets.querySelectorAll('ul li')).map((li) => li.textContent)).toEqual(['một', 'hai']);

    const numbered = draw('1. một\n2. hai').container;
    expect(Array.from(numbered.querySelectorAll('ol li')).map((li) => li.textContent)).toEqual(['một', 'hai']);
  });

  /**
   * Câu trả lời sống BÊN TRONG một trang đã có `h1` (tên chương) và `h2` (mục).
   * Một `#` của mô hình không được thành một `h1` thứ hai: cây tiêu đề là thứ
   * người dùng trình đọc màn hình dùng để đi lại, và một câu trả lời không được
   * xen ngang nó ở cấp cao nhất.
   */
  it('tiêu đề của mô hình bắt đầu từ h3, không phải h1', () => {
    const { container } = draw('# To nhất\n## Nhỏ hơn');

    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h2')).toBeNull();
    expect(container.querySelector('h3')?.textContent).toBe('To nhất');
    expect(container.querySelector('h4')?.textContent).toBe('Nhỏ hơn');
  });

  it('hai đoạn cách nhau một dòng trống là HAI thẻ p', () => {
    const { container } = draw('Đoạn một.\n\nĐoạn hai.');

    expect(Array.from(container.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'Đoạn một.',
      'Đoạn hai.',
    ]);
  });

  /**
   * Không có `window.katex` trong jsdom, và đó chính là ca cần đo: người đọc
   * phải thấy chữ TeX thô chứ không phải một chỗ trống.
   */
  it('công thức không dựng được thì hiện chữ TeX thô, không hiện chỗ trống', () => {
    draw('Ta có $x^2 + y^2$ và:\n\n$$e^{i\\pi} = -1$$');

    expect(screen.getByTestId('out').textContent).toContain('x^2 + y^2');
    expect(screen.getByTestId('out').textContent).toContain('e^{i\\pi} = -1');
  });

  it('"5 $ và 10 $" không bị đọc thành một công thức', () => {
    const { container } = draw('Giá 5 $ và 10 $ thôi.');

    expect(container.querySelectorAll('.md-math')).toHaveLength(0);
    expect(container.textContent).toBe('Giá 5 $ và 10 $ thôi.');
  });

  it('chuỗi rỗng không ném và không dựng ra gì', () => {
    const { container } = draw('');
    expect(container.querySelector('[data-testid="out"]')?.textContent).toBe('');
  });
});
