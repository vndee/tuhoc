# Fixtures

Dữ liệu dùng chung cho các cổng nghiệm thu. **Không** phải nội dung nền tảng
phát hành, và **không** phải course đóng gói sẵn cho người đọc — spec §9.5 nói
rõ repo không mang sẵn course nào cho người dùng. Chúng là **ngữ liệu test**, và
chúng nằm trong repo vì bộ test cần một gói thật để đo trên đó.

Hai gói, hai vai khác nhau:

| | `bat-bien-vong-lap` | `so-dau-phay-dong` |
|---|---|---|
| Chương | 3 | 8 (4 phần, có phụ lục `num: ""`) |
| Vai | gói hợp lệ nhỏ, nhanh, cho cổng nghiệm thu | **ngữ liệu chính** của 10 tệp test |
| Có JavaScript | không | `viz.js`, 9 mô phỏng canvas |

**Không còn "hạng" nào để ghi ở đây.** Format v2 xoá hẳn khái niệm `tier`
(`content`/`interactive` — xem `docs/course-format.md` §4); cả hai
`manifest.json` dưới đây đã không còn trường đó. `so-dau-phay-dong` vẫn giữ
nguyên `viz.js` ở gốc gói — hình dạng v1, cố ý — vì đó chính là ngữ liệu mười
tệp test bên dưới cần đo trên đó (viz engine, canvas, …); nó **không** còn là
một gói publish-được dưới bộ luật v2 hiện hành (`.js` ngoài `widgets/<tên>/`
bị `JS_FILE_IN_PACKAGE` từ chối). Gói sạch bộ luật v2 dùng để publish/seed
thật nằm ở `fixtures/format-v2/valid-course`, không phải ở đây.

`make courses` bung **cả hai** vào `courses/` trước mỗi cổng test — xem
`scripts/course_workspace.py`.

## `courses/bat-bien-vong-lap/`

Một course thật, nhỏ: 3 chương, `lang: "vi"`, `generatedBy: "ai"` (đúng như nó
là — do skill `course-authoring` sinh ra).

Nó ra đời như **cổng nghiệm thu của Task 4**: dùng chính
`.claude/skills/course-authoring/SKILL.md` để soạn một course, rồi đóng gói. Một
tài liệu hướng dẫn không chạy được thì không ai phát hiện nó sai; đây là cách
phát hiện.

**Không còn đúng, sửa tại đây:** đoạn này từng nói nó ở lại vì "Task 8 (import
từ tệp/URL/git)" cần một tệp thật để thả vào màn hình Import — màn hình đó
(`pages/ImportCourse.tsx`, `course/import.ts`) đã bị xoá cùng toàn bộ mô hình
"kéo một gói vào máy mình" (commit `f541a9c`, server-side pivot): đọc chương
giờ luôn tới từ `/courses/:slug` của máy chủ. Nó ở lại hôm nay vì
`packages/course-format`/`tools/tuhoc-cli` (`pack.test.ts`) và
`tools/registry` (`validate-pr.test.ts`) vẫn cần **một gói hợp lệ, đủ nhỏ để
chạy nhanh, và đủ thật để bắt lỗi** — nó có công thức KaTeX, SVG nội tuyến,
bảng, khối `<details>` gập được, và tiếng Việt có dấu, tức đủ mặt những thứ
trình đọc phải xử lý đúng.

| | |
|---|---|
| Số mục trong gói | 4 (`manifest.json` + 3 chương) |
| Kích thước đã giải nén | 61.790 byte — 0,29% trần 20 MiB |
| Kích thước zip | 21.856 byte |
| JavaScript | không — kiểm được hoàn toàn bằng máy (không có "hạng" nào để gán từ format v2) |

### Đóng gói lại

`bat-bien-vong-lap.zip` được commit **có chủ ý**: `pack.test.ts`/`validate-pr.test.ts`
(xem đoạn trên) cần một tệp thật, và sinh nó trong lúc chạy test sẽ buộc mỗi cổng
phải chạy thêm CLI. Sửa nguồn thì đóng gói lại bằng đúng lệnh đã tạo ra nó:

```
bun tools/tuhoc-cli/src/index.ts pack fixtures/courses/bat-bien-vong-lap \
  -o fixtures/courses/bat-bien-vong-lap.zip
```

Lệnh phải thoát `0`. Nếu không, sửa **course**, đừng sửa luật.

### Hai kịch bản từng dựng ở đây — đã đi cùng tính năng chúng kiểm

