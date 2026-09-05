import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import type { LabRuntimeProps } from '../runtime';
import AmbiguousCodeLab from './AmbiguousCodeLab';

const definition = {
  kind: 'ambiguous-code',
  title: { vi: 'Cùng một dấu, mấy cách đọc?', en: 'One Signal, Several Readings' },
  instruction: {
    vi: 'Đặt mã cho A, B, C, D.',
    en: 'Assign codes to A, B, C and D.',
  },
  config: { initialBook: { A: '0', B: '01', C: '1', D: '11' }, initialSymbols: 'B' },
} as unknown as LabRuntimeProps['definition'];

function MessageProbe(props: LabRuntimeProps) {
  const { state } = useRequiredMessageJourney();
  return <>
    <output aria-label="Learner message">{state.messageText}</output>
    <AmbiguousCodeLab {...props} />
  </>;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('AmbiguousCodeLab', () => {
  it('starts with B selected and computes only after an explicit Send', () => {
    renderJourneyLab(AmbiguousCodeLab, definition, { lang: 'en', sceneId: 'scene-02' });

    expect(screen.getByLabelText('Source symbols')).toHaveTextContent('B');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByRole('img', { name: 'Branching decode for the last signal' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByRole('status')).toHaveTextContent('There are 2 valid readings');
    expect(screen.getByRole('img', { name: 'Branching decode for the last signal' })).toBeVisible();
    expect(within(screen.getByLabelText('Equivalent readings')).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['AC', 'B']);
    expect(screen.getByText('Exact total: 2')).toBeVisible();
  });

  it('keeps invalid drafts visible, disables Send, and allows duplicate codes', () => {
    renderJourneyLab(AmbiguousCodeLab, definition, { lang: 'en', sceneId: 'scene-02' });
    const aCode = screen.getByRole('textbox', { name: 'Code for A' });

    fireEvent.change(aCode, { target: { value: '' } });
    expect(aCode).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Use 1 to 6 binary digits for every code.');

    fireEvent.change(aCode, { target: { value: '01' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('status')).toHaveTextContent('valid readings');
  });

  it('applies the prefix-free preset, then reports one reading only after Send', () => {
    renderJourneyLab(AmbiguousCodeLab, definition, { lang: 'en', sceneId: 'scene-02' });
    fireEvent.click(screen.getByRole('button', { name: 'Use prefix-free preset' }));

    expect(screen.getByRole('textbox', { name: 'Code for A' })).toHaveValue('00');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByText('This codebook is prefix-free; each decodable signal has at most one reading.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('status')).toHaveTextContent('There is 1 valid reading');
    expect(within(screen.getByLabelText('Equivalent readings')).getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows that a prefix collision does not make every sent signal ambiguous', () => {
    renderJourneyLab(AmbiguousCodeLab, definition, { lang: 'en', sceneId: 'scene-02' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear symbols' }));
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByText('This codebook has a prefix collision. Some signals may have several readings; others may not.')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('There is 1 valid reading');
    expect(within(screen.getByLabelText('Equivalent readings')).getByRole('listitem')).toHaveTextContent('A');
  });

  it('preserves the previous run and its codebook while settings change', () => {
    renderJourneyLab(AmbiguousCodeLab, definition, { lang: 'en', sceneId: 'scene-02' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Code for B' }), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    expect(screen.getByRole('status')).toHaveTextContent('There are 2 valid readings');
    expect(screen.getByLabelText('Source used for the last Send')).toHaveTextContent('B');
    expect(screen.getByLabelText('Source symbols')).toHaveTextContent('BA');
    const sentBook = screen.getByLabelText('Codebook used for the last Send');
    expect(within(sentBook).getByRole('row', { name: 'B 01' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Code for B' })).toHaveValue('10');
  });

  it('never edits the learner message while exploring its controlled example', () => {
    renderJourneyLab(MessageProbe, definition, { lang: 'en', example: 'Learner words', sceneId: 'scene-02' });
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByLabelText('Learner message')).toHaveTextContent('Learner words');
  });
});
