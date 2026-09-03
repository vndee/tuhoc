import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMe } from '../api/useMe';
import { flatChapters, nextChapter } from '../course/chapters';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
import { useLanguage } from '../i18n/LanguageProvider';
import { useProgress } from '../progress/useProgress';

/**
 * `/c/:courseId` — the course's table of contents: title, description, and
 * every chapter grouped by part, styled with the original stylesheet's own
 * nav classes (`.nav-part`, `a.nav-item`, `.nav-num` via `CourseNav`) so it
 * reads like v1's sidebar.
 *
 * `doneChapterIds` (Ruling F4 / debt #1) is fed by `useProgress` — but, since
 * Task 12, only through `CourseProgress` below, and only once a session is
 * confirmed. This page itself never calls `useProgress`. Reading local
 * progress unconditionally would mean a course this DEVICE has progress on
 * (however it got there — a previous account, a session that has since ended)
 * gets read back to whoever opens the browser next, signed in or not; the
 * page has no way to tell that reader apart from the one the progress
 * actually belongs to. See `reader/ChapterView.tsx`'s `AuthedReaderExtras`
 * for the fuller version of the same reasoning, applied to a chapter instead
 * of this course-level summary.
 */
/**
 * "Phần I · Entropy" → `['Phần I', 'Entropy']`.
 *
 * Bản dựng vẽ mỗi chặng thành HAI cột — một nhãn thứ tự nhạt bên trái, tên
 * chặng đậm bên phải — trong khi manifest chỉ có MỘT chuỗi. Dấu chấm giữa là
 * quy ước sẵn có của chính các gói (`Phần 0 · Nền móng`, `Phần II · Mã hoá &
 * kênh`), nên hai cột ấy đọc ra được chứ không phải bịa thêm dữ liệu.
 *
 * Không có dấu ngăn thì KHÔNG tách: "Phụ lục" là tên chặng, không phải một
 * nhãn thứ tự thiếu tên. Tách bừa theo khoảng trắng sẽ cho "Phụ" / "lục".
 */
export function splitPartTitle(title: string): [string | undefined, string] {
  const at = title.indexOf(' · ');
  if (at === -1) return [undefined, title];
  return [title.slice(0, at), title.slice(at + 3)];
}

