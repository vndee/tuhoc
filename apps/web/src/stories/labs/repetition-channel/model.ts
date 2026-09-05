import { toBits, toBytes } from '../communication/bits';
import { bsc } from '../communication/noise';
import { decodeRepeat3, encodeRepeat3, flipBurst, repeatErrorProbability } from '../communication/repetition';
import type { Bits, Bytes, NoiseConfig, Result } from '../communication/types';

export type RepetitionConfig = NoiseConfig & {
  mode: 'bsc' | 'burst';
  start: number;
  length: number;
};

export type RepetitionComparison = {
  raw: { uses: number; errors: number; flips: number };
  repeat: { uses: number; errors: number; flips: number };
  received: Bytes;
  theoretical: number | null;
};

export type RepetitionTrace = {
  source: Bits;
  rawReceived: Bits;
  rawFlipped: readonly number[];
  encoded: Bits;
  repeatReceived: Bits;
  repeatFlipped: readonly number[];
  repeatDecoded: Bits;
};

function isBytes(bytes: Bytes): boolean {
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (!Object.hasOwn(bytes, index) || !Number.isInteger(byte) || byte! < 0 || byte! > 0xff) return false;
  }
  return true;
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function differenceCount(left: Bits, right: Bits): number {
  return left.reduce<number>((count, bit, index) => count + Number(bit !== right[index]), 0);
}

function changedIndices(left: Bits, right: Bits): number[] {
  const changed: number[] = [];
  left.forEach((bit, index) => {
    if (bit !== right[index]) changed.push(index);
  });
  return changed;
}

function validateConfig(config: RepetitionConfig, sourceLength: number): string | null {
  if (!Number.isFinite(config.p) || config.p < 0 || config.p > 0.5) return 'invalid-probability';
  if (!isUint32(config.seed)) return 'invalid-seed';
  if (config.mode !== 'bsc' && config.mode !== 'burst') return 'invalid-noise-mode';
  if (!Number.isSafeInteger(config.start) || config.start < 0) return 'invalid-burst-start';
  if (!Number.isSafeInteger(config.length) || config.length < 0) return 'invalid-burst-length';
  if (config.mode === 'burst' && (config.start > sourceLength || config.length > sourceLength - config.start)) {
    return 'burst-out-of-range';
  }
  return null;
}

/** Builds the two deterministic channel traces used by both comparison and its bounded UI view. */
export function buildRepetitionTrace(bytes: Bytes, config: RepetitionConfig): Result<RepetitionTrace> {
  if (!isBytes(bytes)) return { ok: false, error: 'invalid-byte' };
  const source = toBits(bytes);
  const invalid = validateConfig(config, source.length);
  if (invalid !== null) return { ok: false, error: invalid };
  const encoded = encodeRepeat3(source);

  let rawReceived: Bits;
  let repeatReceived: Bits;
  let rawFlipped: readonly number[];
  let repeatFlipped: readonly number[];
  if (config.mode === 'bsc') {
    const rawNoise = bsc(source, config);
    const repeatNoise = bsc(encoded, config);
    rawReceived = rawNoise.bits;
    repeatReceived = repeatNoise.bits;
    rawFlipped = rawNoise.flipped;
    repeatFlipped = repeatNoise.flipped;
  } else {
    const rawNoise = flipBurst(source, config.start, config.length);
    const repeatNoise = flipBurst(encoded, config.start, config.length);
    if (!rawNoise.ok) return rawNoise;
    if (!repeatNoise.ok) return repeatNoise;
    rawReceived = rawNoise.value;
    repeatReceived = repeatNoise.value;
    rawFlipped = changedIndices(source, rawReceived);
    repeatFlipped = changedIndices(encoded, repeatReceived);
  }

  const decoded = decodeRepeat3(repeatReceived);
  if (!decoded.ok) return decoded;
  return {
    ok: true,
    value: { source, rawReceived, rawFlipped, encoded, repeatReceived, repeatFlipped, repeatDecoded: decoded.value },
  };
}

export function compareRepetition(bytes: Bytes, config: RepetitionConfig): Result<RepetitionComparison> {
  const trace = buildRepetitionTrace(bytes, config);
  if (!trace.ok) return trace;
  const received = toBytes(trace.value.repeatDecoded);
  if (!received.ok) return received;
  const theoretical = config.mode === 'bsc' ? repeatErrorProbability(config.p) : { ok: true as const, value: null };
  if (!theoretical.ok) return theoretical;

  return {
    ok: true,
    value: {
      raw: {
        uses: trace.value.source.length,
        errors: differenceCount(trace.value.source, trace.value.rawReceived),
        flips: trace.value.rawFlipped.length,
      },
      repeat: {
        uses: trace.value.encoded.length,
        errors: differenceCount(trace.value.source, trace.value.repeatDecoded),
        flips: trace.value.repeatFlipped.length,
      },
      received: received.value,
      theoretical: theoretical.value,
    },
  };
}
