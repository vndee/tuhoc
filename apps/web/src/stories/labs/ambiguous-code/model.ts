import type { Codebook, Result, SymbolId } from '../communication/types';

export interface DecodeSummary {
  count: string;
  readings: string[];
  truncated: boolean;
}

export const SYMBOL_IDS: readonly SymbolId[] = ['A', 'B', 'C', 'D'];
const BINARY_CODEWORD = /^[01]{1,6}$/;
const SOURCE_SYMBOLS = /^[ABCD]{1,6}$/;
const BINARY_BITS = /^[01]*$/;
const READING_LIMIT = 32;

export function isValidCodebook(book: Codebook): boolean {
  return typeof book === 'object' && book !== null &&
    SYMBOL_IDS.every((symbol) => typeof book[symbol] === 'string' && BINARY_CODEWORD.test(book[symbol]));
}

export function isValidSourceSymbols(symbols: string): boolean {
  return typeof symbols === 'string' && SOURCE_SYMBOLS.test(symbols);
}

export function encodeSymbols(symbols: string, book: Codebook): Result<string> {
  if (!isValidCodebook(book)) return { ok: false, error: 'invalid-codebook' };
  if (!isValidSourceSymbols(symbols)) return { ok: false, error: 'invalid-symbols' };

  return { ok: true, value: [...symbols].map((symbol) => book[symbol as SymbolId]).join('') };
}

export function decodePaths(bits: string, book: Codebook): Result<DecodeSummary> {
  if (!isValidCodebook(book)) return { ok: false, error: 'invalid-codebook' };
  if (typeof bits !== 'string' || !BINARY_BITS.test(bits)) return { ok: false, error: 'invalid-bits' };
  if (bits.length > 36) return { ok: false, error: 'bit-limit' };

  const ways = Array<bigint>(bits.length + 1).fill(0n);
  ways[bits.length] = 1n;
  for (let offset = bits.length - 1; offset >= 0; offset -= 1) {
    for (const symbol of SYMBOL_IDS) {
      const code = book[symbol];
      if (bits.startsWith(code, offset)) ways[offset] += ways[offset + code.length]!;
    }
  }

  const readings: string[] = [];
  const enumerate = (offset: number, reading: string) => {
    if (readings.length >= READING_LIMIT) return;
    if (offset === bits.length) {
      readings.push(reading);
      return;
    }
    for (const symbol of SYMBOL_IDS) {
      const code = book[symbol];
      const next = offset + code.length;
      if (bits.startsWith(code, offset) && ways[next]! > 0n) enumerate(next, `${reading}${symbol}`);
      if (readings.length >= READING_LIMIT) return;
    }
  };
  enumerate(0, '');

  return {
    ok: true,
    value: {
      count: ways[0]!.toString(),
      readings,
      truncated: ways[0]! > BigInt(readings.length),
    },
  };
}
