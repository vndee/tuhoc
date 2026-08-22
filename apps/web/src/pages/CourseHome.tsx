import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { CourseNav } from '../course/CourseNav';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
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
    return <p className="ch-lede">{describeCourseError(manifestQuery.error)}</p>;
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
