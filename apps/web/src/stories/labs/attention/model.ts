import type { Lang } from '@tuhoc/i18n';

export interface AttentionExample {
  id: string;
  tokens: Record<Lang, string[]>;
  weights: Record<Lang, number[][]>;
}

/** Returns a copy of one authored attention row; it never derives new weights. */
export function weightsForToken(example: AttentionExample, lang: Lang, tokenIndex: number): number[] {
  const tokens = example.tokens[lang];
  const rows = example.weights[lang];
  const language = lang === 'en' ? 'English' : 'Vietnamese';

  if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex >= tokens.length) {
    throw new Error(`Token index ${tokenIndex} is outside the ${tokens.length}-token ${language} example`);
  }
  if (rows.length !== tokens.length) {
    throw new Error(`${language} attention has ${rows.length} rows; expected ${tokens.length}.`);
  }

  rows.forEach((row, rowIndex) => {
    if (row.length !== tokens.length) {
      throw new Error(`${language} attention row ${rowIndex} has ${row.length} weights; expected ${tokens.length}.`);
    }
    if (row.some((weight) => !Number.isFinite(weight))) {
      throw new Error(`${language} attention row ${rowIndex} must contain only finite weights.`);
    }
  });

  return [...rows[tokenIndex]!];
}
