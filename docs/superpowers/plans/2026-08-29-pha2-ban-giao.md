# Pha 2 — bàn giao: quyết định, nợ treo, và thứ Pha 3/4 thừa kế

Thi công 28–29/08/2026. 19 task (0–18), 80 commit trên `main`, mỗi task một vòng
review độc lập cộng vòng sửa, rồi **bốn** review tổng nhánh song song và hai đợt
sửa cuối.

Spec: `2026-08-25-server-side-pivot.md`. Plan: `2026-08-28-pha2-ai-may-chu.md`.

Tài liệu này giữ thứ không nằm trong `git log`.

---

## 1. Cú xoay trục, một câu

AI chuyển từ **phía trình duyệt** (người học cắm key của chính họ vào một iframe
khác origin) sang **phía máy chủ trả bằng credit**. `apps/vault` bị xoá. Nhà cung
cấp là **DeepSeek** (chủ dự án chọn vì rẻ, đè lên lựa chọn Anthropic trong spec đã
duyệt); tìm kiếm web là **Brave Search**, một key thứ hai spec gốc không lường.

---

## 2. Review tổng nhánh bắt được thứ 19 vòng review đơn lẻ KHÔNG THỂ thấy

Đây là bài học đắt nhất của pha. Mỗi task xanh, mỗi review đơn lẻ đúng — và sản
phẩm vẫn không dùng được, vì **không ai sở hữu mối nối**.

| Lỗ | Vì sao mỗi nửa đều "đúng" |
|---|---|
| **Trên deploy sạch, AI chết 100%, im lặng** | Task 2 chọn `signup_grant_micro DEFAULT 0` (an toàn cho schema — đúng). Task 10 đọc cột live thay vì hardcode (đúng). Task 17 tự giới hạn đúng spec §7 (đúng). Task 14 viết câu báo lỗi đúng trạng thái (đúng). Kết quả: mọi người học mới có 0 credit → 402 ngay câu hỏi ĐẦU TIÊN. |
| **Hai key AI không có ở bất kỳ blueprint nào** | `render.yaml` và `fly.toml` đều 0 lần. Tài liệu bảo đặt ở "Render Environment tab (`sync: false`)" — nhưng `sync: false` LÀ một dòng trong `render.yaml`, và dòng ấy không tồn tại, nên Blueprint không bao giờ hỏi. |
| **Tính năng chủ lực chưa từng được nối dây** | `ChapterView.tsx` render `<AskPanel>`/`<DeepDive>` **không truyền `courseSlug`**. Prop tồn tại suốt chuỗi, mặc định `''`; `agent.go` có `if t.CourseSlug != ""` → nhánh chết trong sản xuất. `read_course` **bật mặc định** và mù. |
| **Cổng canh key không có răng trên đường thật sự chạy** | Cổng quét tên trường `deepseekapikey`/`braveapikey`; `internal/ai` đổi tên thành `apiKey` CÓ CHỦ Ý và tự nhận nghĩa vụ thay bằng test cục bộ. Nghĩa vụ trả 2/3: `Complete` có, `Brave.Search` có, **`CompleteStream` không** — mà `/ai/chat` chỉ dùng streaming. Đo: chèn key vào đường lỗi stream → `go test ./...` **478 passed**. |

Lỗ thứ nhất **lặp lại đúng hình dạng** lỗi `ADMIN_TOKEN` mà review tổng Pha 1 đã
bắt một lần. Và nơi DUY NHẤT trong repo vá nó là chính bộ e2e — `test-e2e.sh` chạy
một `UPDATE ai_settings` với chú thích chẩn đoán vấn đề chính xác từng chữ, rồi
giải quyết **chỉ cho riêng nó**. Đó là lý do 6/6 xanh suốt.

**Bài học cho Pha 3:** không có đường nào để một điều đã biết trong harness test đi
ngược ra `render.yaml` và `deploy.md`. Cùng đường ống đã để lọt `ADMIN_TOKEN`.

---

## 3. Ba quyết định của điều phối viên, và giá của chúng

1. **`signup_grant_micro` = 50.000** (≈13 lượt ở giá seed). Spec §10.1 hoãn CON SỐ
   sang Pha 4 — nhưng ship `0` không phải "chưa chốt giá", nó là tính năng tắt.
   **Giá:** repo không có xác thực email, nên K tài khoản = K×50.000. Nhận vì lựa
   chọn còn lại là ship sản phẩm không ai dùng được. Nợ có tên, có điều kiện xét lại.
2. **Không xây thanh toán** (Pha 4). Nên câu chữ phải thôi hứa một nút không tồn
   tại — sửa CÂU, không xây tính năng.
3. **Không sửa `0007` tại chỗ**, dùng `0008`. golang-migrate không checksum tệp;
   DB đang ở version 7 sẽ không bao giờ chạy lại. Pha 1 đã trả giá cho bài này.

