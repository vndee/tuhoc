# Task 4 — Cưỡng chế "key không bao giờ qua server" (HC-2)

**Ngày:** 2026-08-22 · **Nhánh:** `worktree-agent-a56aa70440380ef1a` · **Nền:** darwin 25.5.0,
go 1.25.5, bun 1.2.21, vitest 4.1.11

**Tệp:**
- `apps/api/internal/server/no_key_transit_test.go` (mới, 4 test)
- `apps/web/src/ai/noKeyLeak.test.ts` (mới, 6 test)

Không sửa một dòng mã sản phẩm nào. `git status` trước khi commit chỉ có đúng hai tệp trên.

---

## 1. Số tệp mỗi phép quét THẬT SỰ đọc

Con số do chính phép quét in ra lúc chạy, không phải do tôi đếm hộ nó:

| Phép quét | Tệp đọc được | Đối chiếu độc lập |
|---|---|---|
| Go — `goSources()` | **25** tệp `.go` (+1 tự loại trừ = chính dây bẫy) | `find . -name '*.go' -not -path '*/node_modules/*' -not -path './.git/*'` → **25** trước khi thêm tệp mới |
| Web — `readSources()` | **50** tệp sản phẩm `.ts/.tsx` | `find apps/web/src \( -name '*.ts' -o -name '*.tsx' \) | grep -v '\.test\.'` → **50** (tổng 93, trong đó 43 tệp test) |
| Web — giao thức | **1** tệp: `apps/vault/src/protocol.ts` | — |

Cả hai con số được in ra ở mọi lần chạy để không ai phải tin lời báo cáo này:

```
no_key_transit_test.go:324: phép quét đọc 25 tệp .go dưới <gốc repo> (bỏ qua 1 tệp: chính dây bẫy này)
[noKeyLeak] phép quét đọc 50 tệp sản phẩm dưới <apps/web/src>     ← cần --reporter=verbose
```

Cả 25 tệp `.go` của repo đều nằm dưới `apps/api/` (đo 2026-08-22); `tools/` và `packages/` có **0**
tệp Go, `go.work` chỉ `use ./apps/api`.

---

## 2. Mã thoát THÔ của mọi cổng

Lấy trực tiếp từ lệnh cần đo, không lấy từ cuối pipeline. `go test` chạy `-count=1`.

| Cổng | Lệnh | Mã thoát |
|---|---|---|
| Dây bẫy Go | `go test ./internal/server/ -run 'TestSourceScanIsNotVacuous\|TestServerNeverCallsAIProvider\|TestNoRequestStructAcceptsAKey\|TestAPIProductCodeMakesNoOutboundCall' -count=1 -v` | **0** (4 PASS) |
| `gofmt` | `gofmt -l internal/server/no_key_transit_test.go` | **0** (không in gì) |
| `go vet` | `go vet ./...` | **0** |
| API | `make test-api` | **0** |
| Dây bẫy web | `bunx vitest run src/ai/noKeyLeak.test.ts --reporter=verbose` | **0** (6 PASS) |
| Web | `make test-web` | **0** — 45 tệp / **764** test |
| Kiểu web | `bunx tsc -b` | **0** |
| Lint web | `bunx oxlint` | **0** (0 dòng nhắc `noKeyLeak`) |

**Một lần ĐỎ không do tôi, đã sửa và ghi ra vì nó là bẫy môi trường cho người sau:** lần chạy
`make test-web` đầu tiên thoát **2** (`make` thoát 2 khi rule lỗi; `bun run test` bên dưới thoát 1),
20/45 tệp test đỏ với `Failed to resolve import "parse5" from "../../packages/course-format/src/validate.ts"`.
Nguyên nhân là worktree này thiếu `packages/course-format/node_modules` — đúng điều
`apps/web/vite.config.ts` đã cảnh báo bằng chữ ở alias `@tuhoc/course-format`. Không liên quan tới
Task 4. Sửa bằng `cd packages/course-format && bun install` (mã thoát **0**), sau đó test-web xanh.
`apps/web/node_modules` cũng vắng và cũng phải `bun install`.

---

## 3. Đối chứng hai chiều — dây bẫy ĐỎ ĐƯỢC

Toàn bộ chạy trên **bản sao trong scratchpad**
(`<scratch>/t4/mutant`, `<scratch>/t4/webmut`), không mutate tệp được git theo dõi (ruling S1-F9).
Mọi mutant đều là mã **biên dịch được**, nên "đỏ" là đỏ vì khẳng định, không phải vì lỗi biên dịch.
Kịch bản tự hoàn nguyên và chạy lại baseline ở cuối để chứng minh không còn mutant nào sót.

