import { decodeSecded, encodeSecded, type SecdedResult } from '../communication/secded';
import type { Bit, Bits, Result } from '../communication/types';

export type SecdedInspection = {
  sent: Bits;
  received: Bits;
  decoded: SecdedResult;
  exact: boolean;
};

function validateFlips(flips: readonly number[]): string | null {
  const seen = new Set<number>();
  for (let index = 0; index < flips.length; index += 1) {
    const position = flips[index];
    if (!Object.hasOwn(flips, index) || !Number.isSafeInteger(position) || position! < 0 || position! >= 8) {
      return 'invalid-flip-index';
    }
    if (seen.has(position!)) return 'duplicate-flip-index';
    seen.add(position!);
  }
  return null;
}

/** Runs a controlled SECDED example; exactness is simulator evidence, never decoder input. */
export function inspectSecded(data: Bits, flips: readonly number[]): Result<SecdedInspection> {
  const encoded = encodeSecded(data);
  if (!encoded.ok) return encoded;
  if (!Array.isArray(flips)) return { ok: false, error: 'invalid-flip-index' };
  const invalidFlips = validateFlips(flips);
  if (invalidFlips !== null) return { ok: false, error: invalidFlips };

  const received = encoded.value.map((bit, index) => (flips.includes(index) ? 1 - bit : bit) as Bit);
  const decoded = decodeSecded(received);
  if (!decoded.ok) return decoded;
  const exact = decoded.value.data !== null &&
    decoded.value.data.every((bit, index) => bit === data[index]);

  return {
    ok: true,
    value: {
      sent: [...encoded.value],
      received: [...received],
      decoded: {
        ...decoded.value,
        data: decoded.value.data === null ? null : [...decoded.value.data],
        word: [...decoded.value.word],
      },
      exact,
    },
  };
}

export type { SecdedResult };
