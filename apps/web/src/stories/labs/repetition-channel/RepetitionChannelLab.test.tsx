import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import type { LabRuntimeProps } from '../runtime';
import RepetitionChannelLab from './RepetitionChannelLab';

const definition = {
  kind: 'repetition-channel',
  title: { vi: 'Thử gửi ba lần', en: 'Trying Three Copies' },
  instruction: {
    vi: 'So sánh gửi mỗi bit một lần và ba lần.',
    en: 'Compare sending each bit once and three times.',
  },
  config: { defaultP: 0.05, seed: 20260905 },
} as unknown as LabRuntimeProps['definition'];

function JourneyControls(props: LabRuntimeProps) {
  const journey = useRequiredMessageJourney();
  const [open, setOpen] = useState(true);
  if (!open) return <button type="button" onClick={() => setOpen(true)}>Reopen repetition lab</button>;
  return <>
    <button type="button" onClick={() => setOpen(false)}>Close repetition lab</button>
    <button type="button" onClick={() => journey.dispatch({ type: 'commit', text: 'B' })}>Change message</button>
    <RepetitionChannelLab {...props} />
  </>;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('RepetitionChannelLab', () => {
  it.each([
    { lang: 'en' as const, stages: ['Predict', 'Try', 'Observe', 'Explain and limits'], prompt: /which path will deliver more correct payload bits per channel use/i, run: 'Run experiment' },
    { lang: 'vi' as const, stages: ['Dự đoán', 'Thử', 'Quan sát', 'Giải thích và giới hạn'], prompt: /đường gửi nào sẽ đưa được nhiều bit dữ liệu đúng hơn trên mỗi lần dùng kênh/i, run: 'Chạy thử' },
  ])('shows a localized, non-gating Predict → Try → Observe → Explain flow in $lang', ({ lang, stages, prompt, run }) => {
    renderJourneyLab(RepetitionChannelLab, definition, { lang, example: 'A', sceneId: 'scene-09' });

    for (const stage of stages) expect(screen.getByRole('heading', { level: 4, name: stage })).toBeVisible();
    const prediction = screen.getByRole('region', { name: stages[0] });
    expect(within(prediction).getByText(prompt)).toBeVisible();
    expect(prediction.querySelector('input, button, select, textarea')).toBeNull();
    expect(screen.getByRole('button', { name: run })).toBeEnabled();
  });

  it('runs explicitly, round-trips at p=0, and separates observed results from theory', () => {
    const zeroNoise = { ...definition, config: { defaultP: 0, seed: 20260905 } } as LabRuntimeProps['definition'];
    renderJourneyLab(RepetitionChannelLab, zeroNoise, { lang: 'en', example: 'A', sceneId: 'scene-09' });

    expect(screen.queryByRole('table', { name: 'Observed channel comparison' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));

    const table = screen.getByRole('table', { name: 'Observed channel comparison' });
    expect(within(table).getByRole('row', { name: /One copy 8 0 0 1\.000 1/ })).toBeVisible();
    expect(within(table).getByRole('row', { name: /Three copies 24 0 0 0\.333 0\.333/ })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Independent-channel theory' })).toHaveTextContent('0.000');
    expect(screen.getByLabelText('Original bytes in hexadecimal')).toHaveTextContent('41');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Both paths recovered every payload bit in this run.');
    expect(within(status).getByText('✓')).toHaveAttribute('aria-hidden', 'true');
  });

  it('hides the i.i.d. formula in burst mode and shows both majority correction and failure', () => {
    renderJourneyLab(RepetitionChannelLab, definition, { lang: 'en', example: '\0', sceneId: 'scene-09' });
    fireEvent.click(screen.getByRole('radio', { name: 'One shared burst interval' }));
    expect(screen.queryByRole('region', { name: 'Independent-channel theory' })).not.toBeInTheDocument();
    expect(screen.getByText(/same requested interval is applied to both streams and is bounded by the 8-bit one-copy stream/i)).toBeVisible();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Burst start index' }), { target: { value: '0' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Burst length' }), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    expect(screen.getByRole('row', { name: /Source bit 1.*repeat received 100.*vote 0.*Corrected/i })).toBeVisible();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Burst start index' }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Burst length' }), { target: { value: '2' } });
    expect(screen.getByRole('status')).toHaveTextContent('Result for the previous settings');
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    expect(screen.getByRole('row', { name: /Source bit 1.*repeat received 011.*vote 1.*Majority failure/i })).toBeVisible();
  });

  it('keeps immutable old settings and message snapshots across close and reopen', () => {
    const zeroNoise = { ...definition, config: { defaultP: 0, seed: 20260905 } } as LabRuntimeProps['definition'];
    renderJourneyLab(JourneyControls, zeroNoise, { lang: 'en', example: 'A', sceneId: 'scene-09' });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    expect(screen.getByLabelText('Original bytes in hexadecimal')).toHaveTextContent('41');

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Configured flip probability p' }), { target: { value: '0.5' } });
    expect(screen.getByRole('status')).toHaveTextContent('Result for the previous settings');
    expect(screen.getByLabelText('Original bytes in hexadecimal')).toHaveTextContent('41');

    fireEvent.click(screen.getByRole('button', { name: 'Change message' }));
    expect(screen.getByRole('status')).toHaveTextContent('Result for the previous message');
    fireEvent.click(screen.getByRole('button', { name: 'Close repetition lab' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen repetition lab' }));
    expect(screen.getByRole('spinbutton', { name: 'Configured flip probability p' })).toHaveValue(0.5);
    expect(screen.getByRole('status')).toHaveTextContent('Result for the previous message');
    expect(screen.getByLabelText('Original bytes in hexadecimal')).toHaveTextContent('41');
  });

  it('keeps the combined rendered bit-cell window within 64 and provides text-equivalent triple relationships', () => {
    renderJourneyLab(RepetitionChannelLab, definition, { lang: 'en', example: 'abcdefghijklmnop', sceneId: 'scene-09' });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));

    expect(document.querySelectorAll('[data-bit-cell]').length).toBeLessThanOrEqual(64);
    const relation = screen.getByRole('table', { name: 'Visible source bits and their three-copy relationships' });
    expect(within(relation).getAllByRole('row')).toHaveLength(13);
    expect(within(relation).getByRole('row', { name: /^Source bit 1\b.*original 0.*repeat received [01]{3}.*vote [01]/i })).toBeVisible();
    expect(screen.getByText('Source bits 1–12 of 128')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next source bits' }));
    expect(screen.getByText('Source bits 13–24 of 128')).toBeVisible();
    expect(document.querySelectorAll('[data-bit-cell]').length).toBeLessThanOrEqual(64);
  });
});
