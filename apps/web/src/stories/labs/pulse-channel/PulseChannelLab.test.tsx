import { fireEvent, screen, within } from '@testing-library/react';
import { Component, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import type { RunSnapshot } from '../communication/types';
import type { LabRuntimeProps } from '../runtime';
import PulseChannelLab from './PulseChannelLab';
import type { PulseExperimentConfig, PulseResult } from './model';

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

class ErrorCodeBoundary extends Component<{ children: ReactNode }, { code: string | null }> {
  state = { code: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { code: error.message };
  }

  render() {
    return this.state.code === null
      ? this.props.children
      : <output aria-label="message source error">{this.state.code}</output>;
  }
}

function InvalidMessageSourceLab(props: LabRuntimeProps) {
  return <ErrorCodeBoundary>
    <PulseChannelLab {...props} value={{
      duration: 1, tau: 1, sampleFraction: 0.5, source: 'message', page: 0, snapshot: null,
    }} />
  </ErrorCodeBoundary>;
}

function SnapshotSourceProbeLab(props: LabRuntimeProps) {
  const journey = useRequiredMessageJourney();
  const value = journey.state.experimentStateByScene['scene-05'] as {
    snapshot?: RunSnapshot<PulseExperimentConfig, PulseResult>;
  } | undefined;
  return <>
    <PulseChannelLab {...props} />
    <output aria-label="captured source bytes">{JSON.stringify(value?.snapshot?.source ?? [])}</output>
  </>;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('PulseChannelLab', () => {
  it.each(['en', 'vi'] as const)('renders instantaneous bypass and keeps explanation with the captured tau in %s', lang => {
    renderJourneyLab(PulseChannelLab, definition, { lang, sceneId: 'scene-05' });
    const tau = screen.getByRole('combobox', { name: lang === 'en' ? 'Channel memory tau' : 'Bộ nhớ kênh tau' });
    const run = screen.getByRole('button', { name: lang === 'en' ? 'Run experiment' : 'Chạy thử' });
    const bypass = lang === 'en' ? /output without memory/i : /đầu ra không có bộ nhớ/i;
    const memory = lang === 'en' ? /output with memory/i : /đầu ra có bộ nhớ/i;
    const previous = lang === 'en' ? /still carries a trace of the previous pulse/i : /còn giữ dấu vết của xung trước/i;
    fireEvent.change(tau, { target: { value: '0' } });
    fireEvent.click(run);
    const path = document.querySelector('[data-trace="output"]')!.getAttribute('d')!;
    const coordinates = [...path.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
    expect(coordinates[0]).toEqual([48, 202]);
    for (let i = 1; i < coordinates.length; i++) {
      if (coordinates[i]![1] !== coordinates[i - 1]![1]) expect(coordinates[i]![0]).toBe(coordinates[i - 1]![0]);
    }
    expect(screen.getByText(bypass)).toBeVisible();
    expect(screen.queryByText(previous)).not.toBeInTheDocument();
    fireEvent.change(tau, { target: { value: '1' } });
    expect(document.querySelector('[data-trace="output"]')).toHaveAttribute('d', path);
    expect(screen.getByText(bypass)).toBeVisible();
    expect(screen.queryByText(previous)).not.toBeInTheDocument();
    fireEvent.click(run);
    expect(screen.getByText(memory)).toBeVisible();
    expect(screen.getByText(previous)).toBeVisible();
    fireEvent.change(tau, { target: { value: '0' } });
    expect(screen.getByText(memory)).toBeVisible();
    expect(screen.getByText(previous)).toBeVisible();
  });

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

  it('captures the exact decomposed UTF-8 message bytes without normalization', () => {
    renderJourneyLab(SnapshotSourceProbeLab, definition, {
      lang: 'en', sceneId: 'scene-05', example: 'a\u0306\u0301',
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Original message bytes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));

    expect(screen.getByLabelText('captured source bytes')).toHaveTextContent('[97,204,134,204,129]');
  });

  it('fails with a fixed content-free code instead of replacing an ill-formed message source', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderJourneyLab(InvalidMessageSourceLab, definition, {
      lang: 'en', sceneId: 'scene-05', example: '\ud800',
    });

    expect(screen.getByLabelText('message source error')).toHaveTextContent('invalid-message-source');
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
