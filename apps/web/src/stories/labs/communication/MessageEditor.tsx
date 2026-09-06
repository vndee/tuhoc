import { useEffect, useId, useRef, useState } from 'react';
import type { Lang } from '../../../i18n';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { MAX_DRAFT_CODE_UNITS } from '../../session/model';
import { inspectMessage } from './unicode';
import { communicationCopy } from './copy';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const encoder = new TextEncoder();

function counts(text: string) {
  return {
    graphemes: Array.from(segmenter.segment(text)).length,
    bytes: encoder.encode(text).length,
  };
}

export function MessageEditor({ lang }: { lang: Lang }) {
  const { state, dispatch, examples } = useRequiredMessageJourney();
  const copy = communicationCopy[lang];
  const [composing, setComposing] = useState(false);
  const [rejectedEdit, setRejectedEdit] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const resetButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const restoreResetFocus = useRef(false);
  const editorId = useId();
  const privacyId = useId();
  const metricsId = useId();
  const validation = inspectMessage(state.draftText);
  const metrics = counts(state.draftText);

  useEffect(() => {
    if (!confirmingReset) {
      if (restoreResetFocus.current) {
        restoreResetFocus.current = false;
        resetButton.current?.focus();
      }
      return;
    }
    const dialog = resetDialog.current;
    if (!dialog) return;

    dialog.showModal();
    cancelButton.current?.focus();

    const suppressOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) cancelButton.current?.focus();
    };
    document.addEventListener('click', suppressOutsideClick, true);
    document.addEventListener('focusin', containFocus, true);

    return () => {
      document.removeEventListener('click', suppressOutsideClick, true);
      document.removeEventListener('focusin', containFocus, true);
      if (dialog.open) dialog.close();
    };
  }, [confirmingReset]);

  const cancelReset = () => {
    if (resetDialog.current?.open) resetDialog.current.close();
    restoreResetFocus.current = true;
    setConfirmingReset(false);
  };
  const keepFocusInDialog = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelReset();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = resetDialog.current;
    if (!dialog) return;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  const useExample = () => {
    setRejectedEdit(false);
    const example = examples[lang];
    dispatch({ type: 'draft', text: example });
    dispatch({ type: 'commit', text: example });
  };
  const commit = () => {
    if (validation.ok) dispatch({ type: 'commit', text: state.draftText });
  };
  const error = composing ? null : rejectedEdit ? copy.draftTooLong
    : !validation.ok ? copy.errors[validation.error as keyof typeof copy.errors] : null;

  return <section className="communication-message-editor" aria-labelledby={editorId}>
    <h4 id={editorId}>{copy.messageLabel}</h4>
    <label htmlFor={`${editorId}-input`}>{copy.messageLabel}</label>
    <textarea
      id={`${editorId}-input`}
      value={state.draftText}
      aria-describedby={`${metricsId} ${privacyId}${error === null ? '' : ` ${editorId}-error`}`}
      aria-invalid={error === null ? undefined : true}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
      onPaste={(event) => {
        const input = event.currentTarget;
        const nextLength = input.value.length - (input.selectionEnd - input.selectionStart)
          + event.clipboardData.getData('text/plain').length;
        if (nextLength > MAX_DRAFT_CODE_UNITS) {
          event.preventDefault();
          setRejectedEdit(true);
        }
      }}
      onChange={(event) => {
        const text = event.currentTarget.value;
        const rejected = text.length > MAX_DRAFT_CODE_UNITS;
        setRejectedEdit(rejected);
        if (!rejected) dispatch({ type: 'draft', text });
      }}
    />
    <div id={metricsId} className="communication-message-counts">
      <span>{copy.graphemeCount(metrics.graphemes)}</span>
      <span>{copy.byteCount(metrics.bytes)}</span>
    </div>
    {error === null ? null : <p id={`${editorId}-error`} role="alert">{error}</p>}
    <p id={privacyId}>{copy.privacy}</p>
    <div className="communication-message-actions">
      <button type="button" onClick={commit} disabled={!validation.ok || composing || rejectedEdit}>{copy.commitMessage}</button>
      <button type="button" onClick={useExample}>{copy.useExample}</button>
    </div>
    <div className="communication-message-comparison">
      <section aria-label={copy.messageInUse}>
        <h5>{copy.messageInUse}</h5>
        <pre>{state.messageText}</pre>
      </section>
      <section aria-label={copy.draftPreview}>
        <h5>{copy.draftPreview}</h5>
        <pre>{state.draftText}</pre>
      </section>
    </div>
    <button ref={resetButton} type="button" onClick={() => setConfirmingReset(true)}>{copy.resetSession}</button>
    {confirmingReset ? <dialog
      ref={resetDialog}
      aria-modal="true"
      aria-labelledby={`${editorId}-reset-title`}
      aria-describedby={`${editorId}-reset-description`}
      onCancel={(event) => { event.preventDefault(); cancelReset(); }}
      onKeyDown={keepFocusInDialog}
    >
      <h4 id={`${editorId}-reset-title`}>{copy.resetTitle}</h4>
      <p id={`${editorId}-reset-description`}>{copy.resetDescription}</p>
      <button ref={cancelButton} type="button" onClick={cancelReset}>{copy.cancel}</button>
      <button type="button" onClick={() => {
        setRejectedEdit(false);
        dispatch({ type: 'reset-session', example: examples[lang] });
        if (resetDialog.current?.open) resetDialog.current.close();
        restoreResetFocus.current = true;
        setConfirmingReset(false);
      }}>{copy.confirmReset}</button>
    </dialog> : null}
  </section>;
}
