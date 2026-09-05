import { describe, expect, it } from 'vitest';
import { evaluateTranscript, type Criterion } from './model';

const criteria: Criterion[] = [
  { id: 'consistency', label: 'Consistency', finding: 'The answers agree with one another.' },
  { id: 'knowledge', label: 'Knowledge', finding: 'The answers cite a concrete fact.' },
];

describe('evaluateTranscript', () => {
  it('returns no finding when no human criterion is selected', () => {
    expect(evaluateTranscript(criteria, [])).toEqual([]);
  });

  it('returns preauthored criterion-specific findings in criterion order', () => {
    expect(evaluateTranscript(criteria, ['knowledge', 'consistency'])).toEqual([
      { criterionId: 'consistency', label: 'Consistency', finding: 'The answers agree with one another.' },
      { criterionId: 'knowledge', label: 'Knowledge', finding: 'The answers cite a concrete fact.' },
    ]);
  });

  it('ignores unknown and duplicated selections without mutating authored criteria', () => {
    const source = structuredClone(criteria);

    expect(evaluateTranscript(criteria, ['missing', 'consistency', 'consistency'])).toEqual([
      { criterionId: 'consistency', label: 'Consistency', finding: 'The answers agree with one another.' },
    ]);
    expect(criteria).toEqual(source);
  });
});