### 3.1 Nửa Go — `<scratch>/t4/mut.py`

| # | Mutant | Kỳ vọng | Mã thoát | Test đỏ |
|---|---|---|---|---|
| — | baseline (không mutant) | XANH | **0** | — |
| A | `+ const mutantLeak = "api.deepseek.com"` vào `internal/course/handler.go` | ĐỎ | **1** | `TestServerNeverCallsAIProvider` |
| B | `+ // một dòng chú thích vô hại` vào cùng tệp ấy | XANH | **0** | — |
| C | `+ type mutantReq struct { K string \`json:"api_key"\` }` vào `internal/auth/handler.go` | ĐỎ | **1** | `TestNoRequestStructAcceptsAKey` |
| D | tệp sản phẩm mới `internal/apilog/mutant.go` với `import "net/http"` | ĐỎ | **1** | `TestAPIProductCodeMakesNoOutboundCall` |
| E | xoá `go.work` (neo gốc repo) | ĐỎ | **1** | fatal neo, xem dưới |
| F | xoá `cmd/api/main.go` (một tệp neo) | ĐỎ | **1** | fatal sentinel, cả 4 test |
| — | baseline lại | XANH | **0** | — |

Thông điệp A và C (nguyên văn, đã cắt):

```
apps/api/internal/course/handler.go: api.deepseek.com — máy chủ KHÔNG được gọi nhà cung cấp AI…
apps/api/internal/auth/handler.go: json:"api_key — không route nào được nhận key của người dùng…
```

**Case E lúc đầu là một phép đo SAI, và tôi giữ lại ghi chép đó:** lần chạy đầu nó đỏ với
`go: cannot load module ../../../../apps/api listed in go.work file` — tức là bộ nạp module của Go
hỏng vì bắt được một `go.work` cũ nằm ở **gốc scratchpad**, chứ không phải chốt neo của tôi hỏng.
Chạy lại ở `<scratch>/t4/nogw/` sau khi tạm dời `go.work` kia mới đo được cái cần đo:

```
GO_TEST_EXIT=1
no_key_transit_test.go:324: không tìm thấy go.work khi đi ngược lên từ "/" — phép quét này neo ở
gốc repo và KHÔNG tự lui về gốc module, vì một đường lui im lặng biến dây bẫy thành cổng mù.
```

Case F:

```
quét được 24 tệp nhưng THIẾU 1 tệp neo: apps/api/cmd/api/main.go. Nếu một tệp neo thật sự đã bị
xoá hoặc đổi tên thì sửa scanSentinels MỘT CÁCH CÓ Ý THỨC…
```

### 3.2 Nửa web — `<scratch>/t4/webmut.py` và `<scratch>/t4/floor.py`

| # | Mutant | Kỳ vọng | Mã thoát | Khẳng định đỏ |
|---|---|---|---|---|
| — | baseline | XANH | **0** | — |
| WA | tệp sản phẩm mới có `const apiKey = localStorage.getItem(...)` | ĐỎ | **1** | `expected [ 'src/ai/mutantLeak.ts' ] to deeply equal []` |
| WB | tệp sản phẩm mới chỉ có chú thích | XANH | **0** | — |
| WC | tệp sản phẩm mới có `https://api.deepseek.com/...` | ĐỎ | **1** | `[ 'src/ai/mutantHost.ts' ]` |
| WD | tệp sản phẩm mới `import … from '../../../vault/src/keystore'` | ĐỎ | **1** | `[ 'src/ai/mutantImport.ts' ]` |
| WG | `protocol.ts` mọc thêm `apiKey: string` | ĐỎ | **1** | `expected [ 'apiKey:' ] to deeply equal []` |
| WH | `protocol.ts` mọc thêm một chú thích **có chữ "key"** | XANH | **0** | — |
| WE | xoá tệp neo `App.tsx` | ĐỎ | **1** | `expected [ 'App.tsx' ] to deeply equal []` |
| WF | dời 6 thư mục khỏi `src/` | ĐỎ | **1** | `[ 'api/client.ts' ]` (chốt sentinel) |
| WI | kéo số tệp sản phẩm xuống **4** | ĐỎ | **1** | `expected 4 to be greater than or equal to 40` |
| — | baseline lại | XANH | **0** | — |

WH là đối chứng có chủ đích cho chỗ dễ đỏ oan nhất: chú thích tiếng Việt của `protocol.ts` nhắc chữ
"key" một cách hoàn toàn chính đáng ("chưa cắm key"), nên bộ dò phải bỏ chú thích trước khi soi.

