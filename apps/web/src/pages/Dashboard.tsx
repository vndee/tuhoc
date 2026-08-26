import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { colorOf, quoteOf } from '../annotations/useAnnotations';
import { catalogQueryKey, fetchCatalog } from '../api/catalog';
import { useStats } from '../api/stats';
import type { AnnotationRow } from '../db/local';
import { flatChapters, nextChapter } from '../course/chapters';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
import { monogram } from '../course/monogram';
import { useLanguage } from '../i18n/LanguageProvider';
import { pickFocusCourse, useLastStudiedCourseId, useRecentNotes } from '../progress/recent';
import { useProgress } from '../progress/useProgress';

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
 * `useStats()` do đó KHÔNG được gọi ở tệp này để VẼ số liệu — nó vẫn được gọi,
 * dưới `statsQueryKey` dùng chung với `/progress`, chỉ để lấy `stats.courses[]`
 * (khoá học đã học ở MÁY KHÁC — xem "Nguồn danh sách" bên dưới).
 *
 * ## Ruling F5 còn nguyên
 *
 * Số chương đã đọc và chương kế tiếp đều tính từ `useProgress` — dữ liệu CỤC
 * BỘ — không từ `stats.courses[].chaptersDone`. Trang này phải đúng khi không
 * có mạng, vì nó là trang mở ra trước cả khi ai kịp biết mình có mạng hay không.
 *
 * ## Nguồn danh sách course, sau khi luồng import chết (Task 13)
 *
 * `course/owned.ts` từng là MỘT câu trả lời cho "người này có những khoá nào"
 * (ruling S1-F31), hợp bốn nguồn — trong đó có `db.packages`, tức những gói
 * **người đọc tự nhập vào máy mình**. Nguồn ấy không còn tồn tại: server là
 * nơi DUY NHẤT một course sống (`tuhoc publish`, không phải `/import`), và
 * `GET /courses` (`fetchCatalog`, `api/catalog.ts`) nay là DANH MỤC CÔNG KHAI
 * — mọi người đọc thấy y hệt nhau, không còn nghĩa "thư viện CỦA riêng bạn".
 *
 * Nên trang này không còn hỏi "người này SỞ HỮU khoá nào" — câu hỏi ấy không
 * còn nghĩa. Nó hỏi hai câu hẹp hơn, đúng với những gì nó thật sự cần:
 *
 *  1. **Khoá đang đọc dở** — `useLastStudiedCourseId()` (Dexie cục bộ, ruling
 *     F5). Đúng trong hầu hết mọi phiên, và không cần chờ mạng.
 *  2. **Chưa đọc gì cả thì gợi ý khoá nào** — khoá ĐẦU TIÊN trong danh mục
 *     công khai, hợp với mọi course `stats.courses[]` biết (học ở máy khác,
 *     có thể không còn trong danh mục hôm nay). Đây KHÔNG phải "khoá của
 *     bạn" — nó là "khoá đầu tiên đọc được", một gợi ý hợp lý cho một tài
 *     khoản chưa chạm gì, đúng tinh thần danh mục công khai (ai cũng đọc
 *     được ngay, không cần nhập gói).
 *
 * `RecentNotes` không cần danh sách course nữa: tên khoá của mỗi ghi chú tra
 * thẳng qua `loadManifest` (xem `useNoteCourseTitle` bên dưới) — nó luôn phải
 * hỏi mạng dù trước đây có "biết trước" hay không, vì `course/owned.ts`'s
 * `held`/`catalog` chỉ là một bộ nhớ đệm cho đúng cùng một câu hỏi.
 *
 * ## Trạng thái rỗng vẫn phải THÀNH HÀNH ĐỘNG (ràng buộc 5 của đặc tả)
 *
 * Không có gì để tiếp tục ⇒ `<EmptyHome>` — không còn ba cách NHẬP một gói
 * (không ai nhập gì nữa), chỉ một lời mời: mở danh mục. Đó là hành động DUY
 * NHẤT còn ý nghĩa trong một thế giới nơi mọi course đã sẵn sàng đọc.
 */
