# Tuhoc v2 — Nền tảng mở: gói course, registry cộng đồng, AI tự cắm key

**Ngày:** 2026-08-20 · **Trạng thái:** đã duyệt hướng, chờ duyệt spec
**Tiền đề:** `docs/superpowers/specs/2026-08-19-tuhoc-platform-design.md` (spec v1, §1–§7)
**Ảnh hưởng:** thay thế phần lớn kế hoạch P3/P4 hiện có — xem §8.

---

## 0. Vì sao có tài liệu này

Spec v1 thiết kế một nền tảng tự học **cho một người**. Yêu cầu mới đổi bản chất bài toán:
nền tảng phải **mở cho người khác dùng**, course phải **cắm rời được** và cộng đồng đóng góp
được, còn AI thì **thay model nào cũng chạy**.

Đây không phải một dự án mà là **sáu hệ thống con phần lớn độc lập**. Gộp cả sáu vào một
bản thiết kế sẽ ra một thiết kế sai ở nhiều chỗ cùng lúc. Tài liệu này chốt các quyết định
**xuyên suốt** rồi tách phần còn lại thành sáu vòng spec → plan → triển khai riêng.

---

## 1. Bốn quyết định xuyên suốt

### 1.1 Mô hình chạy: hybrid

Một **bản chính thức** do tác giả vận hành (registry + rating + tài khoản), và mã nguồn công
khai để ai muốn thì **tự chạy bản riêng**. Bản tự chạy **pull được** course từ registry chung
(chỉ đọc).

Hệ quả bắt buộc: mọi tính năng phải chạy được ở **cả hai** trạng thái — có tài khoản và không
tài khoản. Không được có tính năng nào chỉ hoạt động khi đăng nhập vào bản chính thức, trừ
những thứ vốn dĩ cần danh tính (rating, course riêng tư).

### 1.2 Course có hai hạng, phân theo khả năng chạy mã

Đây là quyết định **an ninh**, không phải phân loại nội dung.

| | Hạng `content` | Hạng `interactive` |
|---|---|---|
| Nội dung | HTML + CSS + công thức toán | thêm JavaScript (mô phỏng) |
| Ai đóng góp được | bất kỳ ai, qua PR | bất kỳ ai, nhưng phải **duyệt tay** |
| Merge | gần như tự động sau khi máy kiểm định | chỉ sau khi người đọc mã |
| Nhãn trong catalog | không | **hiển thị rõ** cho người pull |

**Vì sao không nhốt tất cả vào iframe sandbox** — cách cô lập tiêu chuẩn: nó **phá hủy P2**.
Tính năng bôi chọn/ghi chú lề cần truy cập DOM **cùng tài liệu** để chuẩn hoá văn bản, neo
anchor và tô màu. Qua ranh giới iframe thì không làm được. Ghi chú lề và JS cộng đồng tự do là
hai thứ loại trừ nhau; hai hạng là cách giữ được cả hai.

### 1.3 Tầng xã hội: tách đôi

- **Rating** — tự xây. Một bảng, một endpoint, 1–5 sao, mỗi người một phiếu mỗi course.
  Cần chính xác để sắp xếp catalog, và rẻ vì bản chính thức đã có sẵn xác thực.
- **Comment + forum** — đẩy sang **GitHub Discussions** của repo registry.

Lý do: phần khó của một diễn đàn không phải code mà là **spam và kiểm duyệt**. GitHub cho sẵn
luồng thảo luận, thông báo, báo cáo vi phạm, khoá luồng — và người tham gia phải có tài khoản
thật, nên spam gần như không có. Nền tảng nhúng đọc qua API (server giữ token, cache), muốn
đăng thì bấm sang GitHub. Bản tự chạy cũng đọc được vì API công khai.

### 1.4 AI: chỉ tự cắm key. **Không** credit, **không** thanh toán.

Người dùng tự cấp API key của họ. **Key không bao giờ chạm tới server của nền tảng** — không
đi qua, không nằm trong bộ nhớ tiến trình, không vào log, không vào database, không vào bản đồng
bộ. Không có ngoại lệ, không có đường dự phòng.

Đây là lời hứa **tuyệt đối và có chủ ý**, vì chỉ lời hứa tuyệt đối mới kiểm chứng được: nếu
không tồn tại đường nào trên server nhận key thì đó là điều **test bắt được**, chứ không phải
điều con người phải nhớ. Xem §3.2(3) cho cách biến nó thành bất biến mà codebase tự giữ.

