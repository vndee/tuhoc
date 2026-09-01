-- Task 2 (Pha 3): /annotations giờ xoá thật, không còn tombstone.
--
-- annotations.deleted_at từng là nơi POST /sync's push (protocol cũ) ghi
-- một "tombstone": hàng bị đánh dấu xoá nhưng vẫn NẰM TRONG bảng, để
-- GET /sync's pull lan nó sang thiết bị khác như một sự kiện xoá. Trình
-- duyệt không còn local-first (xem kế hoạch Pha 3), nên /annotations (bốn
-- động từ REST của task này) không có khái niệm "đồng bộ nhiều thiết bị
-- qua tombstone" nữa — DELETE /annotations/:id xoá hàng thật, chấm hết.
--
-- Xoá trước những hàng đã là tombstone (deleted_at IS NOT NULL) rồi mới bỏ
-- cột: nếu bỏ cột trước, những hàng ấy sẽ "sống lại" vĩnh viễn — đúng thứ
-- migration này tồn tại để không xảy ra.
DELETE FROM annotations WHERE deleted_at IS NOT NULL;
ALTER TABLE annotations DROP COLUMN deleted_at;
