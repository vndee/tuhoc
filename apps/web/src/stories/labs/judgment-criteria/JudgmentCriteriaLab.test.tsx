import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import JudgmentCriteriaLab from './JudgmentCriteriaLab';

const definition: LabRuntimeProps['definition'] = {
  kind: 'judgment-criteria',
  title: { vi: 'Phán đoán', en: 'Judgment' },
  instruction: { vi: 'Đổi tiêu chí.', en: 'Change the human criterion.' },
  config: {
    transcript: { vi: [{ speaker: 'judge', text: 'Xin chào.' }], en: [{ speaker: 'judge', text: 'Hello.' }] },
    criteria: [
      { id: 'consistency', label: { vi: 'Nhất quán', en: 'Consistency' }, finding: { vi: 'Các câu trả lời khớp nhau.', en: 'The answers agree with one another.' } },
      { id: 'knowledge', label: { vi: 'Kiến thức', en: 'Knowledge' }, finding: { vi: 'Có một chi tiết cụ thể.', en: 'The answers cite a concrete fact.' } },
    ],
  },
};

function ControlledLab() {
  const [value, setValue] = useState<unknown>({ enabledIds: [] });
  return <JudgmentCriteriaLab definition={definition} lang="en" value={value} onChange={setValue} onReset={() => undefined} onBack={() => undefined} />;
}

describe('JudgmentCriteriaLab', () => {
  it('frames a transcript through distinct human criteria instead of a score', () => {
    const { container } = render(<ControlledLab />);

    expect(screen.getByRole('figure', { name: /conversation transcript/i })).toHaveTextContent('Hello.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Consistency' }));
    expect(screen.getByText('The answers agree with one another.')).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Knowledge' }));
    expect(screen.getByText('The answers cite a concrete fact.')).toBeVisible();
    expect(container.querySelectorAll('*')).not.toContainEqual(expect.objectContaining({ textContent: expect.stringMatching(/AI score|điểm AI/i) }));
  });
});
