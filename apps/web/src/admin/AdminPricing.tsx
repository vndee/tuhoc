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

/** One `ai_pricing` row: model name (read-only) plus six editable rates and its own Save. */
function PricingRowEditor({ row, t }: { row: AdminPricingRow; t: Translate }) {
  const [draft, setDraft] = useState<RateDraft>(() => draftFromRow(row));

  const mutation = useMutation({
    mutationFn: (input: UpdatePricingInput) => adminUpdatePricing(row.model, input),
    // Read back the SAVED row rather than echo the draft — the same
    // "server is the source of truth" rule PutConfig (Go) and
    // AgentConfigPanel.tsx already keep; nothing here NORMALIZES the six
    // numbers today, but there is no reason this draft should ever diverge
    // from what the server actually stored.
    onSuccess: (updated) => setDraft(draftFromRow(updated)),
  });

  const parsed = {
    costIn: parseNonNegativeInt(draft.costIn),
    costCachedIn: parseNonNegativeInt(draft.costCachedIn),
    costOut: parseNonNegativeInt(draft.costOut),
    creditsIn: parseNonNegativeInt(draft.creditsIn),
    creditsCachedIn: parseNonNegativeInt(draft.creditsCachedIn),
    creditsOut: parseNonNegativeInt(draft.creditsOut),
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
    mutation.mutate({
      cost_micro_per_1k_in: parsed.costIn as number,
      cost_micro_per_1k_cached_in: parsed.costCachedIn as number,
      cost_micro_per_1k_out: parsed.costOut as number,
      credits_per_1k_in: parsed.creditsIn as number,
      credits_per_1k_cached_in: parsed.creditsCachedIn as number,
      credits_per_1k_out: parsed.creditsOut as number,
    });
  }

  function field(key: keyof RateDraft, testid: string) {
    return (
      <input
        type="text"
        inputMode="numeric"
        value={draft[key]}
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
        <td>
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
          <td colSpan={8}>
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
                  <th>{t('admin.ai.pricing.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {pricingQuery.data.map((row) => (
                  <PricingRowEditor key={row.model} row={row} t={t} />
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
