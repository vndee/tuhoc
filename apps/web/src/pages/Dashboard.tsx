import { useQuery } from '@tanstack/react-query';
import { Fragment, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { colorOf, quoteOf } from '../annotations/useAnnotations';
import type { Ann } from '../api/annotations';
import { enrollmentsQueryKey, fetchEnrollments } from '../api/enrollments';
import { useStats } from '../api/stats';
import { flatChapters, nextChapter } from '../course/chapters';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
import { useLanguage } from '../i18n/LanguageProvider';
import { pickFocusCourse, useLastStudiedCourseId, useRecentNotes } from '../progress/recent';
import { useProgress } from '../progress/useProgress';

/**
 * `/` — **Học tiếp**. Một hành động, và những gì người học đã viết.
 *
 * Đặc tả IA: `docs/superpowers/specs/2026-08-23-ia-redesign.md` — *"MỘT hành
 * động: chương đang dở. Kèm ghi chú gần đây. KHÔNG phải bảng số liệu."*
 * Thế giới hình ảnh: **giáo trình LaTeX, lề rộng** — hợp đồng hướng ở brief
 * `.impeccable/surfaces/apps-web-src-pages-dashboard-tsx.md` (seed 57dcb485).
 *
 * ## Hình dạng trang, theo hợp đồng
 *
 * Cột chính (2/3): dòng "Tiếp tục" — tên chương đang dở là MỘT liên kết serif
 * cỡ lớn, không nút màu — rồi danh sách khoá đã ghi danh, mỗi khoá một dòng.
 * Mục lục đầy đủ ở `/c/:slug`, không ở đây: trang này chỉ được có MỘT hành
 * động, và bốn mươi bốn dòng mục lục dưới một hành động là để cái dài hơn
 * thắng cái quan trọng hơn.
 * Cột lề (1/3): ba-năm ghi chú gần nhất, như chú lề của một cuốn sách. Không
 * thẻ, không bóng, không eyebrow; phân cấp bằng cỡ serif, hairline và một màu
 * nhấn. Kiểu nằm ở `styles/home.css` (`.doc-*`, `.cont-*`, `.mine-*`, `.mnote-*`).
 *
 * ## Thứ đã rời khỏi tệp này, và vì sao
 *
 * Trang này từng là một bảng số liệu (`streakDays`, `totalMinutes`, biểu đồ 30
 * cột), rồi một THẺ có bìa monogram, thanh tiến độ và nút tím. Cả hai đời đều
 * là hình dạng mặc định của category. Số liệu ở `/progress`, nơi chúng thuộc
 * về, và không được phép quay lại đây: một con số muốn người ta ngắm, một hành
 * động muốn người ta bấm, và đặt cả hai cạnh nhau thì cái to hơn thắng.
 *
 * `useStats()` do đó không vẽ BẢNG số liệu ở đây. Nó được gọi dưới
 * `statsQueryKey` dùng chung với `/progress` cho hai việc hẹp: lấy
 * `stats.courses[]` (khoá học đã học ở MÁY KHÁC — xem "Nguồn danh sách" bên
 * dưới), và — từ vòng thiết kế lại — đưa MỘT con số vào dòng meta dưới hành
 * động: số phút đã học của chính khoá đang dở. Hợp đồng hướng đặt tên dòng ấy
 * là "chương, đoạn, phút"; một câu serif 15px dưới một tiêu đề 34px không cạnh
 * tranh với hành động, còn một lưới ô số thì có — ranh giới của đặc tả IA nằm
 * ở đó, không phải ở việc có xuất hiện chữ "phút" hay không. "Đoạn" không có:
 * `GET /progress` chỉ biết chương, không biết vị trí đoạn (ghi ở brief).
 *
 * ## Ruling F5, thu hẹp phạm vi (Pha 3)
 *
 * Số chương đã đọc và chương kế tiếp vẫn tính từ `useProgress`, không từ
 * `stats.courses[].chaptersDone` — nhưng KHÔNG còn vì lý do ruling F5 gốc nêu
 * ("trang này phải đúng khi không có mạng"). Pha 3 gỡ tiền đề offline đó có
 * chủ ý: `useProgress` đọc `GET /progress` qua TanStack Query. Lý do còn sống
 * là ĐỘ TRỄ: `useProgress` ghi LẠC QUAN, một chương đánh dấu đã đọc hiện lên
 * NGAY trong cache trước khi `PUT /progress` trả lời, còn `chaptersDone` chỉ
 * nhích lên sau khi request ấy xong VÀ `/stats` được hỏi lại.
 *
 * ## Nguồn danh sách course, sau khi cắt đường rò từ danh mục chung
 *
 * Server là nơi DUY NHẤT một course sống (`tuhoc publish`), và `GET /courses`
 * (`fetchCatalog`) là DANH MỤC CÔNG KHAI — mọi course có trên hệ thống, không
 * phải course của người này. Trang này chỉ hỏi những gì THUỘC VỀ người đang
 * đăng nhập, qua hai câu hẹp:
 *
 *  1. **Khoá đang đọc dở** — `useLastStudiedCourseId()` (`GET /progress`).
 *  2. **Chưa đọc gì cả thì gợi ý khoá nào** — khoá ĐẦU TIÊN người này đã GHI
 *     DANH (`GET /enrollments`, `api/enrollments.ts`), không phải khoá đầu
 *     bảng chữ cái của danh mục chung. Trước `/enrollments`, phần này hợp
 *     danh mục công khai với `stats.courses[]` làm gợi ý — nên MỌI tài
 *     khoản, kể cả một tài khoản vừa tạo, đều có sẵn một "khoá đang dở" nó
 *     chưa từng mở; `Dashboard.test.tsx` có bài canh riêng cho đúng lỗi đó.
 *
 * ## Trạng thái rỗng vẫn phải THÀNH HÀNH ĐỘNG (ràng buộc 5 của đặc tả)
 *
 * Không có gì để tiếp tục ⇒ `<EmptyHome>` — một lời mời mở danh mục, viết
 * thành đoạn văn chứ không phải một thẻ.
 */
export function Dashboard() {
  const { t } = useLanguage();
  const enrollmentsQuery = useQuery({
    queryKey: enrollmentsQueryKey(),
    queryFn: () => fetchEnrollments(),
    retry: false,
  });
  const statsQuery = useStats();
  const lastStudied = useLastStudiedCourseId();

  // Chỉ khoá ĐÃ GHI DANH mới được vào đây. Trước đây tham số này là hợp của
  // danh mục công khai với stats.courses[] — tức là mọi khoá trên hệ thống —
  // nên một tài khoản chưa mở gì vẫn có "khoá đang dở".
  const enrolledIds = useMemo(
    () => (enrollmentsQuery.data ?? []).map((e) => e.courseId),
    [enrollmentsQuery.data],
  );
  const focusCourseId = pickFocusCourse(enrolledIds, lastStudied.courseId);
  // "Chưa biết" KHÔNG được vẽ thành "không có gì": enrollments, /stats và
  // `progress` đều phải trả lời xong. Nháy trạng thái rỗng vào mặt một người
  // đang đọc dở là lỗi mà `Dashboard.test.tsx` đã có bài canh riêng.
  const settled = !enrollmentsQuery.isPending && !statsQuery.isPending && lastStudied.settled;

  return (
    <div className="home doc">
      <header className="doc-head">
        <h1 className="doc-title">{t('home.title')}</h1>
        <p className="doc-lede">{t('home.lede')}</p>
      </header>

      <div className="doc-body">
        <section className="doc-main">
          {focusCourseId !== undefined && <Continue courseId={focusCourseId} />}
          {focusCourseId === undefined && !settled && <p className="home-note">{t('home.loading')}</p>}
          {focusCourseId === undefined && settled && <EmptyHome />}
          {enrolledIds.length > 0 && <MyCourses courseIds={enrolledIds} focusCourseId={focusCourseId} />}
        </section>

        <aside className="doc-margin">
          <RecentNotes />
        </aside>
      </div>
    </div>
  );
}

/**
 * "TIẾP TỤC" — hành động DUY NHẤT của trang: tên chương đang dở của khoá tiêu
 * điểm. Mục lục đầy đủ của khoá này đứng ở `/c/:slug`, không ở đây.
 *
 * Trạng thái lỗi của khối này cũng phải là một hành động: một gói hỏng, một
 * manifest 404 — tất cả kết thúc ở đây, và một câu giải thích không có lối đi
 * tiếp thì vẫn là ngõ cụt. Nên nó luôn kèm đường sang `/courses`.
 */
function Continue({ courseId }: { courseId: string }) {
  const { t } = useLanguage();
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId),
    queryFn: () => loadManifest(courseId),
    retry: false,
  });
  const { doneChapterIds } = useProgress(courseId);
  // Cùng query key với `/progress` và với `Dashboard()` ở trên — TanStack gộp,
  // không thêm request. Không có số liệu (chưa tải, lỗi) thì dòng meta chỉ
  // ngắn đi một vế; nó không bao giờ chặn hành động chính.
  const statsQuery = useStats();
  const minutes = statsQuery.data?.courses.find((c) => c.courseId === courseId)?.minutes ?? 0;

  if (manifestQuery.isPending) {
    return <p className="home-note">{t('course.loading')}</p>;
  }

  if (manifestQuery.isError) {
    return (
      <section className="cont">
        <p className="cont-error">{describeCourseError(manifestQuery.error, t)}</p>
        <Link to="/courses" className="doc-link">
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
  const ctaKey = read === 0 ? 'home.start' : next !== undefined ? 'home.continue' : 'home.reread';
  const targetHref = target === undefined ? `/c/${courseId}` : `/c/${courseId}/${target.id}`;

  return (
    <section className="cont">
      {/* HÀNH ĐỘNG CHÍNH LÀ TÊN CHƯƠNG. Động từ là run-in TRONG cùng dòng của
          <h2> — không có nhãn nào đứng trên tiêu đề (bản trước xếp tên khoá
          và động từ thành hai tầng eyebrow; reviewer kết thúc gọi đúng tên).
          Tên trợ năng đọc là "Đọc tiếp 1.2 Tên chương", và không có nút màu
          nào để cạnh tranh với nó. */}
      <Link to={targetHref} className="cont-link">
        <h2 className="cont-chapter">
          <span className="cont-verb">{t(ctaKey)}</span>
          {target !== undefined && target.num !== '' && <span className="cont-num">{target.num}</span>}
          <span className="cont-title">{target?.title ?? manifest.title}</span>
        </h2>
      </Link>

      {/* Dòng meta là một câu: tên khoá (liên kết về trang khoá) · chương đã
          đọc · phút đã học. Dấu chấm giữa là trình bày, ẩn với trình đọc. */}
      <p className="cont-meta">
        <Link to={`/c/${courseId}`} className="cont-course">
          {manifest.title}
        </Link>
        <span className="cont-sep" aria-hidden="true">
          {' · '}
        </span>
        {total > 0 ? t('home.chapters', String(read), String(total)) : t('home.chaptersUnknown', String(read))}
        {minutes > 0 && (
          <>
            <span className="cont-sep" aria-hidden="true">
              {' · '}
            </span>
            {t('progress.course.minutes', String(minutes))}
          </>
        )}
        {next === undefined && total > 0 && <span className="cont-done"> {t('home.finished')}</span>}
      </p>
    </section>
  );
}

/**
 * "KHOÁ CỦA TÔI" — một dòng cho mỗi khoá đã ghi danh, TRỪ khoá đang là tiêu
 * điểm ở trên.
 *
 * MỘT DÒNG, không phải một thẻ, và KHÔNG phải mục lục. Đặc tả IA của trang này
 * chỉ cho phép MỘT hành động; khối `Continue` ở trên đã dùng hết suất ấy.
 * Khối này trả lời một câu khác — "tôi còn khoá nào nữa" — nên nó phải nhỏ
 * hơn hành động kia một bậc rõ rệt, bằng không cái dài hơn sẽ thắng cái quan
 * trọng hơn (cùng lỗi đã đuổi bảng số liệu và mục lục 44 chương ra khỏi trang
 * này).
 *
 * Khoá đang là tiêu điểm bị BỎ QUA: nó vừa được nói bằng cỡ chữ lớn nhất
 * trang, in lại tên nó ngay dưới là nói hai lần.
 */
function MyCourses({ courseIds, focusCourseId }: { courseIds: readonly string[]; focusCourseId: string | undefined }) {
  const { t } = useLanguage();
  const rest = courseIds.filter((id) => id !== focusCourseId);
  if (rest.length === 0) return null;

  return (
    <section className="mine">
      <h2 className="mine-title">{t('home.myCourses')}</h2>
      <ul className="mine-list">
        {rest.map((id) => (
          <MyCourseRow key={id} courseId={id} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Một dòng. Manifest tra không được thì dòng ấy BIẾN MẤT, không hiện lỗi: một
 * ghi danh trỏ tới khoá đã gỡ xuất bản là trạng thái hợp lệ (migration 0011
 * cố ý không có khoá ngoại), và một dòng đỏ ở đây chỉ nói với người đọc một
 * chuyện họ không làm gì được.
 */
function MyCourseRow({ courseId }: { courseId: string }) {
  const { t } = useLanguage();
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId),
    queryFn: () => loadManifest(courseId),
    retry: false,
  });
  const { doneChapterIds } = useProgress(courseId);

  const manifest = manifestQuery.data;
  if (manifest === undefined) return null;

  const chapters = flatChapters(manifest);
  const read = chapters.filter((chapter) => doneChapterIds.has(chapter.id)).length;

  return (
    <li className="mine-row">
      <Link to={`/c/${courseId}`} className="mine-link">
        {manifest.title}
      </Link>
      <span className="mine-meta">{t('home.chapters', String(read), String(chapters.length))}</span>
    </li>
  );
}

/**
 * Bao nhiêu ghi chú được kể là "gần đây".
 *
 * Năm, không phải "tất cả": phần này ở LỀ và chỉ được phép nhắc, không được
 * phép cạnh tranh. Toàn bộ ghi chú của một chương đã có chỗ của nó — chú lề
 * ngay bên cạnh đoạn văn, trong chế độ đọc.
 */
const RECENT_NOTE_LIMIT = 5;
/** Bề rộng một dòng trích, tính bằng ký tự. Xem `quoteOf`'s doc về vì sao là tham số. */
const RECENT_QUOTE_CHARS = 110;

/**
 * KÝ TỰ U+FFFC — "OBJECT REPLACEMENT CHARACTER" — thành một nhãn đọc được.
 *
 * Đoạn trích của một ghi chú được lưu SAU khi `CourseKit.renderKatex` chạy, nên
 * mỗi công thức trong đoạn ấy để lại đúng một U+FFFC thay cho `$…$` gốc. Phông
 * không có glyph cho nó, nên trên màn hình nó là một ô vuông rỗng. Sửa ở TẦNG
 * HIỂN THỊ, không sửa `quoteOf`: `OrphanPanel` đưa đúng chuỗi ấy cho người đọc
 * COPY đi dò lại trong chương, nên chuỗi phải giữ nguyên từng ký tự.
 */
function renderQuote(quote: string, label: string) {
  const pieces = quote.split('￼');
  return pieces.map((piece, index) => (
    <Fragment key={index}>
      {index > 0 && <span className="mnote-formula">{label}</span>}
      {piece}
    </Fragment>
  ));
}

/**
 * Tên hiển thị của một khoá, cho một ghi chú chỉ mang `courseId` trong tay.
 * Hỏi thẳng `loadManifest`, cùng `manifestQueryKey` mà mọi màn khác dùng — với
 * course đang đọc dở thì đây là một lần đọc cache, không phải một request thứ
 * hai. In slug trong lúc chờ: một cái tên đến chậm vẫn hơn một chỗ trống.
 */
function useNoteCourseTitle(courseId: string): string {
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId),
    queryFn: () => loadManifest(courseId),
    retry: false,
  });
  return manifestQuery.data?.title ?? courseId;
}

