import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { colorOf, quoteOf } from '../annotations/useAnnotations';
import type { Ann } from '../api/annotations';
import { catalogQueryKey, fetchCatalog } from '../api/catalog';
import { useStats } from '../api/stats';
import { flatChapters, nextChapter } from '../course/chapters';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
import type { Manifest } from '../course/types';
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
 * cỡ lớn, không nút màu — rồi mục lục của khoá ấy với dấu đã đọc từng chương.
 * Cột lề (1/3): ba-năm ghi chú gần nhất, như chú lề của một cuốn sách. Không
 * thẻ, không bóng, không eyebrow; phân cấp bằng cỡ serif, hairline và một màu
 * nhấn. Kiểu nằm ở `styles/home.css` (`.doc-*`, `.cont-*`, `.toc-*`, `.mnote-*`).
 *
 * ## Thứ đã rời khỏi tệp này, và vì sao
 *
 * Trang này từng là một bảng số liệu (`streakDays`, `totalMinutes`, biểu đồ 30
 * cột), rồi một THẺ có bìa monogram, thanh tiến độ và nút tím. Cả hai đời đều
 * là hình dạng mặc định của category. Số liệu ở `/progress`, nơi chúng thuộc
 * về, và không được phép quay lại đây: một con số muốn người ta ngắm, một hành
 * động muốn người ta bấm, và đặt cả hai cạnh nhau thì cái to hơn thắng.
 *
 * `useStats()` do đó KHÔNG được gọi ở tệp này để VẼ số liệu — nó vẫn được gọi,
 * dưới `statsQueryKey` dùng chung với `/progress`, chỉ để lấy `stats.courses[]`
 * (khoá học đã học ở MÁY KHÁC — xem "Nguồn danh sách" bên dưới).
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
 * ## Nguồn danh sách course, sau khi luồng import chết (Task 13)
 *
 * Server là nơi DUY NHẤT một course sống (`tuhoc publish`), và `GET /courses`
 * (`fetchCatalog`) là DANH MỤC CÔNG KHAI. Trang này không hỏi "người này SỞ HỮU
 * khoá nào" — câu ấy không còn nghĩa — mà hỏi hai câu hẹp hơn:
 *
 *  1. **Khoá đang đọc dở** — `useLastStudiedCourseId()` (`GET /progress`).
 *  2. **Chưa đọc gì cả thì gợi ý khoá nào** — khoá ĐẦU TIÊN trong danh mục,
 *     hợp với mọi course `stats.courses[]` biết (học ở máy khác).
 *
 * ## Trạng thái rỗng vẫn phải THÀNH HÀNH ĐỘNG (ràng buộc 5 của đặc tả)
 *
 * Không có gì để tiếp tục ⇒ `<EmptyHome>` — một lời mời mở danh mục, viết
 * thành đoạn văn chứ không phải một thẻ.
 */
export function Dashboard() {
  const { t } = useLanguage();
  const catalogQuery = useQuery({ queryKey: catalogQueryKey(), queryFn: fetchCatalog, retry: false });
  const statsQuery = useStats();
  const lastStudied = useLastStudiedCourseId();

  const focusCourseId = pickFocusCourse(fallbackCourseIds(catalogQuery.data, statsQuery.data?.courses), lastStudied.courseId);
  // "Chưa biết" KHÔNG được vẽ thành "không có gì": danh mục, /stats và
  // `progress` đều phải trả lời xong. Nháy trạng thái rỗng vào mặt một người
  // đang đọc dở là lỗi mà `Dashboard.test.tsx` đã có bài canh riêng.
  const settled = !catalogQuery.isPending && !statsQuery.isPending && lastStudied.settled;

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
        </section>

        <aside className="doc-margin">
          <RecentNotes />
        </aside>
      </div>
    </div>
  );
}

/**
 * `catalog ∪ stats.courses[]`, sorted — the fallback set `pickFocusCourse`
 * reaches for only when NOTHING is in progress (see that function's own doc
 * comment for why the union does not matter once a progress row exists).
 *
 * Catalog ids first because they need no further lookup; `stats.courses[]`
 * ids folded in because a course studied on ANOTHER device is still this
 * reader's course even if the catalog no longer lists it.
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
 * "TIẾP TỤC" + MỤC LỤC của khoá đang dở.
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
    <>
      <section className="cont">
        <p className="cont-course lbl">
          <Link to={`/c/${courseId}`}>{manifest.title}</Link>
        </p>

        {/* HÀNH ĐỘNG CHÍNH LÀ TÊN CHƯƠNG. Động từ là nhãn run-in đứng trước,
            trong cùng liên kết — tên trợ năng đọc là "Đọc tiếp 1.2 Tên chương",
            và không có nút màu nào để cạnh tranh với nó. */}
        <Link to={targetHref} className="cont-link">
          <span className="cont-verb">{t(ctaKey)}</span>
          <h2 className="cont-chapter">
            {target !== undefined && target.num !== '' && <span className="cont-num">{target.num}</span>}
            <span className="cont-title">{target?.title ?? manifest.title}</span>
          </h2>
        </Link>

        <p className="cont-meta">
          {total > 0 ? t('home.chapters', String(read), String(total)) : t('home.chaptersUnknown', String(read))}
          {next === undefined && total > 0 && <span className="cont-done"> {t('home.finished')}</span>}
        </p>
      </section>

      <Toc courseId={courseId} manifest={manifest} doneChapterIds={doneChapterIds} nextId={next?.id} />
    </>
  );
}

/**
 * Mục lục của khoá đang dở, kiểu `\tableofcontents`: số mục, tiêu đề, dấu đã
 * đọc. Đây là câu trả lời thứ hai cho "mở cái gì bây giờ" — chương kế tiếp
 * mang màu nhấn ngay trong danh sách — và là thứ khiến người học thấy CẢ khoá
 * chứ không chỉ một chương, mà không cần một trang khác.
 *
 * Dấu đã đọc là một SVG nhỏ, không phải ký tự ✓: một glyph Unicode đứng thay
 * cho một hệ biểu tượng là đúng thứ craft-floor gọi tên.
 */
function Toc({
  courseId,
  manifest,
  doneChapterIds,
  nextId,
}: {
  courseId: string;
  manifest: Manifest;
  doneChapterIds: ReadonlySet<string>;
  nextId: string | undefined;
}) {
  const { t } = useLanguage();
  return (
    <nav className="toc" aria-label={manifest.title}>
      {manifest.parts.map((part, index) => (
        <div key={`${part.title}-${index}`}>
          <p className="toc-part lbl">{part.title}</p>
          <ul className="toc-rows">
            {part.chapters.map((chapter) => {
              const done = doneChapterIds.has(chapter.id);
              const isNext = chapter.id === nextId;
              const cls = ['toc-row', done ? 'is-done' : null, isNext ? 'is-next' : null].filter(Boolean).join(' ');
              return (
                <li key={chapter.id} className={cls}>
                  <span className="toc-num">{chapter.num}</span>
                  <Link to={`/c/${courseId}/${chapter.id}`} className="toc-title">
                    {chapter.title}
                  </Link>
                  <span className="toc-mark">
                    {done && (
                      <>
                        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {t('toc.done')}
                      </>
                    )}
                    {!done && isNext && t('toc.next')}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
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
          {renderQuote(quote, t('home.notes.formula'))}
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
