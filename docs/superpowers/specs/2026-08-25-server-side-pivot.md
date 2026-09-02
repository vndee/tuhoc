# Chuyển trục: nền tảng dịch vụ — course trên máy chủ, AI trả bằng credit

**Quyết định của chủ sản phẩm, 25/08/2026.** Nguyên văn: *"phần AI chuyển sang
server side và chúng ta sẽ cung cấp dịch vụ thay vì để ở client side như hiện
tại, để chúng ta có thể cung cấp các agent tốt hơn và đặc biệt là giảm rủi ro
khi lưu key của user ở browser và toàn bộ data phải lưu ở server thay vì lưu ở
client một phần và sync như hiện tại giúp giảm fiction và có để đọc cross-device
tốt hơn, data lưu cũng dễ hơn. Mặc định các course là miễn phí ai cũng coi được,
còn muốn dùng AI thì purchase credit."* Kèm ba yêu cầu bổ sung trong cùng phiên
thiết kế: course mang JavaScript nên **phải an toàn khi nằm trên máy chủ của
ta**; cách generate course phải được **chuẩn hoá cho đồng bộ chất lượng**;
người dùng được **config system prompt và chọn tool** cho agent (tool đắt như
web search chỉ đơn giản là tốn thêm credit); và vì đã thành nhà cung cấp dịch
vụ + nội dung, cần **CMS cho admin**.

Tài liệu này là bản thiết kế ĐÃ DUYỆT, thay thế toàn bộ bản nháp cùng tên.
Mọi câu hỏi mở của bản nháp đã có lời đáp (§10 ghi những gì còn lại).

---

## Các quyết định đã chốt

| Câu hỏi | Quyết định |
|---|---|
| Phân phối course | **Server là nguồn duy nhất.** Luồng import `.zip` của người đọc chết; `tuhoc pack` thành đường của người soạn. |
| JS trong course | **Chỉ chạy trong iframe sandbox.** Mọi chương là hạng `content` (máy kiểm 100%); phần tương tác tách thành widget, chạy trong origin mờ. |
| Đọc ngoại tuyến | **Bỏ hẳn.** Không Dexie, không service worker. Mất mạng hiện màn hình tử tế. |
| Key AI | **Chỉ key của ta**, từ biến môi trường server. Không bao giờ lưu key người dùng — ở browser hay ở server. |
| Đơn vị credit | **Đơn vị riêng của ta.** Bên trong vẫn đếm token thật để tính giá vốn. |
| Thanh toán | **SePay (VietQR) + Polar (merchant of record quốc tế), cả hai từ đầu.** |
| Agent | Tool đọc course (pha 2), tool đọc tiến độ/ghi chú (pha 3), web search do ta tự viết (gọi sang Brave Search API, key từ env `BRAVE_API_KEY`, phụ thu credit). Người dùng config system prompt + bật/tắt tool. |
| Generate course | **Pipeline chuẩn + quality gate máy đo được** trong `course-format`. |
| Ai publish | **Chỉ ta**, qua CLI với admin token hoặc CMS. Cộng đồng đóng góp qua PR vào kho nguồn. |
| Thứ tự | **Course lên server trước, AI sau** — để agent có tool đọc course ngay từ lần ship đầu. |
| CMS | Khu `/admin` trong `apps/web`, chắn bằng role. Bốn màn: Courses, Người dùng & credit, Bảng giá & prompt nền, Billing & đối soát. |
| Credit dùng thử | **Tặng ít, đủ nếm thử** cho tài khoản mới; rate limit độc lập chống farm. |
| Nhà cung cấp AI | **DeepSeek** (chốt 28/08/2026, thay bản duyệt 25/08 vì giá — xem plan Pha 2). Một nhà duy nhất cho mô hình. Web search **cần nhà cung cấp thứ hai và key riêng**: DeepSeek không có tool tìm kiếm chạy phía máy chủ họ, nên lời hứa "không cần key tìm kiếm riêng" của bản 25/08 KHÔNG còn đúng. |

---

## 0. Ba điều đổi theo, và chúng phải đổi TƯỜNG MINH

### 0.1 Rủi ro key KHÔNG biến mất — nó ĐỔI HẠNG

