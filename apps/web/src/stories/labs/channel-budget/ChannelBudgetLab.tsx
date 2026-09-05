import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { CommunicationLabFrame } from '../communication/CommunicationLabFrame';
import { MessageEditor } from '../communication/MessageEditor';
import type { Bytes, ChannelCode, DeliveryReceipt, TransmissionConfig } from '../communication/types';
import { decodeUtf8, inspectUnicode } from '../communication/unicode';
import type { LabRuntimeProps } from '../runtime';
import { channelBudgetCopy } from './copy';
import { channelCapacity, channelRequirement, runTransmission } from './model';

type BudgetFailure = {
  messageRevision: number;
  source: Bytes;
  config: TransmissionConfig;
  required: number;
};

type ChannelBudgetState = {
  config: TransmissionConfig;
  batch: unknown | null;
  budgetFailure?: BudgetFailure;
  previousReceipt?: DeliveryReceipt;
};

export default function ChannelBudgetLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'channel-budget') {
    throw new Error(`ChannelBudgetLab expected definition kind "channel-budget", received "${definition.kind}".`);
  }

  const journey = useRequiredMessageJourney();
  const labels = channelBudgetCopy[lang];
  const inspection = inspectUnicode(journey.state.messageText);
  if (!inspection.ok || inspection.value.bytes.length === 0) throw new Error('invalid-message-source');
  const source = inspection.value.bytes;
  const state = readState(value, definition.config);
  const requirement = channelRequirement(source.length * 8, state.config.code);
  const capacity = Math.floor(state.config.budget / requirement.n) * requirement.k;
  const currentReceipt = journey.state.deliveryReceipt;
  const revisionStale = currentReceipt !== null && currentReceipt.messageRevision !== journey.state.messageRevision;
  const settingsStale = currentReceipt !== null && !sameConfig(currentReceipt.config, state.config);
  const activeFailure = state.budgetFailure !== undefined &&
    state.budgetFailure.messageRevision === journey.state.messageRevision &&
    sameConfig(state.budgetFailure.config, state.config);

  const updateConfig = (next: Partial<TransmissionConfig>) => onChange({
    ...state,
    config: { ...state.config, ...next },
  });

  const run = () => {
    // Capture every value before calculation so later edits cannot rewrite this attempt.
    const messageText = journey.state.messageText;
    const messageRevision = journey.state.messageRevision;
    const capturedSource = [...source];
    const capturedConfig = { ...state.config };
    const result = runTransmission(capturedSource, capturedConfig);
    if (!result.ok) {
      if (result.error !== 'budget-exceeded') return;
      const required = channelRequirement(capturedSource.length * 8, capturedConfig.code).required;
      onChange({
        ...state,
        budgetFailure: { messageRevision, source: [...capturedSource], config: { ...capturedConfig }, required },
        ...(currentReceipt === null ? {} : { previousReceipt: currentReceipt }),
      });
      journey.dispatch({ type: 'receipt', receipt: null });
      return;
    }

    onChange({ config: { ...state.config }, batch: state.batch });
    journey.dispatch({
      type: 'receipt',
      receipt: { ...result.value, messageText, messageRevision },
    });
  };

  const status = activeFailure
    ? <><span aria-hidden="true">!</span>{' '}{labels.budgetExceeded(state.budgetFailure!.required - state.config.budget)}</>
    : currentReceipt === null
      ? ''
      : revisionStale
        ? <><span aria-hidden="true">↺</span>{' '}{labels.staleMessage}</>
        : settingsStale
          ? <><span aria-hidden="true">↺</span>{' '}{labels.staleSettings}</>
          : currentReceipt.outcome === 'exact'
            ? <><span aria-hidden="true">✓</span>{' '}{labels.exact}</>
            : currentReceipt.outcome === 'rejected'
              ? <><span aria-hidden="true">!</span>{' '}{labels.rejected}</>
              : <><span aria-hidden="true">!</span>{' '}{labels.corrupted}</>;

  const theoryCapacity = channelCapacity(state.config.p);
  if (!theoryCapacity.ok) throw new Error(theoryCapacity.error);

  return <CommunicationLabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    prediction={<p>{labels.prediction}</p>}
    observation={<>
      <BudgetBreakdown
        labels={labels}
        bitCount={source.length * 8}
        budget={state.config.budget}
        required={requirement.required}
        capacity={capacity}
        rate={requirement.rate}
      />
      {currentReceipt !== null
        ? <ReceiptView receipt={currentReceipt} labels={labels} title={labels.currentReceipt} />
        : state.previousReceipt !== undefined
          ? <ReceiptView receipt={state.previousReceipt} labels={labels} title={labels.previousReceipt} previous />
          : <p>{labels.awaiting}</p>}
    </>}
    explanation={<div>
      <section aria-label={labels.theory}>
        <h5>{labels.theory}</h5>
        <p>{labels.theoryFormula(state.config.p, theoryCapacity.value, requirement.rate)}</p>
        <p>{labels.theoryLimit}</p>
      </section>
      <p>{labels.feedback}</p>
      <p>{labels.modelLimit}</p>
    </div>}
    result={status}
    onReset={onReset}
    onBack={onBack}
  >
    <MessageEditor lang={lang} />
    <label>{labels.code}<select
      aria-label={labels.code}
      value={state.config.code}
      onChange={(event) => updateConfig({ code: event.currentTarget.value as ChannelCode })}
    >
      {(['raw', 'repeat3', 'secded'] as const).map((code) =>
        <option key={code} value={code}>{labels.codeLabels[code]}</option>)}
    </select></label>
    <label>{labels.budget}<input
      type="number" min="512" max="32768" step="512" value={state.config.budget}
      onChange={(event) => {
        const budget = event.currentTarget.valueAsNumber;
        if (Number.isInteger(budget) && budget >= 512 && budget <= 32768 && budget % 512 === 0) {
          updateConfig({ budget });
        }
      }}
    /></label>
    <label>{labels.probability}<input
      type="number" min="0" max="0.5" step="0.01" value={state.config.p}
      onChange={(event) => {
        const p = event.currentTarget.valueAsNumber;
        if (Number.isFinite(p) && p >= 0 && p <= 0.5 && Math.abs(p * 100 - Math.round(p * 100)) < 1e-9) {
          updateConfig({ p });
        }
      }}
    /></label>
    <label>{labels.seed}<input
      type="number" min="0" max="4294967295" step="1" value={state.config.seed}
      onChange={(event) => {
        const seed = event.currentTarget.valueAsNumber;
        if (Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff) updateConfig({ seed });
      }}
    /></label>
    <button type="button" onClick={() => updateConfig({ seed: (state.config.seed + 1) >>> 0 })}>{labels.newSeed}</button>
    <button type="button" onClick={run}>{labels.run}</button>
  </CommunicationLabFrame>;
}

