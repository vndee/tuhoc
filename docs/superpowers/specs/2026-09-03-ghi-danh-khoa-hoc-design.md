# Ghi danh khoá học: tách "có trên hệ thống" khỏi "của tôi"

**Quyết định của chủ sản phẩm, 03/09/2026.** Nguyên văn: *"cần phân biệt khoá
học có trên hệ thống (discoverable) và khoá học của tôi (đang học). Hiện tại
hình như khoá nào được publish lên thì cũng vào mục đang học hoặc học tiếp của
tất cả user."* Kèm một quan sát riêng về trang Học tiếp: *"trang progress này
chưa ổn."*

Tài liệu này là bản thiết kế ĐÃ DUYỆT cho vòng thay đổi ấy.

---

## Các quyết định đã chốt

| Câu hỏi | Quyết định |
|---|---|
| Một khoá thành "của tôi" khi nào | **Tường minh.** Có nút "Bắt đầu học"; bảng `enrollments` thật. |
| Đọc mà không bấm nút | **Không tự ghi danh.** Trang đọc hiện một lối "Thêm vào khoá của tôi". |
| Bỏ ghi danh | **Chỉ rời danh sách.** `progress` và `annotations` không bị đụng tới. |
| Hình dạng trang Học tiếp | **Một hành động + danh sách khoá của tôi.** Mục lục đầy đủ rời sang `/c/:slug`. |
| Dữ liệu đang có | **Không backfill.** Ai đang đọc dở thì tự ghi danh lại. |

---

## 1. Nguyên nhân, đo chứ không đoán

`apps/web/src/pages/Dashboard.tsx` chọn khoá để hiện ở Học tiếp bằng
`pickFocusCourse(fallbackCourseIds(catalog, stats.courses), lastStudied)`.
`fallbackCourseIds` trả về **hợp của danh mục công khai và `stats.courses[]`,
sắp xếp theo bảng chữ cái**, và `pickFocusCourse` lấy phần tử đầu khi chưa có
tiến độ nào. Hệ quả: mọi tài khoản — kể cả vừa đăng ký xong — đều thấy khoá
đứng đầu bảng chữ cái của danh mục nằm ở Học tiếp, kèm "0/44 chương đã đọc" và
một hành động không có thật.

Đây không phải lỗi cẩu thả; nó là một giả định đã hết hạn, và mã ghi rõ giả
định ấy ở hai chỗ:

- `Dashboard.tsx`: *"Trang này không hỏi 'người này SỞ HỮU khoá nào' — câu ấy
  không còn nghĩa"*.
- `Progress.tsx`: *"sở hữu một khoá không còn nghĩa gì — danh mục là chung, ai
  cũng thấy y hệt nhau"*.

Cả hai câu đúng ở thời điểm chúng được viết (Task 13, khi luồng import `.zip`
của người đọc chết và server thành nguồn duy nhất): lúc ấy hệ thống có một
khoá và một người đọc, nên "khoá của tôi" và "khoá có trên hệ thống" là cùng
một tập hợp. Chúng sai kể từ khi có nhiều khoá và nhiều người đọc. Bản thiết
kế này khôi phục sự phân biệt ấy bằng một khái niệm mới, chứ không phải bằng
cách hồi sinh khái niệm "sở hữu" đã chết cùng luồng import.

Trong toàn bộ mã hiện tại **không có** bảng, cột, route hay kiểu dữ liệu nào
mang nghĩa ghi danh — đã kiểm bằng tìm kiếm toàn kho.

## 2. Dữ liệu

Migration `0011_enrollments`:

```sql
CREATE TABLE enrollments (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id));
CREATE INDEX idx_enrollments_user ON enrollments (user_id, created_at DESC);
```

**`course_id` là `text`, KHÔNG phải khoá ngoại tới `published_courses`.** Cố ý,
và khớp `progress.course_id` vốn cũng vậy (migration `0001`): gỡ xuất bản một
khoá không được phép xoá tiến độ của người đọc, nên nó cũng không được xoá ghi
danh. Một khoá bị gỡ rồi xuất bản lại phải tìm thấy người đọc cũ y nguyên. Cái
giá đã biết của lựa chọn này: không có ràng buộc CSDL nào ngăn một hàng ghi
danh trỏ tới `course_id` chưa từng tồn tại — giao diện xử lý bằng cách bỏ qua
khoá không tra được manifest, giống hệt đường `progress` đang làm.

`ON DELETE CASCADE` theo `users`: xoá tài khoản là xoá ghi danh, cùng luật với
`progress` và `annotations`.

