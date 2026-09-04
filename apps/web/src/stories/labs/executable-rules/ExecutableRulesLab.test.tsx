import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import ExecutableRulesLab from './ExecutableRulesLab';

const definition: LabRuntimeProps['definition'] = {
  kind: 'executable-rules',
  title: { vi: 'Quy tắc', en: 'Rules' },
  instruction: { vi: 'Sắp xếp quy tắc.', en: 'Arrange the rules.' },
  config: {
    input: 4,
    target: 11,
    cards: [
      { id: 'double', operation: 'multiply', operand: 2 },
      { id: 'plus-three', operation: 'add', operand: 3 },
    ],
  },
};

function ControlledLab({ onReset = vi.fn(), lang = 'en' }: { onReset?: () => void; lang?: 'en' | 'vi' }) {
  const [value, setValue] = useState<unknown>({ cardIds: ['double', 'plus-three'] });
  return <ExecutableRulesLab definition={definition} lang={lang} value={value} onChange={setValue} onReset={onReset} onBack={() => undefined} />;
}

describe('ExecutableRulesLab', () => {
  it('reorders cards with buttons, lists every trace value, and explains a wrong target', () => {
    render(<ControlledLab />);

    expect(screen.getByRole('list', { name: /calculation trace/i })).toHaveTextContent('4, 8, 11');
    fireEvent.click(screen.getByRole('button', { name: /move rule card 1 down/i }));
    expect(screen.getByRole('list', { name: /calculation trace/i })).toHaveTextContent('4, 7, 14');
    expect(screen.getByText(/does not match the target 11/i)).toBeVisible();
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

  it('uses localized presentational labels instead of internal card IDs or operation tokens', () => {
    render(<ControlledLab lang="vi" />);

    expect(screen.getByRole('img', { name: /Thẻ quy tắc 1: nhân 2/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /Đưa Thẻ quy tắc 1 xuống/i })).toBeVisible();
    expect(screen.queryByText(/double|plus-three|multiply/i)).not.toBeInTheDocument();
  });
});
