import type { Result } from '../communication/types';
import { inspectMessage } from '../communication/unicode';

export type MessageBudget = 15 | 30 | 60;

export interface DraftComparison {
  originalGraphemes: number;
  shortenedGraphemes: number;
  originalBytes: number;
  shortenedBytes: number;
  over: number;
}

const budgets: readonly MessageBudget[] = [15, 30, 60];
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const utf8Encoder = new TextEncoder();

function isWellFormedUtf16(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function compareDraft(
  original: string,
  shortened: string,
  budget: MessageBudget,
): Result<DraftComparison> {
  if (!budgets.includes(budget)) return { ok: false, error: 'invalid-budget' };

  const originalInspection = inspectMessage(original);
  if (!originalInspection.ok) return originalInspection;
  if (!isWellFormedUtf16(shortened)) return { ok: false, error: 'ill-formed' };

  const shortenedGraphemes = Array.from(graphemeSegmenter.segment(shortened)).length;
  return {
    ok: true,
    value: {
      originalGraphemes: originalInspection.value.graphemes,
      shortenedGraphemes,
      originalBytes: originalInspection.value.bytes.length,
      shortenedBytes: utf8Encoder.encode(shortened).length,
      over: Math.max(0, shortenedGraphemes - budget),
    },
  };
}
