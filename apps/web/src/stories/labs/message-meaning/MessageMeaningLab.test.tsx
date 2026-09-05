import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLanguage } from '../../../i18n/LanguageProvider';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import type { DeliveryReceipt } from '../communication/types';
import type { LabRuntimeProps } from '../runtime';
import MessageMeaningLab from './MessageMeaningLab';

const definition = {
  kind: 'message-meaning',
  title: { vi: 'Điều câu nói có nghĩa', en: 'What the Message Means' },
  instruction: {
    vi: 'Tách bằng chứng truyền khỏi cách một người đọc câu nói.',
    en: 'Separate delivery evidence from how a person reads the sentence.',
  },
  config: {
    contexts: [
      { id: 'meeting', label: { vi: 'Trước một cuộc gặp', en: 'Before a meeting' } },
      { id: 'disagreement', label: { vi: 'Sau một bất đồng', en: 'After a disagreement' } },
      { id: 'missing-previous', label: { vi: 'Khi thiếu tin nhắn trước', en: 'With the previous message missing' } },
    ],
  },
} as unknown as LabRuntimeProps['definition'];

const exactReceipt: DeliveryReceipt = {
  messageText: 'A', messageRevision: 0, source: [65], received: [65],
  config: { code: 'raw', p: 0, seed: 1, budget: 512 }, required: 8,
  outcome: 'exact', flippedBits: 0, payloadErrors: 0,
};

const rejectedReceipt: DeliveryReceipt = {
  ...exactReceipt, received: null, config: { code: 'secded', p: 0.1, seed: 6, budget: 1024 },
  required: 16, outcome: 'rejected', flippedBits: 2, payloadErrors: null,
};

