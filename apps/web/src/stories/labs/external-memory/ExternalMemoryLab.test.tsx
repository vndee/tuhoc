import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import ExternalMemoryLab from './ExternalMemoryLab';

const definition: LabRuntimeProps['definition'] = {
  kind: 'external-memory',
  title: { vi: 'Trí nhớ ngoài', en: 'External memory' },
  instruction: { vi: 'So sánh việc lưu giữ.', en: 'Compare retention.' },
  config: { generations: 3, oralRetention: 0.4, symbolicRetention: 0.8, originalMarks: 12 },
};

function ControlledLab({ onReset = vi.fn() }: { onReset?: () => void }) {
  const [value, setValue] = useState<unknown>({ generation: 0 });
  return <ExternalMemoryLab definition={definition} lang="en" value={value} onChange={setValue} onReset={onReset} onBack={() => undefined} />;
}

describe('ExternalMemoryLab', () => {
  it('compares oral and symbolic retention as text', () => {
    render(<ControlledLab />);

    fireEvent.change(screen.getByRole('slider', { name: /generation/i }), { target: { value: '3' } });
    expect(screen.getByText(/Oral: 1 marks/i)).toBeVisible();
    expect(screen.getByText(/Symbolic: 6 marks/i)).toBeVisible();
    expect(screen.getByText(/illustrative model, not a historical measurement/i)).toBeVisible();
  });

  it('forwards Reset and does not start a timer while rendering', () => {
    const onReset = vi.fn();
    const timer = vi.spyOn(global, 'setTimeout');
    render(<ControlledLab onReset={onReset} />);

    expect(timer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalledOnce();
    timer.mockRestore();
  });
});
