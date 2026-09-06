# Đặc san 02 — Một lời nói đi qua đại dương

**Across the Noise — bản thiết kế đã được chủ sản phẩm duyệt, 05/09/2026.**

Storyboard 4 hồi, 12 cảnh, 12 lab đã được chủ sản phẩm duyệt. Tài liệu này cụ thể hoá nội dung song ngữ, art direction, mô hình tương tác và điều kiện nghiệm thu. Chưa cho phép phát hành hay thay đổi production. Số 03 “Thế giới không có người chỉ huy” nằm ngoài phạm vi đợt này.

## 1. Hồ sơ tài liệu và phạm vi

- [Bản thảo nội dung Việt–Anh](2026-09-05-across-the-noise-copy.md): cover, hồi, 12 cảnh, câu hỏi mở và coda.
- [Đặc tả 12 lab](2026-09-05-across-the-noise-labs.md): thao tác, thuật toán, dữ liệu, phản hồi, giới hạn và ca kiểm chứng.
- Bản thiết kế này: quyết định chung, bản đồ illustration, tích hợp hệ hiện tại và tiêu chí phát hành.

Giữ shell, thứ tự điều hướng, theme, language, hash, mobile inline và lớp nguồn của hệ Đặc san hiện có. Không làm trình đọc thứ hai. Không tạo chatbot mới, tài khoản bắt buộc, gửi thông điệp thật, analytics nội dung người đọc, hoặc lời hứa cá nhân hoá.

Phạm vi hoàn thành ở bước thiết kế: ba tài liệu nhất quán để người dùng duyệt. Việc viết mã, sinh tranh, xuất asset và phát hành thuộc bước triển khai sau khi bản thiết kế được duyệt.

## 2. Quyết định biên tập

| Trường | Quyết định |
|---|---|
| Số | 02 |
| Slug ổn định | `across-the-noise` |
| Route dự kiến | `/stories/across-the-noise` |
| Tiêu đề VI | Một lời nói đi qua đại dương |
| Tiêu đề EN | Across the Noise |
| Hình thức | Bài kể tương tác / Interactive essay |
| Cấu trúc | 4 hồi × 3 cảnh; 12 lab riêng |
| Tranh | 1 cover + 12 illustration, mỗi tranh 2 kích cỡ |
| Điểm tựa | Cùng một thông điệp được thử dưới nhiều mô hình |
| Điểm ngoặt | Bỏ bớt bit để biểu diễn gọn; thêm bit có cấu trúc để chống lỗi |
| Kết | Đúng dữ liệu không đồng nghĩa với hiểu đúng con người |

Đây là hành trình qua các ý tưởng, không phải một bức điện thật đi qua mọi thời đại. UTF-8, mã Huffman và SECDED là thí nghiệm hiện đại; không đặt chúng vào máy điện báo năm 1844 hoặc cáp năm 1858.

**Ba cách tổ chức đã cân nhắc:**

1. Theo chân một thông điệp, xen tư liệu và thí nghiệm — chọn; có liên tục cảm xúc, vẫn cho phép deep link.
2. Thuần dòng thời gian các phát minh — thuận lịch sử nhưng trùng nhịp Số 01.
3. Bộ thử thách kỹ thuật độc lập — dễ dùng riêng nhưng làm yếu câu chuyện người gửi/người nhận.

Không yêu cầu làm xong lab trước mới được đọc tiếp. Kết quả không dùng làm điểm đánh giá năng lực người học.

### Phân biệt tư liệu, hư cấu và mô hình

