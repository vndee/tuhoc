# Tìm kiếm: nối dây một ô nhập đã hứa suốt nhiều vòng

**Báo cáo của chủ sản phẩm, 04/09/2026.** Nguyên văn: *"nút search hiện tại
không work."* Chọn độ sâu: **tìm cả nội dung chương**, không chỉ tiêu đề.

Tài liệu này là bản thiết kế cho vòng thay đổi ấy.

---

## Các quyết định đã chốt

| Câu hỏi | Quyết định |
|---|---|
| Tìm tới đâu | **Cả nội dung chương.** Tiêu đề khoá, mô tả, tên chương, và nguyên văn bài. |
| Tìm ở đâu | **Một endpoint server.** `GET /search?q=` — không quét phía client. |
| Ai gọi được | **Công khai**, đúng như `/courses` và `/courses/:slug/chapters/:id`. |
| Kết quả hiện ở đâu | **Bảng thả xuống dưới ô** + một trang `/search?q=` cho "xem tất cả". |
| Ô ở thanh bên | **Lọc mục lục tại chỗ.** Manifest đã nằm sẵn trong bộ nhớ; không gọi mạng. |
| `⌘K` | **Thành thật.** Gợi ý ấy đã in trên ô từ lâu mà không có handler nào. |
| Dấu tiếng Việt | **Ngoài phạm vi vòng này.** Gõ "ly thuyet" sẽ không ra "lý thuyết" — xem §7. |

---

## 1. Nguyên nhân, đo chứ không đoán

Nút không hỏng. Ô tìm kiếm **chưa bao giờ được nối dây**, và mã nguồn nói ra
điều đó bằng chữ:

| Chỗ | Trạng thái đo được |
|---|---|
| `apps/web/src/shell/TopNav.tsx:174` | `disabled` gắn cứng, `title` = "Tìm kiếm chưa nối dây — sắp có." |
| `apps/web/src/shell/Sidebar.tsx:115` | `disabled`, đã vậy qua nhiều vòng |
| `apps/api` | **Không có route tìm kiếm nào.** Mọi chỗ khớp "search" trong Go thuộc công cụ web-search của AI (Brave) |
| `TopNav.tsx` `⌘K` | Một gợi ý phím không có handler nào đứng sau |

Nút tròn **có** bung ra — phần chuyển động ấy chạy đúng. Cái hỏng là lời hứa:
ô hiện ra rồi không gõ được.

Nguyên liệu thì đã sẵn trong DB từ migration 0005: `published_courses`
(`title`, `description`, `manifest`) và `published_chapters.html` giữ nguyên
văn từng chương.

---

## 2. Endpoint

```
GET /search?q=<chuỗi>&limit=<n>
```

Công khai, không cần phiên — cùng chính sách với ba route catalog còn lại. Giao
diện vẫn chỉ hiện ô tìm kiếm cho người đã đăng nhập (điều kiện `meQuery.data`
sẵn có trong `TopSearch`); đó là một lựa chọn về giao diện, không phải một
ranh giới bảo mật, và tài liệu này nói rõ như vậy để vòng sau không nhầm.

**Hình dạng trả về — một ĐỐI TƯỢNG, không phải mảng trần:**

```json
{
  "courses":  [{ "slug": "...", "title": "...", "description": "..." }],
  "chapters": [{
    "slug": "...", "courseTitle": "...",
    "chapterId": "...", "chapterTitle": "...",
    "before": "…những gì đứng trước", "match": "entropy", "after": "phần đuôi…"
  }],
  "truncated": true
}
```

`GET /courses` trả mảng trần, và đó là tiền lệ; ở đây vẫn bọc, vì thân trả về
mang **hai** danh sách khác loại cộng một cờ. Một mảng trần không có chỗ cho
cái thứ hai.

**Đoạn trích chia làm ba mảnh — `before` / `match` / `after` — chứ không phải
một chuỗi kèm chỉ số.** Go đếm theo rune, JavaScript đếm theo đơn vị UTF-16;
tiếng Việt nằm gọn trong BMP nên hai cách đếm trùng nhau, nhưng một emoji
trong bài là đủ để chúng lệch, và khi ấy chỗ tô sáng trượt đi một quãng mà
không bài test nào bằng tiếng Việt bắt được. Ba mảnh thì không có phép tính
chỉ số nào để mà sai.

**Ràng buộc:**

