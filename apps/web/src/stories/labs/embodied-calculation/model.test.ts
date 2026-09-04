import { describe, expect, it } from 'vitest';
import { describeAbacusAddition } from './model';

describe('describeAbacusAddition', () => {
  it('records each decimal column and its carry', () => {
    expect(describeAbacusAddition(7, 5).at(-1)).toMatchObject({ value: 12, carry: true });
    expect(describeAbacusAddition(0, 0)).toEqual([{ index: 0, value: 0, carry: false }]);
  });

  it('clamps operands to non-negative integers', () => {
    expect(describeAbacusAddition(-2, 3.8).at(-1)).toMatchObject({ value: 3, carry: false });
  });

  it('records consecutive carry-outs across decimal columns', () => {
    expect(describeAbacusAddition(99, 1)).toEqual([
      { index: 0, value: 10, carry: true },
      { index: 1, value: 10, carry: true },
    ]);
  });

  it('records when an incoming carry is consumed without a new carry-out', () => {
    expect(describeAbacusAddition(19, 1)).toEqual([
      { index: 0, value: 10, carry: true },
      { index: 1, value: 2, carry: false },
    ]);
  });
});
