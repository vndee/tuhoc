---
name: course-authoring
description: Use when writing, generating, or revising a course package for the tuhoc platform — soạn course, viết giáo trình, sinh chương học, đóng gói course, tuhoc pack. Encodes the chapter/manifest structure, the pedagogical standard measured from the shipping ***REMOVED*** textbook, the two-tier security rule, and the mandatory `tuhoc pack` gate.
---

# Soạn course cho tuhoc

## Việc của skill này

CLI đảm bảo course **hợp lệ**. Skill này đảm bảo course **hay**. Một registry
đầy course hợp lệ mà nhạt thì vẫn thất bại.

Phần lớn course trên nền tảng sẽ do AI sinh. Nghĩa là chất lượng không thể trông
chờ vào lời nhắc tuỳ hứng — nó phải nằm ở đây, thành luật viết ra được và kiểm
được.

**Nói ở đầu việc:** "Tôi dùng skill course-authoring để soạn course này."

**Định dạng, mã lỗi, quy trình PR:** `docs/course-format.md`. Skill này **không**
lặp lại tài liệu đó; nó nói những thứ tài liệu đó không nói.

---

## Cổng nghiệm thu — đọc trước khi viết dòng đầu tiên

**Course chưa chạy qua `tuhoc pack` với mã thoát 0 thì chưa xong.** Không có
ngoại lệ, kể cả khi bạn "chỉ sửa vài chữ".

```
bun tools/tuhoc-cli/src/index.ts pack <thư-mục-course>
echo "exit=$?"
```

Bắt buộc **in mã thoát thô** và đọc nó. Lệnh in "OK — N tệp" rồi thoát 0 mới là
đạt; in danh sách phát hiện rồi thoát 1 là chưa. Đừng báo cáo "đã đóng gói" khi
chưa nhìn thấy `exit=0` bằng mắt.

Nếu gói trượt, sửa **gói**, đừng nới luật. Nếu gói trượt vì skill này hướng dẫn
sai, sửa **skill**.

---

## Quy trình

1. **Chốt phạm vi trước khi viết.** Một câu trả lời cho: *sau course này người
   đọc làm được gì mà trước đó không làm được?* Nếu không trả lời gọn được thì
   phạm vi còn sai, chưa phải lúc viết chương.
2. **Viết mục lục trước, chương sau.** Danh sách chương với `title` + một câu
   nói chương ấy trả lời câu hỏi nào. Xem xét cả dàn bài; một dàn bài dở thì
   chương nào cũng dở.
3. **Chọn hạng.** Mặc định `content`. Xem §"Hai hạng" trước khi chọn
   `interactive`.
4. `tuhoc init <thư-mục>` để dựng khung, hoặc tự tạo thư mục theo cấu trúc dưới.
5. **Viết từng chương trọn vẹn**, theo bộ khung ở §"Bộ khung một chương". Đừng
   viết 3 chương dở dang rồi quay lại; một chương xong là một chương xong.
6. Cập nhật `manifest.json` sau mỗi chương — mọi chương phải có mặt trong
   `parts`, nếu không nó không tồn tại với trình đọc.
7. **`tuhoc pack` cho tới khi thoát 0.**
8. **Đọc lại một chương bất kỳ như người học**, không như người viết. Chỗ nào
   bạn phải đọc hai lần thì người học sẽ bỏ.

---

## Cấu trúc thư mục

```
<thư-mục-course>/
├── manifest.json          bắt buộc, ở GỐC
├── chapters/
│   ├── p1-1.html          mỗi chương là một MẢNH HTML
│   ├── p1-2.html
│   └── …
└── images/                tuỳ chọn
```

Chương là **mảnh HTML**, không phải trang: không `<!doctype>`, `<html>`,
`<head>`, `<body>`. Trình đọc lo khung, mục lục, định kiểu, chế độ tối, và chạy
KaTeX. Bạn viết nội dung.

Công thức toán dùng `$…$` trong dòng và `$$…$$` tách dòng — **không** cần đóng
gói thư viện nào, kể cả ở hạng `content`.

