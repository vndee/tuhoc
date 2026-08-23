import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useStats } from '../api/stats';
import { countChapters } from '../course/chapters';
import { loadManifest, manifestQueryKey } from '../course/loader';
import { manifestString, type OwnedCourse, useOwnedCourses } from '../course/owned';
import { useLanguage } from '../i18n/LanguageProvider';
import { buildHeatCalendar, heatLevel, todayIctIso } from '../progress/heat';
import { useProgress } from '../progress/useProgress';

/**
 * `/progress` — **Tiến độ**. Nơi các con số THUỘC VỀ.
 *
 * Đặc tả: `docs/superpowers/specs/2026-08-23-ia-redesign.md` — *"Nơi các con số
 * thuộc về. Viết thành **câu**, kèm lịch nhiệt."*
 *
 * ## Ba khối, và mỗi khối trả lời một câu hỏi khác nhau
 *
 *  1. **Một câu.** "Bạn đã học 42 phút, với chuỗi 3 ngày liên tục." Không phải
 *     hai ô đếm rời cạnh nhau — `42` đứng dưới chữ `phút đã học` bắt người đọc
 *     tự ghép lại, và ở tài khoản mới nó là hai số 0 cỡ lớn. Câu ấy có BA dạng
 *     chứ không phải một dạng có chỗ trống: chuỗi 0 ngày và 0 phút là hai tình
 *     huống khác nhau, và "với chuỗi 0 ngày liên tục" là một câu tiếng Việt
 *     không ai nói.
 *  2. **Lịch bảy tuần.** Mỗi ô một ngày. Phép dựng lịch nằm ở
 *     `progress/heat.ts`, thuần và có bài test riêng — xem tệp ấy về việc
 *     49 ô lấy dữ liệu từ 30 ngày máy chủ trả về như thế nào mà không nói dối
 *     về 19 ngày còn lại.
 *  3. **Theo khoá học.** Thanh + số chương từng phần.
 *
 * ## Hai câu hỏi, hai nguồn — và cả hai đều là nguồn DUY NHẤT của nó
 *
 * *"Người này có những khoá nào"* → `useOwnedCourses()` (ruling S1-F31). Không
 * phải `stats.courses[]`: danh sách ấy chỉ chứa khoá máy chủ đã thấy nhịp học
 * hoặc chương hoàn thành, nên một khoá vừa nhập, hoặc một khoá đọc offline
 * chưa kịp đồng bộ, sẽ biến mất khỏi trang tiến độ trong khi `/courses` vẫn
 * liệt kê nó. Đó đúng là hai màn hình, hai công thức, một câu hỏi — thứ
 * `course/owned.ts` được bóc ra để chấm dứt.
 *
 * *"Bao nhiêu phút, chuỗi mấy ngày"* → `useStats()` từ `api/stats.ts`, dùng
 * chung, không có bản sao thứ hai. `useOwnedCourses` đọc cùng `statsQueryKey`,
 * nên hai hook trên trang này là MỘT request.
 *
 * ## Vì sao số chương vẫn tính từ máy (ruling F5)
 *
 * `stats.courses[].chaptersDone` có sẵn và trang này là trang của các con số —
 * nhưng phần trăm hoàn thành mỗi khoá vẫn lấy từ `useProgress`, đúng như ruling
 * F5 đã chốt cho vòng hoàn thành của trang chủ. Lý do không đổi: đánh dấu một
 * chương đã đọc là một phép ghi CỤC BỘ, và một thanh tiến độ nhích lên chỉ sau
 * khi outbox flush thành công là một thanh tiến độ nói dối trong mọi phiên
 * offline. `minutes` thì ngược lại — nó chỉ tồn tại ở máy chủ (nhịp học được
 * cộng ở đó), nên nó tới từ `stats.courses[]`.
 */
