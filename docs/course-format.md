# Định dạng gói course

Tài liệu cho người muốn viết một course và đưa nó lên registry của tuhoc.

Một **gói course** là một thư mục: `manifest.json` ở gốc, các chương HTML bên
trong, cộng ảnh và CSS nếu cần. `tuhoc pack` kiểm thư mục đó theo bộ luật dùng
chung rồi nén thành `.zip`. Cùng bộ luật ấy chạy ở ba nơi — CLI trên máy bạn, CI
của registry, và trình duyệt khi ai đó import gói — nên **gói `tuhoc pack` nhận
là gói registry nhận**, không có bản sao luật nào trôi dạt ở giữa.

Luật nằm trong `packages/course-format/src/validate.ts`. Tài liệu này mô tả nó;
khi hai bên lệch nhau thì mã nguồn đúng và tài liệu này là lỗi — báo giúp.

---

## 1. Bắt đầu trong hai phút

```
bun tools/tuhoc-cli/src/index.ts init  courses-cua-toi/xac-suat-nhap-mon
bun tools/tuhoc-cli/src/index.ts pack  courses-cua-toi/xac-suat-nhap-mon
```

(Trong repo này có sẵn `make pack DIR=<thư-mục>` cho lệnh thứ hai.)

`init` dựng khung một course hợp lệ. `pack` kiểm rồi ghi
`<tên-thư-mục>.zip`; thêm `-o <tệp>` để đổi nơi ghi.

Mã thoát là hợp đồng, và chỉ có hai:

| Mã | Nghĩa |
|---|---|
| `0` | gói hợp lệ, `.zip` đã được ghi |
| `1` | mọi thất bại khác: gói không hợp lệ, sai tham số, không đọc được thư mục |

Khi trượt, `pack` in **mọi** vấn đề cùng một lượt — mỗi vấn đề gồm mã lỗi, vị
trí (tệp hoặc JSON pointer), mô tả, và một dòng "Cách sửa". Sửa hết rồi chạy
lại; không có tệp `.zip` nào được ghi khi trượt.

`tuhoc init X && tuhoc pack X` luôn thoát `0`. Nếu không, đó là lỗi của công cụ,
không phải của bạn.

---

## 2. `manifest.json`

Tệp bắt buộc, nằm **ngay ở gốc gói** (nếu nó nằm trong thư mục con thì hãy pack
thư mục con đó). Đây là bản đầy đủ:

```json
{
  "id": "xac-suat-nhap-mon",
  "title": "Xác suất nhập môn",
  "description": "Từ trực giác đếm đến kỳ vọng, cho người chưa học giải tích.",
  "lang": "vi",
  "version": "1.0.0",
  "runtime": "^1",
  "license": "CC-BY-4.0",
  "authors": [{ "name": "Nguyễn Văn A", "url": "https://github.com/nguyenvana" }],
  "generatedBy": "human",
  "translationOf": "vndee/so-dau-phay-dong",
  "parts": [
    {
      "title": "Phần I · Đếm",
      "chapters": [
        {
          "id": "p1-1",
          "num": "1.1",
          "title": "Vì sao đếm là một bài toán",
          "short": "Vì sao đếm",
          "file": "chapters/p1-1.html"
        }
      ]
    }
  ]
}
```

### Trường ở cấp cao nhất

| Trường | Bắt buộc | Kiểu | Ghi chú |
|---|---|---|---|
| `id` | có | chuỗi khác rỗng | Mã course, dùng trong đường dẫn và làm khoá lưu trữ cục bộ. Dùng chữ thường không dấu và gạch nối. Trên registry, tên đầy đủ là `<tài-khoản-github>/<id>` (§7). |
| `title` | có | chuỗi khác rỗng | Tên hiển thị trong catalog. |
| `description` | có | chuỗi (**được phép rỗng**) | Một câu nói rõ course dạy gì, cho ai. Phải có mặt và phải là chuỗi; rỗng là hợp lệ nhưng lãng phí. |
| `lang` | có | chuỗi khác rỗng | Nhãn ngôn ngữ, ví dụ `"vi"`, `"en"`. **Chỉ là nhãn** — nền tảng không dịch và không đổi hành vi theo nó. Catalog lọc theo nó, nên phải trung thực (§6). |
| `version` | có | semver | Ba số, ví dụ `"1.0.0"`, `"0.2.1-beta.1"`. Luật `SEMVER`. |
| `runtime` | có | dải caret | Phiên bản trình đọc gói này cần: `"^1"`, `"^1.2"`, `"^1.2.3"`. **Chỉ nhận dạng caret 1–3 số** — không `>=`, không `\|\|`, không `x`. Luật `RUNTIME_RANGE`. Không rõ thì để `"^1"`. |
| `license` | có | chuỗi khác rỗng | Giấy phép **của nội dung course**, ví dụ `"CC-BY-4.0"`, `"CC-BY-SA-4.0"`, `"CC0-1.0"`. Xem §8: AGPL của nền tảng **không** áp lên đây. |
| `authors` | có | mảng khác rỗng | Mỗi phần tử là `{ "name": "…" }`; `url` là tuỳ chọn nhưng nếu có thì phải là chuỗi khác rỗng. |
| `generatedBy` | có | `"ai"` \| `"human"` \| `"mixed"` | Ai viết phần chữ. Phải trung thực (§6). |
| `translationOf` | không | chuỗi khác rỗng | Tên registry của course gốc, khi gói này là **bản dịch**. Xem §9. |
| `registryId` | không | chuỗi khác rỗng | Do registry gán sau khi PR được merge. **Đừng tự điền.** |
| `parts` | có | mảng khác rỗng | Mục lục, xem dưới. |

