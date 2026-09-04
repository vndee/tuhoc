# Đặc san: một cấu trúc kể chuyện, nhiều thế giới hình ảnh

**Bản thiết kế đã được chủ sản phẩm duyệt ngày 04/09/2026.** Số mở màn là
**“Một lịch sử của trí tuệ nhân tạo”**: một bài kể song ngữ, 12 cảnh, đi từ
những công cụ đầu tiên giúp ý nghĩ sống ngoài cơ thể tới chân trời AGI còn
tranh luận.

Tài liệu này thiết kế **một hệ xuất bản tái sử dụng**, không chỉ một trang đơn
lẻ. Mỗi số dùng chung cấu trúc đọc, điều hướng, dữ liệu và chuẩn trợ năng;
nhưng có art direction riêng. Phần cá nhân hoá chưa xuất hiện trong nội dung
hay giao diện công khai của vòng này. Đó là hướng tương lai, không phải lời
hứa về tính năng đang có.

---

## Các quyết định đã chốt

| Câu hỏi | Quyết định |
|---|---|
| Hình thức | Một trang editorial công khai, tách khỏi trang khoá học và landing |
| Tên hệ nội dung | **Đặc san**; tiếng Anh: **Special Editions** |
| Trang bộ sưu tập | **Các số đặc san** tại `/stories` |
| Trang một số | `/stories/:slug`; số đầu dùng slug ổn định `a-history-of-ai` |
| Nhãn số | **Số 01 · Bài kể tương tác** / **Issue 01 · Interactive essay** |
| CTA | **Mở đặc san** / **Open the edition** |
| Vị trí trên landing | Sau danh mục khoá học, trước footer |
| Bố cục bài | Scrollytelling: sân khấu hình ảnh cố định ở desktop, chữ cuộn theo cảnh |
| Chuyển cảnh | Mỗi cảnh là một illustration riêng; hai plate hoà tan nhẹ; sợi vàng xuyên suốt |
| Mobile | Tranh và lab xếp thẳng trong dòng đọc; không giả lập sticky desktop |
| Cấu trúc số đầu | 4 hồi × 3 cảnh = **12 cảnh** |
| Độ sâu | Mỗi cảnh có câu chuyện con người, bản lề kỹ thuật, minh hoạ, nguồn và câu hỏi mở |
| Mật độ tương tác | **12 lab đầy đủ**, một lab cho mỗi cảnh |
| Ngôn ngữ | Đủ tiếng Việt và tiếng Anh ngay lần phát hành đầu |
| Phạm vi cá nhân hoá | Chưa làm và chưa nhắc trong copy; giữ làm hướng phát triển tương lai |

---

## 1. Vai trò của Đặc san trong sản phẩm

Trang khoá học trả lời: **“Tôi muốn học một môn, bắt đầu ở đâu?”** Đặc san trả
lời một câu khác: **“Tôi muốn hiểu một ý niệm lớn bằng cách đi qua câu chuyện
của nó.”** Nó là bằng chứng sống cho ba thế mạnh của Tự học:

1. Nội dung chi tiết nhưng không chỉ là những khối chữ dài.
2. Visualization cho phép người đọc tự tay thay đổi một ý niệm và quan sát hệ
   quả.
3. Lớp giải thích kỹ thuật đủ sâu để người tò mò có thể đi xa hơn câu chuyện
   chính.

Đặc san không thay CTA học khoá và không đứng trước danh mục. Landing vẫn ưu
tiên hành vi bắt đầu học; section Đặc san là lối khám phá thứ hai cho người đã
bị thuyết phục bởi sản phẩm.

**Không dùng các câu như “nội dung dành riêng cho bạn”, “lộ trình cá nhân”,
hay “AI tự điều chỉnh bài học” trong vòng này.** Dữ liệu và schema có thể mở
rộng về sau, nhưng giao diện chỉ nói điều sản phẩm thực sự giao được hôm nay.

---

## 2. Kiến trúc thông tin và route

### 2.1 Hai route công khai

| Route | Trách nhiệm |
|---|---|
| `/stories` | Trang **Các số đặc san**; chỉ hiện số đã phát hành |
| `/stories/:slug` | Trình đọc một số; hỗ trợ deep link tới `#scene-01` … `#scene-12` |

Cả hai route đều công khai và không bọc `RequireAuth`, cùng nguyên tắc với
catalog và reader công khai. Một slug không tồn tại trả trang “Không tìm thấy
số đặc san” với đường về `/stories`; không tự chuyển về landing làm người đọc
mất ngữ cảnh.

Slug không đổi khi chuyển ngôn ngữ. Hash cảnh cũng không đổi, nên một link
được chia sẻ mở đúng cảnh ở cả VI và EN.

