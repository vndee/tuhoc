import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StaticLabFallback } from './StaticLabFallback';

describe('StaticLabFallback', () => {
  it('renders the authored table and working retry and back actions', () => {
    const retry = vi.fn();
    const back = vi.fn();
    render(<StaticLabFallback
      lang="en"
      title="Example"
      instruction="Compare the bytes"
      fallback={{
        diagramLabel: { vi: 'Ví dụ tĩnh', en: 'Static example' },
        explanation: { vi: 'Một bit đổi', en: 'One changed bit' },
        table: {
          vi: { headers: ['Gốc', 'Nhận'], rows: [['00', '01']] },
          en: { headers: ['Sent', 'Received'], rows: [['00', '01']] },
        },
      }}
      onRetry={retry}
      onBack={back}
    />);

    expect(screen.getByRole('table', { name: 'Static example' })).toHaveTextContent('Sent');
    expect(screen.getByRole('table')).toHaveTextContent('00');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to illustration' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(back).toHaveBeenCalledOnce();
  });

  it('keeps legacy fallback labels useful when no authored table exists', () => {
    render(<StaticLabFallback
      lang="vi"
      title="Ví dụ"
      instruction="Đọc giải thích"
      fallback={{
        diagramLabel: { vi: 'Sơ đồ lưu giữ', en: 'Retention diagram' },
        explanation: { vi: 'Ký hiệu giữ thông tin.', en: 'Symbols retain information.' },
      }}
      onRetry={() => undefined}
      onBack={() => undefined}
    />);

    expect(screen.getByText('Sơ đồ lưu giữ')).toBeVisible();
    expect(screen.getByText('Ký hiệu giữ thông tin.')).toBeVisible();
  });
});