function NoteRow({ note }: { note: Ann }) {
  const { t } = useLanguage();
  const course = useNoteCourseTitle(note.courseId);
  const quote = quoteOf(note.anchor, RECENT_QUOTE_CHARS);

  return (
    <li className={`mnote mnote-c-${colorOf(note.anchor)}`}>
      {quote !== '' && (
        <p className="mnote-quote">
          <span className="mnote-swatch" aria-hidden="true" />
          {/* Trích đoạn là liên kết: hover gạch chân, bấm mở CHƯƠNG. Không phải
              "đúng đoạn" như hợp đồng hứa — `anchor` mờ với client này và reader
              chưa cuộn tới một ghi chú; khoảng trống ghi ở PRODUCT.md, và nhãn
              "Mở chương" bên dưới nói đúng điều liên kết làm. */}
          <Link to={`/c/${note.courseId}/${note.chapterId}`} className="mnote-quote-link">
            {renderQuote(quote, t('home.notes.formula'))}
          </Link>
        </p>
      )}
      <p className="mnote-text">{note.note}</p>
      <p className="mnote-meta">
        <span className="mnote-course">{course}</span>
        <Link
          to={`/c/${note.courseId}/${note.chapterId}`}
          className="doc-link"
          aria-label={t('home.notes.aria', course)}
        >
          {t('home.notes.open')}
        </Link>
      </p>
    </li>
  );
}

