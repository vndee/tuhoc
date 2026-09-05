import type { Result } from '../communication/types';
import { inspectMessage, inspectUnicode } from '../communication/unicode';

export type MessageBudget = 15 | 30 | 60;

export interface DraftComparison {
  originalGraphemes: number;
  shortenedGraphemes: number;
  originalBytes: number;
  shortenedBytes: number;
  over: number;
}

const budgets: readonly MessageBudget[] = [15, 30, 60];

export function compareDraft(
  original: string,
  shortened: string,
  budget: MessageBudget,
): Result<DraftComparison> {
  if (!budgets.includes(budget)) return { ok: false, error: 'invalid-budget' };

  const originalInspection = inspectMessage(original);
  if (!originalInspection.ok) return originalInspection;
  const shortenedInspection = inspectUnicode(shortened);
  if (!shortenedInspection.ok) return shortenedInspection;

  const shortenedGraphemes = shortenedInspection.value.graphemes;
  return {
    ok: true,
    value: {
      originalGraphemes: originalInspection.value.graphemes,
      shortenedGraphemes,
      originalBytes: originalInspection.value.bytes.length,
      shortenedBytes: shortenedInspection.value.bytes.length,
      over: Math.max(0, shortenedGraphemes - budget),
    },
  };
}
