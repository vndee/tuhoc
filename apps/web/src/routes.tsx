import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { CourseHome } from './pages/CourseHome';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Reader } from './pages/Reader';

/**
 * Route skeleton for P1. `/c/:courseId` renders the real course loader +
 * table of contents (Task 10); `/c/:courseId/:chapterId` renders the real
 * reader — KaTeX, viz, rail TOC, pager (Task 11). `/` is still a
 * placeholder (Task 14 owns its real content) but resolves and renders
 * inside <Shell> — see App.tsx.
 *
 * Every route except `/login` is wrapped in `<RequireAuth>` (Task 12):
 * progress/annotations/stats are all per-user, so nothing behind them is
 * meant to be reachable while logged out — a logged-out visit to any of
 * these, including a direct chapter URL, is bounced to `/login` and
 * returned here afterwards (see RequireAuth.tsx / Login.tsx's
 * `redirectTarget`). `/login` itself is deliberately the one route NOT
 * wrapped — see RequireAuth.tsx's doc comment for why that separation is
 * what actually prevents a redirect loop.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route path="/login" element={<Login />} />
      <Route
        path="/c/:courseId"
        element={
          <RequireAuth>
            <CourseHome />
          </RequireAuth>
        }
      />
      <Route
        path="/c/:courseId/:chapterId"
        element={
          <RequireAuth>
            <Reader />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
