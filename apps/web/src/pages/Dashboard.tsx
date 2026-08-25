import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { colorOf, quoteOf } from '../annotations/useAnnotations';
import type { AnnotationRow } from '../db/local';
import { flatChapters, nextChapter } from '../course/chapters';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
import { monogram } from '../course/monogram';
import { type OwnedCourse, useOwnedCourses } from '../course/owned';
import { useLanguage } from '../i18n/LanguageProvider';
import { pickFocusCourse, useLastStudiedCourseId, useRecentNotes } from '../progress/recent';
import { useProgress } from '../progress/useProgress';
import { EmptyLibrary } from './Library';

/**
 * `/` — **Học tiếp**. Một hành động, và những gì người học đã viết.
 *
 * Đặc tả: `docs/superpowers/specs/2026-08-23-ia-redesign.md`, bảng "ba nơi
 * chốn": *"MỘT hành động: chương đang dở. Kèm ghi chú gần đây. KHÔNG phải bảng
 * số liệu."*
 *
 * ## Thứ đã rời khỏi tệp này, và vì sao
 *
 * Trang này từng là một bảng số liệu: `streakDays` và `totalMinutes` in to ở
 * đầu, một biểu đồ cột 30 ngày, rồi mới tới thẻ khoá học. Với một tài khoản mới
 * — mà Task 6 đã xoá `KNOWN_COURSE_IDS` nên **mọi** tài khoản mới đúng là như
 * thế — màn hình đầu tiên của cả sản phẩm là **hai số 0 cỡ lớn**. Các con số ấy
 * nay ở `/progress`, nơi chúng thuộc về, và không được phép quay lại đây: một
 * con số muốn người ta ngắm, một hành động muốn người ta bấm, và đặt cả hai
 * cạnh nhau thì cái to hơn thắng.
 *
 * `useStats()` do đó KHÔNG được gọi ở tệp này nữa. `useOwnedCourses()` vẫn đọc
 * `GET /stats` bên trong (một course học ở máy khác chỉ có nguồn ấy biết), dưới
 * cùng `statsQueryKey`, nên `/` và `/progress` vẫn là MỘT request chứ không
 * phải hai.
 *
 * ## Ruling F5 còn nguyên
 *
 * Số chương đã đọc và chương kế tiếp đều tính từ `useProgress` — dữ liệu CỤC
 * BỘ — không từ `stats.courses[].chaptersDone`. Trang này phải đúng khi không
 * có mạng, vì nó là trang mở ra trước cả khi ai kịp biết mình có mạng hay không.
 *
 * ## Trạng thái rỗng vẫn phải THÀNH HÀNH ĐỘNG (ràng buộc 5 của đặc tả)
 *
 * Không có khoá học nào ⇒ `<EmptyLibrary>`, đúng thành phần mà `/courses` dựng,
 * vì đây là cùng một cánh cửa và hai bản sao của một cánh cửa thì bản không ai
 * đi qua sẽ trôi. Nó nói VÌ SAO trống (§9.5 cố ý không đóng gói sẵn course
 * nào), trao đúng một hành động, và kể ba đường vào — trong đó một đường không
 * cần mạng.
 */
