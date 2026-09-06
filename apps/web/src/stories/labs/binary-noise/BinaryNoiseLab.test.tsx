import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import type { RunSnapshot } from '../communication/types';
import type { LabRuntimeProps } from '../runtime';
import BinaryNoiseLab from './BinaryNoiseLab';
import type { BinaryNoiseConfig, NoiseResult } from './model';

const definition = {
  kind: 'binary-noise',
  title: { vi: 'Một câu qua kênh nhiễu', en: 'A Message Through Noise' },
  instruction: {
    vi: 'Chọn mức nhiễu rồi truyền câu của bạn.',
    en: 'Choose a noise level and transmit your message.',
  },
  config: { defaultP: 0.3, seed: 20260905 },
} as unknown as LabRuntimeProps['definition'];

function MessageChangingLab(props: LabRuntimeProps) {
  const journey = useRequiredMessageJourney();
  return <>
    <button type="button" onClick={() => journey.dispatch({ type: 'commit', text: 'Changed message' })}>
      Change the committed message
    </button>
    <BinaryNoiseLab {...props} />
  </>;
}

function SnapshotProbeLab(props: LabRuntimeProps) {
  const journey = useRequiredMessageJourney();
  const value = journey.state.experimentStateByScene['scene-06'] as {
    snapshot?: RunSnapshot<BinaryNoiseConfig, NoiseResult>;
  } | undefined;
  return <>
    <BinaryNoiseLab {...props} />
    <output aria-label="captured source bytes">{JSON.stringify(value?.snapshot?.source ?? [])}</output>
  </>;
}