**Không backfill** (quyết định của chủ sản phẩm). Hệ quả phải nói trước:
ngay sau khi triển khai, người đang đọc dở thấy Học tiếp trống cho tới khi họ
bấm "Bắt đầu học". Dữ liệu không mất — `progress` và `annotations` còn nguyên,
trang Tiến độ vẫn hiện đủ — nhưng nó bị **giấu**, và một người đọc không đọc
migration sẽ tưởng là mất. Chấp nhận vì hiện chỉ có một nhóm nhỏ người dùng và
gần như chưa ai có tiến độ. **Nếu số người dùng tăng trước khi vòng này lên,
quyết định này phải được xét lại** — câu `INSERT ... SELECT DISTINCT user_id,
course_id FROM progress` là ba dòng, và giá của việc bỏ nó tăng theo số người.

`down` xoá bảng.

## 3. API

Ba route trong `internal/userdata`, bám đúng hình dạng `progress` và
`annotations` đã có ở đó, cả ba sau `auth.Require(deps.Pool)`:

| Route | Thân | Trả về |
|---|---|---|
| `GET /enrollments` | không | `[{"courseId": "...", "createdAt": "..."}]`, mới nhất trước |
| `POST /enrollments` | `{"courseId": "..."}` | 201; **idempotent** (`ON CONFLICT DO NOTHING`), bấm lần hai vẫn 201 |
| `DELETE /enrollments/:courseId` | không | 204; **idempotent**, xoá thứ chưa có vẫn 204 |

`bodyLimit(userdata.MaxWriteBytes)` **chỉ** bọc `POST`. `GET` và `DELETE` không
mang thân, nên một giới hạn đặt lên chúng là một dòng không bao giờ chạy được —
đúng lập luận đã ghi sẵn cạnh `GET /progress` trong `server.go`.

Hai route ghi đều idempotent vì cùng một lý do: chúng là hành động của một
người bấm nút, và một cú bấm đúp không được phép trở thành lỗi hiện lên mặt
người ta.

`GET /enrollments` trả mảng rỗng `[]` chứ không phải `null` khi chưa ghi danh
gì — cùng ràng buộc mà `catalog.List` đã ghi lại lý do: một client gọi `.map()`
trên `null` sẽ ném lỗi.

## 4. Web — trang Học tiếp (`pages/Dashboard.tsx`)

`fallbackCourseIds()` **bị xoá**, không phải sửa. Nó chính là chỗ danh mục công
khai rò vào chỗ riêng tư, và sửa nó thành "lọc bớt" sẽ để lại một hàm mà tên
của nó vẫn hứa một điều đã thôi đúng.

Nguồn mới là `GET /enrollments`. `pickFocusCourse` chọn trong tập đã ghi danh,
ưu tiên `lastStudied` (`GET /progress`) — nghĩa là "khoá học gần nhất", không
phải "khoá ghi danh gần nhất".

Hình dạng trang, giữ đúng ràng buộc "MỘT hành động" của đặc tả IA
(`2026-08-23-ia-redesign.md`):

1. **Trên cùng, một hành động.** Chương đang dở của khoá học gần nhất, một
   liên kết lớn — y như hiện nay.
2. **Dưới nó, khoá của tôi.** Mỗi khoá một dòng: tên khoá, chương đang dở,
   `n/m chương`. Một dòng, không thẻ, không bóng — cùng ngôn ngữ với phần còn
   lại của trang.
3. **Mục lục đầy đủ rời khỏi trang này** về `/c/:slug`, nơi nó vốn thuộc về.
   Đổ 44 dòng mục lục dưới một hành động là để cái dài hơn thắng cái quan
   trọng hơn — cùng lỗi mà đặc tả IA đã đuổi bảng số liệu ra khỏi trang này.
4. **Chưa ghi danh gì** ⇒ `<EmptyHome>`, đã tồn tại sẵn, mời sang danh mục.

Ba nguồn (`/enrollments`, `/progress`, `/stats`) phải trả lời xong mới được vẽ
trạng thái rỗng — hàng rào `settled` hiện có giữ nguyên, thêm `/enrollments`
vào điều kiện. Nháy trạng thái rỗng vào mặt người đang đọc dở là lỗi đã có bài
test canh riêng.

## 5. Web — trang khoá (`pages/CourseHome.tsx`)

