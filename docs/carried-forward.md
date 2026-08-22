# Nợ mang sang giai đoạn sau — kết chuyển từ P1

Ghi lại lúc kết thúc P1 (nhánh `p1-platform-core`, 37 commit, hợp nhất vào `main`).
Đây là những gì P1 **cố ý** để lại, kèm lý do và nơi phải xử lý. Sổ thực thi chi tiết
(`.superpowers/sdd/…`) nằm ngoài git và đã bị dọn; file này là bản lưu bền của phần còn giá trị.

---

## 1. Việc bắt buộc phải làm ở giai đoạn sau

| # | Nội dung | Nơi xử lý | Vì sao |
|---|---|---|---|
| C-1 | **Rò rỉ chéo tài khoản qua nhiều tab.** `<Navigate>` guard ở `/login` và state module của sync engine (`syncEpoch`, `timer`, `inFlight`) đều là **per-tab**. Tab 2 mở sẵn phiên của A vẫn tiếp tục sync dưới cookie của B sau khi tab 1 đăng nhập lại. Cần điều phối liên tab (BroadcastChannel hoặc `storage` event). | **P4** (publish làm kịch bản này dễ xảy ra hơn nhiều) | Cùng lớp lỗi với C1 đã sửa; hai đường đã liệt kê thì đã đóng, đường này chưa. |
| C-2 | **`GET /courses` chưa tồn tại.** Spec §4 có liệt kê nhưng không task nào của P1 được giao xây. Dashboard hiện dùng `KNOWN_COURSE_IDS` hardcode trong `apps/web/src/pages/Dashboard.tsx`. Bảng `courses` đã được seed trong migration 0001 nhưng **không dòng Go nào đọc nó**. | **P4-T3** (plan đã sửa thành "TẠO MỚI") | Ba nguồn danh sách khóa học, không nguồn nào là chuẩn. |
| C-3 | **Escape hatch `SameSite=None` thiếu yêu cầu CSRF.** `docs/deploy.md` §0 mô tả phương án chạy trên tên miền miễn phí nhưng không nêu rằng nó **bắt buộc** kèm kiểm tra Origin hoặc CSRF token. Chuỗi "CSRF" không xuất hiện ở đâu trong repo ngoài file này. | **P4-T3** nếu chọn hướng đó | Cookie gửi kèm mọi request cross-site là bề mặt tấn công thật. |

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
