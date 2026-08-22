import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

/** React logs caught render errors to console.error on its own; silence that
 *  so a passing run doesn't look like a failing one. Restored after each. */
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  it('một lỗi render cho ra CHỮ ĐỌC ĐƯỢC, không phải trang trắng', () => {
    render(
      <ErrorBoundary>
        <Boom message="Cannot read properties of undefined (reading 'map')" />
      </ErrorBoundary>,
    );
    // Điều thật sự cần khẳng định không phải "có phần tử nào đó", mà là
    // NGƯỜI DÙNG ĐỌC ĐƯỢC GÌ. Trang trắng đo được là `innerText` rỗng.
    expect(document.body.innerText?.trim() ?? document.body.textContent?.trim()).not.toBe('');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/màn hình này gặp lỗi/i)).toBeInTheDocument();
  });

  it('hiện nguyên văn thông báo lỗi — thứ người dùng cần gửi kèm khi báo lỗi', () => {
    render(
      <ErrorBoundary>
        <Boom message="Cannot read properties of undefined (reading 'map')" />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/reading 'map'/)).toBeInTheDocument();
  });

  it('có lối thoát: một nút tải lại, không phải ngõ cụt', () => {
    render(
      <ErrorBoundary>
        <Boom message="bất kỳ" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /tải lại/i })).toBeInTheDocument();
  });

  it('ĐỐI CHỨNG: con không ném thì boundary vô hình — nó không được nuốt nội dung bình thường', () => {
    render(
      <ErrorBoundary>
        <p>nội dung bình thường</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('nội dung bình thường')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('componentDidCatch ghi lại component stack — dấu vết duy nhất còn sót khi cây đã mất', () => {
    render(
      <ErrorBoundary>
        <Boom message="cần dấu vết" />
      </ErrorBoundary>,
    );
    const calls = consoleError.mock.calls as unknown[][];
    const ours = calls.filter((c) => String(c[0]).includes('ErrorBoundary bắt được'));
    expect(ours.length).toBeGreaterThanOrEqual(1);
    expect(String(ours[0][2])).toContain('Boom');
  });
});
