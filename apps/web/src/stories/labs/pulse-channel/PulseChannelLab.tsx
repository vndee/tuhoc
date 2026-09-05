import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { BitWindow } from '../communication/BitWindow';
import { toBits } from '../communication/bits';
import { CommunicationLabFrame } from '../communication/CommunicationLabFrame';
import type { Bytes, RunSnapshot } from '../communication/types';
import { inspectUnicode } from '../communication/unicode';
import type { LabRuntimeProps } from '../runtime';
import { pulseChannelCopy } from './copy';
import {
  simulatePulses,
  type PulseDuration,
  type PulseExperimentConfig,
  type PulseResult,
  type PulseSampleFraction,
  type PulseTau,
} from './model';

interface PulseChannelState extends PulseExperimentConfig {
  snapshot: RunSnapshot<PulseExperimentConfig, PulseResult> | null;
}

const DURATIONS: readonly PulseDuration[] = [1, 2, 4];
const TAUS: readonly PulseTau[] = [0, 0.5, 1, 2];
const SAMPLE_FRACTIONS: readonly PulseSampleFraction[] = [0.25, 0.5, 0.75];
const ALTERNATING_BYTES: Bytes = [0x55];
const BITS_PER_PAGE = 64;

export default function PulseChannelLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'pulse-channel') {
    throw new Error(`PulseChannelLab expected definition kind "pulse-channel", received "${definition.kind}".`);
  }

  const journey = useRequiredMessageJourney();
  const copy = pulseChannelCopy[lang];
  const state = readState(value, definition.config.defaultDuration);
  const messageInspection = inspectUnicode(journey.state.messageText);
  if (!messageInspection.ok) throw new Error('invalid-message-source');
  const messageBytes = messageInspection.value.bytes;
  const sourceBytes = state.source === 'alternating' ? ALTERNATING_BYTES : messageBytes;
  const sourceBits = toBits(sourceBytes);
  const pageCount = Math.max(1, Math.ceil(sourceBits.length / BITS_PER_PAGE));
  const page = Math.min(state.page, pageCount - 1);
  const bits = sourceBits.slice(page * BITS_PER_PAGE, (page + 1) * BITS_PER_PAGE);
  const config: PulseExperimentConfig = {
    duration: state.duration,
    tau: state.tau,
    sampleFraction: state.sampleFraction,
    source: state.source,
    page,
  };
  const revisionStale = state.snapshot !== null && state.snapshot.messageRevision !== journey.state.messageRevision;
  const settingsStale = state.snapshot !== null && !sameConfig(state.snapshot.config, config);
  const stale = revisionStale || settingsStale;

  const update = (next: Partial<PulseExperimentConfig>) => onChange({ ...state, ...next });
  const run = () => {
    const result = simulatePulses(bits, config);
    if (!result.ok) return;
    onChange({
      ...state,
      page,
      snapshot: makeSnapshot(journey.state.messageRevision, sourceBytes, config, result.value),
    });
  };
  const status = state.snapshot === null
    ? ''
    : revisionStale
      ? copy.staleMessage
      : settingsStale
        ? copy.staleSettings
        : copy.result(state.snapshot.result.errors, state.snapshot.result.samples.length);

  return <CommunicationLabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    prediction={<p>{copy.prediction}</p>}
    observation={state.snapshot
      ? <PulseObservation result={state.snapshot.result} labels={copy} stale={stale} bypass={state.snapshot.config.tau === 0} />
      : <p>{copy.awaiting}</p>}
    explanation={<div>
      {state.snapshot ? <p>{state.snapshot.config.tau === 0 ? copy.bypassFeedback : copy.feedback}</p> : null}
      <p>{copy.modelLimit}</p>
      <p>{copy.patternLimit}</p>
      <p>{copy.noNoise}</p>
    </div>}
    result={status}
    onReset={onReset}
    onBack={onBack}
  >
    <fieldset>
      <legend>{copy.source}</legend>
      <label>
        <input
          type="radio"
          name="pulse-source"
          checked={state.source === 'alternating'}
          onChange={() => update({ source: 'alternating', page: 0 })}
        />
        {copy.alternating}
      </label>
      <label>
        <input
          type="radio"
          name="pulse-source"
          checked={state.source === 'message'}
          onChange={() => update({ source: 'message', page: 0 })}
        />
        {copy.message}
      </label>
    </fieldset>
    <BitWindow
      bits={sourceBits}
      lang={lang}
      page={page}
      onPage={(nextPage) => update({ page: nextPage })}
      flipped={[]}
    />
    <label>
      {copy.duration}
      <select
        aria-label={copy.duration}
        value={state.duration}
        onChange={(event) => update({ duration: Number(event.currentTarget.value) as PulseDuration })}
      >
        {DURATIONS.map((duration) => <option key={duration} value={duration}>{copy.durationOption(duration)}</option>)}
      </select>
    </label>
    <label>
      {copy.tau}
      <select
        aria-label={copy.tau}
        value={state.tau}
        onChange={(event) => update({ tau: Number(event.currentTarget.value) as PulseTau })}
      >
        {TAUS.map((tau) => <option key={tau} value={tau}>{copy.tauOption(tau)}</option>)}
      </select>
    </label>
    <label>
      {copy.sampleFraction}
      <select
        aria-label={copy.sampleFraction}
        value={state.sampleFraction}
        onChange={(event) => update({ sampleFraction: Number(event.currentTarget.value) as PulseSampleFraction })}
      >
        {SAMPLE_FRACTIONS.map((fraction) => <option key={fraction} value={fraction}>{copy.sampleOption(fraction)}</option>)}
      </select>
    </label>
    <button type="button" onClick={run}>{copy.run}</button>
  </CommunicationLabFrame>;
}

