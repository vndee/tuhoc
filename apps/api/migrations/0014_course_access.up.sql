-- Cấp quyền đọc một khoá RIÊNG cho một người cụ thể.
--
-- Migration 0013 cho khoá hai trạng thái: công khai, hoặc chỉ admin đọc. Không
-- có chỗ nào cho "người này đọc được khoá này" — mà muốn cho một người đọc thì
-- cách duy nhất là nâng họ lên admin, tức trao luôn quyền publish, gỡ publish
-- và xoá MỌI khoá. Quá nhiều quyền cho một việc là đọc.
--
-- KHÔNG có khoá ngoại từ `slug` sang `published_courses`, và đó là chủ đích,
-- không phải chỗ quên:
--
--   `catalog.Publish` thay nguyên hàng — `DELETE FROM published_courses` rồi
--   `INSERT`. Một khoá ngoại ON DELETE CASCADE sẽ xoá sạch quyền của mọi người
--   MỖI LẦN tác giả publish lại khoá ấy, trong im lặng. Đó đúng là lớp lỗi mà
--   0013 vừa phải chống bằng cách đọc lại `visibility` trước khi ghi đè.
--
--   Cái giá của việc bỏ khoá ngoại: một hàng quyền có thể trỏ tới slug không
--   còn tồn tại. Vô hại — mọi phép đọc đều JOIN qua `published_courses`, nên
--   quyền mồ côi không mở được gì cả; và nếu khoá ấy được publish lại thì
--   quyền cũ sống lại đúng như người cấp mong đợi.
--
-- `user_id` THÌ có khoá ngoại và CASCADE: xoá tài khoản là mất quyền, luôn.
CREATE TABLE course_access (
  slug       text NOT NULL,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slug, user_id));

-- Phép đọc chạy theo (slug, user_id) — đã là khoá chính. Chỉ mục này cho chiều
-- ngược: "người này được cấp những khoá nào", thứ danh mục cần khi dựng
-- `GET /courses` cho một người đã đăng nhập.
CREATE INDEX course_access_user_idx ON course_access (user_id);
