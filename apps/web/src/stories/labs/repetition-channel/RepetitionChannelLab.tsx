import { useId } from 'react';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { CommunicationLabFrame } from '../communication/CommunicationLabFrame';
import { MessageEditor } from '../communication/MessageEditor';
import type { Bytes, LabState, RunSnapshot } from '../communication/types';
import { inspectUnicode } from '../communication/unicode';
import type { LabRuntimeProps } from '../runtime';
import { repetitionChannelCopy } from './copy';
import {
  buildRepetitionTrace,
  compareRepetition,
  type RepetitionComparison,
  type RepetitionConfig,
  type RepetitionTrace,
} from './model';

type RepetitionChannelState = LabState<RepetitionConfig, RepetitionComparison> & { page: number };
const SOURCE_BITS_PER_PAGE = 12;

export default function RepetitionChannelLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'repetition-channel') {
    throw new Error(`RepetitionChannelLab expected definition kind "repetition-channel", received "${definition.kind}".`);
  }

  const journey = useRequiredMessageJourney();
  const copy = repetitionChannelCopy[lang];
  const inspection = inspectUnicode(journey.state.messageText);
  if (!inspection.ok || inspection.value.bytes.length === 0) throw new Error('invalid-message-source');
  const source = inspection.value.bytes;
  const bitCount = source.length * 8;
  const state = readState(value, definition.config.defaultP, definition.config.seed);
  const intervalErrorId = useId();
  const snapshot = state.snapshot;
  const revisionStale = snapshot !== null && snapshot.messageRevision !== journey.state.messageRevision;
  const settingsStale = snapshot !== null && !sameConfig(snapshot.config, state.config);
  const invalidInterval = state.config.mode === 'burst' &&
    (state.config.start > bitCount || state.config.length > bitCount - state.config.start);
  const updateConfig = (next: Partial<RepetitionConfig>) => onChange({
    ...state,
    config: { ...state.config, ...next },
  });
  const run = () => {
    if (invalidInterval) return;
    const result = compareRepetition(source, state.config);
    if (!result.ok) return;
    onChange({
      ...state,
      page: 0,
      snapshot: makeSnapshot(journey.state.messageRevision, source, state.config, result.value),
    });
  };
  const status = snapshot === null
    ? ''
    : revisionStale
      ? <><span aria-hidden="true">↺</span>{' '}{copy.staleMessage}</>
      : settingsStale
        ? <><span aria-hidden="true">↺</span>{' '}{copy.staleSettings}</>
        : snapshot.result.raw.errors === 0 && snapshot.result.repeat.errors === 0
          ? <><span aria-hidden="true">✓</span>{' '}{copy.exactStatus}</>
          : snapshot.result.repeat.errors < snapshot.result.raw.errors
            ? <><span aria-hidden="true">✓</span>{' '}{copy.improvedStatus(snapshot.result.raw.errors, snapshot.result.repeat.errors)}</>
            : <><span aria-hidden="true">!</span>{' '}{copy.otherStatus(snapshot.result.raw.errors, snapshot.result.repeat.errors)}</>;

  return <CommunicationLabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    prediction={<p>{copy.prediction}</p>}
    observation={snapshot === null
      ? <p>{copy.awaiting}</p>
      : <RepetitionObservation
        snapshot={snapshot}
        page={state.page}
        lang={lang}
        stale={revisionStale ? 'message' : settingsStale ? 'settings' : null}
        showTheory={state.config.mode === 'bsc'}
        onPage={(page) => onChange({ ...state, page })}
      />}
    explanation={<div><p>{copy.feedback}</p><p>{copy.modelLimit}</p></div>}
    result={status}
    onReset={onReset}
    onBack={onBack}
  >
    <MessageEditor lang={lang} />
    <fieldset>
      <legend>{copy.mode}</legend>
      <label><input
        type="radio"
        name="repetition-channel-mode"
        checked={state.config.mode === 'bsc'}
        onChange={() => updateConfig({ mode: 'bsc' })}
      />{copy.bsc}</label>
      <label><input
        type="radio"
        name="repetition-channel-mode"
        checked={state.config.mode === 'burst'}
        onChange={() => updateConfig({ mode: 'burst' })}
      />{copy.burst}</label>
    </fieldset>
    {state.config.mode === 'bsc' ? <>
      <label>{copy.probability}<input
        type="number" min="0" max="0.5" step="0.01" value={state.config.p}
        onChange={(event) => {
          const p = event.currentTarget.valueAsNumber;
          if (Number.isFinite(p) && p >= 0 && p <= 0.5) updateConfig({ p });
        }}
      /></label>
      <label>{copy.seed}<input
        type="number" min="0" max="4294967295" step="1" value={state.config.seed}
        onChange={(event) => {
          const seed = event.currentTarget.valueAsNumber;
          if (Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff) updateConfig({ seed });
        }}
      /></label>
      <button type="button" onClick={() => updateConfig({ seed: (state.config.seed + 1) >>> 0 })}>{copy.newSeed}</button>
    </> : <>
      <p>{copy.sharedInterval(bitCount)}</p>
      <label>{copy.burstStart}<input
        type="number" min="0" max={bitCount} step="1" value={state.config.start}
        aria-invalid={invalidInterval ? true : undefined}
        aria-describedby={invalidInterval ? intervalErrorId : undefined}
        onChange={(event) => {
          const start = event.currentTarget.valueAsNumber;
          if (Number.isSafeInteger(start) && start >= 0) updateConfig({ start });
        }}
      /></label>
      <label>{copy.burstLength}<input
        type="number" min="0" max={bitCount} step="1" value={state.config.length}
        aria-invalid={invalidInterval ? true : undefined}
        aria-describedby={invalidInterval ? intervalErrorId : undefined}
        onChange={(event) => {
          const length = event.currentTarget.valueAsNumber;
          if (Number.isSafeInteger(length) && length >= 0) updateConfig({ length });
        }}
      /></label>
      {invalidInterval ? <p id={intervalErrorId} role="alert">{copy.invalidInterval}</p> : null}
    </>}
    <button type="button" onClick={run} disabled={invalidInterval}>{copy.run}</button>
  </CommunicationLabFrame>;
}