export function Progress() {
  const { t } = useLanguage();
  const statsQuery = useStats();
  const owned = useOwnedCourses();

  const minutesByCourse = courseMinutes(statsQuery.data?.courses);

  return (
    <div className="prog">
      <h1 className="ch-title">{t('nav.progress')}</h1>
      <p className="ch-lede">{t('progress.lede')}</p>

      {statsQuery.isPending && <p className="prog-note">{t('progress.loading')}</p>}
      {statsQuery.isError && <p className="prog-note">{t('progress.error')}</p>}

      {statsQuery.data != null && (
        <>
          <p className="prog-sentence">
            {studySentence(t, statsQuery.data.totalMinutes, statsQuery.data.streakDays)}
          </p>
          <HeatCalendar days={statsQuery.data.days} />
        </>
      )}

      <section className="prog-section">
        <h2 className="prog-h">{t('progress.byCourse')}</h2>

        {/* "Chưa biết" không được vẽ thành "không có gì" — `settled`, không `length`. */}
        {owned.courses.length === 0 && !owned.settled && <p className="prog-note">{t('progress.loading')}</p>}
        {owned.courses.length === 0 && owned.settled && (
          <p className="prog-note">
            {t('progress.noCourses')}{' '}
            <Link to="/courses" className="prog-empty-link">
              {t('nav.courses')}
            </Link>
          </p>
        )}

        {owned.courses.length > 0 && (
          <ul className="prog-list">
            {owned.courses.map((course) => (
              <CourseProgress
                key={course.courseId}
                course={course}
                minutes={minutesByCourse.get(course.courseId)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * `stats.courses[]` → `courseId → phút`, đọc phòng thủ từng trường.
 *
 * `assertStats` bảo đảm `courses` LÀ MỘT MẢNG và không bảo đảm gì về phần tử —
 * chú thích của chính nó gọi mình là *"shape check, not schema validation"*.
 * `.map((c) => c.minutes)` trên mảng ấy là đúng cái hình dạng đã một lần làm
 * trắng cả trang, nên mỗi phần tử được soi lại ở đây.
 */
function courseMinutes(courses: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(courses)) return out;
  for (const entry of courses as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { courseId?: unknown; minutes?: unknown };
    if (typeof record.courseId !== 'string' || record.courseId === '') continue;
    out.set(
      record.courseId,
      typeof record.minutes === 'number' && Number.isFinite(record.minutes) ? record.minutes : 0,
    );
  }
  return out;
}

/**
 * Ba câu, không phải một câu có chỗ trống.
 *
 * Tách ra khỏi JSX vì đây là một QUYẾT ĐỊNH về ngôn ngữ chứ không phải một
 * nhánh vẽ: "với chuỗi 0 ngày liên tục" đúng về số học và sai về tiếng Việt,
 * và một người chưa học phút nào không cần được thông báo rằng họ đã học 0 phút.
 */
function studySentence(
  t: ReturnType<typeof useLanguage>['t'],
  totalMinutes: number,
  streakDays: number,
): string {
  const minutes = Math.round(totalMinutes);
  if (!(minutes > 0) && !(streakDays > 0)) return t('progress.sentenceEmpty');
  if (!(streakDays > 0)) return t('progress.sentenceNoStreak', String(minutes));
  return t('progress.sentence', String(minutes), String(streakDays));
}

/** Bảy tuần — con số của đặc tả, và của chính lưới 7×7 mà nó vẽ ra. */
const HEAT_WEEKS = 7;

/**
 * Lịch nhiệt: một ô một ngày, ô đậm là ngày có học.
 *
 * `role="img"` + một nhãn cho CẢ lưới, không phải 49 phần tử đọc được riêng
 * lẻ: đọc to bốn mươi chín ngày liên tiếp không giúp ai cả. Con số của từng
 * ngày vẫn còn — trong `title`, tức là trong tooltip của chuột và trong cây
 * accessibility của từng ô — nên thông tin không mất, chỉ không bị đọc tuần tự.
 */
function HeatCalendar({ days }: { days: unknown }) {
  const { t } = useLanguage();
  const calendar = buildHeatCalendar(days, HEAT_WEEKS, todayIctIso());

  return (
    <section className="prog-section">
      <h2 className="prog-h">{t('progress.heat.title')}</h2>

      <div className="prog-heat" role="img" aria-label={t('progress.heat.aria')}>
        {calendar.weeks.map((week) => (
          <div className="prog-heat-week" key={week[0]?.date ?? ''}>
            {week.map((cell) => (
              <span
                key={cell.date}
                className={
                  cell.known
                    ? `prog-heat-cell prog-heat-l${heatLevel(cell.minutes, calendar.maxMinutes)}`
                    : 'prog-heat-cell prog-heat-unknown'
                }
                title={
                  cell.known
                    ? t('progress.heat.day', cell.date, String(Math.round(cell.minutes)))
                    : t('progress.heat.noData', cell.date)
                }
              />
            ))}
          </div>
        ))}
      </div>

      <p className="prog-heat-legend">
        <span className="prog-heat-legend-label">{t('progress.heat.less')}</span>
        <span className="prog-heat-cell prog-heat-l0" aria-hidden="true" />
        <span className="prog-heat-cell prog-heat-l1" aria-hidden="true" />
        <span className="prog-heat-cell prog-heat-l2" aria-hidden="true" />
        <span className="prog-heat-cell prog-heat-l3" aria-hidden="true" />
        <span className="prog-heat-cell prog-heat-l4" aria-hidden="true" />
        <span className="prog-heat-legend-label">{t('progress.heat.more')}</span>
      </p>
    </section>
  );
}

/**
 * Một khoá học: tên, thanh, số chương từng phần, và số phút nếu máy chủ biết.
 *
 * Mẫu số đến từ manifest, dùng chung `manifestQueryKey` với mọi màn hình khác,
 * nên trên đường đi thông thường đây là một lần đọc cache chứ không phải một
 * request. Khi manifest chưa về (hoặc không về được), hàng vẫn hiện — với số
 * chương đã đọc và KHÔNG có mẫu số, thay vì một mẫu số đoán bừa. `0/0` sẽ vẽ
 * ra một thanh rỗng cho một người đã đọc mười chương.
 */
function CourseProgress({ course, minutes }: { course: OwnedCourse; minutes: number | undefined }) {
  const { t } = useLanguage();
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(course.courseId),
    queryFn: () => loadManifest(course.courseId),
    retry: false,
  });
  const { partStats } = useProgress(course.courseId);

  const total = countChapters(manifestQuery.data);
  const read = partStats.chaptersRead;
  const title =
    course.held?.title ?? course.catalog?.title ?? manifestString(manifestQuery.data, 'title') ?? course.courseId;
  // `Math.min` là chốt chặn cho một thực tế đo được: chương bị gỡ khỏi khoá học
  // ở phiên bản mới vẫn để lại hàng progress cũ trên máy, nên `read` có thể lớn
  // hơn `total`. Một thanh 137% là một lỗi vẽ; con số thật vẫn được in cạnh nó.
  const percent = total > 0 ? Math.round((Math.min(read, total) / total) * 100) : 0;

  return (
    <li className="prog-row">
      <div className="prog-row-head">
        <Link to={`/c/${course.courseId}`} className="prog-row-title">
          {title}
        </Link>
        <span className="prog-row-n">
          {total > 0 ? t('progress.course.chapters', String(read), String(total)) : t('progress.chaptersDone', String(read))}
        </span>
      </div>

      <div
        className="prog-bar"
        role="img"
        aria-label={t('progress.course.aria', String(percent))}
        title={t('progress.course.aria', String(percent))}
      >
        <div className="prog-bar-fill" style={{ width: `${percent}%` }} />
      </div>

      {minutes !== undefined && (
        <p className="prog-row-minutes">{t('progress.course.minutes', String(Math.round(minutes)))}</p>
      )}
    </li>
  );
}

export default Progress;
