import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import GradientDescentLab from './GradientDescentLab';

const definition: LabRuntimeProps['definition'] = {
  kind: 'gradient-descent',
  title: { en: 'Gradient descent', vi: 'Hạ dốc gradient' },
  instruction: { en: 'Take a step.', vi: 'Đi một bước.' },
  config: {
    startX: 5,
    targetX: 2,
    learningRates: [0.1, 1.1],
    fundingTimeline: [
      { year: 1974, value: 2, label: { en: 'Funding narrows', vi: 'Tài trợ thu hẹp' } },
      { year: 1986, value: 6, label: { en: 'New expectations', vi: 'Kỳ vọng mới' } },
    ],
  },
};

function ControlledLab() {
  const [value, setValue] = useState<unknown>({ x: 5, rate: 0.1, steps: 0, timelineIndex: 0 });
  return <GradientDescentLab definition={definition} lang="en" value={value} onChange={setValue} onReset={() => undefined} onBack={() => undefined} />;
}

describe('GradientDescentLab', () => {
  it('uses a chosen learning rate for one manual step', () => {
    render(<ControlledLab />);
    fireEvent.change(screen.getByLabelText('Learning rate'), { target: { value: '0.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Take one step' }));

    expect(screen.getByRole('status')).toHaveTextContent('x 4.4');
    expect(screen.getByRole('status')).toHaveTextContent('loss 5.76');
  });

  it('explores the funding and expectation timeline independently from the descent state', () => {
    render(<ControlledLab />);
    fireEvent.click(screen.getByRole('button', { name: /1986: new expectations/i }));

    expect(screen.getByRole('button', { name: /1986: new expectations/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('x 5');
    expect(screen.getByRole('img', { name: /loss landscape/i })).toBeVisible();
  });
});
