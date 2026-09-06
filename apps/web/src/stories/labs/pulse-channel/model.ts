import type { Bit, Bits, Result } from '../communication/types';

export type PulseDuration = 1 | 2 | 4;
export type PulseTau = 0 | 0.5 | 1 | 2;
export type PulseSampleFraction = 0.25 | 0.5 | 0.75;

export interface PulseConfig {
  duration: PulseDuration;
  tau: PulseTau;
  sampleFraction: PulseSampleFraction;
}

export type PulseExperimentConfig = PulseConfig & {
  source: 'alternating' | 'message';
  page: number;
};

export interface PulsePoint {
  time: number;
  input: number;
  output: number;
}

export interface PulseSample {
  time: number;
  value: number;
  sent: Bit;
  received: Bit;
}

export interface PulseResult {
  points: readonly PulsePoint[];
  samples: readonly PulseSample[];
  errors: number;
}

const TICKS_PER_UNIT = 16;
const DURATIONS: readonly PulseDuration[] = [1, 2, 4];
const TAUS: readonly PulseTau[] = [0, 0.5, 1, 2];
const SAMPLE_FRACTIONS: readonly PulseSampleFraction[] = [0.25, 0.5, 0.75];

const amplitude = (bit: Bit): number => bit === 0 ? -1 : 1;

export function simulatePulses(bits: Bits, config: PulseConfig): Result<PulseResult> {
  if (!Array.isArray(bits)) return { ok: false, error: 'invalid-bit' };
  if (bits.length === 0) return { ok: false, error: 'empty-input' };
  if (bits.length > 64) return { ok: false, error: 'input-too-long' };
  for (const bit of bits) {
    if (bit !== 0 && bit !== 1) return { ok: false, error: 'invalid-bit' };
  }
  if (!isPulseConfig(config)) return { ok: false, error: 'invalid-config' };

  const ticksPerSymbol = config.duration * TICKS_PER_UNIT;
  const totalTicks = bits.length * ticksPerSymbol;
  const sampleTickBySymbol = bits.map((_, symbol) =>
    (symbol + config.sampleFraction) * ticksPerSymbol,
  );
  const symbolBySampleTick = new Map(sampleTickBySymbol.map((tick, symbol) => [tick, symbol]));
  const alpha = config.tau === 0 ? 1 : 1 - Math.exp(-(1 / TICKS_PER_UNIT) / config.tau);
  const points: PulsePoint[] = [{ time: 0, input: amplitude(bits[0]!), output: config.tau === 0 ? amplitude(bits[0]!) : 0 }];
  const samples: PulseSample[] = [];
  let output = 0;
  let errors = 0;

  for (let tick = 0; tick < totalTicks; tick += 1) {
    const symbol = Math.floor(tick / ticksPerSymbol);
    const sent = bits[symbol]!;
    output = config.tau === 0
      ? amplitude(sent)
      : (1 - alpha) * output + alpha * amplitude(sent);
    const nextTick = tick + 1;
    const pointSymbol = Math.min(Math.floor(nextTick / ticksPerSymbol), bits.length - 1);
    if (config.tau === 0) {
      const nextInput = amplitude(bits[pointSymbol]!);
      // Two points at the same time describe an instantaneous NRZ edge.
      // Keep the positive-tau integration and its initial condition unchanged.
      if (nextInput !== output) points.push({ time: nextTick / TICKS_PER_UNIT, input: output, output });
      output = nextInput;
    }
    points.push({
      time: nextTick / TICKS_PER_UNIT,
      input: amplitude(bits[pointSymbol]!),
      output,
    });

    const sampledSymbol = symbolBySampleTick.get(nextTick);
    if (sampledSymbol !== undefined) {
      const sampledSent = bits[sampledSymbol]!;
      const received: Bit = output >= 0 ? 1 : 0;
      if (received !== sampledSent) errors += 1;
      samples.push({
        time: nextTick / TICKS_PER_UNIT,
        value: output,
        sent: sampledSent,
        received,
      });
    }
  }

  return { ok: true, value: { points, samples, errors } };
}

function isPulseConfig(value: unknown): value is PulseConfig {
  if (typeof value !== 'object' || value === null) return false;
  const config = value as Partial<PulseConfig>;
  return DURATIONS.includes(config.duration as PulseDuration) &&
    TAUS.includes(config.tau as PulseTau) &&
    SAMPLE_FRACTIONS.includes(config.sampleFraction as PulseSampleFraction);
}
