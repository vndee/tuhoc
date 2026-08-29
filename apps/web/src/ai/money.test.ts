import { describe, expect, it } from 'vitest';
import { MICRO_PER_CREDIT, formatCredits, parseCreditsToMicro } from './money';

describe('formatCredits', () => {
  it('divides by MICRO_PER_CREDIT and formats with the locale of `lang`', () => {
    expect(formatCredits(5_000_000, 'en')).toBe('5');
    expect(formatCredits(5_000_000, 'vi')).toBe('5');
  });

  // A fractional credit is where a locale's decimal separator actually
  // shows up — a whole number (the case above) cannot distinguish "en" from
  // "vi" at all, since neither uses a separator for it.
  it('en uses a dot, vi uses a comma, for the SAME underlying value', () => {
    expect(formatCredits(1_500_000, 'en')).toBe('1.5');
    expect(formatCredits(1_500_000, 'vi')).toBe('1,5');
  });

  it('caps at 4 fraction digits rather than printing a long repeating decimal', () => {
    // 1 micro-credit = 0.000001 credit, which is exactly 4dp-representable
    // as 0.0000 (rounds to 0) — chosen to prove the CAP is honored, not
    // that this specific tiny value round-trips readably.
    expect(formatCredits(1, 'en')).toBe('0');
  });
});

describe('parseCreditsToMicro', () => {
  it('parses a whole number of credits into whole micro-credits', () => {
    expect(parseCreditsToMicro('50')).toBe(50 * MICRO_PER_CREDIT);
  });

  it('parses a decimal amount with a dot', () => {
    expect(parseCreditsToMicro('12.5')).toBe(12_500_000);
  });

  it('parses a decimal amount with a comma (vi-VN keyboard input)', () => {
    expect(parseCreditsToMicro('12,5')).toBe(12_500_000);
  });

  it('rounds to the nearest whole micro-credit rather than truncating', () => {
    // 0.0000015 credit = 1.5 micro-credit — rounds to 2, not 1.
    expect(parseCreditsToMicro('0.0000015')).toBe(2);
  });

  it('trims surrounding whitespace', () => {
    expect(parseCreditsToMicro('  7  ')).toBe(7 * MICRO_PER_CREDIT);
  });

  // Boundary: the SMALLEST legal positive input (one micro-credit) must
  // parse; exactly zero, and anything negative, must not.
  it('the smallest positive amount (one micro-credit) parses', () => {
    expect(parseCreditsToMicro('0.000001')).toBe(1);
  });

  it('rejects zero — a no-op amount, not a legitimate adjustment magnitude', () => {
    expect(parseCreditsToMicro('0')).toBeNull();
  });

  it('rejects a negative amount — direction is a separate control, never a typed minus sign', () => {
    expect(parseCreditsToMicro('-5')).toBeNull();
  });

  it('rejects an empty or whitespace-only string', () => {
    expect(parseCreditsToMicro('')).toBeNull();
    expect(parseCreditsToMicro('   ')).toBeNull();
  });

  it('rejects non-numeric text', () => {
    expect(parseCreditsToMicro('abc')).toBeNull();
    expect(parseCreditsToMicro('5abc')).toBeNull();
  });

  it('rejects Infinity/NaN-shaped input', () => {
    expect(parseCreditsToMicro('Infinity')).toBeNull();
    expect(parseCreditsToMicro('NaN')).toBeNull();
  });
});
