import { describe, expect, it } from 'vitest';
import { uniformAt, uniforms } from './random';

describe('uniforms', () => {
  it('locks the independent fixed-seed Mulberry32 draws', () => {
    expect(uniforms(20260905, 5)).toEqual([
      0.8371336406562477,
      0.49214933067560196,
      0.13071764959022403,
      0.5153526349458843,
      0.31139826285652816,
    ]);
  });

  it('returns stable prefixes', () => {
    expect(uniforms(20260905, 3)).toEqual(uniforms(20260905, 8).slice(0, 3));
  });

  it('returns a fresh empty sequence for a zero length', () => {
    expect(uniforms(0, 0)).toEqual([]);
  });

  it.each([-1, 0.5, 0x1_0000_0000, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws invalid-seed for a non-uint32 seed: %s',
    (seed) => expect(() => uniforms(seed, 1)).toThrow(new RangeError('invalid-seed')),
  );

  it.each([-1, 0.5, 0x1_0000_0000, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws invalid-length for a non-negative integral count: %s',
    (count) => expect(() => uniforms(0, count)).toThrow(new RangeError('invalid-length')),
  );
});

describe('uniformAt', () => {
  it('returns the same known draws as the existing prefix generator without allocating a prefix', () => {
    const expected = [
      0.8371336406562477,
      0.49214933067560196,
      0.13071764959022403,
      0.5153526349458843,
      0.31139826285652816,
    ];

    expect(expected.map((_, index) => uniformAt(20260905, index))).toEqual(expected);
    expect(uniformAt(20260905, 4)).toBe(uniforms(20260905, 5)[4]);
  });

  it('uses the uint32 generator period for a large safe index', () => {
    expect(uniformAt(20260905, 17 + 0x1_0000_0000)).toBe(uniformAt(20260905, 17));
  });

  it.each([-1, 0.5, 0x1_0000_0000, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws invalid-seed for a non-uint32 seed: %s',
    (seed) => expect(() => uniformAt(seed, 0)).toThrow(new RangeError('invalid-seed')),
  );

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws invalid-index for a negative or non-safe-integer index: %s',
    (index) => expect(() => uniformAt(0, index)).toThrow(new RangeError('invalid-index')),
  );
});
