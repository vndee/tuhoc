/**
 * A deliberately simple retention projection for comparing media. It is an
 * illustrative model, not a historical measurement.
 */
export function projectMemory(generation: number, originalMarks: number, retention: number): number {
  const safeGeneration = nonNegativeInteger(generation);
  const safeMarks = nonNegativeInteger(originalMarks);
  const safeRetention = Math.max(0, Math.min(1, Number.isFinite(retention) ? retention : 0));

  return Math.round(safeMarks * safeRetention ** safeGeneration);
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0));
}
