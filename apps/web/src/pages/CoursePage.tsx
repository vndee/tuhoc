import { useParams } from 'react-router-dom';

/**
 * Placeholder for `/c/:courseId`. Real course loader + course home
 * (manifest fetch, part/chapter nav, progress rings) is Task 10's job.
 */
export function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  return (
    <div>
      <h1 className="ch-title">Khóa học: {courseId}</h1>
      <p className="ch-lede">Danh sách chương sẽ hiển thị ở đây.</p>
    </div>
  );
}

export default CoursePage;