function RepetitionObservation({ snapshot, page, lang, stale, showTheory, onPage }: {
  snapshot: RunSnapshot<RepetitionConfig, RepetitionComparison>;
  page: number;
  lang: LabRuntimeProps['lang'];
  stale: 'message' | 'settings' | null;
  showTheory: boolean;
  onPage: (page: number) => void;
}) {
  const labels = repetitionChannelCopy[lang];
  const trace = buildRepetitionTrace(snapshot.source, snapshot.config);
  if (!trace.ok) return <p role="alert">{trace.error}</p>;
  const bits = trace.value.source.length;
  const observed = snapshot.result;
  const rows = [
    [labels.oneCopy, observed.raw.uses, observed.raw.flips, observed.raw.errors,
      (bits - observed.raw.errors) / observed.raw.uses, 1],
    [labels.threeCopies, observed.repeat.uses, observed.repeat.flips, observed.repeat.errors,
      (bits - observed.repeat.errors) / observed.repeat.uses, 1 / 3],
  ] as const;

  return <div className="repetition-channel-observation">
    {stale === 'message' ? <p>{labels.staleMessageBanner}</p> : null}
    {stale === 'settings' ? <p>{labels.staleSettingsBanner}</p> : null}
    <section aria-label={labels.originalHex}><h5>{labels.originalHex}</h5><code>{toHex(snapshot.source)}</code></section>
    <table aria-label={labels.observedTable}>
      <thead><tr>
        <th>{labels.path}</th><th>{labels.uses}</th><th>{labels.flips}</th><th>{labels.errors}</th>
        <th>{labels.correctPerUse}</th><th>{labels.rate}</th>
      </tr></thead>
      <tbody>{rows.map(([path, uses, flips, errors, correct, rate]) => <tr key={path}>
        <th scope="row">{path}</th><td>{uses}</td><td>{flips}</td><td>{errors}</td>
        <td>{correct.toFixed(3)}</td><td>{rate === 1 ? '1' : rate.toFixed(3)}</td>
      </tr>)}</tbody>
    </table>
    {showTheory && observed.theoretical !== null ? <section aria-label={labels.theory}>
      <h5>{labels.theory}</h5><p>{labels.theoryValue(snapshot.config.p, observed.theoretical)}</p>
    </section> : null}
    <p>{labels.consecutive}</p>
    <TripleWindow trace={trace.value} page={page} labels={labels} onPage={onPage} />
  </div>;
}

