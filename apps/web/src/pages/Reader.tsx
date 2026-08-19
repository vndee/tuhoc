import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
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

  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId ?? ''),
    queryFn: () => loadManifest(courseId as string),
    enabled: courseId != null,
  });

  if (courseId == null || chapterId == null) {
    return <p className="ch-lede">Không tìm thấy chương này.</p>;
  }
  if (manifestQuery.isPending) {
    return <p className="ch-lede">Đang tải khóa học…</p>;
  }
  if (manifestQuery.isError) {
    return <p className="ch-lede">{describeCourseError(manifestQuery.error)}</p>;
  }

  const chapters = manifestQuery.data.parts.flatMap((part) => part.chapters);
  const index = chapters.findIndex((c) => c.id === chapterId);
  if (index === -1) {
    return <p className="ch-lede">Không tìm thấy chương này trong khóa học.</p>;
  }

  return (
    <ChapterView
      courseId={courseId}
      courseTitle={manifestQuery.data.title}
      chapter={chapters[index]}
      prevChapter={chapters[index - 1] ?? null}
      nextChapter={chapters[index + 1] ?? null}
    />
  );
}

export default Reader;