### 2.2 Một chế độ shell riêng, không mượn sai nghĩa `authScreen`

`App` hiện luôn giữ bộ khung DOM của `Shell`. Thay vì dựng một cây gốc thứ hai,
thêm cờ độc lập `editorialScreen` cho `/stories` và mọi route con:

- giữ `#app > #main > #scroller > #content-wrap > #content` để không phá hợp
  đồng layout và test hiện có;
- ẩn app sidebar, topbar, progress bar và rail bằng lớp
  `#app.editorial-screen`;
- để `StoryShell` tự dựng masthead **Đặc san**, logo Tự học, quay lại bộ sưu
  tập, theme, language và tiến độ đọc;
- không tái sử dụng `authScreen`: editorial công khai nhưng không phải màn
  trước tài khoản, và hai khái niệm sẽ còn tiến hoá khác nhau.

`StoryShell` ở trong `main#content`, vì vậy lỗi của một issue vẫn nằm dưới
`ErrorBoundary` chung. IntersectionObserver và phép đo scroll phải dùng
`#scroller` làm root, không mặc định là `window`.

### 2.3 Trang “Các số đặc san”

Masthead: **Các số đặc san** / **All special editions**. Mỗi card có số, loại,
tiêu đề, deck, ảnh bìa, số cảnh và CTA. Với một hoặc hai số, dùng các featured
spread rộng xếp dọc; không dựng ô “sắp ra mắt” giả để lấp đầy lưới. Khi có từ
ba số trở lên, layout tự chuyển thành visual shelf.

Trang collection đọc metadata nhẹ từ `storyRegistry`; nó không tải nội dung,
12 illustration hay code lab của từng số.

---

## 3. Lối vào từ landing

Section mới đứng **sau danh mục khoá học và trước footer**, tách bằng một
đường kẻ tay mảnh. Cấu trúc là một featured spread:

- heading: **Đặc san** / **Special Editions**;
- link phụ: **Xem tất cả các số** / **View all editions** → `/stories`;
- ảnh bìa lớn ở một bên;
- bên còn lại: `Số 01 · Bài kể tương tác`, tiêu đề, deck, `12 cảnh`, CTA
  **Mở đặc san**;
- toàn card không biến thành một hit target khổng lồ: ảnh/tiêu đề và CTA có
  link rõ, focus ring rõ.

Copy số đầu:

> **Một lịch sử của trí tuệ nhân tạo**
>
> Từ khi ý nghĩ rời khỏi cơ thể, đến những cỗ máy học từ dữ liệu — và một
> chân trời chưa có tên chung.

> **A History of Artificial Intelligence**
>
> From the moment thought found a life outside the body to machines that
> learn from data — and a horizon we still cannot name together.

Landing chỉ import `storyRegistry` và thumbnail responsive. Route bundle của
landing không được kéo theo full copy, illustration cỡ lớn hay bất kỳ lab nào.

---

## 4. Ngữ pháp kể chuyện tái sử dụng

### 4.1 Cấu trúc cố định

Mỗi issue có:

1. **Cover** — một câu hỏi lớn, deck, số issue, số cảnh và số lab.
2. **Acts** — các hồi tạo nhịp và cho người đọc biết mình đang ở đâu.
3. **Scenes** — đơn vị kể chuyện và deep link nhỏ nhất.
4. **Coda** — không tổng kết giả; đặt lại câu hỏi sau hành trình.
5. **Sources & making-of** — toàn bộ nguồn, credit và provenance của hình.

Mỗi cảnh bắt buộc có năm lớp:

| Lớp | Hợp đồng nội dung |
|---|---|
| Human story | 120–180 từ mỗi ngôn ngữ; một tình thế, con người hoặc thể chế cụ thể |
| Technical hinge | Điều gì mới trở nên khả thi và vì sao; không chỉ gọi tên thuật ngữ |
| Illustration | Một plate, alt và caption song ngữ; được ghi rõ là minh hoạ |
| Lab | Một thao tác làm thay đổi điều người đọc quan sát hoặc kết luận |
| Evidence + open question | 2–4 nguồn liên quan và một câu hỏi không đóng giả sự bất định |

Hồi mở bằng một câu hỏi của con người, đi qua ba cảnh, rồi kết bằng hệ quả:
ai có thêm quyền năng, công việc nào xuất hiện/biến đổi, ai cung cấp dữ liệu
hoặc lao động, và câu hỏi đạo đức nào mới được tạo ra.

### 4.2 Những gì được phép đổi theo từng issue

Mỗi số tự định nghĩa:

- palette sáng/tối, texture, họa tiết, nét vẽ và typography display;
- hình dạng transition phụ, âm điệu caption và motif xuyên suốt;
- số hồi và số cảnh trong giới hạn renderer hỗ trợ;
- loại lab từ registry và config riêng;
- thumbnail, cover và treatment của nguồn tư liệu.

Mỗi số **không** được thay:

- vị trí/ý nghĩa của điều hướng, language và theme;
- cấu trúc heading, landmark, focus order và deep link;
- hợp đồng alt/caption/source/provenance;
- reduced-motion, keyboard và mobile fallback;
- giao diện giữa renderer với lab registry.

Nhờ vậy “tái sử dụng” không biến các bài sau thành cùng một template được đổi
màu, còn “art direction riêng” cũng không buộc viết lại cả trình đọc.

---

## 5. Art direction số 01: “Một lịch sử của trí tuệ nhân tạo”

Không sao chép tài sản hay bố cục của SynthWeave. Ta lấy ba nguyên tắc đã được
duyệt: **chất ấn phẩm**, **minh hoạ như bằng chứng kể chuyện**, và **khoảng
thở để một hình lớn dẫn nhịp**; rồi diễn giải trong thế giới hình hiện có của
Tự học.

### 5.1 Hệ hình ảnh

- Watercolour rửa mỏng + chì/than kỹ thuật trên nền giấy ấm.
- Con người, công cụ và hạ tầng cùng xuất hiện; không dùng hình “bộ não phát
  sáng” hay robot hình người chung chung.
- Sơ đồ kỹ thuật được vẽ như lớp chú giải trong sổ tay: chính xác về quan hệ,
  nhưng vẫn có độ rung tay.
- Một **sợi vàng** đi qua mọi plate. Nó không tượng trưng cho “tiến bộ tất
  yếu”; nó là đường truyền của câu hỏi: con người đang giao phần nào của tư
  duy cho vật chất?
- Bốn hồi đổi khí quyển: đất/đất sét → xanh xám cơ khí → than và hổ phách dữ
  liệu → xanh sâu với khoảng trắng chưa xác định ở AGI.
- Hình không chứa chữ nội dung quan trọng. Nhãn kỹ thuật thật là HTML/SVG để
  dịch được, zoom được và đọc được bằng công nghệ hỗ trợ.

### 5.2 Chuyển cảnh

Sân khấu dùng đúng hai layer ảnh. Khi scene active đổi, layer mới tải xong rồi
crossfade 280–420 ms; layer cũ mới được giải phóng sau transition. Sợi vàng và
UI lab nằm trên hai layer nên không nháy theo ảnh.

Không parallax liên tục, không pan vô hạn, không video nền. Với
`prefers-reduced-motion: reduce`, đổi ảnh tức thì và tắt mọi nét tự vẽ. Mobile
không crossfade giữa các vị trí scroll: mỗi plate đứng yên trong chính scene.

### 5.3 Tính trung thực của hình

Illustration không được trình bày như ảnh tư liệu. Caption mở đầu bằng
“Minh hoạ” / “Illustration” khi một cảnh có thể bị hiểu nhầm là mô tả chính
xác một sự kiện. Tư liệu lịch sử thật, nếu dùng, cần quyền sử dụng, credit,
nguồn và cách phân biệt thị giác với tranh do Tự học tạo.

Mỗi asset có `provenance.json`: tên tệp, prompt/direction, công cụ/model nếu
có, ngày tạo, chỉnh sửa thủ công, license/nguồn và scene sử dụng.

---

## 6. Storyboard số 01: 4 hồi, 12 cảnh, 12 lab

Đây không phải “lịch sử AI bắt đầu từ chữ viết”. Hồi I được gọi rõ là
**tiền sử của công cụ cho tư duy**: nền văn hoá-kỹ thuật giúp con người tưởng
tượng ra việc ký ức, phép tính và quy trình có thể sống ngoài một bộ não.
Từ Hồi II mới đi vào lịch sử của lĩnh vực AI theo nghĩa hiện đại.

### Hồi I · Ngoại hoá tư duy

**Câu hỏi mở hồi:** *Một ý nghĩ có thể sống ở đâu ngoài một con người?*