---

## 4. Bốn lần điều phối viên sai

1. **Tôi tưởng `make check-publish` xanh.** Nó **đỏ** (`exit=1`), và đã đỏ trên
   `main` từ trước — nguyên nhân là `08dbffe`, chính commit viết lại lịch sử, vì nó
   tạo `scripts/private-markers.txt` (tệp tự nêu tên khoá học riêng, có chủ ý).
   Cổng fail-closed đúng thiết kế. Không phải hồi quy Pha 2.
2. **Sổ nợ tôi viết đánh giá bán kính sai.** Tôi biện minh điểm mù closure bằng
   "mọi route sau cổng admin đều là người vận hành tự bắn chân" — tiền đề không áp
   dụng cho chính lỗi đang bàn, vì route ấy **không** nằm sau cổng admin. Bảy
   handler admin không tự kiểm role, nên một route bọc closure trao cho bất kỳ tài
   khoản đã đăng ký: email + số dư mọi user, sổ chi tiêu user bất kỳ, và quyền tự
   nạp credit. Đó là **leo thang đặc quyền**. Kết luận giữ, lý do phải sửa.
3. **Tôi mô tả sai một hình dạng khai thác.** Nói route thiếu `RequireAdmin` sẽ rò;
   thực tế `Group()` của fiber bọc theo **tiền tố đường dẫn**, nên route thêm *sau*
   group vẫn 403 — chỉ thêm *trước* mới rò. Người thi công tự báo tôi sai thay vì im.
4. **Tôi để agent chạy nền mà không kiểm cây.** Ba lần một đột biến sống lại trong
   mã sản phẩm đường tiền (`credits.go` ×2, `server.go` ×1) — lần ở `server.go` là
   một **lỗ phân quyền thật đang chạy**. Bắt được bằng `git diff apps/api/` trước
   mỗi bước. **Luật: kiểm cây trước khi tin bất kỳ báo cáo "xanh" nào.**

---

## 5. Dạng lỗi lặp nhiều nhất, và cơ chế đẻ ra nó

**Hồ sơ hứa rộng hơn thứ mã thật sự làm** — bị bắt **hơn sáu lần**. Nặng hơn:
**bốn lần** một bản vá tài liệu **đẻ ra khẳng định sai MỚI**, và ít nhất hai lần
câu sai ấy được viết **ngay trong lúc giải thích rằng câu trước đã thành cũ**.

Ví dụ mẫu, đáng giữ: một commit sửa lỗi "dấu đóng chú thích CSS không có dấu mở"
đã **để sót nguyên đoạn văn nháp** trong tệp đã commit, chứa dấu `{` thật — nuốt
~20 quy tắc khỏi bản dựng production, trong khi `bun run build` vẫn xanh không một
cảnh báo. Cơ chế: bản vá cắt vùng thay thế bằng `s.index(".page-settings {", …)`,
và chuỗi neo ấy **khớp vào đoạn nháp hỏng của lần trước** chứ không khớp quy tắc
thật. *Khi một chuỗi neo có thể xuất hiện trong chính văn bản mình vừa chèn hỏng,
`index()` không phải phép cắt an toàn.*

Chống lại bằng: `apps/web/src/styles/cssStructure.test.ts` (cân bằng ngoặc, **cố ý
không** bỏ qua nội dung chuỗi — cách "đúng" đã được ĐO là mù trước chính lần hỏng
thứ hai). Ở TypeScript lỗi này ồn ào (`oxc` từ chối dịch ngay); ở CSS nó im lặng.

---

## 6. Nợ đã PARK — đọc `docs/carried-forward.md` cho bản đầy đủ

Đáng chú ý nhất, theo thứ tự bán kính:

- **Không có khoá idempotency** cho `POST /admin/ai/users/:id/credit`. Một response
  bị mất VẪN có thể thành nạp đôi thật.
- **TOCTOU của `EnsureCredit` được THU HẸP, chưa ĐÓNG.** Đo lại: balance 1 micro,
  10 goroutine → 9 qua, 9 trừ, balance cuối −35.639. Phần "thu hẹp" đứng trên giả
  định **một process**, buộc vào `render.yaml` chứ không phải tính chất thiết kế.
- **Trục thời gian audit của grant CÓ lỗ.** Không `TRIGGER` nào trên `ai_settings`;
  nơi ghi audit duy nhất nằm trong `UpdateSettings`, nên một `UPDATE` thô không để
  lại hàng nào — mà `test-e2e.sh` đang chạy đúng một cái. Sau đó `0008` cũng không
  ghi bù. Phép tái dựng trả **số sai**, không phải "không biết".
- **Ràng buộc "tiền luôn `int64`" không có cổng cấu trúc.** Đo: đổi `divUp` sang
  `math.Ceil`/`float64` → build OK, test xanh.
