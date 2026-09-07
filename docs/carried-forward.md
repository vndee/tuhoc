# Nợ mang sang giai đoạn sau — kết chuyển từ P1

Ghi lại lúc kết thúc P1 (nhánh `p1-platform-core`, 37 commit, hợp nhất vào `main`).
Đây là những gì P1 **cố ý** để lại, kèm lý do và nơi phải xử lý. Sổ thực thi chi tiết
(`.superpowers/sdd/…`) nằm ngoài git và đã bị dọn; file này là bản lưu bền của phần còn giá trị.

---

## 1. Việc bắt buộc phải làm ở giai đoạn sau

| # | Nội dung | Nơi xử lý | Vì sao |
|---|---|---|---|
| ~~C-1~~ | ~~**Rò rỉ chéo tài khoản qua nhiều tab.**~~ **ĐÃ ĐÓNG** ở hệ thống con 4, Task 1 — xem mục "C-1 — ĐÃ ĐÓNG" bên dưới để biết **cách kiểm lại**. | ~~P4~~ | — |
| ~~C-2~~ | ~~**`GET /courses` chưa tồn tại.**~~ **ĐÃ ĐÓNG.** Route công khai nay ở `apps/api/internal/server/server.go` (`app.Get("/courses", catalogHandler.PublicList)`), và `KNOWN_COURSE_IDS` đã bị xoá khỏi `Dashboard.tsx` — chỉ còn được nhắc trong hai chú thích kể lại chuyện cũ. Kiểm lại: `cd apps/api && go test ./internal/catalog/ -run TestPublicList -count=1` (cần Docker). | ~~P4~~ | — |
| ~~C-3~~ | ~~**Escape hatch `SameSite=None` thiếu yêu cầu CSRF.**~~ **ĐÃ ĐÓNG** ở hệ thống con 4, Task 2 — xem mục "C-3 — ĐÃ ĐÓNG" bên dưới. | ~~P4~~ | — |

## C-3 — escape hatch `SameSite=None` — ĐÃ ĐÓNG (hệ thống con 4, Task 2)

**Món nợ này đóng bằng một QUYẾT ĐỊNH, không bằng mã.** Cookie phiên vốn đã là `SameSite=Lax`
(`apps/api/internal/auth/handler.go:164,180`); C-3 chỉ cắn nếu chọn phương án **tên miền miễn phí** ở
`docs/deploy.md` §0, thứ bắt buộc `None`. Chủ dự án đã có `duy.dev` và chốt `tuhoc.duy.dev` +
`api-tuhoc.duy.dev` — khác **origin** nhưng **cùng site**, nên `Lax` là đủ và **không cần
đổi một dòng mã nào**. (Bố cục ấy từng có một tên miền con thứ ba, `vault.duy.dev`, cho kho khoá;
Pha 2 Task 16 gỡ kho khoá. Lập luận "cùng site" không phụ thuộc vào số tên miền con.)

Cái đã thêm là chỗ **ghi quyết định ấy lại** để nó không bị gỡ trong im lặng:
`apps/api/internal/auth/csrf_samesite_test.go` — `TestSessionCookieIsNeverSameSiteNone`, hai nửa:

- **nửa cấu trúc** quét mọi tệp `.go` của repo: không chỗ nào được đặt `SameSite=None`, **và** số lời
  gọi `c.Cookie(&fiber.Cookie{` phải **bằng** số lần đặt `SameSite: fiber.CookieSameSiteLaxMode`.
  Đếm **cân bằng** chứ không chốt con số cố định: thêm một cookie hợp lệ (cũng `Lax`) vẫn xanh, còn
  bỏ thuộc tính đi thì đỏ — trình duyệt **không thống nhất** về mặc định khi thiếu `SameSite`, nên
  "không ghi" khác "ghi Lax";
- **nửa hành vi** đọc header `Set-Cookie` thật trên **register, login, và logout**, với cả hai giá trị
  `COOKIE_SECURE`.

**Vì sao cần nửa cấu trúc dù đã có nửa hành vi:** bài kiểm cũ (`auth_test.go:319`) chỉ soi cookie của
**register**. Đo ngày 2026-08-22: đổi `clearSessionCookie` (dòng 180) sang `None` thì **toàn bộ gói
`internal/auth` vẫn xanh, exit 0**. Một trong hai chỗ đặt cookie chưa từng có ai canh.

### Cách kiểm lại

```
cd apps/api && go test ./internal/auth/ -run TestSessionCookieIsNeverSameSiteNone -count=1
```

Đối chứng hai chiều đã đo (mỗi lần khôi phục trong cùng lệnh shell, `shasum` khớp hai đầu):

| Đột biến | Mã thoát |
|---|---|
| nền sạch | 0 |
| `setSessionCookie` (dòng 164) → `None` | **1** |
| `clearSessionCookie` (dòng 180) → `None` | **1** |
| xoá hẳn dòng `SameSite` ở `clearSessionCookie` | **1** |
| `clearSessionCookie` → `None`, **không có** tệp gate | 0 ← lỗ hổng cũ |

**Nếu một ngày thật sự cần `None`:** thứ tự bắt buộc là (1) dựng phòng thủ thay thế — kiểm Origin
hoặc double-submit token — trên mọi route đổi trạng thái; (2) **thay** test này bằng test canh phòng
thủ ấy; (3) mới đổi thuộc tính. Xoá test mà không thay là quay lại đúng trạng thái C-3 mô tả.

## C-1 — rò rỉ chéo tài khoản qua nhiều tab — ĐÃ ĐÓNG (hệ thống con 4, Task 1)

**Lỗi cũ, phát biểu bằng cái hại:** cookie phiên là **một giá trị cho cả origin**, còn mọi tín hiệu
"ai đang đăng nhập" thì **theo từng tab** — cache `useMe` (`staleTime` 60 s), guard `<Navigate>` ở
`/login`, và state module của sync engine (`timer`, `inFlight`, `syncEpoch`). Nên tab 2 để mở ở trang
đọc của A vẫn chạy chu kỳ 15 giây sau khi có người đăng nhập thành B ở tab 1: `POST /sync` đẩy tiến độ
và ghi chú của A **vào tài khoản B**, còn `GET /sync` kéo bản ghi của B xuống một cơ sở dữ liệu cục bộ
mà tab 2 vẫn hiển thị như của A. Rò **cả hai chiều**.

**Cách vá:** `apps/web/src/auth/sessionIdentity.ts` — một `BroadcastChannel` (`tuhoc-session-identity`)
chở danh tính phiên giữa các tab. Ba đầu dây:

- `api/useMe.ts` công bố câu trả lời của `useMe` (nguồn DUY NHẤT công bố danh tính — xem chú thích tại
  chỗ để biết vì sao công bố thêm ở `fetchMe` đã bị **đo là làm cả hai chỗ không thể bị giết**);
- `auth/session.ts`'s `clearSession()` công bố `null` **đồng bộ, ở dòng đầu tiên** — tín hiệu sớm nhất
  có thật, đi trước trọn một vòng IndexedDB của `clearLocalData()`;
- `sync/engine.ts` **đọc đồng bộ** `sessionWasSuperseded()` ở đầu `runCycle` (nửa chịu lực — không phụ
  thuộc việc sự kiện có tới nơi hay không) **và** đăng ký nghe bus trong `startSync` (nửa nhanh — tháo
  timer trong một task thay vì chờ tới 15 giây). `stopSync()` nhả cả ba.

**KHÔNG dùng `localStorage`/`storage` event** dù đó là phương án dự phòng quen thuộc: phép quét
"no third place for user data to hide" ở `apps/web/src/db/local.test.ts` **cấm** mọi tệp sản phẩm dưới
`apps/web/src` chạm `localStorage`/`sessionStorage`/`indexedDB`/`caches`/`document.cookie` ngoài
`db/local.ts`. `BroadcastChannel` không phải nơi cất dữ liệu nên nằm ngoài luật ấy một cách trung thực.

### Cách kiểm lại

```
cd apps/web && bunx vitest run src/sync/crossTabSession.test.tsx
```

5 bài, và **hình dạng của chúng mới là thứ đáng giữ**:

1. Hai "tab" là hai **đồ thị module riêng** (`vi.resetModules()` + `import()` động) trên cùng
   `BroadcastChannel` và cùng IndexedDB — đúng thế chia của hai tab thật. Cho hai tab dùng chung một
   instance engine thì `stopSync()` của tab 1 sẽ dừng vòng lặp của tab 2 và bài kiểm sẽ **xanh với một
   ứng dụng không có điều phối liên tab nào cả**.
2. **Khẳng định ngược là bắt buộc:** mỗi bài chứng minh tab 2 **CÓ** gửi trước tín hiệu, bằng **so bằng
   đúng** trên tập bản ghi đã tới máy chủ. Thiếu nửa này thì một engine không bao giờ đồng bộ cũng xanh.
3. Outbox được **nạp lại SAU** cú bàn giao, vì `clearSession()` của tab 1 dọn sạch IndexedDB dùng chung
   — nếu không, "tab 2 không gửi gì" đúng vì **không còn gì để gửi**.
4. Khẳng định phủ định **không bao giờ đi qua `waitFor`**: gọi thẳng `syncOnce()` rồi so số đếm.

**Đối chứng đột biến (đã đo 2026-08-22; sổ thực thi nằm dưới `.superpowers/`, **không có trong git** —
xem mục E ở cuối tệp này):**
5/5 đột biến thật **chết**, đột biến đối chứng chỉ-sửa-chú-thích **sống**. Sửa mã ở đây thì **đo lại
bằng đột biến**, đừng suy luận — bản đầu của bài kiểm số 2 dùng `waitFor` và **đã bị đo là vô dụng**:
đột biến "xoá hẳn phần đăng ký nghe bus" **sống sót, xanh trong 15 091 ms**, vì `asyncUtilTimeout` của
`src/test/setup.ts` đúng bằng 15 000 ms — bằng đúng chu kỳ timer của engine — nên phép chờ đã sống lâu
hơn nhịp tick thật, và nhịp ấy tự gọi `runCycle` rồi tự tháo timer. Bài kiểm được thoả mãn bởi **chính
cơ chế nó phải đo độc lập**. Đây là bài học S2 Task 9 lặp lại nguyên hình.

**Còn hở, ghi để không ai tưởng đã kín:**

- **Cửa sổ giữa "cookie đã đổi" và "tín hiệu được phát" không đóng được từ phía client.** Cookie thành
  của B ngay khi `POST /auth/login` trả về; tín hiệu sớm nhất là `clearSession()` vài dòng sau. Chỉ
  server mới đóng hẳn được (ví dụ mỗi phản hồi mang theo id phiên để client đối chiếu).
- **Tab bị chặn chỉ **dừng đồng bộ**, không bị đẩy sang `/login`.** Nó vẫn hiển thị cây React cũ của A
  cho tới khi `useMe` của chính nó làm mới (60 s, hoặc khi cửa sổ được focus). Không có dữ liệu mới nào
  chảy, nhưng màn hình thì vẫn là của A.
- **Không có `BroadcastChannel` thì phép vá không mua được gì** (hành vi đúng bằng hôm nay). Nền tảng
  hỗ trợ từ Safari 15.4 (2022), nên đây là đuôi trình duyệt rất cũ, không phải đường sống.

## 2. Cảnh báo cho người sửa code sau này

- **Đừng thêm "đồng bộ ngay khi đăng nhập".** Tính an toàn của bản vá rò rỉ chéo tài khoản dựa **một phần** vào việc `startSync()` chỉ đăng ký timer 15s chứ không chạy cycle ngay. Nếu thêm `syncOnce()` vào `useSyncLifecycle`, biên an toàn đó biến mất. Test `Login.test.tsx` "clears every local table before a sync cycle for the new session can start" sẽ bắt được — **phải giữ test đó**.
- **`clearLocalData()` trong `apps/web/src/db/local.ts` là điểm chân lý duy nhất** cho việc xóa dữ liệu cục bộ, và nó liệt kê bảng qua `db.tables` để không lỗi thời. Đừng inline lại `Promise.all([...clear()])` — trước đây có 8 bản sao và bản quan trọng nhất là bản dễ quên nhất. Lưu ý `db/local.test.ts` assert `db.tables` có 4 bảng như một tripwire; khi thêm bảng thứ 5, sửa con số đó chứ đừng "sửa" helper.
- **Cursor đồng bộ là giá trị đục.** Server trả về mốc đã lùi 60 giây có chủ đích, để chống mất dữ liệu do thứ tự commit khác thứ tự dấu thời gian. Client phải gửi lại **nguyên văn** — không parse, không tự tính từ `updatedAt`. Việc nhận lại bản ghi đã có là cơ chế đang chạy đúng, không phải lỗi.
- **Múi giờ UTC+7 chỉ còn một nguồn** (`icTZOffset` trong `apps/api/internal/stats/handler.go`, truyền vào SQL dạng tham số). Đừng viết lại số 7 ở chỗ thứ hai — nếu hai chỗ lệch nhau, dữ liệu quanh nửa đêm hỏng **âm thầm**.
- **`rtk` VIẾT LẠI `make test-e2e`, và trả về mã thoát của CHÍNH NÓ — cổng có thể báo xanh mà chưa
  hề chạy.** Xác minh 2026-08-21: `rtk rewrite 'make test-e2e'` → `rtk make test-e2e`. Lần chạy đầu
  ở Task 8 trả `EXIT=0` với log 77 dòng **bị đảo thứ tự và KHÔNG có phần Playwright nào** — tin nó
  thì đã báo một cổng xanh chưa từng chạy. **Luôn dùng `rtk proxy make test-e2e`** và kiểm log có
  phần Playwright thật.
  Đã kiểm từng lệnh cổng: **chỉ `make test-e2e` bị viết lại**; `bun run test/build/lint`,
  `bunx tsc -b`, `bunx playwright test`, `docker compose`, `docker pull` đều đi thẳng.
  Cộng dồn các vấn đề `rtk` đã gặp: in "Success" cho lệnh thật ra exit 1 · lược dòng khỏi `git log`
  (giấu mất merge commit) · viết lại `cat`/`grep` làm lệnh hỏng · và nay: **bọc cả cổng nghiệm thu**.
  Quy tắc: mọi thứ bạn dựa vào để KẾT LUẬN phải chạy qua `/usr/bin/…` hoặc `rtk proxy`.
- **`apps/web/e2e/**` KHÔNG được `tsc -b` kiểm kiểu** — không tsconfig project nào bao nó. Áp cho cả
  `p1.spec.ts` lẫn `p2.spec.ts`. Cùng lớp với hai cổng mù ở trên: cổng vẫn chạy, vẫn xanh, chỉ là
  không nhìn vào thứ nó tưởng đang nhìn.
- **`tsc --noEmit` ở `apps/web` là CỔNG RỖNG — đừng dùng nó để nghiệm thu.** `apps/web/tsconfig.json`
  dùng `"files": []` + `references`, và cờ `--noEmit` **không đi vào references**. Chứng minh: tiêm
  `const x: number = "chuỗi"` vào một file thật rồi chạy → `tsc --noEmit` **exit=0**, `tsc -b` **exit=2**.
  Cổng kiểu thật là **`tsc -b`** (và `bun run build`, vốn gọi `tsc -b`). Phát hiện ở vòng sửa P2 Task 1,
  sau khi cổng mù này đã được dùng làm "bằng chứng" một lần. Cùng lớp lỗi với cổng e2e từng mù với
  thay đổi Go: cổng vẫn chạy, vẫn báo xanh, chỉ là không nhìn vào thứ nó tưởng đang nhìn.
- **Cổng nghiệm thu luôn rebuild image API** (`docker compose up -d --build`). Đừng "tối ưu" bằng cách pre-build rồi bỏ `--build` — đó chính là lỗ hổng khiến cổng từng mù với mọi thay đổi Go.

## 2B. Nợ kết chuyển từ P2 — hai mục review tổng thể tìm ra

### P2-C1 · Last-write-wins áp theo DÒNG, không theo TRƯỜNG — và P2 là thứ đưa văn xuôi người dùng vào

Đo được trên **hai thiết bị thật** (review tổng thể P2, có ngăn xếp đầy đủ):

