import { uniformAt } from '../communication/random';
import type { Result, SymbolId, Weights } from '../communication/types';

export interface SourceEntropyResult {
  probabilities: readonly number[];
  contributions: readonly number[];
  entropy: number;
}

export interface SymbolDraw {
  symbol: SymbolId;
  surprise: number;
}

const SYMBOLS: readonly SymbolId[] = ['A', 'B', 'C', 'D'];

export function sourceEntropy(weights: Weights): Result<SourceEntropyResult> {
  if (!isWeights(weights)) return { ok: false, error: 'invalid-weight' };
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return { ok: false, error: 'empty-source' };

  const probabilities = weights.map((weight) => weight / total);
  const contributions = probabilities.map((probability) =>
    probability === 0 || probability === 1 ? 0 : -probability * Math.log2(probability),
  );
  const entropy = contributions.reduce((sum, contribution) => sum + contribution, 0);
  return {
    ok: true,
    value: {
      probabilities,
      contributions,
      entropy: entropy === 0 ? 0 : entropy,
    },
  };
}

export function drawSymbol(weights: Weights, seed: number, counter: number): Result<SymbolDraw> {
  const distribution = sourceEntropy(weights);
  if (!distribution.ok) return distribution;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    return { ok: false, error: 'invalid-seed' };
  }
  if (!Number.isSafeInteger(counter) || counter < 0) {
    return { ok: false, error: 'invalid-counter' };
  }

  const uniform = uniformAt(seed, counter);
  let cumulative = 0;
  let selectedIndex = -1;
  for (let index = 0; index < distribution.value.probabilities.length; index += 1) {
    const probability = distribution.value.probabilities[index]!;
    if (probability === 0) continue;
    cumulative += probability;
    if (uniform < cumulative) {
      selectedIndex = index;
      break;
    }
  }
  if (selectedIndex < 0) {
    selectedIndex = distribution.value.probabilities.findLastIndex((probability) => probability > 0);
  }
  const probability = distribution.value.probabilities[selectedIndex]!;
  return {
    ok: true,
    value: {
      symbol: SYMBOLS[selectedIndex]!,
      surprise: probability === 1 ? 0 : -Math.log2(probability),
    },
  };
}

function isWeights(value: unknown): value is Weights {
  if (!Array.isArray(value) || value.length !== 4) return false;
  for (let index = 0; index < 4; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
    const weight = value[index];
    if (!Number.isInteger(weight) || weight < 0 || weight > 100) return false;
  }
  return true;
}
