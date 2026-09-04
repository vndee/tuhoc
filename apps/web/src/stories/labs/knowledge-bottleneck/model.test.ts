import { describe, expect, it } from 'vitest';
import { countAffectedRules, descendantIds, type RuleNode } from './model';

const ruleNodes: RuleNode[] = [
  { id: 'symptom', parentId: null },
  { id: 'fever', parentId: 'symptom' },
  { id: 'cough', parentId: 'symptom' },
  { id: 'exception', parentId: 'fever' },
];

describe('knowledge bottleneck model', () => {
  it('visits dependent rules in authored sibling order, once each', () => {
    expect(descendantIds(ruleNodes, 'symptom')).toEqual(['fever', 'cough', 'exception']);
    expect(countAffectedRules(ruleNodes, 'symptom')).toBe(3);
  });

  it('rejects a changed rule that is not present', () => {
    expect(() => descendantIds(ruleNodes, 'missing')).toThrow('Rule "missing" does not exist.');
  });

  it('rejects duplicate rule ids and dangling parents before traversing', () => {
    expect(() => descendantIds([...ruleNodes, { id: 'cough', parentId: null }], 'symptom')).toThrow('Rule nodes must have unique ids.');
    expect(() => descendantIds([{ id: 'child', parentId: 'missing' }], 'child')).toThrow('Rule "child" references missing parent "missing".');
  });

  it('rejects cycles rather than returning an incomplete branch', () => {
    expect(() => descendantIds([
      { id: 'a', parentId: 'c' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ], 'a')).toThrow('Rule graph contains a cycle.');
  });
});
