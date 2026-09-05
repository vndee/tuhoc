import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import AgiDefinitionsLab from './AgiDefinitionsLab';

const definition: LabRuntimeProps['definition'] = {
  kind: 'agi-definitions',
  title: { en: 'AGI definitions', vi: 'Các định nghĩa AGI' },
  instruction: { en: 'Compare definitions.', vi: 'So sánh định nghĩa.' },
  config: {
    definitions: [
      { id: 'breadth', label: { en: 'Breadth-first', vi: 'Ưu tiên phạm vi' }, sourceId: 'test', sourceLabel: { en: 'Test source', vi: 'Nguồn thử' }, note: { en: 'Broad task coverage.', vi: 'Phạm vi nhiệm vụ rộng.' }, generality: 4, capability: 5, autonomy: 1 },
      { id: 'agency', label: { en: 'Agency-first', vi: 'Ưu tiên tự chủ' }, sourceId: 'test', sourceLabel: { en: 'Test source', vi: 'Nguồn thử' }, note: { en: 'Independent action matters.', vi: 'Hành động độc lập quan trọng.' }, generality: 5, capability: 4, autonomy: 2 },
      { id: 'social', label: { en: 'Social-first', vi: 'Ưu tiên xã hội' }, sourceId: 'test', sourceLabel: { en: 'Test source', vi: 'Nguồn thử' }, note: { en: 'Consequences are social.', vi: 'Hệ quả là xã hội.' }, generality: 4, capability: 3, autonomy: 4 },
    ],
  },
};

function ControlledLab({ labDefinition = definition, lang = 'en' }: { labDefinition?: LabRuntimeProps['definition']; lang?: 'en' | 'vi' }) {
  const [value, setValue] = useState<unknown>({ selectedIds: ['breadth', 'agency'] });
  return <AgiDefinitionsLab definition={labDefinition} lang={lang} value={value} onChange={setValue} onReset={() => undefined} onBack={() => undefined} />;
}

describe('AgiDefinitionsLab', () => {
  it('compares two definitions on independently labeled axes and in a difference table', () => {
    render(<ControlledLab />);
    const breadthPlot = screen.getByRole('img', { name: /Breadth-first.*generality.*capability.*autonomy/i });
    const agencyPlot = screen.getByRole('img', { name: /Agency-first.*generality.*capability.*autonomy/i });
    expect(breadthPlot).toBeVisible();
    expect(screen.getByRole('table', { name: /definition differences/i })).toHaveTextContent(/Generality.*-1.*Capability.*1.*Autonomy.*-1/i);
    expect(circleCx(breadthPlot, 0)).toBeLessThan(circleCx(agencyPlot, 0));

    fireEvent.change(screen.getByLabelText('Second definition'), { target: { value: 'social' } });
    expect(screen.getByRole('table', { name: /definition differences/i })).toHaveTextContent(/Generality.*0.*Capability.*2.*Autonomy.*-3/i);
    const socialPlot = screen.getByRole('img', { name: /Social-first.*generality.*capability.*autonomy/i });
    expect(circleCx(breadthPlot, 0)).toBe(circleCx(socialPlot, 0));
  });

  it('names definition disagreement and decision power without presenting a winner or a countdown', () => {
    render(<ControlledLab />);
    expect(screen.getByText(/definition disagreement.*decision power/i)).toBeVisible();
    expect(screen.queryByText(/AGI score|điểm AGI|countdown|đếm ngược/i)).not.toBeInTheDocument();
  });

  it('surfaces each selected frame’s localized source qualification', () => {
    const { rerender } = render(<ControlledLab />);
    expect(screen.getByText('Broad task coverage.')).toBeVisible();
    expect(screen.getByText('Independent action matters.')).toBeVisible();

    rerender(<ControlledLab lang="vi" />);
    expect(screen.getByText('Phạm vi nhiệm vụ rộng.')).toBeVisible();
    expect(screen.getByText('Hành động độc lập quan trọng.')).toBeVisible();
  });

  it('keeps plots on the full 0–5 scale when the selected definitions do not reach five', () => {
    const reducedScale = {
      ...definition,
      config: { definitions: definition.config.definitions.map((item) => ({ ...item, generality: 4, capability: 3, autonomy: 2 })) },
    } satisfies LabRuntimeProps['definition'];

    render(<ControlledLab labDefinition={reducedScale} />);
    expect(circleCx(screen.getByRole('img', { name: /Breadth-first/i }), 0)).toBe(232);
  });
});

function circleCx(plot: HTMLElement, axisIndex: number): number {
  const circles = plot.querySelectorAll('circle');
  expect(circles).toHaveLength(3);
  const cx = Number(circles[axisIndex]?.getAttribute('cx'));
  expect(Number.isFinite(cx)).toBe(true);
  return cx;
}