| # | Cảnh và lớp con người/kỹ thuật | Lab đầy đủ |
|---|---|---|
| 01 | **Dấu vết và trí nhớ chung.** Từ ký hiệu và bảng đất sét tới trí nhớ có thể truyền giữa người lạ; phân biệt ký ức sống với bản ghi bền. | Người đọc tạo một chuỗi dấu rồi kéo qua các thế hệ. Hai mô hình “truyền miệng” và “ký hiệu” tích luỹ biến đổi/mất mát khác nhau; lab giải thích đây là mô hình minh hoạ, không phải phép đo lịch sử. |
| 02 | **Con số, bàn tính và máy cơ học.** Phép tính rời khỏi đầu óc để thành cử chỉ, vị trí và cơ cấu; công cụ mở rộng năng lực nhưng vẫn cần người vận hành. | Gẩy bàn tính để thực hiện cùng một phép cộng; bên cạnh là chuỗi trạng thái của thao tác. Chuyển sang cơ cấu bánh răng để thấy biểu diễn giữ nguyên còn cơ thể thực thi đổi khác. |
| 03 | **Logic, ký hiệu và chương trình.** Từ quy tắc hình thức tới ý tưởng một máy chung có thể chạy nhiều chuỗi chỉ dẫn; Babbage/Lovelace là một nút lịch sử, không phải huyền thoại “một thiên tài đơn độc”. | Sắp thẻ lệnh để một “máy giấy” tạo đúng mẫu. Đổi thứ tự cho thấy chương trình khác phần máy; một nhánh sai mở trace thay vì chỉ báo đỏ. |

### Hồi II · Máy biết suy luận?

**Câu hỏi mở hồi:** *Nếu một quy trình có thể chạy, phần nào của “suy nghĩ”
cũng có thể trở thành quy trình?*

| # | Cảnh và lớp con người/kỹ thuật | Lab đầy đủ |
|---|---|---|
| 04 | **Tính toán, thông tin và chiến tranh.** Logic, máy tính điện tử, mã hoá và chiến tranh hội tụ; ghi cả mục đích quân sự lẫn những người làm việc thường bị lịch sử bỏ quên. | Bước từng nhịp qua một máy Turing tối giản. Hai chương trình nhỏ cho thấy “đã dừng” và “vẫn chạy”; copy không tuyên bố lab giải được bài toán dừng tổng quát. |
| 05 | **Turing và phép thử bằng hội thoại.** “Imitation game” là một cách thay câu hỏi, không phải thước đo phổ quát chứng minh trí tuệ. | Đổi tiêu chí đánh giá—nhất quán, kiến thức, tự nhận thức, khả năng thuyết phục—và xem cùng một transcript nhận các phán đoán khác nhau. Không gọi kết quả là “điểm AI”. |
| 06 | **Dartmouth, symbolic AI và perceptron.** Một lĩnh vực được đặt tên giữa nhiều trường phái: luật/ký hiệu và học từ ví dụ không phải hai thời đại tách sạch. | Nửa đầu viết một luật phân loại; nửa sau kéo decision boundary của perceptron. Thêm điểm XOR để tự thấy giới hạn của một lớp tuyến tính và vì sao biểu diễn quan trọng. |

### Hồi III · Máy học từ dữ liệu

**Câu hỏi mở hồi:** *Điều gì xảy ra khi con người không thể viết hết mọi luật?*

| # | Cảnh và lớp con người/kỹ thuật | Lab đầy đủ |
|---|---|---|
| 07 | **Hệ chuyên gia và nút thắt tri thức.** Kiến thức miền hẹp tạo ra hệ hữu ích; việc lấy, duy trì và tranh luận về luật trở thành chính vấn đề. | Mở cây luật chẩn đoán giả lập, thêm một ngoại lệ rồi quan sát số nhánh cần sửa. Đây là bài toán đồ chơi, không đưa lời khuyên y tế. |
| 08 | **Backpropagation, xác suất và những “mùa đông”.** Học biểu diễn quay lại trong một hệ sinh thái không hề ngủ đông đồng đều; kỳ vọng, tài trợ và thuật ngữ thay đổi theo nơi. | Chọn learning rate và đi từng bước trên loss landscape. Một lớp timeline độc lập cho thấy kỳ vọng/tài trợ thay đổi; không vẽ một đường “AI winter” duy nhất như sự thật toàn cầu. |
| 09 | **GPU, ImageNet và deep learning.** Thành tựu là sự hội tụ của kiến trúc, dữ liệu, phần cứng, benchmark và lao động gắn nhãn—không phải khoảnh khắc máy “thức tỉnh”. | Kéo kernel convolution qua ảnh để sinh feature map, bật chế độ song song để so chuỗi phép tính. Lab nói rõ đây là trực giác, không mô phỏng hiệu năng GPU thật. |

### Hồi IV · Mô hình trong xã hội

**Câu hỏi mở hồi:** *Khi ngôn ngữ trở thành giao diện của máy, ai định hình
điều máy biết và điều nó được phép làm?*