Kiến trúc cũ: key nằm trong trình duyệt từng người, ở một origin riêng. Máy chủ
ta chưa từng thấy key nào. Kiến trúc mới: máy chủ giữ key nhà cung cấp của TA.
Rủi ro "một người mất key" biến mất; rủi ro "một vụ xâm nhập mất key của nền
tảng" xuất hiện. Đây là đánh đổi hợp lệ, không phải phép trừ. Kèm theo:

- Key ở biến môi trường — không trong repo, không trong log, xoay được, có
  đường thu hồi.
- `apps/api/internal/apilog` KHÔNG BAO GIỜ ghi thân hội thoại AI. Câu hỏi của
  người học mang nội dung họ đang đọc và điều riêng tư của họ. Chỉ metadata:
  user, model, token, credit.
- Hạn mức và đếm dùng nay là chuyện của máy chủ, và nó cũng là chuyện tiền bạc.

### 0.2 Lời hứa "gói nằm trên máy bạn" đang IN TRÊN MÀN HÌNH

Trang đăng nhập nói bằng chữ lớn nhất trên trang: *"Giáo trình là một gói. Bạn
giữ nó, không phải chúng tôi. · Đọc ngoại tuyến — gói nằm trên máy bạn."*
Quyết định đã chốt: lời hứa này KHÔNG còn. Câu chữ phải rời màn hình **trong
cùng pha** reader bắt đầu đọc từ server (Pha 1) — một sản phẩm hứa đọc được khi
mất mạng rồi hiện màn hình trắng khi mất mạng thì tệ hơn một sản phẩm không hứa
gì.

### 0.3 Các cổng đang canh chiều NGƯỢC LẠI phải được gỡ CÓ CHỦ Ý

Từng cái một, kèm lý do trong commit — không xoá cho hết đỏ. Bảng đầy đủ ở §8.
Cái đắt nhất: `no_key_transit_test.go` khẳng định *máy chủ ta không bao giờ
nhận key*. Kiến trúc mới cố ý phá nó. Nó được THAY bằng cổng nói điều mới —
*"máy chủ nhận key nhà cung cấp từ môi trường, không ghi ra log, không trả về
client"* — chứ không bị xoá.

---

## 1. Đích đến

```
Trình duyệt                              Máy chủ (Go/Fiber + Postgres)
──────────                               ─────────────────────────────
đọc chương ───────────────────────────▶  GET  /courses/*        công khai, không đăng nhập
  └─ widget tương tác: iframe srcdoc,
     sandbox, origin mờ, không cookie
tiến độ, ghi chú, chú giải ───────────▶  /progress /notes /annotations   nguồn sự thật
hỏi AI (SSE) ─────────────────────────▶  POST /ai/chat          agent + tools, tính credit
cấu hình agent ───────────────────────▶  /ai/config             system prompt + tool bật/tắt
mua credit ───────────────────────────▶  /billing/*             SePay + Polar
quản trị ─────────────────────────────▶  /admin/*               role admin

Người soạn: nguồn ─▶ generate ─▶ tuhoc pack ─▶ tuhoc publish ─▶ server tái kiểm
```

**Chết hẳn:** `apps/vault` (185 bài kiểm), `ai/vaultClient.ts`,
`shell/VaultFrame.tsx`, `@vault-protocol`, luồng import `.zip` của người đọc
(`course/import.ts`), Dexie làm nguồn sự thật (`db/`), sync engine + outbox
(`sync/`), nhánh ngoại tuyến của `RequireAuth`, lời hứa ngoại tuyến.

**Sống và đổi vai:** `tuhoc-cli` (công cụ người soạn: `init` → `pack` →
`publish`), `packages/course-format` (chạy ở CLI VÀ chạy lại trên server lúc
publish), skill `course-authoring` (một bước trong pipeline chuẩn),
`packages/registry` (danh mục nay là `/courses` của server).

---

## 2. Course trên máy chủ

### 2.1 Lưu trữ

Toàn bộ trong Postgres: `courses` (metadata hiện hành), `course_versions`
(nguyên file zip của từng bản publish — để rollback là một thao tác đọc lại,
không phải publish ngược), `chapters` (HTML text), `assets` (bytea), `widgets`
(bundle của phần tương tác). Gói hiện tại 21–66KB zip; chưa cần object
storage hay CDN — thêm sau nếu phình, có ETag cache từ đầu.

Publish là một transaction: bản cũ vào `course_versions`, bản mới ghi đè,
không có trạng thái nửa vời.

