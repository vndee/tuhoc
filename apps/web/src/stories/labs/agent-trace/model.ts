export type AgentStepKind = 'model' | 'tool' | 'data' | 'proposal' | 'approval';

export interface AgentStep {
  id: string;
  kind: AgentStepKind;
  permission: string | null;
}

export interface AgentTraceStep extends AgentStep {
  status: 'complete' | 'blocked' | 'awaiting-human';
}

/** Builds a configured, sequential trace without invoking a model, tool, or network request. */
export function buildAgentTrace(steps: readonly AgentStep[], granted: ReadonlySet<string>): AgentTraceStep[] {
  const trace: AgentTraceStep[] = [];

  for (const step of steps) {
    if (step.kind === 'approval') {
      trace.push({ ...step, status: 'awaiting-human' });
      break;
    }
    if (step.permission !== null && !granted.has(step.permission)) {
      trace.push({ ...step, status: 'blocked' });
      break;
    }
    trace.push({ ...step, status: 'complete' });
  }

  return trace;
}
