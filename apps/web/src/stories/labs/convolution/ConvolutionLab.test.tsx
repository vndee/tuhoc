import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import ConvolutionLab from './ConvolutionLab';

const definition: LabRuntimeProps['definition'] = {
  kind: 'convolution',
  title: { en: 'Convolution', vi: 'Tích chập' },
  instruction: { en: 'Move the kernel.', vi: 'Di chuyển kernel.' },
  config: {
    pixels: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    kernel: [[1, 0], [0, -1]],
    row: 0,
    column: 0,
  },
};

function ControlledLab({ lang = 'en' }: { lang?: 'en' | 'vi' }) {
  const [value, setValue] = useState<unknown>({ row: 0, column: 0, parallel: false });
  return <ConvolutionLab definition={definition} lang={lang} value={value} onChange={setValue} onReset={() => undefined} onBack={() => undefined} />;
}

describe('ConvolutionLab', () => {
  it('moves an accessible image grid with four buttons and arrow keys while exposing the dot product', () => {
    render(<ControlledLab />);
    const grid = screen.getByRole('grid', { name: /input image/i });
    expect(screen.getByText('Dot product: -4')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Move kernel right' }));
    expect(screen.getByText('Dot product: -4')).toBeVisible();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(screen.getByText('Kernel origin: row 1, column 1')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Move kernel up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move kernel left' })).toBeEnabled();
  });

  it('changes only execution-order intuition when parallel grouping is toggled', () => {
    render(<ControlledLab />);
    const featureMap = screen.getByRole('table', { name: /feature map/i }).textContent;
    fireEvent.click(screen.getByLabelText(/parallel order intuition/i));

    expect(screen.getByRole('table', { name: /feature map/i })).toHaveTextContent(featureMap ?? '');
    expect(screen.getByText(/grouped highlights.*intuition.*not a gpu benchmark/i)).toBeVisible();
    expect(screen.queryByText(/gpu speed|faster|milliseconds/i)).not.toBeInTheDocument();
  });

  it('localizes each gridcell label for Vietnamese readers', () => {
    render(<ControlledLab lang="vi" />);
    expect(screen.getByRole('gridcell', { name: 'hàng 0, cột 0: 1' })).toBeVisible();
    expect(screen.queryByRole('gridcell', { name: /row 0, column 0/i })).not.toBeInTheDocument();
  });
});
