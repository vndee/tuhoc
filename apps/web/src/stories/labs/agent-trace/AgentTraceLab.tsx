import { t } from '@tuhoc/i18n';
import { LabFrame } from '../LabFrame';
import type { LabRuntimeProps } from '../runtime';
import { buildAgentTrace, type AgentStep, type AgentTraceStep } from './model';

export default function AgentTraceLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'agent-trace') {
    throw new Error(`AgentTraceLab expected definition kind "agent-trace", received "${definition.kind}".`);
  }

  const steps: AgentStep[] = definition.config.steps.map(({ id, kind, permission }) => ({ id, kind, permission }));
  const granted = readGranted(value, steps);
  const trace = buildAgentTrace(steps, granted);
  const labelFor = new Map(definition.config.steps.map((step) => [step.id, step.label[lang]]));
  const togglePermission = (permission: string, checked: boolean) => {
    const next = new Set(granted);
    if (checked) next.add(permission);
    else next.delete(permission);
    onChange({ granted: [...next] });
  };

  return <LabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    result={trace.map((step) => `${labelFor.get(step.id)}: ${statusLabel(lang, step)}`).join(' → ')}
    onReset={onReset}
    onBack={onBack}
  >
    <div className="story-agent-trace-lab">
      <fieldset>
        <legend>{t(lang, 'stories.lab.agentPermissions')}</legend>
        {definition.config.steps.filter((step) => step.permission !== null).map((step) => <label key={step.id}>
          <input type="checkbox" checked={granted.has(step.permission!)} onChange={(event) => togglePermission(step.permission!, event.currentTarget.checked)} />
          {step.label[lang]} <small>{t(lang, 'stories.lab.agentPermission', step.permission!)}</small>
        </label>)}
      </fieldset>
      <ol className="story-agent-trace" aria-label={t(lang, 'stories.lab.agentTrace')}>
        {trace.map((step) => <li key={step.id} data-status={step.status}>
          <span>{labelFor.get(step.id)}</span> <strong>{statusLabel(lang, step)}</strong>
        </li>)}
      </ol>
    </div>
  </LabFrame>;
}

function readGranted(value: unknown, steps: readonly AgentStep[]): ReadonlySet<string> {
  const candidate = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).granted : undefined;
  const allowed = new Set(steps.flatMap((step) => step.permission === null ? [] : [step.permission]));
  return new Set(Array.isArray(candidate) ? candidate.filter((permission): permission is string => typeof permission === 'string' && allowed.has(permission)) : []);
}

function statusLabel(lang: 'en' | 'vi', step: AgentTraceStep): string {
  if (step.status === 'complete') return t(lang, 'stories.lab.agentComplete');
  if (step.status === 'blocked') return t(lang, 'stories.lab.agentBlocked');
  return t(lang, 'stories.lab.agentAwaitingHuman');
}