function PulseObservation({ result, labels, stale, bypass }: {
  result: PulseResult;
  labels: typeof pulseChannelCopy.en;
  stale: boolean;
  bypass: boolean;
}) {
  return <div className="pulse-channel-observation">
    {stale ? <p>{labels.stalePlot}</p> : null}
    <PulseWaveform result={result} labels={labels} />
    <ul aria-label={labels.waveform}>
      <li>{labels.inputTrace}</li>
      <li>{bypass ? labels.bypassTrace : labels.outputTrace}</li>
    </ul>
    <table aria-label={labels.samples}>
      <thead><tr>
        <th>{labels.symbol}</th>
        <th>{labels.time}</th>
        <th>{labels.sent}</th>
        <th>{labels.value}</th>
        <th>{labels.received}</th>
      </tr></thead>
      <tbody>{result.samples.map((sample, index) => <tr key={`${index}-${sample.time}`}>
        <th scope="row">{index + 1}</th>
        <td>{sample.time.toFixed(3)}</td>
        <td>{labels.decision(sample.sent)}</td>
        <td>{sample.value.toFixed(4)}</td>
        <td>{labels.decision(sample.received)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function PulseWaveform({ result, labels }: { result: PulseResult; labels: typeof pulseChannelCopy.en }) {
  const width = 800;
  const height = 240;
  const left = 48;
  const right = 16;
  const middle = height / 2;
  const scaleY = 82;
  const totalTime = result.points.at(-1)?.time ?? 1;
  const x = (time: number) => left + (time / totalTime) * (width - left - right);
  const y = (amplitude: number) => middle - amplitude * scaleY;
  const outputPath = result.points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${x(point.time)} ${y(point.output)}`,
  ).join(' ');
  let inputPath = result.points.length === 0 ? '' : `M ${x(result.points[0]!.time)} ${y(result.points[0]!.input)}`;
  for (let index = 1; index < result.points.length; index += 1) {
    const previous = result.points[index - 1]!;
    const point = result.points[index]!;
    inputPath += ` L ${x(point.time)} ${y(previous.input)}`;
    if (point.input !== previous.input) inputPath += ` L ${x(point.time)} ${y(point.input)}`;
  }

  return <svg role="img" aria-label={labels.waveform} viewBox={`0 0 ${width} ${height}`}>
    <line x1={left} x2={width - right} y1={middle} y2={middle} stroke="currentColor" opacity="0.35" />
    <path data-trace="input" d={inputPath} fill="none" stroke="currentColor" strokeWidth="2" />
    <path data-trace="output" d={outputPath} fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="7 4" />
    {result.samples.map((sample, index) => <circle
      key={`${index}-${sample.time}`}
      data-sample-time={sample.time.toFixed(3)}
      cx={x(sample.time)}
      cy={y(sample.value)}
      r="5"
      fill="currentColor"
    />)}
  </svg>;
}

function makeSnapshot(
  messageRevision: number,
  source: Bytes,
  config: PulseExperimentConfig,
  result: PulseResult,
): RunSnapshot<PulseExperimentConfig, PulseResult> {
  const points = Object.freeze(result.points.map((point) => Object.freeze({ ...point })));
  const samples = Object.freeze(result.samples.map((sample) => Object.freeze({ ...sample })));
  return Object.freeze({
    messageRevision,
    source: Object.freeze([...source]),
    config: Object.freeze({ ...config }),
    result: Object.freeze({ points, samples, errors: result.errors }),
  });
}

function readState(value: unknown, defaultDuration: PulseDuration): PulseChannelState {
  if (typeof value !== 'object' || value === null) return initialState(defaultDuration);
  const candidate = value as Partial<PulseChannelState>;
  return {
    duration: DURATIONS.includes(candidate.duration as PulseDuration) ? candidate.duration as PulseDuration : defaultDuration,
    tau: TAUS.includes(candidate.tau as PulseTau) ? candidate.tau as PulseTau : 1,
    sampleFraction: SAMPLE_FRACTIONS.includes(candidate.sampleFraction as PulseSampleFraction)
      ? candidate.sampleFraction as PulseSampleFraction
      : 0.5,
    source: candidate.source === 'message' ? 'message' : 'alternating',
    page: typeof candidate.page === 'number' && Number.isSafeInteger(candidate.page) && candidate.page >= 0 ? candidate.page : 0,
    snapshot: isSnapshot(candidate.snapshot) ? candidate.snapshot : null,
  };
}

function initialState(duration: PulseDuration): PulseChannelState {
  return { duration, tau: 1, sampleFraction: 0.5, source: 'alternating', page: 0, snapshot: null };
}

function sameConfig(left: PulseExperimentConfig, right: PulseExperimentConfig): boolean {
  return left.duration === right.duration && left.tau === right.tau &&
    left.sampleFraction === right.sampleFraction && left.source === right.source && left.page === right.page;
}

function isSnapshot(value: unknown): value is RunSnapshot<PulseExperimentConfig, PulseResult> {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<RunSnapshot<PulseExperimentConfig, PulseResult>>;
  if (!Number.isSafeInteger(snapshot.messageRevision) || !Array.isArray(snapshot.source) ||
    typeof snapshot.config !== 'object' || snapshot.config === null ||
    typeof snapshot.result !== 'object' || snapshot.result === null) return false;
  const config = snapshot.config as Partial<PulseExperimentConfig>;
  const result = snapshot.result as Partial<PulseResult>;
  return DURATIONS.includes(config.duration as PulseDuration) && TAUS.includes(config.tau as PulseTau) &&
    SAMPLE_FRACTIONS.includes(config.sampleFraction as PulseSampleFraction) &&
    (config.source === 'alternating' || config.source === 'message') &&
    typeof config.page === 'number' && Number.isSafeInteger(config.page) && config.page >= 0 &&
    snapshot.source.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) &&
    Array.isArray(result.points) && Array.isArray(result.samples) &&
    typeof result.errors === 'number' && Number.isSafeInteger(result.errors) && result.errors >= 0;
}