- Đoạn “Hãy hình dung / Imagine” và các nhân vật không tên là tình huống biên tập hư cấu, không phải lời chứng lịch sử.
- Morse, Vail, Ellsworth và hiện vật cáp chỉ gắn với những chi tiết có nguồn. Không bịa lời thoại hoặc đời tư của người thật.
- Bản đồ địa hình, chi phí, mạch lọc và dữ liệu ngẫu nhiên đều ghi rõ mô hình giản lược. Không dùng các số tự đặt như số đo lịch sử.
- Nguồn phục vụ một phát biểu cụ thể; không đặt tên một nhà khoa học bên mọi khẳng định để tạo cảm giác có dẫn chứng.
- Chú thích bìa/cảnh luôn bắt đầu “Minh hoạ:” / “Illustration:”. Nhãn hư cấu/mô phỏng hiện ngay khi liên quan, không giấu trong footer.

## 3. Thông điệp dùng chung và vòng đời dữ liệu

### 3.1 Người đọc giữ quyền kiểm soát

Mẫu VI: “Mình đã đến nơi. Mọi chuyện vẫn ổn.”

Mẫu EN: “I have arrived. Everything is all right.”

Lần mở số chọn mẫu theo ngôn ngữ lúc đó. Đổi language chỉ đổi giao diện, không dịch hoặc thay thông điệp đã khởi tạo. Nút “Dùng câu mẫu / Use example message” mới thay nó bằng mẫu của ngôn ngữ hiện tại.

Thông điệp giữ trong bộ nhớ của lượt đọc, không gửi server, không ghi localStorage/sessionStorage, không đưa vào URL hoặc log. Copy rõ: “Câu này chỉ được xử lý trong trình duyệt. Tải lại trang hoặc rời đặc san sẽ đặt lại lượt thử.” / “This message is processed only in your browser. Reloading or leaving the edition resets this experiment.” Theme/language vẫn giữ cơ chế lưu hiện có, độc lập với nội dung thông điệp.

Giới hạn 120 cụm ký tự người dùng nhìn thấy và 1.024 byte UTF-8; hiển thị cả hai bộ đếm. Dùng extended grapheme clusters, không cắt emoji hoặc dấu tiếng Việt. Không bỏ dấu, không tự chuẩn hoá NFC/NFD, không tự trim hay đổi xuống dòng. Giữ nguyên chuỗi đã được trình duyệt nhập. Chuỗi rỗng/toàn whitespace, Unicode không hợp lệ hoặc vượt giới hạn không được commit; giữ bản nháp để sửa. Kiểm tra whitespace không làm thay đổi khoảng trắng của một câu hợp lệ. Copy lỗi empty: “Nhập một câu hoặc dùng câu mẫu.” / “Enter a message or use the example.” Không chặn giữa một phiên gõ IME. Dữ liệu luôn render như text, không qua HTML/Markdown parser.

### 3.2 Các trạng thái cần có

| Trạng thái | Ý nghĩa |
|---|---|
| `messageText` | Thông điệp gốc đang dùng; chuỗi UTF-8 round-trip phải khớp chính xác |
| `messageRevision` | Tăng khi người đọc xác nhận đổi thông điệp |
| `draftText` | Chỉnh sửa chưa commit; không ảnh hưởng kết quả cũ |
| `shortenedDraft` | Bản rút lời của cảnh 01, không ghi đè thông điệp gốc |
| `experimentStateByScene` | Bảng mã, seed, nút chọn và kết quả riêng của từng lab |
| `deliveryReceipt` | Snapshot lần truyền ở cảnh 11: revision, nguyên văn, byte, cấu hình, kết quả |

Đổi thông điệp không âm thầm diễn giải lại kết quả cũ. Snapshot cũ giữ nguyên và có nhãn “Kết quả của câu trước / Result for the previous message”; không được dùng để tuyên bố câu mới đã đến nơi. Mỗi lab phụ thuộc thông điệp có nút chạy lại với revision mới. “Đặt lại lab / Reset lab” chỉ đặt lại thí nghiệm hiện tại; “Bắt đầu lại lượt đọc / Start a new experiment” cần xác nhận vì xoá cả thông điệp và kết quả.