Điều này khả thi vì các nhà cung cấp **cho gọi thẳng từ trình duyệt**. Đã dò thực nghiệm
2026-08-20 từ một origin trình duyệt, dùng key giả:

| Nhà cung cấp | CORS | Phản hồi |
|---|---|---|
| DeepSeek | cho phép | 401 `Authentication Fails` |
| OpenAI | cho phép | 401 `Incorrect API key` |
| Anthropic | cho phép (cần header `anthropic-dangerous-direct-browser-access`) | 401 `invalid x-api-key` |
| OpenRouter | cho phép | 401 |
| Groq | cho phép | 401 |

Cả năm trả về lỗi xác thực bình thường ⇒ yêu cầu **tới được API**, không bị trình duyệt chặn.

**Phương án credit + cổng thanh toán đã được cân nhắc và loại bỏ.** Nó là hệ thống con duy nhất
tạo nghĩa vụ ngoài kỹ thuật (hoàn tiền, hoá đơn/thuế, định danh doanh nghiệp), đòi chuẩn kỹ
thuật cao hơn hẳn phần còn lại (sổ cái ghi kép, webhook chịu gọi lặp, truy vết mọi giao dịch),
và tạo chi phí tăng theo số người dùng — trái ràng buộc "hạ tầng miễn phí". Tự cắm key đáp ứng
cùng nhu cầu với chi phí bằng 0 và rủi ro bằng 0.

---

## 2. Hệ thống con 1 — Gói course di động + course riêng tư

**Mục tiêu:** course trở thành thứ cắm rời được: tạo ra, kiểm định, mang đi, import, chia sẻ.

### 2.1 Định dạng gói (v2, mở rộng từ v1 đang chạy)

`manifest.json` hiện có `id`, `title`, `description`, `lang`, `version`, `runtime`, `parts[]`.
Thêm:

```jsonc
{
  "tier": "content" | "interactive",   // §1.2 — bắt buộc
  "lang": "vi",                         // ĐÃ CÓ; nay là nhãn hiển thị trong catalog
  "authors": [{ "name": "...", "url": "..." }],
  "license": "CC-BY-4.0",              // bắt buộc với course lên registry
  "generatedBy": "ai" | "human" | "mixed",  // course do AI sinh là chuyện thường, nói thẳng
  "registryId": "..."                   // chỉ có khi đã ở registry; course cục bộ thì không
}
```

`lang` và `generatedBy` phục vụ đúng yêu cầu "user biết nên expect gì khi pull về".

### 2.2 Bộ kiểm định — một bộ, ba nơi chạy

Cùng một bộ luật chạy ở CI của registry, ở server khi import, và ở trình duyệt khi import file.
Một nguồn chân lý, không có bản sao trôi dạt.

Luật cho hạng `content`, **từ chối** nếu thấy: thẻ `<script>`, thuộc tính `on*`, URL `javascript:`,
`<iframe>`, `<object>`, `<embed>`, `<form>`, hoặc bất kỳ tệp `.js` nào trong gói.
Luật chung: manifest hợp lệ, mọi `file` trỏ tới tệp tồn tại, `runtime` tương thích, không có
đường dẫn thoát ra ngoài thư mục gói.

### 2.3 Import

Ba nguồn, cùng một đường xử lý sau khi giải nén: **tệp `.zip`**, **URL trỏ tới `.zip`**, và
**URL repo Git công khai**.

**Repo Git chỉ hỗ trợ repo CÔNG KHAI, và đây là quyết định có chủ ý.** Repo riêng tư đòi token
truy cập, tức nền tảng lại phải giữ một bí mật lâu dài của người dùng — đúng thứ §1.4 vừa loại
bỏ, chỉ đổi tên. Người muốn dùng course từ repo riêng tư của mình thì tải `.zip` về rồi import
tệp: cùng kết quả, không ai phải giữ bí mật của ai.

### 2.4 Course riêng tư

Dùng cờ `visibility` **đã có sẵn trong schema từ P1**. Course riêng tư upload lên bản chính
thức và đồng bộ như mọi dữ liệu khác. Kích thước không phải ràng buộc: giáo trình lớn nhất hiện
có là **1,3 MB thô / 0,4 MB nén**, nên 1000 course riêng tư vẫn nằm gọn trong free tier.

