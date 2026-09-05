import { CommunicationLabFrame } from '../communication/CommunicationLabFrame';
import type { Bit, Bits } from '../communication/types';
import type { LabRuntimeProps } from '../runtime';
import { secdedInspectorCopy, type SecdedInspectorCopy } from './copy';
import { inspectSecded, type SecdedInspection } from './model';

interface SecdedInspectorState {
  data: string;
  flips: readonly number[];
  advanced: boolean;
}

const CHECKS = [
  { weight: 1, positions: [1, 3, 5, 7] },
  { weight: 2, positions: [2, 3, 6, 7] },
  { weight: 4, positions: [4, 5, 6, 7] },
] as const;

export default function SecdedInspectorLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'secded-inspector') {
    throw new Error(`SecdedInspectorLab expected definition kind "secded-inspector", received "${definition.kind}".`);
  }

  const copy = secdedInspectorCopy[lang];
  const state = readState(value, definition.config.data);
  const data = [...state.data].map((character) => Number(character) as Bit);
  const inspection = inspectSecded(data, state.flips);
  if (!inspection.ok) throw new Error(inspection.error);
  const toggleData = (index: number) => {
    const next = [...state.data];
    next[index] = next[index] === '0' ? '1' : '0';
    onChange({ ...state, data: next.join(''), flips: [...state.flips] });
  };
  const toggleFlip = (index: number) => {
    const selected = state.flips.includes(index);
    if (!selected && !state.advanced && state.flips.length >= 2) return;
    const flips = selected
      ? state.flips.filter((position) => position !== index)
      : [...state.flips, index].sort((left, right) => left - right);
    onChange({ ...state, flips });
  };
  const decoderLabel = inspection.value.decoded.decision === 'no-alarm'
    ? copy.noAlarm
    : inspection.value.decoded.decision === 'rejected'
      ? copy.rejected
      : copy.correctedPosition(inspection.value.decoded.correctedPosition!);
  const statusText = !inspection.value.exact && inspection.value.decoded.decision !== 'rejected'
    ? copy.misleadingStatus(decoderLabel)
    : inspection.value.decoded.decision === 'no-alarm'
      ? copy.noAlarmStatus
      : inspection.value.decoded.decision === 'rejected'
        ? state.advanced ? copy.uncorrectableStatus : copy.rejectedStatus
        : copy.correctedStatus(inspection.value.decoded.correctedPosition!);

  return <CommunicationLabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    prediction={<p>{copy.prediction}</p>}
    observation={<SecdedObservation inspection={inspection.value} copy={copy} />}
    explanation={<div><p>{copy.guarantee}</p><p>{copy.counterexamples}</p><p>{copy.modelLimit}</p></div>}
    result={<><span aria-hidden="true">{inspection.value.decoded.decision === 'rejected' || !inspection.value.exact ? '!' : '✓'}</span>{' '}{statusText}</>}
    onReset={onReset}
    onBack={onBack}
  >
    <fieldset>
      <legend>{copy.dataLegend}</legend>
      {data.map((bit, index) => <button
        type="button"
        key={index}
        aria-label={copy.dataBit(index + 1, bit)}
        aria-pressed={bit === 1}
        onClick={() => toggleData(index)}
      ><span data-bit-cell aria-hidden="true">{bit}</span></button>)}
    </fieldset>
    <p>{copy.dataWord(state.data)}</p>
    <p>{copy.encodedWord(inspection.value.sent.join(''))}</p>
    <p>{copy.normalLimit}</p>
    <label><input
      type="checkbox"
      checked={state.advanced}
      onChange={(event) => onChange({
        ...state,
        advanced: event.currentTarget.checked,
        flips: event.currentTarget.checked ? [...state.flips] : state.flips.slice(0, 2),
      })}
    />{copy.advanced}</label>
    {state.advanced ? <p role="alert">{copy.advancedWarning}</p> : null}
    <fieldset>
      <legend>{copy.protectedLegend}</legend>
      {inspection.value.received.map((bit, index) => {
        const selected = state.flips.includes(index);
        const role = bitRole(index, copy);
        return <button
          type="button"
          key={index}
          aria-label={copy.protectedBit(index + 1, role, bit, selected)}
          aria-pressed={selected}
          disabled={!selected && !state.advanced && state.flips.length >= 2}
          onClick={() => toggleFlip(index)}
        ><span data-bit-cell aria-hidden="true">{bit}</span><span>{index + 1} · {role} · {selected ? copy.flipped : copy.notFlipped}</span></button>;
      })}
    </fieldset>
  </CommunicationLabFrame>;
}