export function Dashboard() {
  const { t } = useLanguage();
  // MỘT câu trả lời cho "người này có những khoá nào" — ruling S1-F31.
  const owned = useOwnedCourses();
  const lastStudied = useLastStudiedCourseId();

  const focusCourseId = pickFocusCourse(owned.courses, lastStudied.courseId);
  // "Chưa biết" KHÔNG được vẽ thành "không có gì": bốn nguồn của `useOwnedCourses`
  // và bảng `progress` cục bộ đều phải trả lời xong. Nháy trạng thái rỗng vào mặt
  // một người đang đọc dở là lỗi mà `Dashboard.test.tsx` đã có bài canh riêng.
  const settled = owned.settled && lastStudied.settled;

  return (
    <div className="home">
      <div className="home-head">
        <div>
          <h1 className="ch-title">{t('home.title')}</h1>
          <p className="ch-lede">{t('home.lede')}</p>
        </div>
        {/*
          "Nhập gói", KHÔNG phải "Đăng xuất" — bản dựng đã duyệt, khung "Học
          tiếp".

          Chú thích cũ ở đây đặt ra một ĐIỀU KIỆN chứ không phải một ý thích:
          "cho tới khi menu tài khoản có thật, gỡ nút đăng xuất đi là bỏ mất
          đường đăng xuất duy nhất mà người dùng bấm tới được — đúng hình dạng
          cổng mù #4 (S1-F29)."

          Điều kiện ấy NAY ĐÃ THOẢ, và đó là lý do dòng này đổi được: `AccountChip`
          ở mép phải thanh trên có mặt trên mọi màn ngoài chế độ đọc, một cú bấm
          tới `/settings`, và `pages/Settings.tsx` đã mang sẵn nút "Đăng xuất"
          kèm câu cảnh báo về dữ liệu trên máy. Hai cửa cho cùng một việc là thứ
          cả cuộc thiết kế lại này tồn tại để gỡ.

          Đổi lại, đầu trang lấy đúng thứ nó thiếu: lối vào NHẬP GÓI. Trước đây
          nó chỉ tới được từ bên trong lời nhắn "thư viện của bạn đang trống" —
          tức là biến mất ngay khi bạn có khoá học đầu tiên.
        */}
        <Link to="/courses?import=1" className="btn home-import">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 3.5v9M10 12.5l-3-3M10 12.5l3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 14.5v1a1 1 0 001 1h10a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {t('courses.import.action')}
        </Link>
      </div>

      {focusCourseId !== undefined && <ContinueCard courseId={focusCourseId} />}
      {focusCourseId === undefined && !settled && <p className="home-note">{t('home.loading')}</p>}
      {focusCourseId === undefined && settled && <EmptyLibrary />}

      <RecentNotes courses={owned.courses} />
    </div>
  );
}

/**
 * MỘT thẻ: khoá đang đọc, chương đang dở, một thanh tiến độ nhỏ, một nút.
 *
 * Trạng thái lỗi của thẻ này cũng phải là một hành động. Một gói hỏng, một
 * manifest 404, một `runtime: "^2"` — tất cả đều kết thúc ở đây, và một câu
 * giải thích không có lối đi tiếp thì vẫn là ngõ cụt. Nên nó luôn kèm đường
 * sang `/courses`.
 */