### 2.2 Publish

`PUT /admin/courses/:slug` nhận đúng file `.zip` mà `tuhoc pack` tạo ra. Hai
đường vào: CLI `tuhoc publish` với admin token từ env (đường máy), và CMS
upload với phiên admin (đường người). Server **chạy lại toàn bộ bộ luật
course-format trước khi ghi** — không tin CLI, vì cổng thật giờ nằm ở server.
Gói fail trả về đủ danh sách lỗi một lần, đúng phong cách `pack`.

### 2.3 Format v2 — quyết định an ninh chính

Hạng `interactive` theo nghĩa cũ — JS tự do trong chương, chạy cùng trang với
phiên đăng nhập, chỉ dựa vào duyệt tay — bị **khai tử**. Lý do: origin chính
giờ mang phiên đăng nhập VÀ ví credit; một dòng JS lọt lưới duyệt tay là chiếm
phiên và tiêu tiền của mọi người đọc.

- **Mọi chương đều là hạng `content`.** Bảy luật (SCRIPT_TAG,
  EVENT_HANDLER_ATTR, JAVASCRIPT_URL, EMBEDDED_FRAME…) chạy trên MỌI course,
  ở pack và ở publish. Chương render `innerHTML` cùng DOM như cũ — bôi chọn và
  ghi chú lề còn nguyên trên toàn bộ phần chữ.
- **Phần tương tác tách thành widget.** Chương đặt chỗ bằng
  `<div data-widget="ten-widget">`; gói mang `widgets/ten-widget/` (HTML + JS
  + CSS, tự đứng). Reader dựng bằng `<iframe srcdoc sandbox="allow-scripts">`
  — **không** `allow-same-origin`: widget chạy trong origin mờ, không cookie,
  không localStorage, không chạm được phiên hay ví; request nó tự gửi đi không
  mang được phiên và bị CORS của API ta chặn.
  Bundle giao qua JSON trong hồi đáp chương, không bao giờ được serve như một
  trang trên origin chính.
- **Duyệt tay JS widget vẫn giữ** khi merge PR vào kho nguồn — nhưng nay là
  lớp chống nội dung rác, không còn là bức tường an ninh duy nhất.
- Course dạy JavaScript vẫn viết ví dụ code thoải mái: code ví dụ là chữ đã
  escape trong chương (luật hiện hành đã ép); code CHẠY ĐƯỢC chỉ sống trong
  widget.

### 2.4 Đọc

`GET /courses` (danh mục), `GET /courses/:slug` (manifest + mục lục),
`GET /courses/:slug/chapters/:id` (HTML chương + widget đi kèm). Công khai
toàn bộ, không cần đăng nhập. Đọc ẩn danh không có tiến độ — màn hình nhắc
"đăng nhập để lưu tiến độ và hỏi AI" ở đúng chỗ, không lưu tạm phía client.

---

## 3. AI phía máy chủ

### 3.1 `internal/ai`

- Client DeepSeek (API tương thích OpenAI, `https://api.deepseek.com`), viết tay bằng `net/http`; key từ env (`DEEPSEEK_API_KEY`), không ra log, không ra
  response — cổng kiểm mới canh đúng điều này (§8).
- Vòng lặp agent (tool use) + stream SSE. `useAI` phía web giữ nguyên giao diện
  `AITurn[]`, chỉ đổi đường ra.
- Trần token mỗi lượt và trần vòng tool mỗi lượt — một câu hỏi không được đốt
  cả ví.

### 3.2 Tools

| Tool | Nguồn | Giá | Pha |
|---|---|---|---|
| Đọc giáo trình (mục lục, chương) | DB courses | token thường | 2 |
| Đọc tiến độ + ghi chú người học | DB progress/notes | token thường | 3 |
| Web search | nhà cung cấp tìm kiếm riêng (Brave Search API) | phụ thu credit mỗi lượt tìm | 2 |

> **Đổi nhà cung cấp không phải đổi tên.** Bản 25/08 chọn Anthropic một phần vì
> Messages API có tool tìm kiếm chạy trên máy chủ họ, nên "web search" là một
> dòng trong mảng `tools` chứ không phải một tích hợp. DeepSeek không có thứ
> ấy. Cái giá của việc rẻ hơn là một nhà cung cấp thứ hai, một key thứ hai, một
> hoá đơn thứ hai, và một `SearchProvider` interface phải tự viết và tự canh.

