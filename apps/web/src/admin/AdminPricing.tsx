import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import type { Translate } from '../i18n';
import { useLanguage } from '../i18n/LanguageProvider';
import { AdminNav } from './AdminNav';
import {
  type AdminPricingRow,
  type UpdatePricingInput,
  adminGetAISettings,
  adminListPricing,
  adminUpdateBasePrompt,
  adminUpdatePricing,
  describeAdminAIError,
} from './adminApi';

/**
 * `AdminPricing` — spec §7's "Bảng giá & prompt nền" screen (Task 17):
 * "sửa bảng quy đổi credit · sửa system prompt nền của agent", talking to
 * `GET`/`PUT /admin/ai/pricing/:model` and `GET`/`PUT /admin/ai/settings`
 * (`apps/api/internal/ai/admin_handler.go`).
 *
 * TWO SEPARATE EDITORS, deliberately not one form: the pricing table edits
 * `ai_pricing` (one row per model, six rates each — `PricingRowEditor`
 * below owns its OWN draft and its OWN mutation, so saving one model's
 * rates never touches another's, and a failed save on one row leaves every
 * other row's in-progress edit untouched); the base prompt edits the ONE
 * row of `ai_settings`. Both take effect on the very next turn, with no
 * deploy and no restart (spec §3.4) — that property lives entirely on the
 * Go side (`credits.go`'s `pricing`/`settings` read the database fresh on
 * every call, never a cache); this file has nothing to do to keep it true
 * beyond not inventing a client-side cache of its own.
 *
 * `AdminGetSettings` also returns five columns this screen never lets an
 * operator edit (`credits_per_web_search`, `cost_micro_per_web_search`,
 * `signup_grant_micro`, `max_tokens_per_turn`, `max_tool_rounds_per_turn`)
 * — deliberately out of scope, see that handler's own doc comment on the
 * Go side for why. This screen reads only `base_system_prompt` (and
 * `max_base_prompt_chars`, the length cap) off that response.
 */

/**
 * Counts Unicode CODE POINTS, not UTF-16 code units — the identical
 * function `AgentConfigPanel.tsx` keeps for the SAME reason
 * (`MaxSystemPromptChars`/`MaxBasePromptChars` on the Go side both count
 * `utf8.RuneCountInString`, and `.length` would over-count any character
 * outside the Basic Multilingual Plane).
 */
function runeLength(s: string): number {
  return Array.from(s).length;
}

/**
 * Parses a rate field (a non-negative WHOLE number of micro-credit/
 * micro-dollar per 1K tokens) or returns `null`. Deliberately stricter
 * than `Number(text) >= 0`: a bare regex on digits-only text rejects
 * "1e3", "1.5", " ", and "-1" outright rather than silently accepting a
 * shape `ai_pricing`'s own `bigint` columns (and their `CHECK (... >= 0)`
 * constraints, migration 0007_ai_credits) were never meant to hold.
 */
