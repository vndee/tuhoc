import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RATING_STARS, type RatingSummary, describeRatingError, putRating } from '../api/ratings';
import { useLanguage } from '../i18n/LanguageProvider';

/**
 * One course's rating: what everybody thinks, and what this reader said.
 *
 * ## Not mounted anywhere right now — read before you re-mount it
 *
 * The server-side pivot's Task 13 deleted `registry/Catalog.tsx`, the only
 * screen that ever rendered this component, and `registry/ratingFence.test.tsx`
 * with it. Nothing in the app currently imports `Rating`. It was left in
 * place on purpose, not deleted as dead code: its backend (`PUT`/`GET
 * /ratings`) is live and unchanged, and this is UI waiting for a future task
 * to give it a home, not a component this platform is done with.
 *
 * ## The mounting rule this component USED to lean on, and why it is now MOOT
 *
 * Verbatim, for the record, what this header said before Task 16 of the
 * server-side pivot: *only mount on a screen where every row came from the
 * registry's `index.json`*. The reasoning was that `apps/api` could not tell
 * a registry id from a private one — it never read the registry — so its
 * only barrier against leaking one reader's private/imported course id to
 * another was *"no route enumerates,"* which held only as long as every
 * client asked about ids it already had from the public index. `Rating` was
 * the one component that could have broken that barrier, by asking the API
 * about an id nobody was supposed to have a reason to guess.
 *
 * **There is no "private id" left for that rule to be about.** Course
 * import, the per-reader library, and the public/private registry split it
 * all rested on are gone (Task 9/13); every published course now lives in
 * one public catalog, directly enumerable with no auth at all via `GET
 * /courses` (spec `2026-08-25-server-side-pivot.md` §2.4). So this is not a
 * protection a future re-mount inherits for free — there is nothing left to
 * inherit. Read this as "the guard used to matter, and no longer does,"
 * never as "the guard still holds."
 *
 * **What an actual re-mount needs to think through, fresh, not assumed from
 * this comment:** whether every browsable course should carry a rating
 * widget (plausible now that there is no private tier to exclude, but that
 * is a product call, not a fact this file can settle); and, separately and
 * still very much live, whether the no-voter-leak property below
 * (`assertRatings`) still holds at whatever the new call site turns out to
 * be — that part of this component's contract has nothing to do with WHERE
 * it is mounted, and needs no rethinking on that account.
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
