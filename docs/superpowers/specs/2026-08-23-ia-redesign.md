# Thiết kế lại thứ bậc (IA) — đặc tả

**Trạng thái:** chủ dự án đã duyệt trên canvas
`https://claude.ai/code/artifact/aa499e38-0284-45df-9266-e39fe969615c`.
Mọi task dựng theo tài liệu này. Canvas là hình; tài liệu này là hợp đồng.

## Vấn đề đang sửa

Thanh bên có **năm mục phẳng ngang hàng** nhưng chúng là **ba loại khác nhau**:

| mục | thật ra là |
|---|---|
| Bảng điều khiển | nơi chốn |
| Thư viện | nơi chốn |
| **Nhập khóa học** | **hành động** |
| **Danh mục registry** | **trùng "Thư viện"** |
| **Trợ lý AI** | **thiết lập** |

Người dùng phải tự phân loại hộ. Và trình đọc **thay luôn** thanh bên bằng mục
lục chương — hai mô hình điều hướng trong một sản phẩm, không cái nào nói cho
cái nào.

## Đề xuất: hai chế độ

### Chế độ thư viện — thanh bên hẹp, **ba** nơi chốn

| route | tên | nội dung |
|---|---|---|
| `/` | **Học tiếp** | MỘT hành động: chương đang dở. Kèm ghi chú gần đây. **KHÔNG** phải bảng số liệu. |
| `/courses` | **Khoá học** | Của bạn **và** kho cộng đồng, hai tab, một nơi. Nhập gói là **nút** ở đây. |
| `/progress` | **Tiến độ** | Nơi các con số thuộc về. Viết thành **câu**, kèm lịch nhiệt. |

Tài khoản + Cài đặt nằm ở **đáy thanh bên**, không phải một mục điều hướng.

### Chế độ đọc — không thanh bên, một cột chữ

`/c/:courseId/:chapterId` — hướng A. Mục lục là **ngăn kéo**; ghi chú là **chú
lề neo đúng đoạn**, chỉ hiện nơi có ghi chú. Lối ra về chế độ thư viện ở góc
trái trên: **một** lối.

## Ba thứ rời khỏi thanh bên

- `/import` → **nút "Nhập gói"** trong `/courses`. Route cũ **chuyển hướng** sang `/courses`.
- `/catalog` → **tab "Kho cộng đồng"** trong `/courses`. Route cũ **chuyển hướng** sang `/courses?tab=registry`.
- `/settings` → giữ route, nhưng vào từ **menu tài khoản**, và Trợ lý AI là **một mục bên trong** nó.
- `/library` → **chuyển hướng** sang `/courses`.

**Chuyển hướng là bắt buộc, không phải tuỳ chọn.** Bốn tệp e2e và mọi liên kết
đã lưu đều dùng đường cũ; xoá thẳng là làm hỏng thứ đang chạy.

## Ngôn ngữ thị giác (đã chốt ở hướng A)

- Giữ token giấy ấm sẵn có: `--page #f7f6f3`, `--surface-1 #fcfcfb`, `--panel #f2f1ec`.
- Chữ thân: serif sẵn có. Chữ giao diện: **KHÔNG dùng `system-ui`** — đó là một
  phần lớn của cảm giác "mặc định".
- **Không hộp bảy màu.** Phân cấp bằng cỡ chữ, nét kẻ, khoảng trắng.
- Nhãn hạng `interactive` là **một dòng chữ kèm biểu tượng cảnh báo**
  ("chạy mã trong trình duyệt"), không phải viên màu đỏ. Nó phải **nói ra nghĩa**,
  không bắt người ta học nghĩa của một màu.
- Con số kể chuyện bằng **câu**, không phải ô đếm rời.

## Ràng buộc không được phá

1. **Nhãn hạng vẫn là quyết định an ninh.** Đổi cách trình bày, KHÔNG đổi việc nó
   luôn hiện trước khi người dùng kéo gói về.
2. **Course riêng tư không có ô chấm sao.** Hàng rào ở `ratingFence.test.tsx`.
3. **Mọi chuỗi mới vào `packages/i18n`**, cả `vi` lẫn `en`. Sổ `NOT_YET_EXTRACTED`
   đang **rỗng** — đừng thêm mục nào.
4. **`t()` trả `string`; `tNode()`** cho câu có thẻ giữa chừng.
5. Trang chủ khi **chưa có khoá học nào** vẫn phải thành hành động, không phải
   ngõ cụt — đó là màn hình đầu tiên của mọi người dùng mới.
