import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { type Ann, annotationsQueryKey, fetchAnnotations } from '../api/annotations';
import { type ProgressRow, fetchProgress, progressQueryKey } from '../api/progress';
import { useStats } from '../api/stats';
import { countChapters } from '../course/chapters';
import { loadManifest, manifestQueryKey } from '../course/loader';
import { useLanguage } from '../i18n/LanguageProvider';
import { buildYearCalendar, heatLevel, todayIctIso } from '../progress/heat';
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
 * *"Người này có những khoá nào"* → `GET /progress` (`useLocalProgress` bên
 * dưới, tên hàm giữ nguyên từ trước Task 9 dù nguồn đã đổi — xem chú thích
 * của chính hàm), KHÔNG phải danh mục công khai (`fetchCatalog`). Sau khi
 * luồng import chết (Task 13), "sở hữu" một khoá không còn nghĩa gì — danh
 * mục là chung, ai cũng thấy y hệt nhau — nên trang này hỏi một câu hẹp hơn
 * và đúng hơn: "tôi đã học chương nào của khoá nào". Cũng KHÔNG phải
 * `stats.courses[]`: danh sách ấy chỉ chứa khoá máy chủ đã thấy nhịp học
 * hoặc chương hoàn thành, nên một khoá vừa đọc dở, chưa kịp có nhịp học hay
 * chương hoàn thành nào được server đếm, sẽ biến mất khỏi trang tiến độ nếu
 * đây là nguồn duy nhất.
 *
 * *"Bao nhiêu phút, chuỗi mấy ngày"* → `useStats()` từ `api/stats.ts`, dùng
 * chung với `pages/Dashboard.tsx`'s `statsQueryKey`, nên hai trang không cùng
 * gọi hai request khác nhau cho cùng một câu hỏi.
 *
 * ## Vì sao số chương vẫn tính từ `useProgress`, không từ `stats.courses[]` (ruling F5)
 *
 * `stats.courses[].chaptersDone` có sẵn và trang này là trang của các con số —
 * nhưng phần trăm hoàn thành mỗi khoá vẫn lấy từ `useProgress`, đúng như ruling
 * F5 đã chốt cho vòng hoàn thành của trang chủ. Lý do: `useProgress` (Task 6)
 * ghi LẠC QUAN — một chương đánh dấu đã đọc hiện lên NGAY trong cache, trước
 * khi `PUT /progress` trả lời — trong khi `stats.courses[].chaptersDone` chỉ
 * nhích lên sau khi request ấy đã thành công VÀ `/stats` được hỏi lại. Cùng
 * một sự kiện, hai độ trễ khác nhau; trang của các con số chọn cái nhanh hơn.
 * `minutes` thì ngược lại — nó chỉ tồn tại ở máy chủ (nhịp học được cộng ở
 * đó, không có bản lạc quan nào để ưu tiên), nên nó tới từ `stats.courses[]`.
 */
/**
 * Hai mảng rỗng CHIA SẺ Ở MỨC MODULE, không phải `data: rows = []` của
 * `useQuery` (một mảng MỚI mỗi lần vẽ trong lúc câu hỏi chưa có dữ liệu). Xem
 * `useProgress.ts`'s `EMPTY_ROWS` — cùng bẫy, cùng cách tránh: một tham chiếu
 * mới mỗi lần vẽ sẽ vô hiệu `useMemo` bên dưới trên mọi lần vẽ trong lúc
 * `GET /progress`/`GET /annotations` đang chờ hoặc đang lỗi-rồi-thử-lại.
 */
const EMPTY_PROGRESS_ROWS: ProgressRow[] = [];
const EMPTY_ANNOTATION_ROWS: Ann[] = [];