**Không còn gì kiểm hai kịch bản này, và đó là kết luận chứ không phải một việc
chưa làm.** Mục này giữ lại vì hai lý do: để không ai đi tìm một tệp không tồn
tại, và để người sửa `chapters/c1.html` biết ràng buộc từng có ở đó nay đã hết
hiệu lực — thay vì gặp một ràng buộc không ghi ở đâu cả và không dám động vào.

Task 12 từng dựng hai biến thể của gói này **trong lúc chạy** `apps/web/e2e/s1.spec.ts`
chứ không commit vào kho:

- **Gói xấu (kịch bản 2)** — chèn `<script>alert(1)</script>` vào một chương rồi
  đóng bằng `fflate` để đi vòng qua `tuhoc pack`, kiểm màn hình Nhập gói **từ
  chối** nó.
- **Bản v1.1 (kịch bản 4)** — sửa đúng những chuỗi vừa được bôi chọn trong
  `chapters/c1.html`, kiểm hộp thoại cập nhật báo trước **ghi chú nào sẽ mất neo**.

Cả hai đi qua hai màn hình mà cú chuyển trục sang máy chủ đã gỡ: màn hình Nhập gói
(`pages/ImportCourse.tsx`, `course/import.ts`) và hộp thoại cập nhật theo phiên
bản ghim (`course/UpdateDialog.tsx`, `course/version.ts`), gỡ ở commit `f541a9c`.
Người đọc không còn kéo gói về máy mình nữa — course do `apps/api` phục vụ từ
Postgres.

`s1.spec.ts` bị xoá ngay sau đó (`0d20668`). Kịch bản 2 và 4 **bỏ hẳn**, không
chuyển đi đâu; chỉ §5 của tệp ấy (mục lục: ngăn kéo màn hẹp, cột cố định màn rộng)
còn ý nghĩa vì nó kiểm `/c/:courseId` — một màn hình còn nguyên — nên nó **chuyển
sang `apps/web/e2e/p1.spec.ts`**. Đó là toàn bộ phần sống sót.

**Chương `chapters/c1.html` không có gì để dọn**, và điều này đáng nói rõ vì dễ
hiểu ngược. Nó không được *định hình cho* kịch bản 4 — nó là văn xuôi course thật
(~20 KB, chương "Vì sao chạy thử không kết luận được"). Kịch bản 4 *chọn từ* nó:
lúc chạy, nó đo ba tính chất trên tệp (nút văn bản đầu tiên dài hơn 40 ký tự,
không có `$…$` trong 40 ký tự đầu, không nằm trong `<details>` gập lại) rồi lấy ra
sáu đoạn bôi chọn được. Phép chọn ấy nằm trong test, không nằm trong chương.

Nên khi kịch bản 4 mất đi, chương không thừa ra một dòng nào — thứ biến mất là
phép chọn. Ràng buộc kia cũng **không còn cổng nào canh**: không test nào đọc hình
dạng ấy nữa, và bài kiểm neo bôi chọn còn sống
(`apps/web/src/annotations/anchor.test.ts`) dùng `so-dau-phay-dong` chứ không dùng
course này.

Nên **sửa chương này không cần chạy lại `make test-e2e`**. Thứ vẫn phải giữ là gói
còn hợp lệ: `bun tools/tuhoc-cli/src/index.ts pack …` phải thoát `0` (xem "Đóng gói
lại" ở trên), vì `tools/registry/src/validate-pr.test.ts` kiểm gói này qua bộ luật,
và `apps/web/fixtures/nested-archive.py` chép `manifest.json` cùng ba chương của nó
làm ruột cho một archive tổng hợp.

## `courses/so-dau-phay-dong/`

Course **8 chương** về số dấu phẩy động: `lang: "vi"`, `license: "CC-BY-4.0"`,
`generatedBy: "ai"` (đúng như nó là — do skill `course-authoring` sinh ra ở
Task 13) — không "hạng" nào để ghi, xem ghi chú ở đầu tệp này.

Nó ra đời để **thay giáo trình riêng tư làm ngữ liệu test**. Task 11 đưa
giáo trình riêng tư ra ngoài cây git, và hệ quả là mười tệp test chỉ chạy được
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
| JavaScript | `viz.js`, ở gốc gói — hình dạng v1, cố ý giữ nguyên; máy **không** kiểm được nội dung của nó, và bộ luật v2 hiện hành từ chối `.js` ngoài `widgets/<tên>/` (`JS_FILE_IN_PACKAGE`) nên gói này không còn publish-được, chỉ còn dùng làm ngữ liệu test |
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
