---
version: 1
slug: "apps-web-src-pages-landing-tsx"
primary_target: "apps/web/src/pages/Landing.tsx"
related_targets: ["apps/web/src/routes.tsx","apps/web/src/styles/landing.css"]
---

# Landing — `/` cho khách chưa đăng nhập

**Phạm vi & chế độ:** Persuade. Một trang, đứng ở `/` khi `useMe()` trả null; người đã đăng nhập vẫn thấy Học tiếp. Landing có **thế giới hình riêng**, không dùng lại khung `.doc` của vỏ app (quyết định 03/09/2026: chủ dự án nói trang cũ "nhìn giống trang đã đăng nhập hơn là landing page"). `/login` không đổi.

**Khán giả & việc của họ:** người tự học nói chung, tới lần đầu qua một đường dẫn, muốn biết trong 10 giây "đây là gì và tôi bấm gì". Hành động chính: **Đọc thử chương này** (miễn phí, không cần tài khoản — PRODUCT.md). Hành động phụ: Tạo tài khoản, để ghi chú, tiến độ, gia sư AI đi theo mình.

**Bằng chứng thật:** danh mục THẬT từ `GET /courses` — và chỉ nó. **Không một khoá nào được viết cứng** (yêu cầu chủ dự án 03/09/2026: *"không nên để một khoá học cụ thể như vậy, khoá này không phải ai cũng quan tâm và không phải ai cũng hiểu nó là gì"*); ba bước cơ chế dùng chữ trung tính gắn nhãn **"ví dụ"**. Hành động chính trỏ tới khoá ĐẦU TIÊN trong danh mục cùng tên thật của nó; danh mục rỗng hoặc hỏng thì trỏ về `/courses`.

**Ràng buộc:** không giá, không testimonial, không logo đối tác, không hình stock; không câu nào mã chưa làm; song ngữ vi/en ở cả hai catalog; `packages/course-kit/reader.css` và vỏ app không được đụng tới; CSS của landing không được rò sang trang khác.

## Direction contract

THESIS: Trang là một MẶT VIẾT TAY diễn đúng ba bước của cơ chế — câu được gạch, ghi chú của bạn, gia sư cầm chính ghi chú ấy. Từ chối cả hero-ba-ô-tính-năng lẫn trang typeset của vỏ app.

OWN-WORLD: một bàn tay, hai mặt — sáng là bút chì trên giấy kem `#f4f1e8` (mực `#23211c`), tối là phấn trên bảng đá `#26312e` (mực `#eef1ea`); vàng `#e8c547` bôi câu, cam `#c4603a`/`#dd9165` là dấu sửa; Shantell Sans là nét tay duy nhất; mọi khung, gạch, mũi tên, ngoặc, máng phấn là nét vẽ tay SVG qua bộ lọc nhiễu — không `border` CSS, không khối CSS giả làm vật, không một nhãn HOA giãn chữ nào.

STORY: khách hiểu ĐÂY LÀ CÁI GÌ ở ngay nhan đề, thấy trang tin vào điều gì (hình vẽ cuốn sách mở ra công thức và mô hình), đọc bốn dòng nói mình làm được gì, thấy cơ chế diễn ra bằng chữ trung tính, rồi bấm vào một khoá THẬT trong danh mục.

FIRST VIEWPORT: nhan đề viết tay 53px góc trên trái GỌI TÊN THỂ LOẠI, dưới là một lối đã thử bị gạch xoá và ô đóng khung tay "Đọc thử — <tên khoá thật>"; bên phải là hình phấn: một cuốn sách mở, và từ nó bay lên mạng nơ-ron, ký hiệu toán, hành tinh có vành, mấy ngôi sao. Không nhãn, không câu — hình tự nói. Cơ chế ba bước xuống thành mục riêng, vì nó là BẰNG CHỨNG nên đứng sau lời tuyên bố.

FORM: mặt viết tay (bảng phấn giảng đường, đảo cực theo chủ đề), ứng viên 1 trong danh sách của tôi, thẻ IMPECCABLE'S PICK; seed 7f29cad4; code-led. Nét vẽ chữ ký: mũi tên tự vẽ ra khi chạm câu hoặc ghi chú, `stroke-dashoffset`, có `prefers-reduced-motion`.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Nâng từ những hướng bị loại

- **Kraftwerk man-machine** → cơ chế phải được VẼ RA, không phải nói ra: mũi tên phấn là một nét thật nối ba thứ.
- **Cracktro scroller** → phân cấp gánh bằng mật độ phấn và cỡ chữ, không thêm hộp hay panel nào.
- **Nixie counter** → đổi trạng thái là một sự kiện vật lý: phấn được vẽ ra, không phải một sắc độ đổi nhẹ.
- **Đèn washi Akari** → nền là một trường có cam kết, không phải giấy trắng rắc dấu lên.
- **Plate book Breton** → danh mục đọc ra như bảng kê có đánh số, đúng lời hứa "khoá học là gói mở".

## Chưa quyết

- Reader chưa cuộn tới ghi chú theo URL: liên kết từ ghi chú ví dụ mở chương, không mở đoạn.
- Thanh trên của vỏ app ẩn hết khi chưa đăng nhập (`TopNav.tsx:88`): khách trên landing không có lối đăng nhập ở chrome. Chưa quyết sẽ sửa ở vỏ app hay landing tự mang lối vào.
