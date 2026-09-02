---
version: 1
slug: "apps-web-src-pages-dashboard-tsx"
primary_target: "apps/web/src/pages/Dashboard.tsx"
related_targets: ["apps/web/src/pages/Courses.tsx","apps/web/src/pages/Progress.tsx","apps/web/src/shell/Shell.tsx","apps/web/src/shell/Sidebar.tsx","apps/web/src/shell/Topbar.tsx"]
---

# Brief bề mặt — shell + / (học tiếp) + /courses + /progress

Chế độ: Operate. Người tới: người tự học quay lại một chương khó lần thứ n, muốn mở đúng chỗ dừng và thấy ghi chú cũ của mình. Việc chính: tiếp tục đọc; việc phụ: chọn khoá, xem tiến độ.

Giữ nguyên: thân reader và toàn bộ bộ máy ghi chú (anchor/painter/normalize/MarginCards), i18n cả hai catalog, nhãn hạng `interactive` luôn hiện trước khi kéo gói, công tắc theme tường minh `html[data-theme]`, không toast (lỗi là `<p role="alert">` tại chỗ).

Chưa quyết (không được tự bịa): tên sản phẩm và monogram; đọc có cần tài khoản không (chủ dự án nói có, mã chưa theo) — trang chủ/đăng nhập có vòng riêng, và không câu chữ nào được khẳng định "không cần tài khoản".

## Direction contract

THESIS: Shell là trang giáo trình typeset có cột lề thật; từ chối dashboard thẻ–KPI–tím của category.

OWN-WORLD: Giấy #FFFFFF, mực #1A1A1A, nhấn #0B5FA5, lề #6B7280. Charis SIL thân, Archivo Narrow nhãn, hairline, số mục 1.1. Không thẻ, không bóng. Tối = đêm PDF: đảo giấy/mực.

STORY: Thấy Tiếp tục 1.2 và ghi chú mình ở lề; biết ngay dừng đâu, nghĩ gì; bấm vào đúng đoạn.

FIRST VIEWPORT: Cột chính 8/12: dòng Tiếp tục (chương, đoạn, phút), rồi mục lục có %. Lề 4/12: ba ghi chú gần nhất. Hành động chính là tên chương dở, link lớn, không nút màu. Hover ghi chú gạch đoạn gốc; click mở đúng đoạn; 150–200ms.

FORM: Giáo trình LaTeX lề rộng, hạng 1/7 (IMPECCABLE'S PICK), seed 57dcb485, code-led.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Lệch hợp đồng — ghi tại vòng kết thúc (2026-09-02)

Ba lời hứa trong hợp đồng không dựng được đúng chữ, vì dữ liệu hoặc reader chưa có; ghi ở đây để lần sau không đọc nhầm là bỏ quên.

- **"đoạn" trong dòng Tiếp tục.** `GET /progress` chỉ biết CHƯƠNG đã đọc, không có vị trí đoạn đang đọc. Dòng meta ghi: tên khoá · chương đã đọc · phút đã học (phút lấy từ `stats.courses[]`, cùng query với `/progress`).
- **"bấm vào đúng đoạn" của ghi chú lề.** `anchor` của ghi chú mờ với client này, và reader chưa cuộn tới một ghi chú theo hash. Trích đoạn là liên kết (hover gạch chân màu nhấn, 150ms) nhưng mở CHƯƠNG; nhãn "Mở chương" nói đúng điều đó. Khoảng trống ghi ở PRODUCT.md.
- **"mục lục có %".** Tiến độ theo chương là nhị phân (đã đọc / chưa), nên mục lục ghi "1/3 chương", "Đã đọc", "Tiếp theo" — thật hơn một con số phần trăm suy ra.