export function CourseHome() {
  const { courseId } = useParams<{ courseId: string }>();
  const { t } = useLanguage();
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId ?? ''),
    queryFn: () => loadManifest(courseId as string),
    enabled: courseId != null,
  });

  const me = useMe();
  const confirmedLoggedIn = me.isSuccess && me.data != null;
  const [doneChapterIds, setDoneChapterIds] = useState<ReadonlySet<string>>(new Set());

  if (courseId == null) {
    return <p className="ch-lede">{t('course.notFound')}</p>;
  }

  if (manifestQuery.isPending) {
    return <p className="ch-lede">{t('course.loading')}</p>;
  }

  if (manifestQuery.isError) {
    return <p className="ch-lede">{describeCourseError(manifestQuery.error, t)}</p>;
  }

  const manifest = manifestQuery.data;

  const chapters = flatChapters(manifest);
  const read = chapters.filter((chapter) => doneChapterIds.has(chapter.id)).length;
  const next = nextChapter(chapters, doneChapterIds);
  const target = next ?? chapters[chapters.length - 1];

  return (
    <div className="ch-page">
      {/* Task 12: the one place `useProgress` runs for this page, and only
          once a session is confirmed — see this component's own doc above.
          Renders nothing; it only ever reports `doneChapterIds` upward. */}
      {confirmedLoggedIn && <CourseProgress courseId={courseId} onChange={setDoneChapterIds} />}

      {/* Không còn nhãn hạng (`TierBadge`, `pages/Library.tsx`) — format v2 bỏ
          hẳn trường `tier` khỏi manifest (spec
          `2026-08-25-server-side-pivot.md` §2.3): "hạng interactive" theo
          nghĩa cũ (JavaScript tự do trong chương) bị khai tử, mọi chương đều
          là hạng `content`, và phần tương tác tách hẳn thành widget chạy
          trong iframe sandbox riêng. Vẽ một nhãn hạng cho một trường không
          còn tồn tại sẽ luôn rơi vào nhánh "không rõ hạng — có thể chạy mã"
          — một cảnh báo sai cho mọi course, tệ hơn không có cảnh báo nào. */}
      <p className="ch-badges">
        <span className="ch-badge-meta">
          {t('library.meta.version', manifest.version)}
          <span className="ch-badge-dot" aria-hidden="true">
            ·
          </span>
          {manifest.lang}
        </span>
      </p>
      <h1 className="ch-title">{manifest.title}</h1>
      <p className="ch-lede">{manifest.description}</p>

      {/* CHỖ ĐANG DỞ — câu trả lời cho "mở cái gì bây giờ", đứng trước mọi thứ
          khác trên trang này. */}
      {target !== undefined && (
        <section className="ch-resume">
          {/* NHÃN RUN-IN, không phải eyebrow. Sàn craft cấm thẳng một dòng
              nhãn đứng TRÊN một đầu mục: đầu mục tự đứng được. Nhưng chữ ở
              đây ("Đọc tiếp"/"Bắt đầu") không phải một nhãn phân loại — nó
              nói ra hành động, nên xoá là mất nghĩa. Nó vào thẳng trong đầu
              mục, đúng cách khối Tiếp tục ở Học tiếp (`.cont-verb`) và ô
              hành động của landing đã làm. */}
          <div className="ch-resume-row">
            <div className="ch-resume-body">
              <h2 className="ch-resume-title">
                <span className="ch-resume-verb">{t(read === 0 ? 'home.start' : 'home.eyebrow')}</span>
                {target.num !== '' && <span className="ch-resume-num">{target.num}</span>}
                {target.title}
              </h2>
              <p className="ch-resume-meta">{t('library.meta.chapters', String(read), String(chapters.length))}</p>
            </div>
            <Link
              to={`/c/${courseId}/${target.id}`}
              className="btn primary"
            >
              {t(read === 0 ? 'home.start' : 'home.continue')}
            </Link>
          </div>
        </section>
      )}

      {/*
        TÓM TẮT THEO PHẦN, KHÔNG PHẢI DANH SÁCH CHƯƠNG.

        Trang này TỪNG in trọn mục lục ở giữa màn — cùng lúc thanh bên bên trái
        in y hệt nó. Hai bản sao của một danh sách, cách nhau ba trăm pixel.

        Bản dựng đã duyệt thay nó bằng một dòng cho mỗi PHẦN: thô hơn mục lục
        đúng một bậc, nên hai thứ không giẫm lên nhau. Mục lục chi tiết vẫn ở
        thanh bên, nơi nó là nghĩa duy nhất của cột ấy.
      */}
      <section className="ch-parts">
        <h2 className="ch-parts-h">{t('course.parts.title', String(manifest.parts.length))}</h2>
        <p className="ch-parts-hint">{t('course.parts.hint')}</p>

        <ul className="ch-part-list">
          {manifest.parts.map((part, index) => {
            const partRead = part.chapters.filter((chapter) => doneChapterIds.has(chapter.id)).length;
            const [eyebrow, name] = splitPartTitle(part.title);
            return (
              <li className="ch-part" key={`${index}-${part.title}`}>
                {/* Ô rỗng chứ không phải BỎ HẲN khi chặng không có nhãn thứ tự
                    ("Phụ lục"): cột tên phải giữ nguyên một mép trái cho mọi
                    hàng, còn bỏ ô sẽ kéo riêng hàng ấy thụt về bên trái. */}
                <span className="ch-part-eyebrow">{eyebrow ?? ''}</span>
                <span className="ch-part-name">{name}</span>
                <span
                  className="ch-part-count"
                  data-state={partRead === 0 ? 'none' : partRead === part.chapters.length ? 'done' : 'partial'}
                >
                  {t('course.partCount', String(partRead), String(part.chapters.length))}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/**
 * The one place `/c/:courseId` calls `useProgress`, mounted by `CourseHome`
 * only once `useMe()` has confirmed a signed-in reader (Task 12). A
 * component rather than a plain conditional call because `useProgress` is
 * itself a hook — React's rules of hooks forbid calling it from inside an
 * `if`, so "only when signed in" has to mean "only when THIS component is
 * mounted," the same shape `reader/ChapterView.tsx`'s `AuthedReaderExtras`
 * uses for the same reason.
 *
 * Renders nothing. It exists purely to report `doneChapterIds` up to
 * `CourseHome`'s own state, which is what the resume card and the per-part
 * counts actually read — keeping the read-progress-locally concern in
 * exactly one place rather than spreading a second `useProgress` call
 * through the render below.
 */
function CourseProgress({
  courseId,
  onChange,
}: {
  courseId: string;
  onChange: (ids: ReadonlySet<string>) => void;
}) {
  const { doneChapterIds } = useProgress(courseId);
  useEffect(() => {
    onChange(doneChapterIds);
  }, [doneChapterIds, onChange]);
  return null;
}

export default CourseHome;
