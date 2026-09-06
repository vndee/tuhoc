import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLanguage } from '../../../i18n/LanguageProvider';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import type { LabRuntimeProps } from '../runtime';
import ChannelBudgetLab from './ChannelBudgetLab';

const definition = {
  kind: 'channel-budget',
  title: { vi: 'Chọn cách gửi trong một giới hạn', en: 'Sending Within a Budget' },
  instruction: {
    vi: 'Chọn ngân sách truyền, mức nhiễu và một mã.',
    en: 'Choose a transmission budget, noise level and code.',
  },
  config: { defaultBudget: 4096, defaultP: 0.05, seed: 20260905 },
} as unknown as LabRuntimeProps['definition'];

function JourneyControls(props: LabRuntimeProps) {
  const journey = useRequiredMessageJourney();
  const { setLang } = useLanguage();
  const [open, setOpen] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  return <>
    <button type="button" onClick={() => journey.dispatch({ type: 'commit', text: 'B' })}>Edit committed message</button>
    <button type="button" onClick={() => journey.dispatch({ type: 'reset-session', example: 'A' })}>Reset session directly</button>
    <button type="button" onClick={() => setOpen((value) => !value)}>{open ? 'Close lab' : 'Reopen lab'}</button>
    <button type="button" onClick={() => setLang('vi')}>Switch to Vietnamese</button>
    <button type="button" onClick={() => setTheme((value) => value === 'light' ? 'dark' : 'light')}>Toggle theme</button>
    <div aria-label="active theme">{theme}</div>
    <div aria-label="session message">{journey.state.messageText}</div>
    <div aria-label="session receipt">{journey.state.deliveryReceipt?.outcome ?? 'none'}</div>
    <div aria-label="stored scene state">{JSON.stringify(journey.state.experimentStateByScene['scene-11'] ?? null)}</div>
    {open ? <ChannelBudgetLab {...props} onBack={() => setOpen(false)} /> : null}
  </>;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('ChannelBudgetLab', () => {
  it('discards a malformed batch with a null row without losing usable transmission controls', () => {
    function MalformedBatch(props: LabRuntimeProps) {
      return <ChannelBudgetLab {...props} value={{ config: { code: 'raw', budget: 4096, p: 0, seed: 1 }, batch: {
        messageRevision: 0, source: [65], config: { budget: 4096, p: 0, seed: 1 }, result: { rows: [null], excluded: [] },
      } }} />;
    }
    renderJourneyLab(MalformedBatch, definition, { lang: 'en', sceneId: 'scene-11' });
    expect(screen.getByRole('button', { name: 'Run transmission' })).toBeEnabled();
    expect(screen.queryByRole('table', { name: 'Completed 200-trial comparison' })).not.toBeInTheDocument();
  });
  it.each([
    { lang: 'en' as const, stages: ['Predict', 'Try', 'Observe', 'Explain and limits'], prompt: /which code do you expect/i, run: 'Run transmission' },
    { lang: 'vi' as const, stages: ['Dự đoán', 'Thử', 'Quan sát', 'Giải thích và giới hạn'], prompt: /bạn dự đoán mã nào/i, run: 'Truyền một lần' },
  ])('shows a localized, non-gating Predict → Try → Observe → Explain flow in $lang', ({ lang, stages, prompt, run }) => {
    renderJourneyLab(ChannelBudgetLab, definition, { lang, example: 'A', sceneId: 'scene-11' });
    for (const stage of stages) expect(screen.getByRole('heading', { level: 4, name: stage })).toBeVisible();
    const prediction = screen.getByRole('region', { name: stages[0] });
    expect(within(prediction).getByText(prompt)).toBeVisible();
    expect(prediction.querySelector('input, button, select, textarea')).toBeNull();
    expect(screen.getByRole('button', { name: run })).toBeEnabled();
  });

  it('rejects an over-budget attempt as a whole and never creates a receipt for it', () => {
    renderJourneyLab(JourneyControls, definition, { lang: 'en', example: 'A'.repeat(65), sceneId: 'scene-11' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Transmission budget in channel uses' }), { target: { value: '512' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run transmission' }));

    expect(screen.getByRole('status')).toHaveTextContent('Budget exceeded');
    expect(screen.getByRole('status')).toHaveTextContent('8 more channel uses');
    expect(screen.getByLabelText('session receipt')).toHaveTextContent('none');
    expect(screen.queryByText(/delivered exactly/i)).not.toBeInTheDocument();
  });

  it('retains an old receipt only as an explicitly previous attempt after a budget rejection', () => {
    renderJourneyLab(JourneyControls, definition, { lang: 'en', example: 'A'.repeat(65), sceneId: 'scene-11' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Configured flip probability p' }), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run transmission' }));
    expect(screen.getByLabelText('session receipt')).toHaveTextContent('exact');

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Transmission budget in channel uses' }), { target: { value: '512' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run transmission' }));

    expect(screen.getByLabelText('session receipt')).toHaveTextContent('none');
    const previous = screen.getByRole('region', { name: 'Previous transmission attempt' });
    expect(previous).toHaveTextContent('This receipt is from the earlier run, not the budget-rejected attempt.');
    expect(previous).toHaveTextContent('Exact delivery');
  });

  it.each([
    {
      outcome: 'rejected',
      configure: () => {
        fireEvent.change(screen.getByRole('combobox', { name: 'Channel code' }), { target: { value: 'secded' } });
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Noise seed' }), { target: { value: '6' } });
      },
      receiptText: 'Rejected: SECDED detected an uncorrectable error pattern.',
    },
    {
      outcome: 'silent-corruption',
      configure: () => {
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Noise seed' }), { target: { value: '1' } });
      },
      receiptText: 'Silent corruption: accepted bytes differ from the source.',
    },
  ])('keeps a prior $outcome outcome honest after a later budget rejection', ({ outcome, configure, receiptText }) => {
    renderJourneyLab(JourneyControls, definition, { lang: 'en', example: 'A'.repeat(65), sceneId: 'scene-11' });
    configure();
    fireEvent.click(screen.getByRole('button', { name: 'Run transmission' }));
    expect(screen.getByLabelText('session receipt')).toHaveTextContent(outcome);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Transmission budget in channel uses' }), { target: { value: '512' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run transmission' }));

    expect(screen.getByLabelText('session receipt')).toHaveTextContent('none');
    const previous = screen.getByRole('region', { name: 'Previous transmission attempt' });
    expect(previous).toHaveTextContent(receiptText);
    expect(previous).toHaveTextContent('This receipt is from the earlier run, not the budget-rejected attempt.');
    expect(previous).not.toHaveTextContent(/successful attempt/i);
  });

  it('labels SECDED rejection and raw corruption without presenting either as exact success', () => {
    const view = renderJourneyLab(JourneyControls, definition, { lang: 'en', example: 'A', sceneId: 'scene-11' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Channel code' }), { target: { value: 'secded' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Noise seed' }), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run transmission' }));
    const rejectedStatus = screen.getByRole('status');
    expect(rejectedStatus).toHaveTextContent('Rejected: SECDED detected an uncorrectable error pattern.');
    expect(rejectedStatus).not.toHaveTextContent(/two errors|exactly two/i);
    expect(screen.getByLabelText('session receipt')).toHaveTextContent('rejected');
    expect(screen.getByText('No payload was accepted.')).toBeVisible();

    view.unmount();
    renderJourneyLab(JourneyControls, definition, { lang: 'en', example: 'A', sceneId: 'scene-11' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Noise seed' }), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run transmission' }));
    expect(screen.getByRole('status')).toHaveTextContent('Silent corruption: accepted bytes differ from the source.');
    expect(screen.getByLabelText('session receipt')).toHaveTextContent('silent-corruption');
    expect(screen.getByLabelText('Received bytes in hexadecimal')).toHaveTextContent('01');
    expect(screen.getByText('Received text is valid UTF-8, but the bytes are not exact.')).toBeVisible();
  });

  it('keeps captured bytes and settings immutable across changed controls, edit, language, theme, and reopen', () => {
    renderJourneyLab(JourneyControls, definition, { lang: 'en', example: 'A', sceneId: 'scene-11' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Configured flip probability p' }), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run transmission' }));
    expect(screen.getByLabelText('Captured source bytes')).toHaveTextContent('41');
    expect(screen.getByText('Captured settings: raw, budget 4096, p=0.00, seed 20260905.')).toBeVisible();

    fireEvent.change(screen.getByRole('combobox', { name: 'Channel code' }), { target: { value: 'repeat3' } });
    expect(screen.getByRole('status')).toHaveTextContent('Receipt for the previous settings');
    expect(screen.getByText('Captured settings: raw, budget 4096, p=0.00, seed 20260905.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit committed message' }));
    expect(screen.getByRole('status')).toHaveTextContent('Receipt for the previous message');
    expect(screen.getByLabelText('Captured source bytes')).toHaveTextContent('41');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Vietnamese' }));
    expect(screen.getByRole('status')).toHaveTextContent('Biên nhận của câu trước');
    expect(screen.getByLabelText('Byte nguồn đã chụp')).toHaveTextContent('41');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
    expect(screen.getByLabelText('active theme')).toHaveTextContent('dark');
    expect(screen.getByLabelText('Byte nguồn đã chụp')).toHaveTextContent('41');
    fireEvent.click(screen.getByRole('button', { name: 'Close lab' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen lab' }));
    expect(screen.getByRole('combobox', { name: 'Mã kênh' })).toHaveValue('repeat3');
    expect(screen.getByLabelText('Byte nguồn đã chụp')).toHaveTextContent('41');
  });

  it('shows a complete budget breakdown and an independently labeled asymptotic theory panel', () => {
    renderJourneyLab(ChannelBudgetLab, definition, { lang: 'en', example: 'A', sceneId: 'scene-11' });
    const budget = screen.getByRole('table', { name: 'Current whole-message budget' });
    expect(within(budget).getByRole('row', { name: /Payload bits 8/ })).toBeVisible();
    expect(within(budget).getByRole('row', { name: /Required channel uses 8/ })).toBeVisible();
    expect(within(budget).getByRole('row', { name: /Maximum payload capacity 4096/ })).toBeVisible();
    expect(within(budget).getByRole('row', { name: /Unused channel uses 4088/ })).toBeVisible();
    const theory = screen.getByRole('region', { name: 'Asymptotic BSC capacity' });
    expect(theory).toHaveTextContent('C = 1 − Hb(p)');
    expect(theory).toHaveTextContent('not a finite-run guarantee');
    expect(theory).toHaveTextContent('short raw, repetition, or SECDED code');
  });

  it('reset clears the receipt and scene state without changing the committed message', () => {
    renderJourneyLab(JourneyControls, definition, { lang: 'en', example: 'A', sceneId: 'scene-11' });
    fireEvent.click(screen.getByRole('button', { name: 'Run transmission' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Channel code' }), { target: { value: 'repeat3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByLabelText('session message')).toHaveTextContent('A');
    expect(screen.getByLabelText('session receipt')).toHaveTextContent('none');
    expect(screen.getByRole('combobox', { name: 'Channel code' })).toHaveValue('raw');
    expect(screen.queryByLabelText('Captured source bytes')).not.toBeInTheDocument();
  });
});

describe('channel comparisons', () => {
  afterEach(() => vi.useRealTimers());

  const setup = (example = 'A') => renderJourneyLab(JourneyControls, definition, { lang: 'en', example, sceneId: 'scene-11' });
  const compare = () => fireEvent.click(screen.getByRole('button', { name: 'Compare 200 trials' }));
  const finish = async () => { await act(async () => { await vi.runAllTimersAsync(); }); };

  it('starts only on Compare, reports chunk progress, and cancel preserves the single receipt', async () => {
    vi.useFakeTimers();
    setup();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Configured flip probability p' }), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run transmission' }));
    const receipt = screen.getByRole('region', { name: 'Captured transmission receipt' }).textContent;
    fireEvent.scroll(window);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
    await finish();
    expect(screen.queryByRole('status', { name: 'Comparison progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Completed 200-trial comparison' })).not.toBeInTheDocument();
    compare();
    expect(screen.getByRole('status', { name: 'Comparison progress' })).toHaveTextContent('5 / 600');
    expect(screen.getByRole('button', { name: 'Compare 200 trials' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel comparison' }));
    await finish();
    expect(screen.getByRole('status', { name: 'Comparison progress' })).toHaveTextContent('Incomplete');
    expect(screen.getByRole('status', { name: 'Comparison progress' })).toHaveTextContent('5 / 600');
    expect(screen.getByRole('region', { name: 'Captured transmission receipt' }).textContent).toBe(receipt);
    expect(screen.queryByRole('table', { name: 'Completed 200-trial comparison' })).not.toBeInTheDocument();
  });

  it('saves completed scene-owned results with captured settings, marks staleness, and preserves them on reopen', async () => {
    vi.useFakeTimers();
    setup();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Configured flip probability p' }), { target: { value: '0' } });
    compare();
    await finish();
    const table = screen.getByRole('table', { name: 'Completed 200-trial comparison' });
    expect(within(table).getByRole('row', { name: /Raw 200 0 0 0 \/ 1600/ })).toBeVisible();
    expect(screen.getByLabelText('session receipt')).toHaveTextContent('none');
    expect(screen.getByText('Captured comparison: revision 0, budget 4096, p=0.00, seed 20260905.')).toBeVisible();
    const captured = JSON.parse(screen.getByLabelText('stored scene state').textContent!).batch;
    expect(captured.messageRevision).toBe(0);
    expect(captured.source).toEqual([65]);
    expect(captured.config).toEqual({ p: 0, seed: 20260905, budget: 4096 });
    expect(captured.result.rows).toHaveLength(3);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Configured flip probability p' }), { target: { value: '0.1' } });
    expect(screen.getByText('Comparison for the previous settings')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit committed message' }));
    expect(screen.getByText('Comparison for the previous message')).toBeVisible();
    compare();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel comparison' }));
    await finish();
    expect(JSON.parse(screen.getByLabelText('stored scene state').textContent!).batch).toEqual(captured);
    fireEvent.click(screen.getByRole('button', { name: 'Close lab' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen lab' }));
    expect(screen.getByRole('table', { name: 'Completed 200-trial comparison' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Vietnamese' }));
    expect(screen.getByRole('table', { name: 'So sánh 200 lượt đã hoàn tất' })).toBeVisible();
    expect(screen.getByText('So sánh của câu trước')).toBeVisible();
  });

  it.each(['draft', 'revision', 'config', 'reset', 'session-reset', 'back', 'unmount'] as const)(
    'invalidates a yielding run on %s and never publishes late progress or completion', async (action) => {
      vi.useFakeTimers();
      const view = setup();
      compare();
      if (action === 'draft') fireEvent.change(screen.getByRole('textbox'), { target: { value: 'draft' } });
      if (action === 'revision') fireEvent.click(screen.getByRole('button', { name: 'Edit committed message' }));
      if (action === 'config') fireEvent.change(screen.getByRole('spinbutton', { name: 'Noise seed' }), { target: { value: '1' } });
      if (action === 'reset') fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      if (action === 'session-reset') fireEvent.click(screen.getByRole('button', { name: 'Reset session directly' }));
      if (action === 'back') fireEvent.click(screen.getByRole('button', { name: 'Back to illustration' }));
      if (action === 'unmount') view.unmount();
      await finish();
      if (action === 'back') fireEvent.click(screen.getByRole('button', { name: 'Reopen lab' }));
      expect(screen.queryByRole('table', { name: 'Completed 200-trial comparison' })).not.toBeInTheDocument();
      if (action !== 'unmount') {
        expect(screen.getByLabelText('stored scene state')).not.toHaveTextContent('"rows"');
        const progress = screen.queryByRole('status', { name: 'Comparison progress' });
        if (progress) expect(progress).toHaveTextContent('Incomplete: 5 / 600');
      }
    },
  );

  it('does not let an older cancelled promise overwrite a new comparison', async () => {
    vi.useFakeTimers();
    setup();
    compare();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Noise seed' }), { target: { value: '123' } });
    compare();
    await finish();
    expect(screen.getByText('Captured comparison: revision 0, budget 4096, p=0.05, seed 123.')).toBeVisible();
    expect(JSON.parse(screen.getByLabelText('stored scene state').textContent!).batch.config.seed).toBe(123);
  });

  it('shows budget-excluded codes and does not describe an empty comparison as 600 completed trials', async () => {
    vi.useFakeTimers();
    setup('A'.repeat(65));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Transmission budget in channel uses' }), { target: { value: '512' } });
    compare();
    await finish();
    expect(screen.getByText(/Excluded by budget: Raw, Repeat three times, SECDED/)).toBeVisible();
    expect(screen.getByText('No code fits the whole message within this budget.')).toBeVisible();
    expect(screen.queryByText(/600 \/ 600/)).not.toBeInTheDocument();
  });

  it.each(['Reset', 'Reset session directly'])('clears a completed batch and its completion announcement on %s', async (reset) => {
    vi.useFakeTimers();
    setup();
    compare();
    await finish();
    expect(screen.getByRole('table', { name: 'Completed 200-trial comparison' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: reset }));
    expect(screen.queryByRole('table', { name: 'Completed 200-trial comparison' })).not.toBeInTheDocument();
    expect(screen.queryByText('Comparison complete.')).not.toBeInTheDocument();
  });

  it('keeps completed comparisons separate from an existing receipt and labels undefined BER when all outputs are rejected', async () => {
    vi.useFakeTimers();
    setup('A'.repeat(65));
    fireEvent.click(screen.getByRole('button', { name: 'Run transmission' }));
    const receipt = screen.getByRole('region', { name: 'Captured transmission receipt' }).textContent;
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Configured flip probability p' }), { target: { value: '0.5' } });
    compare();
    await finish();
    expect(screen.getByRole('region', { name: 'Captured transmission receipt' }).textContent).toBe(receipt);
    const table = screen.getByRole('table', { name: 'Completed 200-trial comparison' });
    expect(within(table).getByRole('row', { name: /SECDED \(4,8\) 0 200 0 No decoded payload; BER is undefined/ })).toBeVisible();
  });

  it('yields real timers for typing, cancel, and navigation at the valid 1024-byte maximum', async () => {
    const maximum = 'é' + '\u0301'.repeat(511);
    setup(maximum);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Transmission budget in channel uses' }), { target: { value: '32768' } });
    compare();
    await act(async () => { await new Promise<void>((resolve) => setTimeout(() => {
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typing' } });
      resolve();
    }, 0)); });
    expect(screen.getByRole('textbox')).toHaveValue('typing');
    await waitFor(() => expect(screen.getByRole('status', { name: 'Comparison progress' })).toHaveTextContent('Incomplete'));
    compare();
    await act(async () => { await new Promise<void>((resolve) => setTimeout(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel comparison' }));
      resolve();
    }, 0)); });
    expect(screen.getByRole('status', { name: 'Comparison progress' })).toHaveTextContent('Incomplete');
    compare();
    await act(async () => { await new Promise<void>((resolve) => setTimeout(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to illustration' }));
      resolve();
    }, 0)); });
    expect(screen.getByRole('button', { name: 'Reopen lab' })).toBeVisible();
    expect(screen.getByLabelText('stored scene state')).not.toHaveTextContent('"rows"');
  });
});
