import { useQuery } from '@tanstack/react-query';
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStats } from '../api/stats';
import { countChapters } from '../course/chapters';
import { db } from '../db/local';
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
 * *"Người này có những khoá nào"* → `db.progress` cục bộ (`useLocalProgress`
 * bên dưới), KHÔNG phải danh mục công khai (`fetchCatalog`). Sau khi luồng
 * import chết (Task 13), "sở hữu" một khoá không còn nghĩa gì — danh mục là
 * chung, ai cũng thấy y hệt nhau — nên trang này hỏi một câu hẹp hơn và đúng
 * hơn: "tôi đã học chương nào của khoá nào". Cũng KHÔNG phải `stats.courses[]`:
 * danh sách ấy chỉ chứa khoá máy chủ đã thấy nhịp học hoặc chương hoàn thành,
 * nên một khoá vừa đọc dở, offline, chưa kịp đồng bộ, sẽ biến mất khỏi trang
 * tiến độ nếu đây là nguồn duy nhất.
 *
 * *"Bao nhiêu phút, chuỗi mấy ngày"* → `useStats()` từ `api/stats.ts`, dùng
 * chung với `pages/Dashboard.tsx`'s `statsQueryKey`, nên hai trang không cùng
 * gọi hai request khác nhau cho cùng một câu hỏi.
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
/**
 * BA CON SỐ ĐẦU TRANG, và câu trả lời cho "khoá nào" — một `liveQuery` duy
 * nhất trên `db.progress`/`db.annotations` cho cả hai việc.
 *
 * Hai trong ba con số đọc từ MÁY NÀY, không từ máy chủ, và đó là ruling F5
 * chứ không phải tiện tay: đánh dấu một chương đã đọc và viết một ghi chú đều
 * là phép ghi CỤC BỘ, nên một con số chỉ nhích lên sau khi outbox flush thành
 * công là con số nói dối trong mọi phiên offline. Chuỗi ngày thì ngược lại —
 * nhịp học được cộng ở máy chủ nên nó chỉ tồn tại ở đó.
 *
 * `courseIds` — `null` cho tới khi `liveQuery` phát lần đầu, phân biệt với
 * `[]` ("chưa đọc chương nào ở đâu cả") vì lần phát đầu tiên của Dexie là bất
 * đồng bộ: coi giá trị khởi tạo là "không có gì" sẽ nháy trạng thái rỗng vào
 * mặt một người học đang có dở dang — cùng cái bẫy `course/owned.ts` từng
 * tách `settled` ra để tránh, trước khi module đó bị gỡ (Task 13).
 *
 * `liveQuery` chứ không phải một lần đọc: đánh dấu một chương ở tab khác phải
 * làm con số ở đây nhích lên mà không cần tải lại trang.
 */
function useLocalProgress(): { chaptersRead: number; notes: number; courseIds: string[] | null } {
  const [state, setState] = useState<{ chaptersRead: number; notes: number; courseIds: string[] | null }>({
    chaptersRead: 0,
    notes: 0,
    courseIds: null,
  });

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [progress, annotations] = await Promise.all([
        db.progress.toArray(),
        db.annotations.toArray(),
      ]);
      return {
        chaptersRead: progress.filter((row) => row.done).length,
        // `deletedAt` là xoá MỀM (xem `db/local.ts`): một ghi chú đã xoá vẫn còn
        // hàng để đồng bộ, nhưng nó không còn là một ghi chú người ta đang giữ.
        notes: annotations.filter((row) => row.deletedAt == null).length,
        // Sắp xếp để thứ tự hàng ổn định giữa các lần phát của `liveQuery`.
        courseIds: Array.from(new Set(progress.map((row) => row.courseId))).sort(),
      };
    }).subscribe({
      next: (next) => setState(next),
      error: (err) => console.error('Progress: live query failed', err),
    });
    return () => subscription.unsubscribe();
  }, []);

  return state;
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