**Ranh giới:** riêng tư nghĩa là không người dùng nào khác thấy. Không phải mã hoá đầu-cuối —
người vận hành máy chủ về nguyên tắc đọc được. Nói rõ trong tài liệu, đừng hứa điều không giữ được.


### 2.5 Hai công cụ tạo course — và vì sao cần cả hai

**CLI `tuhoc pack ./thư-mục`** — kiểm định rồi đóng gói. Chạy **đúng bộ luật** mà CI của registry
chạy (§2.2): một nguồn chân lý, không có bản sao trôi dạt. Người đóng góp biết gói của mình hợp lệ
**trước** khi mở PR, thay vì đợi CI báo đỏ.

**Skill soạn course cho agent** — CLI đảm bảo course **hợp lệ**; skill đảm bảo course **hay**.
Một registry đầy course hợp lệ mà nhạt thì vẫn thất bại. Vì phần lớn course sẽ do AI sinh, chất
lượng phải được mã hoá thành hướng dẫn chứ không trông chờ vào lời nhắc tuỳ hứng.

Skill mã hoá: cấu trúc chương và manifest · chuẩn sư phạm lấy **chính giáo trình Lý thuyết Thông
tin làm mẫu** (độ sâu, xây trực giác trước hình thức, bài tập có lời giải, mô phỏng khi khái niệm
cần nhìn thấy mới hiểu) · luật hai hạng §1.2 · nhãn `lang`/`generatedBy` · và **bắt buộc chạy CLI
kiểm định trước khi coi là xong**.

### 2.6 Phiên bản: ghim, cập nhật là tự chọn, có báo cáo thiệt hại trước

Người học **ghim** phiên bản đã pull. Course có bản mới thì hiện thông báo, **không tự cập nhật**.

Khi người dùng bấm cập nhật, hệ thống chạy **thử neo lại** (dry-run) toàn bộ ghi chú của họ trên
nội dung mới rồi báo cáo **trước khi** đổi bất cứ thứ gì:

> *v1.0 → v1.1 · 37/40 ghi chú giữ đúng chỗ · 2 dịch nhẹ (khớp mờ) · **1 mất neo** (chương 3.4,
> đoạn đã bị viết lại) · Cập nhật / Ở lại v1.0*

Đây chính là chỗ máy móc khớp-mờ của P2 (Task 2) trả lãi: nó vốn được xây để chịu nội dung thay
đổi, và ở đây nó biến "nội dung đổi dưới chân bạn" thành **một quyết định có thông tin**.

Yêu cầu kỹ thuật kéo theo: registry giữ **mọi phiên bản** (mỗi phiên bản là một thư mục/tag), và
máy người dùng giữ bản đã ghim để đọc offline. Ghi chú mất neo **không bị xoá** — rơi vào mục mất
neo (Task 7) để nối tay.

### 2.7 Nơi lưu nội dung course phía server

**Postgres**, không dùng object storage riêng. Lý do: gói lớn nhất hiện có là 0,4 MB nén, nên
1000 course riêng tư vẫn nằm gọn trong free tier; và mỗi dịch vụ thêm vào là một thứ nữa mà
**người tự chạy bản riêng phải cấu hình** — trái mục tiêu §1.1. Sao lưu cũng đi kèm luôn.
Xem lại nếu có ngày một course vượt ~10 MB.

---

## 2B. Việc phải làm NGAY, trước khi publish

### 2B.1 Course riêng tư đang nằm trong git — và xoá sau không cứu được

`courses/***REMOVED***/` hiện là **47 tệp, 1,3 MB đã commit** trong chính repo sẽ được
publish. Xoá ở một commit sau **không giải quyết gì**: git giữ toàn bộ lịch sử, ai clone cũng khôi
phục được bằng một lệnh.

**Xử lý, hai phần:**

1. **Ngay bây giờ:** chuyển course ra khỏi repo. Nó trở thành **course import đầu tiên** của chính
   tác giả — tức đường import được **dùng thật** thay vì được ưu ái bằng một đường đặc biệt. Nếu
   đường import có lỗi, ta phát hiện ngay trên dữ liệu ta quan tâm nhất, không phải sáu tháng sau
   từ một người lạ.
