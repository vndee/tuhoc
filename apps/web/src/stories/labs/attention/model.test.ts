import { describe, expect, it } from 'vitest';
import { weightsForToken, type AttentionExample } from './model';

const example: AttentionExample = {
  id: 'bank-finance',
  tokens: {
    en: ['The', 'bank', 'approved', 'loans'],
    vi: ['Ngân', 'hàng', 'duyệt', 'vay'],
  },
  weights: {
    en: [[0.1, 0.7, 0.1, 0.1], [0.2, 0.3, 0.3, 0.2], [0.1, 0.4, 0.3, 0.2], [0.2, 0.3, 0.2, 0.3]],
    vi: [[0.2, 0.5, 0.2, 0.1], [0.1, 0.6, 0.2, 0.1], [0.2, 0.3, 0.3, 0.2], [0.2, 0.2, 0.3, 0.3]],
  },
};

describe('attention model', () => {
  it('returns a fresh configured attention row for a locale-matched token', () => {
    const row = weightsForToken(example, 'en', 1);
    expect(row).toEqual(example.weights.en[1]);
    expect(row).not.toBe(example.weights.en[1]);
  });

  it('reports an exact locale-specific bound when the token does not exist', () => {
    expect(() => weightsForToken(example, 'en', 99)).toThrow('Token index 99 is outside the 4-token English example');
  });

  it('rejects rows that do not match their own locale token count', () => {
    const malformed = structuredClone(example);
    malformed.weights.vi[0] = [0.5, 0.5];
    expect(() => weightsForToken(malformed, 'vi', 0)).toThrow('Vietnamese attention row 0 has 2 weights; expected 4.');
  });

  it('rejects non-finite configured weights', () => {
    const malformed = structuredClone(example);
    malformed.weights.en[2]![1] = Number.NaN;
    expect(() => weightsForToken(malformed, 'en', 2)).toThrow('English attention row 2 must contain only finite weights.');
  });
});
