import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import EmbodiedCalculationLab from './EmbodiedCalculationLab';

const definition: LabRuntimeProps['definition'] = {
  kind: 'embodied-calculation',
  title: { vi: 'Bàn tính', en: 'Abacus' },
  instruction: { vi: 'Cộng các hạt.', en: 'Add the beads.' },
  config: { left: 7, right: 5, rods: 3 },
};

function ControlledLab({ onReset = vi.fn() }: { onReset?: () => void }) {
  const [value, setValue] = useState<unknown>({ step: 0, representation: 'abacus' });
  return <EmbodiedCalculationLab definition={definition} lang="en" value={value} onChange={setValue} onReset={onReset} onBack={() => undefined} />;
}

describe('EmbodiedCalculationLab', () => {
  it('renders the configured rods as place values and keeps a carry-out visible', () => {
    const fourRods: LabRuntimeProps['definition'] = { ...definition, config: { ...definition.config, rods: 4 } };
    function FourRods() { const [value, setValue] = useState<unknown>({ step: 0, representation: 'abacus' }); return <EmbodiedCalculationLab definition={fourRods} lang="en" value={value} onChange={setValue} onReset={() => undefined} onBack={() => undefined} />; }
    render(<FourRods />);
    for (let count = 0; count < 5; count += 1) fireEvent.click(screen.getByRole('button', { name: /add a bead/i }));
    expect(screen.getByLabelText(/ones rod/i)).toHaveTextContent('2');
    expect(screen.getByLabelText(/tens rod/i)).toHaveTextContent('1');
    expect(screen.getByLabelText(/hundreds rod/i)).toHaveTextContent('0');
    expect(screen.getByLabelText(/thousands rod/i)).toHaveTextContent('0');
    expect(screen.getByText(/Column 1: 12.*carry/i)).toBeVisible();
  });

  it('localizes accessible place-value rod labels', () => {
    const fourRods: LabRuntimeProps['definition'] = { ...definition, config: { ...definition.config, rods: 4 } };
    const props = { definition: fourRods, value: { step: 0, representation: 'abacus' } as unknown, onChange: () => undefined, onReset: () => undefined, onBack: () => undefined };
    const view = render(<EmbodiedCalculationLab {...props} lang="en" />);
    expect(screen.getByLabelText('ones rod: 7')).toBeVisible();
    expect(screen.getByLabelText('tens rod: 0')).toBeVisible();

    view.rerender(<EmbodiedCalculationLab {...props} lang="vi" />);
    expect(screen.getByLabelText('hàng đơn vị: 7')).toBeVisible();
    expect(screen.getByLabelText('hàng chục: 0')).toBeVisible();
  });

  it('lets bead and keyboard-safe step buttons reach twelve, then shows that sequence as gears', () => {
    render(<ControlledLab />);

    for (let count = 0; count < 5; count += 1) fireEvent.click(screen.getByRole('button', { name: /add a bead/i }));
    expect(screen.getByRole('status')).toHaveTextContent('12');
    fireEvent.click(screen.getByRole('button', { name: /previous step/i }));
    fireEvent.click(screen.getByRole('button', { name: /next step/i }));
    expect(screen.getByRole('status')).toHaveTextContent('12');

    fireEvent.click(screen.getByRole('button', { name: /show gears/i }));
    expect(screen.getByText('Gear sequence: 7 → 8 → 9 → 10 → 11 → 12')).toBeVisible();
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
