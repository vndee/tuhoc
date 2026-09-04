import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import AgentTraceLab from './AgentTraceLab';

const definition: LabRuntimeProps['definition'] = {
  kind: 'agent-trace',
  title: { en: 'Agent trace', vi: 'Dấu vết tác tử' },
  instruction: { en: 'Grant permissions.', vi: 'Cấp quyền.' },
  config: {
    steps: [
      { id: 'model', kind: 'model', label: { en: 'Model plan', vi: 'Kế hoạch mô hình' }, permission: null },
      { id: 'tool', kind: 'tool', label: { en: 'Read tool', vi: 'Công cụ đọc' }, permission: 'tool:read' },
      { id: 'data', kind: 'data', label: { en: 'Course data', vi: 'Dữ liệu khoá học' }, permission: 'data:course' },
      { id: 'proposal', kind: 'proposal', label: { en: 'Draft proposal', vi: 'Bản đề xuất' }, permission: null },
      { id: 'approval', kind: 'approval', label: { en: 'Human approval', vi: 'Phê duyệt của con người' }, permission: 'approval:publish' },
    ],
  },
};

function ControlledLab() {
  const [value, setValue] = useState<unknown>({ granted: [] });
  return <AgentTraceLab definition={definition} lang="en" value={value} onChange={setValue} onReset={() => undefined} onBack={() => undefined} />;
}

describe('AgentTraceLab', () => {
  it('shows one ordered trace and stops at the first missing permission without network activity', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<ControlledLab />);
    expect(screen.getByRole('list', { name: /agent trace/i })).toHaveTextContent(/Model plan.*complete.*Read tool.*blocked/i);
    expect(screen.getByRole('list', { name: /agent trace/i })).not.toHaveTextContent('Course data');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('reveals the configured sequence but keeps human approval awaiting-human', () => {
    render(<ControlledLab />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Read tool/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Course data/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Human approval/i }));

    const trace = screen.getByRole('list', { name: /agent trace/i });
    expect(trace).toHaveTextContent(/Model plan.*Read tool.*Course data.*Draft proposal.*Human approval/i);
    expect(trace).toHaveTextContent('awaiting-human');
  });
});
