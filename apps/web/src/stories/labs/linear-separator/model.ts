export interface Point {
  x: number;
  y: number;
}

export interface LabeledPoint extends Point {
  id: string;
  label: -1 | 1;
}

/** Classifies a point by the sign of x cos(a) + y sin(a) + offset. */
export function classifyPoint(point: Point, angle: number, offset: number): -1 | 1 {
  const x = finiteOrZero(point.x);
  const y = finiteOrZero(point.y);
  const normalizedAngle = finiteOrZero(angle);
  const normalizedOffset = finiteOrZero(offset);
  return x * Math.cos(normalizedAngle) + y * Math.sin(normalizedAngle) + normalizedOffset >= 0 ? 1 : -1;
}

export function countMisclassified(points: LabeledPoint[], angle: number, offset: number): number {
  return points.reduce((count, point) => count + (classifyPoint(point, angle, offset) === point.label ? 0 : 1), 0);
}

function finiteOrZero(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
