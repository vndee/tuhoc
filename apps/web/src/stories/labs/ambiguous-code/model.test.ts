import { describe, expect, it } from 'vitest';
import type { Codebook } from '../communication/types';
import { decodePaths, encodeSymbols } from './model';

const ambiguousBook: Codebook = { A: '0', B: '01', C: '1', D: '11' };

describe('ambiguous-code model', () => {
  it('enumerates every valid A/B/C/D reading in symbol order', () => {
    expect(decodePaths('01', ambiguousBook)).toEqual({
      ok: true,
      value: { count: '2', readings: ['AC', 'B'], truncated: false },
    });
  });

  it('returns zero readings when no segmentation consumes the bitstream', () => {
    expect(decodePaths('1', { A: '00', B: '01', C: '00', D: '01' })).toMatchObject({
      ok: true,
      value: { count: '0', readings: [], truncated: false },
    });
  });

  it('does not mistake a prefix collision for ambiguity in every signal', () => {
    expect(decodePaths('0', ambiguousBook)).toEqual({
      ok: true,
      value: { count: '1', readings: ['A'], truncated: false },
    });
  });

  it('counts past the 32-reading render cap without rounding', () => {
    expect(decodePaths('000000', { A: '0', B: '0', C: '0', D: '0' })).toEqual({
      ok: true,
      value: { count: '4096', readings: expect.any(Array), truncated: true },
    });
    const result = decodePaths('0'.repeat(36), { A: '0', B: '0', C: '0', D: '0' });
    expect(result).toMatchObject({
      ok: true,
      value: { count: (4n ** 36n).toString(), truncated: true },
    });
    expect(result.ok && result.value.readings).toHaveLength(32);
  });

  it.each([
    [{ A: '', B: '01', C: '1', D: '11' }, 'invalid-codebook'],
    [{ A: '2', B: '01', C: '1', D: '11' }, 'invalid-codebook'],
    [{ A: '0000000', B: '01', C: '1', D: '11' }, 'invalid-codebook'],
  ])('rejects an invalid codeword without echoing it', (book, error) => {
    expect(decodePaths('01', book as Codebook)).toEqual({ ok: false, error });
    expect(encodeSymbols('B', book as Codebook)).toEqual({ ok: false, error });
  });

  it.each([null, { A: '0', B: '01', C: '1' }])('returns an error for a malformed runtime codebook: %j', (book) => {
    expect(decodePaths('01', book as unknown as Codebook)).toEqual({ ok: false, error: 'invalid-codebook' });
    expect(encodeSymbols('B', book as unknown as Codebook)).toEqual({ ok: false, error: 'invalid-codebook' });
  });

  it.each([
    ['', 'invalid-symbols'],
    ['ABX', 'invalid-symbols'],
    ['AAAAAAA', 'invalid-symbols'],
  ])('rejects invalid source symbols without echoing them: %j', (symbols, error) => {
    expect(encodeSymbols(symbols, ambiguousBook)).toEqual({ ok: false, error });
  });

  it.each([
    ['012', 'invalid-bits'],
    ['0'.repeat(37), 'bit-limit'],
  ])('rejects invalid externally supplied bits without echoing them', (bits, error) => {
    expect(decodePaths(bits, ambiguousBook)).toEqual({ ok: false, error });
  });

  it('encodes source symbols by concatenating their codewords', () => {
    expect(encodeSymbols('ABCD', ambiguousBook)).toEqual({ ok: true, value: '001111' });
  });
});