function parseNonNegativeInt(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Same, plus the UPPER bound the server enforces
 * (`MaxPricingRateMicro`, admin_handler.go), read off
 * `GET /admin/ai/settings` rather than typed a second time here — D1 of the
 * whole-branch review.
 *
 * WHAT THIS IS FOR, stated plainly: the server refuses these values with a
 * 400 regardless, so this is not a security check. It is the difference
 * between an operator seeing the mistake while typing and an operator
 * finding out after a submit — and the mistake this bounds is the one
 * review actually measured: nine extra zeros in `credits_per_1k_out`,
 * charging 194,641,920,000,000 micro on a single turn, needing 1,947
 * separate capped adjustments to undo.
 *
 * `max` undefined (an older server that does not advertise the ceiling)
 * means NO client-side upper bound — deliberately, not as an oversight.
 * The alternative is a hardcoded fallback, which is exactly the second copy
 * of the number this whole arrangement exists to avoid.
 */
function parseRate(text: string, max: number | undefined): number | null {
  const value = parseNonNegativeInt(text);
  if (value === null) return null;
  if (max !== undefined && value > max) return null;
  return value;
}

interface RateDraft {
  readonly costIn: string;
  readonly costCachedIn: string;
  readonly costOut: string;
  readonly creditsIn: string;
  readonly creditsCachedIn: string;
  readonly creditsOut: string;
}

function draftFromRow(row: AdminPricingRow): RateDraft {
  return {
    costIn: String(row.cost_micro_per_1k_in),
    costCachedIn: String(row.cost_micro_per_1k_cached_in),
    costOut: String(row.cost_micro_per_1k_out),
    creditsIn: String(row.credits_per_1k_in),
    creditsCachedIn: String(row.credits_per_1k_cached_in),
    creditsOut: String(row.credits_per_1k_out),
  };
}

/**
 * `at` (RFC3339, Go `time.Time`) → "YYYY-MM-DD HH:mm UTC" — mirrors
 * `AdminCredits.tsx`'s own `formatUsageWhen` byte for byte. A third small
 * local copy rather than a shared helper: unlike money (`ai/money.ts`,
 * extracted specifically because a SECOND caller of the same rounding/
 * locale logic is where drift bugs live), a cosmetic date-string
 * difference between two admin screens costs a reader a squint, not a
 * wrong balance — the asymmetry review rounds on this task keep drawing
 * between money code and everything else.
 */
function formatUpdatedAt(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** One `ai_pricing` row: model name (read-only) plus six editable rates and its own Save. */
function PricingRowEditor({
  row,
  t,
  maxRate,
}: {
  row: AdminPricingRow;
  t: Translate;
  /** `max_pricing_rate_micro` off `GET /admin/ai/settings`; undefined on an older server. */
  maxRate: number | undefined;
}) {
  const [draft, setDraft] = useState<RateDraft>(() => draftFromRow(row));
  // round-2 review, Minor 2: `types.go`'s own doc comment on
  // `Pricing.UpdatedAt` says the CMS screen "shows it" — it didn't. Tracked
  // in its own piece of state (not read straight off `row.updated_at` on
  // every render) because a successful save must show the NEW timestamp
  // the server just wrote, not the one this row was seeded with.
  const [updatedAt, setUpdatedAt] = useState(row.updated_at);
  // round-2 review, Minor 7: PricingRowEditor never sent `note` at all, so
  // every `ai.pricing.update` audit row carried only the auto-generated
  // "rates set to ..." summary (admin_handler.go's own fallback) — an
  // operator's REASON for a rate change never had anywhere to go, even
  // though the endpoint has accepted one since Task 17 shipped.
  const [noteDraft, setNoteDraft] = useState('');

  const mutation = useMutation({
    mutationFn: (input: UpdatePricingInput) => adminUpdatePricing(row.model, input),
    // Read back the SAVED row rather than echo the draft — the same
    // "server is the source of truth" rule PutConfig (Go) and
    // AgentConfigPanel.tsx already keep; nothing here NORMALIZES the six
    // numbers today, but there is no reason this draft should ever diverge
    // from what the server actually stored.
    onSuccess: (updated) => {
      setDraft(draftFromRow(updated));
      setUpdatedAt(updated.updated_at);
      setNoteDraft('');
    },
  });

  const parsed = {
    costIn: parseRate(draft.costIn, maxRate),
    costCachedIn: parseRate(draft.costCachedIn, maxRate),
    costOut: parseRate(draft.costOut, maxRate),
    creditsIn: parseRate(draft.creditsIn, maxRate),
    creditsCachedIn: parseRate(draft.creditsCachedIn, maxRate),
    creditsOut: parseRate(draft.creditsOut, maxRate),
  };
  const allValid =
    parsed.costIn !== null &&
    parsed.costCachedIn !== null &&
    parsed.costOut !== null &&
    parsed.creditsIn !== null &&
    parsed.creditsCachedIn !== null &&
    parsed.creditsOut !== null;

  function handleSave() {
    if (!allValid || mutation.isPending) return;
    const note = noteDraft.trim();
    mutation.mutate({
      cost_micro_per_1k_in: parsed.costIn as number,
      cost_micro_per_1k_cached_in: parsed.costCachedIn as number,
      cost_micro_per_1k_out: parsed.costOut as number,
      credits_per_1k_in: parsed.creditsIn as number,
      credits_per_1k_cached_in: parsed.creditsCachedIn as number,
      credits_per_1k_out: parsed.creditsOut as number,
      // Omitted entirely (not sent as `""`) when blank, so the server's own
      // auto-generated summary (admin_handler.go's AdminUpdatePricing
      // fallback) still fires for an operator who saves without typing a
      // reason — the empty-vs-absent distinction JSON.stringify already
      // gives us for free by dropping an `undefined` key.
      note: note === '' ? undefined : note,
    });
  }

  function field(key: keyof RateDraft, testid: string) {
    // `aria-invalid` rather than a new sentence under the input: which ONE
    // of six fields is wrong is information a disabled Save button does not
    // carry, and marking the field says it without inventing user-facing
    // copy in a round that is deliberately not touching wording.
    const invalid = parsed[key] === null;
    return (
      <input
        type="text"
        inputMode="numeric"
        value={draft[key]}
        aria-invalid={invalid || undefined}
        onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
        data-testid={testid}
      />
    );
  }

  return (
    <>
      <tr>
        <td data-testid={`pricing-model-${row.model}`}>{row.model}</td>
        <td>{field('costIn', `pricing-cost-in-${row.model}`)}</td>
        <td>{field('costCachedIn', `pricing-cost-cached-${row.model}`)}</td>
        <td>{field('costOut', `pricing-cost-out-${row.model}`)}</td>
        <td>{field('creditsIn', `pricing-credits-in-${row.model}`)}</td>
        <td>{field('creditsCachedIn', `pricing-credits-cached-${row.model}`)}</td>
        <td>{field('creditsOut', `pricing-credits-out-${row.model}`)}</td>
        <td data-testid={`pricing-updated-at-${row.model}`}>{formatUpdatedAt(updatedAt)}</td>
        <td>
          <input
            type="text"
            value={noteDraft}
            placeholder={t('admin.ai.pricing.rowNotePlaceholder')}
            onChange={(event) => setNoteDraft(event.target.value)}
            data-testid={`pricing-note-${row.model}`}
          />
          <button
            type="button"
            className="btn primary"
            disabled={!allValid || mutation.isPending}
            onClick={handleSave}
            data-testid={`pricing-save-${row.model}`}
          >
            {mutation.isPending ? t('admin.ai.pricing.saving') : t('admin.ai.pricing.save')}
          </button>
        </td>
      </tr>
      {(mutation.isError || mutation.isSuccess) && (
        <tr>
          <td colSpan={9}>
            {mutation.isError && (
              <p className="admin-note" role="alert" data-testid={`pricing-error-${row.model}`}>
                {describeAdminAIError(mutation.error, t)}
              </p>
            )}
            {mutation.isSuccess && (
              <p className="admin-note" role="status" data-testid={`pricing-success-${row.model}`}>
                {t('admin.ai.pricing.saved')}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function AdminPricing() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const pricingQuery = useQuery({ queryKey: ['admin', 'ai', 'pricing'], queryFn: adminListPricing, retry: false });
  const settingsQuery = useQuery({ queryKey: ['admin', 'ai', 'settings'], queryFn: adminGetAISettings, retry: false });

  // Draft prompt separate from settingsQuery.data — same split
  // AgentConfigPanel.tsx keeps for its own personal prompt, and for the
  // identical reason: a background refetch must not overwrite an
  // operator's in-progress edit. `null` = "not seeded from the server
  // yet", distinct from `''` (a genuinely empty draft, which this screen
  // refuses to SAVE but must still let someone TYPE while composing).
  const [draftPrompt, setDraftPrompt] = useState<string | null>(null);
  const [promptNote, setPromptNote] = useState('');

  useEffect(() => {
    if (settingsQuery.data && draftPrompt === null) {
      setDraftPrompt(settingsQuery.data.base_system_prompt);
    }
    // Seed EXACTLY once from the first load — deps deliberately omit
    // draftPrompt (it changes because of EDITING, not because of a refetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data]);

  const promptMutation = useMutation({
    mutationFn: (input: { basePrompt: string; note: string }) => adminUpdateBasePrompt(input.basePrompt, input.note),
    onSuccess: (updated) => {
      setDraftPrompt(updated.base_system_prompt);
      setPromptNote('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ai', 'settings'] });
    },
  });

  const cap = settingsQuery.data?.max_base_prompt_chars ?? 20000;
  const promptLength = draftPrompt === null ? 0 : runeLength(draftPrompt);
  const overCap = promptLength > cap;
  const promptEmpty = draftPrompt === null || draftPrompt.trim() === '';
  const canSavePrompt = !promptEmpty && !overCap && !promptMutation.isPending;

  function handlePromptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSavePrompt || draftPrompt === null) return;
    promptMutation.mutate({ basePrompt: draftPrompt, note: promptNote });
  }

  return (
    <div className="admin-page">
      <AdminNav />
      <div className="admin-header">
        <h1 className="ch-title">{t('admin.ai.pricing.title')}</h1>
        <p className="ch-lede">{t('admin.ai.pricing.lede')}</p>
      </div>

      <section>
        <h2 className="admin-upload-heading">{t('admin.ai.pricing.tableTitle')}</h2>
        {pricingQuery.isPending && <p className="admin-note">{t('admin.ai.pricing.loading')}</p>}
        {pricingQuery.isError && (
          <p className="admin-note" role="alert">
            {describeAdminAIError(pricingQuery.error, t)}
          </p>
        )}
        {pricingQuery.isSuccess && (
          <div className="set-usage-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('admin.ai.pricing.colModel')}</th>
                  <th>{t('admin.ai.pricing.colCostIn')}</th>
                  <th>{t('admin.ai.pricing.colCostCachedIn')}</th>
                  <th>{t('admin.ai.pricing.colCostOut')}</th>
                  <th>{t('admin.ai.pricing.colCreditsIn')}</th>
                  <th>{t('admin.ai.pricing.colCreditsCachedIn')}</th>
                  <th>{t('admin.ai.pricing.colCreditsOut')}</th>
                  <th>{t('admin.ai.pricing.colUpdatedAt')}</th>
                  <th>{t('admin.ai.pricing.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {pricingQuery.data.map((row) => (
                  <PricingRowEditor
                    key={row.model}
                    row={row}
                    t={t}
                    maxRate={settingsQuery.data?.max_pricing_rate_micro}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-upload">
        <h2 className="admin-upload-heading">{t('admin.ai.pricing.promptTitle')}</h2>
        <p className="admin-note">{t('admin.ai.pricing.promptBlurb')}</p>
        {settingsQuery.isPending && <p className="admin-note">{t('admin.ai.pricing.loading')}</p>}
        {settingsQuery.isError && (
          <p className="admin-note" role="alert">
            {describeAdminAIError(settingsQuery.error, t)}
          </p>
        )}
        {draftPrompt !== null && (
          <form data-testid="admin-ai-prompt-form" onSubmit={handlePromptSubmit}>
            <label className="admin-upload-field">
              <span>{t('admin.ai.pricing.promptLabel')}</span>
              <textarea
                rows={6}
                value={draftPrompt}
                onChange={(event) => setDraftPrompt(event.target.value)}
                data-testid="admin-ai-prompt-textarea"
              />
            </label>
            <p className={overCap ? 'admin-note set-note-warn' : 'admin-note'} data-testid="admin-ai-prompt-counter">
              {t('settings.ai.promptCounter', String(promptLength), String(cap))}
            </p>
            {promptEmpty && (
              <p className="admin-note set-note-warn" role="alert" data-testid="admin-ai-prompt-empty-warning">
                {t('admin.ai.pricing.promptEmptyWarning')}
              </p>
            )}
            {overCap && (
              <p className="admin-note set-note-warn" role="alert" data-testid="admin-ai-prompt-too-long">
                {t('settings.ai.promptTooLong')}
              </p>
            )}
            <label className="admin-upload-field">
              <span>{t('admin.ai.pricing.promptNoteLabel')}</span>
              <input
                type="text"
                value={promptNote}
                onChange={(event) => setPromptNote(event.target.value)}
                data-testid="admin-ai-prompt-note-input"
              />
            </label>
            <button type="submit" className="btn primary" disabled={!canSavePrompt} data-testid="admin-ai-prompt-submit">
              {promptMutation.isPending ? t('admin.ai.pricing.saving') : t('admin.ai.pricing.save')}
            </button>
            {promptMutation.isError && (
              <p className="admin-note" role="alert" data-testid="admin-ai-prompt-error">
                {describeAdminAIError(promptMutation.error, t)}
              </p>
            )}
            {promptMutation.isSuccess && (
              <p className="admin-note" role="status" data-testid="admin-ai-prompt-success">
                {t('admin.ai.pricing.saved')}
              </p>
            )}
          </form>
        )}
      </section>
    </div>
  );
}

export default AdminPricing;
