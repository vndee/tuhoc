import { describe, expect, it } from 'vitest';
import {
  decodeRepeat3,
  encodeRepeat3,
  flipBurst,
  repeatErrorProbability,
} from './repetition';

describe('repetition primitives', () => {
  it('encodes every bit as three consecutive channel uses', () => {
    expect(encodeRepeat3([0, 1])).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it.each([
    [[1, 0, 0], [0]],
    [[1, 1, 0], [1]],
    [[1, 0, 1], [1]],
  ] as const)('decodes %j by majority vote', (encoded, decoded) => {
    expect(decodeRepeat3(encoded)).toEqual({ ok: true, value: decoded });
  });

  it('rejects malformed bits and non-triple lengths without padding', () => {
    const sparse = [0, 0, 0];
    delete sparse[1];
    expect(() => encodeRepeat3([0, 2] as never)).toThrowError(new RangeError('invalid-bit'));
    expect(decodeRepeat3([0, 1])).toEqual({ ok: false, error: 'invalid-repeat-length' });
    expect(decodeRepeat3(sparse as never)).toEqual({ ok: false, error: 'invalid-bit' });
  });

  it.each([
    [0, 0],
    [0.5, 0.5],
    [0.25, 0.15625],
  ])('computes the independent-channel decoded error probability for p=%s', (p, expected) => {
    expect(repeatErrorProbability(p)).toEqual({ ok: true, value: expected });
  });

  it.each([-0.01, 0.500_001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects probability outside the supported BSC range: %s',
    (p) => expect(repeatErrorProbability(p)).toEqual({ ok: false, error: 'invalid-probability' }),
  );

  it('flips one exact contiguous interval and permits a zero-length interval', () => {
    expect(flipBurst([0, 1, 0, 1], 1, 2)).toEqual({ ok: true, value: [0, 0, 1, 1] });
    expect(flipBurst([0, 1], 2, 0)).toEqual({ ok: true, value: [0, 1] });
  });

  it('supports the final bit of a supplied 3N stream rather than applying the shared N bound', () => {
    const encoded = encodeRepeat3([0, 1]);
    expect(flipBurst(encoded, 5, 1)).toEqual({ ok: true, value: [0, 0, 0, 1, 1, 0] });
  });

  it.each([
    [[0, 1], -1, 1, 'invalid-burst-start'],
    [[0, 1], 0.5, 1, 'invalid-burst-start'],
    [[0, 1], 0, -1, 'invalid-burst-length'],
    [[0, 1], 0, 1.5, 'invalid-burst-length'],
    [[0, 1], 1, 2, 'burst-out-of-range'],
  ] as const)('rejects an invalid burst interval %#', (bits, start, length, error) => {
    expect(flipBurst(bits, start, length)).toEqual({ ok: false, error });
  });
});
