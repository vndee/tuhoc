import { describe, expect, it } from 'vitest';
import { compareRepetition } from './model';

describe('repetition-channel model', () => {
  it('round-trips exactly at p=0 and accounts for N versus 3N channel uses', () => {
    expect(compareRepetition([0x41], {
      p: 0, seed: 20260905, mode: 'bsc', start: 0, length: 1,
    })).toEqual({
      ok: true,
      value: {
        raw: { uses: 8, errors: 0, flips: 0 },
        repeat: { uses: 24, errors: 0, flips: 0 },
        received: [0x41],
        theoretical: 0,
      },
    });
  });

  it('uses one shared burst interval while majority voting can turn two adjacent flips into one payload error', () => {
    expect(compareRepetition([0], {
      p: 0.05, seed: 20260905, mode: 'burst', start: 1, length: 2,
    })).toEqual({
      ok: true,
      value: {
        raw: { uses: 8, errors: 2, flips: 2 },
        repeat: { uses: 24, errors: 1, flips: 2 },
        received: [0x80],
        theoretical: null,
      },
    });
  });

  it('does not claim equal flip counts for equal-seed BSC streams of different lengths', () => {
    const result = compareRepetition([0, 255], {
      p: 0.25, seed: 20260905, mode: 'bsc', start: 0, length: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.raw.flips).toBe(1);
    expect(result.value.repeat.flips).toBe(8);
  });

  it('rejects a shared burst interval past N even though it would fit the 3N stream', () => {
    expect(compareRepetition([0], {
      p: 0, seed: 0, mode: 'burst', start: 8, length: 1,
    })).toEqual({ ok: false, error: 'burst-out-of-range' });
  });

  it.each([
    { bytes: [256], config: { p: 0, seed: 0, mode: 'bsc', start: 0, length: 0 }, error: 'invalid-byte' },
    { bytes: [0], config: { p: 0.51, seed: 0, mode: 'bsc', start: 0, length: 0 }, error: 'invalid-probability' },
    { bytes: [0], config: { p: 0, seed: -1, mode: 'bsc', start: 0, length: 0 }, error: 'invalid-seed' },
    { bytes: [0], config: { p: 0, seed: 0, mode: 'burst', start: -1, length: 0 }, error: 'invalid-burst-start' },
    { bytes: [0], config: { p: 0, seed: 0, mode: 'burst', start: 0, length: -1 }, error: 'invalid-burst-length' },
  ])('maps invalid public input to $error', ({ bytes, config, error }) => {
    expect(compareRepetition(bytes, config as Parameters<typeof compareRepetition>[1]))
      .toEqual({ ok: false, error });
  });

  it('rejects sparse byte input', () => {
    const bytes = [0];
    delete bytes[0];
    expect(compareRepetition(bytes, {
      p: 0, seed: 0, mode: 'bsc', start: 0, length: 0,
    })).toEqual({ ok: false, error: 'invalid-byte' });
  });
});
