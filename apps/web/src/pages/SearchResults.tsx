import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  chapterHref,
  courseHref,
  fetchSearch,
  isQueryLongEnough,
  isQueryTooLong,
  searchQueryKey,
} from '../api/search';
import { useLanguage } from '../i18n/LanguageProvider';

/**
 * `/search?q=…` — danh sách đầy đủ, chỗ mà "Xem tất cả" ở bảng thả xuống dẫn
 * tới.
 *
 * Trang này tồn tại vì một lý do rất hẹp: một nút "Xem tất cả" cần một nơi để
 * tới. Không có nó thì bảng thả xuống hoặc phải nói "còn N kết quả nữa" mà
 * không cho xem, hoặc phải im lặng cắt bớt — cả hai đều là một phiên bản khác
 * của đúng cái ô `disabled` mà vòng này đang gỡ đi.
 *
 * CÔNG KHAI, không `<RequireAuth>`: endpoint nó gọi cũng vậy, và mọi thứ nó
 * hiện đều đọc được không cần phiên (xem `search.Handler.Search`).
 *
 * Truy vấn nằm ở URL chứ không ở state: một kết quả tìm kiếm là thứ người ta
 * gửi cho nhau, quay lại bằng nút Back, và mở lại từ lịch sử. `useSearchParams`
 * cũng là thứ khiến trang này không cần biết gì về ô nhập ở thanh trên.
 */
export function SearchResults() {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const raw = params.get('q') ?? '';
  const q = raw.trim();
  // Ba trạng thái của chính chuỗi truy vấn, tách khỏi ba trạng thái của lượt
  // gọi mạng. Quá dài là một câu trả lời VĨNH VIỄN — máy chủ trả 400 và sẽ trả
  // 400 mãi — nên nó không được vẽ bằng câu "Thử lại sau một lát", lời khuyên
  // duy nhất không giúp được gì ở đây.
  const tooLong = isQueryTooLong(q);
  const enabled = isQueryLongEnough(q) && !tooLong;

  const query = useQuery({
    queryKey: searchQueryKey(q, PAGE_LIMIT),
    queryFn: () => fetchSearch(q, PAGE_LIMIT),
    enabled,
    retry: false,
    // Cùng lý do như bảng ở thanh trên (`shell/TopNav.tsx`): mặc định
    // `staleTime: 0` biến một lần alt-tab thành một lượt quét toàn bộ.
    staleTime: 30_000,
  });

  const total = (query.data?.courses.length ?? 0) + (query.data?.chapters.length ?? 0);

  return (
    <div className="search-page doc">
      <header className="doc-head">
        <h1 className="doc-title">{t('search.title')}</h1>
        {!enabled && <p className="doc-lede">{t(tooLong ? 'search.tooLong' : 'search.tooShort')}</p>}
        {enabled && query.data && total > 0 && (
          <p className="doc-lede">
            {query.data.truncated
              ? t('search.countTruncated', String(total), q)
              : t('search.count', String(total), q)}
          </p>
        )}
      </header>

      {enabled && query.isPending && <p className="courses-note">{t('search.loading')}</p>}
      {/* `role="alert"` vì đây là một câu TRẢ LỜI SAI nếu bị bỏ qua: một lượt
          tìm hỏng vẽ như "không có kết quả" nói với người dùng rằng thứ họ
          tìm không tồn tại. */}
      {enabled && query.isError && (
        <p className="courses-note" role="alert">
          {t('search.error')}
        </p>
      )}
      {enabled && query.data && total === 0 && (
        <p className="courses-note">{t('search.empty', q)}</p>
      )}

      {query.data && query.data.courses.length > 0 && (
        <section className="search-group">
          <h2 className="search-group-title">{t('search.groupCourses')}</h2>
          <ul className="courses-list">
            {query.data.courses.map((c) => (
              <li key={c.slug} className="courses-item">
                <Link to={courseHref(c.slug)} className="courses-item-link">
                  <h3 className="courses-item-title">{c.title}</h3>
                  {c.description !== '' && <p className="courses-item-desc">{c.description}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {query.data && query.data.chapters.length > 0 && (
        <section className="search-group">
          <h2 className="search-group-title">{t('search.groupChapters')}</h2>
          <ul className="courses-list">
            {query.data.chapters.map((c) => (
              <li key={`${c.slug}:${c.chapterId}`} className="courses-item">
                <Link to={chapterHref(c.slug, c.chapterId)} className="courses-item-link">
                  <h3 className="courses-item-title">{c.chapterTitle}</h3>
                  <p className="search-hit-course">{t('search.inCourse', c.courseTitle)}</p>
                  {/* Ba mảnh từ máy chủ, mảnh giữa bọc `<mark>`. KHÔNG tìm
                      lại chuỗi trong đoạn trích để tô — xem `api/search.ts`. */}
                  <p className="search-hit-snippet">
                    {c.before}
                    <mark>{c.match}</mark>
                    {c.after}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Trần THẬT, trùng `MaxLimit` phía máy chủ. Trang này vẫn hiện `truncated`
 *  khi còn nữa — nó là một trang kết quả, không phải một lời hứa đầy đủ. */
const PAGE_LIMIT = 30;