> Máy A xoá một ghi chú. Máy B **chưa kịp kéo về tombstone** nên vẫn thấy ghi chú, và người dùng
> sửa chữ trên đó. Kết quả: **ghi chú SỐNG LẠI trên cả hai máy**, `deletedAt` về `null`.

Doc của `remove` nói tombstone "propagates the deletion" — **không đúng vô điều kiện**.

Nguy hiểm hơn ở đường `reattach`: cùng cơ chế đó sẽ **âm thầm nuốt mất chữ** người dùng vừa gõ ở
thiết bị kia. Không exception, không cảnh báo, chỉ là một phiên bản thắng.

**Vì sao P1 không gặp:** P1 chỉ đặt `progress` — **một boolean** — dưới quy tắc này. Mất một
boolean thì cùng lắm là mất dấu tích "đã đọc". **P2 là giai đoạn đầu tiên đưa VĂN XUÔI người dùng
vào cùng quy tắc**, và mất văn xuôi thì không lấy lại được.

Sửa đúng = hợp nhất theo TRƯỜNG (hoặc tombstone thắng tuyệt đối), tức đổi giao thức đồng bộ cả hai
phía — không phải việc vá trước khi hợp nhất. **Phải quyết ở giai đoạn sau.** Đừng để nó im lặng.

### P2-C2 · Spec §5 hứa những thứ KHÔNG task nào được giao xây — và chúng HIỆN TRÊN MỌI TRANG

Toàn bộ 13 gạch đầu dòng về annotation của §5 **đều tồn tại và đã được thấy chạy**. Nhưng nửa
thuộc P1 thì không, và người dùng nhìn thấy:

- thanh bên in nguyên chuỗi giữ chỗ **`Tiến độ sẽ hiện ở đây`**;
- ô tìm chương ở trạng thái **`disabled`**;
- `#progbar` **không ai ghi vào** ⇒ vĩnh viễn 0%;
- `a.nav-item.active` có CSS nhưng **không ai set** ⇒ không bao giờ sáng;
- `/c/:course` thiếu "tiến độ từng phần";
- thiếu phím tắt `/` và `Escape` vốn có ở bản v1 một-file.

Khác **C-2** (`GET /courses`) ở một điểm quan trọng: **không mục nào trong số này từng được ghi
vào tài liệu nào**. Đây là cùng lớp lỗi với C-2 — *spec liệt kê, không ai được giao, không ai phát
hiện* — và lần này nó **hiển thị ra màn hình**.

## 3. Nợ kỹ thuật đã ghi nhận, chấp nhận mang theo

- `TestPool` nằm trong `internal/store` (không phải `internal/storetest`), kéo `testing` + ~15 package testcontainers/docker vào đồ thị phụ thuộc của binary production 17MB trên image `FROM scratch`. Không có chi phí runtime (linker loại bỏ) nhưng công cụ quét bảo mật sẽ báo CVE của testcontainers cho service này. Sửa = di chuyển file, nhưng đổi tên interface mà 3 task phụ thuộc.
- `stats.courses[].chaptersDone` được tính mỗi request nhưng **không ai dùng** con số ấy để vẽ (đo lại 2026-09-02: không dòng TSX nào đọc trường này, chỉ có trong Go test và trong chú thích). Một truy vấn thừa mỗi lần gọi `/stats`. **Ruling F5 gốc — "vòng tiến độ lấy từ dữ liệu cục bộ, đúng cả khi không có mạng" — ĐÃ HẾT HIỆU LỰC (Pha 3, Task 6/9): xem mục "Ruling F5 — nửa RETIRED, nửa còn sống" bên dưới cho lý do và cho một khẳng định sai mà chính pha này để sót.**
- `Require(pool)` và `RequireWithUsecase(uc)` là hai cửa vào cho cùng một middleware; `server.go` dựng 4 cặp `Repo`/`Usecase` thừa trên cùng một pool.
- Chưa có: bộ quét phiên hết hạn, index trên `sessions.expires_at`, kiểm tra độ dài mật khẩu phía server, cấu hình CI.
- ~~giới hạn kích thước batch cho `/sync` và `/events/batch`~~ — **ĐÃ LÀM ở hệ thống con 1** (Task 6
  đặt trần server sau khi đo được khuếch đại bộ nhớ ~20×: thân 21 MiB → ~420 MiB; Task 6b cho client
  chia lô để trần đó không tạo ra trạng thái kẹt vĩnh viễn).
- `_redirects` chưa có test tự động (được ghi nhận trung thực trong cả test lẫn `docs/testing.md`).
- Nửa annotation của phép clamp dấu thời gian tương lai chưa có test (code đã đọc kiểm, đúng).
- Một trong 11 chỗ trả lỗi 500 (`HeartbeatCourseCounts`) có log nhưng không có test, vì lý do cấu trúc đã ghi trong `observability_test.go`.
- `clearLocalData()` thất bại (hết dung lượng, nâng cấp DB bị chặn) để lại trạng thái nửa chừng: đã xác thực là người mới nhưng dữ liệu cũ chưa xóa. Xác suất thấp, chưa có xử lý.
- 3 lỗi nhỏ từ đợt sửa cuối: doc comment trong `RequireAuth.tsx` nay sai (Login **có** gọi `useMe`, nhưng không gây vòng lặp vì `redirectOn401: false`); thông báo lỗi hiển thị "không kết nối được máy chủ" khi thực ra là lỗi lưu trữ.

## 4. Giới hạn của bộ kiểm thử — biết để không tin nhầm

- **Phép đếm điểm ảnh canvas chỉ là kiểm tra "còn sống".** Ngưỡng 0.005 bắt được canvas không vẽ gì (đúng 0), nhưng **không** phân biệt được "chỉ vẽ trục, không vẽ dữ liệu" với một mô phỏng vẽ đúng — vì trục của một số biểu đồ chiếm nhiều điểm ảnh hơn toàn bộ nội dung của mô phỏng khác. Thứ thật sự phát hiện phụ thuộc thiếu là bộ ba: kiểm `data-done`, kiểm hai chuỗi thông báo lỗi của `initViz`, và bộ thu lỗi console/page.
- **Kiểm tra parity với bản gốc** chỉ so cấu trúc cho 41/44 chương; 3 chương được xem bằng mắt với một mô phỏng mỗi chương.
- **Cookie chỉ được kiểm trên `localhost`** (cùng site). Không có kiểm thử tự động nào bắt được hồi quy về cấu hình cross-origin — đó là lý do quyết định tên miền ở `docs/deploy.md` §0 phải được đọc trước khi deploy.

## Cổng mù #4 — tính năng không có điểm vào (S1-F29) — ĐÃ ĐÓNG

> **Trạng thái: đã nối dây** (vòng sửa 9+10). `pages/Library.tsx` mở `UpdateDialog` từ hàng của một
> course mà máy đang giữ bản cũ hơn bản máy chủ ghim; `pages/Library.test.tsx` bấm nút đó bằng
> `userEvent` và đọc hộp thoại thật, và hộp thoại đã được **nhìn trong Chromium thật** ở cả hai
> theme, ở 1280px và 390px (mục §3 của `fix-9-10-report.md`). Đối chứng đột biến: vô hiệu hoá cửa
> vào ⇒ **2 bài đỏ**. Bài học bên dưới **vẫn nguyên giá trị** cho mọi lần chạy song song còn lại.

Sau khi gộp Task 9 + Task 10 của hệ thống con 1, `apps/web/src/course/UpdateDialog.tsx` (297 dòng)
và `course/version.ts` (478 dòng) **không được tệp sản phẩm nào import** — chỗ nhắc duy nhất là một
chú thích ở `reader/useCourseKit.ts:47`. Trong khi đó `bun run test` 713 xanh, `tsc -b` 0,
`bun run build` 0, `bun run lint` 0.

**Cái giá của khe hở này, đo được sau khi nối dây:** ngay khi hộp thoại có người bấm tới, nó lộ ra
một lỗ hổng **Critical** đã nằm im trong mã suốt cả vòng (S1-F30 — node DOM tách rời không hề trơ,
`previewUpdate` chạy `on*` của gói ở phiên bản người dùng **chưa chấp nhận**). Một tính năng không ai
với tới được không phải là một tính năng an toàn; nó là một tính năng **chưa ai kiểm**.

**Không cổng nào của dự án hỏi được câu "người dùng có bấm tới được không."** Chỉ e2e hỏi được, và
chỉ khi nó đi qua giao diện thật thay vì gọi thẳng hàm.

Đây là cổng mù **thứ tư**, cùng họ với ba cái trước: cổng e2e của P1 mù với thay đổi Go;
`tsc --noEmit` xanh với lỗi kiểu hiển nhiên vì `"files": []`; `rtk` bọc `make test-e2e` rồi trả mã
thoát của chính nó. **Đặc điểm chung: cổng đo thứ nó với tới được, và im lặng đúng chỗ nó không với
tới.**

**Áp cho mọi lần chạy song song còn lại (hệ thống con 2, 3, 4):** khi task A tạo *điểm vào* cho
task B, việc **nối dây là một hạng mục riêng của vòng hợp nhất**, phải kiểm bằng câu hỏi "có ai
import không" — vì không cổng tự động nào hỏi hộ. Khe hở này **không phải lỗi người cài đặt**
(Task 10 đã tự khai đúng nó ở dòng đầu mục "Concerns"); nó sinh ra từ việc chạy song song, nên nó
thuộc về điều phối viên.

## Giao thức kho khoá: dây bẫy quét CHỮ, không quét luồng dữ liệu (S2-F8) — **HẾT HIỆU LỰC (Pha 2, Task 16)**

> **Trạng thái: mục này KHÔNG còn là một luật đang chạy.** Pha 2 Task 16 gỡ `apps/vault`, nên không
> còn giao thức nào để đọc bằng mắt và không còn phép quét nào trong sáu phép ấy. Giữ lại vì **hình
> dạng của lỗ** là thứ sẽ quay lại nguyên vẹn ngay khi có một bí mật của người dùng đi qua một ranh
> giới nào đó lần nữa — và vì nó đặt tên cho một lớp cổng mà repo này vẫn còn nhiều: **cổng quét CHỮ
> không đo được LUỒNG DỮ LIỆU.**

Hệ thống con 2 có sáu phép quét nguồn cưỡng chế lời hứa *"key không bao giờ đi qua máy chủ"*. Tất cả
đều quét **chữ**. `const k = resp.value` mang key qua cả sáu mà không viết chữ "key" ở đâu.

Hàng rào thật là **hình dạng giao thức**: hôm nay `apps/vault/src/protocol.ts` sạch — `status` chỉ trả
`configured: boolean`, không message kind nào đọc key ra. Phép quét web thứ năm khoá điều đó, nhưng nó
khớp **tên trường**, không khớp **nghĩa**: `{ kind: 'export'; value: string }` sẽ lọt.

⇒ **Mọi thay đổi `apps/vault/src/protocol.ts` phải được đọc bằng mắt người, với đúng một câu hỏi:
*"thông điệp mới này có mang được key ra khỏi origin kho khoá không?"*** Không cổng tự động nào hỏi
hộ câu ấy, và người cài đặt Task 4 lẫn điều phối viên đều cho rằng không phép quét chữ nào đóng được.

**Lỗ liên quan, chưa đóng:** nửa web của dây bẫy chỉ phủ `apps/web/src`. Một proxy viết bằng
TypeScript (`apps/proxy/`, một Worker) **thoát cả hai nửa** — nửa Go phủ toàn repo, nửa web không có
neo tương đương.

**Lần đọc bằng mắt đã diễn ra: `kind: 'setLang'` (2026-08-23).** Thành viên đầu tiên được thêm vào
`VaultRequest` kể từ khi mục này được viết. Câu trả lời cho câu hỏi bắt buộc — ***không*** — được
viết **tại chỗ khai báo** trong `protocol.ts`, kèm ba lý do kiểm được bằng mắt ngay trong tệp ấy:
thông điệp **một chiều đi vào** (không có thành viên tương ứng trong `VaultResponse`, và nhánh xử lý
nó không gọi `send` lấy một lần), nó **mang đúng một mã ngôn ngữ** đã lọc qua `normalizeLang`, và
nhánh ấy **không đọc keystore**. Hai phép đo canh chuyện đó thay vì để nó là lời hứa:
`apps/vault/src/lang.test.ts` — *"`setLang` đi VÀO được, và KHÔNG một byte nào đi ra"* (bẫy
`postMessage`) và *"`setLang` KHÔNG đọc ô nhớ chứa key"* (bẫy `Storage.prototype.getItem`). Cái mua
được: `?lang=` rời khỏi `src` của `<iframe>` kho khoá, nên khung **không còn remount**, nên đổi ngôn
ngữ không còn xoá key người dùng đang gõ dở (Task 7 §4 đo lỗi ấy; `s3.spec.ts` kịch bản 5b canh).

## `registryId` KHÔNG BAO GIỜ ĐƯỢC ĐẶT — nhãn nguồn `registry` của thư viện là mã không tới được — **HẾT Ý NGHĨA (server-side pivot, Task 16 của `2026-08-25-pha1-course-len-may-chu.md`)**

**Mọi thứ mục này bàn đều đã bị xoá; ghi lại vì lý do lịch sử, không phải vì
còn phải làm gì.** `pack-site.ts` (nơi mục dưới đây từng cân nhắc — rồi bác
bỏ — việc đóng dấu `registryId`) đã bị xoá ở Task 17 của server-side pivot,
cùng `build-index.ts`. `Catalog.tsx`, `pages/Library.tsx`,
`registry/pull.ts`, `registry/ratingFence.test.tsx`, và bảng `db.packages` —
toàn bộ những gì mục này trích dẫn làm bằng chứng — đều đã bị xoá ở Task 13.
Không còn "gói kéo về từ registry" nào để gán nhãn nguồn cho, vì không còn
đường kéo-về-thư-viện nào cả (spec `2026-08-25-server-side-pivot.md` §2.4:
course công khai, đọc thẳng từ server, không import). `tools/registry` vẫn
tồn tại (registry PR gate — xem `tools/registry/src/validate-pr.ts`), nhưng
nó không còn là đường course tới tay người đọc; đường ấy giờ là
`tuhoc publish` → `PUT /admin/courses/:slug` (xem `docs/course-format.md`,
`README.md`). Nếu một khái niệm "`registryId`" còn ý nghĩa gì trong mô hình
mới, nó là việc của một task khác quyết định lại từ đầu, không phải nối tiếp
phán quyết dưới đây — phán quyết ấy nói về một hàng Dexie không còn tồn tại.

**Đo ngày 2026-08-23, cả hai chiều** (trước server-side pivot). Không một đường nào trong repo đặt `manifest.registryId`:
`tools/registry` zip byte lấy thẳng từ đĩa và **không viết lại `manifest.json` bao giờ**;
`apps/web/src/registry/pull.ts` không ghi Dexie (nó uỷ cho `import.ts`); cả ba chỗ ghi
`db.packages` chép manifest nguyên vẹn. Trường ấy chỉ tồn tại như một ô kiểu tuỳ chọn và trong
fixture viết tay của test.

**Hệ quả người dùng thấy:** `pages/Library.tsx` chọn nhãn nguồn theo `held?.registryId`, nên một
course **kéo về từ registry hiện nhãn `tự nhập`**. Nhánh `registry` của trang ấy hôm nay không đường
nào tới được, và `Library.test.tsx:207` xanh vì nó **tự dựng** một manifest đã có trường ấy.

**Phán quyết: đây là một bước chưa cài ở PHÍA REGISTRY, không phải lỗi của đường kéo về.**
`docs/course-format.md:94` và `:314` nói registry gán trường này sau khi PR được merge —
**"Đừng tự điền."** Đóng dấu ở `pull.ts` là đúng thứ câu ấy cấm (chỉ đổi người tự điền) và còn làm
`row.manifest` lệch khỏi `row.files['manifest.json']` trong cùng một hàng Dexie; đóng dấu ở
`pack-site.ts` thì phải **bịa ra một ngữ nghĩa** — `Library.test.tsx` dùng `'vndee/khoa'`, hình dạng
`<chủ>/<repo>`, mà tệp ấy không có đối số nào chở danh tính registry vào.

