import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import KnowledgeBottleneckLab from './KnowledgeBottleneckLab';

const definition: LabRuntimeProps['definition'] = {
  kind: 'knowledge-bottleneck',
  title: { en: 'Expert rules', vi: 'Luật chuyên gia' },
  instruction: { en: 'Choose a rule.', vi: 'Chọn một luật.' },
  config: {
    changedRuleId: 'symptom',
    nodes: [
      { id: 'symptom', label: { en: 'Symptom', vi: 'Triệu chứng' }, parentId: null },
      { id: 'fever', label: { en: 'Fever', vi: 'Sốt' }, parentId: 'symptom' },
      { id: 'cough', label: { en: 'Cough', vi: 'Ho' }, parentId: 'symptom' },
      { id: 'exception', label: { en: 'Exception', vi: 'Ngoại lệ' }, parentId: 'fever' },
    ],
  },
};

function ControlledLab() {
  const [value, setValue] = useState<unknown>({ changedRuleId: 'symptom' });
  return <KnowledgeBottleneckLab definition={definition} lang="en" value={value} onChange={setValue} onReset={() => undefined} onBack={() => undefined} />;
}

describe('KnowledgeBottleneckLab', () => {
  it('lets a reader choose a rule or exception and updates the affected branch count', () => {
    render(<ControlledLab />);
    expect(screen.getByRole('status')).toHaveTextContent('3 affected rules');

    fireEvent.change(screen.getByLabelText('Changed rule'), { target: { value: 'exception' } });
    expect(screen.getByRole('status')).toHaveTextContent('0 affected rules');
    expect(screen.getByRole('img', { name: /expert rule tree/i })).toBeVisible();
  });

  it('keeps the toy, illustrative, no-advice safety boundary visible', () => {
    render(<ControlledLab />);
    expect(screen.getByText(/toy rule tree.*illustration.*not medical advice/i)).toBeVisible();
  });
});