**Một phép đo tôi làm hỏng lần đầu và sửa lại, vì nó dạy đúng bài học của task này:** WI ban đầu
được làm bằng cách **đổi tên** thư mục thành `pages.moved`, `reader.moved`… — và chốt đếm vẫn XANH,
vì `allSources` không loại trừ tên thư mục, nó vẫn đọc đủ 50 tệp trong các thư mục đã đổi tên. Tôi
tưởng chốt đếm hỏng; thật ra **phép đo của tôi mới hỏng**. Dời hẳn thư mục ra ngoài `src/` rồi mới
đo được (4 tệp → đỏ). Đây đúng là "cổng đo thứ nó với tới được", chỉ khác là lần này nạn nhân là
người đo.

---

## 4. Chỗ tôi bác kế hoạch, kèm phép đo

### 4.1 Bỏ hẳn phần loại trừ `internal/auth` — nó mua được **số không**

Kế hoạch bỏ qua gói `internal/auth` khỏi phép quét trường-mang-key, lý do "nó được phép đọc cookie
phiên của chính ta". **Tiền đề đúng, và không liên quan tới thứ đang bị cấm.**

Phép đo:

1. Đọc cookie phiên là `c.Cookies(CookieName)` — `internal/auth/handler.go:126` và `:226`. Trong
   `keyBearingFields` **không có needle nào chạm tới cookie**. Phép loại trừ bảo vệ một thứ vốn
   chưa từng bị đe doạ.
2. `grep -rniE 'api_key|apiKey|x-api-key|Authorization|access_token|json:"secret'` trên toàn
   `apps/api`: **đúng 1 kết quả**, ở `internal/course/course_test.go:1294`
   (`"Authorization": "Bearer " + id`, một test chứng minh server **phớt lờ** header đó). Không kết
   quả nào trong `internal/auth`. ⇒ phép loại trừ hôm nay **không đổi kết quả của một tệp nào**.
3. Cái nó bán đi thì có thật: `internal/auth` là gói duy nhất trong repo đã có sẵn nghiệp vụ chứng
   thực, nên nó cũng là chỗ có xác suất cao nhất mọc ra một đường đọc token từ header — và phép
   loại trừ theo tên gói sẽ nuốt đúng cái đó trong im lặng. Mutant **C** ở §3.1 đo chính điều này:
   với phép loại trừ của kế hoạch, C sẽ **XANH**; không có nó, C **ĐỎ** (mã thoát 1).

Đây cùng khuôn với S1-F43: một phần loại trừ viết bằng chữ, tiền đề đúng, **không liên quan**, và
mở ra một lỗ. Thay bằng: không loại trừ gói nào; nếu một chuỗi bị bắt oan thì sửa **danh sách
needle** ngay tại chỗ kèm lý do — hẹp hơn một bậc và có tên cụ thể, thay vì mở một cửa theo tên gói.

`json:"password"` (`auth/handler.go:43,49`) **không** nằm trong danh sách cấm và không nên nằm:
ranh giới ở đây là "key của bên thứ ba", không phải "chuỗi nhạy cảm".

### 4.2 Neo phép quét ở **gốc repo**, không ở `apps/api`

Kế hoạch dùng `filepath.Join("..", "..")` — cứng, và chỉ nhìn `apps/api`. Lời hứa nói về "máy chủ
của chúng ta", không nói về module Go tên `tuhoc-api`. Một dịch vụ Go mới ở `apps/aiproxy/` **chính
là** đường dự phòng qua server đã bị cấm hai lần, và phép quét neo ở `apps/api` sẽ im lặng tuyệt
đối về nó — cổng mù thứ sáu, đúng khuôn cũ.

Phép đo cho thấy đổi neo **không tốn gì hôm nay**: cả 25 tệp `.go` của repo đều nằm dưới `apps/api`,
nên kết quả y hệt; nó chỉ đổi điều xảy ra vào ngày có module Go thứ hai. Neo bằng `go.work`, **không
có đường lui im lặng** về gốc module (case E đo chốt này).

Kèm theo là mục bắt buộc `skippedDirs[".claude"]`: bản checkout chính giữ worktree của từng agent ở
`.claude/worktrees/agent-*/`, mỗi cái là **một bản sao đầy đủ của repo**. Thiếu dòng đó, phép quét
đọc cả mã của các agent khác và báo lỗi bằng đường dẫn của họ.

### 4.3 Chốt tự kiểm: thay `len(out) < 10` bằng **ngưỡng đo được + tệp neo**