`manifest.json`: mọi trường và mọi ràng buộc ở `docs/course-format.md` §2. Ba
điều hay sai nhất:

- `chapters[].id` phải **duy nhất trong cả course** và **không bao giờ đổi sau
  khi phát hành** — nó là khoá neo ghi chú của người đọc.
- `chapters[].file` tính từ **gốc gói**, không phải từ `chapters/`.
- `num` được phép là `""` cho phụ lục; `short` phải thật ngắn (dưới ~30 ký tự),
  nó nằm trong thanh mục lục.

---

## Chuẩn sư phạm

Rút từ `courses/***REMOVED***/` — 44 chương đang chạy thật, trung bình
24 KB HTML mỗi chương. Mọi con số dưới đây là **đếm được từ cây tệp đó**, không
phải chủ trương suông. Chúng là mức sàn, không phải mức trần.

### 1. Bắt đầu bằng câu hỏi, không bằng định nghĩa

Đây là luật số một, và nó là thứ tách một chương khỏi một mục từ điển.

44/44 chương mở bằng đúng ba dòng: `ch-eyebrow` (định vị), `h1.ch-title`, và
`ch-lede`. Đoạn `ch-lede` **không tóm tắt chương** — nó nói vì sao chương tồn
tại. Ba ví dụ thật:

> "Trước khi có công thức, cần một câu hỏi đúng. Shannon không hỏi 'thông tin
> nghĩa là gì' — ông hỏi 'cần bao nhiêu ký hiệu nhị phân để bên nhận tái tạo
> được điều bên gửi muốn nói'. Đổi câu hỏi đó là toàn bộ cú nhảy." (Chương 0.1)

> "Đây là chương biến entropy từ 'một công thức' thành 'một sự thật về tổ hợp'."
> (Chương 1.8)

> "Giờ ta khai thác công thức. Mục tiêu: biết chính xác $H$ nằm ở đâu, biến
> thiên thế nào, và có hình dạng gì trên simplex — vì hầu hết trực giác sai về
> bất định đến từ việc chưa bao giờ nhìn thấy mặt cong của $H$." (Chương 1.2)

Chú ý dòng thứ ba: nó nói thẳng **lỗi sai mà chương này chữa**. Đó là dạng
`ch-lede` mạnh nhất.

**Phản ví dụ — đừng viết:** *"Chương này giới thiệu khái niệm entropy và các
tính chất cơ bản của nó."* Câu đó không nói người đọc thiếu gì.

### 2. Định nghĩa phải được **ép ra**, không được **tuyên bố**

Mẫu hình mạnh nhất trong giáo trình mẫu, và mẫu hình mà course do AI sinh hay bỏ
qua nhất. Chương 0.1 không nói "độ bất ngờ được định nghĩa là $-\log p$". Nó:

1. Đặt câu hỏi: gán cho mỗi biến cố một đại lượng "bất ngờ" phụ thuộc duy nhất
   vào $p$.
2. Nêu **ba đòi hỏi tự nhiên** người đọc gật đầu ngay: hiếm thì bất ngờ hơn;
   chắc chắn thì không bất ngờ; hai biến cố độc lập thì cộng được.
3. Rồi mới chứng minh rằng ba đòi hỏi đó **chỉ có một nghiệm**: $-c\log p$.
4. Rồi nói $c$ chỉ là chọn đơn vị (bit / nat / hartley).

Người đọc rời khỏi mục đó với cảm giác **họ có thể đã tự tìm ra công thức** —
đó là cảm giác cần nhắm tới. Với mỗi định nghĩa bạn định viết, hỏi: *đòi hỏi
nào ép ra chính dạng này chứ không phải dạng khác?* Nếu không trả lời được thì
bạn chưa hiểu đủ để dạy nó.

### 3. Bài tập **luôn** có lời giải

Đếm được: **202/202** bài tập trong giáo trình mẫu có `<details class="deriv">`
chứa lời giải. Một trăm phần trăm. Bài tập không lời giải là bài tập bỏ đi —
người tự học không có ai để hỏi.

Ba tính chất khác, cũng đếm được:

