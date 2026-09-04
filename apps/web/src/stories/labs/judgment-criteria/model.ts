export interface Criterion {
  id: string;
  label: string;
  finding: string;
}

export interface CriterionFinding {
  criterionId: string;
  label: string;
  finding: string;
}

/** Returns authored observations for the human criteria currently in view. */
export function evaluateTranscript(criteria: Criterion[], enabledIds: string[]): CriterionFinding[] {
  const selected = new Set(enabledIds.filter((id): id is string => typeof id === 'string'));
  return criteria
    .filter((criterion) => selected.has(criterion.id))
    .map((criterion) => ({ criterionId: criterion.id, label: criterion.label, finding: criterion.finding }));
}
