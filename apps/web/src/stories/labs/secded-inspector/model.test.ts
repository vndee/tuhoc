import { describe, expect, it } from 'vitest';
import type { Bit, Bits } from '../communication/types';
import { inspectSecded } from './model';

describe('secded-inspector model', () => {
  it('reports sent, received, decoder evidence, and exact simulator truth without mutating inputs', () => {
    const data: Bit[] = [1, 0, 1, 1];
    const flips = [2];
    const result = inspectSecded(data, flips);

    expect(result).toEqual({
      ok: true,
      value: {
        sent: [0, 1, 1, 0, 0, 1, 1, 0],
        received: [0, 1, 0, 0, 0, 1, 1, 0],
        decoded: {
          data: [1, 0, 1, 1], word: [0, 1, 1, 0, 0, 1, 1, 0],
          syndrome: 3, overall: 1, decision: 'corrected', correctedPosition: 3,
        },
        exact: true,
      },
    });
    expect(data).toEqual([1, 0, 1, 1]);
    expect(flips).toEqual([2]);
    expect(result.ok && result.value.sent).not.toBe(data);
    expect(result.ok && result.value.received).not.toBe(data);
  });

  it('keeps the decoder decision independent from simulator ground truth for advanced counterexamples', () => {
    const misleadingRepair = inspectSecded([0, 0, 0, 0], [0, 1, 2]);
    expect(misleadingRepair).toEqual({
      ok: true,
      value: {
        sent: [0, 0, 0, 0, 0, 0, 0, 0],
        received: [1, 1, 1, 0, 0, 0, 0, 0],
        decoded: {
          data: [1, 0, 0, 0], word: [1, 1, 1, 0, 0, 0, 0, 1],
          syndrome: 0, overall: 1, decision: 'corrected', correctedPosition: 8,
        },
        exact: false,
      },
    });

    const silentCorruption = inspectSecded([0, 0, 0, 0], [0, 1, 2, 7]);
    expect(silentCorruption.ok && silentCorruption.value.decoded.decision).toBe('no-alarm');
    expect(silentCorruption.ok && silentCorruption.value.decoded.data).toEqual([1, 0, 0, 0]);
    expect(silentCorruption.ok && silentCorruption.value.exact).toBe(false);
  });

  it('rejects invalid data and non-unique, sparse, or out-of-range zero-based flip indices', () => {
    const sparse = Array(1) as number[];
    expect(inspectSecded([0, 0, 0] as Bits, [])).toEqual({ ok: false, error: 'invalid-secded-data' });
    expect(inspectSecded([0, 0, 0, 0], [8])).toEqual({ ok: false, error: 'invalid-flip-index' });
    expect(inspectSecded([0, 0, 0, 0], [-1])).toEqual({ ok: false, error: 'invalid-flip-index' });
    expect(inspectSecded([0, 0, 0, 0], [1, 1])).toEqual({ ok: false, error: 'duplicate-flip-index' });
    expect(inspectSecded([0, 0, 0, 0], sparse)).toEqual({ ok: false, error: 'invalid-flip-index' });
  });
});