- **Có mức khó**, đánh bằng sao trong tiêu đề hộp: `Bài 1 · Hai mươi câu hỏi
  trên nguồn lệch · ★` cho tới `★★★★`. Đủ bốn mức trong cùng một chương là bình
  thường.
- **Chia câu (a)/(b)/(c)** — một bài dẫn người đọc qua ba bước, thay vì ba bài
  rời rạc.
- **Nối ngược vào chương.** Bài 1(c) của Chương 0.1 yêu cầu "đối chiếu với biên
  $[H(Y), H(Y)+1)$ **nêu trong chương**". Bài tập kiểm chứng một khẳng định vừa
  đọc, không phải một bài toán ở đâu rơi xuống.

Lời giải viết **đầy đủ**, không phải đáp số. Lời giải mẫu của Bài 1(b) không chỉ
đưa chiến lược hỏi mà còn giải thích vì sao nó tối ưu, và Bài 2(c) kết thúc bằng
một đoạn bình luận về ý nghĩa con số vừa tính. Đó là chỗ dạy nhiều nhất.

Số lượng: 3–5 bài mỗi chương là mức của giáo trình mẫu. Ít hơn 2 thì chương chưa
kiểm được gì.

### 4. Mô phỏng chỉ khi **phải nhìn mới hiểu**

58 hình trên 44 chương — trung bình 1,3, phần lớn chương có **một**, không chương
nào quá 3, và phụ lục có **không**. Hình là thứ chương phải **giành được**, không
phải thứ mặc định có.

Thử nghiệm để quyết: *bỏ hình này đi thì đoạn văn còn giải thích được không?*
Còn thì bỏ. Hình 0.1 (trò chơi hai mươi câu hỏi) tồn tại vì "chiến lược tối ưu
chia đôi **khối lượng xác suất**, không phải chia đôi **số phần tử**" là câu mà
đọc thì gật đầu, mà chơi thì mới tin.

Mỗi hình mang **bốn** phần chứ không chỉ một khung vẽ: `fig-num`, `fig-title`,
`fig-desc` (nói trước cần nhìn cái gì) và `fig-foot` (nói sau đã thấy được cái
gì). Phần `fig-foot` là phần đắt nhất và là phần hay bị bỏ:

> "Khi phân phối gần đều, mọi câu hỏi đều 'đắt' như nhau và ta cần
> $\approx\log_2 n$ câu. Khi phân phối lệch, một câu hỏi khéo có thể kết thúc trò
> chơi ngay — entropy tụt xuống tương ứng."

Hình không có `fig-foot` là hình chưa dạy gì.

**Bẫy chết người:** `<div data-viz="…"></div>` **chỉ chạy ở hạng `interactive`**
và chỉ khi `viz.js` của course định nghĩa đúng tên đó. Chép một thẻ `data-viz`
từ giáo trình mẫu sang course hạng `content` sẽ **qua được `tuhoc pack`** — nó
chỉ là một `<div>` rỗng — rồi hiện ra một ô trắng trong trình đọc. Bộ kiểm định
không bắt được lỗi này; chỉ bạn bắt được. Ở hạng `content`, hình là **SVG nội
tuyến** hoặc ảnh.

### 5. Nói ra chỗ người ta hay sai

Đếm được: 13 hộp `box warn` + 9 hộp `box pitfall`. Chúng không phải trang trí —
mỗi hộp là một lỗi thật, gọi tên thật. Ví dụ thật:

> **Cạm bẫy thường gặp** — "Một chuỗi bit ngẫu nhiên đều có entropy cực đại,
> nhưng chẳng 'nói' gì cả. […] Đại lượng $H$ đo **chi phí mô tả**, không đo
> **giá trị**."

Tiêu đề các hộp cảnh báo khác trong giáo trình mẫu — chú ý chúng cụ thể đến mức
nào: *"Perplexity phụ thuộc tokenizer — lỗi so sánh phổ biến"*, *"Điều kiện
KHÔNG luôn làm giảm mutual information"*, *"Thiên lệch độ dài — và vì sao 'chuẩn
hóa theo độ dài' không vô tội"*.

