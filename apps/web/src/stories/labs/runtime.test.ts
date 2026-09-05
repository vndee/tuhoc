import { describe, expect, it } from 'vitest';
import { ALL_LAB_KINDS, type LabDefinition } from '../types';
import { makeInitialLabState } from './runtime';

const localized = <T,>(vi: T, en: T) => ({ vi, en });

const definitions: LabDefinition[] = [
  { kind: 'external-memory', title: localized('Ngoại nhớ', 'External memory'), instruction: localized('Thử', 'Try'), config: { generations: 3, oralRetention: 40, symbolicRetention: 80, originalMarks: 12 } },
  { kind: 'embodied-calculation', title: localized('Bàn tính', 'Abacus'), instruction: localized('Thử', 'Try'), config: { left: 4, right: 3, rods: 5 } },
  { kind: 'executable-rules', title: localized('Quy tắc', 'Rules'), instruction: localized('Thử', 'Try'), config: { input: 2, target: 8, cards: [{ id: 'double', operation: 'multiply', operand: 2 }] } },
  { kind: 'computation-limits', title: localized('Giới hạn', 'Limits'), instruction: localized('Thử', 'Try'), config: { tape: '0', startState: 'A', maxSteps: 3, program: { A: { write: '1', move: 1, next: 'A' } } } },
  { kind: 'judgment-criteria', title: localized('Phán đoán', 'Judgment'), instruction: localized('Thử', 'Try'), config: { transcript: localized([], []), criteria: [{ id: 'clarity', label: localized('Rõ', 'Clear'), finding: localized('Có', 'Yes') }] } },
  { kind: 'linear-separator', title: localized('Đường thẳng', 'Line'), instruction: localized('Thử', 'Try'), config: { points: [], angle: 30, offset: 2 } },
  { kind: 'knowledge-bottleneck', title: localized('Nút cổ chai', 'Bottleneck'), instruction: localized('Thử', 'Try'), config: { nodes: [], changedRuleId: 'rule-1' } },
  { kind: 'gradient-descent', title: localized('Dốc', 'Gradient'), instruction: localized('Thử', 'Try'), config: { startX: 9, targetX: 0, learningRates: [0.1], fundingTimeline: [] } },
  { kind: 'convolution', title: localized('Tích chập', 'Convolution'), instruction: localized('Thử', 'Try'), config: { pixels: [[1]], kernel: [[1]], row: 1, column: 2 } },
  { kind: 'attention', title: localized('Chú ý', 'Attention'), instruction: localized('Thử', 'Try'), config: { examples: [{ id: 'example-1', tokens: localized(['a'], ['a']), weights: localized([[1]], [[1]]), gloss: localized('A', 'A') }] } },
  { kind: 'agent-trace', title: localized('Tác tử', 'Agent'), instruction: localized('Thử', 'Try'), config: { steps: [{ id: 'read', kind: 'data', label: localized('Đọc', 'Read'), permission: 'read' }] } },
  { kind: 'agi-definitions', title: localized('AGI', 'AGI'), instruction: localized('Thử', 'Try'), config: { definitions: [{ id: 'd-1', label: localized('D1', 'D1'), sourceId: 'test', sourceLabel: localized('Nguồn thử', 'Test source'), note: localized('Một', 'One'), generality: 1, capability: 1, autonomy: 1 }, { id: 'd-2', label: localized('D2', 'D2'), sourceId: 'test', sourceLabel: localized('Nguồn thử', 'Test source'), note: localized('Hai', 'Two'), generality: 2, capability: 2, autonomy: 2 }, { id: 'd-3', label: localized('D3', 'D3'), sourceId: 'test', sourceLabel: localized('Nguồn thử', 'Test source'), note: localized('Ba', 'Three'), generality: 3, capability: 3, autonomy: 3 }] } },
];

