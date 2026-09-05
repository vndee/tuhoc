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
  { kind: 'message-budget', title: localized('Giữ lời', 'Keep the meaning'), instruction: localized('Rút gọn', 'Shorten'), config: { defaultBudget: 30 } },
  { kind: 'ambiguous-code', title: localized('Mã nhập nhằng', 'Ambiguous code'), instruction: localized('Giải mã', 'Decode'), config: { initialBook: { A: '0', B: '01', C: '1', D: '11' }, initialSymbols: 'B' } },
  { kind: 'morse-spacing', title: localized('Khoảng nghỉ Morse', 'Morse spacing'), instruction: localized('Đọc', 'Read'), config: { example: 'ET' } },
  { kind: 'cable-route', title: localized('Chọn tuyến', 'Choose route'), instruction: localized('So sánh', 'Compare'), config: { defaultBudget: 28 } },
  { kind: 'pulse-channel', title: localized('Kênh xung', 'Pulse channel'), instruction: localized('Quan sát', 'Observe'), config: { defaultDuration: 1 } },
  { kind: 'binary-noise', title: localized('Kênh nhiễu', 'Noisy channel'), instruction: localized('Truyền', 'Transmit'), config: { defaultP: 0.05, seed: 20260905 } },
  { kind: 'source-entropy', title: localized('Entropy nguồn', 'Source entropy'), instruction: localized('Rút', 'Draw'), config: { weights: [25, 25, 25, 25], seed: 20260905 } },
  { kind: 'huffman-message', title: localized('Nén', 'Compress'), instruction: localized('Tính cả gói', 'Count the whole packet'), config: { maxVisibleNodes: 24 } } as unknown as LabDefinition,
  { kind: 'repetition-channel', title: localized('Gửi ba lần', 'Three copies'), instruction: localized('So sánh', 'Compare'), config: { defaultP: 0.05, seed: 20260905 } } as unknown as LabDefinition,
  { kind: 'secded-inspector', title: localized('SECDED', 'SECDED'), instruction: localized('Thử', 'Try'), config: { data: '1011' } },
  { kind: 'channel-budget', title: localized('Ngân sách', 'Budget'), instruction: localized('Truyền', 'Transmit'), config: { defaultBudget: 4096, defaultP: 0.05, seed: 20260905 } } as unknown as LabDefinition,
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
  'message-budget': { budget: 30 },
  'ambiguous-code': { book: { A: '0', B: '01', C: '1', D: '11' }, symbols: 'B', result: null },
  'morse-spacing': { example: 'ET', letterGap: 3, wordGap: 7, result: null },
  'cable-route': { route: 'south', budget: 28, step: 0 },
  'pulse-channel': { duration: 1, tau: 1, sampleFraction: 0.5, source: 'alternating', page: 0, snapshot: null },
  'binary-noise': {
    config: { p: 0.05, seed: 20260905, mode: 'bsc', manual: [] },
    probabilityDraft: '0.05',
    snapshot: null,
    page: 0,
  },
  'source-entropy': { weights: [25, 25, 25, 25], seed: 20260905, counter: 0, lastDraw: null, prediction: null },
  'huffman-message': { step: 0, page: 0, snapshot: null },
  'repetition-channel': { config: { p: 0.05, seed: 20260905, mode: 'bsc', start: 0, length: 1 }, snapshot: null, page: 0 },
  'secded-inspector': { data: '1011', flips: [], advanced: false },
  'channel-budget': { config: { code: 'raw', budget: 4096, p: 0.05, seed: 20260905 }, batch: null },
};

const sourceEntropyDefinition: Extract<LabDefinition, { kind: 'source-entropy' }> = {
  kind: 'source-entropy', title: localized('Entropy nguồn', 'Source entropy'), instruction: localized('Rút', 'Draw'),
  config: { weights: [1, 2, 3, 4], seed: 4_294_967_295 },
};

const binaryNoiseDefinition: Extract<LabDefinition, { kind: 'binary-noise' }> = {
  kind: 'binary-noise', title: localized('Kênh nhiễu', 'Noisy channel'), instruction: localized('Truyền', 'Transmit'),
  config: { defaultP: 0.2, seed: 4_294_967_295 },
};

const emptyLearningRates: Extract<LabDefinition, { kind: 'gradient-descent' }> = {
  kind: 'gradient-descent', title: localized('Dốc rỗng', 'Empty gradient'), instruction: localized('Thử', 'Try'),
  config: { startX: 4, targetX: 0, learningRates: [], fundingTimeline: [] },
};

