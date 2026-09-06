import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import type { LabRuntimeProps } from '../runtime';
import MorseSpacingLab from './MorseSpacingLab';

const definition = {
  kind: 'morse-spacing',
  title: { vi: 'Đọc cả khoảng lặng', en: 'Reading the Gaps' },
  instruction: {
    vi: 'Giữ nguyên các dấu chấm và gạch.',
    en: 'Keep the dots and dashes unchanged.',
  },
  config: { example: 'ET' },
} as unknown as LabRuntimeProps['definition'];

function MessageProbe(props: LabRuntimeProps) {
  const { state } = useRequiredMessageJourney();
  return <>
    <output aria-label="Learner message">{state.messageText}</output>
    <MorseSpacingLab {...props} />
  </>;
}

function markWidths() {
  return [...screen.getByRole('img', { name: 'Signal timeline' }).querySelectorAll('[data-kind="mark"]')]
    .map((element) => element.getAttribute('width'));
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('MorseSpacingLab', () => {
  it.each(['en', 'vi'] as const)('offers a reflective Predict stage without requiring an answer in %s', (lang) => {
    renderJourneyLab(MorseSpacingLab, definition, { lang, sceneId: 'scene-03' });
    const prediction = screen.getByRole('region', { name: lang === 'en' ? 'Predict' : 'Dự đoán' });
    expect(prediction.textContent!.length).toBeGreaterThan(30);
    expect(prediction.querySelector('input, button, select, textarea')).toBeNull();
    expect(screen.getByRole('region', { name: lang === 'en' ? 'Try' : 'Thử' })).toBeVisible();
  });
  it('reads ET as A after shortening only the letter gap', () => {
    renderJourneyLab(MorseSpacingLab, definition, { lang: 'en', sceneId: 'scene-03' });
    fireEvent.click(screen.getByRole('button', { name: 'Read signal' }));
    expect(screen.getByRole('status')).toHaveTextContent('ET');
    const before = markWidths();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Gap between letters' }), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read signal' }));

    expect(screen.getByRole('status')).toHaveTextContent('A');
    expect(markWidths()).toEqual(before);
    expect(within(screen.getByRole('table', { name: 'Segments in the last signal' })).getAllByRole('row')).toHaveLength(4);
  });

  it('makes the BEAM ET word boundary visible at the declared threshold', () => {
    renderJourneyLab(MorseSpacingLab, definition, { lang: 'en', sceneId: 'scene-03' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Example' }), { target: { value: 'BEAM ET' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read signal' }));
    expect(screen.getByRole('status')).toHaveTextContent('BEAM ET');
    const before = markWidths();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Gap between words' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read signal' }));

    expect(screen.getByRole('status')).toHaveTextContent('BEAMET');
    expect(markWidths()).toEqual(before);
  });

  it('shows standard timings separately from the lab decoder thresholds', () => {
    renderJourneyLab(MorseSpacingLab, definition, { lang: 'en', sceneId: 'scene-03' });

    expect(screen.getByText(/Modern teaching model/)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Decoder thresholds' })).toHaveTextContent('gap < 2');
    expect(screen.getByRole('region', { name: 'Decoder thresholds' })).toHaveTextContent('gap ≥ 5');
    expect(screen.queryByRole('button', { name: /play|listen|audio/i })).not.toBeInTheDocument();
  });

  it('shows an unknown-code outcome instead of keeping an older reading', () => {
    renderJourneyLab(MorseSpacingLab, definition, { lang: 'en', sceneId: 'scene-03' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Example' }), { target: { value: 'BEAM' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Gap between letters' }), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read signal' }));

    expect(screen.getByRole('status')).toHaveTextContent('does not match an International Morse letter');
    expect(screen.getByRole('img', { name: 'Signal timeline' })).toBeVisible();
  });

  it('keeps the learner message untouched through runs and reset', () => {
    renderJourneyLab(MessageProbe, definition, { lang: 'en', example: 'Learner words', sceneId: 'scene-03' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Gap between letters' }), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read signal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByLabelText('Learner message')).toHaveTextContent('Learner words');
  });
});
