import { describe, expect, it } from 'vitest';
import type { Bit } from './types';
import { toBits, toBytes } from './bits';

describe('toBits', () => {
  it('expands bytes most-significant bit first', () => {
    expect(toBits([0, 255, 128])).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0,
      1, 1, 1, 1, 1, 1, 1, 1,
      1, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it.each([-1, 256, 1.5, Number.NaN])('throws a content-free code for invalid bytes: %s', (byte) => {
    expect(() => toBits([byte])).toThrow(new RangeError('invalid-byte'));
  });

  it('rejects sparse byte arrays instead of encoding holes as zero bytes', () => {
    expect(() => toBits(Array<number>(1))).toThrow(new RangeError('invalid-byte'));
  });
});

describe('toBytes', () => {
  it('round-trips every byte value', () => {
    const bytes = Array.from({ length: 256 }, (_, value) => value);

    expect(toBytes(toBits(bytes))).toEqual({ ok: true, value: bytes });
  });

  it('rejects rather than pads non-byte-aligned bits', () => {
    expect(toBytes([1, 0, 1])).toEqual({ ok: false, error: 'unaligned' });
  });

  it('rejects a value outside the bit domain', () => {
    expect(toBytes([0, 2, 1] as unknown as readonly Bit[])).toEqual({ ok: false, error: 'invalid-bit' });
  });

  it('rejects sparse bit arrays instead of decoding holes as zero bits', () => {
    expect(toBytes(Array<Bit>(8))).toEqual({ ok: false, error: 'invalid-bit' });
  });
});
