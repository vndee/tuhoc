import type { Bit, Bits, Result } from './types';

function isBits(value: Bits): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || (value[index] !== 0 && value[index] !== 1)) return false;
  }
  return true;
}

export function encodeRepeat3(bits: Bits): Bits {
  if (!isBits(bits)) throw new RangeError('invalid-bit');
  return bits.flatMap((bit) => [bit, bit, bit]);
}

export function decodeRepeat3(bits: Bits): Result<Bits> {
  if (!isBits(bits)) return { ok: false, error: 'invalid-bit' };
  if (bits.length % 3 !== 0) return { ok: false, error: 'invalid-repeat-length' };

  const decoded: Bit[] = [];
  for (let offset = 0; offset < bits.length; offset += 3) {
    decoded.push((bits[offset]! + bits[offset + 1]! + bits[offset + 2]! >= 2 ? 1 : 0));
  }
  return { ok: true, value: decoded };
}

export function repeatErrorProbability(p: number): Result<number> {
  if (!Number.isFinite(p) || p < 0 || p > 0.5) {
    return { ok: false, error: 'invalid-probability' };
  }
  return { ok: true, value: 3 * p * p - 2 * p * p * p };
}

export function flipBurst(bits: Bits, start: number, length: number): Result<Bits> {
  if (!isBits(bits)) return { ok: false, error: 'invalid-bit' };
  if (!Number.isSafeInteger(start) || start < 0) return { ok: false, error: 'invalid-burst-start' };
  if (!Number.isSafeInteger(length) || length < 0) return { ok: false, error: 'invalid-burst-length' };
  if (start > bits.length || length > bits.length - start) {
    return { ok: false, error: 'burst-out-of-range' };
  }

  const end = start + length;
  return {
    ok: true,
    value: bits.map((bit, index) => index >= start && index < end ? (bit === 0 ? 1 : 0) : bit),
  };
}