Reset cảnh 01 giữ original, chỉ đặt lại bản rút lời và budget; Reset cảnh 11 xoá deliveryReceipt cùng kết quả batch nhưng giữ original; Reset cảnh 12 chỉ xoá lựa chọn context/diễn giải. Sửa thông số kênh không sửa receipt đã lưu: lab 11 phải ghi “Kết quả của cấu hình trước / Result for previous settings” cho tới lần chạy mới. Cảnh 12 trình bày rõ cấu hình trong snapshot; không ghép control mới với kết quả cũ.

Đóng/mở lab, đổi theme, đổi ngôn ngữ hoặc hash không mất trạng thái. Rời route/reload đặt lại. Tài liệu và test phải phân biệt hai việc này.

### 3.3 Tái sử dụng, không tạo một pipeline lịch sử giả

- Cảnh 01, 06, 08, 09, 11, 12 dùng thông điệp thật của lượt đọc.
- Cảnh 05 có thể xem cửa sổ bit của thông điệp hoặc mẫu xen kẽ đã ghi nhãn.
- Cảnh 02 dùng bảng ký hiệu nhỏ; 03 dùng `ET`, `AET`, `BEAM`; 04 dùng địa hình giả lập; 07 dùng phân phối bốn ký hiệu; 10 dùng khối bốn bit. Đây là mẫu kiểm soát, không tự chuyển thông điệp tiếng Việt thành Latin.
- Cảnh 08 là round-trip nén riêng, có tính đủ bảng mã. Cảnh 11 cố ý truyền byte UTF-8 chưa nén qua mã kênh; không ngầm giả định bảng mã Huffman sống sót qua nhiễu.
- Cảnh 12 chỉ đọc receipt còn đúng revision từ cảnh 11. Chưa chạy hoặc receipt cũ thì nói rõ, có đường đến cảnh 11. Ví dụ tĩnh luôn mang nhãn ví dụ, không đóng giả kết quả của người đọc.

## 4. Ngôn ngữ hình ảnh

**Art direction: atlas hàng hải gặp sổ tay của người vận hành.** Màu nước loãng, chì graphite, nét khắc mảnh, giấy can và hình cắt lớp. Cơ thể, dụng cụ và hạ tầng có trọng lượng vật chất; không dùng “bit bay”, não phát sáng hay robot chung chung.

| Vai trò | Light | Dark |
|---|---|---|
| Paper | `#F3EEE2` | `#15252C` |
| Ink | `#24383D` | `#ECE7DB` |
| Muted ink | `#56666A` | `#B1C2C4` |
| Accent | `#95603B` | `#D6AB75` |
| Stage | `#E1E5DE` | `#1D343B` |

Đây là token đề xuất, không phải chứng nhận contrast; phải đo trên bản render khi triển khai. Text thường ≥4.5:1, chữ lớn và thành phần cần nhận biết ≥3:1. Lỗi/sửa được cần icon và câu chữ, không chỉ xanh/đỏ.

Body dùng font đọc hiện có; display của trang số có thể dùng Charis SIL đã có trong dự án. Phần giới thiệu trên landing tiếp tục kế thừa Shantell, cỡ 22–28px, `text-wrap: wrap`, không áp font display của issue lên landing. Tranh không bake chữ, số liệu, sơ đồ giải thuật hay nhãn dịch vào raster.

Không có sợi chỉ trang trí xuyên suốt. Cáp chỉ xuất hiện khi là vật thể được kể. Không đường nối trang trí trong visualization. Dấu hiệu liên tục là tờ thông điệp, bàn tay và ánh sáng, không phải một nét vẽ kéo qua 12 cảnh.

### 4.1 Bản đồ 13 illustration

