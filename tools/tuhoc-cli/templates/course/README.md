# {{title}}

Một course cho nền tảng tuhoc. Mã course: `{{id}}`.

## Trong thư mục này có gì

| Tệp | Việc của nó |
|---|---|
| `manifest.json` | Khai báo course: tên, giấy phép, tác giả, và danh sách chương theo đúng thứ tự đọc. |
| `chapters/` | Mỗi chương là một mảnh HTML. Không phải trang hoàn chỉnh — trình đọc lo phần khung. |
| `README.md` | Tệp này. Nó cũng nằm trong gói, nên đừng dán mã HTML vào đây (xem phần cuối). |

## Quy trình

```
tuhoc pack .
```

Lệnh này kiểm gói theo bộ luật dùng chung rồi ghi ra một tệp `.zip`. Nếu có gì
sai, nó in ra **mọi** vấn đề cùng lúc — mỗi vấn đề gồm mã lỗi, đúng tệp hoặc
đúng trường bị sai, và một dòng nói phải làm gì — rồi thoát với mã 1. Sửa hết
rồi chạy lại.

Chạy được `tuhoc pack` không có nghĩa là course hay. Nó chỉ có nghĩa là course
hợp lệ.

## Hai hạng

Gói này đang ở hạng `content`, hạng mặc định và cũng là hạng an toàn:

- **`content`** — chỉ HTML, CSS, hình ảnh. Không JavaScript dưới bất kỳ dạng
  nào: không thẻ script, không thuộc tính `on...`, không URL `javascript:`,
  không khung nhúng, không biểu mẫu, không tệp `.js`. Đổi lại, gói kiểm được
  hoàn toàn bằng máy nên gần như merge tự động.
- **`interactive`** — được mang JavaScript. Việc kiểm định **không** cố gắng
  làm sạch mã đó, nên bảo đảm ở hạng này đến từ người duyệt tay tại registry,
  không đến từ máy. Chọn hạng này khi khái niệm chỉ hiểu được nếu nhìn thấy nó
  chuyển động — không phải để trang trí.

Sửa `"tier"` trong `manifest.json` nếu cần đổi.

## Hai trường phải trung thực

`lang` và `generatedBy` là thứ người tải course về dựa vào để quyết định có đọc
hay không. `generatedBy` nhận đúng ba giá trị: `ai`, `human`, `mixed`.

## Một cái bẫy đáng nhớ

Bộ luật đọc **mọi** tệp trong gói, không riêng tệp `.html` — kể cả tệp README
này. Vì vậy đừng viết ví dụ mã HTML trực tiếp vào đây: một thẻ script nằm trong
khối mã của README vẫn bị tính là thẻ script trong gói, và gói sẽ trượt.

## Tài liệu đầy đủ

Mọi trường của manifest, mọi mã lỗi kèm cách sửa, trần dung lượng 20 MB, và quy
trình gửi PR vào registry: `docs/course-format.md`.
