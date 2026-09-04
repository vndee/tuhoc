export interface ExecutableRuleCard {
  id: string;
  operation: 'add' | 'multiply';
  operand: number;
}

export interface RuleTrace {
  output: number;
  trace: number[];
}

/** The largest finite integer the rule lab can display or store in a trace. */
export const MAX_RULE_VALUE = Number.MAX_SAFE_INTEGER;

/**
 * Applies a fixed, typed rule vocabulary; no rule text is ever evaluated.
 * Inputs, operands, and intermediate results are normalized to integers in
 * the inclusive range 0…Number.MAX_SAFE_INTEGER.
 */
export function executeRuleCards(input: number, cards: ExecutableRuleCard[]): RuleTrace {
  let output = normalizeRuleValue(input);
  const trace = [output];

  for (const card of cards) {
    const operand = normalizeRuleValue(card.operand);
    const rawResult = card.operation === 'multiply' ? output * operand : output + operand;
    output = normalizeRuleValue(rawResult);
    trace.push(output);
  }

  return { output, trace };
}

function normalizeRuleValue(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return 0;
  if (value === Infinity || value >= MAX_RULE_VALUE) return MAX_RULE_VALUE;
  return Math.trunc(value);
}