/**
 * "Thứ người học thật sự quay lại": những gì chính họ đã viết — ở LỀ.
 *
 * Đọc thẳng `GET /annotations` (qua `progress/recent.ts`'s `useRecentNotes`)
 * chứ không qua `useAnnotations`: hook ấy phân giải neo và TÔ vào DOM của một
 * chương đang mở, thứ ở đây không tồn tại. Dùng chung `quoteOf`/`colorOf` là
 * bắt buộc chứ không phải tiện: `anchor` tới đây dưới dạng `unknown`, và một
 * bản sao thứ hai của phép đọc phòng thủ ấy là đúng chỗ trôi dạt.
 */
function RecentNotes() {
  const { t } = useLanguage();
  const { notes, settled } = useRecentNotes(RECENT_NOTE_LIMIT);

  return (
    <section className="home-notes">
      <h2 className="doc-h">{t('home.notes.title')}</h2>

      {!settled && <p className="home-note">{t('home.notes.loading')}</p>}
      {settled && notes.length === 0 && <p className="home-note">{t('home.notes.empty')}</p>}

      {notes.length > 0 && (
        <ul className="margin-notes">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Trạng thái rỗng: chưa có gì để tiếp tục. Ruling S1-F17 ("trang chủ rỗng vẫn
 * phải là một hành động") không đổi — hành động ấy là "mở danh mục", viết thành
 * một đoạn văn với một liên kết, không phải một thẻ có nút.
 */
function EmptyHome() {
  const { t } = useLanguage();
  return (
    <div className="home-empty">
      <h2 className="home-empty-h">{t('home.empty.heading')}</h2>
      <p className="home-empty-lede">{t('home.empty.lede')}</p>
      <Link to="/courses" className="doc-link">
        {t('home.empty.cta')}
      </Link>
    </div>
  );
}

export default Dashboard;