Chưa ghi danh ⇒ hành động chính là **"Bắt đầu học"** (`POST /enrollments`, rồi
đi tới chương đầu). Đã ghi danh ⇒ giữ nguyên liên kết đọc tiếp hiện có, và
thêm một lối **"Bỏ khỏi khoá của tôi"** đặt nhẹ, không cạnh tranh với hành động
chính.

"Bỏ khỏi khoá của tôi" **không** hỏi xác nhận: nó không xoá gì ngoài một hàng
trong `enrollments`, và ghi danh lại khôi phục nguyên trạng. Một hộp xác nhận ở
đây sẽ dạy người dùng bấm qua hộp xác nhận.

## 6. Web — trang đọc

Đang đọc một khoá chưa ghi danh ⇒ một dòng **"Thêm vào khoá của tôi"**, đặt
đúng chỗ dòng *"Đăng nhập để lưu tiến độ, ghi chú và hỏi AI"* đang nằm.

**Ràng buộc cứng: dòng này nằm trong vỏ app, KHÔNG được sửa
`packages/course-kit/`.** Thân chương và `reader.css` là thứ bất khả xâm phạm —
đây là cùng ràng buộc mà đợt đổi thế giới thiết kế đã giữ trọn vẹn, và dòng
"Đăng nhập để lưu tiến độ" hiện có chứng minh chỗ đặt ấy đủ dùng.

## 7. Hệ quả đã biết, không phải lỗi

Vì đọc không tự ghi danh (bảng quyết định, dòng *"Đọc mà không bấm nút"*), có
thể tồn tại tiến độ của một khoá không nằm trong `enrollments`. Khi ấy **trang
Tiến độ hiện khoá đó còn Học tiếp thì không** — hai trang trả lời hai câu khác
nhau, và đó là câu trả lời đúng cho cả hai:

- Tiến độ hỏi *"tôi đã học chương nào của khoá nào"* → nguồn là `progress`.
- Học tiếp hỏi *"khoá nào là của tôi"* → nguồn là `enrollments`.

Ghi ở đây để lần sau ai đó thấy sự lệch này thì biết nó là thiết kế, không phải
lỗi đồng bộ. Dòng "Thêm vào khoá của tôi" ở §6 là lối thoát cho người đọc gặp
phải nó.

## 8. Test

**Go** — soi gương `userdata/progress_test.go`:

- 401 khi không có phiên, cho cả ba route.
- `POST` cùng `courseId` hai lần: cả hai 201, bảng có đúng một hàng.
- `DELETE` một `courseId` chưa từng ghi danh: 204, không lỗi.
- `GET` trả `[]` chứ không `null` khi rỗng.
- **`DELETE /enrollments/:courseId` xong thì mọi hàng `progress` và
  `annotations` của cặp (người dùng, khoá) ấy CÒN NGUYÊN.** Đây là bài quan
  trọng nhất: nó là chỗ duy nhất quyết định "bỏ ghi danh chỉ rời danh sách"
  được viết thành thứ chạy được, chứ không phải một câu trong tài liệu.
- Ghi danh của người dùng A không hiện trong `GET /enrollments` của người dùng B.

**Web**:

- **Bài canh đúng lỗi đã báo**: danh mục trả về nhiều khoá, người dùng không có
  ghi danh nào ⇒ Học tiếp hiện `<EmptyHome>`, và **không** hiện tên khoá nào.
  Không có bài này thì `fallbackCourseIds` có thể lặng lẽ quay lại dưới một
  cái tên khác.
- Đã ghi danh nhiều khoá ⇒ hành động trên cùng là khoá học gần nhất, và mọi
  khoá đã ghi danh đều có một dòng bên dưới.
- Trang đọc: dòng "Thêm vào khoá của tôi" chỉ hiện khi chưa ghi danh.
- `git diff packages/course-kit/` phải rỗng sau vòng này.

## 9. Ngoài phạm vi vòng này

- Ghi danh trực tiếp từ thẻ khoá ở `/courses` (chỉ từ `/c/:slug`).
- Bất kỳ thứ gì gắn vào ghi danh về sau: lộ trình học, nhắc học, ngày bắt đầu,
  mục tiêu. Bảng đã có `created_at` nên thêm được, nhưng vòng này không thêm.
- Khoá riêng tư / khoá cần mời. Ghi danh ở đây **không phải** cơ chế phân
  quyền: `GET /courses/:slug/chapters/:chapterId` vẫn công khai, không sau
  `auth.Require`. Ai có địa chỉ vẫn đọc được dù chưa ghi danh, và bản thiết kế
  này không đổi điều đó.
