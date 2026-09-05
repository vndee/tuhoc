import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import type { LabRuntimeProps } from '../runtime';
import PulseChannelLab from './PulseChannelLab';

const definition = {
  kind: 'pulse-channel',
  title: { vi: 'Xung còn nhận ra nhau không?', en: 'Can the Pulses Still Be Distinguished?' },
  instruction: {
    vi: 'Tăng tốc gửi mà giữ nguyên kênh.',
    en: 'Send faster through the same channel.',
  },
  config: { defaultDuration: 1 },
} as unknown as LabRuntimeProps['definition'];

function MessageChangingLab(props: LabRuntimeProps) {
  const journey = useRequiredMessageJourney();
  return <>
    <button type="button" onClick={() => journey.dispatch({ type: 'commit', text: 'Changed message' })}>
      Change the committed message
    </button>
    <PulseChannelLab {...props} />
  </>;
}

function ReopenableLab(props: LabRuntimeProps) {
  const [open, setOpen] = useState(true);
  return open ? <>
    <button type="button" onClick={() => setOpen(false)}>Close pulse lab</button>
    <PulseChannelLab {...props} />
  </> : <button type="button" onClick={() => setOpen(true)}>Open pulse lab</button>;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('PulseChannelLab', () => {
  it.each([
    {
      lang: 'en' as const,
      stages: ['Predict', 'Try', 'Observe', 'Explain and limits'],
      prompt: /where do you expect the receiver to mistake a bit/i,
      run: 'Run experiment',
    },
    {
      lang: 'vi' as const,
      stages: ['Dự đoán', 'Thử', 'Quan sát', 'Giải thích và giới hạn'],
      prompt: /bạn dự đoán người nhận sẽ nhầm bit nào/i,
      run: 'Chạy thử',
    },
  ])('shows a localized, non-gating Predict → Try → Observe → Explain flow in $lang', ({
    lang, stages, prompt, run,
  }) => {
    renderJourneyLab(PulseChannelLab, definition, { lang, sceneId: 'scene-05' });

    expect(screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual(stages);
    const prediction = screen.getByRole('region', { name: stages[0] });
    expect(within(prediction).getByText(prompt)).toBeVisible();
    expect(prediction.querySelector('input, button, select, textarea')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: run }));
    expect(screen.getByRole('status')).toHaveTextContent(lang === 'en' ? /receiver errors/ : /bit người nhận đọc sai/);
  });

  it('runs the bounded alternating window and exposes the same real samples as a waveform and table', () => {
    renderJourneyLab(PulseChannelLab, definition, { lang: 'en', sceneId: 'scene-05' });

    expect(screen.getAllByRole('button', { name: /Bit \d+:/ })).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));

    const waveform = screen.getByRole('img', { name: 'Input and channel-output waveform' });
    expect(waveform.querySelector('[data-trace="input"]')).toBeInTheDocument();
    expect(waveform.querySelector('[data-trace="output"]')).toBeInTheDocument();
    expect(waveform.querySelectorAll('[data-sample-time]')).toHaveLength(8);
    const table = screen.getByRole('table', { name: 'Receiver sample points' });
    expect(within(table).getAllByRole('row')).toHaveLength(9);
    expect(within(table).getByRole('cell', { name: '0.500' })).toBeVisible();
    expect(within(table).getByRole('rowheader', { name: '1' })).toBeVisible();
  });

  it('keeps tau independent when T changes and leaves the previous plot visibly stale until Run', () => {
    renderJourneyLab(PulseChannelLab, definition, { lang: 'en', sceneId: 'scene-05' });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    const oldOutput = screen.getByRole('img', { name: 'Input and channel-output waveform' })
      .querySelector('[data-trace="output"]')?.getAttribute('d');

    fireEvent.change(screen.getByRole('combobox', { name: 'Symbol duration T' }), { target: { value: '2' } });

    expect(screen.getByRole('combobox', { name: 'Channel memory tau' })).toHaveValue('1');
    expect(screen.getByRole('status')).toHaveTextContent('previous settings');
    expect(screen.getByRole('img', { name: 'Input and channel-output waveform' })
      .querySelector('[data-trace="output"]')).toHaveAttribute('d', oldOutput);
    expect(screen.getByRole('table', { name: 'Receiver sample points' })).toHaveTextContent('0.500');

    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    expect(screen.getByRole('status')).not.toHaveTextContent('previous settings');
    expect(screen.getByRole('table', { name: 'Receiver sample points' })).toHaveTextContent('1.000');
  });

  it('pages the original message in 64-bit windows and marks a run stale when the source window changes', () => {
    renderJourneyLab(PulseChannelLab, definition, {
      lang: 'en', sceneId: 'scene-05', example: 'AAAAAAAAA',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Original message bytes' }));
    expect(screen.getByRole('status')).toHaveTextContent('previous settings');
    expect(screen.getByText('The waveform and table below are a snapshot of the previous run.')).toBeVisible();
    expect(screen.getByText('Bits 1–64 of 72')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Bit \d+:/ })).toHaveLength(64);
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));

    fireEvent.click(screen.getByRole('button', { name: 'Next bits' }));
    expect(screen.getByText('Bits 65–72 of 72')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Bit \d+:/ })).toHaveLength(8);
    expect(screen.getByRole('status')).toHaveTextContent('previous settings');
  });

  it('marks an immutable snapshot stale after the committed message revision changes', () => {
    renderJourneyLab(MessageChangingLab, definition, { lang: 'en', sceneId: 'scene-05', example: 'Original' });
    fireEvent.click(screen.getByRole('radio', { name: 'Original message bytes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    const tableBefore = screen.getByRole('table', { name: 'Receiver sample points' }).textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Change the committed message' }));

    expect(screen.getByRole('status')).toHaveTextContent('previous message');
    expect(screen.getByRole('table', { name: 'Receiver sample points' }).textContent).toBe(tableBefore);
  });

  it('preserves independent controls and the plotted run across a close and reopen in the scene-05 session', () => {
    renderJourneyLab(ReopenableLab, definition, { lang: 'en', sceneId: 'scene-05' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Symbol duration T' }), { target: { value: '4' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Channel memory tau' }), { target: { value: '0.5' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Sample point' }), { target: { value: '0.75' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    const samplesBefore = screen.getByRole('table', { name: 'Receiver sample points' }).textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Close pulse lab' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open pulse lab' }));

    expect(screen.getByRole('combobox', { name: 'Symbol duration T' })).toHaveValue('4');
    expect(screen.getByRole('combobox', { name: 'Channel memory tau' })).toHaveValue('0.5');
    expect(screen.getByRole('combobox', { name: 'Sample point' })).toHaveValue('0.75');
    expect(screen.getByRole('table', { name: 'Receiver sample points' }).textContent).toBe(samplesBefore);
  });
});
