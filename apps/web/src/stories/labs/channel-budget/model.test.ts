import { describe, expect, it } from 'vitest';
import { channelCapacity, channelRequirement, runTransmission } from './model';

describe('channel-budget model', () => {
  it('accounts for complete codewords at the minimum configured budget boundary', () => {
    expect(channelRequirement(512, 'raw')).toEqual({ required: 512, k: 1, n: 1, rate: 1 });
    expect(channelRequirement(512, 'repeat3')).toEqual({ required: 1536, k: 1, n: 3, rate: 1 / 3 });
    expect(channelRequirement(512, 'secded')).toEqual({ required: 1024, k: 4, n: 8, rate: 1 / 2 });

    for (const code of ['raw', 'repeat3', 'secded'] as const) {
      const required = channelRequirement(16, code).required;
      expect(runTransmission([0xc3, 0xa9], { code, budget: 512, p: 0, seed: 20260905 }))
        .toMatchObject({ ok: true, value: { required, outcome: 'exact', received: [0xc3, 0xa9] } });
    }
  });

  it('round-trips every code at zero noise without consulting UTF-8 validity', () => {
    for (const code of ['raw', 'repeat3', 'secded'] as const) {
      expect(runTransmission([0xc3, 0xa9], { code, budget: 512, p: 0, seed: 20260905 }))
        .toMatchObject({ ok: true, value: { outcome: 'exact', received: [0xc3, 0xa9], payloadErrors: 0 } });
      expect(runTransmission([0xff], { code, budget: 512, p: 0, seed: 20260905 }))
        .toMatchObject({ ok: true, value: { outcome: 'exact', received: [0xff] } });
    }
  });

  it('rejects the whole message when the strict budget cannot carry every codeword', () => {
    expect(runTransmission(Array(65).fill(65), { code: 'raw', budget: 512, p: 0, seed: 1 }))
      .toEqual({ ok: false, error: 'budget-exceeded' });
    expect(runTransmission(Array(22).fill(65), { code: 'repeat3', budget: 512, p: 0, seed: 1 }))
      .toEqual({ ok: false, error: 'budget-exceeded' });
    expect(runTransmission(Array(33).fill(65), { code: 'secded', budget: 512, p: 0, seed: 1 }))
      .toEqual({ ok: false, error: 'budget-exceeded' });
  });

  it('reconfirms the raw silent-corruption and SECDED rejection seeded fixtures', () => {
    expect(runTransmission([65], { code: 'raw', budget: 512, p: 0.05, seed: 1 })).toEqual({
      ok: true,
      value: {
        source: [65], received: [1], config: { code: 'raw', budget: 512, p: 0.05, seed: 1 },
        required: 8, outcome: 'silent-corruption', flippedBits: 1, payloadErrors: 1,
      },
    });
    expect(runTransmission([65], { code: 'secded', budget: 512, p: 0.05, seed: 6 })).toEqual({
      ok: true,
      value: {
        source: [65], received: null, config: { code: 'secded', budget: 512, p: 0.05, seed: 6 },
        required: 16, outcome: 'rejected', flippedBits: 3, payloadErrors: null,
      },
    });
  });

  it('computes Shannon capacity at the endpoints and rejects invalid probabilities', () => {
    expect(channelCapacity(0)).toEqual({ ok: true, value: 1 });
    expect(channelCapacity(0.5)).toEqual({ ok: true, value: 0 });
    expect(channelCapacity(0.1)).toEqual({ ok: true, value: 0.5310044064107188 });
    expect(channelCapacity(-0.01)).toEqual({ ok: false, error: 'invalid-probability' });
    expect(channelCapacity(Number.NaN)).toEqual({ ok: false, error: 'invalid-probability' });
  });

  it('validates dense bytes and exact public configuration bounds', () => {
    const sparse = [65];
    delete sparse[0];
    const valid = { code: 'raw' as const, budget: 512, p: 0, seed: 0 };
    expect(runTransmission([], valid)).toEqual({ ok: false, error: 'empty' });
    expect(runTransmission(sparse, valid)).toEqual({ ok: false, error: 'invalid-byte' });
    expect(runTransmission([256], valid)).toEqual({ ok: false, error: 'invalid-byte' });
    expect(runTransmission(Array(1025).fill(65), { ...valid, budget: 32768 }))
      .toEqual({ ok: false, error: 'byte-limit' });
    expect(runTransmission([65], { ...valid, budget: 513 })).toEqual({ ok: false, error: 'invalid-budget' });
    expect(runTransmission([65], { ...valid, p: 0.501 })).toEqual({ ok: false, error: 'invalid-probability' });
    expect(runTransmission([65], { ...valid, seed: 0x1_0000_0000 })).toEqual({ ok: false, error: 'invalid-seed' });
    expect(runTransmission([65], { ...valid, code: 'other' as never })).toEqual({ ok: false, error: 'invalid-code' });
  });

  it('rejects invalid direct requirement inputs with content-free codes', () => {
    expect(() => channelRequirement(-1, 'raw')).toThrow(new RangeError('invalid-bit-count'));
    expect(() => channelRequirement(1.5, 'raw')).toThrow(new RangeError('invalid-bit-count'));
    expect(() => channelRequirement(8, 'other' as never)).toThrow(new RangeError('invalid-code'));
  });

  it('returns fresh source, received, and config values without mutating caller input', () => {
    const bytes = [65];
    const config = { code: 'raw' as const, budget: 512, p: 0, seed: 1 };
    const result = runTransmission(bytes, config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).not.toBe(bytes);
    expect(result.value.received).not.toBe(bytes);
    expect(result.value.config).not.toBe(config);
    expect(bytes).toEqual([65]);
    expect(config).toEqual({ code: 'raw', budget: 512, p: 0, seed: 1 });
  });
});