function TripleWindow({ trace, page, labels, onPage }: {
  trace: RepetitionTrace;
  page: number;
  labels: typeof repetitionChannelCopy.en;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(trace.source.length / SOURCE_BITS_PER_PAGE));
  const safePage = Math.min(Math.max(Number.isSafeInteger(page) ? page : 0, 0), pageCount - 1);
  const start = safePage * SOURCE_BITS_PER_PAGE;
  const end = Math.min(start + SOURCE_BITS_PER_PAGE, trace.source.length);
  const indices = Array.from({ length: end - start }, (_, offset) => start + offset);

  return <section className="repetition-triple-window">
    <p>{labels.range(start + 1, end, trace.source.length)}</p>
    <table aria-label={labels.relationships}>
      <thead><tr><th>{labels.position}</th><th>{labels.original}</th><th>{labels.rawReceived}</th><th>{labels.repeatReceived}</th><th>{labels.vote}</th><th>{labels.outcome}</th></tr></thead>
      <tbody>{indices.map((index) => {
        const original = trace.source[index]!;
        const raw = trace.rawReceived[index]!;
        const triple = trace.repeatReceived.slice(index * 3, index * 3 + 3);
        const vote = trace.repeatDecoded[index]!;
        const changed = triple.some((bit, offset) => bit !== trace.encoded[index * 3 + offset]);
        const outcome = vote !== original ? labels.failure : changed ? labels.corrected : labels.unchanged;
        return <tr key={index}>
          <th scope="row">{labels.sourceBit(index + 1)}</th>
          <td aria-label={labels.bitValue(labels.original.toLowerCase(), original)}><span data-bit-cell aria-hidden="true">{original}</span></td>
          <td aria-label={labels.bitValue(labels.rawReceived.toLowerCase(), raw)}><span data-bit-cell aria-hidden="true">{raw}</span></td>
          <td aria-label={labels.tripleValue(triple.join(''))}>{triple.map((bit, offset) => <span data-bit-cell aria-hidden="true" key={offset}>{bit}</span>)}</td>
          <td aria-label={labels.voteValue(vote)}>{vote}</td><td>{outcome}</td>
        </tr>;
      })}</tbody>
    </table>
    <nav aria-label={labels.relationships}>
      <button type="button" disabled={safePage === 0} onClick={() => onPage(safePage - 1)}>{labels.previous}</button>
      <button type="button" disabled={safePage >= pageCount - 1} onClick={() => onPage(safePage + 1)}>{labels.next}</button>
    </nav>
  </section>;
}

function toHex(bytes: Bytes): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function makeSnapshot(messageRevision: number, source: Bytes, config: RepetitionConfig, result: RepetitionComparison): RunSnapshot<RepetitionConfig, RepetitionComparison> {
  return Object.freeze({
    messageRevision,
    source: Object.freeze([...source]),
    config: Object.freeze({ ...config }),
    result: Object.freeze({
      raw: Object.freeze({ ...result.raw }),
      repeat: Object.freeze({ ...result.repeat }),
      received: Object.freeze([...result.received]),
      theoretical: result.theoretical,
    }),
  });
}

function readState(value: unknown, defaultP: number, defaultSeed: number): RepetitionChannelState {
  const initial = initialState(defaultP, defaultSeed);
  if (typeof value !== 'object' || value === null) return initial;
  const candidate = value as Partial<RepetitionChannelState>;
  if (typeof candidate.config !== 'object' || candidate.config === null) return initial;
  const config = candidate.config as Partial<RepetitionConfig>;
  return {
    config: {
      p: typeof config.p === 'number' && Number.isFinite(config.p) && config.p >= 0 && config.p <= 0.5 ? config.p : defaultP,
      seed: typeof config.seed === 'number' && Number.isInteger(config.seed) && config.seed >= 0 && config.seed <= 0xffff_ffff ? config.seed : defaultSeed,
      mode: config.mode === 'burst' ? 'burst' : 'bsc',
      start: typeof config.start === 'number' && Number.isSafeInteger(config.start) && config.start >= 0 ? config.start : 0,
      length: typeof config.length === 'number' && Number.isSafeInteger(config.length) && config.length >= 0 ? config.length : 1,
    },
    snapshot: isSnapshot(candidate.snapshot) ? candidate.snapshot : null,
    page: typeof candidate.page === 'number' && Number.isSafeInteger(candidate.page) && candidate.page >= 0 ? candidate.page : 0,
  };
}

function initialState(defaultP: number, seed: number): RepetitionChannelState {
  return { config: { p: defaultP, seed, mode: 'bsc', start: 0, length: 1 }, snapshot: null, page: 0 };
}

function sameConfig(left: RepetitionConfig, right: RepetitionConfig): boolean {
  return left.p === right.p && left.seed === right.seed && left.mode === right.mode &&
    left.start === right.start && left.length === right.length;
}

function isSnapshot(value: unknown): value is RunSnapshot<RepetitionConfig, RepetitionComparison> {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<RunSnapshot<RepetitionConfig, RepetitionComparison>>;
  return Number.isSafeInteger(snapshot.messageRevision) && Array.isArray(snapshot.source) &&
    typeof snapshot.config === 'object' && snapshot.config !== null &&
    typeof snapshot.result === 'object' && snapshot.result !== null;
}
