import { Route, Routes } from 'react-router-dom';
import { ChapterPage } from './pages/ChapterPage';
import { CourseHome } from './pages/CourseHome';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';

/**
 * Route skeleton for P1. `/c/:courseId` renders the real course loader +
 * table of contents (Task 10). The rest are still placeholders (Tasks
 * 11-14 own the real content) but resolve and render inside <Shell> — see
 * App.tsx.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/c/:courseId" element={<CourseHome />} />
      <Route path="/c/:courseId/:chapterId" element={<ChapterPage />} />
    </Routes>
  );
}
