import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { CourseNav } from '../course/CourseNav';
import { loadManifest, manifestQueryKey } from '../course/loader';

export interface CourseHomeProps {
  /** Chapter ids the learner has marked as read. Empty until Task 14 wires real progress. */
  doneChapterIds?: ReadonlySet<string>;
}

/**
 * `/c/:courseId` — the course's table of contents: title, description, and
 * every chapter grouped by part, styled with the original stylesheet's own
 * nav classes (`.nav-part`, `a.nav-item`, `.nav-num` via `CourseNav`) so it
 * reads like v1's sidebar. Per-part progress rings need data from Task
 * 13's sync engine, which doesn't exist yet — intentionally not built here
 * (see task report).
 */
export function CourseHome({ doneChapterIds }: CourseHomeProps) {
  const { courseId } = useParams<{ courseId: string }>();
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId ?? ''),
    queryFn: () => loadManifest(courseId as string),
    enabled: courseId != null,
  });

  if (courseId == null) {
    return <p className="ch-lede">Không tìm thấy khóa học.</p>;
  }

  if (manifestQuery.isPending) {
    return <p className="ch-lede">Đang tải khóa học…</p>;
  }

  if (manifestQuery.isError) {
    return <p className="ch-lede">Không tải được khóa học: {manifestQuery.error.message}</p>;
  }

  const manifest = manifestQuery.data;

  return (
    <div>
      <h1 className="ch-title">{manifest.title}</h1>
      <p className="ch-lede">{manifest.description}</p>
      <nav aria-label={manifest.title}>
        <CourseNav courseId={courseId} parts={manifest.parts} doneChapterIds={doneChapterIds} />
      </nav>
    </div>
  );
}

export default CourseHome;
