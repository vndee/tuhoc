import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { Part } from './types';

export interface CourseNavProps {
  courseId: string;
  parts: readonly Part[];
  /** Chapter ids the learner has marked as read. Empty until Task 14 wires real progress. */
  doneChapterIds?: ReadonlySet<string>;
  /**
   * The chapter the reader is looking at right now, if any — it gets
   * reader.css's own `a.nav-item.active` treatment.
   *
   * Optional, and `undefined` everywhere except the reading-mode drawer
   * (`reader/TocDrawer.tsx`), which is the one caller that HAS a current
   * chapter: `CourseHome` is a table of contents for a course nobody has
   * opened yet, and the sidebar's copy is not rendered in reading mode at
   * all. A list that highlights nothing is right in those two places, and a
   * drawer you opened from inside a chapter that does not say which chapter
   * you are in is a table of contents with the "you are here" torn off.
   */
  currentChapterId?: string;
}

const EMPTY_DONE: ReadonlySet<string> = new Set();

/**
 * Chapter list markup shared by `CourseHome` (in-page table of contents)
 * and `Sidebar` (persistent nav / mobile drawer) — one place to keep
 * `.nav-part` / `a.nav-item` / `.nav-num` in sync with reader.css, and one
 * place for Task 14 to feed real progress into via `doneChapterIds`
 * without either caller having to restructure its markup.
 *
 * Every chapter link carries `data-ch="<chapterId>"` and gets the `done`
 * class when its id is in `doneChapterIds` — Ruling F4: the markup contract
 * is this task's (Task 10), the real progress data is Task 14's, and
 * Task 17's e2e test is what asserts the two line up end-to-end.
 *
 * `border-bottom:none` is not repeated here: reader.css's own
 * `a.nav-item{...border-bottom:none}` rule (it already beats the later
 * generic `a{border-bottom:1px solid ...}` rule by specificity) covers it,
 * since every link below carries the `nav-item` class.
 */
export function CourseNav({ courseId, parts, doneChapterIds = EMPTY_DONE, currentChapterId }: CourseNavProps) {
  return (
    <>
      {parts.map((part, partIndex) => (
        // Index + title, not title alone: two parts sharing a title (an
        // empty/duplicate section, say) would otherwise collide on key.
        <Fragment key={`${partIndex}-${part.title}`}>
          <div className="nav-part">{part.title}</div>
          {part.chapters.map((chapter) => (
            <Link
              key={chapter.id}
              to={`/c/${courseId}/${chapter.id}`}
              className={
                ['nav-item', doneChapterIds.has(chapter.id) ? 'done' : '', chapter.id === currentChapterId ? 'active' : '']
                  .filter(Boolean)
                  .join(' ')
              }
              // `aria-current="page"` alongside the class, not instead of it:
              // reader.css paints `.active`, and a colour is not an
              // announcement — a screen reader gets nothing out of it.
              aria-current={chapter.id === currentChapterId ? 'page' : undefined}
              data-ch={chapter.id}
            >
              <span className="nav-num">{chapter.num || '·'}</span>
              <span>{chapter.short}</span>
            </Link>
          ))}
        </Fragment>
      ))}
    </>
  );
}
