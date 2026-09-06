import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import type { LabRuntimeProps } from '../runtime';
import SecdedInspectorLab from './SecdedInspectorLab';

const definition = {
  kind: 'secded-inspector',
  title: { vi: 'Tìm vị trí cần sửa', en: 'Locating the Bit to Repair' },
  instruction: {
    vi: 'Tạo một khối bốn bit rồi đọc các phép kiểm tra.',
    en: 'Create a four-bit block and read the parity checks.',
  },
  config: { data: '1011' },
} as unknown as LabRuntimeProps['definition'];

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('SecdedInspectorLab', () => {
  it('reports a four-flip advanced rejection without inferring exactly two physical errors', async () => {
    const user = userEvent.setup();
    renderJourneyLab(SecdedInspectorLab, definition, { lang: 'en', sceneId: 'scene-10' });
    for (const index of [1, 3, 4]) await user.click(screen.getByRole('button', { name: `Data bit ${index}, value 1` }));
    await user.click(screen.getByRole('checkbox', { name: 'Advanced: allow three or more flips' }));
    for (const position of [1, 2, 3, 4]) await user.click(screen.getByRole('button', { name: new RegExp(`Position ${position}, .*not flipped`) }));
    expect(screen.getByText('Received word: 11110000')).toBeVisible();
    expect(screen.getByText('Syndrome: 4 = 4.')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(/uncorrectable error pattern/i);
    expect(screen.getByRole('status')).not.toHaveTextContent(/two errors/i);
    expect(screen.getByText('Ground-truth comparison: no recovered data to compare.')).toBeVisible();
  });
  it.each([
    { lang: 'en' as const, stages: ['Predict', 'Try', 'Observe', 'Explain and limits'], prompt: /which parity check pattern will locate a flipped bit/i, data: /Data bit [1-4], value [01]/, encoded: 'Encoded word: 01100110' },
    { lang: 'vi' as const, stages: ['Dự đoán', 'Thử', 'Quan sát', 'Giải thích và giới hạn'], prompt: /mẫu kiểm tra chẵn lẻ nào sẽ chỉ ra bit bị lật/i, data: /Bit dữ liệu [1-4], giá trị [01]/, encoded: 'Từ mã hóa: 01100110' },
  ])('shows a localized, non-gating Predict → Try → Observe → Explain flow in $lang', ({ lang, stages, prompt, data, encoded }) => {
    renderJourneyLab(SecdedInspectorLab, definition, { lang, sceneId: 'scene-10' });

    for (const stage of stages) expect(screen.getByRole('heading', { level: 4, name: stage })).toBeVisible();
    const prediction = screen.getByRole('region', { name: stages[0] });
    expect(within(prediction).getByText(prompt)).toBeVisible();
    expect(prediction.querySelector('input, button, select, textarea')).toBeNull();
    expect(screen.getAllByRole('button', { name: data })).toHaveLength(4);
    expect(screen.getByText(encoded)).toBeVisible();
  });

  it('supports keyboard toggles and rejects two errors with separate decoder and ground-truth evidence', async () => {
    const user = userEvent.setup();
    renderJourneyLab(SecdedInspectorLab, definition, { lang: 'en', sceneId: 'scene-10' });

    const first = screen.getByRole('button', { name: 'Position 1, parity p1, value 0, not flipped' });
    first.focus();
    await user.keyboard('{Enter}');
    const second = screen.getByRole('button', { name: 'Position 2, parity p2, value 1, not flipped' });
    second.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('status')).toHaveTextContent('Two errors detected; this block is not accepted.');
    expect(screen.getByText('Decoder decision: Rejected')).toBeVisible();
    expect(screen.getByText('Ground-truth comparison: no recovered data to compare.')).toBeVisible();
    expect(screen.getByText('Syndrome: 3 = 1 + 2.')).toBeVisible();
    expect(within(screen.getByRole('status')).getByText('!')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows check groups and the complete decision table as text, not color alone', () => {
    renderJourneyLab(SecdedInspectorLab, definition, { lang: 'en', sceneId: 'scene-10' });

    expect(screen.getByText(/UI positions are one-based; simulator API indices are zero-based/i)).toBeVisible();
    const checks = screen.getByRole('table', { name: 'Parity checks on received positions 1 through 7' });
    expect(within(checks).getByRole('row', { name: /Check 1.*positions 1, 3, 5, 7.*0 ⊕ 1 ⊕ 0 ⊕ 1 = 0.*passes/i })).toBeVisible();
    expect(within(checks).getByRole('row', { name: /Check 2.*positions 2, 3, 6, 7.*1 ⊕ 1 ⊕ 1 ⊕ 1 = 0.*passes/i })).toBeVisible();
    expect(within(checks).getByRole('row', { name: /Check 4.*positions 4, 5, 6, 7.*0 ⊕ 0 ⊕ 1 ⊕ 1 = 0.*passes/i })).toBeVisible();
    expect(screen.getByText('Overall parity across positions 1–8: 0.')).toBeVisible();
    const decisions = screen.getByRole('table', { name: 'SECDED decision table' });
    expect(within(decisions).getByRole('row', { name: /0 0 No error signaled Current decoder state/i })).toBeVisible();
    expect(within(decisions).getByRole('row', { name: /nonzero 0 Reject.*uncorrectable/i })).toBeVisible();
    expect(document.body.textContent).not.toContain('Definitely error-free');
    expect(document.querySelectorAll('[data-bit-cell]').length).toBeLessThanOrEqual(64);
  });

  it('keeps the advanced warning visible and exposes three- and four-error counterexamples', async () => {
    const user = userEvent.setup();
    renderJourneyLab(SecdedInspectorLab, definition, { lang: 'en', sceneId: 'scene-10' });
    for (const index of [1, 3, 4]) await user.click(screen.getByRole('button', { name: `Data bit ${index}, value 1` }));
    expect(screen.getByText('Data word: 0000')).toBeVisible();

    await user.click(screen.getByRole('checkbox', { name: 'Advanced: allow three or more flips' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/outside the guarantee.*may miscorrect or miss errors/i);
    for (const position of [1, 2, 3]) {
      await user.click(screen.getByRole('button', { name: new RegExp(`Position ${position}, .*not flipped`) }));
    }
    expect(screen.getByText('Decoder decision: Corrected position 8')).toBeVisible();
    expect(screen.getByText('Ground-truth comparison: accepted data is wrong.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Position 8, overall parity p0, value 0, not flipped/ }));
    expect(screen.getByText('Decoder decision: No error signaled')).toBeVisible();
    expect(screen.getByText('Ground-truth comparison: accepted data is wrong.')).toBeVisible();
    expect(screen.getByRole('alert')).toBeVisible();

    await user.click(screen.getByRole('checkbox', { name: 'Advanced: allow three or more flips' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /, flipped$/ })).toHaveLength(2);
  });

  it('caps normal mode at two selected errors while allowing selected bits to be cleared', async () => {
    const user = userEvent.setup();
    renderJourneyLab(SecdedInspectorLab, definition, { lang: 'en', sceneId: 'scene-10' });
    await user.click(screen.getByRole('button', { name: /Position 1, .*not flipped/ }));
    await user.click(screen.getByRole('button', { name: /Position 2, .*not flipped/ }));

    expect(screen.getByRole('button', { name: /Position 3, .*not flipped/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Position 1, .*flipped/ }));
    expect(screen.getByRole('button', { name: /Position 3, .*not flipped/ })).toBeEnabled();
  });
});
