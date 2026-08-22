import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RATING_STARS, type RatingSummary, describeRatingError, putRating } from '../api/ratings';
import { useLanguage } from '../i18n/LanguageProvider';

/**
 * One course's rating: what everybody thinks, and what this reader said.
 *
 * ## Where this may be mounted, and why that is a privacy rule
 *
 * **Only on a screen where every row came from the registry's `index.json`.**
 * Today that is exactly one screen, `registry/Catalog.tsx`, and
 * `registry/ratingFence.test.tsx` holds the list to it in both directions —
 * a file that starts drawing stars without being in the ledger goes red, and
 * so does a ledger entry that stopped drawing them.
 *
 * The rule is not a styling preference. Ratings exist to compare courses
 * *between* readers, which a private course or one imported from a file has
 * nothing to be compared against — and more sharply: `apps/api` cannot tell
 * a registry id from a private one (it never reads the registry, and
 * `TestAPIProductCodeMakesNoOutboundCall` is why it never can). Its barrier
 * is therefore *"no route enumerates"*, and that only holds while clients
 * ask about ids they already had from the public index. The component that
 * could break it is this one.
 *
 * ## Two numbers, always both
 *
 * 5.0 from one vote and 5.0 from two hundred are the same number and not the
 * same information — `ratingResponse`'s own comment on the Go side says so.
 * The count is never optional here, and `Rating.test.tsx` measures that by
 * rendering both cases and requiring the two screens to DIFFER, rather than
 * by looking for a substring that could turn up anywhere.
 *
 * ## What is deliberately absent
 *
 * No voter, ever. Not a name, not a count of "people you follow", not a
 * relative time of somebody else's vote. `assertRatings` makes that
 * structural rather than a habit: after the boundary there is no field here
 * that could hold one.
 */
export function Rating({ registryId, summary }: { registryId: string; summary: RatingSummary }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const vote = useMutation({
    mutationFn: (stars: number) => putRating(registryId, stars),
    // Prefix invalidation: `ratingsQueryKey` is `['ratings', <sorted ids>]`,
    // and a vote changes the aggregate that every catalog page holding this
    // id is showing. Invalidating the prefix rather than one exact key is
    // what keeps this component from needing to know which page it is on —
    // a prop the tests would always pass and production sometimes would not.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ratings'] }),
  });

  /**
   * Which star is filled in right now.
   *
   * `vote.variables` (what the reader just clicked) wins over the server's
   * `mine` while the write is in flight and until the refetch lands —
   * otherwise the star would spring back for a moment and read as "it did
   * not take". On failure it does NOT win: the reader's vote is not on the
   * server, and showing it as though it were is the one lie this widget
   * could tell that matters.
   */
  const chosen = vote.variables !== undefined && !vote.isError ? vote.variables : summary.mine;

  return (
    <div className="lib-meta rating">
      <span className="rating-summary" data-testid={`rating-summary-${registryId}`}>
        {summary.count === 0 ? t('rating.none') : t('rating.summary', summary.average, summary.count)}
      </span>

      {/*
        A real `<fieldset>` + `<legend>`, not a row of `<button>`s with an
        `aria-label`: five mutually exclusive choices ARE a radio group, so
        the browser gives arrow-key navigation, a single tab stop and the
        right screen-reader announcement for free — and `Rating.test.tsx`
        asks for them by role, which is the shape a reader actually meets.
      */}
      <fieldset className="rating-stars" disabled={vote.isPending}>
        <legend>{t('rating.yourVote')}</legend>
        {RATING_STARS.map((stars) => (
          <label key={stars} className="rating-star">
            <input
              type="radio"
              name={`rating-${registryId}`}
              value={stars}
              checked={chosen === stars}
              onChange={() => vote.mutate(stars)}
            />
            {t('rating.star', stars)}
          </label>
        ))}
      </fieldset>

      {vote.isPending && <span role="status">{t('rating.saving')}</span>}
      {vote.isSuccess && <span role="status">{t('rating.saved')}</span>}
      {/*
        `role="alert"` and a sentence, never a silent revert. A vote that did
        not land while the star quietly snapped back is indistinguishable
        from a vote that landed and then was undone by somebody else — and
        507 in particular is a state the reader can act on, which is why
        `describeRatingError` gives it words of its own.
      */}
      {vote.isError && (
        <span role="alert" className="lib-notice-server">
          {describeRatingError(vote.error, t)}
        </span>
      )}
    </div>
  );
}

export default Rating;
