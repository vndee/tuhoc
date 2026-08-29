-- Đảo NỬA CẤU HÌNH của 0008, và CỐ Ý không đảo nửa dữ liệu.
--
-- Nửa cấu hình: trả signup_grant_micro về 0 — nhưng CHỈ khi nó vẫn đúng
-- bằng con số 0008 đặt. Người vận hành đổi sang giá trị của riêng mình thì
-- `down` không được quyền vứt lựa chọn ấy đi.
UPDATE ai_settings
SET signup_grant_micro = 0, updated_at = now()
WHERE signup_grant_micro = 50000;

-- Nửa dữ liệu KHÔNG đảo được, và giả vờ đảo được là cách mất tiền thật.
-- Sau khi 0008 chạy, không có cột nào phân biệt "hàng ai_credits do backfill
-- tạo" với "hàng do đăng ký tạo" hay "hàng admin đã nạp tay" — và số dư đã
-- SỐNG từ lúc ấy: người học đã tiêu, admin đã điều chỉnh, ChargeTurn đã ghi
-- sổ. Một câu DELETE ở đây sẽ xoá số dư thật của người thật để làm sạch một
-- con số. `down` này dừng lại ở nửa nó đảo được một cách trung thực; muốn
-- gỡ hẳn bảng thì đó là việc của 0007_ai_credits.down.sql.
