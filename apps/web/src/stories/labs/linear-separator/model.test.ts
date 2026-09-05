import { describe, expect, it } from 'vitest';
import { classifyPoint, countMisclassified, type LabeledPoint } from './model';

const xorPoints: LabeledPoint[] = [
  { id: '00', x: 0, y: 0, label: -1 },
  { id: '01', x: 0, y: 1, label: 1 },
  { id: '10', x: 1, y: 0, label: 1 },
  { id: '11', x: 1, y: 1, label: -1 },
];

describe('linear separator model', () => {
  it('classifies using the signed angle-and-offset formula', () => {
    expect(classifyPoint({ x: 1, y: 1 }, 0, 0)).toBe(1);
    expect(classifyPoint({ x: -1, y: 0 }, 0, 0)).toBe(-1);
    expect(classifyPoint({ x: 0, y: 0 }, Math.PI / 2, -0.1)).toBe(-1);
  });

  it('normalizes non-finite controls deterministically', () => {
    expect(classifyPoint({ x: 1, y: 0 }, Number.NaN, Infinity)).toBe(1);
    expect(classifyPoint({ x: -1, y: 0 }, -Infinity, Number.NaN)).toBe(-1);
  });

  it('counts wrong labels without mutating the points', () => {
    const source = structuredClone(xorPoints);

    expect(countMisclassified(xorPoints, 0, 0)).toBeGreaterThan(0);
    expect(countMisclassified([{ id: 'positive', x: 2, y: 0, label: 1 }], 0, 0)).toBe(0);
    expect(xorPoints).toEqual(source);
  });
});
