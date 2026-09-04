import { t } from '@tuhoc/i18n';
import { LabFrame } from '../LabFrame';
import type { LabRuntimeProps } from '../runtime';
import { describeAbacusAddition } from './model';

type Representation = 'abacus' | 'gears';

export default function EmbodiedCalculationLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'embodied-calculation') {
    throw new Error(`EmbodiedCalculationLab expected definition kind "embodied-calculation", received "${definition.kind}".`);
  }

  const step = clampInteger(readNumber(value, 'step'), 0, definition.config.right);
  const representation = readRepresentation(value);
  const output = definition.config.left + step;
  const sequence = Array.from({ length: step + 1 }, (_, index) => definition.config.left + index);
  const operations = describeAbacusAddition(definition.config.left, step);
  const setStep = (next: number) => onChange({ step: clampInteger(next, 0, definition.config.right), representation });

  return <LabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    result={`${definition.config.left} + ${step} = ${output}`}
    onReset={onReset}
    onBack={onBack}
  >
    <div className="story-abacus-lab">
      <div className="story-lab-action-row" aria-label={t(lang, 'stories.lab.abacusLabel')}>
        <button type="button" onClick={() => setStep(step - 1)} disabled={step === 0}>{t(lang, 'stories.lab.abacusPrevious')}</button>
        <button type="button" onClick={() => setStep(step + 1)} disabled={step >= definition.config.right}>{t(lang, 'stories.lab.abacusNext')}</button>
        <button type="button" onClick={() => setStep(step + 1)} disabled={step >= definition.config.right}>{t(lang, 'stories.lab.abacusAddBead')}</button>
        <button type="button" onClick={() => onChange({ step, representation: representation === 'abacus' ? 'gears' : 'abacus' })}>
          {representation === 'abacus' ? t(lang, 'stories.lab.abacusShowGears') : t(lang, 'stories.lab.abacusShowAbacus')}
        </button>
      </div>
      <svg className="story-abacus-diagram" viewBox="0 0 320 110" role="img">
        <title>{t(lang, 'stories.lab.abacusDiagram')}</title>
        <desc>{t(lang, 'stories.lab.abacusDiagramDescription')}</desc>
        {representation === 'abacus'
          ? Array.from({ length: definition.config.left + definition.config.right }, (_, index) => <circle key={index} cx={20 + index * 23} cy="55" r="9" className={index < output ? 'is-active' : undefined} />)
          : sequence.map((number, index) => <g key={number}><circle cx={28 + index * 53} cy="55" r="18" /><text x={22 + index * 53} y="60">{number}</text></g>)}
      </svg>
      {representation === 'gears' && <p>{t(lang, 'stories.lab.abacusGearSequence')}: {sequence.join(' → ')}</p>}
      <ul className="story-carry-list">
        {operations.map((operation) => <li key={operation.index}>{t(lang, 'stories.lab.abacusColumn')} {operation.index + 1}: {operation.value} — {operation.carry ? t(lang, 'stories.lab.abacusCarry') : t(lang, 'stories.lab.abacusNoCarry')}</li>)}
      </ul>
    </div>
  </LabFrame>;
}

function readNumber(value: unknown, key: string): number {
  if (typeof value !== 'object' || value === null || typeof (value as Record<string, unknown>)[key] !== 'number') return 0;
  return (value as Record<string, number>)[key];
}

function readRepresentation(value: unknown): Representation {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).representation === 'gears' ? 'gears' : 'abacus';
}

function clampInteger(value: number, min: number, max: number): number {
  const safeMax = Math.max(min, Math.trunc(Number.isFinite(max) ? max : min));
  return Math.min(safeMax, Math.max(min, Math.trunc(Number.isFinite(value) ? value : min)));
}
