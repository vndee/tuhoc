import { useQuery } from '@tanstack/react-query';
import { NavLink, useLocation } from 'react-router-dom';
import { useMe } from '../api/useMe';
import { CourseNav } from '../course/CourseNav';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
import { useProgress } from '../progress/useProgress';

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
 * Live progress numbers and working search are still a later task's job.
 * `doneChapterIds` (Ruling F4 / debt #1) comes from `useProgress`, called
 * unconditionally with `courseId ?? ''` for the same reason `CourseHome`
 * does — see that component's doc comment.
 */
/**
 * The app's ONLY global navigation, and the reason it had to be added here.
 *
 * Before this, `/library` and `/import` were reachable from exactly one place
 * each: two buttons in the Dashboard's header. From a chapter, from
 * `/import`, or from the library itself, the way to any other screen was the
 * browser's back button or typing a URL. Task 9's brief listed `shell/` under
 * "Modify: … (điều hướng)" and it was not modified — a grep for
 * `Link|to=|href` across all four `shell/` files returned nothing at all.
 *
 * In the sidebar rather than the topbar because the topbar's six ids are
 * reproduced byte-for-byte from the v1 reader for `reader.css` (see
 * `Shell`'s own doc), and because `#menu-btn` already brings the sidebar out
 * as a drawer on mobile, so this is reachable at every width without a
 * second responsive rule.
 *
 * Hidden while signed out: `AppShell` renders on `/login` too, and offering a
 * link that can only bounce back to the page you are on is worse than
 * offering nothing. `useMe` is the same cached query `RequireAuth` reads, so
 * asking costs no request.
 */
function GlobalNav() {
  const meQuery = useMe();
  if (!meQuery.data) return null;

  return (
    <nav className="sb-nav" aria-label="Điều hướng chính">
      <NavLink to="/" end className="sb-nav-link">
        Bảng điều khiển
      </NavLink>
      <NavLink to="/library" className="sb-nav-link">
        Thư viện
      </NavLink>
      <NavLink to="/import" className="sb-nav-link">
        Nhập khóa học
      </NavLink>
    </nav>
  );
}

export function Sidebar() {
  const location = useLocation();
  const courseId = courseIdFromPathname(location.pathname);

  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId ?? ''),
    queryFn: () => loadManifest(courseId as string),
    enabled: courseId != null,
  });
  const { doneChapterIds } = useProgress(courseId ?? '');

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
      <GlobalNav />
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