Tool đắt không cần cơ chế xin phép — bật là dùng, giá tự nói qua bảng quy đổi.

### 3.3 Cấu hình agent theo người dùng

`GET/PUT /ai/config`: `system_prompt` riêng (giới hạn độ dài, **nối sau**
prompt nền của nền tảng — không thay thế; prompt nền giữ vai trò gia sư và
ranh giới an toàn) + bật/tắt từng tool. Lưu `user_agent_config(user_id,
system_prompt, tools_enabled, updated_at)`.

### 3.4 Credit

- `ai_credits(user_id, balance_micro, updated_at)` + sổ cái
  `ai_usage(id, user_id, at, model, in_tokens, out_tokens, tool_calls,
  cost_micro, credits_charged)`.
- Bảng quy đổi (credit per 1K token theo model, credit per web search) nằm
  trong **DB** — đổi giá không cần deploy; CMS có màn sửa (§7).
- Vào lượt: kiểm số dư đủ ngưỡng tối thiểu → chạy → trừ sau lượt. Hết credit
  giữa lượt: lượt đó chạy nốt (chấp nhận âm lẻ), lượt sau chặn.
- Rate limit theo user, độc lập với credit — chống burn do script, chống farm
  credit tặng.
- Tài khoản mới được tặng lượng nhỏ — đủ vài câu để thấy agent đáng tiền, ít
  đến mức farm không bõ công.

---

## 4. Dữ liệu lên máy chủ

- `/progress`, `/notes`, `/annotations` thành REST nguồn sự thật; web đọc/ghi
  qua TanStack Query. Không outbox, không cursor, không merge — mất mạng thì
  thao tác ghi báo lỗi và thử lại được.
- **Dexie không còn việc gì.** Gỡ toàn bộ `db/`, `sync/`. `clearLocalData` teo
  thành xoá phiên + cache.
- **Di trú một lần:** sau đăng nhập đầu tiên ở bản mới, nếu Dexie cũ còn trên
  máy → `POST /migrate` đẩy toàn bộ tiến độ/ghi chú/chú giải (idempotent theo
  nội dung), server ghi phần nó chưa có, xong đánh dấu và xoá local. Mất mạng
  giữa chừng → lần sau chạy lại từ đầu, không hỏng gì.
- `RequireAuth` mất nhánh ngoại tuyến, chỉ còn bọc tiến độ/ghi chú/AI/admin.

---

## 5. Mua credit

- Bán **gói credit định sẵn** (ba mức), không nhập số tuỳ ý.
- `billing_orders(id, user_id, gateway, amount, credits, status,
  external_ref, created_at)`. Webhook cả hai cổng **idempotent theo
  external_ref** — nhận trùng không cộng trùng.
- **SePay (VietQR):** tạo đơn → mã QR kèm nội dung chuyển khoản chứa mã đơn →
  webhook báo tiền về → khớp mã → cộng credit. Màn "đang chờ chuyển khoản"
  poll trạng thái. Tiền về không khớp mã nằm ở hàng "mồ côi" chờ admin khớp
  tay (§7).
- **Polar:** checkout session → trả trên trang Polar → webhook `order.paid` →
  cộng credit. Polar là merchant of record, lo thuế/hoá đơn quốc tế.
- Trang mua nằm trong Settings › Trợ lý AI; hai nút: QR ngân hàng / thẻ quốc
  tế.
- Không hoàn tiền tự động — hoàn là thao tác admin chỉnh sổ cái, kèm ghi chú.

---

## 6. Pipeline generate course chuẩn

Một đường duy nhất, mọi course đi qua; chất lượng do **cổng chặn**, không do
người nhớ:

```
Nguồn liệu ─▶ extract ─▶ outline (người duyệt) ─▶ sinh chương theo skill course-authoring
          ─▶ tuhoc pack (luật format + luật chất lượng) ─▶ tuhoc publish ─▶ server tái kiểm
```

**Luật chất lượng mới trong `course-format`** — phần chuẩn sư phạm nào máy đo
được thì thành luật, pack fail nếu dưới chuẩn:

- Mỗi `<h2>` có `id`; chương có phần bài tập; hộp `box-h` đạt mật độ tối
  thiểu.
