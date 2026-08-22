# Nợ mang sang giai đoạn sau — kết chuyển từ P1

Ghi lại lúc kết thúc P1 (nhánh `p1-platform-core`, 37 commit, hợp nhất vào `main`).
Đây là những gì P1 **cố ý** để lại, kèm lý do và nơi phải xử lý. Sổ thực thi chi tiết
(`.superpowers/sdd/…`) nằm ngoài git và đã bị dọn; file này là bản lưu bền của phần còn giá trị.

---

## 1. Việc bắt buộc phải làm ở giai đoạn sau

| # | Nội dung | Nơi xử lý | Vì sao |
|---|---|---|---|
| ~~C-1~~ | ~~**Rò rỉ chéo tài khoản qua nhiều tab.**~~ **ĐÃ ĐÓNG** ở hệ thống con 4, Task 1 — xem mục "C-1 — ĐÃ ĐÓNG" bên dưới để biết **cách kiểm lại**. | ~~P4~~ | — |
| C-2 | **`GET /courses` chưa tồn tại.** Spec §4 có liệt kê nhưng không task nào của P1 được giao xây. Dashboard hiện dùng `KNOWN_COURSE_IDS` hardcode trong `apps/web/src/pages/Dashboard.tsx`. Bảng `courses` đã được seed trong migration 0001 nhưng **không dòng Go nào đọc nó**. | **P4-T3** (plan đã sửa thành "TẠO MỚI") | Ba nguồn danh sách khóa học, không nguồn nào là chuẩn. |
| C-3 | **Escape hatch `SameSite=None` thiếu yêu cầu CSRF.** `docs/deploy.md` §0 mô tả phương án chạy trên tên miền miễn phí nhưng không nêu rằng nó **bắt buộc** kèm kiểm tra Origin hoặc CSRF token. Chuỗi "CSRF" không xuất hiện ở đâu trong repo ngoài file này. | **P4-T3** nếu chọn hướng đó | Cookie gửi kèm mọi request cross-site là bề mặt tấn công thật. |

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

## Giao thức kho khoá: dây bẫy quét CHỮ, không quét luồng dữ liệu (S2-F8)

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

## *Confused deputy* của kho khoá — ĐÃ GIẢM THIỂU, CHƯA KHẮC PHỤC (S2-F9 · HC-3)

**Trạng thái: `apps/vault/src/guard.ts` đang chạy. Lỗ vẫn còn. Đừng đọc mã ấy rồi tưởng nó đóng.**

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

## Form nhập key sống trong iframe: chặn được NHÚNG, không chặn được SAO CHÉP (S2 Task 6)

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
