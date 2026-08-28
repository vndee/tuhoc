/**
 * Chữ tắt của một tên khoá — "Số dấu phẩy động" → "SDPĐ".
 *
 * Dùng làm BÌA khoá ở thẻ "Đang đọc" (Bảng điều khiển) và ở từng hàng của
 * `/courses`. Một gói khoá học KHÔNG mang ảnh bìa (`packages/course-format`),
 * nên bìa phải tự dựng từ thứ gói có.
 *
 * Bản dựng đã duyệt vẽ "IEEE / 754" trên bìa, và chữ ấy KHÔNG suy ra được —
 * tôi chọn tay cho mockup vì tôi biết khoá đó nói về IEEE 754. Bản đầu của hàm
 * này cố đoán bằng "từ dài nhất trong tên" và cho ra "PHẨY" cho khoá "Số dấu
 * phẩy động": một chữ vô nghĩa in to giữa bìa, tệ hơn hẳn không có bìa.
 *
 * Nên bìa chỉ mang thứ luôn đúng: chữ tắt. Nó không giả vờ biết khoá nói về
 * gì, và nó phân biệt được các khoá với nhau — đúng việc mà một mỏ neo thị
 * giác cần làm.
 *
 * Ở CHUNG một tệp vì hai chỗ vẽ phải cho ra CÙNG một chữ tắt: hai bản chép sẽ
 * trôi, và một khoá mang hai bìa khác nhau ở hai màn là thứ mắt bắt được ngay
 * mà không ai giải thích được.
 */
export function monogram(title: string): string {
  const words = title.split(/\s+/).filter(Boolean);
  return words
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 4);
}
