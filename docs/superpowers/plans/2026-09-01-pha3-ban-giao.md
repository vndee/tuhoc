# Pha 3 — bàn giao: quyết định, chỗ điều phối viên sai, nợ đã park, và thứ Pha 4 thừa kế

Thi công 01–02/09/2026. 14 task (1–14), thi công **tuần tự** (không chạy song song theo hệ thống
con như Pha 2) — mỗi task một dispatch, một vòng review độc lập, tối đa 5 vòng sửa, rồi tiếp task
sau. Không có vòng "review tổng nhánh" riêng như bốn hệ thống con song song của Pha 2 từng cần;
thay vào đó Task 13's bộ e2e đóng đúng vai trò ấy — xem §2.

Spec: `2026-08-25-server-side-pivot.md` §4, §9. Plan: `2026-09-01-pha3-du-lieu-len-may-chu.md`. Sổ
thực thi: `.superpowers/sdd/2026-09-01-pha3-du-lieu-len-may-chu/progress.md` (11 ruling ghi trong
lúc thi công, R1–R11).

Tài liệu này giữ thứ không nằm trong `git log`.

---

## 1. Cú xoay trục, một câu

Tiến độ, ghi chú và chú giải chuyển từ **trình duyệt-trước** (Dexie + một outbox + một sync engine
kéo/đẩy mỗi 15 giây, "eventually consistent" giữa các thiết bị) sang **máy chủ là nguồn sự thật
duy nhất** (`GET`/`PUT /progress`, bốn động từ REST `/annotations`, TanStack Query đọc/ghi trực
tiếp, ghi lạc quan có lùi khi hỏng). `db/`, `sync/` (bộ máy client), và nhánh ngoại tuyến của
`RequireAuth` đều bị gỡ. Cái sống sót có điều kiện: `POST /sync` cũ, giữ lại đúng một cửa sổ để
làm đường flush cuối cho outbox của trình duyệt đang nâng cấp — không phải một endpoint di trú
mới (`POST /migrate`), một lựa chọn có chủ ý của chủ dự án (xem §3, quyết định 2).

---

## 2. e2e tìm ra HAI lỗi sản xuất mà 1102 test đơn vị không thấy

Đây là bài học đắt nhất của pha, và nó lặp lại đúng hình dạng §2 của bàn giao Pha 2: *"mỗi task
xanh, mỗi review đơn lẻ đúng — và sản phẩm vẫn không dùng được, vì không ai sở hữu mối nối."*
Task 13 gỡ cách ly `p2.spec.ts` (bị cô lập từ cuối Pha 2 vì seed sai course) và chạy nó lần đầu
tiên against real stack kể từ khi Pha 3 đổi toàn bộ tầng dữ liệu bên dưới nó. Ngay lập tức:

| Lỗ | Vì sao 1102 test đơn vị không bắt được |
|---|---|
| **`Sidebar.tsx` bắn `GET /progress` không xác thực trên MỌI route, kể cả `/login`** — khách vãng lai bị `redirectOn401` đá thẳng về `/login` ngay cả khi đang đọc một course công khai. | Task 6 nối `useProgress` vào `GET /progress` thật (trước đó là Dexie, một đọc không đăng nhập vẫn trả rỗng vô hại). `Sidebar.tsx:53` gọi `useProgress(courseId ?? '')` **vô điều kiện** từ trước Pha 3 — vô hại khi hook đọc local-first, thành một request 401 thật ngay khi hook đổi nguồn. Mọi test đơn vị của `Sidebar` mock `api.get`, nên request bắn ra là chuyện có thật hay giả không phân biệt được ở tầng mock. |
| **`POST /annotations` trả 201 kèm thân text `"Created"`** (`fiber.SendStatus` tự điền thân khi rỗng; `fasthttp` chỉ tự lược thân cho 204/304/1xx, không cho 201) — **mọi lần tạo ghi chú THẬT đều hỏng phía client bằng `NotJsonError` trong khi máy chủ đã ghi thành công.** | Mọi test đơn vị của `useAnnotations`/`SelectionToolbar` mock `api.post` để trả một object JSON hợp lệ — không con đường nào trong 1102 test đi qua fiber/fasthttp thật. Chỉ e2e, chạy against Go binary thật, thấy được thân response thật. |