| Plate | Brief hình ảnh | Thay đổi nhịp / điều phải tránh |
|---|---|---|
| Cover | Bàn viết sát cửa sổ nhìn ra cảng, tàu nhỏ trong sương, mặt giấy để trống | Không viết chữ vào tranh; không minh hoạ trọn sơ đồ truyền tin |
| 01 | Hai căn phòng ở hai bờ, bố cục diptych; một người viết, một người chờ | Không mượn chân dung người thật; cùng tờ giấy sẽ trở lại ở 12 |
| 02 | Hai người đối chiếu bảng ký hiệu, cuộn giấy và dụng cụ ghi dấu | Nhãn ký hiệu thật do SVG/HTML đảm nhiệm |
| 03 | Cận cảnh bàn tay bên cần điện báo, các đoạn giấy cách nhau trên bàn | Tĩnh, tập trung khoảng cách; không bắt buộc âm thanh |
| 04 | Boong tàu, công nhân bên bể chứa cáp, biển chiếm phần lớn khung hình | Có lao động tập thể; không một thiên tài đứng thống trị bức tranh |
| 05 | Máy đo ở trạm bờ và mảnh cáp cắt lớp, người quan sát nhỏ ở mép | Đường waveform thuộc lab, không in sai vật lý vào tranh |
| 06 | Hai mặt bàn đo song song, người vận hành ghi lại kết quả khác nhau | Tránh vẽ nhiễu như một sinh vật/kẻ phá hoại có ý chí |
| 07 | Thẻ ký hiệu được đếm và xếp, bàn làm việc có bảng kiểm | Không vẽ người dùng có khả năng “đọc suy nghĩ” từ xác suất |
| 08 | Giấy can, thẻ và nhánh sắp xếp bằng vật thể trên bàn | Cây Huffman chính xác chỉ xuất hiện trong lab SVG |
| 09 | Ba dải bản sao cùng một nhóm thông tin, vết đánh dấu khác nhau | Bản sao không biến thành ba kênh vật lý độc lập trong nội dung |
| 10 | Các lớp giấy can soi lên một tấm thẻ dưới ánh đèn | Không giả ảnh tư liệu Hamming; đây là ẩn dụ kiểm tra chéo |
| 11 | Ba cấu hình dụng cụ và sổ ngân sách trên bàn kỹ sư | Không vẽ “Shannon limit” như rào cản vật lý ngoài biển |
| 12 | Căn phòng chờ của cảnh 01 nhìn từ phía người nhận, giấy đặt xuống bàn | Ánh sáng ấm hơn; không gán cảm xúc cụ thể cho thông điệp riêng |

Mỗi plate có alt và caption VI/EN; brief không phải provenance. Khi sinh ảnh mới ghi tool/model/thời điểm/prompt/edit/hash thật. Không điền sẵn provenance chưa xảy ra. 1536×1024 và 768×512; cover lớn ≤250KB, scene lớn ≤320KB, biến thể nhỏ mục tiêu ≤100KB. Xác minh từng file, không dùng cùng ảnh đổi crop làm nhiều cảnh.

### 4.2 Lab là bàn thử riêng

Desktop dùng stage opaque thay illustration và caption khi mở lab, giữ xử lý back/scroll đã sửa ở PR #9. Mobile xếp lab inline theo scene. Không phủ control lên tranh, không làm mất chỗ đọc khi lab dài. Illustration lỗi tải không làm mất nội dung hoặc lab. Lab lỗi tải có hướng dẫn, ví dụ tĩnh, thử lại và trở về tranh.

Chuyển cảnh theo scroll chỉ crossfade hiện có; không thêm parallax hoặc âm nền. Reduced motion loại bỏ chuyển động không thiết yếu. Nút Play/Step chủ động điều khiển mọi mô phỏng.

## 5. Tích hợp hệ hiện tại

Cơ sở đã kiểm tra: `origin/main` tại `1379d2d`, cùng tree với bản Đặc san đã phát hành. `StoryDefinition` hiện dùng lab union riêng, `labRegistry` lazy-load từng module, `StoryRendererContent` giữ state theo scene; chưa có shared message session.

### 5.1 Phân chia trách nhiệm