const emptyExamples: Extract<LabDefinition, { kind: 'attention' }> = {
  kind: 'attention', title: localized('Chú ý rỗng', 'Empty attention'), instruction: localized('Thử', 'Try'), config: { examples: [] },
};

describe('makeInitialLabState', () => {
  it('initializes secded-inspector with the approved data and a fresh flip array', () => {
    const definition = {
      kind: 'secded-inspector',
      title: localized('SECDED', 'SECDED'),
      instruction: localized('Thử', 'Try'),
      config: { data: '1011' },
    } as unknown as LabDefinition;
    const first = makeInitialLabState(definition) as { data: string; flips: number[]; advanced: boolean };
    const second = makeInitialLabState(definition) as { data: string; flips: number[]; advanced: boolean };

    expect(first).toEqual({ data: '1011', flips: [], advanced: false });
    expect(first.flips).not.toBe(second.flips);
    first.flips.push(3);
    expect(second.flips).toEqual([]);
  });

  it('initializes channel-budget with the approved single-run controls and no batch', () => {
    const definition = definitions.find((item) => item.kind === ('channel-budget' as never))!;
    expect(makeInitialLabState(definition)).toEqual({
      config: { code: 'raw', budget: 4096, p: 0.05, seed: 20260905 },
      batch: null,
    });
  });

  it('initializes repetition-channel with the approved channel defaults and no run', () => {
    const repetition = definitions.find((definition) => definition.kind === ('repetition-channel' as never))!;

    expect(makeInitialLabState(repetition)).toEqual({
      config: { p: 0.05, seed: 20260905, mode: 'bsc', start: 0, length: 1 },
      snapshot: null,
      page: 0,
    });
  });

  it('initializes huffman-message with a fresh empty construction view', () => {
    const huffman = definitions.find((definition) => definition.kind === 'huffman-message')!;

    expect(makeInitialLabState(huffman)).toEqual({ step: 0, page: 0, snapshot: null });
    expect(makeInitialLabState(huffman)).not.toBe(makeInitialLabState(huffman));
  });

  it('initializes source-entropy with copied weights and a fresh draw counter', () => {
    const first = makeInitialLabState(sourceEntropyDefinition) as { weights: number[] };
    const second = makeInitialLabState(sourceEntropyDefinition) as { weights: number[] };

    expect(first).toEqual({ weights: [1, 2, 3, 4], seed: 4_294_967_295, counter: 0, lastDraw: null, prediction: null });
    expect(first.weights).not.toBe(second.weights);
    expect(first.weights).not.toBe(sourceEntropyDefinition.config.weights);
  });

  it('initializes binary-noise with copied defaults, BSC mode, and an empty manual set', () => {
    const first = makeInitialLabState(binaryNoiseDefinition) as { config: { manual: number[] } };
    const second = makeInitialLabState(binaryNoiseDefinition) as { config: { manual: number[] } };

    expect(first).toEqual({
      config: { p: 0.2, seed: 4_294_967_295, mode: 'bsc', manual: [] },
      probabilityDraft: '0.2',
      snapshot: null,
      page: 0,
    });
    expect(first.config.manual).not.toBe(second.config.manual);
  });

  it('initializes pulse-channel from its configured duration without coupling tau to it', () => {
    const definition = {
      kind: 'pulse-channel', title: localized('Kênh xung', 'Pulse channel'), instruction: localized('Quan sát', 'Observe'),
      config: { defaultDuration: 4 },
    } as unknown as LabDefinition;

    expect(makeInitialLabState(definition)).toEqual({
      duration: 4, tau: 1, sampleFraction: 0.5, source: 'alternating', page: 0, snapshot: null,
    });
  });

  it('initializes cable-route from its configured budget', () => {
    const definition = {
      kind: 'cable-route', title: localized('Chọn tuyến', 'Choose route'), instruction: localized('So sánh', 'Compare'),
      config: { defaultBudget: 24 },
    } as unknown as LabDefinition;

    expect(makeInitialLabState(definition)).toEqual({ route: 'south', budget: 24, step: 0 });
  });

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

  it('copies the ambiguous-code codebook for every initial state', () => {
    const definition = definitions.find((item) => item.kind === 'ambiguous-code')! as Extract<LabDefinition, { kind: 'ambiguous-code' }>;
    const first = makeInitialLabState(definition) as { book: Record<string, string> };
    const second = makeInitialLabState(definition) as { book: Record<string, string> };

    expect(first.book).not.toBe(second.book);
    expect(first.book).not.toBe(definition.config.initialBook);
    first.book.A = '111';
    expect(second.book.A).toBe('0');
    expect(definition.config.initialBook.A).toBe('0');
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