Reviewer của Task 13 tự kiểm cả hai chẩn đoán bằng mã nguồn thư viện vendor (fiber's `SendStatus`,
fasthttp's `mustSkipBody`) trước khi tin — không suy luận từ triệu chứng. Cả hai sửa nằm trong
commit `25f7d55`; một bài kiểm nhanh không cần Docker cho lỗ hổng Sidebar được thêm ở vòng sửa
(`2f4141e`), vì e2e cần Docker không phải thứ một người sửa `Sidebar.tsx` chạy khi đang gõ.

**Bài học không đổi từ Pha 2:** một hook đổi NGUỒN dữ liệu (local → mạng) biến một lời gọi vô điều
kiện từng vô hại thành một request thật có thể hỏng theo cách không có ai đứng canh, vì mọi test
mock đúng cái biên mà lỗi sống ở đó.

---

## 3. Bốn quyết định của điều phối viên, và giá của chúng

1. **Task 2 ôm cả việc bỏ cột `annotations.deleted_at` LẪN việc sửa đường ghi tombstone của
   `internal/sync`, thay vì tách sang Task 3 như plan gốc định (ruling R1a).** Migration `0009`
   (Task 2) `DROP COLUMN deleted_at` làm gói `internal/sync` gãy build ngay lập tức — `sync_test.go`
   chạy trên Postgres thật đã migrate. Tách việc sẽ để Task 2 kết thúc với **cây đỏ**, vi phạm
   nguyên tắc "mỗi task là một sản phẩm kiểm được độc lập". **Giá:** Task 2 to hơn dự kiến (thêm
   một tệp, một test ở gói khác); rẻ hơn hẳn phương án bàn giao cây đỏ cho task sau.
2. **Không xây `POST /migrate` mới** (dù spec §9 ghi nó). Thay vào đó: giữ `POST /sync` cũ sống
   thêm một cửa sổ, dùng nó làm đường flush một lần rồi xoá IndexedDB (`legacyDrain.ts`). **Giá:**
   một gói API "chết theo lịch" phải sống thêm 30 ngày sau khi mọi client mới đã ngừng gọi nó, và
   một lỗ đã biết — người không mở lại app trong 30 ngày mất outbox cục bộ. Đổi lại: không phải
   viết, kiểm, rồi xoá một endpoint chỉ tồn tại để làm đúng việc một endpoint cũ đã làm được.
3. **Không dựng hệ thống "toast" cho báo lỗi ghi** (ruling R8) dù plan dùng từ đó. `grep -arln
   'toast' apps/web/src` cho đúng một tệp và không hệ thống nào — quy ước thật của repo là
   `<p role="alert">` đặt cạnh chỗ hỏng. **Giá:** nếu sau này thật cần toast toàn cục thì phải gom
   các chỗ alert rải rác lại; đổi lại, Task 6 không phải xây hạ tầng UI mới giữa một task đáng lẽ
   chỉ đổi nguồn dữ liệu, và thoả luôn hợp đồng `role="alert"` mà bài e2e của Task 13 đòi (R3).
4. **Ruling F5 (P1) bị thu hẹp, không bị xoá (ruling R9).** Test của Dashboard khẳng định khôi
   phục phiên chạy được với ZERO network — bất biến ruling F5 gốc đặt ra. Task 6 phá tiền đề ấy
   CÓ CHỦ Ý (đó chính là nội dung Pha 3). Quyết định: sửa lại khẳng định (khôi phục vẫn không cần
   `/stats`/`/courses`, nhưng nay CẦN `/progress`) thay vì xoá hẳn test — xoá sẽ vứt luôn nửa còn
   đúng của nó. Chi tiết đầy đủ, kể cả một khẳng định sai Task 14 tìm thấy khi đi ghi lại quyết
   định này, ở `docs/carried-forward.md`, mục "Ruling F5 — nửa RETIRED, nửa còn sống".

---

## 4. Ba lần điều phối viên sai

1. **Điều kiện xoá `POST /sync` trong plan của chính tôi nói sai nguồn đo (ruling R6).** Bản đầu
   viết "0 request trong `apilog` suốt 30 ngày". Sai: `apilog` chỉ ghi lỗi 5xx qua `apilog.Internal`
   — một `POST /sync` **thành công** (trường hợp bình thường của một flush đúng cách) không bao giờ
   để lại dấu vết ở đó, nên điều kiện ấy đã **THOẢ NGAY NGÀY ĐẦU**, kể cả khi trình duyệt vẫn đang
   flush qua route này mỗi ngày — dùng nó sẽ xoá một endpoint đang được dùng thật. Reviewer của
   Task 3 bắt lỗi này, không phải tôi. Nguồn đúng: **access log** (fiber's `middleware/logger`, ghi
   qua `Deps.LogOutput`). Đã sửa plan VÀ chú thích gói `internal/sync/handler.go` cùng lúc — nếu
   chỉ sửa một chỗ, Task 14 sẽ chép lời hứa sai vào `carried-forward.md`, đúng dạng lỗi Pha 2 bắt
   hơn sáu lần.
2. **Con số "7 bài" của plan Task 13 bị đọc như một TRẦN, không phải một hình dạng tối thiểu
   (ruling R11).** Người thi công không khôi phục hai kịch bản orphan/rescue cũ của `p2.spec.ts`
   vì số học của brief chỉ cho phép `p2`×1 — một cách đọc HỢP LỆ của một brief mơ hồ, lỗi ở tôi.
   Logic orphan/rescue không bị Pha 3 đụng tới và vẫn có cover unit đầy đủ, nhưng mất cổng e2e —
   đúng subsystem mà bản `p2.spec.ts` TRƯỚC rewrite tự ghi trong header của nó là nơi unit test đã
   bỏ sót lỗi thật **sáu vòng liên tiếp**. Đã sửa câu chữ plan (commit `7d278fd`); KHÔNG bắt Task 13
   làm thêm ngoài phạm vi; ghi thành nợ có tên, có điều kiện, ở `docs/carried-forward.md`.
3. **Tôi để một chú thích doc-comment biết trước là sai tồn tại từ Task 8 tới Task 14 mà không ai
   bị bắt phải sửa nó giữa chừng.** Task 8's implementer tự báo: `reader/ChapterView.tsx` (~dòng
   851) vẫn nói heartbeat "queues `db.outbox` rows" — đã sai kể từ CHÍNH task đó. Quyết định đúng
   lúc đó (đừng tự mở rộng phạm vi của Task 8 để sửa một dòng ở xa) đã đúng; nhưng nó có nghĩa MỘT
   khẳng định sai biết trước nằm im trong repo suốt năm task tiếp theo, chỉ vì nó được "mang vào
   dispatch Task 14" bằng lời chứ không có gì canh nó khỏi bị quên. Nó không bị quên — Task 14 sửa
   nó — nhưng cơ chế "nhớ bằng lời trong một sổ ledger không nằm trong git" là mong manh hơn nó
   đáng phải là. Không có hành động sửa ở đây, chỉ ghi lại vì đây là quyết định điều phối, không
   phải lỗi thi công.