/**
 * BA CON SỐ ĐẦU TRANG, và câu trả lời cho "khoá nào" — hai `useQuery` chia sẻ
 * đúng cache mà `useProgress`/`useAnnotations`/`progress/recent.ts` đã dùng
 * (`progressQueryKey()`/`annotationsQueryKey()`, không tham số — mọi khoá học
 * trong một request), nên bốn nơi đọc "mọi tiến độ"/"mọi ghi chú" của app
 * chia đúng MỘT request mỗi loại, không phải bốn.
 *
 * Tên hàm (`useLocalProgress`) giữ nguyên từ bản Dexie — Task 9 chỉ đổi
 * NGUỒN, không đổi CÂU HỎI mà trang này đặt ra ("khoá nào, bao nhiêu chương,
 * bao nhiêu ghi chú"), và đổi tên sẽ là một diff không cần thiết ở mọi chỗ
 * gọi. Điều KHÔNG còn đúng nữa: hai trong ba con số này từng đọc "máy này,
 * không cần mạng" (ruling F5 gốc) — Task 9 gỡ tiền đề đó có chủ ý, cùng lý do
 * Task 6 đã gỡ nó khỏi `useProgress`: biết "bao nhiêu chương/ghi chú" không
 * còn free về mạng nữa, đúng việc nhánh `pha3/du-lieu-len-may-chu` làm.
 *
 * `courseIds` — `null` cho tới khi `GET /progress` trả lời lần đầu, phân
 * biệt với `[]` ("chưa đọc chương nào ở đâu cả"): coi giá trị khởi tạo là
 * "không có gì" sẽ nháy trạng thái rỗng vào mặt một người học đang có dở
 * dang — cùng cái bẫy `course/owned.ts` từng tách `settled` ra để tránh
 * (module đó đã gỡ ở Task 13). Gate riêng theo `progressQuery`, không đợi
 * `annotationsQuery` cùng lúc: `courseIds` không phụ thuộc gì vào ghi chú, và
 * chờ thêm một request không liên quan chỉ làm chậm câu trả lời.
 *
 * `useQuery` chứ không phải một lần đọc: cache của `progressQueryKey()`/
 * `annotationsQueryKey()` đổi (một chương được `useProgress` đánh dấu, một
 * ghi chú `useAnnotations` vừa tạo) làm con số ở đây nhích lên mà không cần
 * tải lại trang — cùng tính chất `liveQuery` từng cho, khác nguồn phát.
 */
function useLocalProgress(): { chaptersRead: number; notes: number; courseIds: string[] | null } {
  const progressQueryResult = useQuery({
    queryKey: progressQueryKey(),
    queryFn: () => fetchProgress(),
  });
  const annotationsQueryResult = useQuery({
    queryKey: annotationsQueryKey(),
    queryFn: () => fetchAnnotations(),
  });

  const progress = progressQueryResult.data ?? EMPTY_PROGRESS_ROWS;
  const annotations = annotationsQueryResult.data ?? EMPTY_ANNOTATION_ROWS;
  const progressSettled = !progressQueryResult.isPending;

  return useMemo(
    () => ({
      chaptersRead: progress.filter((row) => row.done).length,
      // `Ann` (Task 5) không có `deletedAt` nữa — migration 0009 gỡ hẳn cột
      // tombstone, và `GET /annotations` không bao giờ trả một hàng đã xoá.
      // Không còn nhánh lọc nào cần ở đây.
      notes: annotations.length,
      // Sắp xếp để thứ tự hàng ổn định giữa các lần cache phát lại.
      courseIds: progressSettled ? Array.from(new Set(progress.map((row) => row.courseId))).sort() : null,
    }),
    [progress, annotations, progressSettled],
  );
}