| # | Cảnh và lớp con người/kỹ thuật | Lab đầy đủ |
|---|---|---|
| 10 | **Attention, Transformer và quy mô.** Context trở thành quan hệ giữa token; kiến trúc, compute và dữ liệu cùng thay đổi đường cong năng lực. | Focus/hover từng token để xem attention weight đổi. Một từ đa nghĩa trong hai câu cho thấy phân bố phụ thuộc ngữ cảnh; copy cảnh báo attention map không phải lời giải thích đầy đủ cho “vì sao model nghĩ vậy”. |
| 11 | **RLHF, dữ liệu, lao động và agent.** Model bước vào thiết chế qua người đánh giá, tool, quyền dữ liệu và điểm phê duyệt; tự động hoá vẫn có con người ở nhiều lớp. | Mở trace `model → tool → dữ liệu → đề xuất → người duyệt`. Bật/tắt quyền ở từng lớp để thấy hành động nào bị chặn; không cho lab gọi mạng hay thực thi tool thật. |
| 12 | **AGI: định nghĩa, quyền lực và chân trời.** Không có định nghĩa được chấp nhận phổ quát và không trình bày AGI như một mốc đã đạt; câu hỏi kết là ai được quyền đặt vạch đích và hệ quả của nó. | Đặt các định nghĩa lên ba trục **tính phổ quát / năng lực / quyền tự chủ**, so sánh điểm giống-khác. Không rút thành một con số, đồng hồ đếm ngược hay dự đoán ngày AGI. |

**Coda:** sợi vàng không đi vào một cánh cửa có chữ AGI. Nó quay lại bàn tay
người đọc và câu hỏi: *ta muốn giao điều gì cho máy, giữ điều gì như một trách
nhiệm của con người, và ai được tham gia quyết định?*

---

## 7. Cách đọc và tương tác

### 7.1 Desktop

Sau cover, trang chia hai cột:

- **sân khấu trái** sticky, chiếm khoảng 55–60% chiều rộng đọc;
- **narrative phải** chứa 12 scene; scene active có đường lề vàng và opacity
  đầy đủ;
- một navigator mỏng chia 4 hồi/12 tick; mỗi tick là anchor có nhãn trợ năng,
  không phải dot vô danh;
- header thu gọn sau cover, luôn giữ `Đặc san`, quay lại, `05 / 12`, language
  và theme.

IntersectionObserver kích hoạt scene khi vùng neo đi qua khoảng 45% chiều cao
`#scroller`. Chỉ một scene active. Khi đổi scene:

1. cập nhật heading/caption/sân khấu;
2. dùng `history.replaceState` cập nhật `#scene-05`, không tạo 12 mục trong
   lịch sử nút Back;
3. preload illustration của scene kế tiếp;
4. đóng **view** lab đang mở nhưng giữ state thao tác của lab đó trong bộ nhớ
   của phiên đọc.

Deep link ban đầu chờ layout và asset đầu ổn định rồi cuộn đúng scene. Nếu hash
không hợp lệ, mở cover/scene đầu và không thay URL cưỡng bức.

### 7.2 Lab trong sân khấu

Mỗi scene mở bằng illustration. Callout **Tự tay thử** / **Try the idea** trong
copy đưa lab của scene vào cùng sân khấu trái. Lab có:

- tên ý niệm, hướng dẫn một câu, trạng thái/kết quả bằng chữ;
- điều khiển chính;
- **Đặt lại** / **Reset**;
- **Trở lại tranh** / **Back to illustration**.

Không lab nào autoplay. Cuộn trang chỉ đổi cảnh, không tự kéo slider, chạy
mô phỏng hay phát âm thanh. Lab là lớp hiểu sâu: bỏ qua lab vẫn đọc được luận
điểm từ human story, technical hinge và caption.

State của từng lab độc lập với active scene và chỉ sống trong tab hiện tại.
Quay lại một scene cho phép tiếp tục thí nghiệm; `Reset` chỉ reset lab đó. Vòng
này không ghi tiến độ đọc hay lab state vào tài khoản/localStorage.

### 7.3 Mobile và màn hẹp

Tắt sticky. Mỗi scene trở thành:

1. nhãn hồi/cảnh;
2. illustration responsive;
3. human story;
4. technical hinge;
5. lab inline;
6. question + sources.

Hover có tap/focus tương đương. Drag có nút bước hoặc phím mũi tên tương
đương. Navigator 12 tick trở thành nút **Mục lục** mở drawer danh sách cảnh;
không thu nhỏ dot đến mức không chạm được.

---

## 8. Mô hình dữ liệu

Copy dài không đi vào catalog i18n toàn cục. Mỗi issue ở một thư mục độc lập,
lazy-loaded theo route:

