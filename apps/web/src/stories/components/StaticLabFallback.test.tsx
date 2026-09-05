import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StaticLabFallback } from './StaticLabFallback';
import type { LabFallbackDiagram } from '../types';

describe('StaticLabFallback', () => {
  it.each(['vi', 'en'] as const)('renders safe accessible authored geometry in %s with distinct line styles', (lang) => {
    const label = { vi: 'Đầu vào', en: 'Input' };
    const diagram: LabFallbackDiagram = {
      width: 300, height: 160,
      title: { vi: 'Hai vệt xung', en: 'Two pulse traces' },
      description: { vi: 'Nét liền và nét đứt.', en: 'Solid and dashed traces.' },
      lines: [
        { points: [[10, 80], [100, 40], [200, 80]], style: 'solid', label },
        { points: [[10, 80], [100, 60], [200, 70]], style: 'dashed', label: { vi: 'Đầu ra', en: 'Output' } },
      ],
      labels: [{ x: 10, y: 20, text: label }],
    };
    render(<StaticLabFallback lang={lang} title="Example" instruction="Compare" fallback={{
      diagramLabel: { vi: 'Ví dụ tĩnh', en: 'Static example' },
      explanation: { vi: 'Giải thích', en: 'Explanation' },
      ...{ diagram },
    }} onRetry={() => undefined} onBack={() => undefined} />);
    const svg = screen.getByRole('img', { name: diagram.title[lang] });
    const viewport = screen.getByRole('region', { name: diagram.title[lang] });
    expect(viewport).toHaveAttribute('tabindex', '0');
    expect(viewport).toContainElement(svg);
    expect(screen.getByRole('region', { name: 'Example' })).toHaveAttribute('aria-busy', 'false');
    expect(svg).toHaveAccessibleDescription(diagram.description[lang]);
    expect(svg).toHaveAttribute('width', '300');
    expect(svg).toHaveAttribute('viewBox', '0 0 300 160');
    expect(svg.querySelectorAll('polyline')).toHaveLength(2);
    expect(svg.querySelectorAll('polyline')[0]).toHaveAttribute('points', '10,80 100,40 200,80');
    expect(svg.querySelectorAll('polyline')[1]).toHaveAttribute('stroke-dasharray', '6 4');
    expect(svg.querySelector('text')).toHaveTextContent(label[lang]);
  });

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
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
