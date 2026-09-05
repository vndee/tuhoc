import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import LinearSeparatorLab from './LinearSeparatorLab';

const definition: LabRuntimeProps['definition'] = {
  kind: 'linear-separator',
  title: { vi: 'Đường phân tách', en: 'Separator' },
  instruction: { vi: 'Đổi đường.', en: 'Change the line.' },
  config: {
    points: [
      { id: 'negative', x: -1, y: 0, label: -1 },
      { id: 'positive', x: 1, y: 0, label: 1 },
    ],
    angle: 0,
    offset: 0,
  },
};

function ControlledLab() {
  const [value, setValue] = useState<unknown>({ angle: 0, offset: 0, xor: false });
  return <LinearSeparatorLab definition={definition} lang="en" value={value} onChange={setValue} onReset={() => undefined} onBack={() => undefined} />;
}

describe('LinearSeparatorLab', () => {
  it('updates the SVG boundary with keyboard-native angle and offset controls', () => {
    render(<ControlledLab />);
    const boundary = screen.getByTestId('separator-boundary');
    const before = boundary.getAttribute('d');

    fireEvent.change(screen.getByLabelText(/angle/i), { target: { value: '1' } });
    expect(boundary.getAttribute('d')).not.toBe(before);
    fireEvent.change(screen.getByLabelText(/offset/i), { target: { value: '1' } });
    expect(screen.getByRole('status')).toHaveTextContent(/misclassified/i);
  });

  it('keeps a visible error when XOR demonstrates a one-layer linear limitation', () => {
    render(<ControlledLab />);

    fireEvent.click(screen.getByRole('checkbox', { name: /use xor points/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/misclassified: [1-4]/i);
    expect(screen.getByText(/a single linear layer cannot separate every XOR arrangement/i)).toBeVisible();
  });

  it('uses reader-facing point labels in its text equivalent instead of internal IDs', () => {
    render(<ControlledLab />);

    expect(screen.getByRole('list', { name: /text equivalent/i })).toHaveTextContent('Point 1');
    expect(screen.queryByText('negative')).not.toBeInTheDocument();
  });
});
