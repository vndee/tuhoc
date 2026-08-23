import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
import { useLanguage } from '../i18n/LanguageProvider';
import { ChapterView } from '../reader/ChapterView';

/**
 * `/c/:courseId/:chapterId` — the reader. Loads the manifest (shared
 * TanStack Query cache key with `CourseHome`/`Sidebar`, so this is
 * typically an instant cache hit rather than a second fetch), finds the
 * requested chapter in its flattened, part-ordered chapter list, and hands
 * it plus its neighbours to `ChapterView`, which owns everything about
 * actually rendering it (KaTeX, viz, rail, pager).
 */
export function Reader() {
  const { courseId, chapterId } = useParams<{ courseId: string; chapterId: string }>();
  const { t } = useLanguage();

  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId ?? ''),
    queryFn: () => loadManifest(courseId as string),
    enabled: courseId != null,
  });

  if (courseId == null || chapterId == null) {
    return <p className="ch-lede">{t('chapter.notFound')}</p>;
  }
  if (manifestQuery.isPending) {
    return <p className="ch-lede">{t('course.loading')}</p>;
  }
  if (manifestQuery.isError) {
    return <p className="ch-lede">{describeCourseError(manifestQuery.error, t)}</p>;
  }

  // Keep the part title alongside each chapter only long enough to find the
  // current one's — prevChapter/nextChapter stay plain Chapters (all the
  // pager needs), so ChapterView's pager logic doesn't have to care about
  // parts at all. Only the breadcrumb (current chapter only) needs it.
  const chaptersWithPart = manifestQuery.data.parts.flatMap((part) =>
    part.chapters.map((chapter) => ({ chapter, partTitle: part.title })),
  );
  const index = chaptersWithPart.findIndex((c) => c.chapter.id === chapterId);
  if (index === -1) {
    return <p className="ch-lede">{t('chapter.notFoundInCourse')}</p>;
  }

  return (
    <ChapterView
      courseId={courseId}
      courseTitle={manifestQuery.data.title}
      chapter={chaptersWithPart[index].chapter}
      partTitle={chaptersWithPart[index].partTitle}
      prevChapter={chaptersWithPart[index - 1]?.chapter ?? null}
      nextChapter={chaptersWithPart[index + 1]?.chapter ?? null}
      // Chế độ đọc has no sidebar, so the course outline that used to live
      // there now lives in the reader's table-of-contents drawer — and the
      // manifest this component already holds is where it comes from. Passed
      // rather than re-fetched: see `ChapterViewProps.parts`.
      parts={manifestQuery.data.parts}
    />
  );
}

export default Reader;
