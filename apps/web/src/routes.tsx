import { Route, Routes } from 'react-router-dom';
import { ChapterPage } from './pages/ChapterPage';
import { CoursePage } from './pages/CoursePage';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';

/**
 * Route skeleton for P1. Every page here is a placeholder (Tasks 10-14 own
 * the real content) but the routes themselves must resolve and render
 * inside <Shell> — see App.tsx.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/c/:courseId" element={<CoursePage />} />
      <Route path="/c/:courseId/:chapterId" element={<ChapterPage />} />
    </Routes>
  );
}