export function Progress() {
  const { t } = useLanguage();
  const statsQuery = useStats();
  const local = useLocalProgress();

  const minutesByCourse = courseMinutes(statsQuery.data?.courses);
  const courseIds = local.courseIds ?? [];
  const coursesSettled = local.courseIds !== null;

  return (
    <div className="prog">
      <h1 className="ch-title">{t('nav.progress')}</h1>
      <p className="ch-lede">{t('progress.lede')}</p>

      {statsQuery.isPending && <p className="prog-note">{t('progress.loading')}</p>}
      {statsQuery.isError && <p className="prog-note">{t('progress.error')}</p>}

      {/* Ba thẻ số liệu. Câu văn bên dưới KHÔNG bị thay thế — nó nói cùng dữ
          liệu ấy thành một câu, và đó là điều `progress.lede` hứa ("kể thành
          câu"). Con số cho người liếc, câu cho người đọc. */}
      <div className="prog-stats">
        <div className="prog-stat">
          <p className="prog-stat-k">{t('progress.stat.chapters')}</p>
          <p className="prog-stat-v">{local.chaptersRead}</p>
          <p className="prog-stat-sub">{t('progress.stat.chaptersSub', String(courseIds.length))}</p>
        </div>
        <div className="prog-stat">
          <p className="prog-stat-k">{t('progress.stat.streak')}</p>
          <p className="prog-stat-v">{statsQuery.data?.streakDays ?? 0}</p>
          <p className="prog-stat-sub">{t('progress.stat.streakSub')}</p>
        </div>
        <div className="prog-stat">
          <p className="prog-stat-k">{t('progress.stat.notes')}</p>
          <p className="prog-stat-v">{local.notes}</p>
          <p className="prog-stat-sub">{t('progress.stat.notesSub')}</p>
        </div>
      </div>

      {statsQuery.data != null && (
        <p className="prog-sentence">
          {studySentence(t, statsQuery.data.totalMinutes, statsQuery.data.streakDays)}
        </p>
      )}

      <YearActivity />

      <section className="prog-section">
        <h2 className="prog-h">{t('progress.byCourse')}</h2>

        {/* "Chưa biết" không được vẽ thành "không có gì" — `coursesSettled`, không `length`. */}
        {courseIds.length === 0 && !coursesSettled && <p className="prog-note">{t('progress.loading')}</p>}
        {courseIds.length === 0 && coursesSettled && (
          <p className="prog-note">
            {t('progress.noCourses')}{' '}
            <Link to="/courses" className="prog-empty-link">
              {t('nav.courses')}
            </Link>
          </p>
        )}

        {courseIds.length > 0 && (
          <ul className="prog-list">
            {courseIds.map((courseId) => (
              <CourseProgress key={courseId} courseId={courseId} minutes={minutesByCourse.get(courseId)} />
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
/**
 * Lịch nhiệt: một ô một ngày, ô đậm là ngày có học.
 *
 * `role="img"` + một nhãn cho CẢ lưới, không phải 49 phần tử đọc được riêng
 * lẻ: đọc to bốn mươi chín ngày liên tiếp không giúp ai cả. Con số của từng
 * ngày vẫn còn — trong `title`, tức là trong tooltip của chuột và trong cây
 * accessibility của từng ô — nên thông tin không mất, chỉ không bị đọc tuần tự.
 */
/**
 * LỊCH CẢ NĂM, kiểu GitHub — người dùng yêu cầu đích danh.
 *
 * Ba thứ bản bảy-tuần không có, và cả ba đều là yêu cầu:
 *   · cả năm, không phải một dải trượt 49 ngày;
 *   · cột chọn năm bên phải;
 *   · danh sách khoá học của năm ấy kèm trọng số.
 *
 * Dữ liệu đến từ `GET /stats?year=` — một tham số THÊM VÀO, không đổi câu trả
 * lời mặc định mà Bảng điều khiển đang dựa vào (xem `api/stats.ts` và
 * `apps/api/internal/stats/handler.go`).
 */
/**
 * Tên hiển thị của một khoá, cho một hàng chỉ mang `courseId` trong tay.
 *
 * Từng đọc "known" title qua `course/owned.ts`'s `useCourseTitle` — nguồn ấy
 * (catalog/held) chết cùng luồng import (Task 13): danh mục giờ là chung, ai
 * cũng thấy y hệt, nên nó không còn là một bộ nhớ đệm đáng tin cho tên của
 * MỘT course cụ thể trong năm ấy. Hỏi thẳng `loadManifest`, cùng
 * `manifestQueryKey` mà mọi màn khác dùng — cache hit trên đường đi thường.
 */
function useCourseTitleFallback(courseId: string): string {
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId),
    queryFn: () => loadManifest(courseId),
    retry: false,
  });
  return manifestQuery.data?.title ?? courseId;
}

/**
 * Một hàng trong "Khoá học trong năm".
 *
 * Là component riêng chỉ vì MỘT lý do: `useCourseTitleFallback` là một hook,
 * và một hook không gọi được bên trong `.map()`. Trước đây hàng này in thẳng
 * `course.courseId` — tức cái slug ("so-dau-phay-dong") — trong khi `CourseRow`
 * ngay dưới cùng trang đã tra tên đúng cách từ lâu.
 */
function CourseWeight({ courseId, share }: { courseId: string; share: number }) {
  const title = useCourseTitleFallback(courseId);
  const pct = Math.round(share * 100);

  return (
    <li className="prog-weight">
      <span className="prog-weight-name" title={title}>
        {title}
      </span>
      <span className="prog-weight-bar" aria-hidden="true">
        <span className="prog-weight-fill" style={{ width: `${Math.max(2, pct)}%` }} />
      </span>
      <span className="prog-weight-pct">{pct}%</span>
    </li>
  );
}

function YearActivity() {
  const { t, lang } = useLanguage();
  const thisYear = Number(todayIctIso().slice(0, 4));
  const [year, setYear] = useState(thisYear);

  const statsQuery = useStats(year);
  const calendar = buildYearCalendar(statsQuery.data?.days, year, todayIctIso());

  // Tên tháng theo NGÔN NGỮ ĐANG CHỌN, không phải theo giờ máy: `Intl` biết
  // "Th 1" và "Jan", nên `heat.ts` không phải giữ một bảng tên tháng nào.
  const monthName = new Intl.DateTimeFormat(lang, { month: 'short' });

  // `years[]` từ máy chủ luôn kèm năm hiện tại (buildYears), nhưng một máy chủ
  // cũ hơn không có trường ấy — lùi về đúng năm đang xem thay vì một cột rỗng.
  const years = statsQuery.data?.years?.length ? statsQuery.data.years : [year];

  return (
    <section className="prog-year">
      <div className="prog-year-main">
        <div className="prog-year-head">
          <h2 className="prog-h">
            {t('progress.year.title', String(calendar.activeDays), String(year))}
          </h2>
          {/* CÂU RIÊNG, không dùng lại `progress.error` của trang.
              Đây là một request KHÁC (`?year=`) nên nó hỏng độc lập được — và
              nếu cả hai cùng hỏng, in đúng một câu hai lần cách nhau vài chục
              pixel đọc như một lỗi vẽ. Bài kiểm cũng bắt đúng chỗ ấy:
              `findByText(/cần mạng/i)` ném khi có hai kết quả. */}
          {statsQuery.isError && <p className="prog-note">{t('progress.year.error')}</p>}
        </div>

        <div className="prog-cal" role="img" aria-label={t('progress.heat.aria')}>
          <div className="prog-cal-months" aria-hidden="true">
            {calendar.months.map((label) => (
              <span
                key={label.month}
                className="prog-cal-month"
                style={{ gridColumnStart: label.column + 1 }}
              >
                {monthName.format(new Date(Date.UTC(year, label.month, 1)))}
              </span>
            ))}
          </div>

          <div className="prog-cal-grid">
            {calendar.weeks.map((week) => (
              <div className="prog-cal-week" key={week[0]?.date ?? ''}>
                {week.map((cell) => (
                  <span
                    key={cell.date}
                    className={
                      !cell.inRange
                        ? 'prog-cal-cell prog-cal-out'
                        : !cell.known
                          ? 'prog-cal-cell prog-heat-unknown'
                          : `prog-cal-cell prog-heat-l${heatLevel(cell.minutes, calendar.maxMinutes)}`
                    }
                    title={
                      cell.inRange && cell.known
                        ? t('progress.heat.cell', cell.date, String(Math.round(cell.minutes)))
                        : undefined
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
        </div>

        {/* KHOÁ HỌC CỦA NĂM ẤY, kèm trọng số — `share` do máy chủ tính, nên mọi
            client vẽ cùng một thanh từ cùng một phép làm tròn. */}
        <div className="prog-year-courses">
          <h3 className="prog-year-sub">{t('progress.year.courses')}</h3>
          {(statsQuery.data?.yearCourses ?? []).length === 0 && (
            <p className="prog-note">{t('progress.year.noCourses', String(year))}</p>
          )}
          <ul className="prog-weights">
            {(statsQuery.data?.yearCourses ?? []).map((course) => (
              <CourseWeight key={course.courseId} courseId={course.courseId} share={course.share} />
            ))}
          </ul>
        </div>
      </div>

      {/* CỘT NĂM. `<nav>` chứ không phải một `<select>`: GitHub dựng nó thành
          một danh sách nhìn thấy được, và ở đây nó cũng là một danh sách ngắn
          mà mọi lựa chọn đều đáng hiện ra cùng lúc. */}
      <nav className="prog-years" aria-label={t('progress.year.pickAria')}>
        {years.map((option) => (
          <button
            type="button"
            key={option}
            className={option === year ? 'prog-year-btn on' : 'prog-year-btn'}
            aria-current={option === year ? 'true' : undefined}
            onClick={() => setYear(option)}
          >
            {option}
          </button>
        ))}
      </nav>
    </section>
  );
}

/**
 * Một khoá học: tên, thanh, số chương từng phần, và số phút nếu máy chủ biết.
 *
 * Mẫu số VÀ TÊN đều đến từ manifest — dùng chung `manifestQueryKey` với mọi
 * màn hình khác, nên trên đường đi thông thường đây là một lần đọc cache chứ
 * không phải một request. Trước Task 13, tên có thể tới từ `OwnedCourse.held`/
 * `.catalog` khi biết trước; nguồn ấy chết cùng luồng import, và không đổi
 * chi phí ở đây — hàng này đã luôn tự hỏi manifest cho MẪU SỐ bất kể tên có
 * biết trước hay không. Khi manifest chưa về (hoặc không về được), hàng vẫn
 * hiện — với số chương đã đọc, tên là `courseId` thô, và KHÔNG có mẫu số, thay
 * vì một mẫu số đoán bừa. `0/0` sẽ vẽ ra một thanh rỗng cho một người đã đọc
 * mười chương.
 */
function CourseProgress({ courseId, minutes }: { courseId: string; minutes: number | undefined }) {
  const { t } = useLanguage();
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId),
    queryFn: () => loadManifest(courseId),
    retry: false,
  });
  const { partStats } = useProgress(courseId);

  const total = countChapters(manifestQuery.data);
  const read = partStats.chaptersRead;
  const title = manifestQuery.data?.title ?? courseId;
  // `Math.min` là chốt chặn cho một thực tế đo được: chương bị gỡ khỏi khoá học
  // ở phiên bản mới vẫn để lại hàng progress cũ trên máy, nên `read` có thể lớn
  // hơn `total`. Một thanh 137% là một lỗi vẽ; con số thật vẫn được in cạnh nó.
  const percent = total > 0 ? Math.round((Math.min(read, total) / total) * 100) : 0;

  return (
    <li className="prog-row">
      <div className="prog-row-head">
        <Link to={`/c/${courseId}`} className="prog-row-title">
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