function ContinueCard({ courseId }: { courseId: string }) {
  const { t } = useLanguage();
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId),
    queryFn: () => loadManifest(courseId),
    retry: false,
  });
  const { doneChapterIds } = useProgress(courseId);

  if (manifestQuery.isPending) {
    return <p className="home-note">{t('course.loading')}</p>;
  }

  if (manifestQuery.isError) {
    return (
      <section className="home-card home-card-error">
        <p className="home-card-note">{describeCourseError(manifestQuery.error, t)}</p>
        <Link to="/courses" className="btn primary home-cta">
          {t('nav.courses')}
        </Link>
      </section>
    );
  }

  const manifest = manifestQuery.data;
  const chapters = flatChapters(manifest);
  const total = chapters.length;
  const read = chapters.filter((chapter) => doneChapterIds.has(chapter.id)).length;
  const next = nextChapter(chapters, doneChapterIds);
  const target = next ?? chapters[total - 1];
  const percent = total > 0 ? Math.round((read / total) * 100) : 0;
  const ctaKey = read === 0 ? 'home.start' : next !== undefined ? 'home.continue' : 'home.reread';

  return (
    <section className="home-card">
      {/* BÌA KHOÁ — khối gradient bên trái, bản dựng khung "Học tiếp".
          Không phải trang trí: nó là thứ duy nhất trên trang này nhận ra được
          từ xa, và là chỗ neo mắt trước khi đọc chữ. Hai dòng chữ trên nó lấy
          từ chính tên khoá, nên nó không cần một tệp ảnh nào — một gói khoá học
          không mang bìa, và bịa ra một cái là hứa thứ gói không có. */}
      <div className="home-cover" aria-hidden="true">
        <span className="home-cover-big">{monogram(manifest.title)}</span>
      </div>

      <div className="home-card-body">
        <div className="home-card-head">
          <p className="home-eyebrow">{t('home.eyebrow')}</p>
        </div>

        {/* Chương là thứ TO NHẤT trên trang: đây là câu trả lời cho "mở cái gì bây giờ". */}
        <h2 className="home-chapter">
          {target !== undefined && target.num !== '' && <span className="home-chapter-num">{target.num}</span>}
          <span className="home-chapter-title">{target?.title ?? manifest.title}</span>
        </h2>

        <p className="home-course">
          <Link to={`/c/${courseId}`} className="home-course-link">
            {manifest.title}
          </Link>
        </p>

        {/* MỘT HÀNG: thanh tiến độ, số chương, nút. Bản cũ xếp chúng thành ba
            khối chồng nhau, nên thẻ cao gấp đôi mà không nói thêm gì. */}
        <div className="home-prog">
          <div
            className="home-bar"
            role="img"
            aria-label={t('home.progressAria', String(percent))}
            title={t('home.progressAria', String(percent))}
          >
            <div className="home-bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="home-prog-text">
            {total > 0 ? t('home.chapters', String(read), String(total)) : t('home.chaptersUnknown', String(read))}
            {next === undefined && total > 0 && <span className="home-done"> {t('home.finished')}</span>}
          </p>
          <Link
            to={target === undefined ? `/c/${courseId}` : `/c/${courseId}/${target.id}`}
            className="btn primary home-cta"
          >
            {t(ctaKey)}
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M4.5 10h11M11 5.5l4.5 4.5L11 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * Bao nhiêu ghi chú được kể là "gần đây".
 *
 * Năm, không phải "tất cả": phần này ở DƯỚI hành động chính và chỉ được phép
 * nhắc, không được phép cạnh tranh. Toàn bộ ghi chú của một chương đã có chỗ
 * của nó — chú lề ngay bên cạnh đoạn văn, trong chế độ đọc.
 */
const RECENT_NOTE_LIMIT = 5;
/** Bề rộng một dòng trích, tính bằng ký tự. Xem `quoteOf`'s doc về vì sao là tham số. */
const RECENT_QUOTE_CHARS = 110;

/**
 * "Thứ người học thật sự quay lại": những gì chính họ đã viết.
 *
 * Đọc thẳng `db.annotations` qua `progress/recent.ts` chứ không qua
 * `useAnnotations`: hook ấy phân giải neo và TÔ vào DOM của một chương đang
 * mở, thứ ở đây không tồn tại. Cái được dùng chung là hai hàm đọc phòng thủ —
 * `quoteOf` và `colorOf` — và dùng chung chúng là bắt buộc chứ không phải tiện:
 * `anchor` đi từ `json.RawMessage` của máy chủ vào đây dưới dạng `unknown`, và
 * một bản sao thứ hai của phép đọc phòng thủ ấy là đúng chỗ trôi dạt mà chú
 * thích của chính `exactOf` đã cảnh báo.
 */
/**
 * KÝ TỰ U+FFFC — "OBJECT REPLACEMENT CHARACTER" — thành một nhãn đọc được.
 *
 * Đoạn trích của một ghi chú được lưu SAU khi `CourseKit.renderKatex` chạy, nên
 * mỗi công thức trong đoạn ấy để lại đúng một U+FFFC thay cho `$…$` gốc (xem
 * `reader/useCourseKit.ts`). Phông chữ không có glyph cho nó, nên trên màn hình
 * nó là một ô vuông rỗng — người đọc thấy một lỗi render giữa câu của chính họ.
 *
 * Sửa ở TẦNG HIỂN THỊ, không sửa `quoteOf`: `OrphanPanel` đưa đúng chuỗi ấy cho
 * người đọc COPY đi dò lại trong chương đã dựng lại, nên chuỗi phải giữ nguyên
 * từng ký tự. Ở đây nó chỉ được VẼ khác đi.
 */
function renderQuote(quote: string, label: string) {
  const pieces = quote.split('\uFFFC');
  return pieces.map((piece, index) => (
    <Fragment key={index}>
      {index > 0 && <span className="home-note-formula">{label}</span>}
      {piece}
    </Fragment>
  ));
}

/**
 * Tên khoá cho một hàng ghi chú.
 *
 * `useOwnedCourses` biết tên của khoá mà máy này ĐANG GIỮ (`held`, đọc từ
 * `db.packages`) hoặc mà máy chủ có liệt kê (`catalog`). Nó KHÔNG biết tên của
 * một khoá được phục vụ TĨNH từ chính origin của app — `course/loader.ts` NGUỒN
 * 2, ruling S1-F31 — và với những khoá ấy hàng ghi chú in ra cái slug thô
 * ("bat-bien-vong-lap"). Một người đọc không đặt tên khoá của mình bằng dấu gạch
 * ngang; đó là địa chỉ, không phải tên.
 *
 * Nên khi và CHỈ KHI ba nguồn kia im lặng, hỏi manifest — cùng `manifestQueryKey`
 * mà `ContinueCard`, `Sidebar` và trang khoá học đã dùng, nên với khoá đang đọc
 * dở thì đây là một lần đọc cache chứ không phải một request thứ hai. Vẫn in
 * slug trong lúc chờ và khi hỏi không được: một cái tên đến chậm vẫn hơn một
 * chỗ trống, và một khoá thật sự không tra được thì slug là tất cả những gì có.
 */
function useCourseTitle(courseId: string, known: string | undefined): string {
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId),
    queryFn: () => loadManifest(courseId),
    enabled: known === undefined,
    retry: false,
  });
  return known ?? manifestQuery.data?.title ?? courseId;
}

