/**
 * One-column card stacking (P2 Task 6) — the arithmetic behind the margin
 * cards, kept apart from `./MarginCards` because it is the only part of that
 * feature that can be judged without a layout engine.
 *
 * The problem it solves: a reader's notes cluster. Two highlights on adjacent
 * lines are 20 px apart on the page, and two cards are 60–120 px tall, so
 * placing every card at its highlight's Y draws them on top of each other and
 * the column becomes unreadable exactly where the reader was busiest. The
 * rule below is the standard margin-note answer, and it is chosen for two
 * properties rather than for cleverness:
 *
 *   1. **A card never moves UP.** `top >= y` always, so a card is never drawn
 *      above the words it annotates and the connector line never points
 *      backwards. Cards only ever slide DOWN into free space.
 *   2. **The reader's order is never rearranged.** The stack is computed in
 *      ascending Y and each card is pushed below the previous one's bottom,
 *      so a note that comes later in the chapter can never end up above an
 *      earlier one — even when it was pushed hundreds of pixels.
 *
 * The alternative (centre the cluster, moving cards both up and down) reads
 * better in a mock-up and worse on a page: it moves cards away from content
 * the reader is looking at, and it makes the top of the column jump whenever
 * a note is added anywhere below it.
 *
 * The function is pure and takes numbers, not elements: `y` is where the
 * highlight is, `height` is how tall the card renders. Both come from the
 * caller's own measurement pass — see `MarginCards.tsx`, which reads `y` from
 * `highlightRects` (DOCUMENT coordinates, ruling from Task 3) and `height`
 * from the rendered card. Mixing in viewport coordinates here would produce a
 * column that is correct at one scroll offset and drifts at every other,
 * which is exactly the failure the document-coordinate choice was made to
 * avoid.
 */

/** One card's inputs: where it wants to be, and how much room it needs. */
export interface CardMeasure {
  readonly id: string;
  /** Top of the card's anchor, in whatever coordinate space the caller uses
   * consistently — `MarginCards` uses pixels below the top of the card
   * column, derived from document coordinates. */
  readonly y: number;
  /** Rendered height of the card, in the same units. */
  readonly height: number;
}

/** Where one card ends up. Returned in the INPUT order, so the caller can zip
 * it with its own list by index. */
export interface CardPlacement {
  readonly id: string;
  readonly top: number;
}

/** Vertical breathing room between two stacked cards, in px. */
export const DEFAULT_GAP = 10;

/**
 * Places every card in one column: sorted by `y`, each card at its own `y` or
 * just below the previous card's bottom, whichever is lower.
 *
 * Returns one placement per input item, **in the input's own order** — the
 * sort is an implementation detail of the stacking, not a reordering of the
 * caller's list. Ties in `y` keep input order (the sort is stable, and the
 * input order is document order when it comes from `useAnnotations`'s
 * `list`), because two notes on the same line have nothing else to be ordered
 * by and "the order flickers when two notes share a line" is a bug a reader
 * would see.
 *
 * Does not mutate `items`.
 */
export function layoutCards(items: readonly CardMeasure[], gap: number = DEFAULT_GAP): CardPlacement[] {
  if (items.length === 0) return [];

  // Sort a list of INDICES rather than the items: it keeps `items` untouched
  // and gives the result back in input order for free.
  const order = items.map((_, index) => index);
  order.sort((a, b) => (items[a].y !== items[b].y ? items[a].y - items[b].y : a - b));

  const tops = new Array<number>(items.length);
  let previousBottom = Number.NEGATIVE_INFINITY;
  for (const index of order) {
    const item = items[index];
    const top = Math.max(item.y, previousBottom + gap);
    tops[index] = top;
    previousBottom = top + item.height;
  }

  return items.map((item, index) => ({ id: item.id, top: tops[index] }));
}
