import { useParams } from 'react-router-dom';

/**
 * Placeholder for `/c/:courseId/:chapterId`. The real reader (chapter
 * fragment render, KaTeX/viz runtime injection, getContext) is Task 11's
 * job.
 */
export function ChapterPage() {
  const { courseId, chapterId } = useParams<{ courseId: string; chapterId: string }>();
  return (
    <div>
      <h1 className="ch-title">
        {courseId} / {chapterId}
      </h1>
      <p className="ch-lede">Nội dung chương sẽ hiển thị ở đây.</p>
    </div>
  );
}

export default ChapterPage;