export function Dashboard() {
  const { t } = useLanguage();
  const catalogQuery = useQuery({ queryKey: catalogQueryKey(), queryFn: fetchCatalog, retry: false });
  const statsQuery = useStats();
  const lastStudied = useLastStudiedCourseId();

  const focusCourseId = pickFocusCourse(fallbackCourseIds(catalogQuery.data, statsQuery.data?.courses), lastStudied.courseId);
  // "Chưa biết" KHÔNG được vẽ thành "không có gì": danh mục, /stats và bảng
  // `progress` cục bộ đều phải trả lời xong. Nháy trạng thái rỗng vào mặt
  // một người đang đọc dở là lỗi mà `Dashboard.test.tsx` đã có bài canh riêng.
  const settled = !catalogQuery.isPending && !statsQuery.isPending && lastStudied.settled;

  return (
    <div className="home">
      <div className="home-head">
        <h1 className="ch-title">{t('home.title')}</h1>
        <p className="ch-lede">{t('home.lede')}</p>
      </div>

      {focusCourseId !== undefined && <ContinueCard courseId={focusCourseId} />}
      {focusCourseId === undefined && !settled && <p className="home-note">{t('home.loading')}</p>}
      {focusCourseId === undefined && settled && <EmptyHome />}

      <RecentNotes />
    </div>
  );
}

/**
 * `catalog ∪ stats.courses[]`, sorted — the fallback set `pickFocusCourse`
 * reaches for only when NOTHING is locally in progress (see that function's
 * own doc comment for why the union does not matter once a local progress
 * row exists: priority 1 wins outright and never consults this list).
 *
 * Catalog ids first because they need no further lookup (this device does
 * not need the network again to open one); `stats.courses[]` ids folded in
 * for the same reason `course/owned.ts` once did — a course studied on
 * ANOTHER device is still this reader's course even if this device has never
 * heard of it locally, and dropping that source is what used to make a
 * reader's own course disappear from their own home screen.
 */
function fallbackCourseIds(
  catalog: { slug: string }[] | undefined,
  statsCourses: { courseId: string }[] | undefined,
): string[] {
  const ids = new Set<string>();
  for (const course of catalog ?? []) ids.add(course.slug);
  for (const course of statsCourses ?? []) ids.add(course.courseId);
  return Array.from(ids).sort();
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
 * Tên hiển thị của một khoá, cho một ghi chú chỉ mang `courseId` trong tay.
 *
 * Từng đọc qua `course/owned.ts`'s `useCourseTitle`, thứ có một "known" title
 * lấy sẵn từ bốn nguồn của `useOwnedCourses` (catalog/held/...) để tránh phải
 * hỏi mạng. Nguồn "held" đã chết cùng luồng import, và "catalog" giờ là danh
 * mục CÔNG KHAI — không còn là một bộ nhớ đệm đáng tin cho tên của MỘT course
 * cụ thể mà một ghi chú thuộc về (một course rời khỏi danh mục vẫn có thể còn
 * ghi chú ở đây). Nên mỗi hàng tự hỏi thẳng `loadManifest`, cùng
 * `manifestQueryKey` mà Bảng điều khiển/trang khoá học/thanh bên đã dùng — với
 * course đang đọc dở thì đây là một lần đọc cache, không phải một request thứ
 * hai. In slug trong lúc chờ và khi hỏi không được: một cái tên đến chậm vẫn
 * hơn một chỗ trống.
 */
function useNoteCourseTitle(courseId: string): string {
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId),
    queryFn: () => loadManifest(courseId),
    retry: false,
  });
  return manifestQuery.data?.title ?? courseId;
}

function NoteRow({ note }: { note: AnnotationRow }) {
  const { t } = useLanguage();
  const course = useNoteCourseTitle(note.courseId);
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

function RecentNotes() {
  const { t } = useLanguage();
  const { notes, settled } = useRecentNotes(RECENT_NOTE_LIMIT);

  return (
    <section className="home-notes">
      <h2 className="home-h2">{t('home.notes.title')}</h2>

      {!settled && <p className="home-note">{t('home.notes.loading')}</p>}
      {settled && notes.length === 0 && <p className="home-note">{t('home.notes.empty')}</p>}

      {notes.length > 0 && (
        <ul className="home-note-list">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Trạng thái rỗng của Bảng điều khiển: chưa có gì để tiếp tục.
 *
 * Thay cho `<EmptyLibrary>` (`pages/Library.tsx`) — ba cách NHẬP một gói,
 * đúng cho một thế giới nơi course chỉ vào máy qua `/import`. Thế giới ấy đã
 * hết: mọi course đã sẵn trên máy chủ, công khai, đọc được ngay. Ruling S1-F17
 * ("trang chủ rỗng vẫn phải là một hành động") không đổi — chỉ có HÀNH ĐỘNG ấy
 * đổi, từ "nhập một gói" thành "mở danh mục".
 */
function EmptyHome() {
  const { t } = useLanguage();
  return (
    <div className="home-empty">
      <h2 className="home-empty-h">{t('home.empty.heading')}</h2>
      <p className="home-empty-lede">{t('home.empty.lede')}</p>
      <Link to="/courses" className="btn primary home-empty-cta">
        {t('home.empty.cta')}
      </Link>
    </div>
  );
}

export default Dashboard;
