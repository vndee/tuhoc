import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
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
 * `doneChapterIds` (Ruling F4 / debt #1) comes from `useProgress`, called on
 * EVERY render (React's rules of hooks — `Sidebar` is chrome rendered on
 * every route, not just course ones, so there is no `if` to hide it behind)
 * but only actually FETCHES once a session is confirmed
 * (`useProgress`'s own `enabled` option — see its doc for the bug this
 * closes: an unconditional `GET /progress` on every page, including
 * `/login` itself, that 401s and hard-redirects a signed-out visitor).
 */
/*
 * ĐIỀU HƯỚNG CHUNG ĐÃ RỜI KHỎI ĐÂY — nay ở `shell/TopNav.tsx`, trên thanh
 * trên. Người dùng yêu cầu: "navigation không nên nằm cùng sidebar với mục
 * lục, chỗ đó nên cho mục lục thôi."
 *
 * Nó KHÔNG biến mất, và `TopNav` giữ nguyên hai tính chất mà bản ở đây có:
 * ẩn khi chưa đăng nhập, và `Cài đặt` vẫn tới được bằng MỘT cú bấm (nay là
 * `AccountChip` ở mép phải thanh trên). Điều kiện thứ hai không thương lượng
 * được: `/settings` chỉ tới được bằng cách gõ URL là đúng hình dạng cổng mù
 * #4 mà chính route ấy sinh ra để vá.
 */

export function Sidebar() {
  const location = useLocation();
  const { t } = useLanguage();
  const courseId = courseIdFromPathname(location.pathname);

  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId ?? ''),
    queryFn: () => loadManifest(courseId as string),
    enabled: courseId != null,
  });
  // Same `useMe()` + `confirmedLoggedIn` shape `CourseHome.tsx`/
  // `ChapterView.tsx` use to gate their own `useProgress` call — see
  // `useProgress`'s `enabled` option doc for why THIS caller needs the
  // gate passed in rather than reached with an `if` around the hook call.
  const me = useMe();
  const confirmedLoggedIn = me.isSuccess && me.data != null;
  const { doneChapterIds } = useProgress(courseId ?? '', { enabled: courseId != null && confirmedLoggedIn });

  // THANH BÊN CHỈ TỒN TẠI KHI CÓ MỘT KHOÁ ĐANG MỞ.
  //
  // Trước đây nó luôn có mặt, và ngoài một khoá thì nó chứa: điều hướng
  // chung, một ô "Tìm chương…" bị `disabled`, dòng "Tiến độ sẽ hiện ở đây",
  // và câu "Chưa có khóa học nào được tải." Tức là một cột rộng 306px nói về
  // một khoá không tồn tại — đo trên màn 1280 thì đó là gần một phần tư bề
  // ngang dành cho lời xin lỗi.
  //
  // `null` chứ không phải ẩn bằng CSS ở phía React: `#sidebar` vẫn do
  // `<Shell>` dựng nên khung DOM mà reader.css bám vào KHÔNG đổi, còn luật
  // thu cột về 0 nằm ở `styles/shell-modes.css` dưới `#app:not(.in-course)`.
  // Trả `null` ở đây chỉ để cây trợ năng không mang một `<aside>` rỗng.
  if (courseId == null) return null;

  const totalChapters = manifestQuery.data?.parts.reduce((n, part) => n + part.chapters.length, 0) ?? 0;
  const doneCount = doneChapterIds.size;

  return (
    <>
      <div className="sb-head">
        {/* MỘT nhan đề, và nó là tên KHOÁ chứ không phải tên app.
            Tên app nay ở nhãn hiệu trên thanh trên; in nó lần nữa ở đây là
            nói hai lần, và nó cướp mất dòng đầu của thứ cột này thực sự nói
            về. Nhãn "Mục lục" ở trên tên khoá để cột tự khai nó là gì. */}
        <p className="sb-eyebrow">{t('reader.toc')}</p>
        {manifestQuery.data && <p className="sb-title">{manifestQuery.data.title}</p>}

        {/* Tiến độ THẬT, thay cho dòng giữ chỗ "Tiến độ sẽ hiện ở đây" — số
            liệu đã nằm sẵn trong `useProgress` và `manifest.parts` từ trước,
            chỉ chưa ai nối hai đầu ấy vào nhau. */}
        {totalChapters > 0 && (
          <div className="sb-prog-bar">
            <div className="sb-prog-track">
              <div
                className="sb-prog-fill"
                style={{ width: `${Math.round((doneCount / totalChapters) * 100)}%` }}
              />
            </div>
            <span className="sb-prog-count">
              {doneCount}/{totalChapters}
            </span>
          </div>
        )}

        <div className="sb-search">
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M18 18L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input id="nav-search" type="text" placeholder={t('sidebar.searchPlaceholder')} disabled />
        </div>
      </div>
      {/*
        `aria-label` MANG TÊN KHOÁ, không phải một nhãn chung như "Mục lục".

        Trang này có HAI vùng điều hướng: thanh trên ("Điều hướng chính") và cột
        này. Hai landmark cùng vai mà không phân biệt được tên thì một người
        dùng trình đọc màn hình phải bước vào từng cái để biết cái nào là cái
        nào — đó chính là điều `aria-label` tồn tại để tránh.

        Tên khoá cũng là thứ `e2e/helpers.ts` (`courseHomeChapterLink`) định vị
        theo, và nó là một phép đo có ý nghĩa chứ không phải một chi tiết bám
        vào: nó hỏi "mục lục CỦA KHOÁ NÀY có chương ấy không". Trước vòng thiết
        kế lại, nhãn ấy nằm trên `<nav>` mà `CourseHome` tự dựng ở giữa màn; khi
        mục lục dồn về một chỗ, nhãn phải đi theo nó.
      */}
      <nav id="nav" aria-label={manifestQuery.data?.title ?? t('reader.toc')}>
        {manifestQuery.isPending && <p className="nav-empty">{t('course.loading')}</p>}
        {manifestQuery.isError && (
          <p className="nav-empty">{describeCourseError(manifestQuery.error, t)}</p>
        )}
        {manifestQuery.data && (
          <CourseNav courseId={courseId} parts={manifestQuery.data.parts} doneChapterIds={doneChapterIds} />
        )}
      </nav>
    </>
  );
}
