import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { Part } from './types';

export interface CourseNavProps {
  courseId: string;
  parts: Part[];
  /** Chapter ids the learner has marked as read. Empty until Task 14 wires real progress. */
  doneChapterIds?: ReadonlySet<string>;
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
 * class when its id is in `doneChapterIds` — Ruling F4: Task 17's e2e test
 * depends on this exact attribute/class pair.
 *
 * `border-bottom:none` is not repeated here: reader.css's own
 * `a.nav-item{...border-bottom:none}` rule (it already beats the later
 * generic `a{border-bottom:1px solid ...}` rule by specificity) covers it,
 * since every link below carries the `nav-item` class.
 */
export function CourseNav({ courseId, parts, doneChapterIds = EMPTY_DONE }: CourseNavProps) {
  return (
    <>
      {parts.map((part) => (
        <Fragment key={part.title}>
          <div className="nav-part">{part.title}</div>
          {part.chapters.map((chapter) => (
            <Link
              key={chapter.id}
              to={`/c/${courseId}/${chapter.id}`}
              className={doneChapterIds.has(chapter.id) ? 'nav-item done' : 'nav-item'}
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
