# Product

<!-- impeccable:product-schema 1 -->

Ghi lúc `/impeccable init`, 2026-09-02. Nguồn: phỏng vấn chủ dự án (ba câu),
`README.md`, `docs/superpowers/specs/*`, bàn giao Pha 2/Pha 3. Mục nào là
**suy luận từ repo** chứ không phải lời chủ dự án được đánh dấu *(suy luận)*.

## Platform

web

## Users

**Người tự học nói chung** — công khai, người lạ có thể tới lần đầu qua một
đường dẫn. *(chủ dự án xác nhận)*

Tình huống: đọc giáo trình kỹ thuật dài (khoa học máy tính, toán — công thức
KaTeX, mô phỏng canvas, bài tập có ô đánh dấu), theo từng chương, quay lại
nhiều lần trong nhiều tuần, trên nhiều thiết bị. Việc họ đang làm: **hiểu một
chủ đề khó**, ghi lại chỗ mình mắc, và hỏi khi kẹt. *(suy luận từ spec gốc
2026-08-19 và định dạng gói v2)*

Đối tượng phụ, đã có trong mã nhưng chưa được chủ dự án xếp hạng: **tác giả
khoá học** (đóng gói bằng `tuhoc pack`, xuất bản bằng `tuhoc publish`) và
**người vận hành** (CMS `/admin`: khoá học, credit, bảng giá).

## Product Purpose

Một nơi để **đọc, ghi chú thẳng lên trang, và hỏi gia sư AI ngay trong bài** —
với tiến độ và ghi chú **đi theo người học trên mọi thiết bị, không có bước
đồng bộ nào** (máy chủ là nguồn sự thật duy nhất từ Pha 3).

Thành công là: người học quay lại, mở đúng chỗ đang dở, thấy ghi chú cũ của
mình đúng đoạn, và khi kẹt thì hỏi được một gia sư **biết họ đã đọc gì và đã
ghi gì**.

## Vision

Ghi 03/09/2026, từ lời chủ dự án: *"AI hỗ trợ đào sâu, personalize khoá học,
tôi tin đây là xu hướng mới của giáo dục."*

**Một cuốn sách hay là xương sống, không phải trần nhà.** Lớp học kế tiếp không
phải một khoá quay sẵn, cũng không phải một con bot trả lời hộ — mà là một cuốn
giáo trình mà ai đọc cũng đi sâu hơn theo đường của riêng mình: AI đọc đúng chỗ
người học đang mắc và đúng ghi chú họ vừa viết, rồi mở tiếp từ đó. Người học vẫn
là người làm việc; AI làm cho việc ấy đi xa hơn.

**Phần nào của tầm nhìn ĐÃ chạy, phần nào CHƯA** — ranh giới này là điều giữ cho
landing không hứa hụt:

- **Đã chạy:** gia sư đọc chương đang mở (`read_course`) và ghi chú của chính
  người học (`read_my_notes`, mặc định bật, có công bố), trả lời ngay trong bài;
  người dùng đặt được lời nhắc riêng cho agent ở `/settings`.
- **CHƯA chạy:** bản thân khoá học không đổi theo người học. Không có lộ trình
  thích ứng, không có nội dung sinh riêng, không có đo hiểu biết. "Personalize
  khoá học" hôm nay mới là *lời nhắc riêng + gia sư đọc ghi chú*, không hơn.

Landing từng in tầm nhìn này dưới nhãn **"Hướng đi"**, rồi chủ dự án gỡ nó
cùng ngày: trang chủ nay chỉ còn HÌNH VẼ nói ra tinh thần ấy, không còn câu
chữ. Tầm nhìn sống ở đây, không ở trang chủ. Nếu một lượt sửa lời sau này đưa
nó về, nó phải mang lại nhãn phân biệt — `pages/Landing.test.tsx` canh rằng
trang không lặng lẽ hứa những thứ ở mục "CHƯA chạy" bên trên.

**Quyết định 04/09/2026:** landing tạm thời không nói về personalization.
Các khoá hiện có được soạn riêng cho chủ dự án, nhưng đó chưa phải năng lực
sản phẩm công khai. Personalization vẫn là hướng phát triển tương lai; chỉ được
đưa lên landing khi có cơ chế chạy cho mọi người học và câu chữ phân biệt rõ
hiện tại với định hướng.

## Positioning

Chủ dự án chọn ba lời hứa phải giữ bằng mọi giá khi thiết kế lại:

1. **Ghi chú neo đúng đoạn văn + AI đọc được ghi chú.** Bôi đen là ghi thẳng
   lên trang; gia sư biết người học đang mắc ở đâu và đã ghi gì
   (`read_my_notes`, mặc định bật, có công bố).
