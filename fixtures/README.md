# Fixtures

Dữ liệu dùng chung cho các cổng nghiệm thu. **Không** phải nội dung nền tảng
phát hành, và **không** phải course đóng gói sẵn cho người đọc — spec §9.5 nói
rõ repo không mang sẵn course nào cho người dùng. Chúng là **ngữ liệu test**, và
chúng nằm trong repo vì bộ test cần một gói thật để đo trên đó.

Hai gói, hai vai khác nhau:

| | `bat-bien-vong-lap` | `so-dau-phay-dong` |
|---|---|---|
| Hạng | `content` | `interactive` |
| Chương | 3 | 8 (4 phần, có phụ lục `num: ""`) |
| Vai | gói hợp lệ nhỏ, nhanh, cho màn hình Import | **ngữ liệu chính** của 10 tệp test |
| Có JavaScript | không | `viz.js`, 9 mô phỏng canvas |

`make courses` bung **cả hai** vào `courses/` trước mỗi cổng test — xem
`scripts/course_workspace.py`.

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

## `courses/so-dau-phay-dong/`

Course **8 chương** về số dấu phẩy động: hạng `interactive`, `lang: "vi"`,
`license: "CC-BY-4.0"`, `generatedBy: "ai"` (đúng như nó là — do skill
`course-authoring` sinh ra ở Task 13).

Nó ra đời để **thay giáo trình riêng tư làm ngữ liệu test**. Task 11 đưa
`***REMOVED***` ra ngoài cây git, và hệ quả là mười tệp test chỉ chạy được
trên máy có gói đó. Gói này thế chỗ, và điều kiện nghiệm thu của nó không phải
"hợp lệ" mà là **mang đúng những hình dạng đã bắt được lỗi thật**, ở tỉ lệ đo
được từ giáo trình cũ. Bảng đối chiếu đầy đủ — kèm những hình dạng **cố ý
không** tái tạo và năng lực bắt lỗi bị mất — nằm ở
`.superpowers/sdd/2026-08-21-s1-course-packages/task-13-sample-course-report.md`.

| | |
|---|---|
| Số mục trong gói | 10 (`manifest.json` + 8 chương + `viz.js`) |
| Kích thước đã giải nén | 190.693 byte — 0,91% trần 20 MiB |
| Kích thước zip | 68.479 byte |
| Hạng | `interactive` (có JavaScript; máy **không** kiểm được `viz.js`) |
| Công thức KaTeX trong dòng | 1.457 (182/chương) |
| Khối `<details>` gập được | 30 |
| Tham chiếu chéo "Chương N.M" | 64 |
| Mô phỏng `defineViz` | 9 — 8 vẽ canvas, 1 là widget DOM thuần |

Bốn hình dạng dưới đây có mặt **có chủ ý**, vì không có chúng thì một nhánh của
cổng e2e trở thành mã chết mà vẫn đọc như đã được phủ:

- `cover-hero` **không chương nào tham chiếu** → `viz.spec.ts`'s
  `mountThroughRuntime` mới có việc để làm;
- `nextafter-walk` **không dựng canvas nào** → nhánh "đếm nút bấm" của
  `expectVizRendered`;
- `bit-lab` và `sum-drift` dựng **hai `Plot` trong một host** → vòng lặp "mọi
  canvas, không chỉ cái đầu" của `expectVizCanvasDrawn`;
- phụ lục `appx` **không có mô phỏng nào** và `num: ""` → nhánh chương-không-viz
  và nhánh chương-không-số của trình đọc.

### Đóng gói lại

Sửa nguồn thì đóng gói lại bằng đúng lệnh đã tạo ra nó:

```
bun tools/tuhoc-cli/src/index.ts pack fixtures/courses/so-dau-phay-dong \
  -o fixtures/courses/so-dau-phay-dong.zip
```

Lệnh phải thoát `0`. Nếu không, sửa **course**, đừng sửa luật.

Rồi cập nhật **hai** hằng số trong `packages/course-format/src/zip.test.ts` theo
số đo được: `REAL_BYTES` (tổng byte) và `REAL_FNV1A` (vân tay nội dung). Cái thứ
hai có mặt vì một mutant sống sót: đổi một byte mà giữ nguyên độ dài thì tổng
byte không đổi, và cả khối test xanh. Đừng nới chúng thành bất đẳng thức.
