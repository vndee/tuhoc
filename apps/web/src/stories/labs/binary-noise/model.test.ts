import { describe, expect, it, vi } from 'vitest';
import { manualNoise, transmitNoisy } from './model';

describe('binary-noise model', () => {
  it('keeps a UTF-8 message byte-exact when the BSC probability is zero', () => {
    expect(transmitNoisy([0xc3, 0xa9], { p: 0, seed: 20260905 })).toMatchObject({
      ok: true,
      value: {
        received: [0xc3, 0xa9],
        flipped: [],
        exact: true,
        errors: 0,
        ber: 0,
        decoded: { ok: true, value: 'é' },
      },
    });
  });

  it('uses the actual changed-bit count for BER and replays a seed exactly', () => {
    const first = transmitNoisy([0x00, 0xff], { p: 0.3, seed: 20260905 });
    const replay = transmitNoisy([0x00, 0xff], { p: 0.3, seed: 20260905 });

    expect(first).toEqual(replay);
    expect(first).toEqual({
      ok: true,
      value: {
        received: [0x20, 0xfe],
        flipped: [2, 15],
        errors: 2,
        ber: 0.125,
        decoded: { ok: false, error: 'invalid-byte' },
        exact: false,
      },
    });
  });

  it('keeps BSC flip sets nested as p increases with the same seed', () => {
    const low = transmitNoisy([0x00, 0x00], { p: 0.1, seed: 20260905 });
    const high = transmitNoisy([0x00, 0x00], { p: 0.3, seed: 20260905 });

    expect(low.ok && high.ok && low.value.flipped.every((index) => high.value.flipped.includes(index))).toBe(true);
  });

  it('reports a strict UTF-8 failure while retaining the manually changed byte', () => {
    expect(manualNoise([0x41], [0])).toEqual({
      ok: true,
      value: {
        received: [0xc1],
        flipped: [0],
        errors: 1,
        ber: 0.125,
        decoded: { ok: false, error: 'invalid-byte' },
        exact: false,
      },
    });
  });

  it('returns an exact independent copy when the manual flip set is empty', () => {
    const source = [0x41];
    const result = manualNoise(source, []);

    expect(result).toMatchObject({ ok: true, value: { received: [0x41], flipped: [], exact: true } });
    expect(result.ok && result.value.received).not.toBe(source);
  });

  it.each([
    { bytes: [256], indices: [], error: 'invalid-byte' },
    { bytes: Array<number>(1), indices: [], error: 'invalid-byte' },
    { bytes: [], indices: [], error: 'empty-input' },
    { bytes: [0x41], indices: [-1], error: 'invalid-index' },
    { bytes: [0x41], indices: [8], error: 'invalid-index' },
    { bytes: [0x41], indices: [0.5], error: 'invalid-index' },
    { bytes: [0x41], indices: Array<number>(1), error: 'invalid-index' },
    { bytes: [0x41], indices: [0, 0], error: 'duplicate-index' },
  ])('rejects malformed manual input with a fixed content-free code: $error', ({ bytes, indices, error }) => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(manualNoise(bytes, indices)).toEqual({ ok: false, error });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it.each([
    { bytes: [256], config: { p: 0, seed: 0 }, error: 'invalid-byte' },
    { bytes: [], config: { p: 0, seed: 0 }, error: 'empty-input' },
    { bytes: [0], config: { p: 0.51, seed: 0 }, error: 'invalid-config' },
    { bytes: [0], config: { p: 0, seed: -1 }, error: 'invalid-config' },
  ])('maps invalid BSC inputs to Result errors: $error', ({ bytes, config, error }) => {
    expect(transmitNoisy(bytes, config)).toEqual({ ok: false, error });
  });
});
