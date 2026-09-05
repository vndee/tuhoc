export interface AbacusOperation {
  index: number;
  value: number;
  carry: boolean;
}

/** Describes the raw addition in each decimal column, including carry-outs. */
export function describeAbacusAddition(left: number, right: number): AbacusOperation[] {
  const safeLeft = nonNegativeInteger(left);
  const safeRight = nonNegativeInteger(right);
  const columns = Math.max(1, String(safeLeft).length, String(safeRight).length);
  const operations: AbacusOperation[] = [];
  let carryIn = 0;

  for (let index = 0; index < columns; index += 1) {
    const place = 10 ** index;
    const value = Math.floor(safeLeft / place) % 10 + Math.floor(safeRight / place) % 10 + carryIn;
    const carry = value >= 10;
    operations.push({ index, value, carry });
    carryIn = carry ? 1 : 0;
  }

  return operations;
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0));
}
