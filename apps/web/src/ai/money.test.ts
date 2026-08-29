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

  // round-2 review, Minor 4.
  it('rejects scientific notation, consistent with the sibling gate parseNonNegativeInt applies on the pricing form', () => {
    expect(parseCreditsToMicro('1e3')).toBeNull();
    expect(parseCreditsToMicro('1E3')).toBeNull();
  });

  it('rejects an amount whose micro-credit value cannot be represented as a safe integer', () => {
    // A finite, exponent-free, all-digit number the regex alone would let
    // through — the Number.isSafeInteger backstop on the COMPUTED micro
    // value is what has to catch this one, not the regex.
    expect(parseCreditsToMicro('9'.repeat(30))).toBeNull();
  });

  it('rejects an amount whose *600 000-fold ceiling before this fix* (1e30 credits) would have serialized as invalid JSON', () => {
    // The exact shape round-2 review measured: 1e30 -> *1e6 -> 1e36 ->
    // JSON.stringify renders "1e+36" -> Go's encoding/json rejects the
    // whole request body. The regex rejects the exponent syntax outright,
    // so this never reaches Number() at all.
    expect(parseCreditsToMicro('1e30')).toBeNull();
  });

  // round-2 review, N-5c: the '9'.repeat(30) case above does NOT prove
  // Number.isSafeInteger runs on the CONVERTED micro value rather than on
  // the typed credit value — 9e29 is already unsafe before any
  // multiplication, so a version of this function that checked `value`
  // BEFORE multiplying by MICRO_PER_CREDIT would reject it too, for the
  // wrong reason, and this test file would not be able to tell the two
  // implementations apart. This case is chosen SPECIFICALLY to fail that
  // way: 10^15 (1 followed by 15 zeros) is itself a SAFE integer —
  // comfortably under Number.MAX_SAFE_INTEGER (~9.007e15) — so a
  // pre-multiplication check would let it through. Only AFTER multiplying
  // by MICRO_PER_CREDIT does it become 10^21, far past safe range, and
  // only a check running on THAT value catches it. A cross-check with the
  // implementation is below (money.ts inline comment) — if this position
  // ever regresses to checking the pre-multiplication value, this is the
  // one test in the file built to notice.
  it('rejects an amount that is a SAFE integer as typed but becomes UNSAFE only after the x1,000,000 conversion', () => {
    const safeBeforeMultiply = `1${'0'.repeat(15)}`; // 10^15
    expect(Number.isSafeInteger(Number(safeBeforeMultiply))).toBe(true); // sanity: this IS safe pre-multiplication
    expect(parseCreditsToMicro(safeBeforeMultiply)).toBeNull();
  });
});