```text
apps/web/src/stories/
  components/
    StoryIndex.tsx
    StoryRenderer.tsx
    StoryShell.tsx
    StoryScene.tsx
    StorySources.tsx
    StoryLabBoundary.tsx
  content/
    registry.ts
    a-history-of-ai/
      story.ts
      provenance.json
      assets/
  labs/
    registry.ts
    external-memory/
    embodied-calculation/
    executable-rules/
    computation-limits/
    judgment-criteria/
    linear-separator/
    knowledge-bottleneck/
    gradient-descent/
    convolution/
    attention/
    agent-trace/
    agi-definitions/
  types.ts
  validateStory.ts
```

Hình dạng chính:

```ts
type Locale = 'vi' | 'en';
type Localized<T = string> = Record<Locale, T>;

interface StoryRegistryEntry {
  slug: string;
  issueNumber: number;
  published: boolean;
  featured: boolean;
  title: Localized;
  deck: Localized;
  cover: ResponsiveImage;
  sceneCount: number;
  load: () => Promise<{ default: StoryDefinition }>;
}

interface StoryDefinition {
  meta: Omit<StoryRegistryEntry, 'load'>;
  theme: StoryTheme;
  acts: StoryAct[];
  scenes: StoryScene[];
  sources: SourceEntry[];
  coda: Localized<RichTextBlock[]>;
}

interface StoryScene {
  id: `scene-${string}`;
  actId: string;
  period: Localized;
  title: Localized;
  humanStory: Localized<RichTextBlock[]>;
  technicalHinge: Localized<RichTextBlock[]>;
  illustration: StoryIllustration;
  lab: LabDefinition;
  labFallback: LabFallback;
  sourceIds: string[];
  openQuestion: Localized;
}
```

`RichTextBlock` là union đóng (`paragraph`, `emphasis`, `list`, `termLink`),
không phải HTML tuỳ ý và không dùng `dangerouslySetInnerHTML`.

`LabDefinition` là discriminated union theo `kind`; mỗi `kind` có config typed
riêng. `LabRegistry` ánh xạ `kind` sang dynamic import. Story content chỉ giữ
dữ liệu, không import React component, nên renderer và nội dung không phụ
thuộc vòng vào nhau.

`validateStory` chạy trong test/build và chặn:

- thiếu VI hoặc EN ở bất kỳ trường bắt buộc nào;
- scene/source id trùng hoặc source id không tồn tại;
- scene trỏ tới lab kind không có trong registry;
- scene count trong metadata lệch dữ liệu thật;
- ảnh thiếu width/height, alt, caption hoặc provenance;
- lab thiếu fallback diagram hoặc giải thích song ngữ;
- issue featured nhưng chưa `published`.

Không dùng computed dynamic import từ slug tuỳ ý. `registry.ts` chứa mapping
tĩnh để Vite tách chunk và để slug không thể trở thành đường dẫn file.

---

## 9. Nguồn và chuẩn biên tập

### 9.1 Source record

```ts
interface SourceEntry {
  id: string;
  kind: 'paper' | 'archive' | 'artifact' | 'report';
  title: string;
  authorsOrInstitution: string;
  year: string;
  url: string;
  accessedAt: string;
  note: Localized;
}
```

Cuối mỗi scene có nút **Nguồn cho cảnh này** / **Sources for this scene** mở
một disclosure inline, không phải modal chặn luồng đọc. Cuối issue có danh
mục nguồn đầy đủ. Nguồn được đặt cạnh claim nó hỗ trợ; không có quote trang
trí hoặc trích dẫn không liên quan.

### 9.2 Hạt giống nguồn cho số 01

Danh sách dưới là điểm bắt đầu đã được kiểm tra để viết bản thảo; nó không cho
phép người viết bỏ qua fact-check từng claim:

