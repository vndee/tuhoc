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
`api.duy.dev` — khác **origin** nhưng **cùng site**, nên `Lax` là đủ và **không cần
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

**Đối chứng đột biến (đã đo 2026-08-22, xem `.superpowers/sdd/2026-08-22-s4-rating/task-1-report.md`):**
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
- `stats.courses[].chaptersDone` được tính mỗi request nhưng **không ai dùng** (ruling F5 cho vòng tiến độ lấy từ dữ liệu cục bộ). Một truy vấn thừa mỗi lần gọi `/stats`.
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
và **bác bỏ có lý do** — ghi ở `.superpowers/sdd/2026-08-22-s2-ai-byok/task-6-report.md` §9.

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
- **Chưa ai gọi một nhà cung cấp AI thật.** OpenAI đã đo được là **bị CORS chặn ở đường lỗi**; đường
  200 chưa đo. Chủ dự án chọn **giữ kèm cảnh báo**.
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
