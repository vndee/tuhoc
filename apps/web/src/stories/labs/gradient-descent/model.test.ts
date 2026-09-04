import { describe, expect, it } from 'vitest';
import { gradientStep, lossAt } from './model';

describe('gradient descent model', () => {
  it('calculates squared loss and one rounded gradient step', () => {
    expect(lossAt(5, 2)).toBe(9);
    expect(gradientStep(5, 0.1, 2)).toEqual({ nextX: 4.4, previousLoss: 9, nextLoss: 5.76 });
  });

  it('makes overshoot visible as a larger next loss', () => {
    expect(gradientStep(5, 1.1, 2).nextLoss).toBeGreaterThan(9);
  });

  it('rounds every displayed result to six decimals', () => {
    expect(gradientStep(1, 1 / 3, 0)).toEqual({ nextX: 0.333333, previousLoss: 1, nextLoss: 0.111111 });
  });

  it('rejects non-finite inputs and non-finite loss results', () => {
    expect(() => lossAt(Infinity, 0)).toThrow('x must be a finite number.');
    expect(() => lossAt(Number.MAX_VALUE, -Number.MAX_VALUE)).toThrow('Loss must be finite.');
    expect(() => gradientStep(1, NaN, 0)).toThrow('learningRate must be a finite number.');
  });
});
