import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminCourses } from './admin/AdminCourses';
import { AdminCredits } from './admin/AdminCredits';
import { AdminGuard } from './admin/AdminGuard';
import { AdminPricing } from './admin/AdminPricing';
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
 * Task 12 — `/c/:courseId`, `/c/:courseId/:chapterId` and `/courses` are the
 * three routes NOT wrapped in `<RequireAuth>` any more, alongside `/login`.
 * Spec §2.4: courses are free to read with no account; signing in is what
 * makes progress, notes and AI conversations follow a reader between
 * devices, not the price of opening a chapter. `ChapterView`'s
 * `AuthedReaderExtras` (and `CourseHome`'s own equivalent) are where that
 * distinction actually lives — every hook that WRITES anything is called
 * only once a session is confirmed; see their doc comments.
 *
 * Every OTHER route below is still wrapped: `/`, `/progress`, `/settings`
 * show a specific reader's own numbers/keys, not a course's public content,
 * and a logged-out visit to any of them is still bounced to `/login` and
 * returned here afterwards (see RequireAuth.tsx / Login.tsx's
 * `redirectTarget`). `/login` itself is deliberately never wrapped — see
 * RequireAuth.tsx's doc comment for why that separation is what actually
 * prevents a redirect loop.
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

        Task 13 (spec `2026-08-25-server-side-pivot.md` §1) xoá "hành động" ấy
        khỏi danh sách hẳn — không phải chỉ gộp nó vào chỗ khác. `/import`
        từng là NÚT "Nhập gói" bên trong `/courses`; nay hành động ấy không
        còn tồn tại (server là nguồn duy nhất của mọi course, qua
        `tuhoc publish`), nên chỉ còn hai loại thật: nơi chốn và thiết lập.
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
        `/courses` — MỘT danh mục công khai. Trước Task 13 nó gộp ba màn cũ:
        thư viện của bạn, kho cộng đồng (một TAB), và nhập gói (một NÚT); tất
        cả đã đi cùng luồng import chết (spec
        `2026-08-25-server-side-pivot.md` §1). Nay `<Courses>` chỉ còn vẽ
        danh mục `fetchCatalog` trả về — không tab, không nút, không hộp
        thoại nào.

        KHÔNG còn `<RequireAuth>` (Task 12) — spec §2.4 làm đọc thành công
        khai.

        Task 12's report ghi lại một điểm chưa vá ở ĐÚNG route này: gói kéo về
        qua nút "Nhập gói" từng ghi vào `db.packages` mà không cần đăng nhập,
        và `clearLocalData()` xoá bảng ấy ở lần đổi phiên kế — một gói kéo về
        lúc chưa đăng nhập bị mất ngay sau đó. Task 13 đóng điểm ấy bằng cách
        xoá chính thứ tạo ra nó: không còn nút "Nhập gói" nào ở màn này (hay ở
        bất cứ đâu khác trong ứng dụng) để bấm, không còn `course/import.ts`
        để gọi, và bảng `db.packages` bản thân nó đã bị gỡ khỏi lược đồ Dexie
        (`db/local.ts`). Đóng bằng cách xoá đường ghi, không phải bằng cách
        thêm một điều kiện chặn nó.
      */}
      <Route path="/courses" element={<Courses />} />

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

      {/*
        Task 12 — the reader itself. No `<RequireAuth>`: a direct link to a
        chapter must resolve cold, in a fresh browser with no session — that
        is the entire point of making courses public (spec §2.4). What a
        session actually buys here (annotations, progress, the study
        heartbeat) is gated inside `CourseHome`/`ChapterView` themselves, not
        at the route.
      */}
      <Route path="/c/:courseId" element={<CourseHome />} />
      <Route path="/c/:courseId/:chapterId" element={<Reader />} />

      {/*
        BA ROUTE CŨ — VẪN LÀ CHUYỂN HƯỚNG, vì "mọi liên kết đã lưu đều dùng
        đường cũ; xoá thẳng là làm hỏng thứ đang chạy" (đặc tả IA) không đổi
        chỉ vì đích của chúng đã đổi hình dạng.

        Task 13 XOÁ những gì `?import=1`/`?tab=registry` từng mở — không còn
        hộp thoại "Nhập gói", không còn tab "Kho cộng đồng" — nhưng KHÔNG xoá
        ba route chuyển hướng này. Một dấu trang tới `/import` vẫn phân giải:
        nó chỉ còn rơi xuống danh mục công khai trơn, đúng như một cú bấm
        `/courses` bình thường, thay vì mở thêm gì. `?import=1`/`?tab=registry`
        đi theo cho ĐỦ (không xoá đường cũ để giữ nguyên hành vi "phân giải
        được" của nó), nhưng bản thân hai tham số ấy giờ không ai đọc.

        KHÔNG bọc `<RequireAuth>` — `/courses` đã công khai từ Task 12 (spec
        §2.4), và không route nào trong ba route này còn việc gì để gác cổng
        nữa: đích của chúng tự nó công khai, và không còn hành động ghi nào
        (nhập gói) ẩn phía sau để cần một phiên mới cho phép. `replace` để nút
        Lùi không rơi trở lại vào đúng cái route vừa chuyển hướng đi.
      */}
      <Route path="/library" element={<Navigate to="/courses" replace />} />
      <Route path="/import" element={<Navigate to="/courses?import=1" replace />} />
      <Route path="/catalog" element={<Navigate to="/courses?tab=registry" replace />} />

      {/*
        Task 15 — `/admin`, the browser face of Task 8's admin write path.
        `AdminGuard` (not `RequireAuth`): `role !== 'admin'` sends a signed-
        in but ordinary reader to `/`, not to `/login` — they ARE
        authenticated, they are simply not allowed here, and `RequireAuth`
        has no concept of that distinction (it only asks "is anyone signed
        in"). See `admin/AdminGuard.tsx` for the guard's own three-state
        contract.
      */}
      <Route
        path="/admin"
        element={
          <AdminGuard>
            <AdminCourses />
          </AdminGuard>
        }
      />

      {/*
        Task 17 — `/admin/credits` ("Người dùng & credit") and
        `/admin/pricing` ("Bảng giá & prompt nền"), spec §7's other two Pha
        2 CMS screens. Same `AdminGuard` as `/admin` above, for the
        identical reason: `role !== 'admin'` bounces to `/`, not `/login`.
      */}
      <Route
        path="/admin/credits"
        element={
          <AdminGuard>
            <AdminCredits />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/pricing"
        element={
          <AdminGuard>
            <AdminPricing />
          </AdminGuard>
        }
      />
    </Routes>
  );
}
