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

        KHÔNG còn `<RequireAuth>` (Task 12) — spec §2.4 làm đọc thành công
        khai, và tab "Kho cộng đồng" của chính màn này phải dựng được cho
        người chưa đăng nhập, vì nó không thuộc về ai cả.

        Việc này ĐỂ LẠI một điểm chưa vá, ghi ra chứ không giấu: gói kéo về
        qua nút "Nhập gói" ở màn này vẫn ghi vào `db.packages`, và
        `clearLocalData()` vẫn dọn sạch bảng ấy ở mỗi lần đổi phiên (xem
        db/local.ts) — một gói kéo về lúc chưa đăng nhập vẫn bị xoá ở lần
        đăng nhập kế. Task 12's brief chỉ định rõ ba route này bỏ
        `<RequireAuth>`, không định rõ nhập gói tự nó; gói riêng nút ấy lại
        theo phiên là việc của một task khác, có lý do riêng thay vì ăn theo
        việc gỡ cổng ở đây.
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

        KHÔNG bọc `<RequireAuth>` — và, kể từ Task 12, không phải vì `/courses`
        đã ở sau nó rồi (không còn nữa: đọc là công khai, spec §2.4). Ba
        chuyển hướng này đơn giản là không có gì để gác cổng: đích của chúng
        (`/courses`, có hoặc không `?import=1`/`?tab=registry`) tự nó công
        khai rồi. `replace` để nút Lùi không rơi trở lại vào đúng cái route
        vừa chuyển hướng đi.
      */}
      <Route path="/library" element={<Navigate to="/courses" replace />} />
      <Route path="/import" element={<Navigate to="/courses?import=1" replace />} />
      <Route path="/catalog" element={<Navigate to="/courses?tab=registry" replace />} />
    </Routes>
  );
}