function ReopenableLab(props: LabRuntimeProps) {
  const [open, setOpen] = useState(true);
  return open ? <>
    <button type="button" onClick={() => setOpen(false)}>Close noise lab</button>
    <BinaryNoiseLab {...props} />
  </> : <button type="button" onClick={() => setOpen(true)}>Open noise lab</button>;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('BinaryNoiseLab', () => {
  it('ignores an incomplete route-memory snapshot without throwing or logging the message', () => {
    function MalformedSnapshot(props: LabRuntimeProps) {
      return <BinaryNoiseLab {...props} value={{ config: { mode: 'bsc', p: 0, seed: 1, manual: [] }, snapshot: {
        messageRevision: 0, source: [65], config: {}, result: {},
      } }} />;
    }
    renderJourneyLab(MalformedSnapshot, definition, { lang: 'en', sceneId: 'scene-06' });
    expect(screen.getByRole('button', { name: 'Run experiment' })).toBeEnabled();
    expect(screen.queryByLabelText('Received bytes in hexadecimal')).not.toBeInTheDocument();
  });
  it.each([
    {
      lang: 'en' as const,
      stages: ['Predict', 'Try', 'Observe', 'Explain and limits'],
      prompt: /which bit positions do you expect to change/i,
      run: 'Run experiment',
      mode: 'Noise mode',
    },
    {
      lang: 'vi' as const,
      stages: ['Dự đoán', 'Thử', 'Quan sát', 'Giải thích và giới hạn'],
      prompt: /bạn dự đoán những vị trí bit nào sẽ đổi/i,
      run: 'Chạy thử',
      mode: 'Chế độ nhiễu',
    },
  ])('shows a localized non-gating Predict → Try → Observe → Explain flow in $lang', ({
    lang, stages, prompt, run, mode,
  }) => {
    renderJourneyLab(BinaryNoiseLab, definition, { lang, sceneId: 'scene-06' });

    expect(screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toContain(stages[0]);
    for (const stage of stages) expect(screen.getByRole('heading', { level: 4, name: stage })).toBeVisible();
    const prediction = screen.getByRole('region', { name: stages[0] });
    expect(within(prediction).getByText(prompt)).toBeVisible();
    expect(prediction.querySelector('input, button, select, textarea')).toBeNull();
    expect(screen.getByRole('group', { name: mode })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: run }));
    expect(screen.getByRole('status')).toHaveTextContent(lang === 'en' ? /This run changed \d+\/\d+ bits/ : /Lần này đổi \d+\/\d+ bit/);
  });

  it('replays the same BSC result for the same p and seed, and a new seed leaves the old result stale', () => {
    renderJourneyLab(BinaryNoiseLab, definition, { lang: 'en', sceneId: 'scene-06', example: 'AA' });

    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    const receivedBefore = screen.getByLabelText('Received bytes in hexadecimal').textContent;
    const statusBefore = screen.getByRole('status').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    expect(screen.getByLabelText('Received bytes in hexadecimal')).toHaveTextContent(receivedBefore ?? '');
    expect(screen.getByRole('status')).toHaveTextContent(statusBefore ?? '');

    fireEvent.click(screen.getByRole('button', { name: 'New noise sample' }));
    expect(screen.getByRole('spinbutton', { name: 'Noise seed' })).toHaveValue(20260906);
    expect(screen.getByRole('status')).toHaveTextContent('Result for the previous settings');
    expect(screen.getByText('The bytes and decoding below belong to the run with the previous settings.')).toBeVisible();
    expect(screen.getByLabelText('Received bytes in hexadecimal')).toHaveTextContent(receivedBefore ?? '');
  });

  it('preserves a typed half-step probability, explains why it is invalid, and blocks Run', () => {
    renderJourneyLab(BinaryNoiseLab, definition, { lang: 'en', sceneId: 'scene-06', example: 'AA' });
    const probability = screen.getByRole('spinbutton', { name: 'Configured flip probability p' });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    const oldHex = screen.getByLabelText('Received bytes in hexadecimal').textContent;

    fireEvent.change(probability, { target: { value: '0.005' } });

    expect(probability).toHaveValue(0.005);
    expect(probability).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a probability from 0 to 0.5 in steps of 0.01.');
    expect(screen.getByRole('button', { name: 'Run experiment' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Result for the previous settings');
    expect(screen.getByText('The bytes and decoding below belong to the run with the previous settings.')).toBeVisible();
    expect(screen.getByLabelText('Received bytes in hexadecimal')).toHaveTextContent(oldHex ?? '');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(probability).toHaveValue(0.3);
    expect(probability).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run experiment' })).toBeEnabled();
  });

  it('preserves an invalid literal draft and immutable old result across a real scene-06 close and reopen', () => {
    renderJourneyLab(ReopenableLab, definition, { lang: 'en', sceneId: 'scene-06', example: 'AA' });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    const oldHex = screen.getByLabelText('Received bytes in hexadecimal').textContent;
    const oldBits = screen.getAllByRole('button', { name: /Bit \d+:/ }).map((bit) => bit.textContent);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Configured flip probability p' }), {
      target: { value: '0.005' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close noise lab' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open noise lab' }));

    const reopenedProbability = screen.getByRole('spinbutton', { name: 'Configured flip probability p' });
    expect(reopenedProbability).toHaveValue(0.005);
    expect(reopenedProbability).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Run experiment' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Result for the previous settings');
    expect(screen.getByLabelText('Received bytes in hexadecimal')).toHaveTextContent(oldHex ?? '');
    expect(screen.getAllByRole('button', { name: /Bit \d+:/ }).map((bit) => bit.textContent)).toEqual(oldBits);

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(reopenedProbability).toHaveValue(0.3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run experiment' })).toBeEnabled();

    fireEvent.change(reopenedProbability, { target: { value: '0.01' } });
    expect(reopenedProbability).toHaveValue(0.01);
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    expect(screen.getByRole('status')).toHaveTextContent('This run changed');
  });

  it.each(['0', '0.01', '0.5'])('accepts the valid hundredth-step probability %s', (value) => {
    renderJourneyLab(BinaryNoiseLab, definition, { lang: 'en', sceneId: 'scene-06', example: 'AA' });
    const probability = screen.getByRole('spinbutton', { name: 'Configured flip probability p' });

    fireEvent.change(probability, { target: { value } });

    expect(probability).toHaveValue(Number(value));
    expect(probability).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run experiment' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    expect(screen.getByRole('status')).toHaveTextContent('This run changed');
  });

  it.each([
    {
      lang: 'en' as const,
      probability: 'Configured flip probability p',
      error: 'Enter a probability from 0 to 0.5 in steps of 0.01.',
    },
    {
      lang: 'vi' as const,
      probability: 'Xác suất lật bit cấu hình p',
      error: 'Nhập xác suất từ 0 đến 0,5 theo bước 0,01.',
    },
  ])('localizes invalid probability feedback in $lang', ({ lang, probability, error }) => {
    renderJourneyLab(BinaryNoiseLab, definition, { lang, sceneId: 'scene-06', example: 'AA' });

    fireEvent.change(screen.getByRole('spinbutton', { name: probability }), { target: { value: '0.005' } });

    expect(screen.getByRole('alert')).toHaveTextContent(error);
  });

  it('supports a manual flip set, reports strict invalid UTF-8, and toggling the bit twice restores exact bytes', () => {
    renderJourneyLab(BinaryNoiseLab, definition, { lang: 'en', sceneId: 'scene-06', example: 'A' });
    fireEvent.click(screen.getByRole('radio', { name: 'Manual bit flips' }));
    expect(screen.getByText(/does not make an independent random-flip claim/i)).toBeVisible();

    const firstBit = screen.getByRole('button', { name: 'Bit 1: 0' });
    fireEvent.click(firstBit);
    expect(firstBit).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));

    expect(screen.getByRole('status')).toHaveTextContent('This run changed 1/8 bits');
    expect(screen.getByLabelText('Received bytes in hexadecimal')).toHaveTextContent('C1');
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot decode as valid UTF-8 text');
    expect(screen.getByText('Received bytes differ from the source bytes.')).toBeVisible();
    expect(screen.getByText('Observed bit error rate (BER): 12.50%.')).toBeVisible();

    fireEvent.click(screen.getAllByRole('button', { name: 'Bit 1: 0, flipped' })[0]!);
    expect(screen.getByRole('status')).toHaveTextContent('Result for the previous settings');
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    expect(screen.getByLabelText('Received bytes in hexadecimal')).toHaveTextContent('41');
    expect(screen.getByText('Received bytes exactly match the source bytes.')).toBeVisible();
    expect(screen.getByLabelText('Strict UTF-8 decoded text')).toHaveTextContent('A');
  });

  it('renders no more than 64 actual received bits per page while statistics cover the full payload', () => {
    renderJourneyLab(BinaryNoiseLab, definition, { lang: 'en', sceneId: 'scene-06', example: 'AAAAAAAAA' });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));

    const observation = screen.getByRole('region', { name: 'Observe' });
    expect(within(observation).getByText('Bits 1–64 of 72')).toBeVisible();
    expect(within(observation).getAllByRole('button', { name: /Bit \d+:/ })).toHaveLength(64);
    expect(screen.getByRole('status')).toHaveTextContent('/72 bits');

    fireEvent.click(within(observation).getByRole('button', { name: 'Next bits' }));
    expect(within(observation).getByText('Bits 65–72 of 72')).toBeVisible();
    expect(within(observation).getAllByRole('button', { name: /Bit \d+:/ })).toHaveLength(8);
  });

  it('uses one bounded editable bit window after a 72-bit manual run and restores a toggled bit', () => {
    renderJourneyLab(BinaryNoiseLab, definition, { lang: 'en', sceneId: 'scene-06', example: 'AAAAAAAAA' });
    fireEvent.click(screen.getByRole('radio', { name: 'Manual bit flips' }));

    const firstBit = screen.getByRole('button', { name: 'Bit 1: 0' });
    fireEvent.click(firstBit);
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    expect(screen.getAllByRole('button', { name: /Bit \d+:/ })).toHaveLength(64);
    expect(screen.getByRole('status')).toHaveTextContent('This run changed 1/72 bits');

    fireEvent.click(screen.getByRole('button', { name: 'Next bits' }));
    expect(screen.getByText('Bits 65–72 of 72')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Bit \d+:/ })).toHaveLength(8);

    fireEvent.click(screen.getByRole('button', { name: 'Previous bits' }));
    const selectedBit = screen.getByRole('button', { name: 'Bit 1: 0, flipped' });
    fireEvent.click(selectedBit);
    expect(screen.getByRole('button', { name: 'Bit 1: 0' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    expect(screen.getAllByRole('button', { name: /Bit \d+:/ })).toHaveLength(64);
    expect(screen.getByText('Received bytes exactly match the source bytes.')).toBeVisible();
  });

  it('keeps an immutable old result and marks both edited settings and message revisions stale', () => {
    renderJourneyLab(MessageChangingLab, definition, { lang: 'en', sceneId: 'scene-06', example: 'Original' });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    const oldHex = screen.getByLabelText('Received bytes in hexadecimal').textContent;

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Configured flip probability p' }), { target: { value: '0' } });
    expect(screen.getByRole('status')).toHaveTextContent('Result for the previous settings');
    expect(screen.getByLabelText('Received bytes in hexadecimal')).toHaveTextContent(oldHex ?? '');

    fireEvent.click(screen.getByRole('button', { name: 'Change the committed message' }));
    expect(screen.getByRole('status')).toHaveTextContent('Result for the previous message');
    expect(screen.getByText('The bytes and decoding below belong to the run with the previous message.')).toBeVisible();
    expect(screen.getByLabelText('Received bytes in hexadecimal')).toHaveTextContent(oldHex ?? '');
  });

  it('captures the exact decomposed UTF-8 source bytes through shared Unicode inspection', () => {
    renderJourneyLab(SnapshotProbeLab, definition, {
      lang: 'en', sceneId: 'scene-06', example: 'a\u0306\u0301',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));

    expect(screen.getByLabelText('captured source bytes')).toHaveTextContent('[97,204,134,204,129]');
  });
});