- `content/across-the-noise/meta.ts`, `cover.ts`: metadata nhỏ; không kéo engine hay toàn bài vào landing.
- `story.ts`, `sources.ts`, `copy.ts`, `assets.ts`, `provenance.json`: nội dung và dữ liệu issue, lazy khi vào route.
- `labs/<kind>/model.ts`: hàm thuần với input kiểm tra được; không DOM, React, mạng hoặc đồng hồ thực.
- `labs/<kind>/<Name>Lab.tsx`: tương tác, SVG/bảng đọc được, localized feedback, chạy hàm thuần.
- `labs/communication/`: chỉ chia sẻ UTF-8/bit, seed, noise, repetition, SECDED; Huffman riêng để lab khác không tải nén.
- `StoryIssueSessionProvider`: shared state của một issue, sống cùng route; không biến thành global user profile.

### 5.2 Mở rộng tối thiểu, có kiểm thử hồi quy

Thêm trường dữ liệu optional `interaction: { kind: 'message-journey'; examples: Localized<string> }` vào `StoryDefinition`, không vào metadata landing. `StoryRenderer` tạo provider keyed theo slug. Hook shared session chỉ được gọi trong các lab cần nó; issue không khai báo interaction nhận trạng thái null và giữ hành vi cũ. Không cần đổi signature callback `renderLab` hoặc chuyển 12 lab AI sang state mới.

Mở rộng discriminated union `LabDefinition`, config validators, registry và initial state với 12 kind mới (xem đặc tả lab). Không dùng `as any`, không nới validator bỏ qua unknown kind. Không dùng dynamic import glob kéo tất cả lab vào một chunk.

Lưu ý test hiện tại của Số 01 so sánh lab của riêng số đó với TOÀN registry. Khi thêm số, đổi assertion thành: Số 01 có đúng 12 kind đã định nghĩa cho nó và tất cả đều nằm trong registry. Không xoá việc kiểm tra số lượng hoặc coverage.

### 5.3 Collection và landing

Trong quá trình triển khai, metadata mới `published:false`, `featured:false`. Không hiện “sắp ra mắt” để lấp shelf. Khi được phép phát hành: Số 02 `published:true, featured:true`, Số 01 vẫn published nhưng `featured:false`; luôn đúng một featured. Không push hoặc deploy các cờ này trong bước thiết kế.

Route collection tiếp tục sort số mới trước, giữ Số 01. Route/slug/hash không đổi theo ngôn ngữ. CTA cuối số tìm `***REMOVED***` từ catalog thực; có thì link `/c/***REMOVED***`, không có hoặc API lỗi thì dùng `/courses`, không hứa một khoá không tồn tại.

## 6. Nguồn và phạm vi hỗ trợ

Các nguồn dưới đây được kiểm tra ngày 05/09/2026. Tư liệu phục vụ facts/thuật toán, không chứng minh các vignette hoặc hệ số mô hình do chúng ta thiết kế. Mỗi scene map 2–4 nguồn; ghi rõ nguồn hỗ trợ phần nào. Không sao chép dài, không dùng tranh tư liệu làm illustration mới khi chưa xử lý quyền sử dụng.

