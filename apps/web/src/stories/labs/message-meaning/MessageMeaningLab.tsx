import { useState } from 'react';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { CommunicationLabFrame } from '../communication/CommunicationLabFrame';
import { MessageEditor } from '../communication/MessageEditor';
import type { Bytes, DeliveryReceipt } from '../communication/types';
import { decodeUtf8, inspectUnicode } from '../communication/unicode';
import type { LabRuntimeProps } from '../runtime';
import { messageMeaningCopy, type MessageMeaningCopy } from './copy';
import { receiptView, type ReceiptView } from './model';

type ContextId = 'meeting' | 'disagreement' | 'missing-previous';
type Interpretation = 'changed' | 'unchanged' | 'unsure' | null;
type MessageMeaningState = { contextId: ContextId; interpretation: Interpretation };

export default function MessageMeaningLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'message-meaning') {
    throw new Error(`MessageMeaningLab expected definition kind "message-meaning", received "${definition.kind}".`);
  }

  const journey = useRequiredMessageJourney();
  const copy = messageMeaningCopy[lang];
  const state = readState(value);
  const view = receiptView(journey.state.deliveryReceipt, journey.state.messageRevision);
  const [showEditor, setShowEditor] = useState(false);
  const status = statusLabel(view.status, copy);

  return <CommunicationLabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    prediction={<p>{copy.prediction}</p>}
    observation={<>
      <DeliveryEvidence view={view} copy={copy} />
      <p>{state.interpretation === null ? copy.noInterpretation : copy.interpretationNote}</p>
      <StaticExample copy={copy} />
    </>}
    explanation={<div><p>{copy.separation}</p><p>{copy.modelLimit}</p></div>}
    result={<><span aria-hidden="true">{view.status === 'exact' ? '✓' : view.status === 'stale' ? '↺' : '!'}</span>{' '}{status}</>}
    onReset={onReset}
    onBack={onBack}
  >
    <fieldset>
      <legend>{copy.contextLegend}</legend>
      {definition.config.contexts.map((context) => <label key={context.id}><input
        type="radio"
        name="message-meaning-context"
        checked={state.contextId === context.id}
        onChange={() => onChange({ ...state, contextId: context.id })}
      />{context.label[lang]}</label>)}
    </fieldset>
    <fieldset>
      <legend>{copy.interpretationLegend}</legend>
      {(['changed', 'unchanged', 'unsure'] as const).map((interpretation) => <label key={interpretation}><input
        type="radio"
        name="message-meaning-interpretation"
        checked={state.interpretation === interpretation}
        onChange={() => onChange({ ...state, interpretation })}
      />{copy[interpretation]}</label>)}
    </fieldset>
    <button type="button" onClick={() => setShowEditor(true)}>{copy.tryAnotherMessage}</button>
    {showEditor ? <MessageEditor lang={lang} /> : null}
  </CommunicationLabFrame>;
}

function DeliveryEvidence({ view, copy }: { view: ReceiptView; copy: MessageMeaningCopy }) {
  const label = view.status === 'stale' ? copy.earlierEvidence : copy.currentEvidence;
  const status = statusLabel(view.status, copy);
  return <section aria-label={label}>
    <h5>{label}</h5>
    <p>{status}</p>
    {view.receipt === null ? null : <ReceiptDetails receipt={view.receipt} copy={copy} />}
    {view.status === 'not-run' || view.status === 'stale'
      ? <a href="#scene-11">{copy.scene11Link}</a>
      : null}
  </section>;
}

function ReceiptDetails({ receipt, copy }: { receipt: DeliveryReceipt; copy: MessageMeaningCopy }) {
  const original = decodeUtf8(receipt.source);
  const received = receipt.outcome === 'rejected' || receipt.received === null ? null : decodeUtf8(receipt.received);
  return <>
    <p>{copy.capturedSettings(receipt.config)}</p>
    <section aria-label={copy.originalBytes}><h6>{copy.originalBytes}</h6><code>{toHex(receipt.source)}</code></section>
    {original.ok
      ? <p><span>{copy.originalText}</span>{' '}<span data-literal-text style={{ whiteSpace: 'pre-wrap' }}>{original.value}</span></p>
      : <p>{copy.invalidOriginal}</p>}
    {receipt.outcome === 'rejected' || receipt.received === null
      ? <p>{copy.rejectedSentence}</p>
      : <>
        <section aria-label={copy.receivedBytes}><h6>{copy.receivedBytes}</h6><code>{toHex(receipt.received)}</code></section>
        {received?.ok
          ? <p><span>{copy.receivedText}</span>{' '}<span data-literal-text style={{ whiteSpace: 'pre-wrap' }}>{received.value}</span></p>
          : <p>{copy.invalidReceived}</p>}
      </>}
  </>;
}

function StaticExample({ copy }: { copy: MessageMeaningCopy }) {
  const example = inspectUnicode('A');
  if (!example.ok) throw new Error(example.error);
  return <section aria-label={copy.illustrativeExample}>
    <h5>{copy.illustrativeExample}</h5>
    <p>{copy.illustrativeText}</p>
    <p>{copy.illustrativeBytes(toHex(example.value.bytes))}</p>
  </section>;
}

function statusLabel(status: ReceiptView['status'], copy: MessageMeaningCopy): string {
  if (status === 'not-run') return copy.notRun;
  if (status === 'stale') return copy.stale;
  if (status === 'exact') return copy.exact;
  if (status === 'silent-corruption') return copy.silentCorruption;
  return copy.rejected;
}

function readState(value: unknown): MessageMeaningState {
  if (typeof value !== 'object' || value === null) return { contextId: 'meeting', interpretation: null };
  const candidate = value as Partial<MessageMeaningState>;
  return {
    contextId: isContextId(candidate.contextId) ? candidate.contextId : 'meeting',
    interpretation: isInterpretation(candidate.interpretation) ? candidate.interpretation : null,
  };
}

function isContextId(value: unknown): value is ContextId {
  return value === 'meeting' || value === 'disagreement' || value === 'missing-previous';
}

function isInterpretation(value: unknown): value is Interpretation {
  return value === null || value === 'changed' || value === 'unchanged' || value === 'unsure';
}

function toHex(bytes: Bytes): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
