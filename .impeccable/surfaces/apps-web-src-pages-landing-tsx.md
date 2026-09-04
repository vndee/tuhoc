---
version: 2
slug: "apps-web-src-pages-landing-tsx"
primary_target: "apps/web/src/pages/Landing.tsx"
related_targets: ["apps/web/src/routes.tsx","apps/web/src/styles/landing.css","packages/i18n/src/messages/vi.ts","packages/i18n/src/messages/en.ts"]
---

# Landing — `/` cho khách chưa đăng nhập

**Phạm vi & chế độ:** Persuade. Một trang đứng ở `/` khi `useMe()` trả null; người đã đăng nhập vẫn thấy Học tiếp. Landing có thế giới hình riêng trong `.board-room`, không dùng khung `.doc` của app. `/login` và reader không đổi.

**Khán giả & việc của họ:** người tự học tới lần đầu cần hiểu trong 10 giây rằng đây là giáo trình chi tiết, có thể tự tay thử ý niệm và hỏi AI ngay nơi đang vướng. Hành động chính là đọc một khoá công khai; hành động phụ là tạo tài khoản để giữ ghi chú, tiến độ và dùng gia sư AI.

**Bằng chứng thật:** visualization ở màn đầu là một biểu đồ năm khả năng thật, có thanh kéo và kết luận quan sát thay đổi theo dữ liệu. Danh mục đọc trực tiếp từ `GET /courses`; không viết cứng môn hay khoá. Phần hỏi AI là ví dụ và phải có nhãn tại chỗ. Hai raster được phép là `lesson-depth.webp` và thumbnail WebP responsive của Đặc san; cả hai kể về việc đọc, không giả làm ảnh sản phẩm.

**Ràng buộc sự thật:** không giá, testimonial, logo đối tác hay số liệu bịa; không nói personalization như năng lực hiện tại. Khoá riêng của chủ dự án không phải bằng chứng rằng sản phẩm đã cá nhân hoá công khai. Mọi chuỗi có đủ vi/en; trạng thái catalog rỗng/lỗi vẫn đọc được; CSS không rò ra trang khác.

## Direction contract

THESIS: “Đọc cho kỹ, chạm để thấy, hỏi đến khi hiểu.” Trang kể một hành trình học, không kê một danh sách tính năng. Chi tiết của giáo trình là xương sống; visualization làm ý niệm chuyển động dưới tay; AI nối tiếp đúng bài và ghi chú khi người học cần đào sâu.

OWN-WORLD: một bàn tay, hai mặt — sáng là bút chì trên giấy kem `#f4f1e8`, tối là phấn trên bảng đá `#26312e`; mực `#23211c`/`#eef1ea`; vàng là accent tiết chế, đất nung là dấu sửa. Shantell Sans giữ nét viết tay. Khung, rule, mũi tên và ngoặc là SVG có độ lệch hữu cơ. Raster chỉ xuất hiện ở `lesson-depth.webp` và thumbnail WebP responsive của Đặc san.

STORY: (1) lời hứa ba nhịp và visualization sống ngay màn đầu; (2) tranh sách mở chứng minh bài học có chiều sâu, không chỉ đưa đáp án; (3) một câu được bôi, ghi chú và câu trả lời AI cho thấy mạch đào sâu; (4) danh mục thật cho người xem chọn một cuốn và bắt đầu; (5) Đặc san sau catalog, trước footer, giới thiệu một bài kể tương tác công khai. Đặc san chỉ nhập metadata và thumbnail cover; prose, plate đầy đủ và lab đều ở sau lazy edge.

FIRST VIEWPORT: bên trái là một câu headline ba dòng nối bằng dấu phẩy, lede và CTA mang tên khoá đầu tiên nếu catalog có dữ liệu. Bên phải là “Chạm để thấy”: năm cột xác suất, đường nối vàng, slider “Mức độ phân tán” và một câu quan sát thay đổi ở ba ngưỡng. Đây là artifact tương tác thật, không phải hình minh hoạ giả giao diện. Riêng landing dùng một menubutton ngôn ngữ: trigger ở trạng thái nghỉ chỉ là mã VI/EN, không viền và không chevron; popup giấy ghi “VI — Tiếng Việt” và “EN — English”, lựa chọn hiện tại có dấu phấn vàng. Menu phải giữ arrow keys, Home/End, Enter/Space, Escape, click-outside và trả focus; các surface khác vẫn dùng native select.

ART: phong cách graphite + watercolor tiết chế, khoảng thở editorial, nhưng chủ thể là bàn học và giáo trình kỹ thuật riêng của Tự học. Không sao chép núi, người đi bộ, ngã rẽ, đá, cột chỉ đường hay bố cục của SynthWeave. `lesson-depth.webp` có provenance đặt cạnh asset; visualization và mọi nét nối khác là code-native. Bút chì chỉ vào slider, bookmark đánh dấu proof AI, mẩu phấn kết trang; không thêm motif thread/connector lặp lại vào Đặc san.

FORM: bảng viết tay hiện đại, code-led, xen một physical illustration plate. Bố cục bất đối xứng có chủ đích, cảnh sâu đổi phía để tạo nhịp. Tương tác có focus-visible và `prefers-reduced-motion`; chart có tên trợ năng, slider có `aria-valuetext`, kết luận là `role=status`.

EPILOGUE: footer là landmark `contentinfo`, không còn là một hàng ba link. “Còn một điều chưa hiểu? Bắt đầu từ đó.” đứng đối diện CTA “Mở toàn bộ danh mục”; tạo tài khoản và đăng nhập là lối phụ dưới CTA. Máng phấn vẫn là ranh giới vật lý cuối mặt viết.

TRUTH BOUNDARY: landing chỉ nói những gì chạy hôm nay — đọc công khai, widget tương tác trong bài, ghi chú, tiến độ và AI đọc bài/ghi chú. Personalization là hướng tương lai trong `PRODUCT.md`, chưa xuất hiện trong copy công khai.

FINISH: thay đổi hoàn tất khi test hành vi visualization, test ba trạng thái catalog và liên kết động đều chạy; TypeScript/lint/build sạch; desktop, mobile và dark mode đã được nhìn; mọi raster ship có provenance.

## Chưa quyết

- Reader chưa cuộn tới ghi chú theo URL: liên kết từ ghi chú ví dụ chỉ có thể mở chương, chưa mở đúng đoạn.
- Khi personalization trở thành năng lực công khai, cần quyết định bằng chứng nào cho thấy nội dung hoặc lộ trình thực sự đổi theo người học trước khi đưa lời hứa ấy lên trang.
