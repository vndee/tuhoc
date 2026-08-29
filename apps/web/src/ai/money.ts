import type { Lang } from '../i18n';

/**
 * `money.ts` — the ONE place `apps/web/src` converts between the wire unit
 * (micro-credit, an `int64` on the Go side — see `ai_credits.balance_micro`
 * and every `*_micro` field `apps/api/internal/ai` reads/writes) and the
 * unit a human reads (credits).
 *
 * Extracted out of `CreditPanel.tsx` at Task 17: `formatCredits` used to
 * live there, unexported, specifically because it had exactly one caller
 * (`CreditPanel.tsx`'s own doc comment, "VÒNG SỬA 1", records the review
 * finding that removed `export` from it for that reason). `AdminCredits.tsx`
 * is now a SECOND real caller — the "Người dùng & credit" CMS screen reads
 * the same balance unit and must render it identically, and a second,
 * independently-typed copy of "divide by 1e6, format with the viewer's
 * locale" is exactly the kind of drift this whole run's reviews keep
 * catching in money code (task-11-brief.md's own fixture-number rule exists
 * for the identical reason, one layer down). One function, two callers.
 */

/** 1 credit = 1,000,000 micro-credit. The only place this constant is spelled out. */
export const MICRO_PER_CREDIT = 1_000_000;

/**
 * micro-credit → a credit amount readable in `lang`'s own decimal
 * separator — the exact formatting `pages/Settings.tsx`'s `formatBytes`
 * already uses for a different unit, kept identical here on purpose so the
 * two screens do not each invent their own rounding/locale behavior.
 */
export function formatCredits(micro: number, lang: Lang): string {
  return (micro / MICRO_PER_CREDIT).toLocaleString(lang === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: 4 });
}

/**
 * Parses a human-typed CREDIT amount (e.g. `"50"`, `"12.5"`, `"12,5"` — a
 * comma decimal separator is accepted since `vi-VN` renders one) into a
 * whole number of micro-credits, or `null` when `text` is not a valid
 * POSITIVE number.
 *
 * `null` on anything <= 0 is deliberate, not merely "non-negative": the
 * caller (`AdminCredits.tsx`'s manual adjustment form) asks the OPERATOR
 * for a magnitude and a separate add/subtract direction, never a signed
 * number typed by hand — the same reasoning `AdminAdjustCredit`'s own
 * `delta_micro == 0` check gives on the Go side for refusing a no-op
 * request: an amount of exactly 0 (or a negative one, which this input
 * shape has no honest meaning for) can only be a mistake here, not a
 * legitimate debit — a debit is expressed by the direction toggle, not by
 * typing a minus sign into an amount field.
 *
 * `Math.round`, not truncation: a typed amount that is not an exact whole
 * number of micro-credits (e.g. "0.0000001" credits) would otherwise lose
 * the sub-micro remainder silently every time; rounding to the nearest
 * micro-credit is the same precision `balance_micro` itself has, so this
 * is the closest whole-number amount to what was actually typed, not a
 * truncation toward zero that quietly undercounts.
 */
export function parseCreditsToMicro(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '') return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * MICRO_PER_CREDIT);
}
