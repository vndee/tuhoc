import { describe, expect, it } from 'vitest';
import { compareDefinitions, positionDefinition, type AgiDefinition } from './model';

const one: AgiDefinition = { id: 'one', label: 'One', generality: 4, capability: 5, autonomy: 1 };
const two: AgiDefinition = { id: 'two', label: 'Two', generality: 5, capability: 4, autonomy: 2 };

describe('AGI definitions model', () => {
  it('keeps a definition on three independent coordinates', () => {
    expect(positionDefinition(one)).toEqual({ generality: 4, capability: 5, autonomy: 1 });
  });

  it('reports axis-by-axis differences without an aggregate', () => {
    expect(compareDefinitions(one, two)).toEqual({ generality: -1, capability: 1, autonomy: -1 });
  });

  it('rejects non-finite coordinates', () => {
    expect(() => positionDefinition({ ...one, autonomy: Infinity })).toThrow('Definition "One" has a non-finite autonomy coordinate.');
  });

  it.each([-1, 6])('rejects a coordinate outside the authored 0–5 scale: %s', (generality) => {
    expect(() => positionDefinition({ ...one, generality })).toThrow('Definition "One" has an out-of-range generality coordinate.');
  });

});