---

## 5. Dạng lỗi lặp nhiều nhất — hồ sơ hứa rộng hơn mã — và mức độ nó lan tới Task 14

Pha 2 bắt dạng lỗi này **hơn sáu lần**; **bốn lần** một bản vá tài liệu đẻ ra khẳng định sai MỚI.
Pha 3 thừa hưởng đúng rủi ro ấy, và Task 14 (viết tài liệu bàn giao pha) là nơi nó tập trung nhất.
Quét bằng `grep -arn 'outbox\|/sync\|ngoại tuyến\|offline\|IndexedDB\|Dexie'` trên `README.md`,
`docs/`, `apps/web/src`, `apps/api` cho **621 kết quả**; đa số đúng (mã hoặc chú thích lịch sử,
đóng khung đúng thì). Nhưng phép quét đó **không** bắt được mọi trường hợp — nó chỉ khớp từ khoá,
không khớp Ý NGHĨA — và Task 14 tìm thấy tám khẳng định sai bằng cách đọc từng tệp thay vì tin phép
quét:

- **`apps/web/src/pages/Dashboard.tsx`** — doc comment "Ruling F5 còn nguyên" khẳng định *"Trang
  này phải đúng khi không có mạng"* — sai từ Task 6/9/10/11, và **không chứa một từ khoá nào** trong
  danh sách quét ở trên (không có "outbox"/"Dexie"/"offline"/...). Chỉ bắt được bằng cách lần theo
  tên "ruling F5" và đọc lại đúng nghĩa gốc của nó, không phải bằng grep.
