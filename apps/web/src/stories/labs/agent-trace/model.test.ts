import { describe, expect, it } from 'vitest';
import { buildAgentTrace, type AgentStep } from './model';

const steps: AgentStep[] = [
  { id: 'model', kind: 'model', permission: null },
  { id: 'tool', kind: 'tool', permission: 'tool:read' },
  { id: 'data', kind: 'data', permission: 'data:course' },
  { id: 'proposal', kind: 'proposal', permission: null },
  { id: 'approval', kind: 'approval', permission: 'approval:publish' },
];

describe('agent trace model', () => {
  it('stops after the first permission that is not granted', () => {
    expect(buildAgentTrace(steps, new Set())).toEqual([
      expect.objectContaining({ id: 'model', status: 'complete' }),
      expect.objectContaining({ id: 'tool', status: 'blocked' }),
    ]);
  });

  it('keeps human approval awaiting even when all listed permissions are granted', () => {
    expect(buildAgentTrace(steps, new Set(['tool:read', 'data:course', 'approval:publish']))).toEqual([
      expect.objectContaining({ id: 'model', status: 'complete' }),
      expect.objectContaining({ id: 'tool', status: 'complete' }),
      expect.objectContaining({ id: 'data', status: 'complete' }),
      expect.objectContaining({ id: 'proposal', status: 'complete' }),
      expect.objectContaining({ id: 'approval', status: 'awaiting-human' }),
    ]);
  });

  it('does not mutate configured steps or granted permissions', () => {
    const granted = new Set(['tool:read']);
    const originalSteps = structuredClone(steps);
    buildAgentTrace(steps, granted);
    expect(steps).toEqual(originalSteps);
    expect([...granted]).toEqual(['tool:read']);
  });
});
