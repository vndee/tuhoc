import { describe, expect, it } from 'vitest';
import { morseTimeline, readMorse } from './model';

describe('morse-spacing model', () => {
  it.each(['ET', 'AET', 'BEAM', 'BEAM ET'] as const)('round-trips the controlled example %s with standard spacing', (text) => {
    const timeline = morseTimeline(text, 3, 7);
    if (!timeline.ok) throw new Error(timeline.error);

    expect(readMorse(timeline.value)).toEqual({ ok: true, value: text });
  });

  it('changes ET into A when only its letter gap is shortened', () => {
    const standard = morseTimeline('ET', 3, 7);
    const joined = morseTimeline('ET', 1, 7);
    if (!standard.ok) throw new Error(standard.error);
    if (!joined.ok) throw new Error(joined.error);

    expect(readMorse(joined.value)).toEqual({ ok: true, value: 'A' });
    expect(joined.value.filter(({ kind }) => kind === 'mark')).toEqual(
      standard.value.filter(({ kind }) => kind === 'mark'),
    );
  });

  it('uses the declared decoder thresholds independently of standard ITU timings', () => {
    const letterBoundary = morseTimeline('ET', 2, 5);
    const wordBoundary = morseTimeline('BEAM ET', 3, 5);
    const noWordBoundary = morseTimeline('BEAM ET', 3, 4);
    if (!letterBoundary.ok) throw new Error(letterBoundary.error);
    if (!wordBoundary.ok) throw new Error(wordBoundary.error);
    if (!noWordBoundary.ok) throw new Error(noWordBoundary.error);

    expect(readMorse(letterBoundary.value)).toEqual({ ok: true, value: 'ET' });
    expect(readMorse(wordBoundary.value)).toEqual({ ok: true, value: 'BEAM ET' });
    expect(readMorse(noWordBoundary.value)).toEqual({ ok: true, value: 'BEAMET' });
  });

  it.each([
    ['...-', 'V'],
    ['--.-', 'Q'],
    ['.----', '1'],
    ['-----', '0'],
  ])('reads the International Morse reverse mapping %s as %s', (marks, letter) => {
    const segments = [...marks].flatMap((mark, index) => [
      ...(index === 0 ? [] : [{ kind: 'gap' as const, duration: 1 }]),
      { kind: 'mark' as const, duration: mark === '.' ? 1 : 3 },
    ]);

    expect(readMorse(segments)).toEqual({ ok: true, value: letter });
  });

  it.each([
    ['?', 3, 7, 'unsupported-character'],
    ['et', 3, 7, 'unsupported-character'],
    ['ET', 0, 7, 'invalid-letter-gap'],
    ['ET', 8, 7, 'invalid-letter-gap'],
    ['ET', 1.5, 7, 'invalid-letter-gap'],
    ['ET', 3, 0, 'invalid-word-gap'],
    ['ET', 3, 10, 'invalid-word-gap'],
    ['ET', 3, Number.NaN, 'invalid-word-gap'],
  ])('rejects unsupported timeline input without echoing it', (text, letterGap, wordGap, error) => {
    expect(morseTimeline(text, letterGap, wordGap)).toEqual({ ok: false, error });
  });

  it('returns unknown-code rather than inventing a character', () => {
    expect(readMorse([
      { kind: 'mark', duration: 1 },
      { kind: 'gap', duration: 1 },
      { kind: 'mark', duration: 3 },
      { kind: 'gap', duration: 1 },
      { kind: 'mark', duration: 3 },
      { kind: 'gap', duration: 1 },
      { kind: 'mark', duration: 3 },
      { kind: 'gap', duration: 1 },
      { kind: 'mark', duration: 3 },
      { kind: 'gap', duration: 1 },
      { kind: 'mark', duration: 3 },
    ])).toEqual({ ok: false, error: 'unknown-code' });
  });

  it('rejects malformed segment arrays', () => {
    const malformed = [
      [],
      [{ kind: 'gap', duration: 1 }],
      [{ kind: 'mark', duration: 2 }],
      [{ kind: 'mark', duration: 1 }, { kind: 'mark', duration: 3 }],
      [{ kind: 'mark', duration: 1 }, { kind: 'gap', duration: 0 }, { kind: 'mark', duration: 3 }],
    ];

    for (const segments of malformed) {
      expect(readMorse(segments as never)).toEqual({ ok: false, error: 'invalid-segments' });
    }
  });
});
