-- Ghi danh khoá học: bảng trả lời "khoá nào là CỦA người này", tách hẳn khỏi
-- "khoá nào có trên hệ thống" (published_courses, ai cũng thấy y hệt nhau).
--
-- Trước bảng này, apps/web/src/pages/Dashboard.tsx trả lời câu thứ nhất bằng
-- dữ liệu của câu thứ hai: fallbackCourseIds() hợp danh mục công khai với
-- stats.courses[] rồi lấy phần tử đầu theo bảng chữ cái. Nên mọi tài khoản
-- vừa đăng ký đều thấy một khoá chưa từng mở nằm ở Học tiếp.
--
-- course_id là text, KHÔNG phải khoá ngoại tới published_courses — cùng lựa
-- chọn mà progress (migration 0001) đã làm, vì cùng một lý do: gỡ xuất bản một
-- khoá không được phép xoá tiến độ của người đọc, nên nó cũng không được xoá
-- ghi danh. Một khoá gỡ rồi xuất bản lại phải tìm thấy người đọc cũ y nguyên.
-- Cái giá đã biết: không ràng buộc nào ngăn một hàng trỏ tới course_id không
-- tồn tại; giao diện bỏ qua khoá không tra được manifest, y như đường progress.
--
-- KHÔNG backfill từ progress (quyết định của chủ sản phẩm, 03/09/2026). Hệ quả
-- phải biết trước: ngay sau khi triển khai, người đang đọc dở thấy Học tiếp
-- trống cho tới khi tự bấm "Bắt đầu học". Dữ liệu còn nguyên, chỉ bị giấu.
CREATE TABLE enrollments (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id));

-- GET /enrollments luôn hỏi đúng một hình dạng: mọi hàng của MỘT người, mới
-- nhất trước. Chỉ mục phủ đúng hình dạng ấy nên câu truy vấn không phải sắp xếp.
CREATE INDEX idx_enrollments_user ON enrollments (user_id, created_at DESC);
