import { useState, type ReactNode } from 'react';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { CommunicationLabFrame } from '../communication/CommunicationLabFrame';
import { MessageEditor } from '../communication/MessageEditor';
import type { LabRuntimeProps } from '../runtime';
import { messageBudgetCopy } from './copy';
import { compareDraft, type DraftComparison, type MessageBudget } from './model';

const budgets: readonly MessageBudget[] = [15, 30, 60];
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export default function MessageBudgetLab({
  definition,
  lang,
  value,
  onChange,
  onReset,
  onBack,
}: LabRuntimeProps) {
  if (definition.kind !== 'message-budget') {
    throw new Error(`MessageBudgetLab expected definition kind "message-budget", received "${definition.kind}".`);
  }

  const { state, dispatch } = useRequiredMessageJourney();
  const copy = messageBudgetCopy[lang];
  const budget = readBudget(value, definition.config.defaultBudget);
  const comparison = compareDraft(state.messageText, state.shortenedDraft, budget);
  const [composing, setComposing] = useState(false);
  const invalidShortened = !composing && !comparison.ok && comparison.error === 'ill-formed';
  const result = composing && !comparison.ok
    ? ''
    : comparison.ok
      ? comparison.value.over === 0 ? copy.fits : copy.over(comparison.value.over)
      : copy.invalidDraft;

  const observation = comparison.ok
    ? <DraftObservation
      original={state.messageText}
      shortened={state.shortenedDraft}
      comparison={comparison.value}
      labels={copy}
    />
    : composing ? null : <p role="alert">{copy.invalidDraft}</p>;

  return <CommunicationLabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    prediction={<p>{copy.prediction}</p>}
    observation={observation}
    explanation={<p>{copy.explanation}</p>}
    result={result}
    onReset={onReset}
    onBack={onBack}
  >
    <MessageEditor lang={lang} />
    <label>{copy.budget}
      <select
        value={budget}
        onChange={(event) => onChange({ budget: Number(event.currentTarget.value) as MessageBudget })}
      >
        {budgets.map((option) => <option key={option} value={option}>{copy.budgetOption(option)}</option>)}
      </select>
    </label>
    <label>{copy.shortenedDraft}
      <textarea
        value={state.shortenedDraft}
        aria-invalid={invalidShortened ? true : undefined}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onChange={(event) => dispatch({ type: 'shorten', text: event.currentTarget.value })}
      />
    </label>
  </CommunicationLabFrame>;
}

function readBudget(value: unknown, fallback: MessageBudget): MessageBudget {
  if (typeof value !== 'object' || value === null) return fallback;
  const candidate = (value as Record<string, unknown>).budget;
  return budgets.includes(candidate as MessageBudget) ? candidate as MessageBudget : fallback;
}

function DraftObservation({
  original,
  shortened,
  comparison,
  labels,
}: {
  original: string;
  shortened: string;
  comparison: DraftComparison;
  labels: typeof messageBudgetCopy.en;
}) {
  const parts = draftParts(original, shortened);
  return <div className="message-budget-comparison">
    <LiteralPane
      label={labels.originalText}
      text={parts.original}
      metrics={labels.metrics(comparison.originalGraphemes, comparison.originalBytes)}
    />
    <LiteralPane
      label={labels.shortenedText}
      text={parts.shortened}
      metrics={labels.metrics(comparison.shortenedGraphemes, comparison.shortenedBytes)}
    />
  </div>;
}

interface DraftPart {
  grapheme: string;
  changed: boolean;
}

function draftParts(original: string, shortened: string): { original: DraftPart[]; shortened: DraftPart[] } {
  const originalGraphemes = Array.from(graphemeSegmenter.segment(original), ({ segment }) => segment);
  const shortenedGraphemes = Array.from(graphemeSegmenter.segment(shortened), ({ segment }) => segment);
  let prefix = 0;
  while (prefix < originalGraphemes.length && prefix < shortenedGraphemes.length && originalGraphemes[prefix] === shortenedGraphemes[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < originalGraphemes.length - prefix &&
    suffix < shortenedGraphemes.length - prefix &&
    originalGraphemes[originalGraphemes.length - 1 - suffix] === shortenedGraphemes[shortenedGraphemes.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const mark = (graphemes: string[]) => graphemes.map((grapheme, index) => ({
    grapheme,
    changed: index >= prefix && index < graphemes.length - suffix,
  }));
  return { original: mark(originalGraphemes), shortened: mark(shortenedGraphemes) };
}

function LiteralPane({ label, text, metrics }: { label: string; text: DraftPart[]; metrics: string }) {
  return <section aria-label={label}>
    <h5>{label}</h5>
    <pre>{text.map((part, index): ReactNode => <span
      key={index}
      className={part.changed ? 'message-budget-changed' : undefined}
      data-edit={part.changed ? 'changed' : 'retained'}
    >{part.grapheme}</span>)}</pre>
    <p>{metrics}</p>
  </section>;
}