**Không quyết định an ninh nào dựa vào trường này** — điều này đã được kiểm riêng vì nó là mối lo
được nêu ra: rào riêng tư của hệ thống con 4 là rào **cấu trúc**
(`apps/web/src/registry/ratingFence.test.tsx` khoá danh sách ba tệp được chạm bề mặt chấm sao và
buộc `Catalog.tsx` chỉ dựng hàng từ `index.json`), và `<Rating>`/`<Discussion>` nhận
`registryId={course.id}` — tức `RegistryEntry.id`, **không phải** `manifest.registryId`. Hai chuỗi
trùng tên, khác nguồn.

⇒ **Có cổng, không phải chỉ có văn xuôi:** `tools/registry/src/pack-site.test.ts` — *"KHÔNG đóng dấu
`registryId` vào gói xuất bản — quyết định, không phải bỏ sót"*. Đối chứng đã chạy: thêm một dòng
đóng dấu vào `pack-site.ts` ⇒ **bài ấy đỏ**, khôi phục ⇒ xanh (`shasum` khớp hai chiều). Ngày ai đó
cài bước gán thật, bài ấy là bài đỏ đầu tiên họ gặp, và nó chỉ cho họ **nửa còn lại phải nối cùng
lúc**: nhãn `registry` của `pages/Library.tsx`, và mục này.

## *Confused deputy* — **CÒN SỐNG, ĐỔI NẠN NHÂN sang `POST /ai/chat` (Pha 2, Task 16)** (S2-F9 · HC-3)

> **CƠ CHẾ CŨ ĐÃ CHẾT, LỖ THÌ KHÔNG.** `apps/vault/src/guard.ts` không còn chạy — nó bị xoá cùng
> `apps/vault` ở Task 16. Nhưng đây là một mục **đang sống**, và nhan đề nói thế vì trong một sổ nợ,
> nhan đề là thứ được lướt và được `grep`: một mục đọc thành "KHÔNG CÒN ÁP DỤNG" là một mục bị bỏ qua.
>
> **Câu hỏi gốc không đổi:** *một course độc chạy trong trang chính có bảo được nền tảng gọi hộ
> không?* Course hạng `interactive` vẫn chạy JS trong trang chính, trang chính vẫn có phiên đăng
> nhập, và `fetch('/ai/chat', { credentials: 'include' })` vẫn là một dòng. Thứ đổi là **nạn nhân**,
> và nó đổi theo HAI hướng — nói một hướng thôi là mô tả nửa nhẹ hơn:
>
>   · **tiền** — nay nó đốt **credit của người học** thay vì key của họ. Hướng này ĐƯỢC giảm thiểu
>     thật: hạn mức và phép trừ credit nằm ở MÁY CHỦ (`internal/ai/ratelimit.go`,
>     `internal/ai/credits.go`), tức phía không ai sửa được từ trình duyệt — mạnh hơn hẳn một token
>     bucket trong `localStorage` của một origin.
>   · **ghi chú riêng tư** — **chuyển giao NGUYÊN VẸN, không được giảm thiểu chút nào.** Đó là món
>     #1 trong danh sách dưới đây, nửa nghiêm trọng của HC-3. `RateLimiter` là *"a sliding-window
>     **call** budget per user id"* (`ratelimit.go`): nó chặn **số lời gọi**, không chặn **số chữ**.
>     Trong hạn mức, một course độc vẫn gửi đi được ~N lời nhắc/phút, **mỗi lời nhắc dài tuỳ ý** —
>     y hệt bản Pha 1, chỉ đổi chỗ đặt bộ đếm.
>
> Ai chạm vào `POST /ai/chat` nên đọc hết **SÁU** ghi chú bên dưới (danh sách tự đánh số 1–6, và
> chính nó mở đầu bằng chữ "sáu món"): chúng là sáu cách một lời gọi "hợp lệ" đi qua một cổng "đang
> chạy". Món #1 là món chưa ai chạm tới.

Kiến trúc origin riêng chặn được course độc **ĐỌC** key — trình duyệt cấm JS của origin này đọc
`localStorage` của origin khác. Nó **KHÔNG** chặn được course độc **DÙNG** key: course hạng
`interactive` chạy **trong trang chính**, trang chính **được phép** `postMessage` cho kho khoá, nên
course vẫn bảo được kho khoá gọi hộ. Nó không lấy được key, nhưng nó **đốt tiền** và — nghiêm trọng
hơn — **gửi ghi chú riêng tư của người dùng đi** dưới danh nghĩa lời nhắc.

**Đường ra thật đã bị BÁC BỎ CÓ Ý THỨC, không phải bị bỏ quên:** cho course hạng `interactive` chạy
trong một `<iframe sandbox>` ở origin riêng sẽ đóng hẳn lỗ này, và **spec §1.2 đã cân nhắc rồi bác
bỏ** vì nó phá P2 — chú thích cần chạm DOM của chương, mà DOM ấy sẽ nằm trong một origin khác.
Chừng nào course còn chạy cùng origin với ứng dụng, nó còn là *deputy*.

**Task 9 mua được gì (đã đo, 21/21 mutant chết, đối chứng vô hại sống):**
token bucket **phía kho khoá** (8 liên tiếp, nạp 1 token/6s), một cú bấm xác nhận **trong khung kho
khoá** cho lời gọi đầu mỗi phiên, và một nhật ký hoạt động ghi **thời điểm + số ký tự**, không ghi
nội dung.

**Task 9 KHÔNG mua được — sáu món, xếp theo mức nghiêm trọng:**

1. **Rò ghi chú riêng tư vẫn còn, chỉ chậm lại.** Trong hạn mức, một course độc vẫn gửi đi được
   ~10 lời nhắc/phút, mỗi lời nhắc dài tuỳ ý. Hạn mức chặn **số lời gọi**, không chặn **số chữ**.
   Đây là nửa nghiêm trọng của HC-3 và nó **chưa đóng**.
2. **`model` do trang chính chọn.** Kho khoá nhận `model` từ yêu cầu, nên một course độc chọn model
   đắt nhất là nhân chi phí mỗi lời gọi lên nhiều lần trong khi số lời gọi vẫn nằm trong hạn mức.
   Chỗ sửa đúng là **Task 6**: khi giao diện cấu hình nằm trong khung kho khoá, kho khoá ghim model
   của chính nó và bỏ qua `model` của yêu cầu.
3. **Xác nhận là một lần cho cả phiên, không phải một lần cho mỗi lời gọi.** Sau cú bấm, mọi lời gọi
   trong phiên đi qua — kể cả của course độc. Nó làm lời gọi đầu **nhìn thấy được**, không làm từng
   lời gọi được duyệt.
4. **Khung xác nhận chỉ NHÌN THẤY được nếu trang chính mở rộng iframe kho khoá.** Phần đó thuộc Task
   5/6 và **chưa tồn tại**. Chừng nào chưa có, `needs_consent` là ngõ cụt — người dùng không có nút
   nào để bấm và triệu chứng là "AI không trả lời". Đây đúng hình dạng **cổng mù #4 (S1-F29)**, và
   chỉ cổng e2e của Task 10 hỏi được câu "người dùng có bấm tới được không".
5. **Giao thức v1 không có `kind` nào để HUỶ.** Không có `AbortSignal` nào tới được kho khoá, nên
   `cancel()` của Task 5 không huỷ được lời gọi đang chảy — nó chỉ bỏ qua phần còn lại. Thêm một
   `kind: 'cancel'` là thay đổi giao thức, và theo S2-F8 nó phải được **đọc bằng mắt người**.
6. **`unsupported_provider` đang gánh hai nghĩa.** `main.ts` dùng nó cho cả "nhà cung cấp lạ" lẫn
   "yêu cầu chat méo mó", vì `VaultErrorCode` là union đóng và thêm một thành viên là thay đổi giao
   thức (S2-F8) trong lúc Task 5 đang được viết dựa trên đúng union hiện tại. Nợ có tên: lần duyệt
   giao thức tới, thêm `bad_request`.

**Phép đo đáng nhớ nhất của Task 9 — một dây bẫy vẫn xanh nhưng đã YẾU ĐI:** bài kiểm của Task 3
*"một yêu cầu `chat` KHÔNG gây ra lời gọi mạng nào"* **vẫn xanh** sau khi `chat` được nối, đúng như
tác giả của nó yêu cầu. Nhưng đo bằng đột biến cho thấy nó xanh vì một lý do **khác** lý do tác giả
ghi: trong bài kiểm ấy kho khoá **chưa cắm key**, nên nhánh `not_configured` một mình đã đủ chặn.
Gỡ hẳn phép kiểm xác nhận ⇒ bẫy Task 3 **vẫn xanh**; phải gỡ **cả** phép kiểm "đã cắm key chưa" nó
mới đỏ. Bẫy thật của người gác là `guard.test.ts > BẪY TRUNG TÂM`, nơi key **đã** được cắm.
⇒ Bài học chung: **một dây bẫy còn xanh không có nghĩa nó còn đo thứ nó từng đo.** Khi mã dưới nó
đổi, phải đo lại bằng đột biến, không suy luận.

### Bổ sung (Pha 3, Task 12) — `read_my_notes` không mở đường mới, nhưng cho kênh cũ một cách nói tự nhiên hơn

