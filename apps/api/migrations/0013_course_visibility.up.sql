-- Khoá riêng tư: một khoá đã publish nhưng CHỈ admin đọc được.
--
-- Trước migration này, nền tảng chỉ có hai trạng thái — đã publish (ai cũng
-- đọc được, không cần tài khoản) và chưa publish (không ai đọc được, kể cả
-- chủ). Không có chỗ nào cho "tôi muốn đọc giáo trình của mình trên nền tảng
-- của mình mà người khác thì không". Hệ quả đo được: một giáo trình riêng nằm
-- trong danh mục công khai của bản sản xuất, và `curl` không kèm xác thực lấy
-- được cả tên, mô tả lẫn mục lục của nó.
--
-- 'public' là MẶC ĐỊNH, có chủ ý: mọi khoá đang có đều công khai và phải giữ
-- nguyên như vậy sau khi migrate. Một mặc định 'private' sẽ âm thầm gỡ cả danh
-- mục khỏi tay người đọc.
ALTER TABLE published_courses
  ADD COLUMN visibility text NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'private'));

-- Danh mục công khai lọc theo cột này ở MỌI lần đọc, nên nó nằm trong đường
-- nóng của trang được xem nhiều nhất.
CREATE INDEX published_courses_visibility_idx
  ON published_courses (visibility);
