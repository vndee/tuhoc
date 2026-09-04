import { describe, expect, it } from 'vitest';
import { executeRuleCards, type ExecutableRuleCard } from './model';

describe('executeRuleCards', () => {
  const cards: ExecutableRuleCard[] = [
    { id: 'double', operation: 'multiply', operand: 2 },
    { id: 'plus-three', operation: 'add', operand: 3 },
  ];

  it('applies rule cards in their provided order', () => {
    expect(executeRuleCards(4, cards)).toMatchObject({ output: 11, trace: [4, 8, 11] });
    expect(executeRuleCards(4, [...cards].reverse())).toMatchObject({ output: 14, trace: [4, 7, 14] });
  });

  it('clamps inputs and operands to non-negative integers', () => {
    expect(executeRuleCards(-2.2, [{ id: 'subtract', operation: 'add', operand: -5 }])).toEqual({ output: 0, trace: [0, 0] });
  });

  it('normalizes non-finite values and clamps every intermediate result to Number.MAX_SAFE_INTEGER', () => {
    const huge = Number.MAX_SAFE_INTEGER;
    expect(executeRuleCards(Number.MAX_VALUE, [{ id: 'double', operation: 'multiply', operand: 2 }])).toEqual({ output: huge, trace: [huge, huge] });
    expect(executeRuleCards(NaN, [{ id: 'infinite', operation: 'add', operand: Infinity }])).toEqual({ output: huge, trace: [0, huge] });
    expect(executeRuleCards(-Infinity, [{ id: 'fraction', operation: 'multiply', operand: 2.9 }])).toEqual({ output: 0, trace: [0, 0] });
  });

  it('does not mutate the supplied rule cards while producing a finite integer trace', () => {
    const input = 4.9;
    const source: ExecutableRuleCard[] = [{ id: 'large', operation: 'add', operand: Number.MAX_VALUE }];
    const snapshot = structuredClone(source);

    const result = executeRuleCards(input, source);

    expect(result).toEqual({ output: Number.MAX_SAFE_INTEGER, trace: [4, Number.MAX_SAFE_INTEGER] });
    expect(source).toEqual(snapshot);
    expect(result.trace.every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true);
  });
});