Kế hoạch viết `if len(out) < 10` và chú thích "repo có 17 tệp .go không kể test". Con số 17 vẫn
đúng (25 tổng − 8 tệp test), nhưng ngưỡng 10 quá lỏng: nó vẫn XANH nếu phép quét chỉ với tới một
gói. Thay bằng ngưỡng **20** *và* — quan trọng hơn — một danh sách **6 tệp neo** đọc theo tên
(`cmd/api/main.go`, `internal/server/server.go`, và bốn handler đang bind body), cùng lập luận mà
`db/local.test.ts` đã viết cho danh sách năm bảng Dexie: **một con số vẫn xanh khi người ta thêm một
tệp và xoá một tệp khác**. Nửa web có ngưỡng **40** (đo được 50) và **5 tệp neo**.

Thêm chốt thứ ba mà kế hoạch không có: `self != 1`. Phép tự loại trừ phải khớp **đúng một** tệp —
chính dây bẫy. 0 nghĩa là tệp đã đổi tên (và mọi test sẽ đỏ vì tệp tự khớp danh sách cấm của mình);
>1 nghĩa là có bản sao của dây bẫy.

### 4.4 Thêm một lớp **không phụ thuộc tên nhà cung cấp**

Danh sách cấm 5 host không chứng minh được sự vắng mặt: một proxy đặt tên trường là `k` và đọc base
URL từ biến môi trường thì **không needle nào bắt được** — và đó là hình dạng một người có ý tốt sẽ
viết. `TestAPIProductCodeMakesNoOutboundCall` vá đúng lỗ đó: mã **sản phẩm** của API không gọi ra
ngoài, chấm hết. Một proxy bắt buộc phải gọi ra ngoài.

Đo được xanh: `"net/http"` xuất hiện ở **đúng 6 tệp**, **tất cả** là `*_test.go`
(`grep -rln '"net/http"' apps/api --include='*.go'`); **0** tệp sản phẩm. `fasthttp` chỉ xuất hiện
trong **chú thích** (`server.go:83`, `server_test.go:164`), nên needle khớp lời gọi chứ không khớp
chữ trần.

Chú thích trên hàm đã ghi sẵn **khi nào được nới**: hệ thống con 3 sẽ cần server đọc `index.json`
của registry (§4.1) và có thể cần token GitHub cho Discussions (§5). Cách đúng lúc đó là thêm một
danh sách cho phép **hẹp**, kèm lý do đích đến không phải nhà cung cấp AI — không phải xoá test.

### 4.5 Thêm ba phép quét web mà kế hoạch không yêu cầu

Kế hoạch chỉ có "không tệp nào chạm `apiKey`" + "Dexie năm bảng". Thêm:

- **Không tệp sản phẩm nào của trang chính nhắc host nhà cung cấp.** Chỉ `apps/vault` — mã duy nhất
  chạy ở origin giữ key — được phép gọi thẳng. Đo: **0** kết quả trên `apps/web/src` *và* trên
  `apps/vault/src` hôm nay (Task 3 chưa viết `providers/*`).
- **Không tệp sản phẩm nào nhập ruột kho khoá.** `vite.config.ts` đã ghi bằng chữ "đừng bao giờ
  alias thứ gì khác của apps/vault/", nhưng chú thích không chặn được
  `import { readKey } from '../../vault/src/keystore'` — đường dẫn tương đối không cần alias nào.
  `keystore.ts` và `providers/*` **chạm** key; kéo chúng vào bundle trang chính là tự tay bốc key về
  đúng cái origin kiến trúc này dựng lên để giữ nó ra ngoài. Đo: **0** kết quả (chỗ nhắc `vault` duy
  nhất trong `apps/web/src` là `ai/protocolAlias.test.ts` nhập `@vault-protocol`).
- **Giao thức không có trường mang key.** Xem §5 — đây là chỗ tôi lo nhất, và cũng là chỗ phép quét
  theo tên hết tác dụng.

---

## 5. Mối lo tôi KÉM CHẮC CHẮN NHẤT

**Cả hai dây bẫy đều quét VĂN BẢN, nên chúng chỉ thấy TÊN. Chúng không thấy DÒNG DỮ LIỆU.**

Cụ thể, kịch bản mà tôi **không** chặn được và cũng không biết cách chặn trong phạm vi hai tệp này:

```ts
// một tệp tương lai của apps/web/src, hoàn toàn xanh với cả sáu phép quét
const resp = await ask(vault, { kind: 'status' });
localStorage.setItem('cfg', resp.value);   // 'value' tình cờ là key
```

