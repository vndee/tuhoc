import { describe, expect, it } from 'vitest';
import type { Bit, Bits } from '../communication/types';
import { simulatePulses } from './model';

describe('pulse-channel model', () => {
  it('uses the exact tau=0 bypass and samples every symbol at its selected integer tick', () => {
    const result = simulatePulses([0, 1, 0, 1], { duration: 1, tau: 0, sampleFraction: 0.5 });

    expect(result).toMatchObject({ ok: true, value: { errors: 0 } });
    if (!result.ok) return;
    expect(result.value.samples).toEqual([
      { time: 0.5, value: -1, sent: 0, received: 0 },
      { time: 1.5, value: 1, sent: 1, received: 1 },
      { time: 2.5, value: -1, sent: 0, received: 0 },
      { time: 3.5, value: 1, sent: 1, received: 1 },
    ]);
    expect(result.value.points.every((point) => Number.isFinite(point.output))).toBe(true);
  });

  it('matches the hand-derived one-pole midpoint amplitude for constant one and zero inputs', () => {
    const one = simulatePulses([1], { duration: 1, tau: 1, sampleFraction: 0.5 });
    const zero = simulatePulses([0], { duration: 1, tau: 1, sampleFraction: 0.5 });

    expect(one.ok).toBe(true);
    expect(zero.ok).toBe(true);
    if (!one.ok || !zero.ok) return;
    const expected = 1 - Math.exp(-0.5);
    expect(one.value.samples[0]).toMatchObject({ time: 0.5, sent: 1, received: 1 });
    expect(one.value.samples[0]!.value).toBeCloseTo(expected, 14);
    expect(zero.value.samples[0]).toMatchObject({ time: 0.5, sent: 0, received: 0 });
    expect(zero.value.samples[0]!.value).toBeCloseTo(-expected, 14);
    expect(one.value.points[0]).toEqual({ time: 0, input: 1, output: 0 });
    expect(zero.value.points[0]).toEqual({ time: 0, input: -1, output: 0 });
    expect(one.value.points[8]!.time).toBe(0.5);
  });

  it.each([
    { name: 'all-zero', bits: [0, 0, 0, 0] as Bits },
    { name: 'all-one', bits: [1, 1, 1, 1] as Bits },
    { name: 'alternating', bits: [0, 1, 0, 1] as Bits },
  ])('is deterministic for the $name pattern and returns independent arrays', ({ bits }) => {
    const config = { duration: 2 as const, tau: 2 as const, sampleFraction: 0.75 as const };
    const first = simulatePulses(bits, config);
    const replay = simulatePulses(bits, config);

    expect(first).toEqual(replay);
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(first.value.points).not.toBe(replay.value.points);
    expect(first.value.samples).not.toBe(replay.value.samples);
    expect(first.value.samples.map((sample) => sample.time)).toEqual([1.5, 3.5, 5.5, 7.5]);
    expect(first.value.samples.map((sample) => sample.sent)).toEqual(bits);
    expect(first.value.samples.at(-1)!.time).toBeLessThan(bits.length * config.duration);
  });

  it.each([
    { bits: [] as Bits, config: { duration: 1, tau: 1, sampleFraction: 0.5 }, error: 'empty-input' },
    { bits: Array<Bit>(65).fill(0), config: { duration: 1, tau: 1, sampleFraction: 0.5 }, error: 'input-too-long' },
    { bits: [0, 2, 1] as unknown as Bits, config: { duration: 1, tau: 1, sampleFraction: 0.5 }, error: 'invalid-bit' },
    { bits: Array<Bit>(2), config: { duration: 1, tau: 1, sampleFraction: 0.5 }, error: 'invalid-bit' },
    { bits: [0] as Bits, config: { duration: 3, tau: 1, sampleFraction: 0.5 }, error: 'invalid-config' },
    { bits: [0] as Bits, config: { duration: 1, tau: -1, sampleFraction: 0.5 }, error: 'invalid-config' },
    { bits: [0] as Bits, config: { duration: 1, tau: 1, sampleFraction: 0.1 }, error: 'invalid-config' },
  ])('rejects invalid public input with $error', ({ bits, config, error }) => {
    expect(simulatePulses(bits, config as never)).toEqual({ ok: false, error });
  });
});