const expectedStateByKind: Record<LabDefinition['kind'], unknown> = {
  'external-memory': { generation: 0 },
  'embodied-calculation': { step: 0, representation: 'abacus' },
  'executable-rules': { cardIds: ['double'] },
  'computation-limits': { steps: 0, snapshot: null },
  'judgment-criteria': { enabledIds: [] },
  'linear-separator': { angle: 30, offset: 2, xor: false },
  'knowledge-bottleneck': { changedRuleId: 'rule-1' },
  'gradient-descent': { x: 9, rate: 0.1, steps: 0 },
  'convolution': { row: 1, column: 2, parallel: false },
  'attention': { exampleId: 'example-1', tokenIndex: 0 },
  'agent-trace': { granted: [] },
  'agi-definitions': { selectedIds: ['d-1', 'd-2'] },
};

const emptyLearningRates: Extract<LabDefinition, { kind: 'gradient-descent' }> = {
  kind: 'gradient-descent', title: localized('Dốc rỗng', 'Empty gradient'), instruction: localized('Thử', 'Try'),
  config: { startX: 4, targetX: 0, learningRates: [], fundingTimeline: [] },
};

const emptyExamples: Extract<LabDefinition, { kind: 'attention' }> = {
  kind: 'attention', title: localized('Chú ý rỗng', 'Empty attention'), instruction: localized('Thử', 'Try'), config: { examples: [] },
};

describe('makeInitialLabState', () => {
  it('returns the exact initial-state table for every lab kind', () => {
    expect(definitions.map((definition) => definition.kind)).toEqual(ALL_LAB_KINDS);

    for (const definition of definitions) {
      expect(makeInitialLabState(definition)).toEqual(expectedStateByKind[definition.kind]);
    }
  });

  it('returns serializable states for type-valid empty rate and example configs', () => {
    expect(makeInitialLabState(emptyLearningRates)).toEqual({ x: 4, rate: 0, steps: 0 });
    expect(makeInitialLabState(emptyExamples)).toEqual({ exampleId: '', tokenIndex: 0 });

    for (const definition of [...definitions, emptyLearningRates, emptyExamples]) {
      const state = makeInitialLabState(definition);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });

  it('does not share mutable state between calls or with executable-rule cards', () => {
    const executable = structuredClone(definitions.find((definition): definition is Extract<LabDefinition, { kind: 'executable-rules' }> => definition.kind === 'executable-rules')!) as Extract<LabDefinition, { kind: 'executable-rules' }>;
    const first = makeInitialLabState(executable) as { cardIds: string[] };
    const second = makeInitialLabState(executable) as { cardIds: string[] };

    expect(first.cardIds).toEqual(['double']);
    expect(first.cardIds).not.toBe(second.cardIds);
    expect(first.cardIds).not.toBe(executable.config.cards);
    executable.config.cards[0]!.id = 'from-source';
    expect(first.cardIds).toEqual(['double']);
    first.cardIds.push('local-only');
    expect(executable.config.cards.map((card) => card.id)).toEqual(['from-source']);
    expect(second.cardIds).toEqual(['double']);
  });

  it('does not share mutable state between calls or with AGI definitions', () => {
    const agi = structuredClone(definitions.find((definition): definition is Extract<LabDefinition, { kind: 'agi-definitions' }> => definition.kind === 'agi-definitions')!) as Extract<LabDefinition, { kind: 'agi-definitions' }>;
    const first = makeInitialLabState(agi) as { selectedIds: string[] };
    const second = makeInitialLabState(agi) as { selectedIds: string[] };

    expect(first.selectedIds).toEqual(['d-1', 'd-2']);
    expect(first.selectedIds).not.toBe(second.selectedIds);
    expect(first.selectedIds).not.toBe(agi.config.definitions);
    agi.config.definitions[0]!.id = 'from-source';
    expect(first.selectedIds).toEqual(['d-1', 'd-2']);
    first.selectedIds.push('local-only');
    expect(agi.config.definitions.slice(0, 2).map((item) => item.id)).toEqual(['from-source', 'd-2']);
    expect(second.selectedIds).toEqual(['d-1', 'd-2']);
  });

  it('returns equal but independent reset state for every lab kind', () => {
    for (const definition of definitions) {
      const first = makeInitialLabState(definition) as Record<string, unknown>;
      const reset = makeInitialLabState(definition) as Record<string, unknown>;
      expect(reset).toEqual(first);

      for (const value of Object.values(first)) {
        if (Array.isArray(value)) value.push('__changed__');
      }
      expect(makeInitialLabState(definition)).toEqual(reset);
    }
  });
});