- Độ dài chương trong khoảng cho phép.
- Ví dụ code phải là code đã escape hợp lệ.
- KaTeX phải parse được — công thức hỏng fail lúc pack, không phải lúc người
  học nhìn thấy ô vuông.

**Luật widget** (vào format v2 ngay Pha 1, vì sandbox cần chúng):

- Trần dung lượng mỗi widget; không phụ thuộc ngoài (không URL http(s) trong
  JS/HTML); không minify — còn lớp người duyệt nên mã phải đọc được; không
  đụng `cookie`/`localStorage` (đằng nào cũng không chạy trong origin mờ,
  chặn sớm cho tác giả khỏi ngơ ngác).

**Ngưỡng cụ thể đo từ ba course mẫu hiện có rồi mới chốt số — không bịa số
trước.** Skill `course-authoring` cập nhật theo: nó dạy cách ĐẠT chuẩn, luật
là thứ ĐO chuẩn.

---

## 7. CMS admin (`/admin` trong `apps/web`)

**Quyền:** cột `role` (`user` | `admin`) trên bảng users; middleware
`RequireAdmin` chắn API `/admin/*` và route UI. Mọi thao tác admin đụng
tiền/nội dung ghi vào `admin_audit(who, action, target, at, note)` — sổ cái
thao tác, không xoá.

| Màn hình | Có gì | Pha |
|---|---|---|
| Courses | danh sách + phiên bản · upload `.zip` (chạy đúng bộ validate publish, in đủ lỗi) · gỡ xuống · rollback về bản trước | 1 |
| Người dùng & credit | tìm user, số dư, sổ cái `ai_usage` · cộng/trừ credit tay, bắt buộc ghi chú | 2 |
| Bảng giá & prompt nền | sửa bảng quy đổi credit · sửa system prompt nền của agent | 2 |
| Billing & đối soát | đơn theo trạng thái · tiền về mồ côi → khớp tay · đánh dấu xử lý | 4 |

---

## 8. Số phận các cổng kiểm

| Cổng cũ | Số phận | Lý do ghi trong commit |
|---|---|---|
| `apps/web/src/ai/noKeyLeak.test.ts` | gỡ | không còn key nào phía client để canh |
| `apps/api/internal/server/no_key_transit_test.go` | **thay** | cổng mới: key nhà cung cấp từ env, không ra log, không ra response |
| `apps/web/src/test/accountHandoff.test.tsx` | gỡ | dữ liệu không còn trên máy — rủi ro nó canh biến mất về cấu trúc |
| `apps/web/src/db/local.test.ts` | gỡ | Dexie không còn |
| `RequireAuth.test.tsx` (nhánh ngoại tuyến) | gỡ | ngoại tuyến không còn là lời hứa |
| `apps/vault/**` (185 bài) | gỡ | vault không còn |
| `e2e/s2.spec.ts` | viết lại | quanh credit: số dư hiện, trừ đúng, hết chặn, config giữ |

**Cổng mới phải có:**

- Server từ chối gói có `SCRIPT_TAG` lúc publish (test gửi gói độc).
- e2e: iframe widget **không** `allow-same-origin`; từ trong widget không đọc
  được cookie/phiên.
- `apilog` không chứa thân hội thoại AI.
- Webhook billing nhận trùng không cộng trùng.
- Key nhà cung cấp không xuất hiện trong log và response (thay
  `no_key_transit_test.go`).

---

## 9. Thứ tự thi công

Nguyên tắc: **mỗi pha tự đứng được và ship được**. Không pha nào để lại nhánh
nửa vời trong `main`.

### Pha 1 — Course lên máy chủ

Format v2 (content + widget, luật widget), migration schema courses, publish
API + `tuhoc publish`, `/courses/*` công khai, reader đọc từ server, widget
sandbox, khung `/admin` + màn Courses, luồng import chết, **câu chữ ngoại
tuyến rời trang đăng nhập trong cùng pha**.

**Ship được:** ai cũng đọc được mọi course, không cần đăng nhập, không cần
import.

### Pha 2 — AI phía máy chủ, cắt vault

`internal/ai`, migration `ai_credits`/`ai_usage`/`user_agent_config` + bảng
giá, `POST /ai/chat` (SSE) + `GET /ai/credits` + `GET/PUT /ai/config`, agent
với tool đọc course + web search, credit đếm và trừ (chưa mua được), tặng
credit tài khoản mới, `useAI` chỉ còn đường server, Settings đổi khung kho
khoá thành credit + config agent, CMS thêm màn credit + bảng giá, **gỡ
`apps/vault` và các cổng §8 trong cùng pha, từng cái kèm lý do**.

