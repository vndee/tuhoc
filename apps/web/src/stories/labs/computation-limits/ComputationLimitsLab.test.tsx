import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import ComputationLimitsLab from './ComputationLimitsLab';

const definition: LabRuntimeProps['definition'] = {
  kind: 'computation-limits',
  title: { vi: 'Máy', en: 'Machine' },
  instruction: { vi: 'Đi từng bước.', en: 'Step through the machine.' },
  config: { tape: '0', startState: 'scan', maxSteps: 3, program: { scan: { write: '1', move: 1, next: 'scan' } } },
};

function ControlledLab({ onReset = vi.fn() }: { onReset?: () => void }) {
  const [value, setValue] = useState<unknown>({ steps: 0, snapshot: null });
  return <ComputationLimitsLab definition={definition} lang="en" value={value} onChange={setValue} onReset={onReset} onBack={() => undefined} />;
}

function LongStateControlledLab() {
  const displayPrefix = 's'.repeat(256);
  const exactState = `${displayPrefix}-exact`;
  const longStateDefinition: LabRuntimeProps['definition'] = {
    kind: 'computation-limits',
    title: { vi: 'May', en: 'Machine' },
    instruction: { vi: 'Tung buoc.', en: 'Step through the machine.' },
    config: {
      tape: '0',
      startState: 'start',
      maxSteps: 3,
      program: {
        start: { write: 'a', move: 1, next: exactState },
        [displayPrefix]: { write: 'wrong', move: 1, next: 'done' },
        [exactState]: { write: 'right', move: 1, next: 'done' },
      },
    },
  };
  const [value, setValue] = useState<unknown>({ steps: 0, snapshot: null });
  return <ComputationLimitsLab definition={longStateDefinition} lang="en" value={value} onChange={setValue} onReset={() => undefined} onBack={() => undefined} />;
}

describe('ComputationLimitsLab', () => {
  it('advances the displayed machine exactly one transition for each native button click', () => {
    render(<ControlledLab />);

    expect(screen.getByRole('list', { name: /machine tape/i })).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: /step machine/i }));
    expect(screen.getByRole('list', { name: /machine tape/i })).toHaveTextContent('01');
    expect(screen.getByRole('status')).toHaveTextContent(/still running within the 3-step observation/i);
    expect(screen.getByRole('status')).not.toHaveTextContent(/solved/i);
  });

  it('forwards reset and never starts a render timer', () => {
    const onReset = vi.fn();
    const timer = vi.spyOn(global, 'setTimeout');
    render(<ControlledLab onReset={onReset} />);

    expect(timer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalledOnce();
    timer.mockRestore();
  });

  it('uses the exact persisted long state rule on the second controlled click', () => {
    render(<LongStateControlledLab />);

    const stepButton = screen.getByRole('button', { name: /step machine/i });
    fireEvent.click(stepButton);
    const displayedState = screen.getByText((_, element) => element?.tagName === 'P' && element.textContent?.startsWith('State:') === true);
    expect(displayedState).toHaveTextContent(`${'s'.repeat(256)}…`);
    expect(displayedState).not.toHaveTextContent('-exact');
    fireEvent.click(stepButton);

    expect(screen.getByRole('list', { name: /machine tape/i })).toHaveTextContent('0aright');
    expect(screen.getByRole('list', { name: /machine tape/i })).not.toHaveTextContent('wrong');
  });
});
