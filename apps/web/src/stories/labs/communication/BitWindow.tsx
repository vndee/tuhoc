import type { Lang } from '../../../i18n';
import type { Bits } from './types';
import { communicationCopy } from './copy';

const BITS_PER_PAGE = 64;

export interface BitWindowProps {
  bits: Bits;
  lang: Lang;
  page: number;
  onPage: (page: number) => void;
  flipped: readonly number[];
  onFlip?: (index: number) => void;
}

/** Renders only the selected payload window; bit indices remain absolute. */
export function BitWindow({ bits, lang, page, onPage, flipped, onFlip }: BitWindowProps) {
  const copy = communicationCopy[lang];
  const pageCount = Math.max(1, Math.ceil(bits.length / BITS_PER_PAGE));
  const requestedPage = Number.isSafeInteger(page) ? page : 0;
  const safePage = Math.min(Math.max(requestedPage, 0), pageCount - 1);
  const start = safePage * BITS_PER_PAGE;
  const end = Math.min(start + BITS_PER_PAGE, bits.length);
  const flippedBits = new Set(flipped);
  const range = bits.length === 0
    ? copy.noBits
    : copy.bitRange(start + 1, end, bits.length);

  return <section className="communication-bit-window" aria-label={copy.bits}>
    <p>{range}</p>
    <div className="communication-bit-cells">
      {bits.slice(start, end).map((bit, offset) => {
        const absoluteIndex = start + offset;
        const isFlipped = flippedBits.has(absoluteIndex);
        const label = copy.bitLabel(absoluteIndex + 1, bit, isFlipped);
        return <button
          type="button"
          key={absoluteIndex}
          aria-label={label}
          aria-pressed={isFlipped}
          disabled={onFlip === undefined}
          onClick={() => onFlip?.(absoluteIndex)}
        >
          <span aria-hidden="true">{bit}</span>
        </button>;
      })}
    </div>
    <nav aria-label={copy.bits}>
      <button type="button" disabled={safePage === 0} onClick={() => onPage(safePage - 1)}>{copy.previousBits}</button>
      <button type="button" disabled={safePage >= pageCount - 1} onClick={() => onPage(safePage + 1)}>{copy.nextBits}</button>
    </nav>
  </section>;
}