function NoteRow({ note, known }: { note: AnnotationRow; known: string | undefined }) {
  const { t } = useLanguage();
  const course = useCourseTitle(note.courseId, known);
  const quote = quoteOf(note.anchor, RECENT_QUOTE_CHARS);

  return (
    <li className={`home-note-row home-note-c-${colorOf(note.anchor)}`}>
      {quote !== '' && <p className="home-note-quote">{renderQuote(quote, t('home.notes.formula'))}</p>}
      <p className="home-note-text">{note.note}</p>
      <p className="home-note-meta">
        <span className="home-note-course">{course}</span>
        <span className="home-note-sep" aria-hidden="true">
          ·
        </span>
        <Link
          to={`/c/${note.courseId}/${note.chapterId}`}
          className="home-note-link"
          aria-label={t('home.notes.aria', course)}
        >
          {t('home.notes.open')}
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4.5 10h11M11 5.5l4.5 4.5L11 14.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </p>
    </li>
  );
}

function RecentNotes({ courses }: { courses: readonly OwnedCourse[] }) {
  const { t } = useLanguage();
  const { notes, settled } = useRecentNotes(RECENT_NOTE_LIMIT);

  const knownTitleOf = (courseId: string): string | undefined => {
    const course = courses.find((entry) => entry.courseId === courseId);
    return course?.held?.title ?? course?.catalog?.title;
  };

  return (
    <section className="home-notes">
      <h2 className="home-h2">{t('home.notes.title')}</h2>

      {!settled && <p className="home-note">{t('home.notes.loading')}</p>}
      {settled && notes.length === 0 && <p className="home-note">{t('home.notes.empty')}</p>}

      {notes.length > 0 && (
        <ul className="home-note-list">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} known={knownTitleOf(note.courseId)} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default Dashboard;
