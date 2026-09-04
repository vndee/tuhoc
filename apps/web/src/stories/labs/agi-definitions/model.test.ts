import { describe, expect, it } from 'vitest';
import { compareDefinitions, positionDefinition, type AgiDefinition } from './model';

const one: AgiDefinition = { id: 'one', label: 'One', generality: 4, capability: 5, autonomy: 1 };
const two: AgiDefinition = { id: 'two', label: 'Two', generality: 6, capability: 4, autonomy: 2 };

describe('AGI definitions model', () => {
  it('keeps a definition on three independent coordinates', () => {
    expect(positionDefinition(one)).toEqual({ generality: 4, capability: 5, autonomy: 1 });
  });

  it('reports axis-by-axis differences without an aggregate', () => {
    expect(compareDefinitions(one, two)).toEqual({ generality: -2, capability: 1, autonomy: -1 });
  });

  it('rejects non-finite coordinates', () => {
    expect(() => positionDefinition({ ...one, autonomy: Infinity })).toThrow('Definition "One" has a non-finite autonomy coordinate.');
  });

  it('rejects an axis difference that would overflow despite finite inputs', () => {
    expect(() => compareDefinitions({ ...one, generality: Number.MAX_VALUE }, { ...two, generality: -Number.MAX_VALUE })).toThrow('Definition comparison has a non-finite generality difference.');
  });
});
