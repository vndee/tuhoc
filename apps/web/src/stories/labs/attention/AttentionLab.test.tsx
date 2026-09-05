import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import AttentionLab from './AttentionLab';

const definition: LabRuntimeProps['definition'] = {
  kind: 'attention',
  title: { en: 'Attention', vi: 'Chú ý' },
  instruction: { en: 'Choose a token.', vi: 'Chọn một token.' },
  config: {
    examples: [
      {
        id: 'bank-finance',
        tokens: { en: ['The', 'bank', 'approved', 'loans'], vi: ['Ngân', 'hàng', 'duyệt', 'vay'] },
        weights: {
          en: [[0.1, 0.7, 0.1, 0.1], [0.2, 0.3, 0.3, 0.2], [0.1, 0.4, 0.3, 0.2], [0.2, 0.3, 0.2, 0.3]],
          vi: [[0.2, 0.5, 0.2, 0.1], [0.1, 0.6, 0.2, 0.1], [0.2, 0.3, 0.3, 0.2], [0.2, 0.2, 0.3, 0.3]],
        },
        gloss: { en: 'bank as a lender', vi: 'ngân hàng là nơi cho vay' },
      },
      {
        id: 'bank-river',
        tokens: { en: ['We', 'rested', 'beside', 'bank'], vi: ['Chúng', 'tôi', 'ngồi', 'cạnh', 'bờ'] },
        weights: {
          en: [[0.4, 0.2, 0.2, 0.2], [0.1, 0.4, 0.3, 0.2], [0.1, 0.2, 0.5, 0.2], [0.1, 0.2, 0.5, 0.2]],
          vi: [[0.2, 0.2, 0.2, 0.2, 0.2], [0.1, 0.3, 0.2, 0.2, 0.2], [0.1, 0.2, 0.3, 0.2, 0.2], [0.1, 0.2, 0.2, 0.3, 0.2], [0.1, 0.2, 0.2, 0.3, 0.2]],
        },
        gloss: { en: 'bank as a river edge', vi: 'bờ sông' },
      },
    ],
  },
};

function ControlledLab() {
  const [value, setValue] = useState<unknown>({ exampleId: 'bank-finance', tokenIndex: 0 });
  return <AttentionLab definition={definition} lang="en" value={value} onChange={setValue} onReset={() => undefined} onBack={() => undefined} />;
}

describe('AttentionLab', () => {
  it('uses focusable token buttons to expose configured weights for both meanings of a polysemous word', () => {
    render(<ControlledLab />);
    const financeBank = screen.getByRole('button', { name: 'Token 2: bank' });
    financeBank.focus();
    expect(financeBank).toHaveFocus();
    fireEvent.click(financeBank);
    expect(screen.getByRole('status')).toHaveTextContent('0.2, 0.3, 0.3, 0.2');

    fireEvent.change(screen.getByLabelText('Context'), { target: { value: 'bank-river' } });
    fireEvent.click(screen.getByRole('button', { name: 'Token 4: bank' }));
    expect(screen.getByRole('status')).toHaveTextContent('0.1, 0.2, 0.5, 0.2');
    expect(screen.getByRole('table', { name: /attention weights as a table/i })).toHaveTextContent('bank');
  });

  it('always names the limit of an attention map as an explanation', () => {
    render(<ControlledLab />);
    expect(screen.getByText(/not a full explanation of model reasoning/i)).toBeVisible();
  });
});
