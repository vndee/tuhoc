import { describe, expect, it } from 'vitest';
import type { Bit, Bits } from './types';
import { decodeSecded, encodeSecded } from './secded';

describe('SECDED codec', () => {
  it('encodes the approved p1,p2,d1,p4,d2,d3,d4,p0 even-parity example', () => {
    expect(encodeSecded([1, 0, 1, 1])).toEqual({ ok: true, value: [0, 1, 1, 0, 0, 1, 1, 0] });
  });

  it('repairs every single flip and rejects every double flip for all 16 data words (592 cases)', () => {
    let cases = 0;
    for (let value = 0; value < 16; value += 1) {
      const data = [3, 2, 1, 0].map((i) => ((value >>> i) & 1) as Bit);
      const encoded = encodeSecded(data); if (!encoded.ok) throw new Error(encoded.error);
      const masks = [[], ...Array.from({ length: 8 }, (_, i) => [i]),
        ...Array.from({ length: 8 }, (_, i) => Array.from({ length: 7 - i }, (_, j) => [i, i + j + 1])).flat()];
      expect(masks).toHaveLength(37);
      for (const mask of masks) {
        const received = encoded.value.map((bit, index) => (mask.includes(index) ? 1 - bit : bit) as Bit);
        const decoded = decodeSecded(received); if (!decoded.ok) throw new Error(decoded.error);
        if (mask.length === 2) expect(decoded.value.decision).toBe('rejected');
        else expect(decoded.value.data).toEqual(data);
        cases += 1;
      }
    }
    expect(cases).toBe(592);
  });

  it('reports the received-word evidence for no alarm, data repair, and overall-parity repair', () => {
    expect(decodeSecded([0, 1, 1, 0, 0, 1, 1, 0])).toEqual({
      ok: true,
      value: {
        data: [1, 0, 1, 1], word: [0, 1, 1, 0, 0, 1, 1, 0],
        syndrome: 0, overall: 0, decision: 'no-alarm', correctedPosition: null,
      },
    });
    expect(decodeSecded([0, 1, 0, 0, 0, 1, 1, 0])).toEqual({
      ok: true,
      value: {
        data: [1, 0, 1, 1], word: [0, 1, 1, 0, 0, 1, 1, 0],
        syndrome: 3, overall: 1, decision: 'corrected', correctedPosition: 3,
      },
    });
    expect(decodeSecded([0, 1, 1, 0, 0, 1, 1, 1])).toEqual({
      ok: true,
      value: {
        data: [1, 0, 1, 1], word: [0, 1, 1, 0, 0, 1, 1, 0],
        syndrome: 0, overall: 1, decision: 'corrected', correctedPosition: 8,
      },
    });
  });

  it('rejects wrong lengths, non-bits, and sparse arrays without coercing input', () => {
    const sparse = Array(4) as Bit[];
    sparse[0] = 1;
    expect(encodeSecded([1, 0, 1])).toEqual({ ok: false, error: 'invalid-secded-data' });
    expect(encodeSecded([1, 0, 2, 1] as Bits)).toEqual({ ok: false, error: 'invalid-secded-data' });
    expect(encodeSecded(sparse)).toEqual({ ok: false, error: 'invalid-secded-data' });
    expect(decodeSecded([0, 0, 0, 0, 0, 0, 0])).toEqual({ ok: false, error: 'invalid-secded-word' });
    expect(decodeSecded([0, 0, 0, 0, 0, 0, 0, 2] as Bits)).toEqual({ ok: false, error: 'invalid-secded-word' });
  });
});
