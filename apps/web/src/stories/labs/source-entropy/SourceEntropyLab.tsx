import { useId } from 'react';
import { CommunicationLabFrame } from '../communication/CommunicationLabFrame';
import type { SymbolId, Weights } from '../communication/types';
import type { LabRuntimeProps } from '../runtime';
import { sourceEntropyCopy } from './copy';
import { drawSymbol, sourceEntropy, type SourceEntropyResult, type SymbolDraw } from './model';

interface SourceEntropyState {
  weights: Weights;
  seed: number;
  counter: number;
  lastDraw: SymbolDraw | null;
  prediction: SymbolId | null;
}

const SYMBOLS: readonly SymbolId[] = ['A', 'B', 'C', 'D'];

export default function SourceEntropyLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'source-entropy') {
    throw new Error(`SourceEntropyLab expected definition kind "source-entropy", received "${definition.kind}".`);
  }

  const copy = sourceEntropyCopy[lang];
  const state = readState(value, definition.config.weights, definition.config.seed);
  const distribution = sourceEntropy(state.weights);
  const errorId = useId();
  const updateWeight = (index: number, weight: number) => {
    if (!Number.isInteger(weight) || weight < 0 || weight > 100) return;
    const weights = [...state.weights] as [number, number, number, number];
    weights[index] = weight;
    onChange({ ...state, weights, lastDraw: null });
  };
  const updateSeed = (seed: number) => {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) return;
    onChange({ ...state, seed, counter: 0, lastDraw: null });
  };
  const draw = () => {
    const result = drawSymbol(state.weights, state.seed, state.counter);
    if (!result.ok) return;
    onChange({ ...state, counter: state.counter + 1, lastDraw: result.value });
  };
  const status = state.lastDraw === null
    ? ''
    : copy.drawResult(state.counter, state.lastDraw.symbol, state.lastDraw.surprise);

  return <CommunicationLabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    prediction={<div>
      <p>{copy.prediction}</p>
      <fieldset>
        <legend>{copy.predictionLegend}</legend>
        {SYMBOLS.map((symbol) => <label key={symbol}>
          <input
            type="radio"
            name="source-entropy-prediction"
            checked={state.prediction === symbol}
            onChange={() => onChange({ ...state, prediction: symbol })}
          />
          {symbol}
        </label>)}
      </fieldset>
      {state.prediction === null ? null : <p>{copy.predictionRecorded(state.prediction)}</p>}
    </div>}
    observation={distribution.ok
      ? <EntropyObservation
        weights={state.weights}
        distribution={distribution.value}
        lastDraw={state.lastDraw}
        labels={copy}
      />
      : <p>{copy.awaiting}</p>}
    explanation={<div>
      <p>{copy.feedback}</p>
      <p>{copy.unitLimit}</p>
      <p>{copy.modelLimit}</p>
    </div>}
    result={status}
    onReset={onReset}
    onBack={onBack}
  >
    <fieldset aria-describedby={!distribution.ok ? errorId : undefined}>
      <legend>{copy.weights}</legend>
      {SYMBOLS.map((symbol, index) => <label key={symbol}>
        {copy.weight(symbol)}
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          value={state.weights[index]}
          onChange={(event) => updateWeight(index, event.currentTarget.valueAsNumber)}
        />
      </label>)}
    </fieldset>
    {!distribution.ok ? <p id={errorId} role="alert">{copy.emptySource}</p> : null}
    <label>
      {copy.seed}
      <input
        type="number"
        min="0"
        max="4294967295"
        step="1"
        value={state.seed}
        onChange={(event) => updateSeed(event.currentTarget.valueAsNumber)}
      />
    </label>
    <p>{copy.nextIndex(state.counter)}</p>
    <button type="button" onClick={draw} disabled={!distribution.ok}>{copy.draw}</button>
  </CommunicationLabFrame>;
}

function EntropyObservation({ weights, distribution, lastDraw, labels }: {
  weights: Weights;
  distribution: SourceEntropyResult;
  lastDraw: SymbolDraw | null;
  labels: typeof sourceEntropyCopy.en;
}) {
  return <div className="source-entropy-observation">
    <p>{labels.entropy(distribution.entropy)}</p>
    <div className="source-entropy-bars">
      {SYMBOLS.map((symbol, index) => <div key={symbol}>
        <label>
          {labels.probabilityBar(symbol, distribution.probabilities[index]!)}
          <meter
            min="0"
            max="1"
            value={distribution.probabilities[index]}
            aria-label={labels.probabilityBar(symbol, distribution.probabilities[index]!)}
          />
        </label>
        <label>
          {labels.contributionBar(symbol, distribution.contributions[index]!)}
          <meter
            min="0"
            max="1"
            value={distribution.contributions[index]}
            aria-label={labels.contributionBar(symbol, distribution.contributions[index]!)}
          />
        </label>
      </div>)}
    </div>
    <table aria-label={labels.distributionTable}>
      <thead><tr>
        <th>{labels.symbol}</th>
        <th>{labels.weightHeader}</th>
        <th>{labels.probabilityHeader}</th>
        <th>{labels.contributionHeader}</th>
      </tr></thead>
      <tbody>{SYMBOLS.map((symbol, index) => <tr key={symbol}>
        <th scope="row">{symbol}</th>
        <td>{weights[index]}</td>
        <td>{(distribution.probabilities[index]! * 100).toFixed(2)}%</td>
        <td>{distribution.contributions[index]!.toFixed(3)}</td>
      </tr>)}</tbody>
    </table>
    {lastDraw === null ? null : <p>{labels.lastDraw(lastDraw.symbol, lastDraw.surprise)}</p>}
  </div>;
}

function readState(value: unknown, defaultWeights: Weights, defaultSeed: number): SourceEntropyState {
  const initial = initialState(defaultWeights, defaultSeed);
  if (typeof value !== 'object' || value === null) return initial;
  const candidate = value as Partial<SourceEntropyState>;
  return {
    weights: isWeights(candidate.weights) ? [...candidate.weights] as [number, number, number, number] : initial.weights,
    seed: isUint32(candidate.seed) ? candidate.seed : initial.seed,
    counter: typeof candidate.counter === 'number' && Number.isSafeInteger(candidate.counter) && candidate.counter >= 0
      ? candidate.counter
      : 0,
    lastDraw: isDraw(candidate.lastDraw) ? { ...candidate.lastDraw } : null,
    prediction: isSymbol(candidate.prediction) ? candidate.prediction : null,
  };
}

function initialState(weights: Weights, seed: number): SourceEntropyState {
  return { weights: [...weights] as [number, number, number, number], seed, counter: 0, lastDraw: null, prediction: null };
}

function isWeights(value: unknown): value is Weights {
  if (!Array.isArray(value) || value.length !== 4) return false;
  return [0, 1, 2, 3].every((index) => Object.hasOwn(value, index) &&
    Number.isInteger(value[index]) && value[index] >= 0 && value[index] <= 100,
  );
}

function isUint32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function isSymbol(value: unknown): value is SymbolId {
  return typeof value === 'string' && SYMBOLS.includes(value as SymbolId);
}

function isDraw(value: unknown): value is SymbolDraw {
  if (typeof value !== 'object' || value === null) return false;
  const draw = value as Partial<SymbolDraw>;
  return isSymbol(draw.symbol) && typeof draw.surprise === 'number' &&
    Number.isFinite(draw.surprise) && draw.surprise >= 0;
}
