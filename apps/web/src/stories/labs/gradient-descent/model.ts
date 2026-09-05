export interface GradientStep {
  nextX: number;
  previousLoss: number;
  nextLoss: number;
}

/** The squared distance between a current point and the fixed target point. */
export function lossAt(x: number, targetX: number): number {
  assertFinite(x, 'x');
  assertFinite(targetX, 'targetX');
  const loss = (x - targetX) ** 2;
  if (!Number.isFinite(loss)) throw new Error('Loss must be finite.');
  return loss;
}

/** Takes exactly one manual gradient-descent update for the squared-loss toy. */
export function gradientStep(x: number, learningRate: number, targetX: number): GradientStep {
  assertFinite(x, 'x');
  assertFinite(learningRate, 'learningRate');
  assertFinite(targetX, 'targetX');
  const previousLoss = lossAt(x, targetX);
  const nextX = x - learningRate * (2 * (x - targetX));
  if (!Number.isFinite(nextX)) throw new Error('Next x must be finite.');
  const nextLoss = lossAt(nextX, targetX);
  return {
    nextX: roundSix(nextX),
    previousLoss: roundSix(previousLoss),
    nextLoss: roundSix(nextLoss),
  };
}

function assertFinite(value: number, name: string) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
}

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}