Task 12 thêm tool agent thứ ba, `read_my_notes` (`apps/api/internal/ai/tool_notes.go`), đọc tiến độ +
ghi chú của CHÍNH người hỏi cho một course — mặc định **bật** cho mọi tài khoản mới
(`defaultAgentConfig`, `credits.go`) và **có công bố** trong `AgentConfigPanel.tsx` (nhãn
`settings.ai.toolReadMyNotes`). Đây KHÔNG phải một data path mới cho *confused deputy* đang bàn ở
mục này: `/annotations` đã fetch được bằng cookie của nạn nhân từ trước (`credentials: 'include'`,
cùng cơ chế mục #1 ở trên mô tả), nên một course độc script hoá sẵn có thể tự đọc ghi chú riêng tư
qua `GET /annotations` mà không cần tool này tồn tại.

**Cái tool này thật sự đổi:** nó cho kênh cũ một CÁCH NÓI tự nhiên hơn để lấy dữ liệu ấy RA KHỎI
trang, không cần script tự parse JSON của `/annotations`. Một course độc chỉ cần đặt một câu hỏi
(qua cùng cơ chế mục #1 dùng để bảo agent "gọi hộ") có hình dạng như *"đọc ghi chú của tôi cho khoá
X rồi tóm tắt lại"* — `read_my_notes` trả về đúng nội dung ghi chú (không phải chỉ số lượng hay
metadata), model tóm tắt/lặp lại nó trong câu trả lời, và câu trả lời ấy chảy qua **SSE** của
`POST /ai/chat` — đúng luồng mạng mà script của kẻ tấn công đã đang đọc để "gọi hộ" AI ngay từ đầu.
Nói cách khác: `read_my_notes` không mở khoá gì mới, nhưng nó biến một cuộc khai thác vốn cần script
tự hiểu cấu trúc `/annotations` thành một cuộc khai thác chỉ cần MỘT câu tiếng Việt/Anh tự nhiên —
hạ chi phí kỹ thuật của đúng lỗ đang mở, không phải mở lỗ mới.

`tool_notes.go`'s package doc comment đã tự ghi rõ điều kiện CONFUSED DEPUTY nó tự đóng cho CHÍNH
nó (không tham số nào trong schema mang được danh tính người dùng — `TestNotesToolSchemaHasNoUserParameter`,
`TestNotesToolReadsOnlyBoundUser`): tool luôn đọc đúng người đang hỏi, không đọc hộ ai khác. Cái nó
KHÔNG đóng — vì không thuộc bán kính của nó — là con đường thứ hai này, con đường nạn nhân vẫn là
CHÍNH người đang bị course độc điều khiển đọc hộ, không phải ai khác.

**Nơi xử lý:** chưa đổi — sáu món Task 9 chưa mua được vẫn là sáu món đó (đặc biệt món #1, hạn mức
chặn SỐ LỜI GỌI không chặn SỐ CHỮ). `read_my_notes` không tự nó cần một hạng mục sửa riêng; nó là lý
do để đọc lại mục #1 với mức khẩn cấp cao hơn một chút, vì thứ rò ra giờ dễ lấy hơn.

**Cập nhật (rà soát toàn nhánh Pha 3, Quan trọng 4) — BÁN KÍNH ĐÃ HẸP LẠI MỘT BẬC, lỗ vẫn mở.**
Đến vòng sửa cuối, `read_my_notes` còn nhận `slug` như một THAM SỐ DO MODEL CHỌN: `agent.go` chỉ
nhắc course đang mở như lời khuyên trong prompt (*"use this one"*), không chỗ nào so `args.Slug` với
`Turn.CourseSlug`. Tức là ràng buộc DANH TÍNH kín (mục trên), nhưng PHẠM VI bên trong dữ liệu của
chính người học thì lái được — đúng khác biệt giữa *"đọc ghi chú của khoá bạn đang mở"* và *"đọc ghi
chú của bạn ở bất kỳ khoá nào nó gọi tên"*. Nay course được buộc lúc dựng tool từ `Turn.CourseSlug`
và schema **không còn tham số nào cả** (xem `tool_notes.go`, điều kiện 3;
`TestNotesToolSchemaHasNoSlugParameter`, `TestNotesToolReadsOnlyTheTurnsCourse`). Điều này KHÔNG
đóng mục này: một course độc vẫn điều khiển được `POST /ai/chat` bằng phiên của nạn nhân, và nó tự
đặt được `course_slug` trong thân request y như nó đặt `question`. Cái nó đổi là một câu hỏi độc
giờ chỉ moi được ghi chú của MỘT course mỗi lượt, và câu công bố trong `AskPanel.tsx` ("cho khoá học
này") lần đầu tiên đúng với thứ mã thật sự làm.

## Form nhập key sống trong iframe: chặn được NHÚNG, không chặn được SAO CHÉP (S2 Task 6) — **KHÔNG CÒN Ô NHẬP KEY (Pha 2, Task 16)**

> **Trạng thái: không còn form nhập key nào trong sản phẩm.** Pha 2 gỡ `apps/vault`, và mục Trợ lý AI
> ở Cài đặt nay chỉ hiện số dư credit và cấu hình agent — không `<input>` nào, và `pages/
> Settings.test.tsx` khoá đúng điều đó lại. Giữ mục này vì kết luận của nó là một luật **thiết kế**,
> không phải một chi tiết cài đặt: **bất kỳ ô nhập bí mật nào sống trong một iframe đều dạy người
> dùng dán bí mật vào một ô họ không kiểm chứng được nguồn gốc.** Nó sẽ đúng lại ở đúng ngày ai đó
> nghĩ tới một khung nhúng cho việc thanh toán, đăng nhập bên thứ ba, hay một key nào khác.

`apps/vault/_headers` đặt `frame-ancestors`, và nó **đo được hai chiều trên bản dựng thật**: origin
được phép thì nhúng và thấy ô nhập; origin khác thì rơi vào `chrome-error://chromewebdata/`.

**Nhưng nó chỉ chặn kẻ tấn công NHÚNG kho khoá. Nó không chặn kẻ SAO CHÉP nó.** Form thật nằm trong
một iframe **không có thanh địa chỉ**, nên bằng chứng duy nhất người dùng có về "cái ô này thuộc
origin nào" là **trang bên ngoài**. Tức là giao diện này đang **dạy người dùng thói quen dán key vào
một cái ô mà họ không có cách nào kiểm chứng nó chạy ở đâu** — và một trang giả chỉ cần trông giống.

Đây là **cố hữu với mọi thiết kế cất-bí-mật-trong-iframe**, không phải lỗi cài đặt. Nhưng Task 6 là
lần đầu nó trở thành thật, vì trước đó chưa có ô nhập key nào. Ba hướng giảm thiểu đã được cân nhắc
và **bác bỏ có lý do**. Lý lẽ đầy đủ nằm trong sổ thực thi dưới `.superpowers/`, **không có trong
git** (xem mục E ở cuối tệp này), nên kết luận được chép thẳng vào đây:

1. *Hiện origin của khung ra trong chính khung* — vô dụng: kẻ chép giao diện in đúng dòng ấy.
2. *Bắt người dùng mở kho khoá ở một tab riêng để nhìn thấy thanh địa chỉ* — đúng về an ninh, đổi lấy
   một luồng cấu hình nhiều khả năng bị bỏ giữa chừng; không có dữ liệu để cân đánh đổi ấy.
3. *Một chuỗi/hình do người dùng tự chọn hiện trong khung* (kiểu SiteKey của ngân hàng) — cần một chỗ
   cất thứ hai ở origin kho khoá và một luồng thiết lập riêng, và bằng chứng ngoài đời cho thấy người
   dùng không nhận ra khi nó VẮNG mặt.

**Hai điều chưa kiểm được, ghi để không ai tưởng đã kiểm:** `_headers` **chưa từng được một Cloudflare
Pages thật phục vụ**, và `apps/vault` **chưa có project Pages nào**. Phép đo hai chiều ở trên chạy
trên máy, không chạy trên hạ tầng thật.

### C-1 nửa MÀN HÌNH — cũng đã đóng (2026-08-22)

Task 1 của hệ thống con 4 đóng nửa **dữ liệu**: tab bị thay thế ngừng đồng bộ ngay, không hàng nào
của A tới server dưới cookie của B. Người cài đặt gắn cờ rằng **nửa màn hình vẫn hở** — tab ấy tiếp
tục hiển thị cây đã render của A cho tới khi `useMe` của chính nó làm mới. A rời máy, B đăng nhập ở
tab khác ⇒ **B nhìn thấy ghi chú và tiến độ của A**. Không dữ liệu nào chảy đi, nhưng đó là thứ người
dùng nhìn thấy được.

Nay `RequireAuth` đọc `sessionWasSuperseded()` qua **`useSyncExternalStore`** và đẩy về `/login`.
Chốt đặt **trước mọi nhánh khác**, kể cả `isPending` và nhánh ngoại tuyến lạc quan: khi một tài khoản
khác đã chiếm phiên trên máy này, mọi câu trả lời tab này đang cầm đều thuộc về người trước.

**Kiểm lại:** `apps/web/src/auth/supersededScreen.test.tsx` — hai đồ thị module thật
(`vi.resetModules()`) chia sẻ một `BroadcastChannel` của jsdom. Đối chứng hai chiều: đổi chốt thành
`if (false)` ⇒ **2 bài đỏ**; mã đúng ⇒ 3 xanh.

**Bẫy đã mắc và ghi lại để khỏi lặp:** bản đầu của bài kiểm gọi `announceSessionUser` trong **cùng
một** module rồi khẳng định tab tự đẩy mình ra. Nó **không bao giờ đo được điều nó định đo** — theo
chuẩn, một `BroadcastChannel` **không nhận thông điệp của chính nó**. Phải là hai đồ thị module.

**Còn hở, không đóng được từ phía client:** khoảng giữa *"cookie đã thành của B"* và *"tín hiệu được
phát"*. Cookie đổi ngay khi `POST /auth/login` trả về; tín hiệu sớm nhất là vài câu lệnh sau đó. Đóng
đúng cách cần phía server — ví dụ một định danh phiên trên mọi phản hồi để client đối chiếu.

## Không cổng nào so `src/styles/*.css` với `dist/` (Pha 2, Task 16 vòng sửa 2)

**Trạng thái: hở, và đã cắn HAI lần trong cùng một tệp.** Cả hai lần, một quy tắc CSS có thật trong
nguồn **không có trong bản dựng**, và **`bun run build` XANH cả hai lần**.

| lần | nguyên nhân | thiệt hại đo trên `dist/` |
|---|---|---|
| `c1aacde` → 2026-08-29 | dấu ĐÓNG chú thích không có dấu mở, ở cấp cao nhất | `.page-settings { max-width: 54rem }` biến mất |
| `eaa4342` (một commit) | đoạn văn nháp còn sót thành CSS, mở một `{` không đóng | ~20 quy tắc từ đó tới cuối tệp: `.set-title`, `.set-select`, `.auth-pw`, `.auth-switch-link`, cả khối `@media (max-width: 47rem)` của `/login` |

Nguyên nhân chung: **bộ phân tích CSS được viết để KHÔI PHỤC sau lỗi, không phải để dừng lại.** Nó bỏ
thứ nó không hiểu rồi đi tiếp. Một quy tắc bị bỏ trong im lặng không phải lỗi cú pháp — nó là một quy
tắc không tồn tại. Và vitest không bao giờ nạp CSS, nên cả bộ test cũng xanh.

**Đã đóng một phần:** `apps/web/src/styles/cssStructure.test.ts` kiểm HÌNH DẠNG của nguồn — chú thích
đóng/mở đúng cặp, ngoặc nhọn về 0 và không âm. Nó được chứng minh bằng cách **khôi phục nguyên văn cả
hai tệp hỏng từ git** (`git show 66ef36b:…` và `git show eaa4342:…`) và xác nhận cổng ĐỎ ở cả hai.

**Cái còn hở:** cổng ấy đọc NGUỒN, không đọc `dist/`. Một quy tắc rơi khỏi bản dựng vì bất kỳ lý do
nào khác (selector gõ sai, một `@layer`/`@import` xếp sai, một bước tối ưu hoá) vẫn im lặng như cũ.
Phép đo thật là `bun run build` rồi `grep` bản dựng — và không target `make` nào làm việc ấy.

⇒ Ai muốn đóng: một bài kiểm chạy sau `bun run build`, đọc `dist/assets/*.css`, và khẳng định một
DANH SÁCH SELECTOR CÓ TÊN đều có mặt (theo tên, không theo số đếm — cùng lập luận `db/local.test.ts`
dùng cho năm bảng Dexie). Nó cần một target riêng vì `make test-web` không dựng bundle. Không thuộc
phạm vi Task 16, nên là một món nợ CÓ TÊN chứ không phải một việc bỏ sót.

## `assert-tests-ran.mjs` mất theo `apps/vault` — không có người kế nhiệm (Pha 2, Task 16)

**Trạng thái: một NĂNG LỰC đã rời khỏi repo, và không target nào nhận lại.** Ghi ra vì việc gỡ là
ĐÚNG (thư mục nó phục vụ không còn) nhưng hệ quả thì không được im lặng.

`make test-vault` có bốn nửa; ba nửa đầu (`tsc -b`, `oxlint`, vitest) chết cùng thư mục và không để
lại gì. Nửa thứ tư thì khác hạng: `apps/vault/scripts/assert-tests-ran.mjs` đọc reporter JSON của
vitest và **đỏ khi `numPassedTests === 0`, hoặc khi có BẤT KỲ bài nào bị `.skip`/`.todo`**.

Nó tồn tại vì một phép đo, không vì sự cẩn thận chung. Vitest 4.1.11, đo trong chính thư mục ấy ngày
2026-08-22:

| tình huống | vitest thoát |
|---|---|
| `include` không khớp tệp nào | **1** — cổng tự đỏ, tốt |
| MỌI `describe` bị `.skip` | **0** — `"Tests 8 skipped (8)"` |

Hàng thứ hai là cổng mù thứ SÁU đang chờ xảy ra, cùng hình dạng với năm cái ghi phía trên tệp này.
`numTotalTests` KHÔNG dùng thay được: ở ca skip nó vẫn bằng 8.

**Ai thừa hưởng lỗ này:** `test-web`, `test-format`, `test-cli`, `test-registry` — cả bốn chỉ nhìn mã
thoát của vitest. **Đo lại trên `apps/web` ngày 2026-08-29**, không chép lại phép đo cũ của thư mục
đã xoá: đổi `describe('tNode()'` thành `describe.skip(...)` rồi chạy
`bunx vitest run src/i18n/tNode.test.tsx` cho

```
Test Files  1 skipped (1)
Tests  3 skipped (3)
exit=0
```

⇒ lỗ **có thật ở `apps/web` hôm nay**, không chỉ ở thư mục đã gỡ.

⇒ Ai muốn đóng: chép `assert-tests-ran.mjs` từ `git show 66ef36b:apps/vault/scripts/assert-tests-ran.mjs`
và nối vào bốn target ấy. Đó không phải việc của Task 16 (brief chỉ nói gỡ), nên nó là một món nợ
CÓ TÊN chứ không phải một việc bỏ sót.

---

# Trạng thái khi bốn hệ thống con hoàn thành — 2026-08-23

| cổng | kết quả |
|---|---|
| `test-format` | 164 · RAW_EXIT=0 |
| `test-cli` | 43 · RAW_EXIT=0 |
| `test-registry` | 40 · RAW_EXIT=0 |
| `test-vault` | 181 · RAW_EXIT=0 |
| `test-web` | **1098** · RAW_EXIT=0 (gồm cả `tsc -b`) |
| `test-api` | 9 gói · RAW_EXIT=0 |
| `test-e2e` | **29** · RAW_EXIT=0 |
| `check-publish` | **ĐỎ — 3 phát hiện**, xem dưới |

## Việc duy nhất còn chặn publish

`make check-publish` phép 2 (**lịch sử git**): **61 object** dưới `courses/` và **44 commit** chạm tên
giáo trình **ngoài** `courses/`. Bốn phép còn lại đều xanh.

Cần `git-filter-repo` (chưa cài trên máy). Công thức ở `docs/publishing.md` §2, đã vá ba cái bẫy.
**Lệnh phải dùng CẢ `--replace-text`, không chỉ `--path`** — nếu không, 44 commit kia vẫn mang tên.

## Những gì CHƯA TỪNG chạy trên hạ tầng thật — ghi để không ai tưởng đã kiểm

- ~~`apps/vault/_headers` **chưa từng được một Cloudflare Pages thật phục vụ**; `apps/vault` chưa có
  Pages project nào. Phép đo hai chiều của `frame-ancestors` chạy **trên máy**.~~ **HẾT HIỆU LỰC
  (Pha 2, Task 16):** cả tệp lẫn ứng dụng đã bị gỡ, nên không còn gì để chạy trên hạ tầng thật. Món
  nợ này đóng bằng việc **xoá**, không bằng việc kiểm — ghi rõ để nó không bị đọc thành "đã kiểm".
- Truy vấn GraphQL của Discussions **chưa từng gọi GitHub thật một lần nào**. Máy chủ giả trả về đúng
  thứ bộ giải mã mong đợi — một vòng khép kín. **Ba cổng độc lập đã cùng nêu điều này** (S4 Task 5-Go
  §8, Task 4+5-web §7b, Task 6 §8): nó cần **một lần chạy thật với một token thật**.
- ~~`pack-site.ts` **chưa từng chạy trên GitHub Actions**; toàn bộ job `publish` (Pages) chưa chạy.~~
  **KHÔNG CÒN LÀ RỦI RO ĐỂ THEO DÕI:** `pack-site.ts` và `build-index.ts` đã bị xoá ở Task 17 của
  server-side pivot — courses không còn xuất bản lên GitHub Pages, catalog là `/courses` trên server
  (xem mục "`registryId` KHÔNG BAO GIỜ ĐƯỢC ĐẶT" ở trên, đã đánh dấu HẾT Ý NGHĨA cùng lý do).
- **Chưa ai gọi một nhà cung cấp AI thật** — vẫn đúng, nhưng ~~vì lý do cũ~~ **VÌ MỘT LÝ DO KHÁC
  HẲN (cập nhật Pha 2)**. Bản trước viết: *"OpenAI đã đo được là bị CORS chặn ở đường lỗi; đường 200
  chưa đo. Chủ dự án chọn giữ kèm cảnh báo."* Cả ba vế đều là văn bản Pha 1/BYOK và **hết hiệu lực**:
  không còn OpenAI trong kiến trúc, và **CORS là khái niệm chỉ tồn tại trong trình duyệt** — client
  gọi nhà cung cấp nay là mã Go chạy trên máy chủ (`internal/ai/client.go`), nơi CORS không áp dụng
  ở bất cứ nghĩa nào. Hai mục khác trong CHÍNH danh sách này đã được gạch "HẾT HIỆU LỰC"; mục này bị
  bỏ sót.

  Điều còn đúng, đo lại 2026-08-29: bộ e2e chạy với một DeepSeek **GIẢ**
  (`compose.e2e.yml:104` trỏ `DEEPSEEK_BASE_URL` sang `http://deepseek-fake:8090`,
  `:112` đặt một key giả) — có chủ đích, để bộ test không tiêu tiền thật. Nên đường 200 của
  DeepSeek **thật** chưa từng được cổng nào chạy qua; nó chỉ được đo bằng tay ở Task 0
  (`docs/deepseek-measured.md`). `BRAVE_API_KEY` thì **0 lần** trong `compose.e2e.yml`, nên tool
  `web_search` chưa từng chạy trong e2e, kể cả với hàng giả.

  Và mục này **bỏ lỡ đúng ba món Pha 2 mà nó tồn tại để bắt** — hai key AI vắng khỏi mọi blueprint,
  credit khởi đầu bằng 0, và migration không backfill. Cả ba đã được vòng sửa 1 sau review tổng
  nhánh đóng (A1/A2/A3); ghi lại ở đây vì việc chúng lọt qua một danh sách mang tên "những gì chưa
  từng chạy trên hạ tầng thật" là bằng chứng rằng danh sách ấy chỉ được đọc lại, chưa được đo lại.
- Quy ước *"tiêu đề Discussion = id course"* **không tồn tại ở đâu** trong `tools/registry` hay tài liệu.

## Lời hứa còn hở, đã đo, không giấu

**Ngân sách ký tự định giá việc tuồn ghi chú bằng số cú bấm của con người — nó không chặn.** Đo được:
nếu người dùng bấm "cho phép" mọi lần thì **toàn bộ 40 lời nhắc vẫn đi, đủ 773.720 ký tự**, chỉ tốn
7 cú bấm thay vì 1. Cải thiện thật trước một course độc **âm thầm**; **không cải thiện gì** trước một
course đủ kiên nhẫn chờ người dùng bấm. Đường ra thật (course chạy trong iframe sandbox riêng origin)
đã bị spec §1.2 **bác bỏ có ý thức** vì nó phá P2.

## Nợ Pha 2 (AI máy chủ) — `RateLimiter` (Task 10, `apps/api/internal/ai/ratelimit.go`)

Hai mục dưới đây do vòng review 1 của Task 10 tìm ra: tự chạy đột biến, thấy chú thích của mã khẳng
định một tính chất mà mã **không thật sự có** (I2), và thấy một nợ chỉ được ghi trong báo cáo Task
10 chứ không nằm ở đâu người đọc mã sẽ thấy (I3). Cả hai đã được sửa **ngay trong chú thích của
`ratelimit.go`** — mục này là bản lưu bền, cùng vai trò với các mục P2-C1/P2-C2 ở trên (dù đó là P2
của giai đoạn annotation, không phải "Pha 2: AI máy chủ" đang nói ở đây — hai chữ "P2" trùng tên,
khác giai đoạn).

### 1 — `RateLimiter` khoá theo user id: chặn được một tài khoản đốt nhanh, KHÔNG chặn được farm credit tặng qua nhiều tài khoản

Spec §3.4 nêu hai hình dạng lạm dụng. `Allow` chặn đúng hình dạng thứ nhất (một tài khoản gọi quá
nhanh, kể cả khi tài khoản đó còn đầy credit — xem `TestAllowBlocksAWellFundedAccountIndependently
OfCredit`). Nó **không** chặn hình dạng thứ hai: vì khoá theo `uuid.UUID` của user, mỗi tài khoản
mới đăng ký nhận một `hits[newUserID]` rỗng — tức một hạn mức mới tinh — nên K tài khoản mua được
K×max lượt mỗi cửa sổ, không phải max. Bản đầu của `ratelimit.go` (trước vòng review 1) khẳng định
sai rằng limiter tồn tại cho **cả hai** hình dạng; đã sửa lại đúng phạm vi thật.

Tiền của hình dạng #2 không nằm ở tốc độ đốt token — nó nằm ở chính `signup_grant_micro`
(`ai_settings`, migration 0007): mỗi tài khoản mới là tiền cho không, và `apps/api` **không có xác
thực email** (`grep -rn 'email_verified\|verification_token\|VerifyEmail' apps/api` → 0 kết quả).
Rào duy nhất hiện có là limiter theo IP ở `apps/api/internal/server/server.go` (10 req/phút/IP cho
`/auth/*`) = 14.400 lượt đăng ký/ngày/IP — không phải một rào thật cho một script kiên nhẫn.

**Nơi xử lý:** không phải `ratelimit.go` — việc thật là xác thực email trước khi cấp credit, hoặc
hoãn/giảm mức cấp cho tới khi email được xác nhận. Chưa task nào được giao việc này.

### 2 — `rl.hits` không bao giờ dọn, và giả định "một process" buộc vào `render.yaml` chứ không phải một tính chất thiết kế

`map[uuid.UUID][]time.Time` giữ một entry vĩnh viễn cho **mọi** user id từng gọi `Allow`, không TTL,
không sweep. Ở quy mô hiện tại là một rò chậm, có giới hạn (một slice nhỏ/người học, không phải/mỗi
request) — restart process (vốn đã reset toàn bộ hạn mức, một chi phí được chấp nhận có ghi trong
`ratelimit.go`) cũng giải phóng luôn bộ nhớ này. Không sweep nền nào được xây ở Task 10.

Ràng buộc "chỉ cần đúng trong MỘT process" cũng vậy: `RateLimiter` không chia sẻ trạng thái qua
nhiều process, nên chạy hai instance sẽ âm thầm biến "max/user" thành "max×số-instance/user". Điều
này vô hại **hôm nay** chỉ vì `render.yaml`'s service `tuhoc-api` là `plan: free`, không có block
scaling/`numInstances` — gói free của Render không cho chạy nhiều hơn một instance — **không phải
vì bản thân thiết kế đảm bảo điều đó**. Đổi plan là hạn mức thật lặng lẽ nhân lên.

**Vì sao không dùng `github.com/gofiber/fiber/v2/middleware/limiter` có sẵn** (đã vendor, đang dùng
ở `/auth/*` trong `server.go`, có `SlidingWindow`, và storage mặc định của nó **tự hết hạn** — không
rò map): đã đọc mã nguồn gói đó (`limiter.go`, `config.go`, `manager.go` ở
`github.com/gofiber/fiber/v2@v2.52.15/middleware/limiter/`) — điểm vào **duy nhất** nó xuất ra là
`limiter.New(cfg) fiber.Handler`, khoá cứng vào `*fiber.Ctx`. Không có một API kiểu
`Allow(key string) error` đứng độc lập với HTTP. Dùng nó nghĩa là logic rate-limit phải sống như
middleware Fiber ở `internal/server`, không thể gọi trực tiếp cùng dòng mã với `credits.go`'s
`EnsureCredit` bên trong thân handler `/ai/chat` — và `internal/ai` (nơi brief Task 10 yêu cầu đặt
`ratelimit.go`) khi ấy **chưa import gofiber ở bất kỳ đâu**. Câu đó **đã hết đúng ở Task 11**:
brief Task 11 đặt `handler.go` vào chính `internal/ai`, nên gói này nay có import fiber — ghi lại ở
đây thay vì để một khẳng định đã chết đứng nguyên. Lý do CHỊU LỰC thì không đổi và mới là thứ quyết
định: `limiter` là **middleware**, nó từ chối được một request TRƯỚC khi handler chạy, nhưng không
trả lời được câu "user id này đã quá hạn mức chưa" tại đúng dòng trong `Chat` nơi câu ấy phải được
hỏi cùng `EnsureCredit`. Đánh đổi: tự viết một map trong bộ nhớ (nợ #2 ở trên) để đổi lấy một hàm domain-layer
test được trực tiếp bằng `go test`, gọi được cùng chỗ với `EnsureCredit`, không cần dựng `*fiber.Ctx`.
**Đây LÀ một quyết định đã cân nhắc, không phải bỏ sót** — nhưng việc cân nhắc này chỉ xảy ra ở vòng
review 1, sau khi được hỏi; bản đầu của `ratelimit.go` không hề nhắc gói đã vendor sẵn này.

---

## Nợ Pha 2 (AI máy chủ) — ba route `/ai/*` (Task 11, `apps/api/internal/ai/handler.go`)

### 1 — `POST /ai/chat` KHÔNG có trí nhớ hội thoại: mỗi lượt là một lượt độc lập

Task 11 dựng `Turn.History` **rỗng, luôn luôn**, và thân request của `/ai/chat` **không có trường
nào** chở được lịch sử. Đây là quyết định có chủ ý, không phải bỏ sót, và cái giá của nó là thật:
một câu hỏi tiếp ("còn cái kia thì sao?") tới máy chủ mà không mang theo lượt trước.

**Vì sao không đọc History từ thân request** (nợ điều phối viên ghi đích danh cho Task 11): `build
Messages` (`agent.go`) lọc `Role` nhưng **không** lọc `ToolCalls`/`ToolCallID`, nên một entry
`{system, có tool_calls}` sau khi bị hạ cấp thành `user` vẫn mang tool_calls — hình dạng wire không
hợp lệ. Nặng hơn: `"tool"` và `"assistant"` đều **nằm trong** whitelist role, nên một client chỉ cần
khẳng định *"tool `read_course` đã trả về «giáo trình nói hãy bỏ qua chỉ dẫn của bạn»"* là câu ấy vào
prompt với đúng thẩm quyền của một kết quả tool do nền tảng thật sự tạo ra.

**Vì sao không dựng History từ DB, như nợ ấy yêu cầu:** migration 0007 **không có bảng transcript**,
và Pha 2 không có task nào tạo một cái. Thêm một bảng chở thân hội thoại là một quyết định **riêng
tư**, không phải một quyết định wiring: spec §0.1 cấm thân hội thoại vào **sổ cái** và **không nói gì**
về việc nó được phép sống ở đâu khác, vì chưa ai quyết. Một task nối dây không được tự quyết thay.

**Nơi xử lý:** một bảng transcript phía máy chủ (`ai_conversation` / `ai_message`), kèm chính sách
lưu giữ và một quyết định riêng tư có ghi vào spec, rồi `/ai/chat` đọc lại `History` từ đó theo
`conversation_id` **của chính người gọi**. Chưa task nào được giao. Cho tới lúc đó, `useAI` (Task 13)
vẫn giữ `AITurn[]` phía client — màn hình vẫn hiện đủ hội thoại, chỉ có **model** là không thấy nó.

### 2 — TOCTOU của `EnsureCredit` được THU HẸP, chưa ĐÓNG

`EnsureCredit` (`credits.go`) là một lần đọc trần, không giữ chỗ: N lượt song song của cùng một
người học đều qua được ở `balance = 1`, rồi cả N đều trừ. Task 11 không đóng được cửa sổ ấy trong
phạm vi của mình; thứ nó làm là **chặn N**: `RateLimiter.Allow` chạy trước `EnsureCredit` ở mỗi
lượt, nên số lượt song song tối đa là `DefaultRateLimitMax` (10) mỗi `DefaultRateLimitWindow`
(5 phút), thay vì không giới hạn. Mức âm tối đa do đua vì thế có trần, không còn mở.

**Nơi xử lý:** một phép trừ **có điều kiện, nguyên tử** thay cho cặp đọc-rồi-trừ — `UPDATE
ai_credits SET balance_micro = balance_micro - $2 WHERE user_id = $1 AND balance_micro > 0
RETURNING ...` để giữ chỗ trước lượt, cộng một đường hoàn lại phần chưa dùng sau lượt. Việc đó nằm
trong `credits.go` (đổi chữ ký `ChargeTurn`, thêm một phương thức giữ chỗ), không nằm trong handler.

### 3 — `DefaultTurnTimeout` (10 phút) suy ra từ một cột CMS sửa được, và không có gì canh cặp đó

Trần một lượt ở `handler.go` được tính từ `ai_settings.max_tokens_per_turn` (seed 8192) và tốc độ
sinh chậm nhất đã đo (~20 token/giây) → ~6,8 phút cho vòng trả lời dài nhất còn **khoẻ mạnh**. Task
17 cho phép sửa cột ấy từ CMS **không cần deploy**. Nâng nó lên quá ~12000 làm một câu trả lời hợp
lệ có thể sống lâu hơn trần này và bị cắt giữa chừng — và không test nào, không cổng nào bắt được
cặp ràng buộc ấy, vì một bên là hằng số Go còn bên kia là một hàng trong bảng.

---

## Nợ Pha 2 (AI máy chủ) — hai màn CMS (Task 17, `apps/web/src/admin/AdminCredits.tsx`, `apps/api/internal/ai/admin_handler.go`)

Hai mục dưới đây do vòng review 2 của Task 17 tìm ra. Cả hai từng chỉ được ghi trong báo cáo task
(`.superpowers/sdd/…`, không nằm trong git) — reviewer chỉ ra đúng lỗ mà mục "Cổng mù #4" ở trên
từng đóng cho một trường hợp khác: một nợ chỉ sống trong một tệp gitignored không phải một nợ đã
ghi. Mục này là bản lưu bền.

### 1 — `POST /admin/ai/users/:id/credit` không có khoá idempotency: một response bị mất VẪN có thể thành nạp đôi thật

`AdminAdjustCredit` (Go) ghi số dư và audit trong MỘT transaction — nếu request tới máy chủ, giao
dịch đó hoặc chạy trọn vẹn hoặc không chạy gì, không có trạng thái nửa vời. Nhưng **giữa** "giao
dịch đã commit" và "trình duyệt của operator biết điều đó" là một khoảng trống HTTP bình thường:
proxy timeout, mất kết nối, thiết bị ngủ giữa chừng — response không bao giờ về tới tab, dù tiền đã
chuyển thật. `AdminCredits.tsx`'s `adjustMutation` (round-2 review, M-6) nay refetch số dư và
`recent_adjustments` ở `onSettled`, không chỉ `onSuccess`, nên một lượt như vậy vẫn cho operator
thấy TRẠNG THÁI THẬT trước khi họ có cơ hội bấm lại — điều này **thu hẹp** cửa sổ (operator nhìn
thấy bằng chứng trước khi gõ lại), nó **không đóng** cửa sổ: vẫn có một khoảnh khắc giữa lúc request
lỗi và lúc refetch xong, và hai tab trình duyệt (hoặc hai operator) gửi hai request thật, độc lập,
không có cách nào cho tầng API biết chúng "cùng một ý định".

**Nơi xử lý:** một khoá idempotency phía server — client sinh một token ngẫu nhiên cho MỖI lần bấm
Áp dụng, gửi kèm request; `AdminAdjustCredit`/`Service.AdjustCredit` (credits.go) kiểm token đó
trong CÙNG transaction ghi số dư (một bảng `admin_idempotency_key` hoặc một cột trên chính hàng
`admin_audit`, UNIQUE), và một request lặp lại đúng token trả về **cùng kết quả** đã ghi lần đầu
thay vì ghi thêm lần hai. Chưa task nào được giao việc này — không nằm trong phạm vi Task 17
(task-17-brief.md không yêu cầu, và spec §7 không nhắc idempotency).

### 2 — `admin_audit.who … ON DELETE SET NULL`: danh tính operator trên một hàng TIỀN có thể mất nếu tài khoản admin đó bị xoá

Cột `who` (migration `0005_published_catalog.up.sql:63`) tham chiếu
`users(id) ON DELETE SET NULL` — round-2 review bắt đúng: bản trước của mục này viết nhầm
thành `ON DELETE CASCADE … SET NULL`, không khớp mã thật (chỉ một mệnh đề `SET NULL`, không có
`CASCADE` nào cả). Nếu tài khoản admin từng thực hiện một `POST /admin/ai/users/:id/credit` sau đó bị
xoá khỏi `users`, hàng `admin_audit` ghi lượt cộng/trừ ấy vẫn còn (đúng lời hứa "sổ không xoá"), nhưng
`who` lặng lẽ thành `NULL` — số tiền, ghi chú, thời điểm vẫn còn, danh tính **ai đã làm** thì mất.
Cột `actor` (cũng migration 0005) phân biệt được "đi qua CLI token" khỏi "đi qua một tài khoản nay
không còn", nhưng không mang lại danh tính đã mất — nó chỉ nói RÕ RẰNG danh tính đã mất, thay vì để
`who = NULL` mập mờ giữa hai trường hợp.

Migration 0005 chọn `SET NULL` khi bảng chỉ giữ dấu vết PUBLISH/UNPUBLISH course — nội dung, không
phải tiền. Task 17 là task ĐẦU TIÊN đưa tiền thật (`ai.credit.adjust`, `ai.pricing.update`) qua
đúng bảng ấy, và không ai xét lại quyết định `SET NULL` khi việc đó xảy ra — Task 17 chỉ VIẾT vào
bảng có sẵn, không sửa schema của nó.

**Nơi xử lý:** cân nhắc lại `ON DELETE` cho MỖI dòng `admin_audit` mang tiền — có thể là
`ON DELETE RESTRICT` (không cho xoá một tài khoản admin còn để lại dấu vết tiền, buộc phải xử lý
dấu vết trước), hoặc một cột phụ lưu EMAIL/tên tại thời điểm ghi (không phụ thuộc `users` còn sống
hay không, cùng tinh thần cột `actor` đã chọn cho vấn đề liền kề). Quyết định này ảnh hưởng cả
`published_courses`/`course_versions`'s admin_audit rows (Task 8), không chỉ hai route Task 17 —
nên đây là một quyết định schema-rộng, không phải một sửa cục bộ trong `internal/ai`. Chưa task
nào được giao.

### 3 — Cổng quét route theo ĐỊNH DANH HANDLER: một closure trung gian vẫn né được

`apps/api/internal/ai/admin_handler_test.go` (`adminAIHandlerRefs` + `TestAdminAIRoutesAllRequireAdmin`)
khoá bảy handler admin bằng `reflect.ValueOf(method).Pointer()`, rồi duyệt `app.Stack()` thật và đòi
mỗi route trỏ tới một trong bảy con trỏ ấy phải trả 401 khi không session **và** 403 với session
`role='user'`. Đây là bản thay cho cách lọc theo tiền tố `/admin/ai` — cách cũ đã được ĐO là thủng:
một handler admin gắn ở đường dẫn khác vô hình với **cả** middleware tiền tố của fiber **lẫn** test,
non-admin đọc trọn `ai_pricing` với HTTP 200 trong khi toàn bộ suite vẫn xanh.

Bản mới đóng đúng lớp đó — re-review tự tái hiện ba hình dạng (thiếu `RequireAdmin` đăng ký trước
group; hoàn toàn trần, ngoài tiền tố; xoá cả group) và **cả ba đều ĐỎ**, kể cả hình dạng chống rỗng
(`found=[]` → Fatal, không xanh lặng lẽ).

**Điểm mù còn lại, đã ĐO chứ không suy luận:** một handler chỉ tới được qua một **hàm bọc trung
gian** thì không khớp. Re-review thêm route `/wrapped-leak` gọi `AdminListPricing` qua closure
`func(c *fiber.Ctx) error { return aiHandler.AdminListPricing(c) }`, không `RequireAdmin` →
**toàn bộ test cổng vẫn XANH**, và non-admin nhận 200 kèm bảng giá. Chú thích tại chỗ khai đúng
phạm vi này, không hứa rộng hơn.

Không có route nào như vậy trong mã hôm nay — đây là hạn chế **của cổng**, không phải lỗ đang sống.

### Bán kính: bản trước của mục này đánh giá SAI, và đây là bản đúng

> Bản trước (do chính điều phối viên viết) biện minh cho "chưa đáng đóng" bằng câu: *"mọi route sau
> cổng admin đều là 'người vận hành tự bắn chân', không phải lỗ hổng cho người đọc."* Tiền đề ấy
> **không áp dụng cho chính lỗi đang bàn**, và đó là điều duy nhất khiến lập luận sụp: route mà
> re-review dựng lên (`/wrapped-leak`) **KHÔNG nằm sau cổng admin** — nó nằm sau `auth.Require`
> TRẦN. Cả điểm mù là chuyện gì xảy ra khi một handler admin bị gắn ở NGOÀI cổng ấy; lấy "ở trong
> cổng ấy" ra làm lý do là trả lời một câu hỏi khác.

Bán kính thật, đo lại trên `apps/api/internal/ai/admin_handler.go` ngày 2026-08-29: **bảy** handler
admin (`AdminListUsers`, `AdminGetUser`, `AdminAdjustCredit`, `AdminListPricing`,
`AdminUpdatePricing`, `AdminGetSettings`, `AdminUpdateSettings`) **không handler nào tự kiểm role**
— mỗi cái mở đầu bằng `h.caller(c)` và chỉ từ chối khi `actorID == uuid.Nil` (401 "unauthenticated").
Vai trò admin được cưỡng chế **duy nhất** bởi dây route (`server.go:489`,
`app.Group("/admin/ai", auth.Require, auth.RequireAdmin)`).

Nên một route bọc closure gắn sau `auth.Require` trần trao cho **BẤT KỲ tài khoản đã đăng ký**:
email và số dư của mọi người dùng, sổ chi tiêu của người dùng bất kỳ, và **quyền tự nạp credit cho
chính mình** (`AdminAdjustCredit`). Đó là **LEO THANG ĐẶC QUYỀN**, không phải người vận hành tự bắn
chân — nạn nhân là nền tảng và mọi người học, còn kẻ hưởng lợi chỉ cần một tài khoản miễn phí.

### Vì sao "chưa đáng đóng" VẪN đứng — trên lý do thật

Không phải vì hậu quả nhỏ; hậu quả lớn. Mà vì **điều kiện kích hoạt là một dòng mã chưa ai viết**:
lỗ chỉ tồn tại nếu ai đó gắn một handler admin qua closure. Không route nào như vậy tồn tại hôm nay,
và cổng có chốt chống-rỗng (`found=[]` → Fatal) nên "xanh" không thể là "không quét được gì". Còn
đóng đúng thì cần phân tích luồng gọi, hoặc một quy ước cấm bọc handler admin — mà quy ước ấy tự nó
cần một cổng.

Đổi lại, vì hậu quả là leo thang đặc quyền chứ không phải bất tiện vận hành, **hai câu dưới đây là
ràng buộc, không phải lời khuyên.**

**Nơi xử lý — quy tắc cứng:** nếu sau này có lý do chính đáng để bọc một handler admin trong closure
(đo đạc, chuyển đổi lỗi, phân trang chung), thì **cùng commit ấy** phải mở rộng cổng. Đừng bọc trước
rồi tin rằng cổng vẫn canh.

**Cách giảm thiểu rẻ hơn, chưa làm, ghi để không phải nghĩ lại:** cho mỗi handler admin tự kiểm role
(phòng thủ nhiều lớp) thì dây route sai không còn tự nó đủ để mở cửa. Nó không thay được cổng — một
handler mới quên kiểm là lại thủng — nhưng nó biến "một dòng dây sai" từ *đủ* thành *chưa đủ*. Chưa
làm ở vòng sửa nào vì đó là một quyết định kiến trúc về nơi thẩm quyền sống, không phải một bản vá
câu chữ; ghi ở đây để lần sau ai đó cân nhắc thì biết nó đã được cân nhắc và vì sao bị hoãn.

Một rủi ro lý thuyết đã xét và bỏ qua: `reflect.Value.Pointer()` cho `Kind() == Func` được Go doc
cảnh báo là *"not necessarily enough to identify a single function uniquely"*. Linker của Go hiện
không gộp mã trùng, và lấy `.Pointer()` của method value buộc trình biên dịch tạo symbol có địa chỉ
thật. Kể cả nếu va chạm xảy ra, hậu quả xấu nhất là **nhầm TÊN handler trong thông báo lỗi** — route
vẫn nằm trong tập được kiểm, nên không sinh ra lỗ ẩn. Tiền đề "con trỏ độc lập với receiver" không
được tin suông: `TestAdminAIHandlerRefsIdentifyMethodNotReceiver` dựng hai instance `*Handler` riêng
và đo trên chính toolchain đang build.

---

# Nợ Pha 2 (AI máy chủ) — vòng sửa sau review tổng nhánh, hai đợt (2026-08-28/29)

Mọi mục dưới đây đã được ĐO, không suy luận, và mỗi mục ghi **điều kiện xét lại** thay vì một lời
hứa mơ hồ sẽ làm sau. Đợt 1 sửa mã (deploy sạch, `courseSlug`, hai lỗ an ninh, ba lỗi tiền); đợt 2
sửa câu chữ, tài liệu, và chính sổ này.

## A · Nợ do một QUYẾT ĐỊNH đã chốt sinh ra

### A1 — Grant 50.000 micro cho mỗi tài khoản mới, và repo KHÔNG có xác thực email

QĐ-1 của điều phối viên đặt `ai_settings.signup_grant_micro = 50_000` (migration `0008`). Ship `0`
không phải "chưa chốt giá", nó là tính năng tắt — mọi tài khoản mới nhận 402 ngay câu hỏi đầu tiên.

**Rủi ro đã cân và NHẬN, có tên:** không có xác thực email nào trong repo. Đo lại 2026-08-29:
`email_verified` / `VerifyEmail` khớp đúng **ba** dòng dưới `apps/api`, và **cả ba là CHÚ THÍCH ghi
lại chính con số không ấy** (`ratelimit.go:23-24`, `admin_handler.go:99`) — không dòng mã nào. Nên K
tài khoản = K × 50.000 micro. Nhận vì (a) lựa chọn còn lại là ship
một sản phẩm không ai dùng được tính năng chủ lực; (b) 50.000 micro ≈ 13 lượt ở giá seed; (c)
`RateLimiter` chặn TỐC ĐỘ đốt của mỗi tài khoản (nhưng **không** chặn số tài khoản — xem mục
"RateLimiter khoá theo user id" ở trên, cùng lỗ, ghi từ Task 10).

**Điều kiện xét lại:** khi bật thanh toán ở Pha 4, **hoặc** khi thấy dấu hiệu farm (nhiều tài khoản
mới cùng đốt hết grant rồi im).

### A2 — `GrantSignupCredit` là đường TẠO credit duy nhất không để lại dấu vết TỪNG SỰ KIỆN

Đo: `admin_audit` trước/sau một lần đăng ký = 0→0, và không có hàng `ai_usage` như `ChargeTurn` để
lại. Vô hại khi grant = 0; **bản sửa A1 làm nó thành mù**.

Đợt 1 **cố ý không** ghi một hàng `admin_audit` mỗi lần đăng ký: cột `who` là khoá ngoại tới một
CON NGƯỜI đã bấm, và một lần tự đăng ký không có con người ấy — một hàng mỗi signup sẽ phình bảng
vô hạn bằng những dòng không nêu tên ai, chôn vùi đúng những thao tác mà bảng ấy tồn tại để tìm.

Thay vào đó, **TỶ GIÁ đúc** truy được đủ: mỗi lần `signup_grant_micro` đổi, `UpdateSettings` ghi một
hàng `ai.settings.signup_grant` kèm con số; migration `0008` ghi hàng ấy cho giá trị KHỞI ĐẦU
(`who = NULL`, `actor = 'cli'`) nên trục thời gian không có lỗ **ở đầu**.

**Nhưng trục ấy CÓ lỗ, và chính repo này đi qua nó.** Re-review đo: không `TRIGGER` nào trên
`ai_settings` (0 trong toàn bộ `migrations/`), và nơi ghi audit DUY NHẤT là `credits.go:909` bên
trong `UpdateSettings`. Một `UPDATE ai_settings` thô **không để lại hàng nào** — và repo có một cái
đang chạy: `scripts/test-e2e.sh:277`. Chú thích của chính `0008` còn hợp thức hoá đường ấy ("người
vận hành đã tự sửa cột này bằng psql … KHÔNG được migration này ghi đè"). Tệ hơn: sau một lần sửa
bằng psql, `0008` cũng sẽ không ghi bù, vì điều kiện `= 0` không còn đúng.

Nên câu trả lời đúng cho "đổi ba lần rồi hỏi tài khoản X nhận bao nhiêu" là: **tái dựng được CHỈ KHI
cả ba lần đi qua CMS hoặc route**. Một lần đi qua psql thì trục gãy **im lặng**, và phép tái dựng
trả về một **số sai** — không phải "không biết". Đó là chế độ hỏng tệ hơn, vì nó trông như một câu
trả lời.

**Khoảng trống còn lại:** không có bản ghi từng SỰ KIỆN đúc, chỉ có tỷ giá đang hiệu lực. Đóng nó
cần một bảng riêng (hoặc một cột trên `ai_credits`) — một quyết định schema.
**Điều kiện xét lại:** khi bật thanh toán Pha 4, hoặc khi cần đối soát số credit đã phát hành.

## B · Ràng buộc không có cổng, hoặc có cổng hẹp hơn chú thích nói

### B1 — Ràng buộc #4 (tiền là `int64`, không float) KHÔNG có cổng CẤU TRÚC

Đo (review): đổi `divUp` sang `int64(math.Ceil(float64(...)))` → `go build` OK, `go test
./internal/ai/` **XANH**. Sau đợt 1, cùng đột biến ấy SẼ đỏ — nhưng chỉ vì các bài kiểm tràn mới
đọc giá trị biên mà `float64` không biểu diễn nổi. Đó là hệ quả **gián tiếp**, không phải một cổng
nói "đường tiền không được có `float64`".
**Nơi xử lý:** một phép quét nguồn cấm `float64`/`math.` trong `internal/ai/cost.go` +
`credits.go`, cùng khuôn `i18n_server_speaks_codes_test.go`.

### B2 — Allowlist ĐÍCH ĐẾN của lời gọi ra ngoài bị xoá, và KHÔNG có bản thay

`no_key_transit_test.go` (xoá ở Task 11) mang một allowlist chặn "mã sản phẩm không được gọi ra
ngoài trừ danh sách hẹp". Bản thay `provider_key_never_leaks_test.go` **cố ý không** thay nó và tự
khai điều đó (PHẠM VI THẬT, điểm 3). Hôm nay **không gì cản** `internal/ai` gọi một host KHÁC
DeepSeek nếu `DEEPSEEK_BASE_URL` (đọc từ env) bị đổi — và biến ấy được khai trong `render.yaml`, tức
sửa được từ Environment tab mà không cần deploy.

Ba chú thích quanh nó vẫn nhắc tên tệp đã xoá cho tới đợt 2 (mục E3), nên sự VẮNG MẶT của cổng này
rất dễ bị đọc thành sự có mặt.
**Nơi xử lý:** viết cổng đích đến khi có lý do thật (một client thứ ba, hay một proxy) — đúng chỗ nó
thuộc về, `internal/ai`, không phải `internal/server`.

### B3 — 169 khoá i18n mồ côi, và `i18n.test.ts` không có cổng bắt khoá mồ côi

Đo lại 2026-08-29 bằng script riêng (quét `apps/web/src` + `packages/i18n/src`, mọi `.ts`/`.tsx`
không phải hai tệp catalog): **169 / 553** khoá không có chỗ gọi nào. Không có ``t(`…`)`` động thật
nào trong mã (15 kết quả khớp đều là `it(`/`http.get(`/`mount(`), nên con số không có dương tính
giả. Đo lại trên `c9e3333` (trước đợt 2) cho **cùng 169 khoá, danh sách y hệt** — đợt 2 không thêm
cũng không bớt khoá mồ côi nào.

Phần lớn là tàn dư Pha 1 (`library.*`, `nav.import`, `courses.import.action`, …), **KHÔNG do Pha 2**.
Nhưng vì không có cổng, con số chỉ có thể tăng. Hai trong số đó còn mang chú thích khẳng định chúng
"còn sống"; đợt 2 sửa chú thích chứ **không xoá khoá** — xoá lẻ hai khoá không đóng được lớp lỗi và
làm con số đã đo thành sai.
**Nơi xử lý:** một bài trong `i18n.test.ts` quét ngược từ catalog ra mã, với một ngưỡng khởi đầu 169
hạ dần — không thể bắt đầu bằng 0.

## C · Tiền: chỗ đã đóng một nửa, và cột không ai đọc

### C1 — `ErrChargeOverflow` = một lượt miễn phí, không dòng sổ

Đợt 1 (D2) làm số học tiền từ chối khi tràn thay vì wrap. Thừa nhận thẳng: lượt đã chạy, DeepSeek đã
được trả tiền; trả lỗi ở đây **không lấy lại được tiền**. Nó biến một dòng sổ *sai và im lặng* thành
một dòng log **vắng và có tên**. Chưa có retry, chưa có dead-letter — cùng lớp với mọi thất bại khác
của `ChargeTurn`.

### C2 — `MaxPricingRateMicro` KHÔNG áp cho `credits_per_web_search` / `cost_micro_per_web_search`

Vì không route nào ghi hai cột ấy (`AdminUpdateSettings` nhận `base_system_prompt` và
`signup_grant_micro`, hết). **Nếu đợt sau mở route cho chúng thì trần phải đi kèm** — `cost.go`'s
kiểm tràn phủ số học, không phủ đầu vào.

### C3 — `credits_per_web_search` = 0 → mỗi lần tìm kiếm web MIỄN PHÍ

`0007:59-60` đặt cả hai cột `DEFAULT 0`. Bật `web_search` thì phụ thu là 0 và sổ ghi 0 ở **cả hai**
cột. Không route nào sửa được (C2). Vô hại hôm nay vì `BRAVE_API_KEY` chưa từng được đặt ở đâu; trở
thành một khoản chi không đo được ngay khi nó được đặt.

### C4 — `ai_usage.cost_micro` là cột CHỈ-GHI

Không truy vấn nào SELECT nó: `RecentUsage` (`credits.go:480-483`) đọc `credits_charged` và bảy cột
token, không đọc `cost_micro`. Mà `cost.go` nói Pha 4 sẽ định giá **dựa vào** nó. Nặng thêm vì
`cost_micro_per_web_search` mặc định 0 (C3) và vì `cost_micro` bỏ sót mọi web search LỖI
(`credits.go:232-235` tự khai điều này).

### C5 — `formatCredits` nuốt mọi số dư dưới 100 micro, kể cả DẤU

`money.ts:31` dùng `maximumFractionDigits: 4`. Đo: `1 → "0"` và `-1 → "-0"` — hai trạng thái **ngược
nhau** ở đúng chỗ quan trọng nhất (`EnsureCredit` CHO QUA số dư 1, CHẶN số dư -1) hiển thị gần giống
hệt, và `"-0"` là chuỗi không ai chủ ý viết.

## D · Hạn mức và cấu hình

### D1 — `RateLimiter` chỉ canh `POST /ai/chat`

Đo tại `server.go:472-475`: `/ai/chat` đi qua limiter; `PUT /ai/config` (ghi DB, tới 4000 rune) và
**cả bảy** route `/admin/ai/*` không có hạn mức theo user.

### D2 — `UpdateSettings` ghi audit theo "trường CÓ MẶT", không theo "giá trị ĐỔI"

`credits.go:907` — `if signupGrantMicro != nil` thì ghi một hàng `ai.settings.signup_grant`, kể cả
khi con số y hệt con số đang lưu. Đợt 2 bù ở CLIENT (`AdminPricing.tsx` chỉ gửi grant khi nó khác
giá trị máy chủ đang giữ, và có bài kiểm cho đúng ca ấy), nhưng **máy chủ vẫn nhận và vẫn ghi** cho
bất kỳ client nào — kể cả `curl`. Một lớp bù ở client không phải một luật ở server.
**Nơi xử lý:** đọc giá trị hiện tại trong cùng transaction và chỉ ghi audit khi nó thật sự đổi.

### D3 — `0007_ai_credits.down.sql` thiếu `IF EXISTS`

`DROP TABLE ai_settings, ai_pricing, user_agent_config, ai_usage, ai_credits;` — khác **mọi** tệp
`down` còn lại trong thư mục. Một lần `down` trên CSDL đã mất một trong năm bảng sẽ chết giữa chừng.

### D4 — `0008_ai_credit_bootstrap.down.sql` CỐ Ý không đảo phần backfill

Lý do đầy đủ nằm trong chính tệp ấy: sau `0008` không có cột nào phân biệt hàng do backfill tạo với
hàng do đăng ký hay do admin nạp, và số dư đã sống từ lúc ấy — một `DELETE` ở đó xoá tiền thật của
người thật để làm sạch một con số. `down` chỉ đảo nửa CẤU HÌNH (grant về 0, và chỉ khi nó vẫn đúng
bằng con số `0008` đặt).

### D5 — `BRAVE_API_KEY` vắng khỏi `compose.e2e.yml`

Đo: **0** lần. Nên tool `web_search` chưa từng chạy trong e2e, kể cả với một hàng giả — xem thêm mục
"Chưa ai gọi một nhà cung cấp AI thật" ở trên.

## E · Con trỏ tới `.superpowers/` — 113 chỗ trong mã, và vì sao chúng chết trong mọi clone

**Luật, viết ra một lần ở đây để mọi chỗ khác trỏ về:** sổ thực thi (`.superpowers/sdd/…`) bị
`.gitignore:41` loại khỏi repo. Một tệp tài liệu hay một chú thích trong mã **được track** mà trích
một đường dẫn dưới đó là một con trỏ **chết trong mọi clone, kể cả clone của chính tác giả sau khi
dọn**. Nếu một sự thật đáng để người đọc mã biết thì nó phải được **chép vào tệp được track**, không
phải được trỏ tới.

**Bán kính, đo lại ngày 2026-08-29 sau vòng sửa cuối:** `task-<N>-report.md` /
`task-<N>-brief.md` xuất hiện **115 lần** trên **47 tệp** dưới `apps/`, `packages/`, `scripts/`
(một bản nháp trước của mục này ghi 113/45 — đo trước khi chính vòng sửa ấy thêm hai chỗ nữa; một
cổng gieo ở 113 sẽ đỏ ngay lúc dựng, nên con số phải đo SAU cùng) (đếm bằng `grep -rna`, có cờ `-a` — xem lưu ý
về NUL bên dưới), cộng vài chỗ trong `docs/`. Phần lớn dùng chúng làm **trích dẫn nguồn cho một phép
đo** ("đo bằng đột biến, xem task-13-report.md §7.2") — tức đúng loại khẳng định mà người đọc sau
này muốn kiểm và **không kiểm được**.

**Vòng sửa đợt 2 chỉ đóng bốn cái trong `docs/`** (`deploy.md:33`, `testing.md:13`,
`deepseek-measured.md:14-15`, cộng hai chỗ trong chính tệp này) vì đó là phạm vi được giao. 113 chỗ
trong mã **chưa đụng**: sửa lẻ vài chỗ không đóng được lớp lỗi và làm con số đã đo thành sai — cùng
lập luận đã dùng cho 169 khoá i18n mồ côi ở mục B3.

**Nơi xử lý:** một phép quét cấm chuỗi `.superpowers/` và `task-<N>-report.md` trong tệp được track,
với ngưỡng khởi đầu 113 hạ dần. Trước đó, mỗi lần sửa một chú thích có trích dẫn như vậy thì **chép
kết luận vào chỗ đó** thay vì giữ con trỏ.

**Một bẫy phương pháp đã trả giá trong chính đợt này, ghi để không ai vấp lại:** `grep -rn` **bỏ
qua** `apps/web/src/api/ratings.ts` — nó chỉ in `Binary file … matches` — vì tệp ấy chứa một byte NUL
hợp lệ (`ratingsQueryKey` dùng `\0` làm dấu phân cách khi join). Nhờ đó một chú thích SAI ở đó
(bản sao thứ chín của khẳng định "apps/api makes no outbound calls", mục E3) suýt lọt qua cả một
vòng dọn chuyên đi tìm đúng nó. **Mọi phép quét toàn repo trong repo này phải dùng `grep -a`.**

## Text của nhà cung cấp đi vào apilog: ĐÃ ĐO, chấp nhận có điều kiện (Task 12 → follow-up)

**Hình dạng.** `client.go` và `stream.go` bọc `error.message` của DeepSeek **nguyên văn** (cắt bằng
`truncateProviderMessage`, trần 200 rune) vào error Go; error ấy tới
`slog.Error("ai turn failed", …, "err", runErr.Error())` ở `handler.go` — tức **vào apilog**. Giữa
chỗ bọc và chỗ ghi log **không có gì kiểm nội dung mà nhà cung cấp tự viết**. Nếu DeepSeek trích lại
một mảnh request bị từ chối (từ chối vì chính sách nội dung là hình dạng khả dĩ nhất), mảnh đó mang
nội dung người học và vào log không qua lọc.

Cổng `apilog/no_ai_bodies_test.go` khai đúng lỗ này trong doc comment ("One shape is DELIBERATELY
left untested here") và để lại — task này là chỗ trả lời.

**Đã đo (docs/deepseek-measured.md §6, ngày 2026-08-29):** sentinel đặt **chỉ** trong
`messages[].content`, 11 đường gây lỗi khác nhau (model sai, `temperature` ngoài dải, `max_tokens`
âm, `role` sai, `content` sai kiểu, `tool_choice` không hỗ trợ, key sai, `tool_calls.arguments` hỏng,
message `tool` mồ côi, `tools[].type` sai variant, prompt 1,68 triệu ký tự). **Sentinel xuất hiện
trong 0/11.**

Sắc thái đáng giữ: DeepSeek **có** echo giá trị request — nhưng chỉ ở **trường vô hướng** (serde của
Rust trả nguyên văn variant enum và số). Khi trường sai **chính là chỗ mang nội dung**, nó mô tả kiểu
thay vì đổ giá trị (`messages[0]: content should be a string or a list`). Lỗi ngữ nghĩa là câu cố
định, không mang giá trị nào. Và DeepSeek **tự che key của chính nó** (`Your api key: ****0000`).

**Quyết định: GIỮ `error.message`, không lọc thêm.** Vì (a) phép đo không tìm được đường rò nào;
(b) chính các thông điệp ấy là thứ người vận hành cần — *"The supported API model names are …, but
you passed …"* nói thẳng vấn đề, bỏ đi là mất toàn bộ khả năng chẩn đoán để đổi lấy một lợi ích riêng
tư không đo được; (c) trần 200 rune hoá ra được hiệu chỉnh đúng — thông điệp hữu ích dài nhất quan
sát được là 139 ký tự, dài nhất nói chung ~160, nên trần đang cắt đúng thứ nó sinh ra để cắt.

**Cái này KHÔNG đóng — hai lớp còn lại, không đo có chủ ý:**
1. **Từ chối vì chính sách nội dung** — đúng hình dạng đáng lo nhất. Kích hoạt nó đòi soạn nội dung
   cốt để bị từ chối, nên không đo. Đây là lỗ thật, không phải chỗ bỏ quên.
2. **429 / hết quota** — không kích hoạt được theo yêu cầu.

Và đây là **ảnh chụp một API bên thứ ba ở một ngày, không phải hợp đồng**. DeepSeek đổi câu chữ lỗi
lúc nào cũng được, không báo ai. Không cổng nào ở phía ta phát hiện được việc đó.

**Điều kiện xét lại:** (a) quan sát thấy một lần từ chối vì chính sách nội dung trong log thật —
đọc `message` của nó trước khi làm gì khác; (b) DeepSeek đổi hình dạng thân lỗi; (c) đổi nhà cung
cấp. Khi ấy cách đóng rẻ nhất là **chỉ giữ `type`/`code`, bỏ `message`** ở đường log (giữ `message`
cho error trả về caller nếu vẫn cần phân biệt), vì `type`/`code` mang đủ thông tin phân loại mà
không mang chữ tự do nào.

**Một chỗ hồ sơ đã sửa cùng lúc:** chú thích tại `handler.go` từng khẳng định `slog.Error` ghi
*"never the question, never the answer"* — không đúng vô điều kiện, vì `runErr` mang được text mà
gói này không viết ra. Nay nó nói đúng phạm vi: **không mã nào trong gói này** đưa câu hỏi hay câu
trả lời vào `runErr`, và phần còn lại là rủi ro đã đo, đã ghi.

---

# Nợ Pha 3 (Dữ liệu lên máy chủ) — 2026-09-01/02

Thi công 01/09/2026, 14 task. Spec: `2026-08-25-server-side-pivot.md` §4/§9. Plan:
`2026-09-01-pha3-du-lieu-len-may-chu.md`. Bàn giao đầy đủ:
`docs/superpowers/plans/2026-09-01-pha3-ban-giao.md`. Mục dưới đây là bốn khoản Task 14 (tài liệu)
được giao ghi lại, cộng một khoản bổ sung tìm được sau đó ở vòng review hẹp cuối cùng (mục cuối tệp
này) — mỗi khoản do một vòng review trong pha tìm ra, không phải do Task 14 tự phát
hiện, trừ khi ghi rõ khác.

## `POST /sync` là mã chết theo lịch — điều kiện xoá, và lỗ đã biết

**Trạng thái: còn sống, có ngày hết hạn.** Gói `apps/api/internal/sync` nay chỉ còn một route,
`POST /sync` (`GET /sync` đã xoá thật ở Task 3 — không còn client nào gọi). Chú thích đầu
`handler.go` đã tự ghi đúng — mục này là bản lưu bền ở nơi người đọc sổ nợ sẽ tìm, không phải một
bản sao có thể lệch.

**Vì sao còn sống:** một trình duyệt nâng cấp từ bản cũ có thể còn IndexedDB (Dexie) trên máy, mang
tiến độ/ghi chú chưa từng gửi đi. `apps/web/src/db/legacyDrain.ts` (`drainLegacyDataOnce`, gọi từ
`App.tsx` lúc khởi động, không chặn render) đọc outbox cũ đó, gửi qua đúng `POST /sync` này (chia lô
1000 dòng — `LEGACY_BATCH_SIZE`), rồi mới `indexedDB.deleteDatabase('tuhoc')` — **flush trước, xoá
sau**, không đảo thứ tự (đảo thứ tự là một hàm không còn gì để gửi, ăn mất tiến độ của người học
trong im lặng).

**Điều kiện xoá — đúng, không phải `apilog`:** tín hiệu là **access log** (middleware
`fiber`'s `middleware/logger`, gắn qua `Deps.LogOutput` trong `server.go` — trên Render đây là log
nền tảng, stdout, mọi request đều có một dòng bất kể thành hay bại), **KHÔNG PHẢI** `apilog`. Lý do:
gói `apilog` chỉ ghi khi có lỗi 5xx (`apilog.Internal`) — một `POST /sync` thành công, tức trường hợp
BÌNH THƯỜNG của một trình duyệt đang flush đúng cách, không bao giờ để lại dấu vết ở đó. "Không
`apilog` entry nào" đã ĐÚNG từ ngày đầu tiên, kể cả khi trình duyệt vẫn đang flush qua route này mỗi
ngày — dùng `apilog` làm điều kiện xoá sẽ xoá gói này khi nó vẫn đang được dùng thật. Điều kiện đúng:
**zero `POST /sync` trong access log, 30 ngày liên tiếp.** Đây là quyết định LỊCH, không phải quyết
định mã — hết cửa sổ, xoá gói này giống hệt cách `GET /sync` đã bị xoá ở Task 3.

**Lỗ đã biết, không giấu:** một người học không mở lại app trong cửa sổ 30 ngày đó **mất** bất cứ
thứ gì còn nằm trong outbox cục bộ chưa flush. Lỗ này KHÔNG đóng bằng mã — nó đóng bằng việc **chọn
thời điểm xoá đủ rộng** (30 ngày là biên đủ để hầu hết người dùng thật đã quay lại ít nhất một lần).
Nếu 30 ngày là không đủ cho phân bố người dùng thật của nền tảng, việc cần làm là dời điều kiện xa
hơn — TRƯỚC khi xoá gói, không phải sau.

**Một chỗ hồ sơ Task 14 sửa cùng lúc:** chú thích của `MaxItemsPerPush`
(`apps/api/internal/sync/handler.go`) từng nói "the web client (apps/web/src/sync/engine.ts) sends
its WHOLE outbox in one request with no chunking" — `sync/engine.ts` đã bị xoá ở Task 10; người gọi
CÒN LẠI duy nhất là `legacyDrain.ts`, và nó ĐÃ chia lô 1000 dòng. Đã sửa tại chỗ; hằng số
`MaxItemsPerPush = 10000` giữ nguyên giá trị vì cả gói sắp bị xoá theo lịch ở trên, không đáng siết
lại cho một người gọi sắp không còn tồn tại.

## Ruling F5 — nửa RETIRED, nửa còn sống, và một khẳng định sai Task 14 bắt được khi đi tìm nó

**Ruling F5 gốc (P1):** phần trăm hoàn thành và mọi thứ `useProgress` phơi ra tính từ tiến độ CỤC BỘ
(Dexie qua `liveQuery`), không bao giờ cần một vòng mạng — vì trang chủ (`/`) là màn hình đầu tiên
mọi phiên mở ra, và nó phải đúng khi không có mạng.

**RETIRED, có chủ ý (Pha 3, Task 6 + Task 9):** Task 6 viết lại `useProgress` thành TanStack Query +
ghi lạc quan (không còn Dexie ở dưới); Task 9 làm y hệt cho `progress/recent.ts`'s hai hook
(`useLastStudiedCourseId`, `useRecentNotes`) và `pages/Progress.tsx`'s `useLocalProgress`. Cả ba đều
gỡ tiền đề "không cần mạng" CÓ CHỦ Ý, cùng lý do: Task 10 xoá Dexie hoàn toàn, Task 11 xoá nhánh
ngoại tuyến của `RequireAuth`. Từ Pha 3, **không trang nào của app còn đúng khi mất mạng** —
`RequireAuth` hiện `auth.needsNetwork` ("cần mạng") thay vì render một cây đã cache.

**Phần còn sống, THU HẸP PHẠM VI:** `pages/Dashboard.tsx` và `pages/Progress.tsx` vẫn tính số chương
đã đọc từ `useProgress` thay vì từ `stats.courses[].chaptersDone` (trường này tồn tại ở API, có
trong response, nhưng không dòng TSX nào đọc nó — đo lại 2026-09-02). Lý do còn lại KHÔNG phải tính
sẵn có nữa mà là ĐỘ TRỄ: `useProgress` ghi lạc quan, một chương đánh dấu đã đọc hiện NGAY trong
cache; `stats.courses[].chaptersDone` chỉ nhích lên sau khi `PUT /progress` thành công VÀ `/stats`
được hỏi lại. Cùng một sự kiện, hai độ trễ khác nhau — trang của các con số chọn cái nhanh hơn. Xem
`pages/Progress.tsx`'s chú thích "Vì sao số chương vẫn tính từ `useProgress`" cho lập luận đầy đủ.

**Khẳng định sai Task 14 bắt được khi đi kiểm mục này (đúng dạng lỗi Pha 2 cảnh báo — hồ sơ hứa
rộng hơn mã, và nó SỐNG SÓT qua cả Task 6, Task 9, Task 11 mà không ai chạm tới):**
`pages/Dashboard.tsx`'s doc comment, ngay dưới tiêu đề `## Ruling F5 còn nguyên`, viết đến tận
2026-09-01: *"Trang này phải đúng khi không có mạng, vì nó là trang mở ra trước cả khi ai kịp biết
mình có mạng hay không."* Câu này SAI kể từ Task 6/9/10/11 — `useProgress` đọc `GET /progress` qua
mạng, không còn Dexie/`liveQuery` nào ở dưới, và trang này **không còn** đúng khi mất mạng. Không
phép quét `outbox|/sync|ngoại tuyến|offline|IndexedDB|Dexie` nào của Task 14 bắt được câu này — nó
không chứa từ khoá nào trong danh sách đó — chỉ bắt được bằng cách lần theo tên "ruling F5" và đọc
lại đúng nghĩa gốc của nó. Đã sửa tại chỗ (`Dashboard.tsx`), đổi tiêu đề thành
`## Ruling F5, thu hẹp phạm vi (Pha 3)` và viết lại đúng phần còn sống ở trên.

## C-1 tái diễn BA lần trong Pha 3, ba hình dạng mới — và một hình dạng dây bẫy `SESSION_CLEARERS` không bắt được

`clearSession()` (`apps/web/src/auth/session.ts`, ruling P2-F18) là điểm chân lý DUY NHẤT của
codebase này cho việc dọn dữ liệu một người học rời đi. Pha 3 thêm ba kho dữ liệu mới, và cả ba lần
đầu tiên đều KHÔNG được nối vào cửa đó — đúng hình dạng C-1 (rò rỉ chéo tài khoản) đã đóng ở P1, tái
diễn ba lần trong MỘT pha:

1. **Hàng đợi heartbeat trong bộ nhớ** (`api/events.ts`, Task 8's bản đầu) — không có reset nào cả.
   Một heartbeat của A còn nằm trong `queue` sống sót qua `useLogout()`, và lượt tick tiếp theo của
   `startEventFlusher()` — khởi động lại dưới phiên B ngay khi B đăng nhập cùng tab — POST nó lên
   `/events/batch` dưới cookie B, gán nhầm phút học của A cho B. Đóng bằng `resetEventQueue()`, nối
   vào `clearSession()`, chứng minh đầu-cuối ở `test/eventQueueHandoff.test.tsx`.
2. **Một cú flush bị bỏ rơi tái tiêm gói của A vào hàng đợi của B** (Task 8's vòng sửa, một review
   hẹp bắt tiếp). `useLogout.ts`'s best-effort flush chạy trong `withTimeout(…, LOGOUT_SYNC_TIMEOUT_MS)`
   — timeout ấy chỉ đua với PROMISE NGOÀI, không huỷ request thật (không `AbortController` nào trong
   `api/client.ts`). Một flush còn chạy khi mốc 5s hết hạn bị BỎ RƠI, không bị huỷ, và tiếp tục chạy
   trong lúc logout dọn sạch mọi thứ — kể cả `resetEventQueue()`. Nếu phản hồi TRỄ của nó là một THẤT
   BẠI, nhánh `catch` cũ tái tiêm gói của A vào bất cứ thứ gì `queue` đang giữ LÚC ĐÓ — trên một lần
   bàn giao cùng tab, có thể đã là hàng đợi vừa mới của B. Đóng bằng `queueGeneration`
   (`api/events.ts`), mô phỏng đúng cơ chế `syncEpoch` cũ của `sync/engine.ts` (đã xoá): một flush
   đóng dấu thế hệ hiện tại trước khi đợi mạng, và chỉ tái tiêm nếu thế hệ ấy vẫn còn đúng lúc thất
   bại — một `resetEventQueue()` xen vào giữa thì gói bị DROP, không bị ghi lại.
3. **Bộ nhớ đệm mutation của TanStack Query** (Task 11's phát hiện review). `networkMode: 'online'`
   mặc định (repo không cấu hình gì khác — `App.tsx`'s `new QueryClient()` để trống) khiến một
   mutation gửi lúc mất mạng bị TẠM DỪNG chứ không thất bại, và TỰ ĐỘNG TIẾP TỤC ngay khi
   `onlineManager` báo có mạng lại — gửi lại qua `api/client.ts`'s `send()`, luôn mang
   `credentials: 'include'`, tức bất kỳ cookie nào đang hợp lệ LÚC ĐÓ, không phải tài khoản đã bắt
   đầu việc ghi. A mất mạng giữa lúc ghi, mutation tạm dừng, A đăng xuất, B đăng nhập, có mạng lại —
   không có bản vá thì việc ghi tạm dừng của A phát lại dưới cookie B. Đóng bằng
   `queryClient.getMutationCache().clear()`, gọi từ `clearSession()`.

**Dây bẫy cấu trúc không bắt được hình dạng thứ ba, và đây không phải một lỗ — đã được cân nhắc và
ghi lại tại chỗ.** `SESSION_CLEARERS` (`apps/web/src/auth/session.test.ts`) quét AST của mọi tệp mã
nguồn sản phẩm, tìm định danh trùng tên với BA hàm có thể import được
(`clearUserContent`/`resetSessionScopedQueries`/`resetEventQueue`) xuất hiện ở nơi KHÁC
`session.ts` — bắt được đúng lớp lỗi hình dạng #1/#2 ở trên: một hàm được author ở nơi khác, một
call site tương lai có thể import thẳng thay vì đi qua `clearSession()`. **Hình dạng #3 không có gì
để dây bẫy này bắt:** `getMutationCache().clear()` là một LỜI GỌI PHƯƠNG THỨC trên instance
`QueryClient` đã có sẵn trong tay, không phải một hàm import được từ nơi khác — không có "điểm import
thứ hai" nào để quét. `session.ts`'s doc comment tự ghi rõ điều này ("There is nothing to name as a
second import site of a TanStack Query built-in"). Ghi lại ở tầng sổ nợ của pha, không chỉ tầng tệp:
nếu Pha 4 thêm một kho dữ liệu thứ tư mà cách nối đúng của nó CŨNG là một lời gọi phương thức trên
một đối tượng đã có sẵn (không phải một hàm import), `SESSION_CLEARERS` sẽ không bắt được thiếu sót
đó — người thi công phải TỰ nhớ, không có cổng nào nhắc.

## `p2.spec.ts` mất cover e2e cho orphan/rescue (§3/§4 bản cũ) — nợ có tên, có điều kiện

**Trạng thái: hở, có chủ đích, đã báo cáo trung thực ngay trong tệp.** Khi Task 13 gỡ cách ly
`p2.spec.ts`, chỉ MỘT kịch bản được khôi phục/viết lại (§1 hai thiết bị đọc thẳng từ máy chủ, §2 ghi
thất bại thì lùi và báo). Hai kịch bản cũ của bản TRƯỚC rewrite — §3 (một ghi chú mồ côi khi nội dung
chương được dựng lại bên dưới nó) và §4 (cứu một ghi chú mồ côi, gồm cả việc từ chối chọn lại bằng
công thức) — KHÔNG được port sang.

**Vì sao:** plan's câu "7 bài: `p1`×4, `p2`×1, `s2`×1, `widget`×1" bị đọc như một TRẦN, không phải
một hình dạng TỐI THIỂU — lỗi câu chữ ở plan, không phải ở người thi công (đã tự sửa ngay trong pha,
commit `3536b4d`, "con số '7 bài' của Task 13 là hình dạng tối thiểu, không phải trần"). Logic
orphan/rescue KHÔNG đổi trong Pha 3 (`useAnnotations.ts`'s doc: "orphans are data" — resolving là một
phép ĐỌC, không có nhánh ghi nào bị chạm) và vẫn có cover unit đầy đủ (`OrphanPanel.test.tsx`,
`useAnnotations.test.tsx`) — nhưng không còn cổng e2e nào canh nó ở mức trình duyệt thật.

**Vì sao đáng lo hơn một dòng "TODO" bình thường:** `p2.spec.ts`'s bản TRƯỚC rewrite (git history,
commit `9454917`, trước khi Task 13 viết lại) tự ghi trong chính header của nó: *"Seven tasks of P2
are covered by 515 unit tests that mock at least one of those boundaries. That suite is green and
deterministic, and it has still missed a real bug on SIX consecutive rounds — every one of them
found by opening the thing in a browser."* Orphan/rescue là ĐÚNG cái subsystem câu đó nói về. Mất
cổng e2e cho đúng phần lịch sử đã chứng minh unit test không đủ, sáu lần liên tiếp, không phải một
rủi ro trừu tượng.

**Điều kiện xét lại:** trước hoặc cùng lúc với lần tới `anchor.ts`/`normalize.ts`/`OrphanPanel.tsx`'s
đường reattach bị chạm, hoặc như một task độc lập có kích thước riêng — khôi phục hai kịch bản cũ
(§3/§4) vào chuỗi `test.describe.serial` của `p2.spec.ts`. Hạ tầng cần (course `mau-hop-le`, chương
`c1`, hai `BrowserContext` cho hai thiết bị) đã có sẵn từ §1/§2 hiện tại — việc thêm chỉ là các bước
dựng lại nội dung chương dưới một ghi chú đã tồn tại rồi lặp lại cú chọn.

## Mặt nạ `superseded` DÍNH khi trình duyệt quay lại ĐÚNG người cũ — vòng review hẹp cuối cùng bắt được

**Trạng thái: hở, fail-closed, chưa vá.** `apps/web/src/auth/sessionIdentity.ts`'s `receive()` và
`announceSessionUser()` mỗi hàm có một early-return khi giá trị mới TRÙNG với niềm tin cục bộ hiện
tại — `receive()`: `if (data.user === localUser) return;`; `announceSessionUser()`:
`if (localUser === user) return;`. Cả hai đường đều thoát TRƯỚC khi chạm `superseded`; chỉ nhánh
KHÔNG bằng nhau mới xoá cờ. Với `receive()` điều đó đúng ý (không có gì THAY ĐỔI nên không có gì để
báo `superseded`) — nhưng nó bỏ sót đúng một trường hợp: cờ đã bị bật `true` bởi một thông báo TRƯỚC
đó, và thông báo hiện tại tình cờ khớp lại với `localUser`.

**Kịch bản đo được (probe dùng một lần, ghi lại làm bằng chứng chứ không phải suy luận):** tab 1
đăng xuất A rồi đăng nhập lại ĐÚNG A, trong khi tab 2 đang mở trang đọc công khai và trước đó đã tự
xác lập `localUser = 'u-a'`.

1. A đăng xuất ở tab 1 → `clearSession()` công bố `null`. Tab 2's `receive()` thấy `null !== 'u-a'`
   → `superseded = true`. `receive()` KHÔNG cập nhật `localUser` (nó chỉ làm vậy khi `localUser` còn
   `undefined`), nên `localUser` của tab 2 vẫn đứng nguyên ở `'u-a'` suốt từ đây.
2. A đăng nhập lại ở tab 1 → công bố `'u-a'`. Tab 2's `receive()` thấy `'u-a' === localUser ('u-a')`
   → early-return ở nhánh trùng giá trị, `superseded` giữ nguyên `true`.
3. Một lần `GET /me` MỚI của chính tab 2 (refetch do `staleTime` hết hạn, hoặc cửa sổ được focus lại)
   trả lời `'u-a'` — vẫn đúng người trình duyệt đang thuộc về. `useMe.ts`'s hiệu ứng công bố
   (`useEffect(..., [settledUser])`) không chạy lại: `settledUser` đã là `'u-a'` từ trước khi mọi
   chuyện xảy ra (cache của TanStack Query không bị `sessionIdentity.ts` đụng tới) và vẫn là `'u-a'`
   sau, nên giá trị dependency KHÔNG đổi và effect bị React bỏ qua — `announceSessionUser('u-a')`
   không bao giờ được gọi cho trường hợp này. Giả sử nó được gọi bằng cách khác, nó cũng early-return
   ở nhánh trùng giá trị của chính nó trước khi chạm `superseded`.

Đo được: sau bước 3, tab 2 đọc `{ superseded: true, text: 'nobody' }` — dính vĩnh viễn cho tới khi
tải lại trang hoặc người dùng tự tay đăng nhập lại (một `GET /me` mà `settledUser` đổi giá trị THẬT
sự, ví dụ đăng nhập thành một người khác, mới chạy lại effect và xoá được cờ).

**Vì sao fail-closed, không phải rò rỉ:** `nobodyResult()` (`useMe.ts`) là câu trả lời "chưa ai đăng
nhập" — giống hệt một khách vãng lai. Không dữ liệu của ai bị lộ sang người khác; A chỉ bị từ chối
xem CHÍNH dữ liệu của A.

**Hậu quả người dùng thấy, và vì sao bán kính mới hơn bản thân điều kiện:** điều kiện dính cờ này có
từ trước vòng sửa cuối — trước đây `RequireAuth` tự đọc `sessionWasSuperseded()` qua
`useSyncExternalStore` riêng, và dính cờ chỉ đẩy trang được bảo vệ về `/login`, một điều hướng cứng,
không phải một trang câm lặng. Từ khi mặt nạ chuyển hẳn vào `useMe()` (rà soát toàn nhánh, bước 5;
xem chú thích "NỬA MÀN HÌNH CỦA C-1 KHÔNG BIẾN MẤT" ở `RequireAuth.tsx`), MỌI nơi gọi `useMe()` thừa
kế cùng cờ — kể cả `reader/ChapterView.tsx`'s `AuthedReaderExtras`, sống trên tuyến đọc CÔNG KHAI,
gắn chỉ bằng `me.isSuccess && me.data != null`, không đứng sau `<RequireAuth>`. Tab 2 dính cờ mất chú
thích, tiến độ và heartbeat, và hiện đúng lời mời "khách vãng lai" — dù CHÍNH A đang ngồi ở tab đó —
cho tới khi tải lại trang hoặc tự đăng nhập lại trong chính tab này.

**Khẳng định sai `useMe.ts` từng ghi, đã sửa cùng lúc với mục nợ này:** doc comment ở mục "It is not
a lockout…" nói cờ được xoá "the moment its own `GET /me` answers" — đúng khi `GET /me` trả lời một
người KHÁC với niềm tin cũ, nhưng SAI trong đúng ca đo được ở trên: một `GET /me` trả lời TRÙNG người
tab đã tin không xoá được cờ, vì cả hai điểm xoá (`receive()`, `announceSessionUser()`) chỉ xoá ở
nhánh giá trị THAY ĐỔI, và hiệu ứng công bố còn không chạy lại để thử. Đã viết lại đoạn đó tại chỗ để
nêu rõ trường hợp ngoại lệ này thay vì khẳng định vô điều kiện.

**Sửa một dòng, chưa áp dụng (đây là tài liệu, không phải mã):** cho `receive()` xoá `superseded`
(và gọi `notifyListeners()`) cả khi `data.user === localUser`, thay vì early-return im lặng — nghĩa
là mọi thông báo tự nó xác nhận lại "trình duyệt này thuộc về ai" đều xoá cờ, bất kể trùng hay khác
giá trị cũ.

**Bối cảnh liên quan, KHÔNG PHẢI hồi quy — ghi cùng mục để không ai đọc nhầm thành hai món nợ:**

- `annotations/MarginCards.tsx` dòng 487, cleanup unmount gọi `flush()` — mặt nạ khiến nó bắn một
  `PATCH /annotations/:id` cho một bản nháp chưa lưu đúng lúc bàn giao. Không rò: `PatchAnnotation`
  where theo cả `id` VÀ `user_id`, nên dưới B nó khớp 0 dòng → 404; không ai đăng nhập thì 401, và
  `redirectOn401` mặc định `true` nên tab bị điều hướng cứng sang `/login`. Bản debounce cũ, trước
  khi có bản vá cờ này, cũng làm y hệt — đổi THỜI ĐIỂM bắn request, không đổi hành vi.
- `useAnnotations` không có unmount-unpaint: đốm tô sáng (highlight span) của A vẫn còn trong DOM
  chương sau khi lớp ghi unmount — chữ ghi chú thì biến mất vì sống trong React, chỉ đốm tô là còn.
  Đây là một THU HẸP so với trạng thái trước bản vá `superseded`, không phải một lỗ lộ mới do vòng
  sửa này tạo ra.

**Chưa có bài kiểm nào phủ đúng ca này:** `test/supersededTabWrites.test.tsx`'s "KHÔNG phải một cái
khoá vĩnh viễn…" chỉ đo trường hợp tab 2 tự xác lập lại thành một người KHÁC (B) — đúng nhánh
`receive()`/`announceSessionUser()` xoá được cờ, không phải nhánh đang hở ở đây.

**Điều kiện đóng:** vá một dòng ở `receive()` như trên; thêm một bài kiểm cho đúng chuỗi "đăng xuất
rồi đăng nhập lại ĐÚNG người" (chưa tồn tại, xem trên); đo lại bằng đột biến trước khi coi là kín,
theo đúng bài học "một dây bẫy còn xanh không có nghĩa nó còn đo thứ nó từng đo" ở mục *Confused
deputy* của tệp này.
