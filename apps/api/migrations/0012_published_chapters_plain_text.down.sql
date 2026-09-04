-- Khớp quy ước của các bản down khác: IF EXISTS, để chạy lùi hai lần không
-- thành lỗi. Dữ liệu trong cột này dẫn xuất được lại hoàn toàn từ `html`,
-- nên bỏ nó không mất gì ngoài chi phí dựng lại.
ALTER TABLE published_chapters DROP COLUMN IF EXISTS plain_text;
