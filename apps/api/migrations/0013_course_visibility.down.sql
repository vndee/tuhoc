-- Gỡ theo thứ tự ngược 0011_course_visibility.up.sql.
--
-- Lưu ý cái này KHÔNG đảo ngược được về mặt ý nghĩa: chạy nó biến mọi khoá
-- riêng tư thành công khai ngay lập tức, vì cột phân biệt chúng biến mất.
-- Kiểm `SELECT slug FROM published_courses WHERE visibility = 'private'` rỗng
-- TRƯỚC khi chạy, hoặc gỡ publish các khoá ấy trước.
DROP INDEX IF EXISTS published_courses_visibility_idx;
ALTER TABLE published_courses DROP COLUMN visibility;
