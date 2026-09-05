import { useId, useState } from 'react';
import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { BitWindow } from '../communication/BitWindow';
import { toBits } from '../communication/bits';
import { CommunicationLabFrame } from '../communication/CommunicationLabFrame';
import { MessageEditor } from '../communication/MessageEditor';
import type { Bytes, LabState, RunSnapshot } from '../communication/types';
import { inspectUnicode } from '../communication/unicode';
import type { LabRuntimeProps } from '../runtime';
import { binaryNoiseCopy } from './copy';
import {
  manualNoise,
  transmitNoisy,
  type BinaryNoiseConfig,
  type NoiseResult,
} from './model';

type BinaryNoiseState = LabState<BinaryNoiseConfig, NoiseResult> & { page: number };

export default function BinaryNoiseLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'binary-noise') {
    throw new Error(`BinaryNoiseLab expected definition kind "binary-noise", received "${definition.kind}".`);
  }

  const journey = useRequiredMessageJourney();
  const copy = binaryNoiseCopy[lang];
  const inspection = inspectUnicode(journey.state.messageText);
  if (!inspection.ok || inspection.value.bytes.length === 0) throw new Error('invalid-message-source');
  const source = inspection.value.bytes;
  const state = readState(value, definition.config.defaultP, definition.config.seed, source.length * 8);
  const [probabilityDraft, setProbabilityDraft] = useState(String(state.config.p));
  const probabilityErrorId = useId();
  const parsedProbability = parseProbability(probabilityDraft);
  const invalidProbability = state.config.mode === 'bsc' && parsedProbability === null;
  const revisionStale = state.snapshot !== null && state.snapshot.messageRevision !== journey.state.messageRevision;
  const settingsStale = state.snapshot !== null && !sameConfig(state.snapshot.config, state.config);
  const updateConfig = (next: Partial<BinaryNoiseConfig>) => onChange({
    ...state,
    config: { ...state.config, ...next },
  });
  const run = () => {
    if (invalidProbability) return;
    const result = state.config.mode === 'bsc'
      ? transmitNoisy(source, state.config)
      : manualNoise(source, state.config.manual);
    if (!result.ok) return;
    onChange({
      ...state,
      snapshot: makeSnapshot(journey.state.messageRevision, source, state.config, result.value),
    });
  };
  const toggleManual = (index: number) => {
    const selected = new Set(state.config.manual);
    if (selected.has(index)) selected.delete(index);
    else selected.add(index);
    updateConfig({ manual: [...selected].sort((left, right) => left - right) });
  };
  const status = state.snapshot === null
    ? ''
    : revisionStale
      ? copy.staleMessage
      : settingsStale
        ? copy.staleSettings
        : copy.result(state.snapshot.result.errors, state.snapshot.source.length * 8);

  return <CommunicationLabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    prediction={<p>{copy.prediction}</p>}
    observation={state.snapshot
      ? <NoiseObservation
        snapshot={state.snapshot}
        page={state.page}
        onPage={(page) => onChange({ ...state, page })}
        labels={copy}
        stale={revisionStale ? 'message' : settingsStale ? 'settings' : null}
        lang={lang}
        showBits={state.config.mode === 'bsc'}
      />
      : <p>{copy.awaiting}</p>}
    explanation={<div>
      <p>{copy.feedback}</p>
      <p>{copy.probabilityLimit}</p>
      <p>{copy.modelLimit}</p>
    </div>}
    result={status}
    onReset={() => {
      setProbabilityDraft(String(definition.config.defaultP));
      onReset();
    }}
    onBack={onBack}
  >
    <MessageEditor lang={lang} />
    <fieldset>
      <legend>{copy.mode}</legend>
      <label>
        <input
          type="radio"
          name="binary-noise-mode"
          checked={state.config.mode === 'bsc'}
          onChange={() => updateConfig({ mode: 'bsc' })}
        />
        {copy.bsc}
      </label>
      <label>
        <input
          type="radio"
          name="binary-noise-mode"
          checked={state.config.mode === 'manual'}
          onChange={() => updateConfig({ mode: 'manual' })}
        />
        {copy.manual}
      </label>
    </fieldset>
    {state.config.mode === 'bsc' ? <>
      <label>
        {copy.probability}
        <input
          type="number"
          min="0"
          max="0.5"
          step="0.01"
          value={probabilityDraft}
          aria-invalid={invalidProbability ? true : undefined}
          aria-describedby={invalidProbability ? probabilityErrorId : undefined}
          onChange={(event) => {
            const draft = event.currentTarget.value;
            setProbabilityDraft(draft);
            const p = parseProbability(draft);
            if (p !== null) updateConfig({ p });
          }}
        />
      </label>
      {invalidProbability ? <p id={probabilityErrorId} role="alert">{copy.invalidProbability}</p> : null}
      <label>
        {copy.seed}
        <input
          type="number"
          min="0"
          max="4294967295"
          step="1"
          value={state.config.seed}
          onChange={(event) => {
            const seed = event.currentTarget.valueAsNumber;
            if (Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff) updateConfig({ seed });
          }}
        />
      </label>
      <button type="button" onClick={() => updateConfig({ seed: (state.config.seed + 1) >>> 0 })}>
        {copy.newSeed}
      </button>
    </> : <>
      <p>{copy.manualLimit}</p>
      <BitWindow
        bits={toBits(source)}
        lang={lang}
        page={state.page}
        onPage={(page) => onChange({ ...state, page })}
        flipped={state.config.manual}
        onFlip={toggleManual}
      />
    </>}
    <button type="button" onClick={run} disabled={invalidProbability}>{copy.run}</button>
  </CommunicationLabFrame>;
}

