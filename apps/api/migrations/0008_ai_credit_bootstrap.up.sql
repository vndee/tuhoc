-- 0008 vá HAI lỗ độc lập mà 0007 để lại, cả hai đều làm AI chết 100% và
-- IM LẶNG trên một deploy sạch (review tổng nhánh Pha 2, mục A1 và A2).
--
-- VÌ SAO LÀ 0008 CHỨ KHÔNG SỬA 0007 TẠI CHỖ: golang-migrate KHÔNG checksum
-- tệp migration. Một DB đang ở version 7 sẽ không bao giờ chạy lại 0007, nên
-- sửa 0007 chỉ vá cho những cài đặt HOÀN TOÀN MỚI và bỏ rơi đúng những cài
-- đặt đang chạy. Dự án đã trả giá một lần cho đúng lỗi này ở Pha 1 (phán
-- quyết 2026-08-26-pha1-ban-giao.md §3).

-- LỖ 1 (A1) — signup_grant_micro = 0, và không đường nào đặt nó khác 0.
--
-- 0007 khai cột này DEFAULT 0 và câu INSERT INTO ai_settings của chính nó
-- chỉ truyền base_system_prompt, nên mọi DB vừa migrate có grant = 0.
-- GrantSignupCredit (credits.go) đọc ĐÚNG cột ấy trong tx đăng ký → mọi tài
-- khoản mới có số dư 0 → EnsureCredit (`balance <= 0`) → **402 ngay câu hỏi
-- ĐẦU TIÊN của mọi người học**. Không thông báo lỗi nào nói "chưa cấu hình";
-- người vận hành thấy một sản phẩm im lặng từ chối tính năng chủ lực.
--
-- 50.000 micro là quyết định QĐ-1 của vòng sửa này: một lượt ở giá seed đo
-- được là 3.765 micro-credit, nên 50.000 ≈ 13 lượt — đủ để spec §3.4's "vài
-- câu để thấy agent đáng tiền" là thật. Rủi ro đã cân và ĐẶT TÊN: repo
-- không có xác thực email, nên K tài khoản = K x 50.000; nhận vì lựa chọn
-- còn lại là ship một tính năng không ai dùng được, vì 50.000 micro là nhỏ,
-- và vì RateLimiter chặn tốc độ đốt của từng tài khoản. Ghi trong
-- docs/carried-forward.md kèm điều kiện phải xét lại.
--
-- `WHERE signup_grant_micro = 0` chứ không UPDATE vô điều kiện: 0 là giá trị
-- "chưa ai từng đặt" (chính DEFAULT của 0007). Một người vận hành đã tự sửa
-- cột này bằng psql (hoặc scripts/test-e2e.sh trên stack e2e của nó) KHÔNG
-- được migration này ghi đè lựa chọn. Điều kiện ấy cũng là thứ làm câu lệnh
-- này CHẠY LẠI ĐƯỢC mà không đổi gì thêm.
-- Dòng sổ đi TRƯỚC câu UPDATE, không phải sau, vì điều kiện của cả hai là
-- `signup_grant_micro = 0` và câu UPDATE tự nó làm điều kiện ấy thành sai.
--
-- VÌ SAO PHẢI CÓ DÒNG NÀY (F3 của review): ngay khi grant khác 0,
-- GrantSignupCredit trở thành đường ĐÚC CREDIT duy nhất không để lại dấu vết
-- thao tác ở đâu — nó không ghi admin_audit (đo: 0→0) và không ghi ai_usage
-- như ChargeTurn. Cái CÓ THỂ (và phải) truy được là TỶ GIÁ ĐÚC: mỗi lần con
-- số ấy đổi. Từ Task 17's CMS thì UpdateSettings (credits.go) ghi một hàng
-- 'ai.settings.signup_grant'; giá trị KHỞI ĐẦU — chính con số dòng dưới đặt
-- — sẽ là lỗ hổng duy nhất trên trục thời gian ấy nếu migration này im
-- lặng. Có nó, mọi tài khoản đều truy ngược được: users.created_at đối
-- chiếu với chuỗi hàng 'ai.settings.signup_grant' cho biết grant nào đang có
-- hiệu lực lúc tài khoản ấy ra đời.
--
-- actor='cli' vì CHECK của admin_audit chỉ nhận 'user' hoặc 'cli' và một
-- migration không phải phiên đăng nhập của ai; who=NULL vì không có người
-- vận hành nào bấm nút.
INSERT INTO admin_audit (who, actor, action, target, note)
SELECT NULL, 'cli', 'ai.settings.signup_grant', 'ai_settings',
       'signup_grant_micro set to 50000: migration 0008 bootstrap (was 0)'
FROM ai_settings
WHERE signup_grant_micro = 0;

UPDATE ai_settings
SET signup_grant_micro = 50000, updated_at = now()
WHERE signup_grant_micro = 0;

-- LỖ 2 (A2) — tài khoản có TRƯỚC 0007 hỏng VĨNH VIỄN.
--
-- 0007 chỉ CREATE TABLE ai_credits; bảng khởi đầu RỖNG. GrantSignupCredit
-- chỉ chạy trong tx đăng ký (auth/repo.go), nên mọi tài khoản đã tồn tại
-- trước 0007 không có hàng nào → Balance trả pgx.ErrNoRows → EnsureCredit
-- ánh xạ sang ErrInsufficientCredit → 402. Sửa signup_grant_micro ở trên
-- KHÔNG cứu họ: nó chỉ tác động lần đăng ký KẾ TIẾP. Đường cứu duy nhất
-- trước migration này là AdjustCredit, từng người một, bằng tay, mãi mãi.
--
-- Cấp cho họ ĐÚNG con số grant vừa chốt ở trên, đọc lại từ bảng chứ không
-- viết lại hằng 50000 lần thứ hai: nếu người vận hành đã tự đặt một giá trị
-- khác, tài khoản cũ nhận đúng giá trị ấy, không nhận một con số thứ hai
-- mà không ai chọn.
--
-- `WHERE NOT EXISTS` là thứ làm câu lệnh này AN TOÀN KHI CHẠY LẠI, và nó
-- không chỉ chống trùng lặp: nó bảo vệ SỐ DƯ THẬT. Một tài khoản đã có hàng
-- (đã tiêu, đã được admin nạp, hay số dư âm) phải giữ nguyên số dư của nó —
-- một `ON CONFLICT DO UPDATE SET balance_micro = ...` sẽ xoá sổ lịch sử ấy.
INSERT INTO ai_credits (user_id, balance_micro)
SELECT u.id, (SELECT signup_grant_micro FROM ai_settings LIMIT 1)
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM ai_credits c WHERE c.user_id = u.id);
