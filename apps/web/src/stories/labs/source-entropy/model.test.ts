import { describe, expect, it } from 'vitest';
import type { Weights } from '../communication/types';
import { drawSymbol, sourceEntropy } from './model';

describe('sourceEntropy', () => {
  it.each([
    { weights: [1, 0, 0, 0] as const, entropy: 0 },
    { weights: [1, 1, 0, 0] as const, entropy: 1 },
    { weights: [1, 1, 1, 1] as const, entropy: 2 },
  ])('returns the exact entropy boundary for $weights', ({ weights, entropy }) => {
    const result = sourceEntropy(weights);

    expect(result).toMatchObject({ ok: true, value: { entropy } });
    if (!result.ok) return;
    expect(Object.is(result.value.entropy, -0)).toBe(false);
    for (const contribution of result.value.contributions) {
      expect(Object.is(contribution, -0)).toBe(false);
    }
  });

  it('returns hand-derived probabilities and contributions for an uneven source', () => {
    const result = sourceEntropy([1, 1, 2, 0]);

    expect(result).toEqual({
      ok: true,
      value: {
        probabilities: [0.25, 0.25, 0.5, 0],
        contributions: [0.5, 0.5, 0.5, 0],
        entropy: 1.5,
      },
    });
  });

  it('is scale invariant and remains within the four-symbol entropy bounds', () => {
    const base = sourceEntropy([1, 2, 3, 4]);
    const scaled = sourceEntropy([10, 20, 30, 40]);

    expect(base.ok).toBe(true);
    expect(scaled.ok).toBe(true);
    if (!base.ok || !scaled.ok) return;
    expect(scaled.value).toEqual(base.value);
    expect(base.value.entropy).toBeGreaterThanOrEqual(0);
    expect(base.value.entropy).toBeLessThanOrEqual(2);
  });

  it('rejects an all-zero source', () => {
    expect(sourceEntropy([0, 0, 0, 0])).toEqual({ ok: false, error: 'empty-source' });
  });

  it.each([
    { weights: [1, 2, 3] as unknown as Weights },
    { weights: [1, 2, 3, 4, 5] as unknown as Weights },
    { weights: [1, 2, -1, 4] as unknown as Weights },
    { weights: [1, 2, 0.5, 4] as unknown as Weights },
    { weights: [1, 2, 101, 4] as unknown as Weights },
    { weights: [1, 2, Number.NaN, 4] as unknown as Weights },
    { weights: [1, 2, Number.POSITIVE_INFINITY, 4] as unknown as Weights },
    { weights: Object.assign([1, 2, 3, 4], { 2: undefined }) as unknown as Weights },
  ])('rejects invalid weight tuples without coercion: $weights', ({ weights }) => {
    expect(sourceEntropy(weights)).toEqual({ ok: false, error: 'invalid-weight' });
  });

  it('rejects a sparse four-slot tuple', () => {
    const sparse = [1, 2, 3, 4] as number[];
    delete sparse[2];

    expect(sourceEntropy(sparse as unknown as Weights)).toEqual({ ok: false, error: 'invalid-weight' });
  });
});

describe('drawSymbol', () => {
  it('replays the indexed Mulberry32 draw for a fixed seed and counter', () => {
    expect(drawSymbol([25, 25, 25, 25], 20260905, 0)).toEqual({
      ok: true,
      value: { symbol: 'D', surprise: 2 },
    });
    expect(drawSymbol([25, 25, 25, 25], 20260905, 1)).toEqual({
      ok: true,
      value: { symbol: 'B', surprise: 2 },
    });
    expect(drawSymbol([25, 25, 25, 25], 20260905, 0)).toEqual(
      drawSymbol([25, 25, 25, 25], 20260905, 0),
    );
  });

  it('never draws a zero-probability symbol', () => {
    for (const counter of [0, 1, 2, 10, 1_000, 0x1_0000_0000 + 2]) {
      expect(drawSymbol([0, 0, 1, 0], 20260905, counter)).toEqual({
        ok: true,
        value: { symbol: 'C', surprise: 0 },
      });
    }
  });

  it.each([
    { seed: -1, counter: 0, error: 'invalid-seed' },
    { seed: 0.5, counter: 0, error: 'invalid-seed' },
    { seed: 0x1_0000_0000, counter: 0, error: 'invalid-seed' },
    { seed: 0, counter: -1, error: 'invalid-counter' },
    { seed: 0, counter: 0.5, error: 'invalid-counter' },
    { seed: 0, counter: Number.MAX_SAFE_INTEGER + 1, error: 'invalid-counter' },
  ])('maps invalid indexed-draw input to $error', ({ seed, counter, error }) => {
    expect(drawSymbol([1, 1, 1, 1], seed, counter)).toEqual({ ok: false, error });
  });
});