function SecdedObservation({ inspection, copy }: { inspection: SecdedInspection; copy: SecdedInspectorCopy }) {
  const failed = CHECKS.filter(({ positions }) => xorPositions(inspection.received, positions) === 1).map(({ weight }) => weight);
  const decoder = inspection.decoded;
  const decision = decoder.decision === 'no-alarm'
    ? copy.noAlarm
    : decoder.decision === 'rejected'
      ? copy.rejected
      : copy.correctedPosition(decoder.correctedPosition!);
  const truth = decoder.data === null
    ? copy.groundTruthRejected
    : inspection.exact
      ? copy.groundTruthExact
      : copy.groundTruthWrong;

  return <div className="secded-inspector-observation">
    <p>{copy.sentWord(inspection.sent.join(''))}</p>
    <p>{copy.receivedWord(inspection.received.join(''))}</p>
    <table aria-label={copy.checksTable}>
      <thead><tr><th>{copy.check}</th><th>{copy.positions}</th><th>{copy.calculation}</th><th>{copy.result}</th></tr></thead>
      <tbody>{CHECKS.map(({ weight, positions }) => {
        const values = positions.map((position) => inspection.received[position - 1]!);
        const parity = xorPositions(inspection.received, positions);
        return <tr key={weight}>
          <th scope="row">{copy.checkName(weight)}</th>
          <td>{copy.positionsValue(positions)}</td>
          <td>{values.join(' ⊕ ')} = {parity}</td>
          <td>{parity === 0 ? copy.passes : copy.fails}</td>
        </tr>;
      })}</tbody>
    </table>
    <p>{copy.overallParity(decoder.overall)}</p>
    <p>{copy.syndrome(decoder.syndrome, failed)}</p>
    <p>{copy.decoderDecision(decision)}</p>
    <p>{decoder.data === null ? copy.noRecoveredData : copy.recoveredData(decoder.data.join(''))}</p>
    <p>{truth}</p>
    <DecisionTable decoder={decoder} copy={copy} />
  </div>;
}

function DecisionTable({ decoder, copy }: { decoder: SecdedInspection['decoded']; copy: SecdedInspectorCopy }) {
  const currentIndex = decoder.syndrome === 0
    ? decoder.overall === 0 ? 0 : 2
    : decoder.overall === 1 ? 1 : 3;
  const rows = [
    [copy.zero, '0', copy.noAlarm],
    [copy.nonzero, '1', copy.correctSyndrome],
    [copy.zero, '1', copy.correctOverall],
    [copy.nonzero, '0', copy.rejectDouble],
  ];
  return <table aria-label={copy.decisionTable}>
    <thead><tr><th>{copy.syndromeColumn}</th><th>{copy.overallColumn}</th><th>{copy.decoderAction}</th><th>{copy.current}</th></tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}><td>{row[0]}</td><td>{row[1]}</td><td>{row[2]}</td><td>{index === currentIndex ? copy.current : '—'}</td></tr>)}</tbody>
  </table>;
}

function xorPositions(word: Bits, positions: readonly number[]): Bit {
  return positions.reduce<Bit>((parity, position) => (parity ^ word[position - 1]!) as Bit, 0);
}

function bitRole(index: number, copy: SecdedInspectorCopy): string {
  return [copy.parityP1, copy.parityP2, copy.dataD1, copy.parityP4, copy.dataD2, copy.dataD3, copy.dataD4, copy.overallP0][index]!;
}

function readState(value: unknown, fallbackData: string): SecdedInspectorState {
  const initial = { data: /^[01]{4}$/.test(fallbackData) ? fallbackData : '1011', flips: [] as number[], advanced: false };
  if (typeof value !== 'object' || value === null) return initial;
  const candidate = value as Partial<SecdedInspectorState>;
  const advanced = candidate.advanced === true;
  const flips = validFlips(candidate.flips) ? [...candidate.flips].sort((left, right) => left - right) : [];
  return {
    data: typeof candidate.data === 'string' && /^[01]{4}$/.test(candidate.data) ? candidate.data : initial.data,
    flips: advanced ? flips : flips.slice(0, 2),
    advanced,
  };
}

function validFlips(value: unknown): value is readonly number[] {
  if (!Array.isArray(value) || new Set(value).size !== value.length) return false;
  return value.every((position, index) => Object.hasOwn(value, index) &&
    Number.isSafeInteger(position) && position >= 0 && position < 8);
}
