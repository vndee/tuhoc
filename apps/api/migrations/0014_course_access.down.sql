-- Gỡ 0014_course_access.up.sql.
--
-- Chạy nó là THU HỒI mọi quyền đã cấp: sau đó khoá riêng trở lại chỉ-admin, và
-- người từng được cấp sẽ thấy 404 như người lạ. Không mất dữ liệu nào khác.
DROP INDEX IF EXISTS course_access_user_idx;
DROP TABLE IF EXISTS course_access;