function BudgetBreakdown({ labels, bitCount, budget, required, capacity, rate }: {
  labels: typeof channelBudgetCopy.en;
  bitCount: number;
  budget: number;
  required: number;
  capacity: number;
  rate: number;
}) {
  const rows: readonly [string, string | number][] = [
    [labels.payloadBits, bitCount],
    [labels.required, required],
    [labels.capacity, capacity],
    [required <= budget ? labels.unused : labels.missing, Math.abs(budget - required)],
    [labels.codeRate, rate.toFixed(3)],
  ];
  return <table aria-label={labels.budgetTable}>
    <thead><tr><th>{labels.budgetMetric}</th><th>{labels.budgetValue}</th></tr></thead>
    <tbody>{rows.map(([name, amount]) => <tr key={name}><th scope="row">{name}</th><td>{amount}</td></tr>)}</tbody>
  </table>;
}

function ReceiptView({ receipt, labels, title, previous = false }: {
  receipt: DeliveryReceipt;
  labels: typeof channelBudgetCopy.en;
  title: string;
  previous?: boolean;
}) {
  const decoded = receipt.received === null ? null : decodeUtf8(receipt.received);
  return <section aria-label={title}>
    <h5>{title}</h5>
    {previous ? <p>{labels.previousReceiptWarning}</p> : null}
    <p>{receipt.outcome === 'exact' ? labels.exact : receipt.outcome === 'rejected' ? labels.rejected : labels.corrupted}</p>
    <p>{labels.capturedSettings(receipt.config)}</p>
    <section aria-label={labels.sourceHex}><h6>{labels.sourceHex}</h6><code>{toHex(receipt.source)}</code></section>
    <p>{labels.flipped(receipt.flippedBits)}</p>
    {receipt.received === null
      ? <p>{labels.noPayload}</p>
      : <>
        <section aria-label={labels.receivedHex}><h6>{labels.receivedHex}</h6><code>{toHex(receipt.received)}</code></section>
        <p>{labels.payloadErrors(receipt.payloadErrors ?? 0)}</p>
        {receipt.outcome === 'silent-corruption'
          ? <p>{decoded?.ok ? labels.validButDifferent : labels.invalidUtf8}</p>
          : null}
      </>}
  </section>;
}

function readState(value: unknown, defaults: { defaultBudget: number; defaultP: number; seed: number }): ChannelBudgetState {
  const initial: ChannelBudgetState = {
    config: { code: 'raw', budget: defaults.defaultBudget, p: defaults.defaultP, seed: defaults.seed },
    batch: null,
  };
  if (typeof value !== 'object' || value === null) return initial;
  const candidate = value as Partial<ChannelBudgetState>;
  if (!validConfig(candidate.config)) return initial;
  return {
    config: { ...candidate.config },
    batch: candidate.batch ?? null,
    ...(isBudgetFailure(candidate.budgetFailure) ? { budgetFailure: candidate.budgetFailure } : {}),
    ...(isReceipt(candidate.previousReceipt) ? { previousReceipt: candidate.previousReceipt } : {}),
  };
}

function validConfig(value: unknown): value is TransmissionConfig {
  if (typeof value !== 'object' || value === null) return false;
  const config = value as Partial<TransmissionConfig>;
  return (config.code === 'raw' || config.code === 'repeat3' || config.code === 'secded') &&
    Number.isInteger(config.budget) && config.budget! >= 512 && config.budget! <= 32768 && config.budget! % 512 === 0 &&
    typeof config.p === 'number' && Number.isFinite(config.p) && config.p >= 0 && config.p <= 0.5 &&
    Number.isInteger(config.seed) && config.seed! >= 0 && config.seed! <= 0xffff_ffff;
}

function isBudgetFailure(value: unknown): value is BudgetFailure {
  if (typeof value !== 'object' || value === null) return false;
  const failure = value as Partial<BudgetFailure>;
  return Number.isSafeInteger(failure.messageRevision) && Array.isArray(failure.source) &&
    validConfig(failure.config) && Number.isSafeInteger(failure.required);
}

function isReceipt(value: unknown): value is DeliveryReceipt {
  if (typeof value !== 'object' || value === null) return false;
  const receipt = value as Partial<DeliveryReceipt>;
  return Number.isSafeInteger(receipt.messageRevision) && Array.isArray(receipt.source) && validConfig(receipt.config) &&
    (receipt.outcome === 'exact' || receipt.outcome === 'silent-corruption' || receipt.outcome === 'rejected');
}

function sameConfig(left: TransmissionConfig, right: TransmissionConfig): boolean {
  return left.code === right.code && left.budget === right.budget && left.p === right.p && left.seed === right.seed;
}

function toHex(bytes: Bytes): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
