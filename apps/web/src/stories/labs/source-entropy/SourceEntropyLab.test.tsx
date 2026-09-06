import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLanguage } from '../../../i18n/LanguageProvider';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import type { LabRuntimeProps } from '../runtime';
import SourceEntropyLab from './SourceEntropyLab';

const definition = {
  kind: 'source-entropy',
  title: { vi: 'Đo một nguồn bất ngờ', en: 'Measuring an Uncertain Source' },
  instruction: {
    vi: 'Thay tần suất bốn ký hiệu rồi quan sát độ bất định.',
    en: 'Change four symbol frequencies and observe source uncertainty.',
  },
  config: { weights: [25, 25, 25, 25], seed: 20260905 },
} as unknown as LabRuntimeProps['definition'];

function JourneyControls(props: LabRuntimeProps) {
  const [open, setOpen] = useState(true);
  const [theme, setTheme] = useState<'paper' | 'night'>('paper');
  const { setLang } = useLanguage();
  return <div data-test-theme={theme}>
    <button type="button" onClick={() => setTheme((value) => value === 'paper' ? 'night' : 'paper')}>Toggle theme</button>
    <button type="button" onClick={() => setLang('vi')}>Tiếng Việt</button>
    {open
      ? <SourceEntropyLab {...props} onBack={() => setOpen(false)} />
      : <button type="button" onClick={() => setOpen(true)}>Reopen entropy lab</button>}
  </div>;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('SourceEntropyLab', () => {
  it.each([
    {
      lang: 'en' as const,
      stages: ['Predict', 'Try', 'Observe', 'Explain and limits'],
      prompt: /prediction is optional and is not scored/i,
      draw: 'Draw symbol',
    },
    {
      lang: 'vi' as const,
      stages: ['Dự đoán', 'Thử', 'Quan sát', 'Giải thích và giới hạn'],
      prompt: /dự đoán là tùy chọn và không được chấm điểm/i,
      draw: 'Rút ký hiệu',
    },
  ])('shows a localized non-gating Predict → Try → Observe → Explain flow in $lang', ({ lang, stages, prompt, draw }) => {
    renderJourneyLab(SourceEntropyLab, definition, { lang, sceneId: 'scene-07' });

    for (const stage of stages) expect(screen.getByRole('heading', { level: 4, name: stage })).toBeVisible();
    expect(screen.getByText(prompt)).toBeVisible();
    expect(screen.getByRole('button', { name: draw })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: draw }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(lang === 'en' ? /Draw 1 produced D/ : /Lượt rút 1 cho ra D/);
    expect(within(status).getByText('◆')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders real normalized probability and contribution bars plus an accessible data table', () => {
    renderJourneyLab(SourceEntropyLab, definition, { lang: 'en', sceneId: 'scene-07' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight for A' }), { target: { value: '100' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight for B' }), { target: { value: '0' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight for C' }), { target: { value: '0' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight for D' }), { target: { value: '0' } });

    expect(screen.getByText('Entropy: 0.000 bits/source-symbol')).toBeVisible();
    expect(screen.getByLabelText('A probability: 100.00%')).toHaveValue(1);
    expect(screen.getByLabelText('A entropy contribution: 0.000 bits/source-symbol')).toHaveValue(0);
    const table = screen.getByRole('table', { name: 'Source probability and entropy contributions' });
    expect(within(table).getByRole('row', { name: /A 100 100.00% 0.000/ })).toBeVisible();
    expect(within(table).getByRole('row', { name: /B 0 0.00% 0.000/ })).toBeVisible();
    expect(screen.getByText(/measures uncertainty in bits per source symbol, not meaning/i)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/-0\.000/);
  });

  it('keeps all-zero weights editable, explains the error, and never advances Draw', () => {
    renderJourneyLab(SourceEntropyLab, definition, { lang: 'en', sceneId: 'scene-07' });
    for (const symbol of ['A', 'B', 'C', 'D']) {
      fireEvent.change(screen.getByRole('spinbutton', { name: `Weight for ${symbol}` }), { target: { value: '0' } });
    }

    expect(screen.getByRole('alert')).toHaveTextContent('At least one symbol must have a weight above zero.');
    expect(screen.getByRole('button', { name: 'Draw symbol' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Weight for A' })).toHaveValue(0);
    expect(screen.getByText('Next draw index: 0')).toBeVisible();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight for C' }), { target: { value: '1' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Draw symbol' }));
    expect(screen.getByRole('status')).toHaveTextContent('Draw 1 produced C');
    expect(screen.getByText('Next draw index: 1')).toBeVisible();
  });

  it('records an optional prediction without gating or scoring the draw', () => {
    renderJourneyLab(SourceEntropyLab, definition, { lang: 'en', sceneId: 'scene-07' });

    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Draw symbol' }));

    expect(screen.getByText('Your optional prediction: A.')).toBeVisible();
    expect(screen.getByText('Prediction recorded for this draw: A.')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Draw 1 produced D');
    expect(document.body.textContent).not.toMatch(/correct|incorrect/i);
    expect(screen.queryByText(/^Score/i)).not.toBeInTheDocument();
  });

  it('retains an immutable draw and marks it stale when valid weights change without advancing the counter', () => {
    renderJourneyLab(SourceEntropyLab, definition, { lang: 'en', sceneId: 'scene-07' });
    fireEvent.click(screen.getByRole('button', { name: 'Draw symbol' }));
    expect(screen.getByText('Draw conditions: A=25, B=25, C=25, D=25 · seed 20260905 · index 0.')).toBeVisible();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight for A' }), { target: { value: '50' } });

    expect(screen.getByText('Last draw: D · surprise 2.000 bits')).toBeVisible();
    expect(screen.getByText('Draw conditions: A=25, B=25, C=25, D=25 · seed 20260905 · index 0.')).toBeVisible();
    expect(screen.getByText('This draw belongs to the previous source settings.')).toBeVisible();
    expect(screen.getByText('Next draw index: 1')).toBeVisible();
    expect(screen.getByText('Entropy: 1.922 bits/source-symbol')).toBeVisible();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Result for previous settings: draw 1 produced D');
    expect(within(status).getByText('↺')).toHaveAttribute('aria-hidden', 'true');
  });

  it('retains a stale draw through all-zero settings and Back/reopen, then replaces it on the next valid Draw', () => {
    renderJourneyLab(JourneyControls, definition, { lang: 'en', sceneId: 'scene-07' });
    fireEvent.click(screen.getByRole('button', { name: 'Draw symbol' }));
    for (const symbol of ['A', 'B', 'C', 'D']) {
      fireEvent.change(screen.getByRole('spinbutton', { name: `Weight for ${symbol}` }), { target: { value: '0' } });
    }

    expect(screen.getByRole('button', { name: 'Draw symbol' })).toBeDisabled();
    expect(screen.getByText('Last draw: D · surprise 2.000 bits')).toBeVisible();
    expect(screen.getByText('This draw belongs to the previous source settings.')).toBeVisible();
    expect(screen.getByText('Next draw index: 1')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to illustration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen entropy lab' }));
    expect(screen.getByText('Last draw: D · surprise 2.000 bits')).toBeVisible();
    expect(screen.getByText('Draw conditions: A=25, B=25, C=25, D=25 · seed 20260905 · index 0.')).toBeVisible();
    expect(screen.getByText('Next draw index: 1')).toBeVisible();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight for C' }), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draw symbol' }));

    expect(screen.getByRole('status')).toHaveTextContent('Draw 2 produced C');
    expect(screen.getByText('Last draw: C · surprise 0.000 bits')).toBeVisible();
    expect(screen.getByText('Draw conditions: A=0, B=0, C=1, D=0 · seed 20260905 · index 1.')).toBeVisible();
    expect(screen.queryByText('This draw belongs to the previous source settings.')).not.toBeInTheDocument();
    expect(screen.getByText('Next draw index: 2')).toBeVisible();
  });

  it('draws only on explicit valid actions and replays the seed/counter sequence', () => {
    renderJourneyLab(SourceEntropyLab, definition, { lang: 'en', sceneId: 'scene-07' });
    expect(screen.getByText('Next draw index: 0')).toBeVisible();
    expect(screen.queryByText(/Last draw:/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight for A' }), { target: { value: '26' } });
    expect(screen.getByText('Next draw index: 0')).toBeVisible();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight for A' }), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draw symbol' }));
    expect(screen.getByText('Last draw: D · surprise 2.000 bits')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Draw symbol' }));
    expect(screen.getByText('Last draw: B · surprise 2.000 bits')).toBeVisible();
    expect(screen.getByText('Next draw index: 2')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByText('Next draw index: 0')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Draw symbol' }));
    expect(screen.getByText('Last draw: D · surprise 2.000 bits')).toBeVisible();
  });

  it('preserves controls, prediction, result and counter across Back/reopen, language, and theme rerenders', () => {
    renderJourneyLab(JourneyControls, definition, { lang: 'en', sceneId: 'scene-07' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Weight for A' }), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('radio', { name: 'D' }));
    fireEvent.click(screen.getByRole('button', { name: 'Draw symbol' }));
    const lastDraw = screen.getByText(/Last draw:/).textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
    expect(screen.getByText(lastDraw ?? '')).toBeVisible();
    expect(screen.getByText('Next draw index: 1')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to illustration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen entropy lab' }));
    expect(screen.getByRole('spinbutton', { name: 'Weight for A' })).toHaveValue(50);
    expect(screen.getByRole('radio', { name: 'D' })).toBeChecked();
    expect(screen.getByText(lastDraw ?? '')).toBeVisible();
    expect(screen.getByText('Next draw index: 1')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Tiếng Việt' }));
    expect(screen.getByRole('spinbutton', { name: 'Trọng số cho A' })).toHaveValue(50);
    expect(screen.getByRole('radio', { name: 'D' })).toBeChecked();
    expect(screen.getByText('Chỉ số lượt rút tiếp theo: 1')).toBeVisible();
    expect(screen.getByText(/Lượt rút gần nhất: D/)).toBeVisible();
  });
});
