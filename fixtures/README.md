# Fixtures

Dữ liệu dùng chung cho các cổng nghiệm thu. **Không** phải nội dung nền tảng
phát hành, và **không** phải course đóng gói sẵn — spec §9.5 nói rõ repo không
mang sẵn course nào cho người dùng.

## `courses/bat-bien-vong-lap/`

Một course thật, nhỏ: 3 chương, hạng `content`, `lang: "vi"`,
`generatedBy: "ai"` (đúng như nó là — do skill `course-authoring` sinh ra).

Nó ra đời như **cổng nghiệm thu của Task 4**: dùng chính
`.claude/skills/course-authoring/SKILL.md` để soạn một course, rồi đóng gói. Một
tài liệu hướng dẫn không chạy được thì không ai phát hiện nó sai; đây là cách
phát hiện.

Nó ở lại vì Task 8 (import từ tệp/URL/git) và Task 12 (cổng e2e) cần **một gói
hợp lệ, đủ nhỏ để chạy nhanh, và đủ thật để bắt lỗi** — nó có công thức KaTeX,
SVG nội tuyến, bảng, khối `<details>` gập được, và tiếng Việt có dấu, tức đủ
mặt những thứ trình đọc phải xử lý đúng.

| | |
|---|---|
| Số mục trong gói | 4 (`manifest.json` + 3 chương) |
| Kích thước đã giải nén | 61.790 byte — 0,29% trần 20 MiB |
| Kích thước zip | 21.867 byte |
| Hạng | `content` (không JavaScript, kiểm được hoàn toàn bằng máy) |

### Đóng gói lại

`bat-bien-vong-lap.zip` được commit **có chủ ý**: Task 8 và Task 12 cần một tệp
thật để thả vào màn hình import, và sinh nó trong lúc chạy test sẽ buộc cổng e2e
phải chạy thêm CLI. Sửa nguồn thì đóng gói lại bằng đúng lệnh đã tạo ra nó:

```
bun tools/tuhoc-cli/src/index.ts pack fixtures/courses/bat-bien-vong-lap \
  -o fixtures/courses/bat-bien-vong-lap.zip
```

Lệnh phải thoát `0`. Nếu không, sửa **course**, đừng sửa luật.

### Làm gói xấu và gói v1.1 cho Task 12

Task 12 cần thêm hai biến thể; cả hai dựng từ gói này bằng một bước, và **đừng
commit chúng** — dựng trong lúc chạy test là đúng, vì thứ đang được kiểm là phản
ứng của hệ thống, không phải tệp:

- **Gói xấu (kịch bản 2).** Chép thư mục, thêm `<script>alert(1)</script>` vào
  một chương, rồi đóng gói bằng `packZip` trực tiếp — `tuhoc pack` sẽ **từ chối**
  (đó là điểm của nó), nên gói xấu phải được dựng vòng qua CLI.
- **Bản v1.1 (kịch bản 4).** Chép thư mục, đổi `version` thành `1.1.0`, sửa vài
  câu trong `chapters/c1.html` để một số ghi chú mất neo, rồi `tuhoc pack` bình
  thường.
