---
version: 1
slug: "apps-web-src-shell-logo-tsx"
primary_target: "apps/web/src/shell/Logo.tsx"
related_targets: ["apps/web/public/favicon.svg","apps/web/index.html"]
---

Phạm vi: dấu hiệu và trọn bộ biểu tượng (favicon, apple-touch, manifest, maskable). Chế độ: Persuade — nó không có việc gì để làm xong, nó tồn tại để được nhận ra.

Người xem: người tự học, gặp dấu hiệu này ở tab trình duyệt lẫn màn hình chính, cạnh ba mươi biểu tượng khác. Ràng buộc: tên "Tự học" là chỗ giữ chỗ (PRODUCT.md, Brand Commitments) nên dấu hiệu KHÔNG mang chữ cái; đặt tên là quyết định của chủ dự án.

## Direction contract

THESIS: Vệt người đọc để lại lớn hơn chỗ được đánh dấu. Từ chối cách xếp mặc định của thể loại — quyển sách mở, mũ cử nhân, bóng đèn, tia sét — và từ chối cả monogram chữ cái trong ô bo góc.

OWN-WORLD: Giấy kem #f4f1e8 và bảng đá #26312e, mực #23211c, đất nung #a94f2b. Một nét đặc, một khung mảnh, khoảng trống được vẽ kỹ ngang với nét. Một màu, không gradient, không đổ bóng. Trong khung app mark dùng `currentColor` nên NỀN của nó là token mặt mà màn chủ sơn, không phải một mã màu cố định: `/` và `/courses` là `--page`, `/login` là `--surface-1` (mặt nổi) — chênh nhau một bậc, và đó là thuộc tính của màn, không phải lệch của mark. Chỉ dạng app icon ghim màu cứng, vì nó không có màn chủ nào để thừa kế.

STORY: Người xem hiểu đây là nơi mình ĐỌC và ĐÁNH DẤU, không phải nơi xem bài giảng; tin rằng cái mình viết ra được giữ lại; và nhấn vào.

FIRST VIEWPORT: Trên lưới 16, khung chữ nhật mảnh 9.4×9.2 đặt tại (3.4, 3.4), nét khung ở độ mờ 0.50 (3.09:1 trên kem, cùng ngưỡng đã loại đất nung khỏi app icon); nét đặc rộng ~2.8 chạy dọc CHẾCH BÊN TRONG khung, tâm x=6.2, từ y=0.9 tới y=15.1 — vượt cả mép trên lẫn mép dưới. Khung KHÔNG biến mất ở cỡ nhỏ: lòng khung được mở bằng cách làm mảnh nét khung (1.2 ở ≤18px), không bằng cách bỏ khung hay dời thanh — cả hai đường ấy đã thử và đều làm mất một nửa hình.

FORM: "Nét vượt mép", ứng viên 5 trong danh sách xếp theo cộng hưởng (bảng phấn và vệt xoá), chủ dự án chọn sau vòng gieo lại thang bạo. Seed d402f7c9.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
