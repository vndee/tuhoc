import { toBits, toBytes } from '../communication/bits';
import { bsc } from '../communication/noise';
import type { Bytes, NoiseConfig, Result } from '../communication/types';
import { decodeUtf8 } from '../communication/unicode';

export interface NoiseResult {
  received: Bytes;
  flipped: readonly number[];
  errors: number;
  ber: number;
  decoded: Result<string>;
  exact: boolean;
}

export type BinaryNoiseConfig = NoiseConfig & {
  mode: 'bsc' | 'manual';
  manual: readonly number[];
};

export function transmitNoisy(bytes: Bytes, config: NoiseConfig): Result<NoiseResult> {
  const inputError = validateBytes(bytes);
  if (inputError !== null) return { ok: false, error: inputError };
  if (!isNoiseConfig(config)) return { ok: false, error: 'invalid-config' };

  const sourceBits = toBits(bytes);
  const noisy = bsc(sourceBits, config);
  return resultFromBits(bytes, noisy.bits, noisy.flipped);
}

export function manualNoise(bytes: Bytes, indices: readonly number[]): Result<NoiseResult> {
  const inputError = validateBytes(bytes);
  if (inputError !== null) return { ok: false, error: inputError };
  if (!Array.isArray(indices)) return { ok: false, error: 'invalid-index' };

  const bitCount = bytes.length * 8;
  const selected = new Set<number>();
  for (const index of indices) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= bitCount) {
      return { ok: false, error: 'invalid-index' };
    }
    if (selected.has(index)) return { ok: false, error: 'duplicate-index' };
    selected.add(index);
  }

  const receivedBits = toBits(bytes).map((bit, index) => selected.has(index) ? (bit === 0 ? 1 : 0) : bit);
  return resultFromBits(bytes, receivedBits, [...selected]);
}

function resultFromBits(bytes: Bytes, receivedBits: readonly (0 | 1)[], flipped: readonly number[]): Result<NoiseResult> {
  const conversion = toBytes(receivedBits);
  if (!conversion.ok) return conversion;
  const received = conversion.value;
  const exact = received.length === bytes.length && received.every((byte, index) => byte === bytes[index]);

  return {
    ok: true,
    value: {
      received,
      flipped: [...flipped],
      errors: flipped.length,
      ber: flipped.length / receivedBits.length,
      decoded: decodeUtf8(received),
      exact,
    },
  };
}

function validateBytes(bytes: Bytes): string | null {
  if (!Array.isArray(bytes)) return 'invalid-byte';
  if (bytes.length === 0) return 'empty-input';
  for (const byte of bytes) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) return 'invalid-byte';
  }
  return null;
}

function isNoiseConfig(config: unknown): config is NoiseConfig {
  if (typeof config !== 'object' || config === null) return false;
  const candidate = config as Partial<NoiseConfig>;
  return Number.isFinite(candidate.p) && candidate.p! >= 0 && candidate.p! <= 0.5 &&
    Number.isInteger(candidate.seed) && candidate.seed! >= 0 && candidate.seed! <= 0xffff_ffff;
}