Một chương không có chỗ nào cảnh báo thì hoặc chủ đề quá nhạt, hoặc bạn chưa
dạy nó cho ai bao giờ.

### 6. Buộc chương vào phần còn lại của course

336 tham chiếu chéo dạng "Chương N.M" trên 44 chương; 43/44 chương có ít nhất
một. Cả hai chiều đều quan trọng:

- **Trả nợ về sau:** "Chương 2.2 sẽ nói con số đó nằm trong $[H(X), H(X)+1)$" —
  đặt một câu hỏi mà chương này chưa trả được, và hẹn chỗ trả.
- **Thu nợ đã vay:** "như Chương 1.6 (data-processing) sẽ cho biết chính xác ta
  được và mất gì khi làm vậy".

Course không có tham chiếu chéo là một tập bài giảng rời, không phải một giáo
trình. Nếu chương 3 của bạn không cần gì từ chương 1 thì hoặc thứ tự sai, hoặc
đó không phải một course.

### 7. Đóng chương bằng thứ mang đi được

43/44 chương kết bằng hộp `keyfacts` "Chốt chương": 4–5 gạch đầu dòng, mỗi dòng
là một **câu khẳng định** người đọc mang đi được, không phải một chủ đề đã bàn.

Đúng: "Ba tiên đề (giảm, $\iota(1)=0$, cộng tính) ép độ bất ngờ phải là
$-c\log p$."
Sai: "Chúng ta đã tìm hiểu về các tiên đề của độ bất ngờ."

### 8. Độ sâu là bắt buộc, độ dài thì không

Trung bình 24 KB HTML, 4,7 mục `<h2>` mỗi chương. Nhưng thứ tạo ra độ sâu không
phải số chữ — mà là **255 khối `details.deriv`**: chứng minh đầy đủ, gấp lại
được. Giáo trình mẫu không bao giờ nói "có thể chứng minh được rằng…" rồi đi
tiếp. Nó bỏ chứng minh vào khối gập, viết trọn, và người đọc chọn có mở hay
không.

Đó là cách giải quyết mâu thuẫn giữa "đừng làm người mới ngợp" và "đừng nói dối
người giỏi": **viết cả hai tầng, để người đọc chọn tầng.**

Chương 0.1 còn đi xa hơn — Bài 3 yêu cầu chứng minh lại Mệnh đề 0.1 với giả
thiết yếu hơn (đo được thay vì đơn điệu), rồi giải thích vì sao **không có** giả
thiết đó thì kết luận sai. Chương thừa nhận điều kiện kỹ thuật của chính nó thay
vì giấu đi.

---

## Bộ khung một chương

Sao chép bộ này. Tên lớp CSS là bộ trình đọc đã có sẵn
(`packages/course-kit/reader.css`); dùng đúng chúng thì chương của bạn trông
giống phần còn lại của nền tảng, kể cả ở chế độ tối và khi in.

```html
<div class="ch-eyebrow">Phần I · Đếm — Chương 1.2</div>
<h1 class="ch-title">Vì sao hoán vị lại là giai thừa</h1>
<p class="ch-lede">Một câu nói chương này chữa hiểu lầm nào, hoặc trả lời câu
hỏi nào mà chương trước để ngỏ. KHÔNG tóm tắt nội dung.</p>

<h2 id="cau-hoi">Câu hỏi</h2>
<p>Đặt vấn đề bằng một tình huống cụ thể chưa giải thích được.</p>

<h2 id="doi-hoi">Ta muốn đại lượng này thoả gì</h2>
<ol><li>Đòi hỏi 1…</li><li>Đòi hỏi 2…</li></ol>

<div class="box thm"><div class="box-h">Mệnh đề 1.2</div>
<p>Ba đòi hỏi trên ép công thức phải là …</p></div>

<details class="deriv"><summary>Chứng minh</summary><div class="deriv-body">
<p>Chứng minh đầy đủ. Không viết "dễ thấy rằng".</p>
</div></details>

<div class="box intu"><div class="box-h">Đọc công thức này thế nào</div>
<p>Diễn giải bằng lời, không bằng ký hiệu.</p></div>

<div class="fig">
  <div class="fig-head">
    <div class="fig-num">Hình 1.1</div>
    <div class="fig-title">Tên hình</div>
    <p class="fig-desc">Cần nhìn cái gì ở đây.</p>
  </div>
  <div class="fig-body"><svg viewBox="0 0 640 320">…</svg></div>
  <div class="fig-foot">Đã thấy được cái gì, và nó nghĩa là gì.</div>
</div>

<div class="box warn"><div class="box-h">Chỗ hay sai</div>
<p>Một hiểu lầm cụ thể, gọi tên.</p></div>

<div class="keyfacts"><div class="box-h">Chốt chương</div>
<ul><li>Câu khẳng định mang đi được.</li></ul></div>

<h2 id="bai-tap">Bài tập</h2>
<div class="box ex"><div class="box-h">Bài 1 · Tên bài · ★</div>
<p>(a) …</p><p>(b) …</p>
<details class="deriv"><summary>Lời giải</summary><div class="deriv-body">
<p><b>(a)</b> Lời giải đầy đủ, kèm vì sao.</p>
</div></details>
</div>
```

