/**
 * What order the catalog lists courses in, once ratings are known.
 *
 * ## Why not the plain average
 *
 * Spec §5 and the plan both say *"sorted by average **and** vote count"*, and
 * the reason is one line of arithmetic: a plain average puts **5.0 from a
 * single vote** above **4.8 from two hundred**. One new account, one click,
 * top of the catalog — on a screen whose whole purpose is to help a stranger
 * decide which package to run on their own machine.
 *
 * So the sort key is the average **shrunk toward the middle in proportion to
 * how little is known about it**:
 *
 *     score = (C·m + Σ votes) / (C + n)
 *
 * With `n = 0` it is exactly `m`; as `n` grows it converges on the true
 * average. This is the ordinary Bayesian/shrinkage estimator, not an
 * invention, and its only two knobs are below.
 *
 * ## The two constants are a CHOICE, not a measurement — said plainly
 *
 * Nothing has been measured about this platform's real rating distribution,
 * because there are no real ratings yet: there is no public registry
 * repository at all today (`docs/deploy.md` §5c). `PRIOR_MEAN` is the middle
 * of the 1..5 scale and `PRIOR_COUNT` is "about five votes of doubt", which
 * is small enough that a genuinely popular course reaches the top quickly and
 * large enough that a single vote cannot. `order.test.ts` pins the PROPERTY
 * these numbers were chosen for, not the numbers themselves — so tuning them
 * later is a decision somebody makes on purpose, with a test that says what
 * must remain true.
 */

import type { RatingSummary } from '../api/ratings';
import type { RegistryEntry } from './types';

/**
 * The score an unrated course gets, and the value every score is pulled
 * toward. The midpoint of the 1..5 scale.
 *
 * It matters that this is NOT 0: an unrated course would then rank below a
 * course two hundred people called bad, which reads as an accusation the
 * data never made. And it is not 5: a brand-new package would open at the
 * top of the catalog, which is the failure this whole file exists to avoid.
 */
export const PRIOR_MEAN = 3;

/** How many votes of doubt every course starts with. See the header. */
export const PRIOR_COUNT = 5;

/** The sort key for one course. `undefined` = nobody has voted (or ratings are unknown). */
export function ratingScore(summary: RatingSummary | undefined): number {
  if (summary === undefined || summary.count <= 0) return PRIOR_MEAN;
  return (PRIOR_COUNT * PRIOR_MEAN + summary.average * summary.count) / (PRIOR_COUNT + summary.count);
}

/**
 * The catalog's rows, highest score first.
 *
 * **Stable, and that is load-bearing rather than tidy.** Every row carries a
 * "pull into my library" button, and pulling an `interactive` package means
 * agreeing to run somebody else's JavaScript. Two equally-scored courses that
 * swapped places between renders would mean the row under the cursor is not
 * necessarily the row that was read — so ties keep the registry's own order,
 * which `Array.prototype.sort` guarantees (stable since ES2019).
 *
 * A copy, never in place: `courses` is `query.data.courses`, which TanStack
 * Query hands back by reference and reuses. Sorting it would reorder the
 * cache itself, and the next consumer would see an order this screen chose.
 */
export function orderByRating(
  courses: readonly RegistryEntry[],
  ratings: ReadonlyMap<string, RatingSummary>,
): RegistryEntry[] {
  return [...courses].sort((a, b) => ratingScore(ratings.get(b.id)) - ratingScore(ratings.get(a.id)));
}
