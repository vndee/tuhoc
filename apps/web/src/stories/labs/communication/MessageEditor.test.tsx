import { fireEvent, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabRuntimeProps } from '../runtime';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import { makeStoryFixture } from '../../testing/storyFixture';
import { MessageEditor } from './MessageEditor';

const definition = makeStoryFixture().scenes[0]!.lab;

function EditorLab({ lang }: LabRuntimeProps) {
  return <MessageEditor lang={lang} />;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

// jsdom has no dialog top layer. This adapter only lets the tests exercise
// component-owned focus cycling and outside-action suppression; Task 23 E2E
// remains responsible for proving the browser's native modal behavior.
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
});

afterAll(() => {
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
});

describe('MessageEditor', () => {
  it.each(['en', 'vi'] as const)('rejects oversized input visibly without replacing the previous draft in %s', (lang) => {
    renderJourneyLab(EditorLab, definition, { lang, example: 'Original' });
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'x'.repeat(4097) } });
    expect(editor).toHaveValue('Original');
    expect(screen.getByRole('alert')).toHaveTextContent(lang === 'en' ? 'previous draft is unchanged' : 'Bản nháp trước đó vẫn được giữ nguyên');
    expect(screen.getByRole('button', { name: lang === 'en' ? 'Use this message' : 'Dùng câu này' })).toBeDisabled();
    fireEvent.change(editor, { target: { value: 'Repaired' } });
    expect(editor).toHaveValue('Repaired');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blocks an oversized paste before insertion but allows replacing the selection within the boundary', () => {
    renderJourneyLab(EditorLab, definition, { lang: 'en', example: 'Original' });
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    editor.setSelectionRange(0, 0);
    expect(fireEvent.paste(editor, { clipboardData: { getData: () => 'x'.repeat(4096) } })).toBe(false);
    expect(editor).toHaveValue('Original');
    editor.setSelectionRange(0, editor.value.length);
    expect(fireEvent.paste(editor, { clipboardData: { getData: () => 'x'.repeat(4096) } })).toBe(true);
  });

  it('preserves and commits the maximum valid Unicode message after IME composition', () => {
    renderJourneyLab(EditorLab, definition, { lang: 'en', example: 'Original' });
    const editor = screen.getByRole('textbox');
    const text = `😀${'\u0301'.repeat(510)}`;
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: text } });
    expect(editor).toHaveValue(text);
    expect(screen.getByRole('button', { name: 'Use this message' })).toBeDisabled();
    fireEvent.compositionEnd(editor);
    fireEvent.click(screen.getByRole('button', { name: 'Use this message' }));
    expect(screen.getByLabelText('Message in use').querySelector('pre')?.textContent).toBe(text);
    expect(screen.getByText('1,024 / 1,024 UTF-8 bytes')).toBeVisible();
  });

  it('keeps an invalid draft entered during IME composition instead of truncating it', () => {
    renderJourneyLab(EditorLab, definition, { lang: 'en', example: 'Original' });
    const editor = screen.getByRole('textbox', { name: 'Your message' });

    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: `draft\ud800` } });
    expect(editor).toHaveValue(`draft\ud800`);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.compositionEnd(editor);
    expect(editor).toHaveValue(`draft\ud800`);
    expect(screen.getByRole('alert')).toHaveTextContent('This message contains invalid Unicode.');
  });

  it('commits markup-shaped input as literal text and shows both counters', () => {
    const literal = '<img onerror=alert(1)>';
    renderJourneyLab(EditorLab, definition, { lang: 'en', example: 'Original' });
    const editor = screen.getByRole('textbox', { name: 'Your message' });

    fireEvent.change(editor, { target: { value: literal } });
    expect(screen.getByText('22 / 120 grapheme clusters')).toBeVisible();
    expect(screen.getByText('22 / 1,024 UTF-8 bytes')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Use this message' }));

    expect(screen.getByLabelText('Message in use')).toHaveTextContent(literal);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('This message is processed only in your browser. Reloading or leaving the edition resets this experiment.')).toBeVisible();
  });

  it('keeps an empty draft available to repair and explains why it cannot be committed', () => {
    renderJourneyLab(EditorLab, definition, { lang: 'en', example: 'Original' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Your message' }), { target: { value: '   ' } });

    expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveValue('   ');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a message or use the example.');
    expect(screen.getByRole('button', { name: 'Use this message' })).toBeDisabled();
    expect(screen.getByLabelText('Message in use')).toHaveTextContent('Original');
  });

  it('cancels a whole-session reset without changing state and restores trigger focus', () => {
    renderJourneyLab(EditorLab, definition, { lang: 'en', example: 'Original' });
    const editor = screen.getByRole('textbox', { name: 'Your message' });
    fireEvent.change(editor, { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this message' }));

    const reset = screen.getByRole('button', { name: 'Start a new experiment' });
    fireEvent.click(reset);
    expect(screen.getByRole('dialog', { name: 'Start a new experiment?' })).toBeVisible();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message in use')).toHaveTextContent('Changed');
    expect(reset).toHaveFocus();
  });

  it('resets the whole journey only after explicit confirmation', () => {
    renderJourneyLab(EditorLab, definition, { lang: 'en', example: 'Original' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Your message' }), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this message' }));

    const reset = screen.getByRole('button', { name: 'Start a new experiment' });
    fireEvent.click(reset);
    expect(screen.getByLabelText('Message in use')).toHaveTextContent('Changed');
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message in use')).toHaveTextContent('Original');
    expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveValue('Original');
    expect(reset).toHaveFocus();
  });

  it('contains keyboard focus within the native modal dialog', () => {
    renderJourneyLab(EditorLab, definition, { lang: 'en', example: 'Original' });
    fireEvent.click(screen.getByRole('button', { name: 'Start a new experiment' }));

    const dialog = screen.getByRole('dialog', { name: 'Start a new experiment?' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Start again' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
  });

  it('suppresses background actions while reset confirmation is modal', () => {
    const backgroundAction = vi.fn();
    function ModalEditorLab({ lang }: LabRuntimeProps) {
      return <><button type="button" onClick={backgroundAction}>Background action</button><MessageEditor lang={lang} /></>;
    }
    renderJourneyLab(ModalEditorLab, definition, { lang: 'en', example: 'Original' });
    const background = screen.getByRole('button', { name: 'Background action' });

    fireEvent.click(screen.getByRole('button', { name: 'Start a new experiment' }));
    fireEvent.click(background);
    expect(backgroundAction).not.toHaveBeenCalled();
    background.focus();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(background);
    expect(backgroundAction).toHaveBeenCalledOnce();
  });
});
