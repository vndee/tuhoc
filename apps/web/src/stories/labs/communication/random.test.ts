import { describe, expect, it } from 'vitest';
import { uniforms } from './random';

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