2. **Khi publish:** viết lại lịch sử, bóc `courses/` khỏi mọi commit. Giữ được toàn bộ lịch sử phát
   triển — vốn là tài sản thật: từng vòng review, từng phán quyết, từng lần số đo bị bác bỏ. Đổi
   lại **mọi mã commit đều đổi**, nên tài liệu nào đang trích mã commit phải sửa theo. Danh sách
   nơi cần sửa phải được lập **trước** khi viết lại, không phải sau.

*Đây là một lỗi lẽ ra spec v1 phải bắt: nó thiết kế nền tảng cho một người, nên "course nằm trong
repo" là hợp lý. Yêu cầu publish làm giả định đó sai, và giả định sai thì không tự báo lỗi.*

---

## 3. Hệ thống con 2 — AI tự cắm key

### 3.1 Kho khoá ở origin riêng

Key **không** nằm trong trang chính. Nó nằm trong một khung nhỏ trên **subdomain riêng**
(ví dụ `vault.<domain>`), chỉ làm hai việc: giữ key và gọi nhà cung cấp. Trang chính giao tiếp
với nó bằng `postMessage`.

**Vì sao bắt buộc:** §1.2 cho phép course hạng `interactive` chạy JS. JS đó chạy **cùng trang**
với ứng dụng. Một course duyệt sót sẽ đọc được key. Trình duyệt **cấm** JS của origin này đọc
dữ liệu của origin khác — nên kho khoá ở subdomain riêng là hàng rào thật, không phụ thuộc vào
việc duyệt có sót hay không.

Không phá P2: chỉ phần xử lý key ở trong khung; nội dung chương vẫn ở trang chính.
Chi phí bằng 0: tên miền riêng **đã bắt buộc phải mua** vì vấn đề cookie (`docs/deploy.md` §0).

### 3.2 Ba ràng buộc cứng

1. **Key phải bị loại khỏi đồng bộ.** P1 tự động đẩy các bảng cục bộ lên server; nếu key rơi vào
   một bảng được đồng bộ thì nó lên server đúng cái điều ta đang tránh. Có sẵn chốt: `db/local.test.ts`
   assert database có đúng 4 bảng — thêm bảng thứ 5 phải sửa con số đó **một cách có ý thức**.
2. **Key nhập theo từng thiết bị**, không đồng bộ. Mất máy này không lộ key ở máy kia.
3. **KHÔNG có đường dự phòng qua server, và điều đó phải được CƯỠNG CHẾ chứ không chỉ ghi nhớ.**
   Nhà cung cấp nào không cho gọi từ trình duyệt thì đơn giản là **không được hỗ trợ** — danh sách
   nhà cung cấp được định nghĩa đúng bằng "cho phép gọi từ trình duyệt".

   Cưỡng chế bằng một test ở phía Go: quét toàn bộ route đã đăng ký và **khẳng định không route
   nào nhận trường mang key** (`api_key`, `apiKey`, `authorization` chuyển tiếp, `x-api-key`…).
   Test đó hỏng nghĩa là ai đó vừa mở lại đường ta đã đóng — kể cả khi họ có ý tốt. Đây là loại
   bất biến đúng ra phải có test, vì nó là thứ **con người sẽ quên sau sáu tháng** còn hậu quả
   thì không tự lộ ra: key rò rỉ không gây lỗi nào, chỉ âm thầm nằm trong log.

   Rủi ro đã biết: nhà cung cấp có thể đổi chính sách và chặn trình duyệt sau này. Khi đó họ rời
   danh sách hỗ trợ — **không phải** khi đó ta mở đường qua server. Cách kiểm lại chính sách của
   một nhà cung cấp được ghi ở §1.4 (dò bằng key giả, đọc mã trạng thái).

### 3.3 Lớp trừ tượng nhà cung cấp

Hai hình dạng API phủ hết năm nhà cung cấp đã dò: **tương thích OpenAI** (DeepSeek, OpenAI,
OpenRouter, Groq, và mọi endpoint tự chạy) và **Anthropic**. Người dùng chọn nhà cung cấp,
dán key, chọn model. Mặc định gợi ý DeepSeek vì rẻ.

Streaming bằng `fetch` + `ReadableStream`, không cần thư viện.

---

## 4. Hệ thống con 3 — Registry trên GitHub + song ngữ

