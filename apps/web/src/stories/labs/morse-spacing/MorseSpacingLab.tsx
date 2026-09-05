import { CommunicationLabFrame } from '../communication/CommunicationLabFrame';
import type { Result } from '../communication/types';
import type { LabRuntimeProps } from '../runtime';
import { morseSpacingCopy } from './copy';
import { morseTimeline, readMorse, type MorseSegment } from './model';

type MorseDefinition = Extract<LabRuntimeProps['definition'], { kind: 'morse-spacing' }>;
type MorseExample = MorseDefinition['config']['example'];

interface MorseRun {
  example: MorseExample;
  letterGap: number;
  wordGap: number;
  segments: MorseSegment[];
  reading: Result<string>;
}

interface MorseSpacingState {
  example: MorseExample;
  letterGap: number;
  wordGap: number;
  result: MorseRun | null;
}

const EXAMPLES: readonly MorseExample[] = ['ET', 'AET', 'BEAM', 'BEAM ET'];

export default function MorseSpacingLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'morse-spacing') {
    throw new Error(`MorseSpacingLab expected definition kind "morse-spacing", received "${definition.kind}".`);
  }

  const copy = morseSpacingCopy[lang];
  const state = readState(value, definition.config.example);
  const update = (next: Partial<Pick<MorseSpacingState, 'example' | 'letterGap' | 'wordGap'>>) => {
    onChange({ ...state, ...next });
  };
  const run = () => {
    const timeline = morseTimeline(state.example, state.letterGap, state.wordGap);
    if (!timeline.ok) return;
    const reading = readMorse(timeline.value);
    onChange({
      ...state,
      result: {
        example: state.example,
        letterGap: state.letterGap,
        wordGap: state.wordGap,
        segments: timeline.value.map((segment) => ({ ...segment })),
        reading,
      },
    });
  };

  return <CommunicationLabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    observation={state.result
      ? <MorseObservation run={state.result} labels={copy} />
      : <p>{copy.awaitingRead}</p>}
    explanation={<MorseExplanation labels={copy} />}
    result={state.result
      ? state.result.reading.ok ? copy.result(state.result.reading.value) : copy.unknownCode
      : ''}
    onReset={onReset}
    onBack={onBack}
  >
    <label>
      {copy.example}
      <select value={state.example} onChange={(event) => update({ example: event.currentTarget.value as MorseExample })}>
        {EXAMPLES.map((example) => <option key={example} value={example}>{example}</option>)}
      </select>
    </label>
    <label>
      {copy.letterGap}
      <input
        type="number"
        aria-label={copy.letterGap}
        min={1}
        max={7}
        step={1}
        value={state.letterGap}
        onChange={(event) => updateInteger(event.currentTarget.valueAsNumber, 1, 7, (letterGap) => update({ letterGap }))}
      />
      <span>{copy.units}</span>
    </label>
    <label>
      {copy.wordGap}
      <input
        type="number"
        aria-label={copy.wordGap}
        min={1}
        max={9}
        step={1}
        value={state.wordGap}
        onChange={(event) => updateInteger(event.currentTarget.valueAsNumber, 1, 9, (wordGap) => update({ wordGap }))}
      />
      <span>{copy.units}</span>
    </label>
    <div className="morse-spacing-actions">
      <button type="button" onClick={() => update({ letterGap: 3, wordGap: 7 })}>{copy.standardPreset}</button>
      <button type="button" onClick={() => update({ letterGap: 1 })}>{copy.joinedPreset}</button>
      <button type="button" onClick={run}>{copy.readSignal}</button>
    </div>
  </CommunicationLabFrame>;
}

function updateInteger(value: number, min: number, max: number, update: (value: number) => void) {
  if (Number.isInteger(value) && value >= min && value <= max) update(value);
}

function readState(value: unknown, fallbackExample: MorseExample): MorseSpacingState {
  if (typeof value !== 'object' || value === null) {
    return { example: fallbackExample, letterGap: 3, wordGap: 7, result: null };
  }
  const candidate = value as Partial<MorseSpacingState>;
  return {
    example: isExample(candidate.example) ? candidate.example : fallbackExample,
    letterGap: isIntegerInRange(candidate.letterGap, 1, 7) ? candidate.letterGap : 3,
    wordGap: isIntegerInRange(candidate.wordGap, 1, 9) ? candidate.wordGap : 7,
    result: isMorseRun(candidate.result) ? candidate.result : null,
  };
}

function isExample(value: unknown): value is MorseExample {
  return typeof value === 'string' && EXAMPLES.includes(value as MorseExample);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isMorseRun(value: unknown): value is MorseRun {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Partial<MorseRun>;
  return isExample(run.example) && isIntegerInRange(run.letterGap, 1, 7) &&
    isIntegerInRange(run.wordGap, 1, 9) && Array.isArray(run.segments) &&
    sameReading(run.reading, readMorse(run.segments));
}

function sameReading(left: unknown, right: Result<string>): boolean {
  if (typeof left !== 'object' || left === null || !('ok' in left) || left.ok !== right.ok) return false;
  if (right.ok) return 'value' in left && left.value === right.value;
  return 'error' in left && left.error === right.error;
}

function MorseObservation({ run, labels }: { run: MorseRun; labels: typeof morseSpacingCopy.en }) {
  return <div className="morse-spacing-observation">
    <p><strong>{labels.example}:</strong> {run.example}</p>
    <p><strong>{labels.decoded}:</strong> {run.reading.ok ? run.reading.value : labels.unknownCode}</p>
    <MorseTimeline segments={run.segments} label={labels.timeline} />
    <table aria-label={labels.segments}>
      <thead><tr><th>{labels.segment}</th><th>{labels.kind}</th><th>{labels.duration}</th></tr></thead>
      <tbody>{run.segments.map((segment, index) => <tr key={index}>
        <th scope="row">{index + 1}</th>
        <td>{segment.kind === 'mark' ? labels.mark : labels.gap}</td>
        <td>{segment.duration} {labels.units}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function MorseTimeline({ segments, label }: { segments: readonly MorseSegment[]; label: string }) {
  const unit = 12;
  const total = segments.reduce((sum, segment) => sum + segment.duration, 0) * unit;
  const positions = segments.map((_, index) =>
    segments.slice(0, index).reduce((sum, segment) => sum + segment.duration, 0) * unit,
  );
  return <svg role="img" aria-label={label} viewBox={`0 0 ${total} 40`} className="morse-spacing-timeline">
    {segments.map((segment, index) => {
      const x = positions[index];
      const width = segment.duration * unit;
      return <rect
        key={index}
        data-kind={segment.kind}
        data-duration={segment.duration}
        x={x}
        y={segment.kind === 'mark' ? 8 : 15}
        width={width}
        height={segment.kind === 'mark' ? 24 : 10}
        fill={segment.kind === 'mark' ? 'currentColor' : 'transparent'}
        stroke="currentColor"
        strokeDasharray={segment.kind === 'gap' ? '3 3' : undefined}
      />;
    })}
  </svg>;
}

function MorseExplanation({ labels }: { labels: typeof morseSpacingCopy.en }) {
  return <div>
    <p>{labels.modernModel}</p>
    <p>{labels.standardTiming}</p>
    <section aria-label={labels.thresholdTitle}>
      <h5>{labels.thresholdTitle}</h5>
      <ul>
        <li>{labels.joinedThreshold}</li>
        <li>{labels.letterThreshold}</li>
        <li>{labels.wordThreshold}</li>
      </ul>
    </section>
  </div>;
}