- **Điểm mù wrapper** của cổng quét route admin (xem §4.2).
- **`cost_micro` là cột CHỈ-GHI** — không truy vấn nào SELECT nó, mà Pha 4 sẽ định
  giá dựa vào nó.
- **169 khoá i18n mồ côi** và **115 con trỏ tới tệp `.superpowers/` gitignored** —
  cả hai là lớp lỗi, không đóng được bằng sửa lẻ; cần task riêng có kích thước.
- **`GrantSignupCredit`** là đường tạo credit duy nhất không để lại dấu vết.

---

## 7. Bẫy phương pháp đã trả giá — ghi để không ai vấp lại

**`grep -rn` giấu mất một tệp.** `apps/web/src/api/ratings.ts` chứa **một** byte
NUL hợp lệ (`ratingsQueryKey` dùng `\0` làm dấu phân cách khi join), nên `grep`
xếp nó là nhị phân và chỉ in `Binary file … matches` — giữ lại dòng và số dòng.
Nhờ đó bản sao **thứ chín** của một khẳng định sai suýt lọt qua trọn một vòng dọn
đi tìm đúng nó. **Mọi phép quét toàn repo trong repo này phải dùng `grep -a`.**

**Chẩn đoán của editor đứng sau thực tế** — gặp ~11 lần trong pha này, mỗi lần đều
là đồ cũ. Tin `go build` / `go test` / `bun run typecheck`.

---

## 8. Cổng đang canh gì, sau pha này

- `provider_key_never_leaks_test.go` — nay có needle `apikey`, **cộng**
  `TestCompleteStreamErrorNeverContainsKey` trong `internal/ai` phủ 13 đường lỗi
  của `CompleteStream`. Cả hai lớp cùng đỏ khi chèn key vào đường lỗi stream.
- `apilog/no_ai_bodies_test.go` — hai nửa (cấu trúc + hành vi) **thật sự bù nhau**:
  đột biến đổi tên biến làm nửa cấu trúc xanh, nửa hành vi ĐỎ.
- `i18n_server_speaks_codes_test.go` — bộ dò `go/scanner` phân biệt đúng chuỗi với
  chú thích; nay có thêm hai neo trong `internal/ai`.
- `admin_handler_test.go` — quét route theo **định danh handler**
  (`reflect…Pointer()`), không theo tiền tố đường dẫn: bắt được cả route đăng ký
  nhầm đường dẫn, thứ middleware tiền tố của fiber không thể bắt. Tiền đề "con trỏ
  độc lập receiver" được chứng minh bằng test riêng trước khi tin.
- `cssStructure.test.ts` — cân bằng ngoặc CSS (xem §5).
- `make test-e2e` — nay **6 bài**: `p1` ×4, `s2` ×1 (viết lại quanh credit), `widget`
  ×1. `p2` vẫn cách ly có ghi lý do. `s2` chứng minh trừ tiền THẬT bằng cách đòi số
  dư xuống **âm** — một cái kẹp chống âm không thể giả vờ đi qua số âm.
- DeepSeek được thay bằng `scripts/fake_deepseek.py` (compose service, không expose
  ra host) để bộ test không tiêu tiền thật; mã tính tiền thật vẫn chạy đầu-cuối.

---

## 9. Thứ Pha 3/4 thừa kế

- **Pha 3** (`/progress`, `/notes`, `/annotations`, `POST /migrate`): lưu ý
  `login.point.sync` **đã thành thật sớm hơn kế hoạch** — `/sync` nay chở cả tiến
  độ lẫn ghi chú. Nhưng `settings.localData.blurb` từng nói "ghi chú nằm trong
  trình duyệt này" và bỏ sót bản sao trên máy chủ; đã sửa, kiểm lại khi đụng vào.
- **Pha 4** (thanh toán, chốt giá): `cost_micro` là cột chỉ-ghi và
  `cost_micro_per_web_search` mặc định 0 — con số Pha 4 phải định giá dựa vào hiện
  **có cấu trúc sai** *và* **không nhìn thấy được**. Sửa cái đó trước khi định giá.
  Và `signup_grant_micro = 50.000` + không xác thực email là đường farm đang mở;
  bật thanh toán là lúc phải xét lại.

---

## 10. Việc còn lại, không thuộc pha này

- **`make check-publish` vẫn ĐỎ.** Chặn publish khoá học ra công khai; không liên
  quan repo riêng tư. Cần bước `--replace-text` ở `docs/publishing.md §2.8`.
- **Key DeepSeek phải được xoay.** Nó từng bị dán thẳng vào hội thoại và vào một
  transcript phiên làm việc. Đã kiểm: **không** lọt vào tệp được track và **không**
  có trong cả 80 commit — nhưng nó đã ra khỏi tầm kiểm soát.