### 4.1 Registry

Một repo GitHub công khai, mỗi course là một thư mục. Đóng góp = mở PR thêm thư mục.

CI chạy bộ kiểm định (§2.2), gán nhãn hạng, và **sinh `index.json`** — một tệp duy nhất chứa
metadata mọi course. Nền tảng chỉ tải tệp đó: một request, cache được, **không đụng giới hạn tần
suất của GitHub API**, và bản tự chạy dùng được y hệt.

`index.json` phục vụ qua **GitHub Pages** của chính repo registry, không qua GitHub API — Pages
cho cache CDN và **không có giới hạn tần suất theo IP** như API. Nội dung course tải theo yêu cầu
khi người dùng pull về thư viện cá nhân.

### 4.2 Song ngữ

Giao diện nền tảng: tiếng Việt + tiếng Anh. Course thì **ngôn ngữ nào cũng được** — `lang` trong
manifest là nhãn, catalog lọc và hiển thị theo nó. Không dịch course; không hứa điều không làm.

---

## 5. Hệ thống con 4 — Rating + Discussions

Rating **chỉ áp dụng cho course trên registry** — course riêng tư và course import từ tệp không
có rating, vì không có gì để so sánh giữa những người dùng khác nhau. Bảng
`course_ratings(user_id, registry_id, stars, created_at)`, một phiếu mỗi người mỗi course, sửa
được. Catalog sắp xếp theo điểm trung bình + số phiếu.

Comment/forum: mỗi course có một Discussion tương ứng trên repo registry. Nền tảng nhúng đọc
(server giữ token GitHub, cache theo TTL), nút đăng dẫn sang GitHub.

---

## 6. Thứ tự triển khai

| # | Hệ thống con | Vì sao ở vị trí này |
|---|---|---|
| 0 | Hoàn thành P2 (ghi chú) | 4/8 task xong — không cắt ngang |
| 1 | Gói course + course riêng tư | Nền móng; mọi thứ khác dựng trên nó |
| 2 | AI tự cắm key | Độc lập; dùng được ngay, chi phí 0 |
| 3 | Registry + song ngữ | Mở ra thế giới cần cả hai cùng lúc |
| 4 | Rating + Discussions | Cần registry đã có course thật |

Mỗi mục là một vòng spec → plan → triển khai riêng. Tài liệu này là spec **cấp chương trình**;
mục 1 cần thêm một vòng hỏi chi tiết trước khi thành plan.

---

## 7. Những gì spec này CỐ Ý không làm

- **Không** thanh toán, không credit, không cổng thanh toán (§1.4).
- **Không** cho key đi qua server dưới bất kỳ hình thức nào, kể cả "chỉ đi ngang không lưu"
  (§3.2). Nhà cung cấp không hỗ trợ gọi từ trình duyệt thì không được hỗ trợ.
- **Không** dịch nội dung course tự động.
- **Không** trình soạn course trong ứng dụng — đã cân nhắc và loại: nó là một sản phẩm riêng,
  to hơn cả bốn hệ thống con còn lại cộng lại, và cạnh tranh với chính cách course đang được
  sinh ra (AI + CLI đóng gói, §2.5).
- **Không** tự động cập nhật course (§2.6).
- **Không** mã hoá đầu-cuối cho course riêng tư (§2.4).
- **Không** liên hợp (federation) giữa các bản tự chạy. Bản tự chạy chỉ **đọc** registry chung.
- **Không** sandbox iframe cho nội dung chương — đánh đổi đã phân tích ở §1.2.

---

## 8. Ảnh hưởng tới kế hoạch P3/P4 hiện có

- **P3 (AI tutor)** — phần lớn còn dùng được: lớp trừu tượng provider và giao diện chat giữ
  nguyên. **Bỏ**: quota, `ai_usage`, migration 0002 cho AI. **Thêm**: kho khoá ở origin riêng.
- **P4 (publish)** — OAuth GitHub và invite code giữ nguyên; `GET /courses` (nợ C-2 trong
  `docs/carried-forward.md`) nay thuộc hệ thống con 1. **Thêm**: registry, rating, song ngữ.
- Nợ **C-1** (rò rỉ chéo tài khoản qua nhiều tab) và **C-3** (CSRF khi dùng `SameSite=None`)
  vẫn phải xử lý trước khi mở cho người lạ.