| ID | Nguồn trực tiếp | Phạm vi |
|---|---|---|
| `morse-tape` | [Library of Congress — băng điện báo 24/05/1844](https://www.loc.gov/item/mcc.019/) | Metadata tìm kiếm có nội dung; open trực tiếp lỗi trong lần kiểm tra. Vai trò Morse/Vail/Ellsworth, hiện vật; không tuyên bố đây là điện báo đầu tiên trên thế giới |
| `morse-archive` | [Library of Congress — Invention of the Telegraph](https://www.loc.gov/collections/samuel-morse-papers/articles-and-essays/collection-highlights/invention-of-the-telegraph/) | Tư liệu và tổ chức công việc quanh việc truyền/đọc mã |
| `itu-morse` | [ITU-R M.1677-1](https://www.itu.int/dms_pubrec/itu-r/rec/m/R-REC-M.1677-1-200910-I%21%21PDF-E.pdf) | Mã Morse quốc tế hiện đại, thời gian 1/3/7; không hồi chiếu chuẩn 2009 vào 1844 |
| `cable-history` | [Science Museum — Sending messages across the Atlantic](https://blog.sciencemuseum.org.uk/sending-messages-across-the-atlantic-156-years-on-from-the-first-transatlantic-cable/) | Nỗ lực 1858 và tuyến thành công 1866; không dùng chi phí lab như dữ kiện |
| `cable-object` | [Science Museum Group — deep-sea cable sample](https://collection.sciencemuseumgroup.org.uk/objects/co33448/sample-of-deep-sea-section-of-first-transatlantic-cable-1857-1858) | Vật liệu và cấu trúc hiện vật |
| `cable-workers` | [The Met — Dudley, reels at Greenwich](https://www.metmuseum.org/art/collection/search/383811) | Bối cảnh công xưởng và vật liệu để định hướng hình, không sao chép tác phẩm |
| `shannon-1948` | [Shannon — A Mathematical Theory of Communication](https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf) | Nguồn/kênh, entropy, lý thuyết mã, phạm vi tách khỏi ngữ nghĩa |
| `mit-isi` | [MIT 6.02 — LTI channel and intersymbol interference](https://ocw.mit.edu/courses/6-02-introduction-to-eecs-ii-digital-communication-systems-fall-2012/resources/mit6_02f12_lec11/) | Xung/kênh tuyến tính; mô hình một cực của lab là lựa chọn sư phạm |
| `huffman-1952` | [Huffman — Minimum-Redundancy Codes](https://www.cse.iitd.ac.in/~pkalra/siv864/huffman_1952.pdf) | Cây mã prefix tối ưu theo mô hình xác suất ký hiệu; không coi là nén tối ưu mọi dữ liệu |
| `hamming-1950` | [Hamming — Error Detecting and Error Correcting Codes](https://ineffectivetheory.com/edu/papers/hamming-codes-1950.pdf) | Bản scan bài gốc; cấu trúc kiểm tra lỗi |
| `mit-code` | [MIT 16.36 — Error-correcting codes](https://ocw.mit.edu/courses/16-36-communication-systems-engineering-spring-2009/a49d9e2954b440def3794fe73e79756c_MIT16_36s09_lec13_14.pdf) | Mô hình mã lặp và đánh đổi trong kênh |
| `ibm-repetition` | [IBM — Classical repetition codes](https://quantum.cloud.ibm.com/learning/en/courses/foundations-of-quantum-error-correction/correcting-quantum-errors/repetition-codes) | Phần CLASSICAL: kênh lật bit độc lập và biểu quyết; không đưa quantum vào số này |
| `mit-capacity` | [MIT 18.200 — Lecture 18](https://ocw.mit.edu/courses/18-200-principles-of-discrete-applied-mathematics-spring-2024/162Kg6KxXkKjTsu27kUKYXPyN86Sqc14s_transcript.pdf) | BSC, rate/capacity, tính tiệm cận |
| `unicode-segmentation` | [Unicode UAX #29](https://www.unicode.org/reports/tr29/) | Bộ đếm grapheme và ví dụ dấu/emoji; không đồng nhất ký tự với byte |
| `unicode-normalization` | [Unicode UAX #15](https://unicode.org/reports/tr15/) | Vì sao chuỗi nhìn tương đương không nhất thiết cùng byte; không âm thầm normalise |

## 7. Điều kiện nghiệm thu triển khai sau này

### Nội dung và thuật toán

- Đủ 12 cảnh VI/EN, 4 hồi, cover/coda, lab instruction, phản hồi, câu hỏi, nguồn, alt/caption và fallback.
- Human story mục tiêu 120–180 từ theo bộ đếm whitespace hiện tại; khoảng chấp nhận 120–210 để bản VI không bị cắt máy móc. Technical hinge ≥70 từ mỗi ngôn ngữ. Copy appendix ở bước này là bản thảo đầy đủ để duyệt, chưa phải payload xuất bản.
- 12 kind riêng đều có hàm thuần, ca chuẩn, boundary và input lỗi. SECDED kiểm chứng vét cạn; entropy và BSC đúng ở 0, 0.5, phân phối suy biến.
- Kiểm tra round-trip byte tiếng Việt có dấu, NFC/NFD, emoji, newline và dấu câu. Không thể hiện UTF-8 lỗi như thể nhận nguyên vẹn.
- Scene 12 không báo thành công khi chưa chạy hoặc receipt khác revision.

### Tương tác và quyền riêng tư

- Deep link bất kỳ scene hoạt động với mẫu mặc định. Không ép hoàn thành thứ tự.
- Theme, language, back và mở lại lab giữ input. Reload/route-away reset đúng copy; không nhầm với theme persistence.
- Không request chứa message, không URL/localStorage/sessionStorage chứa nội dung. Có test chặn fetch/console và kiểm tra storage khi gõ chuỗi nhận diện.
- Bàn phím hoàn thành được 12 lab; form có label, SVG có bản đọc tương đương, focus trở về nút mở khi đóng. Không announce mỗi frame hoặc từng bit trong mô phỏng.
- Mobile 320/390px không overflow; desktop 1024/1440px lab không chồng tranh/caption, nút back luôn tới được. Light/dark/reduced motion có smoke test.

### Hiệu năng và hồi quy

- Landing/collection không tải narrative hoặc engine của issue. Vào issue chỉ tải cover/cảnh gần đầu; lab chỉ tải khi mở.
- Giữ budget ảnh hiện tại; CLS mục tiêu ≤0.1. Batch mô phỏng phải nhường main thread, có Cancel và không tự chạy theo scroll.
- Số 01: 12 lab cũ, theme, language, điều hướng, caption và trạng thái vẫn đúng. Catalog, course reader và landing title không bị ảnh hưởng.
- CI typecheck, unit, build, bundle và E2E cần pass trên commit triển khai thực tế. Không dùng kết quả test của tài liệu làm bằng chứng lab mới đã chạy.

## 8. Chốt vòng thiết kế

Người dùng đã duyệt ba tài liệu. Bước tiếp theo là [kế hoạch triển khai](../plans/2026-09-05-across-the-noise.md), chia implementation thành module có test và điểm review tranh/copy. Chưa mở PR phát hành, chưa merge và chưa deploy. Mọi đổi lớn khỏi storyboard đã duyệt phải được nêu ra trước khi thực hiện.

## 9. Tự kiểm tra bản thiết kế — 05/09/2026

- Kiểm tra cấu trúc: 4 hồi, 12 cảnh, 12 kind riêng; human/technical copy VI–EN, câu hỏi, alt/caption và 12 fallback đều hiện diện. Các source ID và link tài liệu nội bộ hợp lệ.
- Đếm copy: human VI 144–161 từ, EN 128–138; technical VI 87–101, EN 78–90. Không dùng tiêu đề hoặc nguồn để bù số từ.
- Kiểm chứng độc lập bằng phép tính tạm: 592 trường hợp SECDED (0/1/2 lỗi), sample1011→01100110, header/padding Huffman của AAAA=96bit, route costs27/31/21, biên entropy/capacity. Đây là kiểm tra ví dụ đặc tả, không phải engine sản phẩm mới.
- Phát hiện và chốt edge case `-0` của entropy; empty input, reset receipt, default budget và word-gap sample được làm rõ trong vòng tự review.
- Contrast tính toán của ink/muted/accent trên paper đề xuất: light10.62/5.18/4.52; dark12.77/8.54/7.46. Chưa thay thế kiểm tra focus, disabled, stage và ảnh thực tế sau triển khai.
- Baseline trước khi sửa tài liệu: 3 file test registry/story/lab của hệ hiện có, 13 tests passed. Không có sửa app code hoặc test implementation mới trong nhánh tài liệu.
