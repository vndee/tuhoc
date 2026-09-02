---
version: 1
slug: "apps-web-src-pages-landing-tsx"
primary_target: "apps/web/src/pages/Landing.tsx"
related_targets: ["apps/web/src/routes.tsx","apps/web/src/pages/Login.tsx"]
---

# Landing — `/` cho khách chưa đăng nhập

**Phạm vi & chế độ:** Persuade. Một trang, đứng ở `/` khi `useMe()` trả null; người đã đăng nhập vẫn thấy Học tiếp. `/login` giữ form và hai điều khiển (chủ đề, ngôn ngữ), bỏ khối giới thiệu.

**Khán giả & việc của họ:** người tự học nói chung, tới lần đầu qua một đường dẫn, muốn biết trong 10 giây "đây là gì và tôi bấm gì". Hành động chính: **Đọc thử chương này** (miễn phí, không cần tài khoản — quyết định 02/09/2026, PRODUCT.md). Hành động phụ: Tạo tài khoản, để ghi chú, tiến độ, gia sư AI đi theo mình.

**Bằng chứng thật:** trích đoạn chương 1.1 của khoá mẫu công khai `bat-bien-vong-lap`; một ghi chú lề và một câu trả lời gia sư viết cho ví dụ, **gắn nhãn "ví dụ"** ở mọi chỗ khách có thể tưởng là thật; CTA chỉ trỏ tới chương khi danh mục công khai có khoá ấy, nếu không trỏ về `/courses`.

**Ràng buộc:** không giá, không testimonial, không logo đối tác, không hình stock; không câu nào mã chưa làm; thế giới DESIGN.md giữ nguyên (giấy một tờ, serif thân, sans hẹp nhãn, hairline, một xanh, không thẻ, không eyebrow trên tiêu đề, một chuyển động 150ms).

## Direction contract

THESIS: Landing là hành trình của MỘT câu hỏi qua sản phẩm — đọc, mắc, ghi chú, hỏi, quay lại đúng chỗ — không phải danh sách tính năng với hero và ba cột icon.

OWN-WORLD: giấy #ffffff, mực gray-900, một xanh #0b5fa5, hairline gray-200; Charis SIL thân, Archivo Narrow nhãn; khung `.doc` 2/3 + 1/3; ô màu ghi chú 9px; tối là đêm PDF trung tính.

STORY: khách hiểu "đọc là công khai, tài khoản giữ ghi chú và gia sư biết mình đã ghi gì", tin vì thấy đoạn sách thật + ghi chú neo đúng câu + câu trả lời trích ghi chú, rồi bấm Đọc thử.

FIRST VIEWPORT: tiêu đề `\title` là câu hỏi của người học (serif 40px); dưới là trích đoạn 1.1 với câu được bôi đen; lề: ghi chú neo câu ấy; ngay dưới đoạn: "Đọc thử chương này →" (liên kết serif lớn, không nút màu) và "Tạo tài khoản" là doc-link.

FORM: seed 57dcb485, code-led; bốn chặng xếp dọc trong cùng khung; hover ghi chú gạch chân câu gốc 150ms; không motion khác.

FINISH: mỗi chặng là một cảnh khác nhau (trích đoạn, biên bản hỏi đáp, hàng mục lục có tiến độ, danh mục), không chặng nào là hộp tính năng; nhãn "ví dụ" đọc được ở 390px.

## Chưa quyết

- Reader chưa cuộn tới ghi chú theo URL: liên kết từ ghi chú ví dụ mở chương, không mở đoạn.
