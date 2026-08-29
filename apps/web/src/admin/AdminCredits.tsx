import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { formatCredits, parseCreditsToMicro } from '../ai/money';
import { useLanguage } from '../i18n/LanguageProvider';
import { AdminNav } from './AdminNav';
import {
  type AdminAIUserDetail,
  adminAdjustCredit,
  adminGetAIUser,
  adminListAIUsers,
  describeAdminAIError,
} from './adminApi';

/**
 * `AdminCredits` — spec §7's "Người dùng & credit" screen (Task 17):
 * "tìm user, số dư, sổ cái ai_usage · cộng/trừ credit tay, bắt buộc ghi
 * chú", talking to `GET /admin/ai/users`, `GET /admin/ai/users/:id`, and
 * `POST /admin/ai/users/:id/credit` (`apps/api/internal/ai/admin_handler.go`).
 *
 * This is task-17-brief.md's own words: "màn nguy hiểm nhất trong cả
 * pha" — the one place an operator moves someone else's money by hand.
 * Every mitigation this file can own at the UI layer is documented at its
 * own call site below; the ones it CANNOT own (idempotency, a hard
 * confirmation dialog) are named rather than silently skipped:
 *
 *  - **Double-submit**: the amount/note fields are cleared on a successful
 *    adjustment (see `adjustMutation`'s `onSuccess`), and the submit
 *    button is disabled while a request is in flight AND whenever the
 *    amount/note fields are not both filled in — so a second click needs
 *    a second, deliberate re-entry of both fields, not a bare re-click.
 *    This does NOT close the server-side race (two genuinely separate
 *    requests, e.g. two browser tabs) — `AdminAdjustCredit`'s own doc
 *    comment on the Go side names that gap explicitly.
 *  - **Wrong target**: the selected learner's EMAIL is shown directly
 *    above the adjustment form (never just an id), and every adjustment
 *    this screen has ever made to THIS account is listed right below it
 *    (`recent_adjustments`) — an operator about to top up the wrong
 *    person sees, in the same view, whether that account has already
 *    been touched.
 */