**Ship được:** một đường AI duy nhất, agent thấy giáo trình, ít mã hơn hẳn.

### Pha 3 — Dữ liệu lên máy chủ

> **Sửa 2026-09-01 (Task 14):** hai dòng dưới đây, gạch ngang, là bản kế
> hoạch — đã ship KHÁC hai chỗ, ghi lại để plan và spec không nói hai
> chuyện. Chi tiết đầy đủ ở `docs/superpowers/plans/2026-09-01-pha3-ban-giao.md`.
>
> ~~`/progress` `/notes` `/annotations` nguồn sự thật qua TanStack Query,~~
> ~~`POST /migrate` di trú một lần, gỡ `db/` + `sync/`, `RequireAuth` bỏ nhánh~~
> ~~ngoại tuyến, agent thêm tool đọc tiến độ/ghi chú.~~
>
> Thứ đã ship: **hai** resource REST, không ba — `/notes` chưa bao giờ có
> bảng riêng, "ghi chú" luôn là cột `note` của chính hàng `annotations`
> (`apps/api/migrations/0001_init.up.sql`). Và **không có `POST /migrate`**:
> chủ dự án chọn không xây một endpoint di trú mới, mà giữ `POST /sync` cũ
> sống thêm một cửa sổ (gói `internal/sync`, xem chú thích đầu tệp
> `apps/api/internal/sync/handler.go`) làm đường flush một lần cho outbox cũ
> còn sót trên máy người học, rồi `apps/web/src/db/legacyDrain.ts` gọi đúng
> route ấy một lần rồi `indexedDB.deleteDatabase(...)` — flush trước, xoá
> sau, không đảo thứ tự. `GET /sync` thì xoá thật (không còn client nào gọi).
> `db/` không gỡ trọn — `apps/web/src/db/legacyDrain.ts` (cú flush một lần)
> và `db/localStorage.ts` (localStorage thường, không phải Dexie) còn sống;
> thứ gỡ là Dexie/`liveQuery`/outbox làm NGUỒN SỰ THẬT. `sync/` (bộ máy
> client, hai đồng hồ 15s) gỡ trọn, đúng như câu trên nói.

`/progress` và `/annotations` (ghi chú là cột `note` của annotation) nguồn sự
thật qua TanStack Query, một cú flush cuối qua `POST /sync` cũ rồi xoá
IndexedDB (không phải một endpoint `/migrate` mới), gỡ Dexie làm nguồn sự
thật + bộ máy `sync/` phía client, `RequireAuth` bỏ nhánh ngoại tuyến, agent
thêm tool đọc tiến độ/ghi chú (`read_my_notes`).

**Ship được:** cùng một tiến độ trên hai máy, không có bước đồng bộ nào.

### Pha 4 — Mua credit

SePay + Polar, `billing_orders`, webhook idempotent, trang mua trong
Settings, CMS thêm màn đối soát.

**Ship được:** tiền thật vào, credit thật cộng, đối soát được.

### Pha 5 — Quality gate cho generation

Đo ba course mẫu → chốt ngưỡng → luật chất lượng vào `course-format` →
pipeline generate chuẩn hoá thành một lệnh/skill duy nhất → cập nhật skill
`course-authoring`.

**Ship được:** một course mới sinh ra hoặc đạt chuẩn đo được, hoặc không
publish được.

---

## 10. Còn mở (không chặn pha nào)

1. **Giá cụ thể**: giá gói credit, tỷ lệ quy đổi, mức tặng thử — chốt ở Pha 4
   khi nhìn thấy giá vốn thật từ sổ `ai_usage` của Pha 2–3.
2. **Ngưỡng luật chất lượng**: đo từ ba course mẫu ở đầu Pha 5.
3. **Model mặc định**: **deepseek-v4-pro** (chốt 28/08/2026, giá per 1M token: $1,32 vào / $3,96 ra theo api-docs.deepseek.com ngày 28/08). Tiêu chí: tool use + chi phí phù hợp bài toán gia sư.
4. **Tài khoản SePay/Polar**: thủ tục đăng ký merchant nằm ngoài repo, cần
   xong trước khi Pha 4 ship.
