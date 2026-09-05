import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('MessageEditor', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Start a new experiment' }));
    expect(screen.getByLabelText('Message in use')).toHaveTextContent('Changed');
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message in use')).toHaveTextContent('Original');
    expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveValue('Original');
  });
});
