import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { CourseNav } from '../course/CourseNav';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';

export interface SidebarProps {
  /** Chapter ids the learner has marked as read. Empty until Task 14 wires real progress. */
  doneChapterIds?: ReadonlySet<string>;
}

// `/c/:courseId` and `/c/:courseId/:chapterId` both carry a course outline
// in the sidebar — pulled from the pathname directly (not `useParams`,
// which only sees params of a *matched* <Route>, and Sidebar is chrome
// rendered alongside <AppRoutes>, not inside it).
function courseIdFromPathname(pathname: string): string | undefined {
  return /^\/c\/([^/]+)/.exec(pathname)?.[1];
}

/**
 * Sidebar chrome: `.sb-head` (title/subtitle/search), `.sb-prog`, and
 * `nav#nav`. `nav#nav` shows the real course outline (Task 10) — the same
 * `CourseNav` markup CourseHome uses, sharing its TanStack Query cache key
 * so visiting a course only fetches its manifest once. `#nav` always has
 * *something* in it (reader.css's own `.nav-empty` style, reused for all
 * three non-content states so no new class is needed): no course selected,
 * still loading, or failed — a failed/loading fetch must not render as
 * silent emptiness, which is indistinguishable from "still loading forever"
 * and disagrees with `CourseHome` showing a real error right next to it.
 * Live progress numbers and working search are still Task 13's job.
 */
export function Sidebar({ doneChapterIds }: SidebarProps) {
  const location = useLocation();
  const courseId = courseIdFromPathname(location.pathname);

  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId ?? ''),
    queryFn: () => loadManifest(courseId as string),
    enabled: courseId != null,
  });

  return (
    <>
      <div className="sb-head">
        <p className="sb-title">
          <svg
            className="mark"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect width="20" height="20" rx="5" fill="var(--accent)" />
            <path d="M5 10.5L8.5 14L15 6.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Tự học
        </p>
        <p className="sb-sub">***REMOVED***</p>
        <div className="sb-search">
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M18 18L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input id="nav-search" type="text" placeholder="Tìm chương…" disabled />
        </div>
      </div>
      <div className="sb-prog">Tiến độ sẽ hiện ở đây</div>
      <nav id="nav">
        {courseId == null && <p className="nav-empty">Chưa có khóa học nào được tải.</p>}
        {courseId != null && manifestQuery.isPending && <p className="nav-empty">Đang tải khóa học…</p>}
        {courseId != null && manifestQuery.isError && (
          <p className="nav-empty">{describeCourseError(manifestQuery.error)}</p>
        )}
        {courseId != null && manifestQuery.data && (
          <CourseNav courseId={courseId} parts={manifestQuery.data.parts} doneChapterIds={doneChapterIds} />
        )}
      </nav>
    </>
  );
}