2. **Khoá học là gói mở, ai cũng xuất bản được.** `tuhoc pack` + `publish`;
   giáo trình không bị giam trong nền tảng.
3. **Gia sư AI chạy trên máy chủ, trả bằng credit.** Không cần key riêng,
   không cài gì.

### Đọc là công khai — mâu thuẫn đã giải quyết 02/09/2026

Chủ dự án từng viết (02/09, phỏng vấn init): *"phải có tài khoản mới đọc được
do chúng ta phải lưu các notes, comments nữa."* Mã đang chạy nói ngược lại
(reader `/c/:courseId/:chapterId` công khai; spec pivot §9: *"ai cũng đọc được
mọi course, không cần đăng nhập"*).

**Quyết định, cùng ngày, khi làm landing page:** *"Đọc miễn phí không cần tài
khoản; tài khoản để ghi chú, tiến độ, gia sư AI."* Mã giữ nguyên; landing và
trang đăng nhập nói đúng câu ấy. Ghi chú và tiến độ cần tài khoản vì chúng
được lưu theo người; đọc thì không.

## Operating Context

- Đọc trên desktop và điện thoại (web responsive; **không** có app native — spec
  gốc loại trừ có chủ ý).
- Nội dung chương: HTML từ gói v2, công thức KaTeX, **widget tương tác chạy
  trong sandbox** (origin mờ, không cookie, không `allow-same-origin` — spec §8,
  e2e `widget.spec.ts` canh). Nhãn hạng `interactive` ("chạy mã trong trình
  duyệt") **luôn hiện trước khi người dùng kéo gói về** — đây là quyết định an
  ninh, không phải trang trí.
- Phiên đọc dài; **nhịp tim học tập** mỗi 30 giây ghi số phút thật vào `/stats`
  và lịch nhiệt ở `/progress`.
- Tác giả làm việc bằng tệp + CLI, không có trình soạn trong web. Người vận
  hành dùng CMS `/admin` với token admin.
- Song ngữ **vi/en** từ gốc: mọi chuỗi giao diện vào `packages/i18n` ở **cả hai**
  catalog; `t()` trả chuỗi, `tNode()` cho câu có thẻ giữa chừng.

## Capabilities and Constraints

**Có, đang chạy (sau Pha 3):**

- Reader: mục lục dạng ngăn kéo/cột, đánh dấu đã đọc, ô bài tập, highlight +
  chú lề neo đúng đoạn, cứu ghi chú mồ côi khi văn bản đổi, giao diện
  sáng/tối bằng công tắc tường minh (`html[data-theme]`, **không** theo
  `prefers-color-scheme`).
- Tiến độ: `/` là "học tiếp" (một hành động), `/progress` là nơi của con số,
  viết thành câu, kèm lịch nhiệt.
- AI: gia sư SSE trên máy chủ (DeepSeek), credit tặng lúc đăng ký
  (`signup_grant_micro`), ba tool (`read_course`, `read_my_notes`,
  `web_search` nếu có key), cấu hình agent theo người dùng ở `/settings`.
- Khoá học: gói v2, catalog công khai `GET /courses`, registry cộng đồng trên
  GitHub, đánh giá sao, thảo luận.
- Đặc san: `/stories` gồm `/stories/a-history-of-ai` và
  `/stories/across-the-noise`, mỗi số có 12 lab cùng bài kể song ngữ có nguồn,
  minh hoạ được gắn nhãn và tương tác cục bộ; số 02 được giới thiệu trên landing;
  không lưu tiến độ, không hứa cá nhân hoá.
- Ghi lạc quan có lùi: **một lỗi ghi phải được nói ra** (`role="alert"`),
  không nuốt.

**Ràng buộc kỹ thuật phải giữ:**

- Không đọc ngoại tuyến (Pha 3 gỡ có chủ ý — không service worker, không cache).
- Khoá học **riêng tư không có ô chấm sao** (`ratingFence.test.tsx`).
- Không chuỗi tiếng Việt trong mã Go (`i18n_server_speaks_codes_test.go`).
- CSS viết tay không nằm trong layer nào nên **thắng** utility Tailwind — chuyển
  màn nào thì phải xoá CSS cũ của màn ấy, không chồng lên.

**Chưa có / chưa chốt — không được làm như đã có:**

- **Thanh toán / mua credit** (Pha 4). Không có nút mua, không có giá bán.
- **Xác thực email**: chưa có; credit tặng theo tài khoản là đường farm đang mở.
- **Giá cụ thể** của credit: chưa chốt.
- **Tên sản phẩm và nhận diện**: xem Brand Commitments.
- **Đọc có cần tài khoản không**: xem Positioning.

- **Ghi chú chưa mở được "đúng đoạn" từ ngoài chương.** Ghi chú neo vào đoạn (anchor do reader đặt, mờ với phần còn lại của client), nhưng reader chưa cuộn tới một ghi chú theo URL/hash. Mọi liên kết tới ghi chú từ `/` hôm nay chỉ mở CHƯƠNG. Đây là khoảng trống của reader (ngoài phạm vi vòng 2026-09-02, theo yêu cầu giữ nguyên phần đọc), không phải của trang chủ.

- **"Ai cũng xuất bản được" chưa đúng trong sản phẩm.** Đường lên nền tảng hôm nay là `tuhoc pack` + `tuhoc publish` (CLI, cần `ADMIN_TOKEN`) hoặc trang `/admin` (cần tài khoản vai `admin`). Một tác giả thường không có cửa nào để tự xuất bản; không có hàng đợi duyệt, không có trang "khoá học của tôi". Đây là khoảng cách giữa lời hứa ở mục Positioning và mã (ghi 2026-09-02), chưa có quyết định.

## Brand Commitments

**Không có.** Chủ dự án xác nhận cả tên *"Tự học"* lẫn monogram hiện tại đều
là **chỗ giữ chỗ**, không ràng buộc. Việc đặt tên là **quyết định của chủ dự
án**, không phải của một lượt thiết kế — cho tới khi có tên, giao diện dùng
"Tự học" và không được tự bịa tên mới.

Giọng hiện có trong mã và tài liệu: **tiếng Việt trực tiếp, nói bằng câu, không
sáo**, giải thích *vì sao* chứ không chỉ *cái gì*. *(suy luận từ toàn bộ
i18n, README, và các bản bàn giao — chưa được chủ dự án gọi tên là ràng buộc)*

## Evidence on Hand

- **Một khoá học thật, format v2, xuất bản được:** `bat-bien-vong-lap` — 3 chương,
  tiếng Việt, có bài tập (`fixtures/courses/bat-bien-vong-lap/`).
- **Một giáo trình riêng 45 chương, 59 mô phỏng, 202 bài tập** của tác giả —
  **format v1, hiện KHÔNG publish được** (còn trường `tier` và JS rời); là bằng
  chứng về độ dày nội dung tương lai, không phải nội dung đang dùng được.
- Fixture `so-dau-phay-dong`: cũng v1, cũng không publish được.
- Bộ e2e 7 bài chạy trên stack thật; 1118 test đơn vị web.
- Đặc san công khai đầu tiên: **Một lịch sử của trí tuệ nhân tạo** / **A
  History of Artificial Intelligence** — 4 hồi, 12 cảnh và 12 lab xác định;
  đây là proof surface hiện tại, không phải một lời hứa về personalization.
- Đặc san số 02: **Một lời nói đi qua đại dương** / **Across the Noise** —
  4 hồi, 12 cảnh, 12 lab truyền thông và 13 minh hoạ gốc. Phạm vi kiểm chứng
  và giới hạn mô hình nằm trong [báo cáo phát hành](docs/superpowers/reports/2026-09-05-across-the-noise-review.md).
- **Không có:** người dùng thật ngoài chủ dự án, lời chứng thực, số liệu sử dụng,
  báo chí, giá, logo chính thức. **Không được bịa** bất kỳ thứ nào trong số này.

## Product Principles

1. **Máy chủ là nguồn sự thật duy nhất.** Cùng một tiến độ trên hai máy, không
   có bước đồng bộ; không có bản sao cục bộ nào phải hoà giải.
2. **Ghi chú sống trên đoạn văn, không tách khỏi bài đọc** — và gia sư AI đọc
   cùng ngữ cảnh mà người học đang có.
3. **Nói thật khi hỏng.** Một lần ghi thất bại thì lùi lại và nói ra; không nuốt
   im lặng, không nói dối bằng một trạng thái xanh.
4. **Giáo trình là gói mở.** Nền tảng phục vụ nội dung, không giam nó.
5. **Song ngữ và câu chữ rõ nghĩa là yêu cầu gốc**, không phải lớp sơn: một nhãn
   phải *nói ra nghĩa*, không bắt người ta học nghĩa của một màu.

## Accessibility & Inclusion

Yêu cầu đã xác lập: **song ngữ vi/en bắt buộc** cho mọi chuỗi giao diện. Chưa
có tiêu chuẩn tiếp cận nào khác được chủ dự án nêu; chưa có người dùng cụ thể
nào được biết là cần hỗ trợ đặc biệt. *(ghi nhận khoảng trống, không bịa)*
