import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WIDGET_HEIGHT_MESSAGE, WidgetFrame } from './WidgetFrame';

/**
 * `WidgetFrame` is the entire security boundary between a course's
 * (untrusted) interactive content and the reader's session — see its own
 * doc comment. These three tests are deliberately narrow: this component has
 * exactly one job, and the FIRST test below is the one that matters most in
 * this whole task.
 */
describe('WidgetFrame', () => {
  it('sandboxes the iframe to EXACTLY "allow-scripts" — no allow-same-origin, ever', () => {
    render(<WidgetFrame name="dao-ham" html="<p>xin chào</p>" />);

    // Equality, NOT `toContain`. `"allow-scripts allow-same-origin"` would
    // satisfy a `toContain('allow-scripts')` check while handing the widget
    // the parent's origin — the exact regression this test exists to catch.
    // This assertion must go red the moment that token is added.
    expect(screen.getByTitle('dao-ham')).toHaveAttribute('sandbox', 'allow-scripts');
  });

  it('carries the widget\'s own html verbatim via srcDoc, not src', () => {
    render(<WidgetFrame name="dao-ham" html="<p>nội dung widget</p>" />);

    const frame = screen.getByTitle('dao-ham') as HTMLIFrameElement;
    expect(frame.srcdoc).toBe('<p>nội dung widget</p>');
    // No `src`: this markup has no URL of its own to fetch from, and giving
    // it one would mean serving the widget as a request the sandbox is built
    // to avoid needing.
    expect(frame).not.toHaveAttribute('src');
  });

  it("uses the widget's own name as the iframe's accessible name (title)", () => {
    render(<WidgetFrame name="do-thi-ham-so" html="<p>x</p>" />);

    expect(screen.getByTitle('do-thi-ham-so').tagName).toBe('IFRAME');
  });
});

/**
 * Chiều cao: widget NÓI, khung NGHE — qua `postMessage`, đúng đường mà doc của
 * `WidgetFrame` đã chỉ cho "widget cần nói gì với trang", không nới sandbox.
 * Bốn bài dưới đây canh đúng ba điều làm giao thức này an toàn: chỉ nhận từ
 * cửa sổ của CHÍNH khung (một khung không đặt được cỡ khung khác), chỉ đọc
 * một con số hữu hạn, và kẹp 160–1400px. Không thông điệp thì không
 * `style.height` — CSS mặc định 420px của reader-layout.css giữ nguyên vai.
 */
describe('WidgetFrame — chiều cao do widget báo', () => {
  function post(source: Window | null, data: unknown) {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, source: source as MessageEventSource | null }));
    });
  }

  it('không có thông điệp thì không đặt style.height (giữ mặc định CSS)', () => {
    render(<WidgetFrame name="w" html="<p>x</p>" />);
    expect((screen.getByTitle('w') as HTMLIFrameElement).style.height).toBe('');
  });

  it('đặt chiều cao khi thông điệp đến từ đúng cửa sổ của khung, và làm tròn', () => {
    render(<WidgetFrame name="w" html="<p>x</p>" />);
    const frame = screen.getByTitle('w') as HTMLIFrameElement;
    post(frame.contentWindow, { type: WIDGET_HEIGHT_MESSAGE, height: 487.6 });
    expect(frame.style.height).toBe('488px');
  });

  it('kẹp trong 160–1400px: widget lỗi hay xấu không co khung về 0, không đẩy chương đi', () => {
    render(<WidgetFrame name="w" html="<p>x</p>" />);
    const frame = screen.getByTitle('w') as HTMLIFrameElement;
    post(frame.contentWindow, { type: WIDGET_HEIGHT_MESSAGE, height: 0 });
    expect(frame.style.height).toBe('160px');
    post(frame.contentWindow, { type: WIDGET_HEIGHT_MESSAGE, height: 99999 });
    expect(frame.style.height).toBe('1400px');
  });

  it('bỏ qua thông điệp từ cửa sổ khác, sai loại, hay không phải số hữu hạn', () => {
    render(
      <>
        <WidgetFrame name="a" html="<p>a</p>" />
        <WidgetFrame name="b" html="<p>b</p>" />
      </>,
    );
    const a = screen.getByTitle('a') as HTMLIFrameElement;
    const b = screen.getByTitle('b') as HTMLIFrameElement;
    // Khung b nói — chỉ b đổi, a đứng yên: một widget không đặt cỡ được widget bên cạnh.
    post(b.contentWindow, { type: WIDGET_HEIGHT_MESSAGE, height: 600 });
    expect(a.style.height).toBe('');
    expect(b.style.height).toBe('600px');
    // Thông điệp từ chính cửa sổ trang (không phải khung nào) bị bỏ qua.
    post(window, { type: WIDGET_HEIGHT_MESSAGE, height: 700 });
    expect(a.style.height).toBe('');
    // Sai loại, hoặc số không hữu hạn/chuỗi — bỏ qua, không ném.
    post(a.contentWindow, { type: 'khac', height: 700 });
    post(a.contentWindow, { type: WIDGET_HEIGHT_MESSAGE, height: 'to' });
    post(a.contentWindow, { type: WIDGET_HEIGHT_MESSAGE, height: Number.POSITIVE_INFINITY });
    post(a.contentWindow, 'chuỗi trần');
    expect(a.style.height).toBe('');
  });
});
