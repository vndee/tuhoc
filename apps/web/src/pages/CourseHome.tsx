import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { flatChapters, nextChapter } from '../course/chapters';
import { TierBadge } from './Library';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
import { manifestString } from '../course/owned';
import { useLanguage } from '../i18n/LanguageProvider';
import { useProgress } from '../progress/useProgress';

/**
 * `/c/:courseId` — the course's table of contents: title, description, and
 * every chapter grouped by part, styled with the original stylesheet's own
 * nav classes (`.nav-part`, `a.nav-item`, `.nav-num` via `CourseNav`) so it
 * reads like v1's sidebar.
 *
 * `doneChapterIds` (Ruling F4 / debt #1) comes from `useProgress`, this
 * task's own local-progress hook — not a prop, unlike the Task 10
 * placeholder this replaces. `useProgress` is called unconditionally
 * (Rules of Hooks) with `courseId ?? ''` — an empty-string courseId
 * simply never matches any local progress row, the same harmless-no-op
 * shape `manifestQuery`'s `enabled: courseId != null` already uses for
 * the "route param not resolved yet" case below.
 */
export function CourseHome() {
  const { courseId } = useParams<{ courseId: string }>();
  const { t } = useLanguage();
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId ?? ''),
    queryFn: () => loadManifest(courseId as string),
    enabled: courseId != null,
  });
  const { doneChapterIds } = useProgress(courseId ?? '');

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
      {/* HÀNG BADGE trước nhan đề — bản dựng đã duyệt.
          Chỉ những gì MANIFEST biết: hạng an toàn, phiên bản, ngôn ngữ. Nguồn
          gói ("registry" / "tự nhập") KHÔNG có ở đây — nó là thuộc tính của
          hàng thư viện, không của gói — và bịa nó ra là nói một điều trang này
          không biết. */}
      <p className="ch-badges">
        <TierBadge tier={manifestString(manifest, 'tier')} />
        <span className="ch-badge-meta">{t('library.meta.version', manifest.version)}</span>
        <span className="ch-badge-meta">{manifest.lang}</span>
      </p>
      <h1 className="ch-title">{manifest.title}</h1>
      <p className="ch-lede">{manifest.description}</p>

      {/* CHỖ ĐANG DỞ — câu trả lời cho "mở cái gì bây giờ", đứng trước mọi thứ
          khác trên trang này. */}
      {target !== undefined && (
        <section className="ch-resume">
          <p className="ch-resume-eyebrow">{t(read === 0 ? 'home.start' : 'home.eyebrow')}</p>
          <div className="ch-resume-row">
            <div className="ch-resume-body">
              <h2 className="ch-resume-title">
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
            return (
              <li className="ch-part" key={`${index}-${part.title}`}>
                <span className="ch-part-name">{part.title}</span>
                <span className="ch-part-count" data-done={partRead === part.chapters.length ? 'true' : undefined}>
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

export default CourseHome;
