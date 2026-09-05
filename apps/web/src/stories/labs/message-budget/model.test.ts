import { describe, expect, it } from 'vitest';
import { compareDraft } from './model';

describe('compareDraft', () => {
  it('counts extended grapheme clusters rather than UTF-16 code units', () => {
    expect(compareDraft('👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦', 15)).toMatchObject({
      ok: true,
      value: { originalGraphemes: 1, shortenedGraphemes: 1, over: 0 },
    });
    expect(compareDraft('Một câu', 'Một', 15)).toMatchObject({
      ok: true,
      value: { shortenedGraphemes: 3 },
    });
  });

  it('counts exact UTF-8 bytes without normalizing visually equivalent text', () => {
    expect(compareDraft('ắ', 'a\u0306\u0301', 15)).toEqual({
      ok: true,
      value: {
        originalGraphemes: 1,
        shortenedGraphemes: 1,
        originalBytes: 3,
        shortenedBytes: 5,
        over: 0,
      },
    });
  });

  it('allows an empty shortened draft while requiring a valid original', () => {
    expect(compareDraft('Original', '', 15)).toMatchObject({
      ok: true,
      value: { shortenedGraphemes: 0, shortenedBytes: 0, over: 0 },
    });
    expect(compareDraft('', '', 15)).toEqual({ ok: false, error: 'empty' });
  });

  it('retains newlines and reports all pasted text beyond the selected budget', () => {
    const shortened = `first line\n${'x'.repeat(61)}`;
    expect(compareDraft('Original', shortened, 60)).toEqual({
      ok: true,
      value: {
        originalGraphemes: 8,
        shortenedGraphemes: 72,
        originalBytes: 8,
        shortenedBytes: 72,
        over: 12,
      },
    });
  });

  it('rejects unsupported budgets and ill-formed shortened Unicode with fixed codes', () => {
    expect(compareDraft('Original', 'Short', 31 as 30)).toEqual({ ok: false, error: 'invalid-budget' });
    expect(compareDraft('Original', '\ud800', 30)).toEqual({ ok: false, error: 'ill-formed' });
  });
});