Bộ lớp đầy đủ: `box def` (định nghĩa) · `box thm` (định lý) · `box prf` (chứng
minh trong dòng) · `box intu` (trực giác) · `box ex` (ví dụ **và** bài tập) ·
`box warn` (dễ hiểu sai) · `box pitfall` (lỗi thật, nặng hơn `warn`) · `box res`
(neo về ứng dụng/nghiên cứu) · `keyfacts` · `details.deriv` + `.deriv-body` ·
`div.tbl-wrap` + `table.tbl` · `fig` và họ hàng · `small` · `muted` · `tag` ·
`grid2` · `qed`.

Đặt `id` cho **mọi** `<h2>`.

---

## Hai hạng: quyết định an ninh, không phải phân loại nội dung

| | `content` | `interactive` |
|---|---|---|
| Mang được | HTML, CSS, ảnh, SVG, KaTeX | thêm JavaScript |
| Kiểm định | máy kiểm hết | máy **không** kiểm mã JS |
| Vào registry | CI xanh là merge gần như tự động | **chờ người đọc từng dòng JS** |
| Nhãn catalog | không | **hiện rõ** cho người sắp pull |

Course chạy trong **cùng trang** với ghi chú và phiên đăng nhập của người đọc —
không nhốt được vào iframe vì tính năng ghi chú lề cần truy cập DOM cùng tài
liệu. Nên hạng `content` là hạng duy nhất máy bảo đảm được.

**Mặc định là `content`.** Chọn `interactive` chỉ khi khái niệm **phải nhìn thấy
nó chuyển động mới hiểu** — người đọc vặn tham số, hình đổi theo. Không phải lý
do hợp lệ: hoạt hình trang trí; nút "hiện đáp án" (dùng `<details class="deriv">`);
biểu đồ tĩnh (dùng SVG nội tuyến).

**Nói thẳng hệ quả cho người đóng góp:** hạng `interactive` nghĩa là gói của bạn
nằm trong hàng chờ duyệt tay, do một người thật đọc. Mã ngắn, không minify,
không phụ thuộc bên ngoài thì duyệt nhanh. Một bundle đã minify thì có thể không
bao giờ được duyệt. Ai cần gói lên registry trong ngày thì phải ở `content`.

Bảy luật của hạng `content` và cách sửa từng cái: `docs/course-format.md` §4
và §10. Ba cái mà course do AI sinh hay vấp:

1. **`README.md` trong gói cũng bị quét.** Một ví dụ HTML trong khối mã của
   README làm cả gói trượt. Đừng dán mã HTML vào README, hoặc đừng đóng gói
   README.
2. **Ví dụ mã trong chương phải escape:** `&lt;script&gt;` — thứ bạn phải làm dù
   sao thì chương mới hiển thị được nó.
