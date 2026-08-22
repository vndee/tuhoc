import { useQuery } from '@tanstack/react-query';
import { NavLink, useLocation } from 'react-router-dom';
import { useMe } from '../api/useMe';
import { CourseNav } from '../course/CourseNav';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
import { useLanguage } from '../i18n/LanguageProvider';
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
  const { t } = useLanguage();
  if (!meQuery.data) return null;

  return (
    <nav className="sb-nav" aria-label={t('nav.aria.main')}>
      <NavLink to="/" end className="sb-nav-link">
        {t('nav.dashboard')}
      </NavLink>
      <NavLink to="/library" className="sb-nav-link">
        {t('nav.library')}
      </NavLink>
      <NavLink to="/import" className="sb-nav-link">
        {t('nav.import')}
      </NavLink>
      {/*
        `/catalog` — cùng lý do đã ghi cho `/settings` ngay bên dưới, và cùng
        cái bẫy: một màn hình chỉ tới được bằng cách gõ URL là màn hình không
        ai tới (S1-F29). Đứng ngay sau "Nhập khóa học" vì hai mục ấy trả lời
        cùng một câu hỏi — "lấy khóa học ở đâu" — và registry là câu trả lời mà
        `EmptyLibrary` tới nay mới chỉ hứa bằng một câu văn.
      */}
      <NavLink to="/catalog" className="sb-nav-link">
        {t('nav.catalog')}
      </NavLink>
      {/*
        Không có liên kết này thì `/settings` chỉ tới được bằng cách gõ URL, và
        một trang cấu hình không ai tới được là đúng hình dạng cổng mù #4
        (S1-F29) mà cả route ấy sinh ra để vá.
      */}
      <NavLink to="/settings" className="sb-nav-link">
        {t('settings.ai.title')}
      </NavLink>
    </nav>
  );
}

export function Sidebar() {
  const location = useLocation();
  const { t } = useLanguage();
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
          {t('app.name')}
        </p>
        {/*
          The subtitle names the course that is open, and does not exist when
          none is. It used to be one course's title, written into the JSX —
          right back when the app shipped exactly one course, and a lie on
          every screen after that: on `/library` it read as the name of the
          library itself, on `/import` and the dashboard it named a course
          nobody had opened, and with a different course open it named the
          wrong one.

          Keyed off `manifestQuery.data`, not off `courseId`: a manifest is
          the only thing that knows a course's title (the id in the URL is a
          slug, not a name), so the pending and failed states name nothing
          rather than guess — guessing is how the original bug got in. That
          silence is never the only thing on screen; `#nav` right below says
          out loud which of those two states the sidebar is in.
        */}
        {manifestQuery.data && <p className="sb-sub">{manifestQuery.data.title}</p>}
        <div className="sb-search">
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M18 18L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input id="nav-search" type="text" placeholder={t('sidebar.searchPlaceholder')} disabled />
        </div>
      </div>
      <GlobalNav />
      <div className="sb-prog">{t('sidebar.progressPlaceholder')}</div>
      <nav id="nav">
        {courseId == null && <p className="nav-empty">{t('sidebar.noCourseLoaded')}</p>}
        {courseId != null && manifestQuery.isPending && <p className="nav-empty">{t('course.loading')}</p>}
        {courseId != null && manifestQuery.isError && (
          <p className="nav-empty">{describeCourseError(manifestQuery.error, t)}</p>
        )}
        {courseId != null && manifestQuery.data && (
          <CourseNav courseId={courseId} parts={manifestQuery.data.parts} doneChapterIds={doneChapterIds} />
        )}
      </nav>
    </>
  );
}