function JourneyControls(props: LabRuntimeProps) {
  const journey = useRequiredMessageJourney();
  const { setLang } = useLanguage();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  return <>
    <button type="button" onClick={() => journey.dispatch({ type: 'receipt', receipt: exactReceipt })}>Install exact receipt</button>
    <button type="button" onClick={() => journey.dispatch({ type: 'receipt', receipt: rejectedReceipt })}>Install rejected receipt</button>
    <button type="button" onClick={() => journey.dispatch({ type: 'commit', text: 'B' })}>Commit another message</button>
    <button type="button" onClick={() => setLang('vi')}>Switch to Vietnamese</button>
    <button type="button" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}>Toggle theme</button>
    <div aria-label="active theme">{theme}</div>
    <div aria-label="session receipt">{JSON.stringify(journey.state.deliveryReceipt)}</div>
    <div aria-label="stored scene state">{JSON.stringify(journey.state.experimentStateByScene['scene-12'] ?? null)}</div>
    <MessageMeaningLab {...props} />
  </>;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('MessageMeaningLab', () => {
  it.each([
    { lang: 'en' as const, stages: ['Predict', 'Try', 'Observe', 'Explain and limits'], prompt: /could the same delivered words be read differently/i },
    { lang: 'vi' as const, stages: ['Dự đoán', 'Thử', 'Quan sát', 'Giải thích và giới hạn'], prompt: /cùng một câu được truyền đến có thể được hiểu khác đi/i },
  ])('opens directly with a localized, non-gating Predict → Try → Observe → Explain flow in $lang', ({ lang, stages, prompt }) => {
    renderJourneyLab(MessageMeaningLab, definition, { lang, example: 'A', sceneId: 'scene-12' });

    for (const stage of stages) expect(screen.getByRole('heading', { level: 4, name: stage })).toBeVisible();
    const prediction = screen.getByRole('region', { name: stages[0] });
    expect(within(prediction).getByText(prompt)).toBeVisible();
    expect(prediction.querySelector('input, button, select, textarea')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(lang === 'en' ? 'No current delivery evidence' : 'Không có bằng chứng giao nhận hiện tại');
    expect(screen.getByRole('link', { name: lang === 'en' ? 'Try a transmission in scene 11' : 'Thử truyền ở cảnh 11' }))
      .toHaveAttribute('href', '#scene-11');
    expect(screen.getByRole('region', { name: lang === 'en' ? 'Illustrative example only' : 'Chỉ là ví dụ minh họa' }))
      .toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps delivery bytes and the receipt independent of contexts, interpretation, language, and theme without requests', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected request'));
    renderJourneyLab(JourneyControls, definition, { lang: 'en', example: 'A', sceneId: 'scene-12' });
    fireEvent.click(screen.getByRole('button', { name: 'Install exact receipt' }));
    const before = screen.getByLabelText('session receipt').textContent;

    const evidence = screen.getByRole('region', { name: 'Current transmission evidence' });
    expect(evidence).toHaveTextContent('Exact delivery');
    expect(evidence).toHaveTextContent('Captured settings: raw, budget 512, p=0.00, seed 1.');
    expect(within(evidence).getByLabelText('Original bytes')).toHaveTextContent('41');
    expect(within(evidence).getByLabelText('Received bytes')).toHaveTextContent('41');
    expect(evidence).toHaveTextContent('Original text: A');
    expect(evidence).toHaveTextContent('Received text: A');

    for (const name of ['After a disagreement', 'With the previous message missing', 'Before a meeting']) {
      fireEvent.click(screen.getByRole('radio', { name }));
      expect(screen.getByRole('status')).toHaveTextContent('Exact delivery');
    }
    for (const name of ['Changed', 'Unchanged', 'Unsure']) fireEvent.click(screen.getByRole('radio', { name }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Vietnamese' }));
    expect(screen.getByRole('status')).toHaveTextContent('Giao nhận chính xác');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
    expect(screen.getByLabelText('active theme')).toHaveTextContent('dark');
    expect(screen.getByLabelText('session receipt').textContent).toBe(before);
    expect(screen.getByLabelText('Byte gốc')).toHaveTextContent('41');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/correct answer|incorrect|score|điểm số/i);
  });

  it('always marks a mismatched revision stale and never presents it as the current delivery', () => {
    renderJourneyLab(JourneyControls, definition, { lang: 'en', example: 'A', sceneId: 'scene-12' });
    fireEvent.click(screen.getByRole('button', { name: 'Install exact receipt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Commit another message' }));

    const evidence = screen.getByRole('region', { name: 'Earlier transmission evidence' });
    expect(screen.getByRole('status')).toHaveTextContent('Receipt for an earlier message revision');
    expect(evidence).toHaveTextContent('Captured settings: raw, budget 512, p=0.00, seed 1.');
    expect(evidence).toHaveTextContent('Original text: A');
    expect(evidence).not.toHaveTextContent('Received text: B');
    expect(screen.getByRole('link', { name: 'Try a transmission in scene 11' })).toHaveAttribute('href', '#scene-11');
  });

  it('shows rejection and its captured configuration without claiming a received sentence', () => {
    renderJourneyLab(JourneyControls, definition, { lang: 'en', example: 'A', sceneId: 'scene-12' });
    fireEvent.click(screen.getByRole('button', { name: 'Install rejected receipt' }));

    const evidence = screen.getByRole('region', { name: 'Current transmission evidence' });
    expect(screen.getByRole('status')).toHaveTextContent('Rejected delivery');
    expect(evidence).toHaveTextContent('Captured settings: secded, budget 1024, p=0.10, seed 6.');
    expect(within(evidence).getByLabelText('Original bytes')).toHaveTextContent('41');
    expect(evidence).toHaveTextContent('No received sentence was accepted.');
    expect(within(evidence).queryByLabelText('Received bytes')).not.toBeInTheDocument();
    expect(evidence).not.toHaveTextContent('Received text:');
  });

  it('opens the editor without changing data and reset clears only scene-12 context and interpretation', () => {
    renderJourneyLab(JourneyControls, definition, { lang: 'en', example: 'A', sceneId: 'scene-12' });
    fireEvent.click(screen.getByRole('button', { name: 'Install exact receipt' }));
    fireEvent.click(screen.getByRole('radio', { name: 'After a disagreement' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Changed' }));
    const before = screen.getByLabelText('session receipt').textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Try another message' }));
    expect(screen.getByRole('textbox')).toHaveValue('A');
    expect(screen.getByLabelText('session receipt').textContent).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByRole('radio', { name: 'Before a meeting' })).toBeChecked();
    expect(screen.getAllByRole('radio', { name: /^(Changed|Unchanged|Unsure)$/ })
      .every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('textbox')).toHaveValue('A');
    expect(screen.getByLabelText('session receipt').textContent).toBe(before);
    expect(screen.getByLabelText('stored scene state')).toHaveTextContent('null');
  });
});
