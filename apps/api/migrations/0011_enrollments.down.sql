-- Nghịch đảo đúng của up.sql. DROP TABLE cuốn theo cả chỉ mục và khoá ngoại,
-- nên không cần câu lệnh riêng cho chúng.
--
-- Đây là một xoá THẬT và không hoàn tác được: chạy down rồi up lại sẽ cho một
-- bảng rỗng, tức mọi người đọc mất ghi danh và phải bấm "Bắt đầu học" lần nữa.
-- progress và annotations không bị đụng tới, nên không có tiến độ hay ghi chú
-- nào mất theo.
DROP TABLE enrollments;
