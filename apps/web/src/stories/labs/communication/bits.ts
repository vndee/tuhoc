import type { Bit, Bits, Bytes, Result } from './types';

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xff;
}

function isBit(value: number): value is Bit {
  return value === 0 || value === 1;
}

function hasOnlyBytes(bytes: Bytes): boolean {
  for (const byte of bytes) {
    if (!isByte(byte)) return false;
  }
  return true;
}

function hasOnlyBits(bits: Bits): boolean {
  for (const bit of bits) {
    if (!isBit(bit)) return false;
  }
  return true;
}

export function toBits(bytes: Bytes): Bit[] {
  if (!hasOnlyBytes(bytes)) throw new RangeError('invalid-byte');

  const bits: Bit[] = [];
  for (const byte of bytes) {
    for (let shift = 7; shift >= 0; shift -= 1) {
      bits.push(((byte >>> shift) & 1) as Bit);
    }
  }
  return bits;
}

export function toBytes(bits: Bits): Result<Bytes> {
  if (!hasOnlyBits(bits)) return { ok: false, error: 'invalid-bit' };
  if (bits.length % 8 !== 0) return { ok: false, error: 'unaligned' };

  const bytes: number[] = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    let byte = 0;
    for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
      byte = (byte << 1) | bits[offset + bitIndex]!;
    }
    bytes.push(byte);
  }
  return { ok: true, value: bytes };
}
