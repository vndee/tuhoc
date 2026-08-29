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
 *
 * THE REGEX GATE, added round-2 review (Minor 4) — `text` is checked
 * against `^\d+(\.\d+)?$` BEFORE it ever reaches `Number(...)`, for two
 * reasons the previous version (a bare `Number.isFinite` check) missed
 * entirely:
 *
 *  1. **Consistency with `parseNonNegativeInt`** (`AdminPricing.tsx`), the
 *     sibling parser for the six `ai_pricing` rate fields: that one already
 *     only ever accepted `^\d+$`, so `"1e3"` was rejected there but
 *     ACCEPTED here as `1000` — the same shape of number read as valid in
 *     one admin form and invalid in the sibling form one screen over, with
 *     no reason for readers to expect the difference.
 *  2. **`Number.isSafeInteger` on the FINAL micro value, not just on
 *     `value`** — a bare `Number.isFinite(value)` check lets through any
 *     magnitude short of `Infinity`: `"1e30"` credits is a finite number,
 *     multiplying it by `MICRO_PER_CREDIT` produces `1e36`,
 *     `JSON.stringify` on THAT renders as `"1e+36"` in the request body,
 *     and Go's `encoding/json` rejects the whole body outright — an
 *     operator who fat-fingered an amount would have read "request body is
 *     not valid JSON" instead of a sane "amount out of range" message, or
 *     (worse, before this fix, since the button was NOT disabled for that
 *     input) gotten no client-side refusal at all. The regex closes the
 *     `1e30`-shaped case structurally (no exponent syntax is ever matched),
 *     and `Number.isSafeInteger` on the computed micro value below is the
 *     backstop for a plain, exponent-free digit string still long enough to
 *     overflow (e.g. thirty nines) — the SAME backstop `parseNonNegativeInt`
 *     already applies to its own single value, just applied here to the
 *     value AFTER the ×1e6 conversion, since that is the number that
 *     actually has to survive the trip to the server.
 */
export function parseCreditsToMicro(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  const micro = Math.round(value * MICRO_PER_CREDIT);
  return Number.isSafeInteger(micro) ? micro : null;
}