Không chữ `apiKey`, không host, không import ruột kho khoá, không bảng Dexie thứ sáu. Sáu phép quét
im lặng hoàn toàn.

Chỗ chặn thật **không nằm ở phía trang chính** — nó nằm ở **hình dạng giao thức**: nếu
`VaultResponse` không có `kind` nào trả key ra thì `resp.value` không tồn tại để mà gán. Hôm nay
`protocol.ts` đúng như vậy (`status` chỉ trả `configured: boolean`; **không** có `kind` nào để đọc
key, kể cả cho trang cấu hình — key được nhập TRONG khung kho khoá, Task 6). Tôi đã khoá điều đó lại
bằng phép quét thứ năm ở nửa web, và mutant WG/WH chứng minh nó đỏ/xanh đúng chiều.

**Nhưng tôi kém chắc chắn ở ba điểm, xếp theo mức lo giảm dần:**

1. **Phép quét giao thức bắt tên trường, không bắt Ý NGHĨA.** `{ kind: 'export'; value: string }`
   mang key ra ngoài mà không dùng bất kỳ từ nào trong danh sách. Tôi không biết cách đóng lỗ này
   bằng một phép quét văn bản, và tôi nghĩ **không có cách nào** — nó cần một người đọc bản khác
   biệt của `protocol.ts` và hỏi "trường này chở gì". Đề nghị đưa vào `docs/carried-forward.md`:
   *mọi thay đổi `apps/vault/src/protocol.ts` phải được đọc thủ công với đúng một câu hỏi — thông
   điệp mới này có chở được key ra khỏi origin kho khoá không?*
2. **Nửa web chỉ quét `apps/web/src`.** `apps/web/e2e/**` (đã biết là không được `tsc` kiểm),
   `vite-plugins/`, và bất kỳ ứng dụng mới nào ngoài `apps/web` đều nằm ngoài tầm. Nửa Go đã neo ở
   gốc repo nên nó phủ mọi module Go; nửa web thì không có neo tương đương, và một proxy viết bằng
   TypeScript (Worker, `apps/proxy/`) sẽ **thoát cả hai**. Tôi cân nhắc quét host nhà cung cấp trên
   toàn repo theo mọi phần mở rộng và **bỏ**, vì `docs/` và chính kế hoạch này liệt kê đủ năm host
   — dây bẫy sẽ đỏ ngay trên nền sạch. Một phiên bản đúng cần danh sách cho phép theo thư mục
   (`apps/vault/**` được, `docs/**` được, còn lại không), và tôi không đủ chắc về ranh giới ấy để
   viết nó hôm nay.
3. **`getreqheaders()` là needle dễ đỏ oan nhất** trong `keyBearingFields`. Nó là cách một proxy
   "chuyển tiếp tất cả" sẽ được viết, nhưng nó cũng là cách một người ghi log request sẽ được viết.
   Hôm nay repo dùng nó **0 lần**. Thông điệp lỗi đã nói rõ cách nới có ý thức; nếu nó đỏ vì việc
   không liên quan tới key thì đó là ứng viên số một để gỡ.

**Một mối lo nhỏ hơn nhưng cụ thể:** `noKeyLeak.test.ts` đọc `apps/vault/src/protocol.ts` bằng
đường dẫn tương đối. Một agent khác đang làm Task 2 trong `apps/vault/`; nếu `protocol.ts` bị dời,
test này đỏ với `ENOENT` chứ không phải với một thông điệp hữu ích. Tôi chấp nhận đánh đổi đó —
đỏ-ồn-ào vẫn hơn xanh-vì-không-đọc-gì — nhưng nó là điểm ma sát có thật giữa hai task chạy song song.

---

## 6. Điều Task này CỐ Ý không làm

- **Không** dùng `app.GetRoutes()`. HC-2 đã lập luận; tôi chỉ xác nhận bằng đo: bảng route của Fiber
  không biết handler đọc trường nào từ body, nên một test dựa vào nó luôn xanh.
- **Không** sửa mã sản phẩm. Không phép quét nào đỏ trên nền hiện tại, nên không có gì để sửa —
  nếu có, chỉ dẫn là DỪNG và báo, không phải nới test.
- **Không** động vào `apps/vault/` (Task 2 của agent khác). Chỉ **đọc** `protocol.ts`.
- **Không** đụng chốt gốc ở `apps/web/src/db/local.test.ts`. Phép quét Dexie ở đây **lặp lại** nó từ
  phía lời hứa BYOK, cố ý, để người thêm bảng `keys` gặp câu hỏi ở cả hai nơi.