**Không còn trường `tier`.** Format v1 (trước format v2 của pha "course lên máy
chủ") có `tier: "content" | "interactive"` — hạng nào được phép mang JavaScript
và hạng nào không. Format v2 bỏ hẳn phân biệt đó: mọi chương là máy kiểm được
hoàn toàn, và phần tương tác chuyển sang một cơ chế khác — **widget** — không
còn là một trường ở cấp cao nhất của manifest nữa. Xem §4. Một manifest còn ghi
`tier` bị `pack` từ chối bằng mã `TIER_REMOVED`, bất kể giá trị của trường đó
là gì.

### `parts[]`

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| `title` | có | Tên phần, ví dụ `"Phần I · Đếm"`. |
| `chapters` | có | Mảng **khác rỗng** các chương. |

### `parts[].chapters[]`

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| `id` | có | **Duy nhất trong cả course** — đây là khoá lưu tiến độ đọc và neo ghi chú, nên đổi `id` của một chương đã phát hành là làm mất ghi chú của người đọc. Luật `DUPLICATE_CHAPTER_ID`. |
| `num` | có, **được phép rỗng** | Nhãn số hiển thị, ví dụ `"1.1"`. Chương không đánh số (phụ lục, lời nói đầu) thì để `""` — trình đọc đã xử lý sẵn trường hợp đó. Trường phải **có mặt** và là chuỗi. |
| `title` | có | Tên đầy đủ của chương. |
| `short` | có | Tên ngắn cho thanh mục lục. Giữ dưới ~30 ký tự. |
| `file` | có | Đường dẫn tới tệp HTML, **tính từ gốc gói**, dùng dấu `/`, phân biệt hoa thường: `"chapters/p1-1.html"`. Tệp phải tồn tại (`CHAPTER_FILE_MISSING`) và không được đi ra ngoài gói (`PATH_ESCAPE`). |

Thứ tự đọc là thứ tự trong mảng — không có trường sắp xếp nào khác.

**Manifest không bị quét luật HTML.** Bạn được viết `<form>` trong
`description` của một course dạy về biểu mẫu: trình đọc hiển thị các trường
manifest dưới dạng **văn bản**, nên đánh dấu trong đó là chữ chết. Mọi tệp khác
trong gói thì bị quét (§5).

---

## 3. Chương viết ra sao

Mỗi chương là một **mảnh HTML**, không phải một trang hoàn chỉnh. Không
`<!doctype>`, không `<html>`, không `<head>`, không `<body>`: trình đọc lo phần
khung, thanh điều hướng, định kiểu và chế độ tối. Bạn chỉ viết nội dung.

Trình đọc nạp mảnh đó bằng `innerHTML`, rồi chạy KaTeX lên nó. Hai hệ quả:

- **Công thức toán chạy sẵn.** Viết `$H(X)$` cho công thức trong dòng và
  `$$…$$` cho công thức tách dòng. Bạn **không** cần đóng gói KaTeX; nó thuộc
  trình đọc.
- **`innerHTML` là lý do luật `EVENT_HANDLER_ATTR` tồn tại.** Thẻ `<script>` do
  `innerHTML` chèn vào thì không chạy, nhưng `onerror=` trên một `<img>` hỏng
  thì chạy ngay. Đó là luật thật sự chặn mã chạy trong một chương.

### Bộ lớp CSS trình đọc đã có sẵn

Dùng đúng bộ này thì chương của bạn trông giống phần còn lại của nền tảng,
kể cả ở chế độ tối và khi in. Định nghĩa nằm trong
`packages/course-kit/reader.css`.

| Lớp | Dùng cho |
|---|---|
| `ch-eyebrow` / `h1.ch-title` / `ch-lede` | Ba dòng mở đầu mỗi chương: dòng định vị ("Phần 0 · Chương 0.1"), tên chương, và đoạn dẫn nói **vì sao** chương này tồn tại. |
| `box def` | Định nghĩa. |
| `box thm` | Định lý, mệnh đề. |
| `box prf` | Chứng minh đặt thẳng trong dòng chảy. |
| `box intu` | Trực giác, cách đọc một công thức, trích ý. |
| `box ex` | Ví dụ **và** bài tập (tiêu đề `box-h` phân biệt hai loại). |
| `box warn` | Điều dễ hiểu sai. |
| `box pitfall` | Cạm bẫy gây lỗi thật, nặng hơn `warn`. |
| `box res` | Neo về nghiên cứu / ứng dụng / chương sau. |
| `details.deriv` + `div.deriv-body` | Khối gập: chứng minh dài, **lời giải bài tập**. |
| `keyfacts` | Hộp "chốt chương" cuối chương. |
| `div.tbl-wrap` + `table.tbl` | Bảng (bọc `tbl-wrap` để cuộn ngang được trên màn hẹp). |
| `fig` + `fig-head`/`fig-num`/`fig-title`/`fig-desc`/`fig-body`/`fig-foot` | Hình, kèm số hiệu, tên, mô tả trước và diễn giải sau. |
| `small`, `muted`, `tag`, `grid2`, `qed` | Vụn vặt: chữ nhỏ, chữ mờ, nhãn, hai cột, dấu ∎. |

Mỗi hộp mở bằng `<div class="box-h">Tiêu đề</div>`.

Đặt `id` cho mỗi `<h2>` (`<h2 id="bai-tap">Bài tập</h2>`) để liên kết trong
được và để mục lục phụ hoạt động.

**Chương hay trông như thế nào** — chuẩn sư phạm rút từ giáo trình mẫu, kèm số
liệu đo được: `.claude/skills/course-authoring/SKILL.md`. Tài liệu này chỉ nói
gói **hợp lệ**; skill kia nói gói **hay**.

---

## 4. Mọi chương là máy kiểm được hết; phần tương tác là widget

Format v2 (pha "course lên máy chủ") bỏ hẳn phân biệt hai hạng `content`/
`interactive` mà format v1 từng có. **Mọi chương, của mọi gói, giờ đều là máy
kiểm được hoàn toàn** — không còn đường nào để một gói tự vouch "tin tôi, tôi
đã tự duyệt JS của mình" bằng cách khai một trường trong manifest. Chỗ duy nhất
một gói còn được mang mã chạy được là **widget**: một tệp HTML tự chứa, chạy
trong khung cách ly riêng của nó, không phải trong trang chứa nó.

**Đây vẫn là một quyết định an ninh, không phải phân loại nội dung** — lý do
cũ của hai-hạng không đổi, chỉ đổi cơ chế thực thi nó. Trang đọc chương mang
phiên đăng nhập, tiến độ, và ghi chú của người đọc trong cùng một tài liệu;
JavaScript chạy thẳng trong tài liệu đó đọc được tất cả những thứ ấy. Nhốt mã
vào một `<iframe>` riêng thì giải quyết được vế đó — nhưng chỉ khi cái khung ấy
thật sự cách ly, không phải chỉ là một thẻ HTML trông có vẻ cách ly.

### Vì sao khung của widget thật sự cách ly được

Widget chạy trong `<iframe srcdoc="…" sandbox="allow-scripts">` — và **chỉ**
`allow-scripts`, không bao giờ thêm `allow-same-origin`. Hai thuộc tính đó
cùng lúc là cách duy nhất được biết để phá vỡ hẳn sandbox: một khung vừa chạy
được JavaScript vừa cùng-origin với trang chứa nó thì đọc được
`document.cookie`, `localStorage`, và `window.parent` của TRANG CHỨA — tức
đúng phiên đăng nhập mà cả cơ chế này tồn tại để giữ lại. Thiếu
`allow-same-origin`, trình duyệt gán cho khung một **origin mờ** (`opaque
origin` — chuỗi hoá thành `"null"`): không có cookie jar nào để đọc, gọi
`document.cookie` bên trong khung ném `SecurityError` thay vì lặng lẽ trả về
rỗng, và `window.parent` không đọc được gì hữu ích qua ranh giới cross-origin
đó. Không phải suy luận — `apps/web/e2e/widget.spec.ts` đo đúng ba điều này
trong một trình duyệt Chromium thật trước mỗi lần phát hành.

Cái sandbox **không** mua cho bạn: một widget vẫn là mã người khác phải đọc
được trước khi merge (spec §6 — "duyệt tay JS widget vẫn giữ"). Tám luật dưới
đây không trùng việc của sandbox; chúng đo được ĐỌC ĐƯỢC và TỰ CHỨA — đủ nhỏ
và đủ thường để một người đọc xong trước khi duyệt, và không mang thứ chỉ có ý
nghĩa với một mạng hoặc một cookie jar mà sandbox đã lấy đi rồi.

### Một widget là MỘT tệp

`widgets/<tên-widget>/index.html` — tự chứa hoàn toàn: CSS và JavaScript viết
inline trong chính tệp đó (`<style>`, `<script>`), không tệp phụ, không
`import`, không tải gì từ mạng. Chương đặt chỗ cho nó bằng một `div` rỗng:

```html
<div data-widget="ten-widget"></div>
```

Thẻ `div`, thuộc tính `data-widget`, thân rỗng. Luật của chương (bảy luật bên
dưới) vẫn quét chương như bình thường — một `div` mang `data-widget` không
phạm luật nào trong đó.

### Bảy luật của chương — chạy trên MỌI tệp của MỌI gói

Không còn gì để gạt luật này ra bằng cách đổi hạng: chúng chạy vô điều kiện,
trên mọi gói. Chúng đọc **mọi tệp trong gói** — không theo đuôi tệp, không bỏ
qua tệp "trông như nhị phân" — trừ hai ngoại lệ: `manifest.json` (dữ liệu
JSON, trình đọc hiển thị các trường của nó dưới dạng văn bản) và
`widgets/<tên>/index.html` của MỖI widget (tệp đó được PHÉP mang `<script>` —
tám luật widget bên dưới lo phần của nó).

| Mã | Từ chối |
|---|---|
| `SCRIPT_TAG` | thẻ mở `<script`, ở bất kỳ đâu, bất kỳ cách viết hoa nào |
| `EVENT_HANDLER_ATTR` | thuộc tính tên `on` + chữ cái (`onclick`, `onerror`, …) trên bất kỳ thẻ mở nào |
| `JAVASCRIPT_URL` | giá trị thuộc tính bắt đầu bằng scheme `javascript:` |
| `EMBEDDED_FRAME` | `<iframe>`, `<object>`, `<embed>`, `<frame>`, `<frameset>` |
| `FORM_TAG` | thẻ `<form>` |
| `JS_FILE_IN_PACKAGE` | tệp `.js`, `.mjs`, `.cjs`, `.jsx` trong gói, ở BẤT KỲ đâu ngoài `widgets/<tên>/` — bên trong một thư mục widget, `.js` rời (vd. `widgets/graph/chart.js`) thoát luật này nhưng bị bắt lại bởi `WIDGET_EXTRA_FILE` (xem dưới): một widget vẫn chỉ được đúng một tệp |
| `TAG_ATTR_FLOOD` | một thẻ mở mang quá 1024 thuộc tính (hàng rào tài nguyên, xem §5) |

Bộ quét dùng bộ token HTML thật (`parse5`), không phải regex, và nó **cố tình
báo thừa hơn báo thiếu**: nó đọc `<textarea>` và `<script>` như đánh dấu chứ
không như văn bản thô. Ba hình dạng "báo thừa" hay gặp và cách thoát từng cái ở
§5.

Bảy luật này là **hàng rào thứ nhất, không phải hàng rào duy nhất**. Những thứ
không luật nào bắt và vẫn thuộc trách nhiệm người duyệt: `<meta
http-equiv="refresh">`, `<img>`/`<link>`/CSS `url()` trỏ ra máy chủ ngoài (không
chạy mã, nhưng vẫn là một yêu cầu mạng người đọc không xin), và URL `data:`.
Đừng làm những việc đó.

### Tám luật widget

Chạy trên mọi thư mục `widgets/<tên>/` của gói. Hằng số lấy thẳng từ
`packages/course-format/src/widgets.ts` — nguồn duy nhất, tài liệu này chỉ
chép lại.

| Mã | Bắt gì | Hằng số |
|---|---|---|
| `WIDGET_TOO_LARGE` | `index.html` nặng hơn trần | `WIDGET_MAX_BYTES = 131072` byte (128 KiB) |
| `WIDGET_LINE_TOO_LONG` | một dòng của `index.html` dài hơn trần — hàng rào chống minify: JS đã minify đặc trưng bởi MỘT dòng khổng lồ | `WIDGET_MAX_LINE_BYTES = 500` byte/dòng |
| `WIDGET_BAD_NAME` | tên thư mục widget không đúng khuôn, hoặc quá dài | `WIDGET_NAME_RE = /^[a-z0-9][a-z0-9-]*$/`, tối đa `WIDGET_NAME_MAX = 64` ký tự |
| `WIDGET_FORBIDDEN_API` | `index.html` chứa một trong bốn chuỗi con này — khung sandbox không có cookie/storage, gọi API này chỉ ném lỗi lúc chạy | `WIDGET_FORBIDDEN_APIS = ['document.cookie', 'localStorage', 'sessionStorage', 'indexedDB']` |
| `WIDGET_EXTERNAL_URL` | `index.html` chứa chuỗi con `http://` hoặc `https://`, kể cả trong chú thích — widget phải tự chứa, không tải gì từ mạng | — |
| `WIDGET_EXTRA_FILE` | bất kỳ tệp nào trong `widgets/<tên>/` khác `index.html` | — |
| `WIDGET_MISSING` | một chương có `data-widget="x"` mà gói không có `widgets/x/index.html` | — |
| `WIDGET_ORPHAN` | có thư mục `widgets/<tên>/index.html`, không chương nào tham chiếu nó qua `data-widget` | — |

Ngoài tám luật trên, hai luật khác cũng ăn vào chuyện widget nhưng thuộc nhóm
khác:

- `TIER_REMOVED` — manifest còn ghi trường `tier` (mọi giá trị) thì bị từ chối
  thẳng. Format v2 không còn hạng để đọc; xem §2.
- `JS_FILE_IN_PACKAGE` — bảy luật của chương, ở trên: bắt `.js`/`.mjs`/`.cjs`/
  `.jsx` **ngoài** `widgets/<tên>/` — đường viz.js chạy toàn khoá kiểu cũ
  không còn đường sống.

  Gói v1 còn `viz.js` không phải chuyển tay: `bun tools/viz-to-widgets/convert.ts
  <thư-mục-course>` tách từng `defineViz` thành một widget tự chứa (kèm
  `runtime.js` và bảng biến CSS của reader), đổi `data-viz` → `data-widget`, xoá
  `tier`, và tự kiểm bốn luật máy chủ sẽ đo. Giới hạn (theme theo hệ, chiều cao
  cố định) ghi ở `tools/viz-to-widgets/README.md`.

**Báo chiều cao (tuỳ chọn).** Khung của widget cao 420px mặc định; trang không đo
được bên trong một origin mờ, nhưng widget nói được với trang:

```js
parent.postMessage({ type: 'tuhoc:widget-height', height: document.documentElement.scrollHeight }, '*');
```

Gửi lúc mount và mỗi khi nội dung đổi cỡ (một `ResizeObserver` trên `body` là
đủ). Trang chỉ nhận thông điệp từ đúng khung của widget ấy, chỉ đọc một con số
hữu hạn, và kẹp trong 160–1400px; widget không gửi gì thì giữ 420px. Đây là
kênh MỘT CHIỀU từ widget ra trang — trang không gửi gì vào (kể cả theme), và
sandbox không đổi. `tools/viz-to-widgets` tự cài đoạn này vào widget nó sinh.

**Chọn có widget hay không.** Không còn "hạng" để lên; chỉ còn câu hỏi khái
niệm này có **phải nhìn thấy nó chuyển động mới hiểu** hay không — người đọc
cần bấm/vặn một tham số rồi thấy kết quả đổi thật. Hoạt hình trang trí, nút
"hiện đáp án" (dùng `<details>`), biểu đồ tĩnh (dùng SVG) đều **không** phải
lý do: cả ba làm được bằng chương thường, không cần widget.

---

## 5. Giới hạn, và những gì `pack` tự xử lý

**Trần 20 MiB, tính theo kích thước ĐÃ giải nén** (20 × 1024 × 1024 =
20.971.520 byte), tổng mọi tệp trong gói. Tính theo kích thước nén thì một zip
bom vài kilobyte sẽ lọt, nên trần đặt ở phía đã giải nén. Để so sánh: giáo trình
44 chương của một giáo trình thật nặng khoảng 1,3 MB thô. Nếu bạn chạm trần,
gần như chắc chắn là do ảnh chưa nén.

Trần ấy áp cả khi **mở** gói: trình đọc dừng giải nén ngay khi tổng vượt ngưỡng,
không đợi đọc xong.

`tuhoc pack` còn tự quyết ba việc, và nói ra chứ không làm lặng lẽ:

- **Mục ẩn bị bỏ qua** — mọi tên bắt đầu bằng `.`, ở mọi độ sâu. Đây là thứ giữ
  `.git/` và `.DS_Store` ra khỏi gói. Số mục bỏ qua được in ra.
- **Symlink bị từ chối**, cùng socket/fifo/thiết bị. Lệnh dừng và nêu tên từng
  mục. Thay bằng tệp thật.
- **Tệp `.zip` sắp ghi không tự đóng gói chính nó**, nên chạy `pack` hai lần
  trong cùng thư mục không lồng gói cũ vào gói mới.

Về đường dẫn: mọi đường dẫn trong gói phải **tương đối so với gốc gói** và dùng
dấu `/`. Không `..`, không bắt đầu bằng `/`, không dấu `\` (trên Windows nó là
dấu phân cách, nên nó không bao giờ hợp lệ ở đây). Không có mục nào được đặt tên
đúng bằng `__proto__`.

### Ba hình dạng "báo thừa" thường gặp

Bộ quét không phân biệt được "HTML đang chạy" với "HTML đang được trưng bày làm
ví dụ". Ba trường hợp, và **cách thoát khác nhau ở từng cái**:

1. **Ví dụ mã HTML sống trong chương.** `<button onclick="chao()">` viết thẳng
   sẽ bị bắt. **Escape là cách đúng**, và dù sao bạn cũng phải escape thì chương
   mới hiển thị được mã đó: `&lt;button onclick="chao()"&gt;` là văn bản, sạch.

2. **Tệp không phải HTML mà định dạng của nó không escape.** Một tệp `.md` nguồn
   đi kèm chương, có khối ```` ```html ````, sẽ bị bắt — bộ quét thấy một mục
   trong gói, không thấy một khối mã markdown. **Escape không dùng được ở đây**
   (escape một khối mã markdown là làm hỏng markdown). Cách thoát: **đừng đóng
   gói tệp nguồn**, chỉ đóng gói HTML đã dựng.

3. **Văn xuôi bắt đầu một giá trị thuộc tính bằng chính từ đó.**
   `<abbr title="javascript: một ngôn ngữ">` bị bắt `JAVASCRIPT_URL`, và
   **escape KHÔNG cứu được**: bộ quét giải mã tham chiếu ký tự y hệt trình
   duyệt, nên `title="&#106;avascript: …"` cũng bị bắt. Ba cách thoát: escape
   **cả thẻ** để nó thôi là thẻ, chuyển từ đó ra ngoài thuộc tính (văn xuôi
   không bao giờ bị đọc như thuộc tính), hoặc viết lại để giá trị không **bắt
   đầu** bằng scheme.

---

## 6. `lang` và `generatedBy` phải trung thực

Hai trường này là thứ người ta nhìn **trước khi** tải course về. Chúng không đổi
hành vi của nền tảng chút nào — chúng chỉ đặt kỳ vọng, và đó chính là lý do khai
sai gây hại: người đọc mất thời gian rồi mới biết mình bị nói dối.

- `lang` — ngôn ngữ **của nội dung chương**, không phải của tên course. Một
  course tên tiếng Anh mà chương viết tiếng Việt thì `lang` là `"vi"`.
- `generatedBy` — `"ai"` nếu phần chữ do mô hình sinh, `"human"` nếu người viết,
  `"mixed"` nếu người viết dàn bài và sửa nhưng mô hình viết phần lớn văn bản.

**Course do AI sinh là chuyện bình thường ở đây** và không bị phạt trong catalog.
Cái bị phạt là khai `"human"` cho một gói do mô hình viết: nó phá đúng cái tín
hiệu khiến `"ai"` còn có nghĩa. Nếu bạn phân vân giữa `"mixed"` và `"human"`,
chọn `"mixed"`.

---

## 7. Gửi PR vào registry

**Mục này mô tả một luồng chưa được xác nhận lại toàn bộ sau server-side
pivot** — course lên tay người đọc hôm nay chủ yếu qua `tuhoc publish` (§4,
`README.md`), và liệu luồng PR-vào-registry dưới đây còn tồn tại nguyên hình,
đã đổi hình dạng, hay chỉ còn một phần, là một câu hỏi cần một lượt kiểm riêng
chứ không phải thứ tài liệu này tự trả lời được. Hai khẳng định cụ thể bên
dưới (bước 3, bước 4) **đã kiểm và sai** — sửa tại đây; phần còn lại của mục
giữ nguyên như trước khi có server-side pivot và có thể cũng đã lỗi thời.

Registry là một repo GitHub công khai. Mỗi course là một thư mục. Đóng góp là mở
một PR thêm thư mục đó.

**Tên trên registry là `<tài-khoản-github>/<mã-course>`** — ví dụ
`vndee/so-dau-phay-dong`. Nhờ tiền tố tài khoản, `id` của bạn chỉ cần duy nhất
trong phạm vi tài khoản bạn; không có cơ quan cấp phát tên nào cả.

Quy trình:

1. `tuhoc pack <thư-mục>` trên máy bạn cho tới khi **thoát 0**. CI chạy đúng bộ
   luật ấy, nên đây là cách biết trước kết quả thay vì chờ CI báo đỏ.
2. Mở PR thêm thư mục course (thư mục nguồn, không phải tệp `.zip`).
3. CI kiểm định theo `packages/course-format` (`tools/registry/src/validate-pr.ts`
   chạy đúng bộ luật ấy). **Không còn đúng, sửa tại đây:** CI không còn sinh
   `index.json` — `build-index.ts` bị xoá ở Task 17 của server-side pivot, và
   không nơi nào trong nền tảng còn tải một `index.json` của registry để đọc
   course từ đó (`validate-pr.ts`'s header ghi thẳng: không route nào còn đọc
   một `index.json` do registry xuất bản, hay kéo một gói từ archive registry
   host nữa).
4. **Không còn đúng, sửa tại đây:** không còn "hạng" nào để CI gán hay để gác
   cổng theo — §4 đã bỏ hẳn phân biệt `content`/`interactive`. Tiêu chí
   merge/duyệt thật của luồng PR này sau pivot **chưa được xác nhận lại** —
   đừng coi câu cũ ("hạng content merge tự động, hạng interactive chờ duyệt")
   còn đúng cho tới khi có một lượt kiểm riêng.
5. Sau khi merge, registry gán `registryId`. Đừng tự điền trường đó.

**Không còn đúng, sửa tại đây:** đoạn dưới đây từng mô tả `UpdateDialog.tsx`
kèm `version.ts`'s `pickPinned` — cả hai đã bị xoá (commit `e58ef41`) cùng lúc
với toàn bộ mô hình "gói đã pull về máy, ghim một bản cũ": máy chủ giờ luôn
phục vụ đúng bản hiện hành qua `GET /courses/:slug` (Task 9-11), không có
"bản đã ghim" nào ở phía người đọc để so hay để hỏi có muốn cập nhật không.

Cập nhật course hôm nay: tăng `version` theo semver rồi `tuhoc publish` (hoặc
mở PR mới nếu đi qua registry — xem lưu ý về luồng này ở đầu mục). Người đọc
thấy nội dung mới ngay ở lần tải trang kế tiếp — không có màn hình xác nhận,
không có bản xem trước ghi chú nào sẽ mất neo. Việc bảo toàn `id` chương vẫn y
nguyên tầm quan trọng cũ: ghi chú của người đọc neo vào `chapter.id`
(`DUPLICATE_CHAPTER_ID`, §10), nên đổi `id` của một chương đã publish vẫn làm
mất neo ghi chú của người đã đọc nó — chỉ là bây giờ không còn màn hình nào
cảnh báo trước khi việc đó xảy ra.

Thảo luận về một course diễn ra ở GitHub Discussions của repo registry, không
phải trong nền tảng.

---

## 8. Giấy phép: AGPL áp cho nền tảng, **không** áp cho course của bạn

**Mã nguồn nền tảng tuhoc phát hành theo AGPL-3.0. Nội dung course của bạn thì
không.** Mỗi course mang giấy phép riêng, khai trong `manifest.license`, và bạn
chọn nó.

Đóng gói course rồi gửi PR vào registry **không** làm nội dung của bạn bị AGPL
hoá, không chuyển bản quyền, và không buộc bạn chia sẻ bản thảo hay tư liệu
nguồn. AGPL nói về việc ai chạy bản nền tảng đã sửa đổi cho người khác dùng thì
phải công bố mã của **nền tảng** — nó không chạm tới văn bản bạn viết.

`CC-BY-4.0` là lựa chọn hay dùng cho tài liệu học. Không muốn cho phép sửa đổi
thì có `CC-BY-ND-4.0`; muốn thả hẳn thì `CC0-1.0`. Trường này là chuỗi tự do:
ghi định danh SPDX nếu có, hoặc tên giấy phép của bạn nếu không.

---

## 9. Bản dịch là một course RIÊNG

Không nhồi hai ngôn ngữ vào một gói. Bản dịch có `id` riêng, `lang` riêng,
`version` riêng, và trỏ về bản gốc bằng `translationOf`:

```json
{
  "id": "floating-point",
  "lang": "en",
  "translationOf": "vndee/so-dau-phay-dong"
}
```

Lý do là kỹ thuật chứ không phải sở thích: người học ghim **một** phiên bản và
ghi chú của họ neo vào **một** thân văn bản. Trộn hai ngôn ngữ vào một gói làm
hỏng cả hai — bản dịch sửa một câu thì bản gốc cũng nhảy phiên bản, và ghi chú
của người đọc bản gốc mất neo vì một thay đổi họ không hề thấy.

Catalog dùng `translationOf` để nối hai course lại với nhau. Nền tảng **không**
dịch course và không hứa sẽ dịch.

---

## 10. Mọi mã lỗi, và cách sửa từng cái

Danh sách này là toàn bộ `FINDING_CODES` trong
`packages/course-format/src/validate.ts`, **cộng thêm một mã**:
`DUPLICATE_ENTRY`, ở cuối bảng "Hình dạng gói" dưới đây. Mã đó không nằm
trong `FINDING_CODES` — và đúng là không nên nằm ở đó — vì nó là một luật ở
tầng đọc file zip (hai entry trùng tên trong chính tệp `.zip`), không phải
một luật của tầng nội dung mà `validate.ts` quyết định; `tuhoc pack` không
bao giờ tự tạo ra ca này (nó tự đóng gói từ một thư mục, không thể trùng
tên tệp hai lần), nên bạn chỉ có thể thấy mã này trong một phản hồi 400 từ
`tuhoc publish`. `tuhoc pack` in mã, vị trí, mô tả và một dòng "Cách sửa"
cho mỗi phát hiện; bảng dưới là bản đầy đủ hơn.

### Hình dạng gói — áp dụng cho mọi gói

| Mã | Bắt gì | Sửa thế nào |
|---|---|---|
| `EMPTY_PACKAGE` | thư mục không có tệp nào đóng gói được | Sai đường dẫn, hoặc thư mục chỉ chứa mục ẩn (đều bị bỏ qua). Chạy `tuhoc init` để dựng khung. Mã này về **một mình** — mọi luật khác im lặng vì chúng chỉ nói lại đúng sự thật đó. |
| `TOO_LARGE` | tổng kích thước **đã giải nén** vượt 20 MiB | Nén ảnh (WebP/AVIF, giảm độ phân giải), bỏ tệp không dùng, hoặc tách thành nhiều course. Kiểm tra xem có tệp nào lớn lọt vào nhầm không: `du -ah <thư-mục> \| sort -h \| tail`. |
| `PATH_ESCAPE` | đường dẫn có `..`, có `\`, hoặc bắt đầu bằng `/` | Mọi đường dẫn phải tương đối so với gốc gói, dùng `/`. Nếu nó ở `chapter.file`, sửa manifest; nếu ở tên tệp, đổi tên tệp. |
| `MANIFEST_MISSING` | không có `manifest.json` ở gốc gói | Nó phải ở **gốc**, không phải trong thư mục con. Nếu cây của bạn là `abc/course/manifest.json` thì hãy pack `abc/course`. |
| `MANIFEST_PARSE` | `manifest.json` không phải JSON hợp lệ, hoặc không phải một object | Hay gặp nhất: dấu phẩy thừa cuối danh sách, thiếu ngoặc kép quanh khoá, dùng nháy đơn. JSON không có chú thích. Chạy qua một bộ định dạng JSON. |
| `MANIFEST_FIELD` | một trường thiếu, sai kiểu, hoặc sai giá trị | Sửa đúng trường mà JSON pointer chỉ tới. Manifest v1 (trước khi có gói rời) trượt đúng bốn trường: `tier`, `license`, `authors`, `generatedBy` — `tier` từ đó đã bị xoá hẳn khỏi manifest (xem `TIER_REMOVED` dưới); ba trường kia vẫn còn. Bảng đầy đủ ở §2. **Mọi** trường sai được báo cùng lượt, không phải từng cái một. |
| `TIER_REMOVED` | `manifest.json` còn trường `"tier"`, bất kể giá trị gì | Xoá hẳn trường đó. Format v2 không còn khái niệm "hạng" — mọi chương đều là nội dung tĩnh máy kiểm được hết; phần cần chạy mã tách thành widget riêng dưới `widgets/<tên>/index.html`. Xem §4. |
| `SEMVER` | `version` không phải semver | Ba số cách nhau bằng dấu chấm: `"1.0.0"`. Không `"v1.0"`, không `"1.0"`, không `"2026-08-21"`. Hậu tố tiền phát hành thì được: `"0.2.1-beta.1"`. |
| `RUNTIME_RANGE` | `runtime` không phải dải caret 1–3 số | Đúng dạng `"^1"`, `"^1.2"`, `"^1.2.3"`. Không `">=1 <3"`, không `"1.x"`, không `"*"`. Không rõ thì để `"^1"`. |
| `DUPLICATE_CHAPTER_ID` | hai chương mang cùng `id` | Đổi một trong hai. `id` là khoá lưu tiến độ đọc và neo ghi chú, nên phải duy nhất trong cả course — và **đừng đổi `id` của chương đã phát hành**, làm vậy là làm mất ghi chú của người đọc. |
| `CHAPTER_FILE_MISSING` | `chapter.file` trỏ tới tệp không có trong gói | Kiểm tra chính tả, **phân biệt hoa thường** (máy bạn có thể không phân biệt, CI thì có), và nhớ đường dẫn tính từ gốc gói: `"chapters/p1-1.html"`, không phải `"./p1-1.html"`. Cũng kiểm tra tệp có bắt đầu bằng `.` không — mục ẩn bị bỏ qua trước khi luật chạy. |
| `DUPLICATE_ENTRY` | hai entry trong chính tệp `.zip` mang cùng tên đường dẫn | **Chỉ máy chủ publish bắt được** — không phải một mã trong `FINDING_CODES` của `validate.ts`, xem đoạn mở đầu mục này. `tuhoc pack` không tạo ra ca này; nếu bạn thấy mã này khi `tuhoc publish`, tệp `.zip` đã bị chỉnh sửa hoặc dựng lại bằng công cụ khác ngoài `tuhoc pack` — đóng gói lại từ thư mục nguồn bằng `tuhoc pack` thay vì sửa tay bên trong zip. |

### Bảy luật của chương — chạy trên MỌI gói (§4)

Không còn "hạng" nào để đổi sang cho hết cảnh báo. Cách thoát hợp pháp DUY
NHẤT khi bạn thật sự cần đoạn mã đó chạy: chuyển nó vào
`widgets/<tên>/index.html` — nơi duy nhất định dạng v2 cho phép mã chạy được,
vẫn phải qua tám luật widget (§4) và người duyệt tay ở registry.

| Mã | Bắt gì | Sửa thế nào |
|---|---|---|
| `SCRIPT_TAG` | thẻ mở `<script` trong một tệp của gói | Bỏ nó đi. Nếu đó là **ví dụ** trong chương, escape: `&lt;script&gt;` — thứ bạn phải làm dù sao để nó hiển thị được. Nếu nó ở trong một tệp `.md` nguồn thì đừng đóng gói tệp nguồn (§5, trường hợp 2). Cần mã chạy thật thì chuyển vào `widgets/<tên>/index.html`. |
| `EVENT_HANDLER_ATTR` | thuộc tính `on…` trên một thẻ mở | Bỏ nó. **Đây là luật thật sự ngăn mã chạy** khi trình đọc nạp chương bằng `innerHTML`, nên nó không có ngoại lệ nào. Ví dụ trong chương thì escape cả thẻ; cần tương tác thật thì chuyển vào `widgets/<tên>/index.html`. |
| `JAVASCRIPT_URL` | giá trị thuộc tính bắt đầu bằng `javascript:` | Thay bằng liên kết thật, hoặc bỏ liên kết. Nếu đó là **văn xuôi** nói về ngôn ngữ JavaScript thì escape không cứu được — xem §5, trường hợp 3. Cần chạy mã thì chuyển vào `widgets/<tên>/index.html`. |
| `EMBEDDED_FRAME` | `<iframe>`, `<object>`, `<embed>`, `<frame>`, `<frameset>` | Nội dung nhúng từ máy chủ khác không kiểm định được, nên không chương nào được mang nó — kể cả video YouTube. Thay bằng ảnh kèm liên kết; cần thứ chạy được thì viết thành `widgets/<tên>/index.html`. |
| `FORM_TAG` | thẻ `<form>` | Một chương là tài liệu đọc, không gửi dữ liệu đi đâu. Câu hỏi tự kiểm thì dùng `<details class="deriv">` với lời giải bên trong; cần thu thập câu trả lời thật thì viết một `widgets/<tên>/index.html` — widget được phép mang cả script lẫn form. |
| `JS_FILE_IN_PACKAGE` | tệp `.js`, `.mjs`, `.cjs`, `.jsx` ở bất kỳ đâu ngoài `widgets/<tên>/` | Xoá khỏi gói, hoặc chuyển nội dung vào `widgets/<tên>/index.html` — một tệp `.js` đứng riêng ngoài `widgets/` không còn đường chạy nào trong v2. Hay gặp: `node_modules/` lọt vào, hoặc một tệp dựng còn sót. (Tệp `.ts` **không** bị bắt: trình duyệt không nạp thẳng được.) |
| `TAG_ATTR_FLOOD` | một thẻ mở mang quá 1024 thuộc tính | Gần như chắc chắn tệp này không phải HTML thật — hay gặp nhất là JavaScript đã minify bị đặt đuôi `.html`. HTML thật viết tay chưa bao giờ vượt quá 7 thuộc tính trên một thẻ. Đây là hàng rào tài nguyên: không có nó, một tệp 552 KiB làm treo tab trình duyệt của người đọc 6 giây. |

### Tám luật widget (§4)

Chạy trên mọi `widgets/<tên>/`. Hằng số và câu chữ lấy từ
`packages/course-format/src/widgets.ts`.

| Mã | Bắt gì | Sửa thế nào |
|---|---|---|
| `WIDGET_TOO_LARGE` | `widgets/<tên>/index.html` nặng hơn 131072 byte (128 KiB) | Cắt bớt nội dung, viết CSS/JS gọn hơn, hoặc bỏ hẳn phần nặng (ảnh, dữ liệu lớn) — widget không tải được gì từ mạng nên không có chỗ nào để "chuyển ra ngoài" mà vẫn dùng được. |
| `WIDGET_LINE_TOO_LONG` | một dòng của `index.html` dài hơn 500 byte | Dấu hiệu quen thuộc của mã đã bị minify hoặc dồn hết vào một dòng. Viết lại thành nhiều dòng bình thường, thụt lề rõ ràng — người duyệt phải đọc được mã này bằng mắt. |
| `WIDGET_BAD_NAME` | tên thư mục widget không khớp `^[a-z0-9][a-z0-9-]*$`, hoặc dài hơn 64 ký tự | Chỉ dùng chữ thường a-z, số 0-9 và dấu gạch ngang, bắt đầu bằng chữ hoặc số — ví dụ `widgets/dem-so/index.html`, không phải `widgets/Dem_So/index.html`. |
| `WIDGET_FORBIDDEN_API` | `index.html` chứa `document.cookie`, `localStorage`, `sessionStorage`, hoặc `indexedDB` | Widget chạy trong iframe sandbox không có cookie hay bộ nhớ trình duyệt — gọi những API này chỉ ném lỗi lúc chạy. Bỏ hẳn đoạn mã đó; cần nhớ trạng thái thì giữ nó trong một biến JavaScript sống trong phiên đọc. |
| `WIDGET_EXTERNAL_URL` | `index.html` có chuỗi con `http://` hoặc `https://`, kể cả trong chú thích | Widget phải tự chứa hoàn toàn, không tải gì từ mạng. Xoá đường dẫn đó; nhúng trực tiếp nội dung cần thiết nếu bản quyền cho phép, hoặc bỏ tính năng đó. |
| `WIDGET_EXTRA_FILE` | một tệp trong `widgets/<tên>/` khác `index.html` | Gộp nội dung của tệp thừa (CSS, JS, ảnh nhỏ) trực tiếp vào `index.html` (inline `<style>`/`<script>`, hoặc `data:` URL cho ảnh), rồi xoá tệp đó đi. |
| `WIDGET_MISSING` | một chương có `data-widget="…"` mà gói không có widget khớp tên | Kiểm tra tên trong `data-widget` khớp đúng tên thư mục `widgets/<tên>/`, hoặc thêm `widgets/<tên>/index.html` còn thiếu vào gói. |
| `WIDGET_ORPHAN` | có `widgets/<tên>/index.html` mà không chương nào tham chiếu qua `data-widget` | Xoá cả thư mục widget này nếu không còn dùng, hoặc thêm `<div data-widget="<tên>"></div>` vào chương cần nó. |

---

## 11. Xem thêm

- `.claude/skills/course-authoring/SKILL.md` — cách viết một course **hay**,
  chuẩn sư phạm rút từ giáo trình mẫu.
- `packages/course-format/src/validate.ts` — bảy luật chương + luật gói, bản duy nhất.
- `packages/course-format/src/widgets.ts` — tám luật widget (§4), hằng số gốc.
- `apps/web/src/reader/WidgetFrame.tsx` — nơi widget thật sự chạy trong trình đọc: `sandbox="allow-scripts"`, không bao giờ `allow-same-origin`.
- `apps/web/e2e/widget.spec.ts` — cổng đo ranh giới sandbox trong trình duyệt thật.
- `tools/tuhoc-cli/` — CLI.
- `packages/course-kit/reader.css` — bộ lớp CSS trình đọc cung cấp.
- `docs/superpowers/specs/2026-08-20-platform-v2-design.md` — vì sao mọi thứ ở
  đây được quyết như vậy (thiết kế trước format v2).
- `docs/superpowers/specs/2026-08-25-server-side-pivot.md` — pha "course lên
  máy chủ": format v2, widget, publish qua server. Nguồn của §2/§4 hiện tại.