- The Metropolitan Museum of Art, [The Origins of Writing](https://www.metmuseum.org/essays/the-origins-of-writing).
- Computer History Museum, [A Brief History of Babbage's Engines](https://www.computerhistory.org/babbage/history/) và [Ada Lovelace](https://www.computerhistory.org/babbage/adalovelace).
- Alan Turing, 1950, [“Computing Machinery and Intelligence” — Turing Digital Archive](https://turingarchive.kings.cam.ac.uk/publications-lectures-and-talks-amtb/amt-b-9).
- McCarthy, Minsky, Rochester & Shannon, 1955, [Dartmouth proposal](https://www-formal.stanford.edu/jmc/history/dartmouth/dartmouth.html).
- Frank Rosenblatt, 1958, [“The Perceptron”](https://homepages.math.uic.edu/~lreyzin/papers/rosenblatt58.pdf).
- Computer History Museum, [Edward Feigenbaum and DENDRAL](https://computerhistory.org/profile/edward-feigenbaum/) cùng oral-history material về expert systems; dùng để tránh kể “AI winter” như một khoảng trống đồng nhất.
- Rumelhart, Hinton & Williams, 1986, [“Learning representations by back-propagating errors”](https://www.nature.com/articles/323533a0).
- Krizhevsky, Sutskever & Hinton, 2012, [“ImageNet Classification with Deep Convolutional Neural Networks”](https://papers.nips.cc/paper_files/paper/2012/hash/c399862d3b9d6b76c8436e924a68c45b-Abstract.html).
- Vaswani et al., 2017, [“Attention Is All You Need”](https://arxiv.org/abs/1706.03762).
- Ouyang et al., 2022, [“Training language models to follow instructions with human feedback”](https://arxiv.org/abs/2203.02155).
- Stanford HAI, [AI Index Report 2026](https://hai.stanford.edu/ai-index/2026-ai-index-report), dùng để đặt hiện trạng năng lực, hạ tầng, lao động và quản trị vào đúng mốc xuất bản; cùng glossary [“What is AGI?”](https://hai.stanford.edu/ai-definitions/what-is-agi-artificial-general-intelligence) cho nhận định có giới hạn rằng chưa có phép thử AGI được chấp nhận phổ quát.

### 9.3 Quy tắc biên tập bắt buộc

- Không kể lịch sử kiểu “great men”: đưa người gắn nhãn, người vận hành, tổ
  chức, nguồn tài trợ, chiến tranh và điều kiện vật chất vào causal story.
- Không gọi một demo là bằng chứng về ý thức, hiểu biết hay AGI.
- Không biến attention weight thành lời giải thích nội tâm của model.
- Không dùng “AI winter” như một sự im lặng toàn cầu; nói rõ lĩnh vực, nơi và
  loại tài trợ khi có claim cụ thể.
- Không nối các mốc bằng giọng “tất yếu dẫn đến hôm nay”. Các nhánh thất bại,
  tranh luận và khả năng lịch sử khác phải còn nhìn thấy.
- Bản VI và EN là hai bản biên tập tương đương về ý, không dịch máy từng câu.
  Tên paper/hiện vật giữ nguyên và có giải thích khi cần.

---

## 10. Hiệu năng, tải lỗi và khả năng phục hồi

### 10.1 Ngân sách tải

- `/stories` và landing chỉ tải metadata + thumbnail.
- Route issue, từng lab và asset từng scene là chunk riêng hoặc lazy asset.
- Cover/scene đầu có ảnh responsive và được ưu tiên; chỉ preload scene kế.
- Desktop chỉ decode hai plate cần cho crossfade; không đưa cả 12 ảnh full-size
  vào sân khấu cùng lúc.
- Mobile dùng `loading="lazy"` cho scene sau màn đầu và luôn khai báo
  `width`/`height` để không nhảy layout.
- Illustration ưu tiên WebP/AVIF responsive; asset budget ban đầu: cover dưới
  250 KB ở kích thước LCP và mỗi scene dưới 320 KB ở breakpoint desktop.
- Không thêm animation library nếu CSS + Web Animations API đủ cho crossfade.
  Lab có thể dùng SVG/Canvas riêng nhưng không kéo một chart framework chung
  vào mọi scene.

### 10.2 Lỗi cục bộ

- Mỗi lab nằm trong `StoryLabBoundary`. Chunk hoặc runtime lab lỗi thì chỉ lab
  đó rơi về static annotated diagram + phần giải thích; câu chuyện vẫn đọc.
- Ảnh lỗi thì giữ đúng aspect ratio, texture nền, caption và một dòng
  “Minh hoạ không tải được”; không làm cột chữ nhảy sang trái.
- Một nguồn ngoài không truy cập được không chặn render; link và metadata vẫn
  hiện để người đọc nhận diện nguồn.
- Locale thiếu có fallback VI ở runtime để trang không trắng, nhưng validator
  phải khiến build/test thất bại trước khi tình huống ấy được phát hành.

---

## 11. Trợ năng

- Các landmark theo thứ tự: story header → act/scene navigation → article →
  sources/footer.
- Mỗi scene là `section` có heading thật; active state không chỉ biểu đạt bằng
  màu.
- Navigator dùng anchor/button có nhãn cảnh; focus không tự nhảy khi scroll.
- Chuyển scene không phát live-region liên tục. Chỉ hành động trực tiếp trong
  lab mới thông báo kết quả cần thiết qua vùng `aria-live="polite"`.
- Mọi SVG có title/description khi mang thông tin; hình trang trí là
  `aria-hidden`.
- Mọi lab dùng được bằng bàn phím. Slider dùng input semantics và hiển thị giá
  trị bằng chữ; drag có nút bước; hover có focus/tap.
- Target chạm tối thiểu 44 × 44 CSS px; focus ring không bị texture che.
- Độ tương phản text/control đạt WCAG AA ở cả light và dark theme. Không đảo
  màu illustration trong dark mode; plate giấy giữ nguyên, nền quanh plate và
  control đổi token tương phản.
- `prefers-reduced-motion` làm transition tức thời. Trạng thái zoom chữ 200%
  không tạo cuộn ngang ở narrative/lab.
- Lab chỉ tăng hiểu biết. Static text và caption luôn mang đủ kết luận cốt lõi.

---

## 12. Kiểm chứng

### 12.1 Contract và nội dung

- `validateStory.test.ts`: VI/EN parity, id duy nhất, source tồn tại, lab kind
  tồn tại, count đúng, asset/provenance đủ.
- `registry.test.ts`: chỉ issue `published` hiện ở collection; đúng một issue
  featured; loader không bị gọi khi render landing/index.
- snapshot hoặc assertion semantic cho 4 hồi/12 scene của số 01; không snapshot
  nguyên prose dài.

### 12.2 Renderer

- deep link `#scene-05` mở/scroll đúng cảnh;
- observer đổi active scene và dùng `replaceState`, không làm dài browser
  history;
- crossfade chờ ảnh mới; reduced motion đổi tức thì;
- đổi VI/EN giữ slug, hash, active scene và lab state;
- mở lab, thao tác, đổi scene, quay lại, reset;
- lab lỗi và ảnh lỗi đều chỉ fallback cục bộ;
- invalid slug và invalid hash có đường phục hồi rõ.

### 12.3 Input và trợ năng

- đi hết navigation và cả 12 lab chỉ bằng keyboard;
- drag lab có nút/phím tương đương và screen reader đọc giá trị/kết quả;
- focus order không thay theo active scene tự động;
- disclosure nguồn có `aria-expanded` đúng;
- axe/semantic checks cho cover, một scene active, drawer mobile và lab lỗi.

### 12.4 Responsive và hiệu năng

- e2e ở desktop: sticky stage, scene activation, lab overlay, route/language;
- e2e ở mobile: không sticky, 12 plate/lab nằm đúng dòng, drawer scene hoạt
  động;
- visual regression light/dark và reduced motion ở ít nhất cover + scene 01 +
  scene 12;
- build report chứng minh landing không chứa issue/lab chunks;
- kiểm tra mạng chứng minh chỉ cover/scene đầu + scene kế được tải trước, không
  tải cả 12 lab khi mở issue;
- Lighthouse/budget check cho CLS từ ảnh và LCP cover trước khi phát hành.

---

## 13. Tiêu chí hoàn thành

Vòng triển khai chỉ được gọi là xong khi:

1. Landing có section **Đặc san** đúng vị trí, không thay CTA chính của khoá
   học và không tải bundle issue.
2. `/stories` hoạt động tốt khi chỉ có một số, không có card “sắp ra mắt” giả.
3. `/stories/a-history-of-ai` đọc công khai, deep-link được, đủ VI/EN.
4. Có đúng 4 hồi, 12 scene và 12 lab có nghĩa—không lab trang trí/autoplay.
5. Desktop là pinned scrollytelling; mobile là dòng đọc tự nhiên.
6. Theme, language, keyboard, reduced motion, image/lab fallback đều qua test.
7. Mọi claim lịch sử có nguồn; mọi illustration có alt/caption/provenance.
8. Cảnh AGI không tuyên bố thành tựu, không dự đoán ngày, không tạo một “điểm
   AGI” giả.
9. Không có copy công khai hứa cá nhân hoá trong vòng này.
10. Thêm issue thứ hai chỉ cần content/theme/assets/lab config mới, không fork
    `StoryRenderer` hay thay hợp đồng navigation/trợ năng.

---

## 14. Ngoài phạm vi

- Cá nhân hoá nội dung, lộ trình hoặc art theo người học.
- AI tutor nằm trong Đặc san; vòng này là nội dung authored và deterministic.
- CMS/admin để biên tập issue; issue được định nghĩa bằng typed source files.
- Lưu tiến độ đọc/lab state xuyên thiết bị hoặc gắn với tài khoản.
- Bình luận, rating, paywall, newsletter và thông báo số mới.
- Audio narration, video, WebGL/3D và simulation gọi mạng.
- Dự đoán AGI hoặc tuyên bố hệ thống hiện tại đã đạt AGI.
- SSR/prerender đầy đủ. Route vẫn phải đặt `document.title`, description,
  canonical và `lang`; nâng cấp hạ tầng discoverability là vòng riêng.
- Đưa prose của Đặc san vào app search hiện tại; collection và link trực tiếp
  là lối vào của vòng đầu.
