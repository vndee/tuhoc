import { uniforms } from './random';
import type { Bit, Bits, NoiseConfig } from './types';

function isBit(value: number): value is Bit {
  return value === 0 || value === 1;
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

export function bsc(bits: Bits, config: NoiseConfig): { bits: Bits; flipped: number[] } {
  if (!Number.isFinite(config.p) || config.p < 0 || config.p > 0.5) {
    throw new RangeError('invalid-probability');
  }
  if (!isUint32(config.seed)) throw new RangeError('invalid-seed');
  if (!bits.every(isBit)) throw new RangeError('invalid-bit');

  const draws = uniforms(config.seed, bits.length);
  const output: Bit[] = [];
  const flipped: number[] = [];
  bits.forEach((bit, index) => {
    if (draws[index]! < config.p) {
      output.push(bit === 0 ? 1 : 0);
      flipped.push(index);
    } else {
      output.push(bit);
    }
  });

  return { bits: output, flipped };
}