function NoiseObservation({ snapshot, page, onPage, labels, stale, lang, showBits }: {
  snapshot: RunSnapshot<BinaryNoiseConfig, NoiseResult>;
  page: number;
  onPage: (page: number) => void;
  labels: typeof binaryNoiseCopy.en;
  stale: 'message' | 'settings' | null;
  lang: LabRuntimeProps['lang'];
  showBits: boolean;
}) {
  return <div className="binary-noise-observation">
    {stale === 'message' ? <p>{labels.staleMessageBanner}</p> : null}
    {stale === 'settings' ? <p>{labels.staleSettingsBanner}</p> : null}
    {showBits ? <BitWindow
        bits={toBits(snapshot.result.received)}
        lang={lang}
        page={page}
        onPage={onPage}
        flipped={snapshot.result.flipped}
      /> : null}
    <section aria-label={labels.sourceHex}>
      <h5>{labels.sourceHex}</h5>
      <code>{toHex(snapshot.source)}</code>
    </section>
    <section aria-label={labels.receivedHex}>
      <h5>{labels.receivedHex}</h5>
      <code>{toHex(snapshot.result.received)}</code>
    </section>
    <p>{labels.observedBer(snapshot.result.ber)}</p>
    <p>{snapshot.result.exact ? labels.exact : labels.changed}</p>
    {snapshot.result.decoded.ok
      ? <section aria-label={labels.decoded}><h5>{labels.decoded}</h5><pre>{snapshot.result.decoded.value}</pre></section>
      : <p role="alert">{labels.invalidUtf8}</p>}
  </div>;
}

function toHex(bytes: Bytes): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function parseProbability(value: string): number | null {
  if (value.trim() === '') return null;
  const probability = Number(value);
  if (!Number.isFinite(probability) || probability < 0 || probability > 0.5) return null;
  const hundredths = probability * 100;
  return Math.abs(hundredths - Math.round(hundredths)) < 1e-9 ? probability : null;
}

function makeSnapshot(
  messageRevision: number,
  source: Bytes,
  config: BinaryNoiseConfig,
  result: NoiseResult,
): RunSnapshot<BinaryNoiseConfig, NoiseResult> {
  const decoded = Object.freeze({ ...result.decoded });
  return Object.freeze({
    messageRevision,
    source: Object.freeze([...source]),
    config: Object.freeze({ ...config, manual: Object.freeze([...config.manual]) }),
    result: Object.freeze({
      ...result,
      received: Object.freeze([...result.received]),
      flipped: Object.freeze([...result.flipped]),
      decoded,
    }),
  });
}

function readState(value: unknown, defaultP: number, defaultSeed: number, bitCount: number): BinaryNoiseState {
  const initial = initialState(defaultP, defaultSeed);
  if (typeof value !== 'object' || value === null) return initial;
  const candidate = value as Partial<BinaryNoiseState>;
  if (typeof candidate.config !== 'object' || candidate.config === null) return initial;
  const config = candidate.config as Partial<BinaryNoiseConfig>;
  const manual = Array.isArray(config.manual)
    ? [...new Set(config.manual.filter((index) => Number.isSafeInteger(index) && index >= 0 && index < bitCount))]
      .sort((left, right) => left - right)
    : [];
  return {
    config: {
      p: typeof config.p === 'number' && Number.isFinite(config.p) && config.p >= 0 && config.p <= 0.5 ? config.p : defaultP,
      seed: typeof config.seed === 'number' && Number.isInteger(config.seed) && config.seed >= 0 && config.seed <= 0xffff_ffff
        ? config.seed
        : defaultSeed,
      mode: config.mode === 'manual' ? 'manual' : 'bsc',
      manual,
    },
    snapshot: isSnapshot(candidate.snapshot) ? candidate.snapshot : null,
    page: typeof candidate.page === 'number' && Number.isSafeInteger(candidate.page) && candidate.page >= 0 ? candidate.page : 0,
  };
}

function initialState(defaultP: number, seed: number): BinaryNoiseState {
  return { config: { p: defaultP, seed, mode: 'bsc', manual: [] }, snapshot: null, page: 0 };
}

function sameConfig(left: BinaryNoiseConfig, right: BinaryNoiseConfig): boolean {
  return left.p === right.p && left.seed === right.seed && left.mode === right.mode &&
    left.manual.length === right.manual.length && left.manual.every((index, offset) => index === right.manual[offset]);
}

function isSnapshot(value: unknown): value is RunSnapshot<BinaryNoiseConfig, NoiseResult> {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<RunSnapshot<BinaryNoiseConfig, NoiseResult>>;
  return Number.isSafeInteger(snapshot.messageRevision) && Array.isArray(snapshot.source) &&
    typeof snapshot.config === 'object' && snapshot.config !== null &&
    typeof snapshot.result === 'object' && snapshot.result !== null;
}
