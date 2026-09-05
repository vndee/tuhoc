import { useEffect, useId, useRef, useState } from 'react';
import type { Lang } from '../../../i18n';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
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
  const [confirmingReset, setConfirmingReset] = useState(false);
  const resetButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const editorId = useId();
  const privacyId = useId();
  const metricsId = useId();
  const validation = inspectMessage(state.draftText);
  const metrics = counts(state.draftText);

  useEffect(() => {
    if (confirmingReset) cancelButton.current?.focus();
  }, [confirmingReset]);

  const cancelReset = () => {
    setConfirmingReset(false);
    resetButton.current?.focus();
  };
  const useExample = () => {
    const example = examples[lang];
    dispatch({ type: 'draft', text: example });
    dispatch({ type: 'commit', text: example });
  };
  const commit = () => {
    if (validation.ok) dispatch({ type: 'commit', text: state.draftText });
  };
  const error = !composing && !validation.ok
    ? copy.errors[validation.error as keyof typeof copy.errors]
    : null;

  return <section className="communication-message-editor" aria-labelledby={editorId}>
    <h4 id={editorId}>{copy.messageLabel}</h4>
    <label htmlFor={`${editorId}-input`}>{copy.messageLabel}</label>
    <textarea
      id={`${editorId}-input`}
      value={state.draftText}
      aria-describedby={`${metricsId} ${privacyId}`}
      aria-invalid={error === null ? undefined : true}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
      onChange={(event) => dispatch({ type: 'draft', text: event.currentTarget.value })}
    />
    <div id={metricsId} className="communication-message-counts">
      <span>{copy.graphemeCount(metrics.graphemes)}</span>
      <span>{copy.byteCount(metrics.bytes)}</span>
    </div>
    {error === null ? null : <p role="alert">{error}</p>}
    <p id={privacyId}>{copy.privacy}</p>
    <div className="communication-message-actions">
      <button type="button" onClick={commit} disabled={!validation.ok || composing}>{copy.commitMessage}</button>
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
    {confirmingReset ? <section
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${editorId}-reset-title`}
      aria-describedby={`${editorId}-reset-description`}
      onKeyDown={(event) => { if (event.key === 'Escape') cancelReset(); }}
    >
      <h4 id={`${editorId}-reset-title`}>{copy.resetTitle}</h4>
      <p id={`${editorId}-reset-description`}>{copy.resetDescription}</p>
      <button ref={cancelButton} type="button" onClick={cancelReset}>{copy.cancel}</button>
      <button type="button" onClick={() => {
        dispatch({ type: 'reset-session', example: examples[lang] });
        setConfirmingReset(false);
        resetButton.current?.focus();
      }}>{copy.confirmReset}</button>
    </section> : null}
  </section>;
}