- **`apps/web/src/admin/AdminGuard.tsx`** — khẳng định `RequireAuth` "earns its extra branches from
  spec §2.6's offline promise" — Task 11 xoá nhánh ngoại tuyến ấy, và không ai quay lại sửa tệp này
  (nó không nằm trong bán kính của Task 11's brief).
- **`docs/deploy.md`** — một đoạn nói "the app's offline-first sync design means a slow/cold first
  request degrades to 'sync catches up later'" — sai toàn bộ tiền đề (không còn offline-first, không
  còn sync), và đây là tài liệu **vận hành** — người đọc nó lúc điều chỉnh hạ tầng, không phải lúc
  đọc mã.
- **`apps/web/src/annotations/MarginCards.tsx`** — SÁU chỗ khác nhau ("outbox row", "Dexie writes",
  "Dexie live query", "sync round trip") — **và đây là một trong hai tệp chứa byte NUL** mà `grep`
  không có `-a` sẽ báo "Binary file matches" và giấu mất toàn bộ. Đúng bẫy phương pháp Pha 2 đã trả
  giá một lần cho `apps/web/src/api/ratings.ts`; Task 14 xác nhận `ratings.ts` sạch nhưng
  `MarginCards.tsx` thì không, và không ai kiểm nó trước vì grep thường không thấy nó.
- **`apps/web/src/annotations/OrphanPanel.tsx`** — hai chỗ nói kết quả của một reattach hỏng "reaches
  the outbox"/"one outbox row of that to every other device" — cùng lỗi terminology, tệp khác,
  không byte NUL lần này nên `grep` thường vẫn thấy được, chỉ là chưa ai đọc lại nghĩa.
- **`README.md`** — trỏ "full architecture" về đặc tả P1 gốc (2026-08-19), một bản ghi có ngày
  tháng mô tả Dexie/outbox/`/sync` con trỏ, không được viết lại (quy ước repo) nhưng cũng không còn
  là kiến trúc thật — README chưa từng được cập nhật để trỏ về `server-side-pivot.md`.
- **`apps/api/internal/sync/handler.go`, `apps/api/internal/stats/handler.go`** — hai chú thích
  hằng số (`MaxItemsPerPush`, `MaxEventsPerBatch`) mô tả client cũ (`sync/engine.ts`, đã xoá) "gửi
  cả outbox trong một request không chia lô" — client thật hôm nay (`legacyDrain.ts`,
  `api/events.ts`) hoặc CÓ chia lô hoặc là một cơ chế khác hẳn.

