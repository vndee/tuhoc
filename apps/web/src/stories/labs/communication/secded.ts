import type { Bit, Bits, Result } from './types';

export type SecdedResult = {
  data: Bits | null;
  word: Bits;
  syndrome: number;
  overall: Bit;
  decision: 'no-alarm' | 'corrected' | 'rejected';
  correctedPosition: number | null;
};

const isBitsOfLength = (bits: Bits, length: number): boolean => {
  if (!Array.isArray(bits) || bits.length !== length) return false;
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(bits, index) || (bits[index] !== 0 && bits[index] !== 1)) return false;
  }
  return true;
};

const xorAt = (word: Bits, positions: readonly number[]): Bit =>
  positions.reduce<Bit>((parity, position) => (parity ^ word[position - 1]!) as Bit, 0);

const extractData = (word: Bits): Bits => [word[2]!, word[4]!, word[5]!, word[6]!];

/** Encodes four data bits as p1,p2,d1,p4,d2,d3,d4,p0 with even parity. */
export function encodeSecded(data: Bits): Result<Bits> {
  if (!isBitsOfLength(data, 4)) return { ok: false, error: 'invalid-secded-data' };
  const [d1, d2, d3, d4] = data;
  const p1 = (d1! ^ d2! ^ d4!) as Bit;
  const p2 = (d1! ^ d3! ^ d4!) as Bit;
  const p4 = (d2! ^ d3! ^ d4!) as Bit;
  const firstSeven: Bit[] = [p1, p2, d1!, p4, d2!, d3!, d4!];
  const p0 = firstSeven.reduce<Bit>((parity, bit) => (parity ^ bit) as Bit, 0);
  return { ok: true, value: [...firstSeven, p0] };
}

/** Decodes only the received eight-bit word; no original payload is consulted. */
export function decodeSecded(word: Bits): Result<SecdedResult> {
  if (!isBitsOfLength(word, 8)) return { ok: false, error: 'invalid-secded-word' };
  const received = [...word] as Bit[];
  const syndrome =
    (xorAt(received, [1, 3, 5, 7]) ? 1 : 0) +
    (xorAt(received, [2, 3, 6, 7]) ? 2 : 0) +
    (xorAt(received, [4, 5, 6, 7]) ? 4 : 0);
  const overall = received.reduce<Bit>((parity, bit) => (parity ^ bit) as Bit, 0);

  if (syndrome !== 0 && overall === 0) {
    return {
      ok: true,
      value: { data: null, word: received, syndrome, overall, decision: 'rejected', correctedPosition: null },
    };
  }

  const correctedPosition = overall === 1 ? (syndrome === 0 ? 8 : syndrome) : null;
  if (correctedPosition !== null) received[correctedPosition - 1] = (1 - received[correctedPosition - 1]!) as Bit;
  return {
    ok: true,
    value: {
      data: extractData(received),
      word: received,
      syndrome,
      overall,
      decision: correctedPosition === null ? 'no-alarm' : 'corrected',
      correctedPosition,
    },
  };
}
