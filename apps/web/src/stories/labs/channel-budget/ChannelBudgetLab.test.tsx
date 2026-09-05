import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    <button type="button" onClick={() => setOpen((value) => !value)}>{open ? 'Close lab' : 'Reopen lab'}</button>
    <button type="button" onClick={() => setLang('vi')}>Switch to Vietnamese</button>
    <button type="button" onClick={() => setTheme((value) => value === 'light' ? 'dark' : 'light')}>Toggle theme</button>
    <div aria-label="active theme">{theme}</div>
    <div aria-label="session message">{journey.state.messageText}</div>
    <div aria-label="session receipt">{journey.state.deliveryReceipt?.outcome ?? 'none'}</div>
    {open ? <ChannelBudgetLab {...props} /> : null}
  </>;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('ChannelBudgetLab', () => {
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