**Kết luận cho Pha 4:** phép quét từ khoá là điểm khởi đầu bắt buộc, không phải điểm kết thúc. Tám
tệp mang khẳng định sai (Dashboard.tsx, AdminGuard.tsx, deploy.md, MarginCards.tsx, OrphanPanel.tsx,
README.md, sync/handler.go, stats/handler.go) — và ít nhất một trong số đó (Dashboard.tsx's "Ruling
F5 còn nguyên") không nằm trong 621 kết quả của chính phép quét mà brief yêu cầu, vì câu sai không
chứa một từ khoá nào phép quét tìm. Chúng chỉ lộ ra khi đọc lại từng tệp có liên quan bằng mắt, đối
chiếu với mã nó mô tả. Task 14's báo cáo đầy đủ
(`.superpowers/sdd/2026-09-01-pha3-du-lieu-len-may-chu/task-14-report.md`) liệt kê cả tám, với vị
trí và bản sửa.

---

## 6. Một test trang trí, bắt được đúng lúc

Task 6's review đầu tiên đặt câu hỏi: bài kiểm "lật hai lần nhanh" bảo vệ `cancelQueries` — nó có
thật sự đỏ khi gỡ cơ chế nó tuyên bố đang canh không? Implementer chạy đột biến (xoá lời gọi
`cancelQueries` khỏi `useProgress.ts`'s `onMutate`) và bài kiểm **VẪN XANH**. Nó chưa từng đo được
race nó được viết ra để đo; nó xanh vì một lý do khác lý do tác giả ghi. Viết lại cho đỏ đúng chỗ,
đối chứng đột biến xác nhận. Đây là cùng lớp bài học Pha 2's §5 ghi cho `cssStructure.test.ts` —
**một dây bẫy còn xanh không có nghĩa nó còn đo thứ nó từng đo**, và nó chỉ lộ ra khi có người chủ
động chạy một đột biến, không phải khi đọc code bằng mắt.

---

## 7. Nợ đã PARK — đọc `docs/carried-forward.md` cho bản đầy đủ

Đáng chú ý nhất, theo thứ tự bán kính, tất cả ghi chi tiết ở mục "Nợ Pha 3" cuối
`docs/carried-forward.md`:

- **`POST /sync` là mã chết theo lịch** — điều kiện xoá đúng (access log, 30 ngày liên tiếp,
  KHÔNG PHẢI `apilog`), kèm lỗ đã biết: một người không mở lại app trong cửa sổ đó mất outbox cục
  bộ chưa flush. Lỗ này đóng bằng việc CHỌN thời điểm xoá, không phải bằng mã.
- **Ruling F5 — nửa retired (Pha 3, Task 6/9), nửa còn sống** dưới một lý do khác hẳn (độ trễ, không
  phải tính sẵn có offline) — kèm khẳng định sai Task 14 tìm và sửa (§5 ở trên).
- **C-1 tái diễn BA lần trong một pha, ba hình dạng mới**: hàng đợi heartbeat trong bộ nhớ (Task 8),
  một cú flush bị bỏ rơi tái tiêm lô cũ vào phiên mới (Task 8's vòng sửa 2), và bộ nhớ đệm mutation
  của TanStack Query tự động phát lại dưới cookie mới (Task 11). Cả ba nay nối vào `clearSession()`.
  **Dây bẫy `SESSION_CLEARERS` không bắt được hình dạng thứ ba** — nó chỉ quét định danh IMPORT
  được, còn `getMutationCache().clear()` là một lời gọi phương thức trên một instance đã có sẵn,
  không có "điểm import thứ hai" nào để quét. Đã ghi lại có chủ đích, không phải một lỗ bị bỏ sót.
- **`p2.spec.ts` mất cover e2e cho orphan/rescue** (§3/§4 bản cũ) — nợ có tên, có điều kiện xét lại,
  nặng hơn một "TODO" bình thường vì bản `p2.spec.ts` TRƯỚC rewrite tự ghi rằng đúng subsystem này
  đã qua mặt unit test sáu vòng liên tiếp.
- **S2-F9 (confused deputy, `POST /ai/chat`) có thêm một addendum**: `read_my_notes` (Task 12) không
  mở đường dữ liệu mới, nhưng hạ chi phí kỹ thuật của đúng lỗ đang mở — một course độc chỉ cần một
  câu hỏi tự nhiên thay vì tự parse `/annotations`, và câu trả lời chảy qua đúng luồng SSE kẻ tấn
  công đã đang đọc.
- **Mặt nạ `superseded` (`auth/sessionIdentity.ts`) DÍNH khi trình duyệt quay lại ĐÚNG người cũ** —
  tìm được ở vòng review hẹp CUỐI CÙNG, sau khi Task 14 đã đóng sổ. `receive()` và
  `announceSessionUser()` đều early-return khi giá trị mới TRÙNG niềm tin cục bộ, nên không xoá được
  cờ đã dính từ một thông báo trước đó; `useMe.ts`'s hiệu ứng công bố (khoá theo `[settledUser]`)
  còn không chạy lại để thử. Đo được: tab 1 đăng xuất rồi đăng nhập lại ĐÚNG A ⇒ tab 2 dính
  `{ superseded: true, text: 'nobody' }` vĩnh viễn. Fail-closed (không rò dữ liệu sang ai), nhưng
  bán kính MỚI hơn điều kiện: từ khi mặt nạ chuyển vào `useMe()`, nó phủ cả tuyến đọc CÔNG KHAI
  (`ChapterView.tsx`'s `AuthedReaderExtras`), không chỉ các trang sau `<RequireAuth>` như trước. Sửa
  một dòng (cho `receive()` xoá cờ cả ở nhánh trùng giá trị) chưa được áp dụng — đây là ghi nhận tài
  liệu, không phải bản vá. Chi tiết đầy đủ, kịch bản đo từng bước, và hai quan sát liên quan không
  phải hồi quy (flush khi unmount ở `MarginCards.tsx:487`, đốm tô sáng còn sót ở `useAnnotations`):
  mục cuối "Nợ Pha 3" của `docs/carried-forward.md`.

---

## 8. Cổng đang canh gì, sau pha này

- `session.test.ts`'s `SESSION_CLEARERS` — nay canh ba hàm (`clearUserContent`,
  `resetSessionScopedQueries`, `resetEventQueue`); bộ nhớ đệm mutation của TanStack Query nằm NGOÀI
  phạm vi dây bẫy này, có chủ đích, ghi lý do tại chỗ.
- `test/eventQueueHandoff.test.tsx` — chứng minh đầu-cuối cả hai hình dạng rò rỉ heartbeat (Task 8).
- `apps/web/e2e/p2.spec.ts` — hai kịch bản (đọc chéo thiết bị, ghi thất bại thì lùi) chạy against
  server thật; KHÔNG còn canh orphan/rescue (xem §7).
- `internal/sync/handler.go`'s package doc comment — tự khai đúng điều kiện xoá (access log, 30
  ngày), và nay là bản GỐC mà `docs/carried-forward.md` chép lại, không phải ngược lại.
- `make test-e2e` — cấu hình chưa đổi phạm vi so với cuối Pha 2 ngoài việc `p2` hết cách ly.

---

## 9. Thứ Pha 4 thừa kế

- **Spec §9 đã sửa** để khớp thứ đã ship (hai resource, không `/migrate`) — Pha 4 đọc spec sẽ thấy
  đúng những gì tồn tại, không phải kế hoạch ban đầu.
- **`internal/sync` sẽ tới hạn xoá.** Khi 30 ngày liên tiếp không `POST /sync` nào trong access log,
  xoá gói này, `MaxPushBytes`/`MaxItemsPerPush`, và route đăng ký ở `server.go`. Việc chọn NGÀY để
  bắt đầu đếm 30 ngày (tức ngày build mới nhất bắt đầu triển khai rộng) không thuộc phạm vi tài liệu
  này — đó là một quyết định vận hành khi deploy.
- **`cost_micro`/`credits_per_web_search` = 0 vẫn là nợ Pha 2 chưa đóng** (không đổi bởi Pha 3) —
  Pha 4 định giá phải sửa trước khi dùng các cột này.
- **`signup_grant_micro` = 50.000 không xác thực email vẫn là đường farm đang mở** (nợ Pha 2) — Pha
  4 (thanh toán) là điểm xét lại tự nhiên.
- **`p2.spec.ts`'s orphan/rescue debt** — nếu Pha 4 hoặc bất kỳ pha nào chạm `anchor.ts`/
  `normalize.ts`/`OrphanPanel.tsx`'s đường reattach, đây là lúc khôi phục hai kịch bản cũ, không
  phải hoãn tiếp.

---

## 10. Việc còn lại, không thuộc pha này

- `make check-publish` — trạng thái không đổi bởi Pha 3 (không chạm `courses/` hay lịch sử git).
- Key DeepSeek xoay vòng — không đổi bởi Pha 3, vẫn là việc vận hành treo từ Pha 2.
- 169 khoá i18n mồ côi, 113+ con trỏ `.superpowers/` gitignored — không đổi bởi Pha 3 (không có task
  nào của pha này chạm hai lớp lỗi đó); Task 14 không thêm khoá i18n hay con trỏ mới nào của loại
  này (kiểm bằng cách không sinh chuỗi bilingual mới trong tài liệu thuần này).