function formatUsageWhen(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

type Direction = 'add' | 'subtract';

export function AdminCredits() {
  const { t, lang } = useLanguage();
  const queryClient = useQueryClient();

  const [queryInput, setQueryInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [amountText, setAmountText] = useState('');
  const [direction, setDirection] = useState<Direction>('add');
  const [noteText, setNoteText] = useState('');

  const usersQuery = useQuery({
    queryKey: ['admin', 'ai', 'users', submittedQuery],
    queryFn: () => adminListAIUsers(submittedQuery),
    retry: false,
  });

  const userDetailQuery = useQuery<AdminAIUserDetail>({
    queryKey: ['admin', 'ai', 'user', selectedId],
    queryFn: () => adminGetAIUser(selectedId as string),
    enabled: selectedId !== null,
    retry: false,
  });

  const adjustMutation = useMutation({
    mutationFn: (input: { id: string; deltaMicro: number; note: string }) =>
      adminAdjustCredit(input.id, input.deltaMicro, input.note),
    onSuccess: () => {
      setAmountText('');
      setNoteText('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ai', 'user', selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ai', 'users'] });
    },
  });

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedQuery(queryInput.trim());
  }

  const microAmount = parseCreditsToMicro(amountText);
  const noteFilled = noteText.trim() !== '';
  const canSubmitAdjust = selectedId !== null && microAmount !== null && noteFilled && !adjustMutation.isPending;

  function handleAdjustSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitAdjust || microAmount === null || selectedId === null) return;
    const deltaMicro = direction === 'subtract' ? -microAmount : microAmount;
    adjustMutation.mutate({ id: selectedId, deltaMicro, note: noteText });
  }

  return (
    <div className="admin-page">
      <AdminNav />
      <div className="admin-header">
        <h1 className="ch-title">{t('admin.ai.credits.title')}</h1>
        <p className="ch-lede">{t('admin.ai.credits.lede')}</p>
      </div>

      <form className="admin-upload" onSubmit={handleSearchSubmit}>
        <div className="admin-upload-row">
          <label className="admin-upload-field">
            <span>{t('admin.ai.credits.searchLabel')}</span>
            <input
              type="text"
              value={queryInput}
              placeholder={t('admin.ai.credits.searchPlaceholder')}
              onChange={(event) => setQueryInput(event.target.value)}
              data-testid="admin-ai-search-input"
            />
          </label>
          <button type="submit" className="btn primary">
            {t('admin.ai.credits.searchButton')}
          </button>
        </div>
      </form>

      {usersQuery.isPending && <p className="admin-note">{t('admin.ai.credits.loading')}</p>}
      {usersQuery.isError && (
        <p className="admin-note" role="alert">
          {describeAdminAIError(usersQuery.error, t)}
        </p>
      )}
      {usersQuery.isSuccess && usersQuery.data.length === 0 && (
        <p className="admin-note" data-testid="admin-ai-users-empty">
          {t('admin.ai.credits.empty')}
        </p>
      )}
      {usersQuery.isSuccess && usersQuery.data.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.ai.credits.colEmail')}</th>
              <th>{t('admin.ai.credits.colRole')}</th>
              <th>{t('admin.ai.credits.colBalance')}</th>
              <th>{t('admin.ai.credits.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {usersQuery.data.map((row) => (
              <tr key={row.id}>
                <td data-testid={`ai-user-email-${row.id}`}>{row.email}</td>
                <td>{row.role}</td>
                <td data-testid={`ai-user-balance-${row.id}`}>{formatCredits(row.balance_micro, lang)}</td>
                <td>
                  <button type="button" className="btn" onClick={() => setSelectedId(row.id)}>
                    {t('admin.ai.credits.selectButton')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedId !== null && (
        <section className="admin-ai-detail" data-testid="admin-ai-user-detail">
          {userDetailQuery.isPending && <p className="admin-note">{t('admin.ai.credits.loading')}</p>}
          {userDetailQuery.isError && (
            <p className="admin-note" role="alert">
              {describeAdminAIError(userDetailQuery.error, t)}
            </p>
          )}
          {userDetailQuery.isSuccess && (
            <>
              <h2 className="admin-upload-heading" data-testid="admin-ai-detail-email">
                {userDetailQuery.data.email}
              </h2>

              <dl className="set-stats" aria-label={t('admin.ai.credits.colBalance')}>
                <div className="set-stat">
                  <dt className="set-stat-v" data-testid="admin-ai-detail-balance">
                    {formatCredits(userDetailQuery.data.balance_micro, lang)}
                  </dt>
                  <dd className="set-stat-k">{t('admin.ai.credits.colBalance')}</dd>
                </div>
              </dl>

              <form className="admin-ai-adjust-form" data-testid="admin-ai-adjust-form" onSubmit={handleAdjustSubmit}>
                <h3 className="set-eyebrow">{t('admin.ai.credits.adjustTitle')}</h3>
                <div className="admin-upload-row">
                  <label className="admin-upload-field">
                    <span>{t('admin.ai.credits.amountLabel')}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amountText}
                      onChange={(event) => setAmountText(event.target.value)}
                      data-testid="admin-ai-amount-input"
                    />
                  </label>
                  <label className="admin-upload-field">
                    <span>{t('admin.ai.credits.directionLabel')}</span>
                    <select
                      value={direction}
                      onChange={(event) => setDirection(event.target.value as Direction)}
                      data-testid="admin-ai-direction-select"
                    >
                      <option value="add">{t('admin.ai.credits.directionAdd')}</option>
                      <option value="subtract">{t('admin.ai.credits.directionSubtract')}</option>
                    </select>
                  </label>
                </div>
                <label className="admin-upload-field">
                  <span>{t('admin.ai.credits.noteLabel')}</span>
                  <textarea
                    value={noteText}
                    placeholder={t('admin.ai.credits.notePlaceholder')}
                    onChange={(event) => setNoteText(event.target.value)}
                    data-testid="admin-ai-note-input"
                  />
                </label>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={!canSubmitAdjust}
                  data-testid="admin-ai-adjust-submit"
                >
                  {adjustMutation.isPending ? t('admin.ai.credits.adjustSubmitting') : t('admin.ai.credits.adjustSubmit')}
                </button>
                {adjustMutation.isError && (
                  <p className="admin-note" role="alert" data-testid="admin-ai-adjust-error">
                    {describeAdminAIError(adjustMutation.error, t)}
                  </p>
                )}
                {adjustMutation.isSuccess && (
                  <p className="admin-note" role="status" data-testid="admin-ai-adjust-success">
                    {t('admin.ai.credits.adjustSuccess')}
                  </p>
                )}
              </form>

              <h3 className="set-eyebrow">{t('admin.ai.credits.usageTitle')}</h3>
              {userDetailQuery.data.recent_usage.length === 0 ? (
                <p className="admin-note" data-testid="admin-ai-usage-empty">
                  {t('admin.ai.credits.usageEmpty')}
                </p>
              ) : (
                <div className="set-usage-scroll">
                  <table className="set-usage-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('settings.ai.usageColWhen')}</th>
                        <th scope="col">{t('settings.ai.usageColModel')}</th>
                        <th scope="col">{t('settings.ai.usageColTokensIn')}</th>
                        <th scope="col">{t('settings.ai.usageColTokensCached')}</th>
                        <th scope="col">{t('settings.ai.usageColTokensOut')}</th>
                        <th scope="col">{t('settings.ai.usageColToolCalls')}</th>
                        <th scope="col">{t('settings.ai.usageColWebSearches')}</th>
                        <th scope="col">{t('settings.ai.usageColCredits')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userDetailQuery.data.recent_usage.map((entry, index) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <tr key={index}>
                          <td>{formatUsageWhen(entry.at)}</td>
                          <td>{entry.model}</td>
                          <td>{entry.in_tokens}</td>
                          <td>{entry.cached_in_tokens}</td>
                          <td>{entry.out_tokens}</td>
                          <td>{entry.tool_calls}</td>
                          <td>{entry.web_searches}</td>
                          <td>{formatCredits(entry.credits_charged, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h3 className="set-eyebrow">{t('admin.ai.credits.adjustmentsTitle')}</h3>
              {userDetailQuery.data.recent_adjustments.length === 0 ? (
                <p className="admin-note" data-testid="admin-ai-adjustments-empty">
                  {t('admin.ai.credits.adjustmentsEmpty')}
                </p>
              ) : (
                <div className="set-usage-scroll">
                  <table className="set-usage-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('settings.ai.usageColWhen')}</th>
                        <th scope="col">{t('admin.ai.credits.colNote')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userDetailQuery.data.recent_adjustments.map((entry, index) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <tr key={index}>
                          <td>{formatUsageWhen(entry.at)}</td>
                          <td data-testid={`admin-ai-adjustment-note-${index}`}>{entry.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

export default AdminCredits;
