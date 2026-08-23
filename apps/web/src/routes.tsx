import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { CourseHome } from './pages/CourseHome';
import { Courses } from './pages/Courses';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Progress } from './pages/Progress';
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
      {/*
        BA NƠI CHỐN, và chỉ ba. Đặc tả:
        `docs/superpowers/specs/2026-08-23-ia-redesign.md`.

        Bảng route cũ có năm mục ngang hàng nhưng chúng là ba LOẠI khác nhau —
        nơi chốn (`/`, `/library`), hành động (`/import`) và thiết lập
        (`/settings` dưới tên "Trợ lý AI"). Người dùng phải tự phân loại hộ.
      */}
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
        `/courses` gộp ba màn cũ: thư viện của bạn, kho cộng đồng (một TAB), và
        nhập gói (một NÚT). Cả ba đều là "khoá học"; tách chúng ra ba mục thanh
        bên là bắt người dùng biết trước gói mình muốn đến từ đâu.

        Sau `RequireAuth` vì lý do cụ thể chứ không phải thói quen: màn này dẫn
        tới một lần ghi vào `db.packages`, mà `clearLocalData()` dọn sạch ở mỗi
        lần đổi phiên (xem db/local.ts). Một gói kéo về lúc chưa đăng nhập sẽ bị
        xoá ở lần đăng nhập kế — mời người ta chọn rồi lặng lẽ vứt là tệ hơn hỏi
        họ đăng nhập trước.
      */}
      <Route
        path="/courses"
        element={
          <RequireAuth>
            <Courses />
          </RequireAuth>
        }
      />

      {/*
        `/progress` — nơi các con số THUỘC VỀ. Trước đây chúng nằm trên trang
        chủ, biến màn hình đầu tiên của người dùng mới thành một bảng đếm toàn
        số 0 thay vì một lời mời bắt đầu.
      */}
      <Route
        path="/progress"
        element={
          <RequireAuth>
            <Progress />
          </RequireAuth>
        }
      />

      {/*
        `/settings` là ĐIỂM VÀO của kho khoá — chỗ khung được mở rộng để người
        dùng dán key và bấm xác nhận đầu phiên. Nay vào từ MENU TÀI KHOẢN ở đáy
        thanh bên, và "Trợ lý AI" là một mục BÊN TRONG nó, không phải một nơi
        chốn ngang hàng với "Khoá học".
      */}
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

      {/*
        BA ROUTE CŨ — NAY LÀ CHUYỂN HƯỚNG, vì đích của chúng đã tồn tại thật.

        Điều kiện mà chú thích trước đây đặt ra ("chúng sẽ thành `<Navigate>`
        trong CÙNG thay đổi dựng hai thứ ấy vào `/courses`") đã được thoả: cùng
        commit này dựng tab "Kho cộng đồng" và nút "Nhập gói" trong
        `pages/Courses.tsx`, và cùng commit này gỡ hai mục khỏi thanh bên.

        **Mỗi đích giữ lại thứ đường cũ LÀM ĐƯỢC, không chỉ giữ chỗ nó trỏ tới.**
        Đặc tả nói lý do phải có chuyển hướng: *"mọi liên kết đã lưu đều dùng
        đường cũ; xoá thẳng là làm hỏng thứ đang chạy"*. Một dấu trang tới
        `/import` mà rơi xuống một danh sách khoá học không có ô nhập nào thì
        vẫn còn phân giải được, nhưng đã hỏng mất việc nó dùng để làm — nên nó
        mang theo `?import=1` và hộp thoại mở ra ngay, đúng như `?tab=registry`
        mà chính đặc tả viết cho `/catalog`.

        KHÔNG bọc `<RequireAuth>`: `/courses` đã ở sau nó rồi, nên người chưa
        đăng nhập vẫn về `/login` — chỉ là qua đích mới thay vì qua một bản sao
        thứ hai của cùng cái cổng. `replace` để nút Lùi không rơi trở lại vào
        đúng cái route vừa chuyển hướng đi.
      */}
      <Route path="/library" element={<Navigate to="/courses" replace />} />
      <Route path="/import" element={<Navigate to="/courses?import=1" replace />} />
      <Route path="/catalog" element={<Navigate to="/courses?tab=registry" replace />} />
    </Routes>
  );
}