3. **Đừng đóng gói tệp `.md` nguồn cạnh HTML đã dựng.** Khối ```` ```html ````
   trong đó bị tính là đánh dấu thật, và escape **không** cứu được vì escape làm
   hỏng markdown. Chỉ đóng gói bản đã dựng.

---

## `lang` và `generatedBy` phải trung thực

Hai trường này không đổi hành vi nền tảng chút nào. Chúng chỉ đặt kỳ vọng cho
người **chưa** tải course về — nên khai sai là làm mất thời gian của người tin
mình.

- `lang` — ngôn ngữ của **nội dung chương**, không phải của tên course.
- `generatedBy` — `"ai"` nếu mô hình viết phần chữ; `"human"` nếu người viết;
  `"mixed"` nếu người dàn bài và sửa còn mô hình viết phần lớn văn bản.

**Nếu skill này đang được một agent dùng để sinh course thì giá trị đúng là
`"ai"`, hoặc `"mixed"` khi có người sửa thật.** Không bao giờ là `"human"`.
Course do AI sinh là chuyện bình thường ở đây và không bị phạt; khai gian mới bị.

Phân vân giữa `"mixed"` và `"human"` thì chọn `"mixed"`.

---

## Giấy phép: nội dung của bạn **không** bị AGPL hoá

Mã nguồn nền tảng theo AGPL-3.0. **Course của bạn thì không.** Mỗi course mang
giấy phép riêng trong `manifest.license` và bạn chọn nó. Gửi PR vào registry
không chuyển bản quyền và không ép giấy phép nào lên nội dung.

Nói điều này ra với người dùng khi họ hỏi về giấy phép — hiểu lầm ở chỗ này làm
người ta bỏ đi thay vì đóng góp. `CC-BY-4.0` là mặc định hợp lý cho tài liệu học.

Bản dịch là một **course riêng** (`id` riêng, `lang` riêng), nối về bản gốc bằng
`translationOf`. Không nhồi hai ngôn ngữ vào một gói.

---

## Danh sách tự kiểm trước khi báo cáo xong

Đi từng dòng. Cái nào không kiểm được bằng mắt thì đếm.

**Cổng cứng**

- [ ] `tuhoc pack <thư-mục>` đã chạy, và **mã thoát thô in ra là 0**.
- [ ] Mọi chương có mặt trong `manifest.parts` — số chương trong `parts` bằng số
      tệp trong `chapters/`.
- [ ] `tier` đúng với thứ trong gói; `generatedBy` trung thực; `license` đã điền
      thật, không còn giá trị mẫu.
- [ ] Không còn `{{id}}`, `{{title}}`, "Tên bạn", "Chương mẫu" sót lại từ khung.

**Chuẩn sư phạm**

- [ ] Mỗi chương mở bằng `ch-eyebrow` + `ch-title` + `ch-lede`, và `ch-lede`
      **nói vì sao**, không tóm tắt.
- [ ] Mỗi định nghĩa lớn được **ép ra** từ đòi hỏi, không tuyên bố suông.
- [ ] **Mọi** bài tập có `<details class="deriv">` chứa lời giải đầy đủ. Đếm:
      số hộp `box ex` mang tiêu đề "Bài …" phải bằng số lời giải.
- [ ] Bài tập có mức sao, và ít nhất một bài nối ngược vào khẳng định trong
      chương.
- [ ] Mỗi hình có `fig-desc` **và** `fig-foot`; hình nào bỏ đi mà đoạn văn vẫn
      giải thích được thì bỏ.
- [ ] Không có `data-viz` trong gói hạng `content`.
- [ ] Có ít nhất một chỗ gọi tên một hiểu lầm cụ thể (`box warn` / `box pitfall`).
- [ ] Có tham chiếu chéo giữa các chương, cả chiều hẹn trước lẫn chiều thu nợ.
- [ ] Mỗi chương đóng bằng `keyfacts` gồm những **câu khẳng định**.
- [ ] Mọi `<h2>` có `id`.

**Điều cuối, và nó là điều khó nhất**

- [ ] Đọc lại một chương từ đầu đến cuối như người chưa biết chủ đề. Chỗ nào bạn
      phải đọc hai lần, người học sẽ bỏ. Sửa chỗ đó rồi mới báo cáo xong.
