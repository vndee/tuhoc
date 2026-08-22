import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { Catalog } from './registry/Catalog';
import { CourseHome } from './pages/CourseHome';
import { Dashboard } from './pages/Dashboard';
import { ImportCourse } from './pages/ImportCourse';
import { Library } from './pages/Library';
import { Login } from './pages/Login';
import { Reader } from './pages/Reader';
import { Settings } from './pages/Settings';

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
      {/*
        `/import` sits behind RequireAuth like everything else, and for the
        same reason the others do rather than out of habit: an import writes
        into `db.packages`, which `clearLocalData()` empties on every auth
        transition (see db/local.ts). A package imported while logged out
        would be deleted by the next sign-in, which is a worse experience
        than being asked to sign in first.
      */}
      <Route
        path="/import"
        element={
          <RequireAuth>
            <ImportCourse />
          </RequireAuth>
        }
      />
      {/*
        `/library` (Task 9) is behind RequireAuth for the plainest of the
        reasons on this page: it LISTS a reader's own courses, including
        the private ones (spec §2.4 — private means no other user sees it),
        and `GET /courses` is scoped to the session cookie on the server
        side. A library screen that rendered for a logged-out visitor would
        either show nothing or show whatever the last session left in the
        query cache; the first is a broken page and the second is the leak.
      */}
      <Route
        path="/library"
        element={
          <RequireAuth>
            <Library />
          </RequireAuth>
        }
      />
      {/*
        `/settings` (hệ thống con 2, Task 6) là ĐIỂM VÀO của kho khoá — chỗ
        khung được mở rộng ra để người dùng dán key và bấm xác nhận đầu phiên.
        Trước route này cả hai màn ấy được vẽ nhưng chưa ai nhìn thấy được.

        Sau `RequireAuth` như mọi thứ khác, và vì một lý do cụ thể: trang này
        mở khung kho khoá và mời người dùng cắm key, còn `clearLocalData()`
        dọn dữ liệu cục bộ ở mỗi lần đổi phiên. Key thì KHÔNG bị dọn (nó nằm ở
        origin khác, không nằm trong Dexie), nhưng mời một người chưa đăng nhập
        đi cấu hình một tính năng chỉ dùng được sau khi đăng nhập là mời họ đi
        một vòng vô ích.
      */}
      {/*
        `/catalog` (hệ thống con 3, Task 3) — duyệt registry course cộng đồng.
        MỘT tệp được tải cho việc này (`index.json`), không gọi GitHub API.

        Sau `RequireAuth`, cùng lý do `/import` đã ghi ở trên chứ không phải
        theo thói quen: màn hình này tồn tại để dẫn tới một lần KÉO VỀ, và một
        gói kéo về lúc chưa đăng nhập sẽ bị `clearLocalData()` xoá ở lần đăng
        nhập kế tiếp. Mời người ta duyệt rồi lặng lẽ vứt thứ họ chọn thì tệ hơn
        là hỏi họ đăng nhập trước.

        Điều này KHÔNG mâu thuẫn với "bản tự chạy dùng được registry công khai
        ở chế độ chỉ-đọc" (spec §1.1): ràng buộc ấy nói về cách nền tảng đọc
        registry — không khoá, không token, không API — chứ không nói về việc
        ai được đăng nhập vào bản tự chạy.
      */}
      <Route
        path="/catalog"
        element={
          <RequireAuth>
            <Catalog />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <Settings />
          </RequireAuth>
        }
      />
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
