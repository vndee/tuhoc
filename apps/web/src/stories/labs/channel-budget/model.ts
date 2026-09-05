import { toBits, toBytes } from '../communication/bits';
import { bsc } from '../communication/noise';
import { decodeRepeat3, encodeRepeat3 } from '../communication/repetition';
import { decodeSecded, encodeSecded } from '../communication/secded';
import type { Bit, Bits, Bytes, ChannelCode, Result, Transmission, TransmissionConfig } from '../communication/types';

const MAX_BYTES = 1024;
const MIN_BUDGET = 512;
const MAX_BUDGET = 32768;
const BUDGET_STEP = 512;

const codeParameters = {
  raw: { k: 1, n: 1 },
  repeat3: { k: 1, n: 3 },
  secded: { k: 4, n: 8 },
} as const;

function isChannelCode(code: unknown): code is ChannelCode {
  return code === 'raw' || code === 'repeat3' || code === 'secded';
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function isBytes(bytes: Bytes): boolean {
  if (!Array.isArray(bytes)) return false;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (!Object.hasOwn(bytes, index) || !Number.isInteger(byte) || byte! < 0 || byte! > 0xff) return false;
  }
  return true;
}

function isBudget(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_BUDGET && value <= MAX_BUDGET && value % BUDGET_STEP === 0;
}

function encode(bits: Bits, code: ChannelCode): Result<Bits> {
  if (code === 'raw') return { ok: true, value: [...bits] };
  if (code === 'repeat3') return { ok: true, value: encodeRepeat3(bits) };

  const encoded: Bit[] = [];
  for (let offset = 0; offset < bits.length; offset += 4) {
    const word = encodeSecded(bits.slice(offset, offset + 4));
    if (!word.ok) return word;
    encoded.push(...word.value);
  }
  return { ok: true, value: encoded };
}

function decode(bits: Bits, code: ChannelCode): Result<Bits | null> {
  if (code === 'raw') return { ok: true, value: [...bits] };
  if (code === 'repeat3') return decodeRepeat3(bits);

  const decoded: Bit[] = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    const word = decodeSecded(bits.slice(offset, offset + 8));
    if (!word.ok) return word;
    if (word.value.decision === 'rejected' || word.value.data === null) return { ok: true, value: null };
    decoded.push(...word.value.data);
  }
  return { ok: true, value: decoded };
}

function differenceCount(left: Bits, right: Bits): number {
  return left.reduce<number>((count, bit, index) => count + Number(bit !== right[index]), 0);
}

export function channelRequirement(bitCount: number, code: ChannelCode): {
  required: number;
  k: number;
  n: number;
  rate: number;
} {
  if (!Number.isSafeInteger(bitCount) || bitCount < 0) throw new RangeError('invalid-bit-count');
  if (!isChannelCode(code)) throw new RangeError('invalid-code');
  const { k, n } = codeParameters[code];
  return { required: Math.ceil(bitCount / k) * n, k, n, rate: k / n };
}

export function channelCapacity(p: number): Result<number> {
  if (!Number.isFinite(p) || p < 0 || p > 0.5) return { ok: false, error: 'invalid-probability' };
  if (p === 0) return { ok: true, value: 1 };
  if (p === 0.5) return { ok: true, value: 0 };
  const binaryEntropy = -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
  return { ok: true, value: 1 - binaryEntropy };
}

export function runTransmission(bytes: Bytes, config: TransmissionConfig): Result<Transmission> {
  if (!isBytes(bytes)) return { ok: false, error: 'invalid-byte' };
  if (bytes.length === 0) return { ok: false, error: 'empty' };
  if (bytes.length > MAX_BYTES) return { ok: false, error: 'byte-limit' };
  if (!isChannelCode(config.code)) return { ok: false, error: 'invalid-code' };
  if (!isBudget(config.budget)) return { ok: false, error: 'invalid-budget' };
  if (!Number.isFinite(config.p) || config.p < 0 || config.p > 0.5) {
    return { ok: false, error: 'invalid-probability' };
  }
  if (!isUint32(config.seed)) return { ok: false, error: 'invalid-seed' };

  const sourceBits = toBits(bytes);
  const requirement = channelRequirement(sourceBits.length, config.code);
  if (requirement.required > config.budget) return { ok: false, error: 'budget-exceeded' };

  const encoded = encode(sourceBits, config.code);
  if (!encoded.ok) return encoded;
  const noisy = bsc(encoded.value, config);
  const decoded = decode(noisy.bits, config.code);
  if (!decoded.ok) return decoded;

  const source = [...bytes];
  const capturedConfig = { ...config };
  if (decoded.value === null) {
    return {
      ok: true,
      value: {
        source,
        received: null,
        config: capturedConfig,
        required: requirement.required,
        outcome: 'rejected',
        flippedBits: noisy.flipped.length,
        payloadErrors: null,
      },
    };
  }

  const received = toBytes(decoded.value);
  if (!received.ok) return received;
  const payloadErrors = differenceCount(sourceBits, decoded.value);
  return {
    ok: true,
    value: {
      source,
      received: [...received.value],
      config: capturedConfig,
      required: requirement.required,
      outcome: payloadErrors === 0 ? 'exact' : 'silent-corruption',
      flippedBits: noisy.flipped.length,
      payloadErrors,
    },
  };
}
