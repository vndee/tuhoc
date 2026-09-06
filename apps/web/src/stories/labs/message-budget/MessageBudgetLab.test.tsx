import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLanguage } from '../../../i18n/LanguageProvider';
import type { LabRuntimeProps } from '../runtime';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import MessageBudgetLab from './MessageBudgetLab';

const definition = {
  kind: 'message-budget',
  title: { vi: 'Giữ lời, bớt chữ', en: 'Keep the meaning, shorten the message' },
  instruction: {
    vi: 'Viết một câu, rồi thử rút gọn.',
    en: 'Write a message, then shorten it to fit the character budget.',
  },
  config: { defaultBudget: 30 },
} as LabRuntimeProps['definition'];

function LanguageSwitchingLab(props: LabRuntimeProps) {
  const { setLang } = useLanguage();
  return <>
    <button type="button" onClick={() => setLang('en')}>English</button>
    <MessageBudgetLab {...props} />
  </>;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('MessageBudgetLab', () => {
  it.each(['en', 'vi'] as const)('rejects an oversized shortened draft without rendering it in %s', (lang) => {
    renderJourneyLab(MessageBudgetLab, definition, { lang, example: 'Original' });
    const editor = screen.getByRole('textbox', { name: lang === 'en' ? 'Shortened draft' : 'Bản rút lời' });
    fireEvent.change(editor, { target: { value: 'x'.repeat(4097) } });
    expect(editor).toHaveValue('Original');
    expect(screen.getByRole('alert')).toHaveTextContent(lang === 'en' ? 'previous draft is unchanged' : 'Bản nháp trước đó vẫn được giữ nguyên');
    expect(document.querySelectorAll('[data-edit]').length).toBeLessThan(100);
    fireEvent.change(editor, { target: { value: 'Short' } });
    expect(editor).toHaveValue('Short');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blocks an oversized paste into the shortened draft before insertion', () => {
    renderJourneyLab(MessageBudgetLab, definition, { lang: 'en', example: 'Original' });
    const editor = screen.getByRole('textbox', { name: 'Shortened draft' });
    expect(fireEvent.paste(editor, { clipboardData: { getData: () => 'x'.repeat(4097) } })).toBe(false);
    expect(editor).toHaveValue('Original');
    expect(screen.getByRole('alert')).toBeVisible();
  });

  it.each(['en', 'vi'] as const)('offers a reflective Predict stage without requiring an answer in %s', (lang) => {
    renderJourneyLab(MessageBudgetLab, definition, { lang, sceneId: 'scene-01' });
    const prediction = screen.getByRole('region', { name: lang === 'en' ? 'Predict' : 'Dự đoán' });
    expect(prediction.textContent!.length).toBeGreaterThan(30);
    expect(prediction.querySelector('input, button, select, textarea')).toBeNull();
    expect(screen.getByRole('region', { name: lang === 'en' ? 'Try' : 'Thử' })).toBeVisible();
  });
  it('keeps the shortened draft independent and reset preserves a newly committed original', () => {
    renderJourneyLab(MessageBudgetLab, definition, { lang: 'en', example: 'Original' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Your message' }), {
      target: { value: 'New original\nline' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use this message' }));

    const shortened = screen.getByRole('textbox', { name: 'Shortened draft' });
    const pasted = `short\n${'x'.repeat(61)}`;
    fireEvent.change(shortened, { target: { value: pasted } });
    expect(shortened).toHaveValue(pasted);
    expect(screen.getByRole('status')).toHaveTextContent('exceeds the budget by 37 grapheme clusters');
    expect(screen.getByLabelText('Original text').querySelector('pre')?.textContent).toBe('New original\nline');
    expect(screen.getByLabelText('Shortened text').querySelector('pre')?.textContent).toBe(pasted);

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByLabelText('Original text').querySelector('pre')?.textContent).toBe('New original\nline');
    expect(screen.getByRole('textbox', { name: 'Shortened draft' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Grapheme budget' })).toHaveValue('30');
  });

  it('keeps the original bytes unchanged when the interface switches from VI to EN', () => {
    renderJourneyLab(LanguageSwitchingLab, definition, { lang: 'vi', example: 'ắ' });

    const originalBefore = screen.getByLabelText('Văn bản gốc');
    expect(within(originalBefore).getByText('1 cụm ký tự · 3 byte UTF-8')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    const originalAfter = screen.getByLabelText('Original text');
    expect(originalAfter).toHaveTextContent('ắ');
    expect(within(originalAfter).getByText('1 grapheme cluster · 3 UTF-8 bytes')).toBeVisible();
  });

  it('renders both drafts literally and keeps one family emoji as one diff grapheme', () => {
    renderJourneyLab(MessageBudgetLab, definition, { lang: 'en', example: 'Safe' });
    const literal = '<img onerror=alert(1)>👨‍👩‍👧‍👦';
    fireEvent.change(screen.getByRole('textbox', { name: 'Shortened draft' }), { target: { value: literal } });

    const shortened = screen.getByLabelText('Shortened text');
    expect(shortened).toHaveTextContent(literal);
    expect(document.querySelector('img')).toBeNull();
    const changed = [...shortened.querySelectorAll('[data-edit="changed"]')];
    expect(changed.filter((node) => node.textContent === '👨‍👩‍👧‍👦')).toHaveLength(1);
  });

  it('allows an empty shortened draft without reporting an input error or a meaning score', () => {
    renderJourneyLab(MessageBudgetLab, definition, { lang: 'en', example: 'Original' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Shortened draft' }), { target: { value: '' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('It fits the budget. Did anything important disappear?');
    expect(screen.queryByText(/meaning score|compression succeeded/i)).not.toBeInTheDocument();
  });

  it('retains an ill-formed shortened draft while deferring feedback during IME composition', () => {
    renderJourneyLab(MessageBudgetLab, definition, { lang: 'en', example: 'Original' });
    const shortened = screen.getByRole('textbox', { name: 'Shortened draft' });

    fireEvent.compositionStart(shortened);
    fireEvent.change(shortened, { target: { value: 'draft\ud800' } });
    expect(shortened).toHaveValue('draft\ud800');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.compositionEnd(shortened);
    expect(shortened).toHaveValue('draft\ud800');
    expect(screen.getByRole('alert')).toHaveTextContent('The shortened draft contains invalid Unicode.');
  });
});
