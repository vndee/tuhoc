# {{title}}

Một course cho nền tảng tuhoc. Mã course: `{{id}}`.

## Trong thư mục này có gì

| Tệp | Việc của nó |
|---|---|
| `manifest.json` | Khai báo course: tên, giấy phép, tác giả, và danh sách chương theo đúng thứ tự đọc. |
| `chapters/` | Mỗi chương là một mảnh HTML. Không phải trang hoàn chỉnh — trình đọc lo phần khung. |
| `widgets/` | Phần tương tác, nếu có — mỗi widget là đúng một tệp index.html, tự chứa hoàn toàn. |
| `README.md` | Tệp này. Nó cũng nằm trong gói, nên đừng dán mã HTML vào đây (xem phần cuối). |

## Quy trình

Chạy từ thư mục gốc của repo — đúng dòng lệnh mà `init` vừa in ra:

```
{{cmd}}
```

Lệnh này kiểm gói theo bộ luật dùng chung rồi ghi ra một tệp `.zip`. Nếu có gì
sai, nó in ra **mọi** vấn đề cùng lúc — mỗi vấn đề gồm mã lỗi, đúng tệp hoặc
đúng trường bị sai, và một dòng nói phải làm gì — rồi thoát với mã 1. Sửa hết
rồi chạy lại.

Ghi zip ra **ngoài** thư mục này (mặc định lệnh trên đã làm vậy: zip nằm ở thư
mục bạn đang đứng, không nằm trong gói). Một tệp `.zip` để quên bên trong thư
mục course sẽ bị đóng vào gói lần sau — lệnh pack có nói ra khi chuyện đó xảy
ra, nhưng dọn trước thì hơn.

Pack chạy được không có nghĩa là course hay. Nó chỉ có nghĩa là course hợp lệ.

## Nội dung tĩnh, và một cửa riêng cho mã chạy được

Mọi chương trong `chapters/` là nội dung tĩnh: HTML và CSS, không JavaScript
dưới bất kỳ dạng nào — không thẻ script, không thuộc tính `on...`, không URL
`javascript:`, không khung nhúng, không biểu mẫu, không tệp `.js` rời. Bộ luật
kiểm điều đó bằng máy, trên mọi tệp trong gói, nên gần như merge tự động.

Course cần minh hoạ chạy được thì viết một **widget**: đúng một tệp
`widgets/ten-widget/index.html` (thay `ten-widget` bằng tên bạn chọn — chỉ
chữ thường a-z, số 0-9 và dấu gạch ngang), tự chứa hoàn toàn — CSS và JS viết
thẳng trong tệp đó, không tải gì từ mạng — rồi đặt một thẻ mang thuộc tính
`data-widget` bằng đúng tên ấy ở chương cần nó. Trình đọc chạy widget trong
một khung cách ly riêng (iframe sandbox). Khung mẫu này có sẵn một widget như
vậy ở `widgets/vi-du/index.html`, đã được Chương 1 tham chiếu.

Một widget không được chương nào tham chiếu sẽ bị từ chối, và một tham chiếu
trỏ tới widget không có thật cũng vậy. Widget vẫn phải qua người duyệt tay ở
registry trước khi merge, như hạng `interactive` cũ.

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
