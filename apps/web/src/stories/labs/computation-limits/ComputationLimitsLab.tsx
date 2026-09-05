import { t } from '@tuhoc/i18n';
import { LabFrame } from '../LabFrame';
import type { LabRuntimeProps } from '../runtime';
import { stepMachine, type MachineSnapshot } from './model';

const MAX_RENDERED_STATE_CHARS = 256;

export default function ComputationLimitsLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'computation-limits') {
    throw new Error(`ComputationLimitsLab expected definition kind "computation-limits", received "${definition.kind}".`);
  }

  const cases = definition.config.cases ?? [{ id: 'default', label: definition.title, tape: definition.config.tape, startState: definition.config.startState, program: definition.config.program }];
  const selected = cases.find((item) => item.id === readCaseId(value)) ?? cases[0]!;
  const maxSteps = normalizeLimit(definition.config.maxSteps);
  const current = readSnapshot(value, selected.tape, selected.startState);
  const steps = readSteps(value, maxSteps);
  const status = describeStatus(current, steps, maxSteps, lang);
  const advance = () => {
    if (current.halted || steps >= maxSteps) return;
    onChange({ caseId: selected.id, steps: steps + 1, snapshot: stepMachine(current, selected.program) });
  };

  return <LabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    result={status}
    onReset={onReset}
    onBack={onBack}
  >
    <div className="story-machine-lab">
      {cases.length > 1 ? <label>{t(lang, 'stories.lab.machineState')}
        <select aria-label={t(lang, 'stories.lab.machineState')} value={selected.id} onChange={(event) => onChange({ caseId: event.currentTarget.value, steps: 0, snapshot: null })}>
          {cases.map((item) => <option key={item.id} value={item.id}>{item.label[lang]}</option>)}
        </select>
      </label> : null}
      <p>{t(lang, 'stories.lab.machineState')}: {renderState(current.state)}</p>
      <ol className="story-machine-tape" aria-label={t(lang, 'stories.lab.machineTape')}>
        {current.tape.map((cell, index) => <li key={`${index}-${cell}`} className={index === current.head ? 'is-head' : undefined}>
          <span>{cell === '' ? '□' : cell}</span><small>{index === current.head ? t(lang, 'stories.lab.machineHead') : ''}</small>
        </li>)}
      </ol>
      <div className="story-lab-action-row">
        <button type="button" onClick={advance} disabled={current.halted || steps >= maxSteps}>{t(lang, 'stories.lab.machineStep')}</button>
      </div>
    </div>
  </LabFrame>;
}

function readCaseId(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).caseId === 'string'
    ? (value as Record<string, string>).caseId : undefined;
}

function readSnapshot(value: unknown, tape: string, startState: string): MachineSnapshot {
  const candidate = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).snapshot : null;
  if (isSnapshot(candidate)) return { tape: [...candidate.tape], head: candidate.head, state: candidate.state, halted: candidate.halted };
  return { tape: Array.from(tape).length > 0 ? Array.from(tape) : [''], head: 0, state: startState, halted: false };
}

function isSnapshot(value: unknown): value is MachineSnapshot {
  return typeof value === 'object' && value !== null && Array.isArray((value as MachineSnapshot).tape)
    && typeof (value as MachineSnapshot).head === 'number' && typeof (value as MachineSnapshot).state === 'string'
    && typeof (value as MachineSnapshot).halted === 'boolean';
}

function readSteps(value: unknown, maxSteps: number): number {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).steps : 0;
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(maxSteps, Math.max(0, Math.trunc(raw))) : 0;
}

function normalizeLimit(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function renderState(state: string): string {
  return state.length <= MAX_RENDERED_STATE_CHARS ? state : `${state.slice(0, MAX_RENDERED_STATE_CHARS)}…`;
}

function describeStatus(snapshot: MachineSnapshot, steps: number, maxSteps: number, lang: LabRuntimeProps['lang']): string {
  if (snapshot.halted) return t(lang, 'stories.lab.machineHalted', steps);
  if (steps >= maxSteps) return t(lang, 'stories.lab.machineBoundReached', maxSteps);
  return t(lang, 'stories.lab.machineStillRunning', maxSteps);
}
