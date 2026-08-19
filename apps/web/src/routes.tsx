import { Route, Routes } from 'react-router-dom';
import { CourseHome } from './pages/CourseHome';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Reader } from './pages/Reader';

/**
 * Route skeleton for P1. `/c/:courseId` renders the real course loader +
 * table of contents (Task 10); `/c/:courseId/:chapterId` renders the real
 * reader — KaTeX, viz, rail TOC, pager (Task 11). `/` and `/login` are
 * still placeholders (Tasks 12/14 own the real content) but resolve and
 * render inside <Shell> — see App.tsx.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/c/:courseId" element={<CourseHome />} />
      <Route path="/c/:courseId/:chapterId" element={<Reader />} />
    </Routes>
  );
}
