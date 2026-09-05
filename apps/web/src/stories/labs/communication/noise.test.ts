import { describe, expect, it } from 'vitest';
import type { Bit } from './types';
import { bsc } from './noise';

const bits = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1] as const;

describe('bsc', () => {
  it('copies the input without flips at zero probability', () => {
    const result = bsc(bits, { p: 0, seed: 20260905 });

    expect(result).toEqual({ bits, flipped: [] });
    expect(result.bits).not.toBe(bits);
  });

  it('replays the same channel sample for the same configuration', () => {
    expect(bsc(bits, { p: 0.3, seed: 20260905 })).toEqual(bsc(bits, { p: 0.3, seed: 20260905 }));
  });

  it('uses nested flip sets as probability increases for a stable uniform prefix', () => {
    const low = bsc(bits, { p: 0.1, seed: 20260905 }).flipped;
    const high = bsc(bits, { p: 0.3, seed: 20260905 }).flipped;

    expect(low.every((index) => high.includes(index))).toBe(true);
  });

  it('reports exact flipped indices and leaves the source unchanged', () => {
    const source = [...bits];

    expect(bsc(source, { p: 0.3, seed: 20260905 })).toEqual({
      bits: [0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0],
      flipped: [2, 15],
    });
    expect(source).toEqual(bits);
  });

  it.each([-0.1, 0.5000001, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws invalid-probability outside the finite teaching range: %s',
    (p) => expect(() => bsc(bits, { p, seed: 0 })).toThrow(new RangeError('invalid-probability')),
  );

  it.each([-1, 0.5, 0x1_0000_0000, Number.NaN])(
    'throws invalid-seed for a non-uint32 seed: %s',
    (seed) => expect(() => bsc(bits, { p: 0, seed })).toThrow(new RangeError('invalid-seed')),
  );

  it('throws invalid-bit without including caller data', () => {
    expect(() => bsc([0, 7, 1] as unknown as readonly Bit[], { p: 0, seed: 0 }))
      .toThrow(new RangeError('invalid-bit'));
  });
});
