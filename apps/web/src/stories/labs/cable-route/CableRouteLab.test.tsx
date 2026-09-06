import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import type { LabRuntimeProps } from '../runtime';
import CableRouteLab from './CableRouteLab';

const definition = {
  kind: 'cable-route',
  title: { vi: 'Chọn một đường qua biển', en: 'Choosing a Route Across the Sea' },
  instruction: {
    vi: 'So sánh ba tuyến giả lập.',
    en: 'Compare three fictional routes.',
  },
  config: { defaultBudget: 28 },
} as unknown as LabRuntimeProps['definition'];

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('CableRouteLab', () => {
  it('selects South with keyboard controls and reports exact and short budgets', async () => {
    const user = userEvent.setup();
    renderJourneyLab(CableRouteLab, definition, { lang: 'en', sceneId: 'scene-04' });

    const north = screen.getByRole('radio', { name: /North/ });
    await user.click(north);
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('radio', { name: /South/ })).toBeChecked();

    const budget = screen.getByRole('spinbutton', { name: 'Budget' });
    fireEvent.change(budget, { target: { value: '21' } });
    expect(screen.getByRole('status')).toHaveTextContent('exactly enough');

    fireEvent.change(budget, { target: { value: '20' } });
    expect(screen.getByRole('status')).toHaveTextContent('1 simulation unit short');
  });

  it.each([
    {
      lang: 'en' as const,
      stages: ['Predict', 'Try', 'Observe', 'Explain and limits'],
      prompt: /which route do you expect will need the fewest simulation units/,
      step: 'Reveal next component',
      length: 'Length',
      table: 'Route cost components',
      value: 'Value (simulation units)',
      short: '1 simulation unit short',
    },
    {
      lang: 'vi' as const,
      stages: ['Dự đoán', 'Thử', 'Quan sát', 'Giải thích và giới hạn'],
      prompt: /bạn đoán tuyến nào sẽ cần ít đơn vị mô phỏng nhất/,
      step: 'Xem thành phần tiếp theo',
      length: 'Chiều dài',
      table: 'Các thành phần chi phí tuyến',
      value: 'Giá trị (đơn vị mô phỏng)',
      short: 'Thiếu 1 đơn vị mô phỏng',
    },
  ])('shows Predict → Try → Observe → Explain in $lang and does not gate stepping on an answer', async ({
    lang, stages, prompt, step, length, table, value, short,
  }) => {
    const user = userEvent.setup();
    renderJourneyLab(CableRouteLab, definition, { lang, sceneId: 'scene-04' });

    expect(screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual(stages);
    const prediction = screen.getByRole('region', { name: stages[0] });
    expect(within(prediction).getByText(prompt)).toBeVisible();
    expect(prediction.querySelector('input, button, select, textarea')).toBeNull();

    await user.click(screen.getByRole('button', { name: step }));
    const costTable = screen.getByRole('table', { name: table });
    expect(within(costTable).getByRole('rowheader', { name: length })).toBeVisible();
    expect(within(costTable).getByRole('columnheader', { name: value })).toBeVisible();

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '20' } });
    expect(screen.getByRole('status')).toHaveTextContent(short);
  });

  it('reveals length, difficult-segment, and depth components in order', async () => {
    const user = userEvent.setup();
    renderJourneyLab(CableRouteLab, definition, { lang: 'en', sceneId: 'scene-04' });
    const table = screen.getByRole('table', { name: 'Route cost components' });

    expect(within(table).queryByRole('rowheader', { name: 'Length' })).not.toBeInTheDocument();
    expect(table).not.toHaveTextContent('13 + 4 + 4');
    await user.click(screen.getByRole('button', { name: 'Reveal next component' }));
    expect(within(table).getByRole('rowheader', { name: 'Length' })).toBeVisible();
    expect(within(table).queryByRole('rowheader', { name: 'Difficult segments' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reveal next component' }));
    expect(within(table).getByRole('rowheader', { name: 'Difficult segments' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reveal next component' }));
    expect(within(table).getByRole('rowheader', { name: 'Depth' })).toBeVisible();
    expect(within(table).getByRole('rowheader', { name: 'Total' })).toBeVisible();
    expect(table).toHaveTextContent('13 + 4 + 4');
  });

  it('does not alter terrain when only the budget changes', () => {
    renderJourneyLab(CableRouteLab, definition, { lang: 'en', sceneId: 'scene-04' });
    const profile = screen.getByRole('img', { name: 'South fictional route profile' });
    const terrain = profile.innerHTML;

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Budget' }), { target: { value: '15' } });

    expect(screen.getByRole('img', { name: 'South fictional route profile' }).innerHTML).toBe(terrain);
    expect(screen.getByText('C = L + 4H + 2D')).toBeVisible();
    expect(screen.getByText(/not kilometres, days, or real money/i)).toBeVisible();
  });

  it('resets route, budget, and reveal step to the configured initial state', async () => {
    const user = userEvent.setup();
    renderJourneyLab(CableRouteLab, definition, { lang: 'en', sceneId: 'scene-04' });
    await user.click(screen.getByRole('radio', { name: /North/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Budget' }), { target: { value: '17' } });
    await user.click(screen.getByRole('button', { name: 'Reveal next component' }));

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByRole('radio', { name: /South/ })).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: 'Budget' })).toHaveValue(28);
    expect(within(screen.getByRole('table', { name: 'Route cost components' }))
      .queryByRole('rowheader', { name: 'Length' })).not.toBeInTheDocument();
  });
});
