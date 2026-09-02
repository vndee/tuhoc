import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { catalogQueryKey, fetchCatalog } from '../api/catalog';
import { describeCourseError } from '../course/loader';
import { useLanguage } from '../i18n/LanguageProvider';

/**
 * `/courses` — MỘT danh mục công khai, không gì khác.
 *
 * Đặc tả: `docs/superpowers/specs/2026-08-25-server-side-pivot.md` §1, §2.4.
 * Bản trước gộp ba màn cũ (thư viện riêng, kho cộng đồng, nhập gói) thành một
 * nơi chốn với hai tab và một nút — đúng cho một thế giới nơi mỗi người đọc
 * giữ gói riêng trên máy mình. Thế giới ấy đã hết: server là nguồn DUY NHẤT
 * của mọi course (`tuhoc publish`, không phải `/import`), đọc công khai
 * không cần tài khoản, và không có khái niệm "khoá học CỦA BẠN" để tách khỏi
 * "kho cộng đồng" nữa — chỉ còn MỘT danh mục, ai cũng thấy y hệt nhau.
 *
 * Nên màn hình này không còn gì để chọn: không tab, không nút "Nhập gói",
 * không hộp thoại. `fetchCatalog` (Task 10, `api/catalog.ts`) là NGUỒN DUY
 * NHẤT nó đọc — không `db.packages` (đã gỡ), không `GET /stats`, không
 * `useOwnedCourses` (khái niệm "sở hữu" không còn áp dụng cho một danh mục ai
 * cũng đọc được). Mỗi hàng là `{slug, title, description}` thẳng từ server;
 * không có trường `tier` để vẽ nhãn hạng — format v2 bỏ hẳn nó (xem
 * `api/courses.ts`'s chú thích về `TIER_REMOVED`), vì "hạng interactive" —
 * JavaScript tự do trong chương — bị khai tử cùng lúc (spec §2.3).
 *
 * `describeCourseError` (`course/loader.ts`) là chỗ DUY NHẤT tệp này cần cho
 * việc dịch lỗi mạng: nó đã phân biệt "máy chủ trả lời nhưng báo lỗi" với
 * "không có phản hồi nào" (ruling S1-F25 — một CORS hỏng trông y hệt mất
 * mạng ở tầng `fetch`), nên màn hình này không cần tự viết lại phép phân
 * biệt ấy lần nữa.
 */
export function Courses() {
  const { t } = useLanguage();
  const query = useQuery({
    queryKey: catalogQueryKey(),
    queryFn: fetchCatalog,
    retry: false,
  });

  return (
    <div className="courses-page doc">
      {/* Đầu trang theo khung `.doc` (home.css): serif thường, câu dẫn nghiêng,
          hairline mực — không mượn `.ch-title` của reader.css nữa, lớp ấy là
          tiêu đề CHƯƠNG trong chế độ đọc và mang cỡ sans đậm của nó. */}
      <header className="doc-head">
        <h1 className="doc-title">{t('courses.title')}</h1>
        <p className="doc-lede">{t('courses.lede')}</p>
      </header>

      {query.isPending && <p className="courses-note">{t('courses.loading')}</p>}
      {query.isError && <p className="courses-note">{describeCourseError(query.error, t)}</p>}

      {query.isSuccess && query.data.length === 0 && <p className="courses-note">{t('courses.empty')}</p>}

      {query.isSuccess && query.data.length > 0 && (
        <ul className="courses-list" aria-label={t('courses.list.aria')}>
          {query.data.map((course) => (
            <li key={course.slug} className="courses-item">
              <Link to={`/c/${course.slug}`} className="courses-item-link">
                <h2 className="courses-item-title">{course.title}</h2>
                {course.description !== '' && <p className="courses-item-desc">{course.description}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default Courses;