| Tham số | Luật |
|---|---|
| `q` | Cắt khoảng trắng; **< 2 rune → 400**. Trên `MaxQueryBytes` (128) → 400. |
| `limit` | Mặc định 8, trần 30, `?limit=0` hoặc rác → mặc định. |
| `truncated` | `true` khi còn kết quả bị cắt — đó là thứ nút "Xem tất cả" dựa vào. |

---

## 3. Cách khớp, và một cái bẫy phải đóng

Hai chặng, cố ý:

1. **SQL lọc thô.** `title/description ILIKE` cho khoá; `html ILIKE` cho
   chương. Ký tự đặc biệt của `LIKE` (`%`, `_`, `\`) **phải được thoát** —
   nếu không, gõ `%` sẽ khớp mọi chương trong hệ thống.
2. **Go khớp thật.** Với mỗi chương lọt qua chặng 1, gỡ thẻ HTML rồi tìm lại
   chuỗi trong văn bản đã sạch. **Không tìm thấy thì bỏ hit đó đi.**

Chặng 2 tồn tại để đóng đúng một cái bẫy: `class="entropy"` nằm trong markup,
không nằm trong bài. Không có chặng ấy, người dùng gõ "entropy" và nhận về
những chương không hề nói tới entropy — mà lại còn kèm một đoạn trích cắt từ
giữa một thuộc tính HTML.

**Thứ tự:** khoá trước, rồi chương theo thứ tự chúng đứng trong manifest. Đây
là thứ tự *của mục lục*, không phải một điểm liên quan tính được — vòng này
không xếp hạng, và nói ra điều đó thay vì giả vờ có.

**Tên chương** không nằm trong `published_chapters`; nó ở trong
`published_courses.manifest` (jsonb). Truy vấn `JOIN` sẵn, Go đọc manifest ra
map `chapter_id → title`. Một chương có trong bảng mà không có trong manifest
thì vẫn trả về, `chapterTitle` rơi về chính `chapterId` — im lặng bỏ một
chương thật là cách hỏng tệ hơn.

---

## 4. `stripTags` đã tồn tại. Không viết cái thứ hai.

`internal/ai/tool_course.go:316` đã có một hàm gỡ thẻ HTML thành văn bản
thuần, dùng tokenizer thật (`golang.org/x/net/html`), kèm một bảng **mười**
thẻ raw-text phải xoá cả thân và một chùm test đo riêng từng thẻ. Nó viết ra
để cho model đọc; nó đúng y hệt thứ đoạn trích cần — kể cả tính chất "thân
`<script>` không được lọt ra ngoài".

**Tách sang `internal/htmltext`**, và `ai` import lại từ đó.

Không phải để cho gọn. Nếu `search` import `internal/ai` chỉ để lấy một hàm
xử lý chuỗi, nó kéo theo client DeepSeek, provider Brave, và dịch vụ tín dụng
— một cạnh phụ thuộc sai hướng. Còn viết bản thứ hai thì sinh ra hai định
nghĩa cho "văn bản của một chương là gì", và bảng mười thẻ kia sẽ chỉ đúng ở
một trong hai.

**Bất biến:** không đổi hành vi, không nới một test nào. Test cấp tokenizer đi
theo hàm; test đo qua công cụ khoá (`TestCourseToolStripsAllRawTextTagBodies`)
ở lại `ai` — nó đo công cụ, và phép đo ấy vẫn đúng chỗ.

---

## 5. Giao diện

### 5.1 Thanh trên — `TopSearch`

Bỏ `disabled`. Ô thành controlled input; truy vấn hoãn ~200ms; `useQuery` chỉ
chạy khi chuỗi đã cắt khoảng trắng dài ≥ 2 rune.

Bảng thả xuống dưới ô: nhóm "Khoá" rồi nhóm "Chương", mỗi chương một dòng
gồm tên chương, tên khoá, và đoạn trích với phần khớp được tô. Cuối bảng là
"Xem tất cả" khi `truncated`.

| Thao tác | Kết quả |
|---|---|
| `⌘K` / `Ctrl+K` | Mở ô và đưa con trỏ vào — **biến gợi ý đã in sẵn thành sự thật** |
| `↑` / `↓` | Di chuyển trong danh sách |
| `Enter` | Mở mục đang chọn; không chọn gì thì sang `/search?q=` |
| `Esc` | Đóng bảng; bấm lần nữa thì đóng ô |
| Bấm ra ngoài | Đóng |

`role="listbox"` + `aria-activedescendant`, vì `aria-expanded` và
`aria-controls` đã có sẵn trên nút và phải tiếp tục nói đúng.

Một `useEffect` trong `TopSearch` tự chú thích rằng nó là "chỗ DUY NHẤT trong
tệp sẽ phải đổi khi ô được nối dây thật". Vòng này là lúc lời hứa ấy được
thu — và chú thích ấy phải được viết lại, không để lại làm hoá thạch.

### 5.2 Trang `/search?q=`

`pages/SearchResults.tsx`. Cùng endpoint, `limit=30` — trần thật, không phải
"không giới hạn": trang này cũng hiện `truncated` khi còn nữa, và nói ra rằng
hãy gõ hẹp hơn. Tồn tại vì "Xem tất cả" cần một chỗ để tới; một nút dẫn tới hư
không thì đúng bằng cái ô `disabled` đang được gỡ đi.

Công khai như endpoint. Không `<RequireAuth>`.

### 5.3 Thanh bên — lọc mục lục

`Sidebar.tsx` đã giữ `manifestQuery.data`. Bỏ `disabled`, lọc tại chỗ theo tên
chương. Không gọi mạng, không endpoint, không trạng thái tải. Không khớp gì
thì nói ra bằng một dòng, chứ không để mục lục trống — `#nav` có sẵn luật
"luôn có *cái gì đó* trong đó" và luật ấy vẫn áp dụng.

### 5.4 Chuỗi hiển thị

Khoá mới đủ cả **`vi.ts` và `en.ts`**. `topbar.searchSoon` bị xoá khỏi cả hai
— nó chỉ có một chỗ dùng (`TopNav.tsx:173`), và giữ lại một chuỗi nói "sắp có"
sau khi thứ ấy đã tới là để lại một lời nói dối trong bảng chuỗi.

### 5.5 CSS

`app-screens.css:1307` có quy tắc `.tn-search-input:disabled` — không còn
trạng thái nào chạm tới nó. Thêm `.tn-search-panel` và phần tô sáng khớp.
`packages/course-kit/reader.css` **không đụng tới**.

---

## 6. Kiểm chứng

**Go — `internal/search`,** package ngoài, HTTP thật qua `server.New` +
`store.TestPool`, đúng khuôn `internal/userdata`:

| Ca | Đo cái gì |
|---|---|
| Khớp chỉ trong markup | `class="entropy"` **không** ra kết quả — §3 chặng 2 |
| Ký tự `LIKE` | `q=%` không trả về cả kho |
| Đoạn trích | Ba mảnh ghép lại đúng bằng đoạn văn bản gốc quanh chỗ khớp |
| Chữ tiếng Việt | Có dấu, và không vỡ ở ranh giới rune |
| `q` một ký tự / rỗng | 400 |
| `limit` ngoài khoảng | Kẹp về trần/mặc định, `truncated` đúng |
| Khoá đã gỡ publish | Không xuất hiện |
| Chương thiếu trong manifest | Vẫn trả về, tên rơi về `chapterId` |

**Web:**

- `api/search.test.ts` — canh biên `assertSearchResults` như `enrollments.ts`.
- `test/TopSearch.test.tsx` — gõ → có kết quả → `↓` → `Enter` → đúng URL;
  `⌘K` đưa con trỏ vào ô; `Esc` đóng.
- Lọc mục lục ở `Sidebar`: khớp, không khớp, và **không có yêu cầu mạng nào**.

Ba tệp test trang đặt `onUnhandledRequest: 'error'`. `TopSearch` không gọi
mạng lúc gắn vào cây — chỉ khi gõ — nên không tệp nào cần handler mặc định
mới. **Điều này phải được đo, không phải được tin**: chạy cả ba trước khi
đóng nhánh.

---

## 7. Ngoài phạm vi, và nói ra

- **Bỏ dấu.** "ly thuyet" sẽ không ra "lý thuyết". Cần `unaccent` hoặc một cột
  đã chuẩn hoá — một migration và một quyết định riêng.
- **Từ bị markup cắt đôi.** `en<b>tropy</b>` không khớp "entropy": chặng lọc
  thô của SQL đọc HTML thô. Hiếm trong nội dung thật, và chặng 2 chỉ có thể
  bỏ bớt hit chứ không thêm được.
- **Xếp hạng.** Không có điểm liên quan; thứ tự là thứ tự mục lục (§3).
- **Lịch sử tìm kiếm, gợi ý, đánh dấu chương.** Không.
