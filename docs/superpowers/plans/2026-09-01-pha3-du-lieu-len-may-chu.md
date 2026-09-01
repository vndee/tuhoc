# Pha 3 — Dữ liệu lên máy chủ, gỡ lớp local-first

> **Cho người thi công (kể cả agent):** dùng `superpowers:subagent-driven-development`
> hoặc `superpowers:executing-plans` để chạy plan này theo từng task. Các bước
> dùng cú pháp checkbox `- [ ]` để theo dõi.

**Đích:** tiến độ và ghi chú của người học sống trên máy chủ và chỉ ở đó — cùng
một tiến độ trên hai máy, không có bước đồng bộ nào, không có IndexedDB nào phải
hoà giải.

**Kiến trúc:** hai resource REST (`/progress`, `/annotations`) thay cho cặp
`GET/POST /sync` chở-cả-hai-mảng-theo-cursor. Phía web, TanStack Query — đã là
lối đi sẵn của app (`api/stats.ts` là khuôn mẫu) — thay Dexie + outbox +
liveQuery: `useQuery` đọc, `useMutation` với `onMutate`/`onError` ghi lạc quan và
tự lùi khi hỏng. `apps/web/src/db/local.ts` tách đôi: phần Dexie chết, phần
`localStorage` (đang được `tsc` canh qua `LocalStorageKey`) ở lại. Agent nhận
tool thứ ba đọc tiến độ + ghi chú của **chính người đang hỏi**.

**Tech stack:** Go 1.25.5 / Fiber v2 / pgx v5 / Postgres · React 19 / Vite / TS ·
TanStack Query v5 · vitest + testing-library · Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-server-side-pivot.md` §4, §9.
**Bàn giao Pha 2:** `docs/superpowers/plans/2026-08-29-pha2-ban-giao.md` §9.

---

## Ràng buộc toàn cục

Mọi task đều chịu những dòng này; chúng không lặp lại trong từng task.

1. **TDD**: test đỏ trước, chạy cho thấy nó đỏ, rồi mới viết mã.
2. **Không chuỗi tiếng Việt trong mã sản phẩm của `apps/api`** —
   `i18n_server_speaks_codes_test.go` là dây bẫy có sẵn, phạm vi phủ cả gói chưa
   tồn tại. Câu cho người học do web vẽ, từ khoá i18n.
3. **Hình dạng lỗi HTTP theo lối đa số của repo**: `{"error": "<tiếng Anh kỹ
   thuật>"}`. Trường `"code"` là biệt lệ của `internal/ai` vì web phải dịch
   riêng từng dạng hỏng của AI; hai endpoint của pha này không cần — người học
   chỉ thấy một toast "chưa lưu được" do web dịch.
4. **Mọi phép quét toàn repo dùng `grep -a`.** HAI tệp chứa byte NUL hợp lệ —
   `apps/web/src/api/ratings.ts` và `apps/web/src/annotations/MarginCards.tsx` —
   và `grep` không có `-a` xếp chúng là nhị phân, **giấu mất dòng**. Đo ở Task 9:
   bảng chứng cứ của một task đã sót đúng `MarginCards.tsx` vì lý do này. `git grep`
   không dính bẫy ấy. Bài học Pha 2, đã suýt để lọt bản sao thứ chín của một khẳng định
   sai.
5. **Chẩn đoán của editor đứng sau thực tế.** Tin `go build` / `go test` /
   `bun run typecheck`, không tin gạch đỏ trong IDE.
6. **Kiểm cây trước khi tin bất kỳ báo cáo "xanh" nào** — `git diff apps/api/`
   và `git diff apps/web/src/` trước mỗi bước commit. Pha 2 có ba lần một đột
   biến test sống lại trong mã sản phẩm, một lần là lỗ phân quyền thật.
7. **Xoá một cổng kiểm là phải nêu lý do trong commit message.** Không xoá cho
   hết đỏ.

---

## Quyết định chốt lúc soạn plan

| Câu hỏi | Quyết định | Vì sao |
|---|---|---|
| Hình dạng API | **REST riêng, xoá `/sync`** | Một app không còn đồng bộ thì không nên giữ API hình dạng đồng bộ. Mỗi resource một `queryKey`, mutation invalidate đúng chỗ. |
| Ghi hỏng thì người học thấy gì | **Lạc quan + rollback + toast** | UI đổi ngay như hôm nay; khi hỏng thì **nói thật** thay vì nuốt. Kèm điều kiện: ô soạn ghi chú giữ nguyên text khi rollback. |
| `DELETE /annotations/:id` | **Xoá thật**, migration dọn tombstone cũ và bỏ cột `deleted_at` | Tombstone tồn tại chỉ để lan tin xoá sang thiết bị khác. Không còn đồng bộ thì nó là cột không ai đọc — đúng loại nợ `cost_micro` mà Pha 4 đang phải trả. |
| Di trú dữ liệu local | **Không có `POST /migrate`.** Flush outbox đúng một lần qua `POST /sync` cũ, rồi `indexedDB.deleteDatabase('tuhoc')` | Chủ dự án chốt. Cú flush giữ lại để việc nâng cấp không nuốt im lặng phần outbox chưa đẩy. |
| Số phận `POST /sync` | **`GET /sync` chết ngay; `POST /sync` sống thêm một cửa sổ, chỉ để nhận cú flush cuối** | Hệ quả trực tiếp của dòng trên: shim ở trình duyệt gọi một endpoint đã 404 thì cú flush là trang trí. Xem "Nợ có tên" bên dưới. |
| Tool agent đọc ghi chú | **Một tool `read_my_notes`, mặc định BẬT** | Chủ dự án chốt. Kèm hai điều kiện bắt buộc ở Task 13. |
| Tên gói Go thay `internal/sync` | `internal/userdata` | `sync` là tên của một cơ chế vừa bị xoá, và trùng tên gói chuẩn `sync` của Go — hai lý do để không tái dùng. |

### Nợ có tên, có điều kiện đóng

**`POST /sync` là mã chết theo lịch, không phải mã sống.** Sau Task 11, không
bản web nào còn gọi nó **trừ** shim flush-một-lần chạy đúng một lần cho mỗi
trình duyệt đã từng cài bản cũ. Điều kiện xoá: khi **access log** (middleware `logger`
của fiber, ghi ra stdout — trên Render là log nền tảng) cho thấy 0 request tới
`POST /sync` trong 30 ngày liên tiếp. **Không phải `apilog`**: gói ấy chỉ ghi lỗi
5xx (`apilog.Internal`), nên một cú POST THÀNH CÔNG không bao giờ xuất hiện ở đó —
một điều kiện đo bằng `apilog` sẽ luôn thoả ngay ngày đầu và xoá mất endpoint
trong khi trình duyệt vẫn đang flush qua nó. Ghi vào `docs/carried-forward.md` ở
Task 15 kèm câu truy vấn để kiểm, chứ không phải một dòng "dọn sau".

**Cửa sổ ấy có một lỗ, và nó được chấp nhận có ý thức:** người dùng nào không mở
app trong cửa sổ đó rồi mới quay lại sau khi `POST /sync` bị xoá sẽ mất phần
outbox chưa đẩy của họ. Không đóng được bằng mã ở phía này; đóng bằng cách chọn
thời điểm xoá.

---

## Bốn thứ mã hiện tại làm mà spec §9 không nhắc — đo, không đoán

Đây là lý do pha này lớn hơn "đổi Dexie thành fetch". Cả bốn đều đo được bằng
lệnh ghi trong ngoặc.

1. **Heartbeat học tập đang đi nhờ outbox.** `apps/web/src/progress/heartbeat.ts:129`
   xếp hàng `table: 'events'` vào chính outbox sắp bị xoá. Gỡ outbox mà quên chỗ
   này là **giết số liệu `/stats`** — im lặng, vì không có test nào nối hai đầu.
   (`grep -arn "table: 'events'" apps/web/src`)
2. **`db/local.ts` không xoá trọn được.** 15 tệp không phải test import nó; 4
   trong đó (`theme/useTheme.ts`, `i18n/LanguageProvider.tsx`, `i18n/index.ts`,
   `annotations/MarginCards.tsx`) chỉ dùng phần `localStorage`, kèm phân loại
   kiểu `USER_CONTENT_KEYS` / `DEVICE_PREFERENCE_KEYS` mà `tsc` đang canh và
   `clearLocalData()` đang dựa vào.
3. **`api/client.ts` không có `patch` và `delete`.** `api` chỉ có `get`/`post`/`put`,
   và `put` được cố ý khai kiểu `Promise<void>` vì endpoint duy nhất sau nó trả
   204. Thiết kế của pha này cần cả hai động từ còn thiếu.
4. **`p2.spec.ts` — cổng e2e DUY NHẤT của annotations — đang bị cách ly.** Lý do
   ghi ngay đầu tệp: nó dùng `COURSE_ID = 'so-dau-phay-dong'`, mà
   `scripts/test-e2e.sh` chỉ publish `mau-hop-le` (chương `c1`/`c2`), nên mọi
   kịch bản 404 trước khi chạm tới annotation. Viết lại toàn bộ tầng dữ liệu của
   annotations trong khi cổng đầu-cuối của nó đang tắt là đúng hình dạng lỗi mà
   Pha 2 §2 đã trả giá.

---

## Thứ tự task, và một ràng buộc thứ tự không được đảo

Server trước (Task 1–3), web sau (Task 5–12), agent và e2e cuối (13–14).

**Ràng buộc:** `internal/sync` chỉ được xoá **sau** Task 11, vì shim flush cuối
cần `POST /sync` còn sống. Task 4 vì thế chỉ xoá `GET /sync` và thu gọn gói lại
thành đúng một handler push; phần còn lại chết theo điều kiện ở "Nợ có tên".

---

## Task 1: `internal/userdata` — đọc và ghi tiến độ

**Files:**
- Create: `apps/api/internal/userdata/repo.go`, `apps/api/internal/userdata/usecase.go`,
  `apps/api/internal/userdata/handler.go`, `apps/api/internal/userdata/progress_test.go`
- Modify: `apps/api/internal/server/server.go` (đăng ký hai route mới, cạnh `/sync` cũ vẫn đang sống)

**Interfaces:**
- Consumes: `auth.Require(deps.Pool)`, `auth.UID(c)`, `apilog.Internal` — y như `internal/sync` đang dùng.
- Produces:

```go
package userdata

type ProgressRow struct {
	CourseID  string
	ChapterID string
	Status    string
	Done      bool
	UpdatedAt time.Time
}

type Repo struct{ pool *pgxpool.Pool }
func NewRepo(pool *pgxpool.Pool) *Repo
func (r *Repo) ListProgress(ctx context.Context, userID uuid.UUID) ([]ProgressRow, error)
func (r *Repo) UpsertProgress(ctx context.Context, userID uuid.UUID, row ProgressRow) error

type Usecase struct{ repo *Repo }
func NewUsecase(repo *Repo) *Usecase

type Handler struct{ uc *Usecase }
func NewHandler(uc *Usecase) *Handler
func (h *Handler) ListProgress(c *fiber.Ctx) error  // GET /progress
func (h *Handler) PutProgress(c *fiber.Ctx) error   // PUT /progress -> 204
```

Wire shape, giữ đúng tên trường mà `internal/sync` đã dùng để web không phải học
tên mới:

```jsonc
// GET /progress -> 200
{"progress": [{"courseId":"c","chapterId":"c1","status":"read","done":true,"updatedAt":"2026-09-01T10:00:00Z"}]}
// PUT /progress {"courseId":"c","chapterId":"c1","status":"read","done":true} -> 204, không thân
```

- [ ] **Step 1: Test đỏ — `PUT` rồi `GET` trả lại đúng hàng vừa ghi, và `updatedAt` do SERVER đặt**

```go
// Client KHÔNG gửi updatedAt. Đó là khác biệt lớn nhất so với POST /sync,
// nơi mỗi hàng mang updatedAt của chính nó vì hàng có thể đã nằm hàng đợi
// nhiều ngày. Không còn hàng đợi thì "lúc nào" là lúc server nhận — và để
// client tự khai lại là mở đúng cửa cho một máy lệch giờ ghi đè hàng mới hơn.
func TestPutProgressStampsServerTime(t *testing.T) {
	env := newTestEnv(t)
	before := time.Now().UTC()
	env.put(t, "/progress", `{"courseId":"c","chapterId":"c1","status":"read","done":true}`, 204)

	rows := env.getProgress(t)
	if len(rows) != 1 {
		t.Fatalf("GET /progress = %d hàng, muốn 1", len(rows))
	}
	if rows[0].UpdatedAt.Before(before) {
		t.Errorf("updatedAt = %v, sớm hơn lúc gửi request %v — server không tự đóng dấu", rows[0].UpdatedAt, before)
	}
}
```

- [ ] **Step 2: Test đỏ — `PUT` hai lần cùng khoá là upsert, không phải hàng thứ hai**

```go
func TestPutProgressIsUpsertNotInsert(t *testing.T) {
	env := newTestEnv(t)
	env.put(t, "/progress", `{"courseId":"c","chapterId":"c1","status":"read","done":true}`, 204)
	env.put(t, "/progress", `{"courseId":"c","chapterId":"c1","status":"read","done":false}`, 204)

	rows := env.getProgress(t)
	if len(rows) != 1 {
		t.Fatalf("= %d hàng, muốn 1 (khoá chính là user+course+chapter+status)", len(rows))
	}
	if rows[0].Done {
		t.Errorf("done = true, muốn false — lần ghi thứ hai không thắng")
	}
}
```

- [ ] **Step 3: Test đỏ — `GET /progress` của user A không bao giờ thấy hàng của user B**

```go
func TestListProgressIsScopedToCaller(t *testing.T) {
	env := newTestEnv(t)
	env.asUser(t, userB).put(t, "/progress", `{"courseId":"c","chapterId":"c1","status":"read","done":true}`, 204)

	rows := env.asUser(t, userA).getProgress(t)
	if len(rows) != 0 {
		t.Fatalf("user A thấy %d hàng của user B", len(rows))
	}
}
```

- [ ] **Step 4: Test đỏ — thân request thiếu trường bắt buộc trả 400, không ghi gì**

```go
func TestPutProgressRejectsEmptyIdentifiers(t *testing.T) {
	env := newTestEnv(t)
	for _, body := range []string{
		`{"courseId":"","chapterId":"c1","status":"read","done":true}`,
		`{"courseId":"c","chapterId":"","status":"read","done":true}`,
		`{"courseId":"c","chapterId":"c1","status":"","done":true}`,
	} {
		env.put(t, "/progress", body, 400)
	}
	if rows := env.getProgress(t); len(rows) != 0 {
		t.Fatalf("400 vẫn ghi %d hàng", len(rows))
	}
}
```

- [ ] **Step 5: Chạy đỏ** — `cd apps/api && go test ./internal/userdata/ -v`
- [ ] **Step 6: Viết `repo.go`** — `ListProgress` là một `SELECT ... WHERE user_id=$1`;
      `UpsertProgress` dùng lại nguyên văn câu `INSERT ... ON CONFLICT` mà
      `internal/sync/repo.go` đang có (`upsertProgressSQL`), đổi `updated_at`
      thành `now()` thay vì tham số.
- [ ] **Step 7: Viết `usecase.go` + `handler.go`** — validate `courseId`/`chapterId`/`status`
      không rỗng trước khi chạm DB; lỗi nội bộ đi qua `apilog.Internal(c, "userdata.PutProgress", err)`.
- [ ] **Step 8: Đăng ký route** trong `server.go`, ngay dưới cặp `/sync` hiện có:

```go
userdataHandler := userdata.NewHandler(userdata.NewUsecase(userdata.NewRepo(deps.Pool)))
app.Get("/progress", auth.Require(deps.Pool), userdataHandler.ListProgress)
app.Put("/progress", auth.Require(deps.Pool), userdataHandler.PutProgress)
```

- [ ] **Step 9: Chạy xanh** — `go test ./... -count=1`
- [ ] **Step 10: Commit** — `git commit -m "internal/userdata: /progress đọc-ghi, updatedAt do máy chủ đóng dấu"`

---

## Task 2: `/annotations` — bốn động từ, và tombstone bị bỏ

**Files:**
- Create: `apps/api/migrations/0009_annotations_hard_delete.up.sql`,
  `apps/api/migrations/0009_annotations_hard_delete.down.sql`,
  `apps/api/internal/userdata/annotations_test.go`
- Modify: `apps/api/internal/userdata/repo.go`, `usecase.go`, `handler.go`,
  `apps/api/internal/server/server.go`

**Interfaces:**
- Consumes: mọi thứ Task 1 dựng.
- Produces:

```go
type AnnotationRow struct {
	ID        uuid.UUID
	CourseID  string
	ChapterID string
	Anchor    json.RawMessage
	Note      string
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (r *Repo) ListAnnotations(ctx context.Context, userID uuid.UUID, courseID string) ([]AnnotationRow, error) // courseID == "" nghĩa là mọi khoá
func (r *Repo) CreateAnnotation(ctx context.Context, userID uuid.UUID, row AnnotationRow) error
func (r *Repo) PatchAnnotation(ctx context.Context, userID, id uuid.UUID, note *string, anchor json.RawMessage) (bool, error) // bool: có hàng nào khớp không
func (r *Repo) DeleteAnnotation(ctx context.Context, userID, id uuid.UUID) (bool, error)
```

```jsonc
// GET /annotations            -> {"annotations":[...]}    mọi khoá
// GET /annotations?course=c   -> {"annotations":[...]}    một khoá
// POST /annotations {"id":"<uuid client sinh>","courseId":"c","chapterId":"c1","anchor":{...},"note":""} -> 201
// PATCH /annotations/:id {"note":"..."} hoặc {"anchor":{...}} hoặc cả hai -> 204
// DELETE /annotations/:id -> 204
```

`?course=` là **tuỳ chọn** chứ không bắt buộc, vì client đọc theo cả hai kiểu:
reader cần một khoá, còn `pages/Progress.tsx`, `progress/recent.ts` và
`pages/Dashboard.tsx` đọc chéo mọi khoá (`grep -an 'db\.annotations' apps/web/src`).

- [ ] **Step 1: Viết migration `0009`**

```sql
-- up
DELETE FROM annotations WHERE deleted_at IS NOT NULL;
ALTER TABLE annotations DROP COLUMN deleted_at;
```

```sql
-- down
ALTER TABLE annotations ADD COLUMN deleted_at timestamptz;
```

`down` **không** khôi phục được hàng đã xoá, và đó là sự thật phải ghi ngay
trong tệp `.down.sql` bằng một dòng chú thích SQL: một `down` nói dối tệ hơn một
`down` khuyết. Không sửa `0001` tại chỗ — golang-migrate không checksum tệp, và
Pha 1 đã trả giá cho bài này.

- [ ] **Step 2: Test đỏ — vòng đời đầy đủ tạo → sửa → xoá → không còn thấy**

```go
func TestAnnotationLifecycle(t *testing.T) {
	env := newTestEnv(t)
	id := uuid.NewString()
	env.post(t, "/annotations", `{"id":"`+id+`","courseId":"c","chapterId":"c1","anchor":{"exact":"xin chào"},"note":""}`, 201)

	env.patch(t, "/annotations/"+id, `{"note":"ghi chú của tôi"}`, 204)
	if got := env.getAnnotations(t, "")[0].Note; got != "ghi chú của tôi" {
		t.Errorf("note = %q sau PATCH", got)
	}

	env.del(t, "/annotations/"+id, 204)
	if rows := env.getAnnotations(t, ""); len(rows) != 0 {
		t.Fatalf("sau DELETE còn %d hàng — xoá thật nghĩa là không còn hàng nào", len(rows))
	}
}
```

- [ ] **Step 3: Test đỏ — `PATCH`/`DELETE` hàng của người khác trả 404, không phải 403 và không đụng dữ liệu**

```go
// 404 chứ không 403: trả 403 là xác nhận với người hỏi rằng id ấy TỒN TẠI và
// thuộc về ai đó. Với một uuid đoán được thì đó là rò rỉ; với một uuid không
// đoán được thì hai mã trạng thái ấy như nhau với người dùng thật.
func TestAnnotationWritesAreOwnerScoped(t *testing.T) {
	env := newTestEnv(t)
	id := uuid.NewString()
	env.asUser(t, userB).post(t, "/annotations", `{"id":"`+id+`","courseId":"c","chapterId":"c1","anchor":{},"note":"riêng tư"}`, 201)

	env.asUser(t, userA).patch(t, "/annotations/"+id, `{"note":"đã bị sửa"}`, 404)
	env.asUser(t, userA).del(t, "/annotations/"+id, 404)

	if got := env.asUser(t, userB).getAnnotations(t, "")[0].Note; got != "riêng tư" {
		t.Fatalf("note của B = %q — A chạm được vào", got)
	}
}
```

- [ ] **Step 4: Test đỏ — `?course=` lọc, và không có `?course=` thì trả mọi khoá**
- [ ] **Step 5: Test đỏ — `POST` cùng `id` hai lần trả 409, không âm thầm ghi đè**

```go
// id do client sinh, nên trùng là chuyện có thật (một retry sau khi response
// đầu bị mất). Ghi đè im lặng ở đây sẽ nuốt ghi chú của chính người dùng nếu
// hai tab cùng sinh trùng uuid; 409 để client biết mà đọc lại.
func TestCreateAnnotationRejectsDuplicateID(t *testing.T) {
	env := newTestEnv(t)
	id := uuid.NewString()
	body := `{"id":"` + id + `","courseId":"c","chapterId":"c1","anchor":{},"note":"đầu"}`
	env.post(t, "/annotations", body, 201)
	env.post(t, "/annotations", `{"id":"`+id+`","courseId":"c","chapterId":"c1","anchor":{},"note":"sau"}`, 409)

	if got := env.getAnnotations(t, "")[0].Note; got != "đầu" {
		t.Errorf("note = %q — lần POST thứ hai đã ghi đè", got)
	}
}
```

- [ ] **Step 6: Chạy đỏ** — `go test ./internal/userdata/ -v`
- [ ] **Step 7: Viết repo/usecase/handler** cho bốn động từ. `anchor` đi qua như
      `json.RawMessage`, không parse — gói này không có lý do gì để hiểu hình
      dạng của nó, y như `internal/sync` đã làm.
- [ ] **Step 8: Đăng ký bốn route**

```go
app.Get("/annotations", auth.Require(deps.Pool), userdataHandler.ListAnnotations)
app.Post("/annotations", auth.Require(deps.Pool), userdataHandler.CreateAnnotation)
app.Patch("/annotations/:id", auth.Require(deps.Pool), userdataHandler.PatchAnnotation)
app.Delete("/annotations/:id", auth.Require(deps.Pool), userdataHandler.DeleteAnnotation)
```

- [ ] **Step 9: Chạy xanh** — `go test ./... -count=1` và `make test-api`
- [ ] **Step 10: Commit** — `git commit -m "/annotations: bốn động từ, xoá thật, migration 0009 bỏ cột tombstone"`

---

## Task 3: `internal/sync` thu về đúng một cửa — `POST /sync` cho cú flush cuối

**Files:**
- Modify: `apps/api/internal/sync/handler.go` (xoá `Pull`, `pullResponse`, và
  phân tích `?since=`), `apps/api/internal/sync/usecase.go`,
  `apps/api/internal/sync/repo.go` (xoá `PullProgress`/`PullAnnotations`),
  `apps/api/internal/sync/sync_test.go`, `apps/api/internal/server/server.go`
- Create: không

Gói này không chết ở pha này (xem "Nợ có tên"). Nó **teo** lại còn đúng thứ shim
ở Task 11 cần: nhận một mảng progress + annotations mang `updatedAt` của chính
chúng và merge theo luật cũ.

- [ ] **Step 1: Xoá `GET /sync` khỏi `server.go`**, giữ `POST /sync`.
- [ ] **Step 2: Xoá `Handler.Pull` + `pullResponse` + `Usecase.Pull` + hai hàm `Pull*` của repo.**
- [ ] **Step 3: Xoá các test của `Pull` trong `sync_test.go`** — kèm lý do trong
      commit message theo ràng buộc toàn cục #7: đường đọc không còn client nào,
      còn đường ghi thì vẫn có đúng một client tạm thời.
- [ ] **Step 4: Test đỏ→xanh — `POST /sync` vẫn merge theo `updatedAt` sau khi cắt**

```go
// Đây là lý do TỒN TẠI duy nhất còn lại của gói: hàng từ outbox mang
// updatedAt có thể rất cũ, và đẩy chúng qua PUT /progress (Task 1, đóng dấu
// now()) sẽ đè hàng MỚI HƠN trên máy chủ bằng hàng CŨ HƠN ở máy.
func TestPushStillPrefersNewerServerRow(t *testing.T) {
	env := newTestEnv(t)
	env.seedProgress(t, "c", "c1", "read", true, parse("2026-09-01T10:00:00Z"))
	env.push(t, `{"progress":[{"courseId":"c","chapterId":"c1","status":"read","done":false,"updatedAt":"2026-08-01T10:00:00Z"}],"annotations":[]}`)

	if !env.progressDone(t, "c", "c1", "read") {
		t.Fatal("hàng cũ hơn từ outbox đã đè hàng mới hơn trên máy chủ")
	}
}
```

- [ ] **Step 5: Thêm một dòng chú thích gói** ngay đầu `handler.go` nói rõ gói
      này là mã chết theo lịch, kèm điều kiện xoá (0 request trong 30 ngày) và
      trỏ tới `docs/carried-forward.md`.
- [ ] **Step 6: Chạy xanh** — `make test-api`
- [ ] **Step 7: Commit** — `git commit -m "sync: GET chết, POST sống thêm một cửa sổ cho cú flush cuối (lý do trong chú thích gói)"`

---

## Task 4: `api/client.ts` — hai động từ còn thiếu

**Files:**
- Modify: `apps/web/src/api/client.ts`, `apps/web/src/api/client.test.ts`

**Interfaces:**
- Produces: `api.patch<T>(path, body?, options?)`, `api.del(path, options?)`

- [ ] **Step 1: Test đỏ — `patch` gửi đúng method và `del` chịu được 204 không thân**

```ts
it('api.del chấp nhận 204 không thân và không ném NotJsonError', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(api.del('/annotations/x')).resolves.toBeUndefined();
});

it('api.patch gửi method PATCH', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await api.patch('/annotations/x', { note: 'a' });
  expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH');
});
```

- [ ] **Step 2: Chạy đỏ** — `cd apps/web && bun run test src/api/client.test.ts`
- [ ] **Step 3: Thêm hai động từ**, khai `del` trả `Promise<void>` theo đúng lý
      do `put` đã khai thế (endpoint trả 204; một `T` chung sẽ trao cho caller
      một `undefined` đội lốt kiểu nó không có). `patch` giữ `<T>` vì có thể có
      endpoint trả thân về sau.
- [ ] **Step 4: Chạy xanh + `bun run typecheck`**
- [ ] **Step 5: Commit** — `git commit -m "api/client: thêm patch và del, del trả void vì endpoint sau nó trả 204"`

---

## Task 5: `api/progress.ts` và `api/annotations.ts` — theo khuôn `api/stats.ts`

**Files:**
- Create: `apps/web/src/api/progress.ts`, `apps/web/src/api/progress.test.ts`,
  `apps/web/src/api/annotations.ts`, `apps/web/src/api/annotations.test.ts`

**Interfaces:**
- Consumes: `api.get/put/post/patch/del` (Task 4), endpoint của Task 1–2.
- Produces:

```ts
// progress.ts
export interface ProgressRow { courseId: string; chapterId: string; status: string; done: boolean; updatedAt: string }
export function progressQueryKey(): readonly ['progress'];
export class MalformedProgressError extends Error { readonly missing: readonly string[] }
export function assertProgress(body: unknown): ProgressRow[];
export function fetchProgress(options?: RequestOptions): Promise<ProgressRow[]>;
export function putProgress(row: Omit<ProgressRow, 'updatedAt'>): Promise<void>;

// annotations.ts
export interface Ann { id: string; courseId: string; chapterId: string; anchor: unknown; note: string; createdAt: string; updatedAt: string }
export function annotationsQueryKey(courseId?: string): readonly ['annotations'] | readonly ['annotations', string];
export class MalformedAnnotationsError extends Error { readonly missing: readonly string[] }
export function assertAnnotations(body: unknown): Ann[];
export function fetchAnnotations(courseId?: string, options?: RequestOptions): Promise<Ann[]>;
export function createAnnotation(row: Omit<Ann, 'createdAt' | 'updatedAt'>): Promise<void>;
export function patchAnnotation(id: string, patch: { note?: string; anchor?: unknown }): Promise<void>;
export function deleteAnnotation(id: string): Promise<void>;
```

`assert*` không phải nghi thức. `api.get<T>` đặt tên cho một kiểu mà không gì
trên dây buộc phải tôn trọng — `api/stats.ts` có cả một lớp `MalformedStatsError`
vì một thân thiếu `days` đã lọt tới `DayChart` và làm trắng nguyên trang, đo
ngày 22/08. Hai tệp này chịu đúng bài học đó ở biên, không phải ở từng `.map`.

- [ ] **Step 1: Test đỏ — `assertProgress` ném khi thiếu trường, không để `undefined` đội lốt**

```ts
it('assertProgress ném khi một hàng thiếu chapterId', () => {
  expect(() => assertProgress({ progress: [{ courseId: 'c', status: 'read', done: true, updatedAt: 'x' }] }))
    .toThrow(MalformedProgressError);
});

it('assertProgress chấp nhận mảng rỗng — người học mới là hợp lệ', () => {
  expect(assertProgress({ progress: [] })).toEqual([]);
});
```

- [ ] **Step 2: Test đỏ — `annotationsQueryKey` tách khoá theo course**

```ts
// Hai khoá khác nhau là hai câu trả lời khác nhau; gộp chúng là cách chắc
// chắn để mở khoá B rồi thấy ghi chú của khoá A trong một nhịp — đúng lý do
// statsQueryKey nhận `year` vào khoá.
it('annotationsQueryKey phân biệt theo course', () => {
  expect(annotationsQueryKey('a')).not.toEqual(annotationsQueryKey('b'));
  expect(annotationsQueryKey()).toEqual(['annotations']);
});
```

- [ ] **Step 3: Test đỏ — `fetchAnnotations('c')` gọi đúng `/annotations?course=c`, không có tham số thì gọi `/annotations`**
- [ ] **Step 4: Chạy đỏ** — `bun run test src/api/progress.test.ts src/api/annotations.test.ts`
- [ ] **Step 5: Viết hai tệp** theo đúng bố cục `api/stats.ts`: chú thích đầu tệp
      trỏ tới handler Go tương ứng, `queryKey`, `assert`, `fetch`, các hàm ghi.
- [ ] **Step 6: Chạy xanh + typecheck**
- [ ] **Step 7: Commit** — `git commit -m "api/progress + api/annotations: khuôn của api/stats, kèm kiểm hình dạng ở biên"`

---

## Task 6: `useProgress` đổi ruột — Query thay liveQuery, lạc quan thay outbox

**Files:**
- Modify: `apps/web/src/progress/useProgress.ts`, `apps/web/src/progress/useProgress.test.ts`

**Interfaces:**
- Consumes: `progressQueryKey`, `fetchProgress`, `putProgress` (Task 5).
- Produces: `UseProgressResult` **không đổi một chữ** — `isRead`, `toggleRead`,
  `exDone`, `toggleEx`, `partStats`, `doneChapterIds`. Đây là điều kiện để
  `CourseNav`, `Dashboard`, `ChapterView` không phải sửa.

- [ ] **Step 1: Test đỏ — `toggleRead` đổi UI NGAY, trước khi mạng trả lời**

```tsx
it('toggleRead lật trạng thái ngay lập tức, không chờ server', async () => {
  let resolvePut: () => void = () => {};
  vi.mocked(putProgress).mockReturnValueOnce(new Promise<void>((r) => { resolvePut = r; }));

  const { result } = renderHook(() => useProgress('c'), { wrapper });
  await waitFor(() => expect(result.current.isRead('c1')).toBe(false));

  act(() => result.current.toggleRead('c1'));
  expect(result.current.isRead('c1')).toBe(true); // chưa resolve — đây là phần "lạc quan"

  await act(async () => { resolvePut(); });
});
```

- [ ] **Step 2: Test đỏ — `putProgress` hỏng thì UI LÙI LẠI, không giữ lời nói dối**

```tsx
it('put hỏng thì trạng thái quay về giá trị cũ', async () => {
  vi.mocked(putProgress).mockRejectedValueOnce(new Error('mạng hỏng'));
  const { result } = renderHook(() => useProgress('c'), { wrapper });
  await waitFor(() => expect(result.current.isRead('c1')).toBe(false));

  act(() => result.current.toggleRead('c1'));
  await waitFor(() => expect(result.current.isRead('c1')).toBe(false));
});
```

- [ ] **Step 3: Test đỏ — hai lần lật liên tiếp không kẹt ở giá trị giữa**

```tsx
// onMutate phải huỷ query đang bay (cancelQueries) trước khi vá cache, nếu
// không một GET /progress trả về giữa hai cú lật sẽ ghi đè cả hai.
it('lật hai lần nhanh kết thúc ở trạng thái cuối', async () => {
  const { result } = renderHook(() => useProgress('c'), { wrapper });
  await waitFor(() => expect(result.current.isRead('c1')).toBe(false));

  act(() => { result.current.toggleRead('c1'); result.current.toggleRead('c1'); });
  await waitFor(() => expect(result.current.isRead('c1')).toBe(false));
  expect(vi.mocked(putProgress)).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 4: Chạy đỏ** — `bun run test src/progress/useProgress.test.ts`
- [ ] **Step 5: Viết lại ruột hook**

```ts
const queryClient = useQueryClient();
const { data: rows = [] } = useQuery({ queryKey: progressQueryKey(), queryFn: () => fetchProgress() });

const mutation = useMutation({
  mutationFn: putProgress,
  onMutate: async (row) => {
    await queryClient.cancelQueries({ queryKey: progressQueryKey() });
    const previous = queryClient.getQueryData<ProgressRow[]>(progressQueryKey());
    queryClient.setQueryData<ProgressRow[]>(progressQueryKey(), (old = []) => upsertLocal(old, row));
    return { previous };
  },
  onError: (_err, _row, ctx) => {
    if (ctx?.previous) queryClient.setQueryData(progressQueryKey(), ctx.previous);
    toast.error(t('progress.saveFailed'));
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: progressQueryKey() }),
});
```

- [ ] **Step 6: Thêm khoá i18n `progress.saveFailed`** vào **cả hai** catalog —
      `packages/i18n/src/messages/vi.ts` và `en.ts`. Một khoá chỉ có ở một ngôn ngữ
      là một khoá mồ côi mới; repo đang có 169 cái.
- [ ] **Step 7: Chạy xanh + typecheck**
- [ ] **Step 8: Commit** — `git commit -m "useProgress: Query + ghi lạc quan có lùi, chữ ký hook giữ nguyên"`

---

## Task 7: `useAnnotations` đổi ruột, và ô soạn không được mất chữ

**Files:**
- Modify: `apps/web/src/annotations/useAnnotations.ts`,
  `apps/web/src/annotations/useAnnotations.test.tsx`

**Interfaces:**
- Consumes: `annotationsQueryKey`, `fetchAnnotations`, `createAnnotation`,
  `patchAnnotation`, `deleteAnnotation` (Task 5).
- Produces: `UseAnnotationsResult` **không đổi** — `create`, `updateNote`,
  `remove`, `reattach` đều đã trả `Promise`, nên `anchor.ts`, `painter.ts`,
  `normalize.ts`, `MarginCards.tsx`, `SelectionToolbar.tsx`, `OrphanPanel.tsx`
  (≈6.000 dòng logic neo và vẽ) **không bị đụng ở task này**.

- [ ] **Step 1: Test đỏ — `create` hiện thẻ ghi chú ngay, và `remove` hỏng thì thẻ quay lại**
- [ ] **Step 2: Test đỏ — `updateNote` hỏng KHÔNG được xoá chữ người dùng vừa gõ**

```tsx
// Đây là chỗ "lạc quan + lùi lại" có thể tự bắn vào chân: lùi cache về
// giá trị cũ mà cũng lùi ô soạn thì người ta mất nguyên đoạn vừa viết.
// Cache lùi, ô soạn KHÔNG.
it('updateNote hỏng: cache lùi nhưng ô soạn giữ nguyên chữ', async () => {
  vi.mocked(patchAnnotation).mockRejectedValueOnce(new Error('mạng hỏng'));
  const { result } = renderHook(() => useAnnotations('c', 'c1'), { wrapper });
  await waitFor(() => expect(result.current.items).toHaveLength(1));

  await act(async () => { await result.current.updateNote('a1', 'đoạn tôi vừa gõ').catch(() => {}); });

  expect(result.current.items[0].note).toBe('ghi chú cũ');       // cache đã lùi
  expect(result.current.draftOf('a1')).toBe('đoạn tôi vừa gõ');  // chữ còn nguyên
});
```

- [ ] **Step 3: Test đỏ — `reattach` gửi `anchor` qua `PATCH`, không phải xoá-rồi-tạo**

```tsx
// Xoá-rồi-tạo đổi id, và id là thứ painter.ts + MarginCards dùng để nối thẻ
// với vùng bôi. Đổi id giữa chừng là mất liên kết ấy, im lặng.
it('reattach giữ nguyên id', async () => {
  const { result } = renderHook(() => useAnnotations('c', 'c1'), { wrapper });
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  await act(async () => { await result.current.reattach('a1', { exact: 'chỗ mới' }); });

  expect(vi.mocked(patchAnnotation)).toHaveBeenCalledWith('a1', { anchor: { exact: 'chỗ mới' } });
  expect(vi.mocked(deleteAnnotation)).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Chạy đỏ** — `bun run test src/annotations/useAnnotations.test.tsx`
- [ ] **Step 5: Viết lại ruột** theo đúng khuôn `onMutate`/`onError`/`onSettled`
      của Task 6, khoá `annotationsQueryKey(courseId)`. `create` vẫn tự sinh
      `crypto.randomUUID()` như hiện nay — đó là thứ làm cú retry sau một
      response bị mất trả 409 thay vì tạo bản sao.
- [ ] **Step 6: Thêm khoá i18n `notes.saveFailed`** vào cả hai catalog (`packages/i18n/src/messages/{vi,en}.ts`).
- [ ] **Step 7: Chạy xanh** — `bun run test src/annotations/` (cả thư mục, để
      chắc `painter`/`anchor`/`MarginCards` không bị vạ lây) **và** `typecheck`
- [ ] **Step 8: Commit** — `git commit -m "useAnnotations: Query + lạc quan; ô soạn giữ chữ khi lùi; reattach giữ id"`

---

## Task 8: Heartbeat thoát khỏi outbox

**Files:**
- Create: `apps/web/src/api/events.ts`, `apps/web/src/api/events.test.ts`
- Modify: `apps/web/src/progress/heartbeat.ts`, `apps/web/src/progress/heartbeat.test.ts`

**Interfaces:**
- Produces:

```ts
export interface StudyEvent { courseId: string; chapterId: string; kind: 'heartbeat'; meta: Record<string, never>; at: string }
export function queueEvent(e: StudyEvent): void;
export function flushEvents(): Promise<void>;
export function startEventFlusher(): () => void;   // trả hàm dừng
```

Nhịp tim đập mỗi 30 giây; gửi một request mỗi nhịp là ba lần số request của cả
phần còn lại app cộng lại. Bộ gom trong bộ nhớ, flush theo nhịp thưa hơn và
flush thêm một lần khi `visibilitychange` sang `hidden` — đóng tab là lúc dễ mất
nhất.

- [ ] **Step 1: Test đỏ — `queueEvent` không gọi mạng, `flushEvents` gộp cả loạt thành MỘT request**

```ts
it('ba heartbeat thành một POST /events/batch', async () => {
  queueEvent(ev('c1')); queueEvent(ev('c2')); queueEvent(ev('c3'));
  expect(vi.mocked(api.post)).not.toHaveBeenCalled();

  await flushEvents();
  expect(vi.mocked(api.post)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ events: [ev('c1'), ev('c2'), ev('c3')] });
});
```

- [ ] **Step 2: Test đỏ — flush hỏng thì sự kiện Ở LẠI hàng đợi, lần sau gửi lại**

```ts
// Khác hẳn ghi tiến độ: một nhịp tim mất đi là một phút học biến khỏi /stats,
// và không có UI nào để lùi. Giữ lại là đúng, và không mâu thuẫn với việc
// xoá outbox — hàng đợi này sống trong BỘ NHỚ một phiên, không phải trong
// IndexedDB qua nhiều tuần.
it('flush hỏng: sự kiện còn nguyên cho lần sau', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error('mạng hỏng'));
  queueEvent(ev('c1'));
  await flushEvents();

  vi.mocked(api.post).mockResolvedValueOnce(undefined);
  await flushEvents();
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual({ events: [ev('c1')] });
});
```

- [ ] **Step 3: Test đỏ — `heartbeat.ts` không còn chạm `db` nào**

```ts
it('startHeartbeat gọi queueEvent, không chạm IndexedDB', () => {
  // ... tick một nhịp ...
  expect(vi.mocked(queueEvent)).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 4: Chạy đỏ** — `bun run test src/api/events.test.ts src/progress/heartbeat.test.ts`
- [ ] **Step 5: Viết `api/events.ts`** + đổi `heartbeat.ts:129` từ `db.outbox.add`
      sang `queueEvent`. Gắn `startEventFlusher()` ở `App.tsx` cạnh chỗ
      `startSync()` đang được gọi.
- [ ] **Step 6: Chạy xanh + typecheck**
- [ ] **Step 7: Commit** — `git commit -m "Heartbeat rời outbox: hàng đợi trong bộ nhớ, flush gộp, flush khi tab ẩn"`

---

## Task 9: Bốn màn còn đọc Dexie đổi nguồn

**Files:**
- Modify: `apps/web/src/progress/recent.ts`, `apps/web/src/progress/recent.test.ts`,
  `apps/web/src/pages/Progress.tsx`, `apps/web/src/pages/Dashboard.tsx`,
  `apps/web/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `useQuery` với `progressQueryKey()` / `annotationsQueryKey()` (Task 5).

Bốn chỗ này đang đọc `db.progress.toArray()` / `db.annotations.toArray()` qua
`liveQuery` (`grep -an 'db\.' apps/web/src/pages/*.tsx apps/web/src/progress/recent.ts`).
Cả bốn đọc **chéo mọi khoá**, nên chúng dùng chính hai query không tham số — một
request cho cả bốn, vì cùng `queryKey`.

- [ ] **Step 1: Test đỏ — `recent.ts` trả khoá vừa chạm gần nhất từ dữ liệu server**
- [ ] **Step 2: Test đỏ — `Settings` đếm ghi chú từ `/annotations`, không từ `db.annotations.count()`**
- [ ] **Step 3: Chạy đỏ** — `bun run test src/progress/recent.test.ts src/test/`
- [ ] **Step 4: Đổi bốn tệp.** `Dashboard.tsx` đang `import type { AnnotationRow } from '../db/local'`
      → đổi sang `Ann` của `api/annotations.ts`; đây là lần cuối kiểu ấy còn
      phải đến từ tệp Dexie.
- [ ] **Step 5: Chạy xanh** — `bun run test` (toàn bộ) + `typecheck`
- [ ] **Step 6: Commit** — `git commit -m "Bảng điều khiển, Tiến độ, Cài đặt, recent: đọc từ máy chủ"`

---

## Task 10: Cú flush cuối, rồi xoá IndexedDB — và `db/local.ts` tách đôi

**Files:**
- Create: `apps/web/src/db/legacyDrain.ts`, `apps/web/src/db/legacyDrain.test.ts`,
  `apps/web/src/db/localStorage.ts`, `apps/web/src/db/localStorage.test.ts`
- Delete: `apps/web/src/db/local.ts`, `apps/web/src/db/local.test.ts`,
  `apps/web/src/sync/engine.ts`, `apps/web/src/sync/engine.test.ts`,
  `apps/web/src/sync/crossTabSession.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/auth/useLogout.ts`,
  `apps/web/src/auth/session.ts`, `apps/web/src/theme/useTheme.ts`,
  `apps/web/src/i18n/index.ts`, `apps/web/src/i18n/LanguageProvider.tsx`,
  `apps/web/src/annotations/MarginCards.tsx`, `apps/web/package.json`

**Interfaces:**
- Produces:

```ts
// legacyDrain.ts — chạy đúng MỘT lần cho mỗi trình duyệt, rồi tự vô hiệu.
export async function drainLegacyDataOnce(): Promise<void>;

// localStorage.ts — nguyên văn phần localStorage của db/local.ts cũ, kèm
// USER_CONTENT_KEYS / DEVICE_PREFERENCE_KEYS và ràng buộc kiểu mà tsc đang canh.
export type LocalStorageKey = ...;
export function readLocalStorage(key: LocalStorageKey): string | null;
export function writeLocalStorage(key: LocalStorageKey, value: string | null): void;
export function clearUserContent(): void;
```

- [ ] **Step 1: Test đỏ — outbox còn hàng thì flush TRƯỚC khi xoá; flush hỏng thì KHÔNG xoá**

```ts
// Thứ tự ở đây là toàn bộ giá trị của cú flush. Xoá trước rồi gửi là một
// hàm không có gì để gửi.
it('flush hỏng thì database không bị xoá', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error('mạng hỏng'));
  await seedLegacyOutbox([{ table: 'progress', row: { courseId: 'c', chapterId: 'c1', status: 'read', done: true, updatedAt: 'x' } }]);

  await drainLegacyDataOnce();
  expect(await databaseExists('tuhoc')).toBe(true);
});

it('flush xong thì xoá, và lần chạy sau là no-op không gọi mạng', async () => {
  await seedLegacyOutbox([{ table: 'progress', row: { /* ... */ } }]);
  await drainLegacyDataOnce();
  expect(await databaseExists('tuhoc')).toBe(false);

  vi.mocked(api.post).mockClear();
  await drainLegacyDataOnce();
  expect(vi.mocked(api.post)).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Test đỏ — không có database cũ thì không gọi mạng, không ném**

```ts
// Người dùng mới chiếm phần lớn lượt chạy hàm này. Nó phải im lặng và rẻ.
it('trình duyệt sạch: không request, không lỗi', async () => {
  await expect(drainLegacyDataOnce()).resolves.toBeUndefined();
  expect(vi.mocked(api.post)).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Test đỏ — `clearUserContent` xoá đúng nhóm khoá nội dung, giữ nhóm tuỳ chọn thiết bị**

```ts
// Phân loại này đang được tsc canh qua LocalStorageKey. Chuyển tệp mà đánh
// rơi nó là mở lại đúng cái cửa mà kiểu ấy được dựng lên để đóng: một khoá
// nội dung người dùng không đi vào đường xoá khi đăng xuất.
// Tên khoá là tên THẬT đang chạy (db/local.ts:137 và :168), không phải tên
// đặt lại nhân dịp chuyển tệp: đổi chúng là đổi dữ liệu trong trình duyệt
// của người đang dùng, và không có đường di trú nào cho localStorage.
it('clearUserContent giữ ngôn ngữ và theme, xoá nội dung', () => {
  writeLocalStorage('itbook-lang', 'vi');
  writeLocalStorage('itbook-note-draft', 'nháp');
  clearUserContent();
  expect(readLocalStorage('itbook-lang')).toBe('vi');
  expect(readLocalStorage('itbook-note-draft')).toBeNull();
});
```

- [ ] **Step 4: Chạy đỏ** — `bun run test src/db/`
- [ ] **Step 5: Viết `legacyDrain.ts`.** Mở `tuhoc` bằng `indexedDB.open` thô
      (không Dexie — dependency sắp bị gỡ), đọc store `outbox`, chia lô 1000,
      `POST /sync` từng lô, rồi `indexedDB.deleteDatabase('tuhoc')`. Dấu "đã
      chạy" chính là **sự vắng mặt của database**, không cần cờ riêng.
- [ ] **Step 6: Viết `localStorage.ts`** — chuyển nguyên văn, giữ nguyên chú
      thích giải thích vì sao hai nhóm khoá tồn tại.
- [ ] **Step 7: Gọi `drainLegacyDataOnce()` một lần trong `App.tsx`**, thay chỗ
      `startSync()` đang đứng. Không chặn render: lỗi của nó không được làm
      trắng trang.
- [ ] **Step 8: Sửa `useLogout.ts`** — bỏ phần flush outbox; thay bằng chờ
      mutation đang bay (`queryClient.isMutating()` về 0, có trần thời gian) rồi
      mới `POST /logout`. Giữ nguyên ý định cũ: không bỏ rơi thao tác cuối.
- [ ] **Step 9: Xoá `db/local.ts`, `sync/`, và `dexie` khỏi `package.json`.**
      `bun install` để `bun.lock` khớp.
- [ ] **Step 10: Chạy xanh** — `bun run test` + `typecheck`, rồi
      `grep -arn "from '.*db/local'\|dexie\|liveQuery" apps/web/src` phải **rỗng**.
- [ ] **Step 11: Commit** — `git commit -m "Gỡ Dexie: flush cuối rồi xoá IndexedDB, tách localStorage ra tệp riêng"`

---

## Task 11: `RequireAuth` bỏ nhánh ngoại tuyến, và ba chú thích thôi hứa

**Files:**
- Modify: `apps/web/src/auth/RequireAuth.tsx`, `apps/web/src/auth/RequireAuth.test.tsx`,
  `apps/web/src/auth/session.ts`, `apps/web/src/auth/session.test.ts`,
  `apps/web/src/api/client.ts` (chú thích `serverAnswered`)

Phép đo trước khi sửa: **không có service worker, không precache, reader fetch
chương từ máy chủ mỗi lần** (`grep -arln 'serviceWorker\|workbox\|precache' apps/web/`
trả rỗng). Nhánh ngoại tuyến hôm nay thả người dùng qua cổng đăng nhập vào một
reader không có gì để đọc. Gỡ nó không lấy đi tính năng nào đang chạy — nhưng nó
**có** lấy đi một thứ thật: Bảng điều khiển và Tiến độ hiện đọc được offline từ
IndexedDB. Sau pha này thì không. Đó là cái giá, và nó phải nằm trong commit
message chứ không nằm trong đầu người thi công.

- [ ] **Step 1: Test đỏ — mất mạng thì hiện màn "cần mạng", không render `children`**

```tsx
it('không có response nào thì hiện màn cần-mạng, không thả vào reader', async () => {
  vi.mocked(api.get).mockRejectedValue(new TypeError('Failed to fetch'));
  render(<RequireAuth><div>nội dung</div></RequireAuth>, { wrapper });

  expect(await screen.findByText(t('auth.needsNetwork'))).toBeInTheDocument();
  expect(screen.queryByText('nội dung')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Chạy đỏ** — `bun run test src/auth/`
- [ ] **Step 3: Gỡ nhánh** — xoá `offlineSessionQueryKey`, `offlineSessionIsUsable`,
      `OFFLINE_READ_MAX_AGE_MS`, `rememberSessionVerified`, `readSessionVerifiedAt`
      và các test của chúng. Commit message nêu lý do (ràng buộc toàn cục #7).
- [ ] **Step 4: Sửa chú thích `serverAnswered` trong `api/client.ts`.** Nó đang
      nói *"This is the single distinction `<RequireAuth>`'s offline branch rests
      on"* — nhánh ấy vừa chết. Hàm vẫn còn giá trị (401 khác với im lặng), chỉ
      lý do tồn tại là khác. **Đây đúng dạng lỗi Pha 2 bắt hơn sáu lần: hồ sơ
      hứa rộng hơn thứ mã làm.**
- [ ] **Step 5: Thêm khoá i18n `auth.needsNetwork`** vào cả hai catalog.
- [ ] **Step 6: Chạy xanh** — `bun run test` + `typecheck`
- [ ] **Step 7: Commit** — `git commit -m "RequireAuth bỏ nhánh ngoại tuyến (đo: không có service worker, không còn gì đọc offline); sửa chú thích serverAnswered theo"`

---

## Task 12: Tool `read_my_notes` — và hai điều kiện Pha 2 đã trả giá để học

**Files:**
- Create: `apps/api/internal/ai/tool_notes.go`, `apps/api/internal/ai/tool_notes_test.go`,
  `apps/api/migrations/0010_enable_read_my_notes.up.sql`,
  `apps/api/migrations/0010_enable_read_my_notes.down.sql`
- Modify: `apps/api/internal/ai/handler.go` (`TurnTools`), `apps/api/internal/ai/credits.go`
  (`defaultAgentConfig`), `apps/web/src/ai/AskPanel.tsx`, `apps/web/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `ToolRunner`, `registerTool`, `TurnTools` (Pha 2 Task 5/6);
  `userdata.Repo` (Task 1–2).
- Produces:

```go
const ToolNameReadMyNotes = "read_my_notes"

type NotesQuerier interface {
	Progress(ctx context.Context, userID uuid.UUID, courseID string) ([]userdata.ProgressRow, error)
	Notes(ctx context.Context, userID uuid.UUID, courseID string) ([]userdata.AnnotationRow, error)
}

// userID BUỘC vào runner lúc dựng, KHÔNG phải một tham số trong schema tool.
func NewNotesTool(q NotesQuerier, userID uuid.UUID) ToolRunner
```

- [ ] **Step 1: Test đỏ — schema của tool KHÔNG có tham số người dùng**

```go
// Đây là confused deputy (S2-F9, còn sống trong docs/carried-forward.md) viết
// thành test. Nếu model tự khai được user_id, thì một câu hỏi khéo léo là một
// lệnh đọc ghi chú riêng tư của người khác — và tool sẽ ngoan ngoãn chấp hành.
func TestNotesToolSchemaHasNoUserParameter(t *testing.T) {
	def := NewNotesTool(fakeQuerier{}, uuid.New()).Definition()
	raw, _ := json.Marshal(def)
	for _, needle := range []string{"user_id", "userId", "user"} {
		if bytes.Contains(bytes.ToLower(raw), []byte(strings.ToLower(needle))) {
			t.Fatalf("schema tool chứa %q: %s", needle, raw)
		}
	}
}

func TestNotesToolReadsOnlyBoundUser(t *testing.T) {
	q := &recordingQuerier{}
	bound := uuid.New()
	_, _ = NewNotesTool(q, bound).Run(context.Background(), `{"slug":"c","user_id":"`+uuid.NewString()+`"}`)

	if q.askedFor != bound {
		t.Fatalf("tool đọc dữ liệu của %v, muốn %v — tham số trong args đã lái được nó", q.askedFor, bound)
	}
}
```

- [ ] **Step 2: Test đỏ — `slug` rỗng trả lỗi CÓ CHỮ cho model, không đọc mọi khoá**

```go
// Lỗi Pha 2 đúng hình dạng này: read_course bật mặc định, courseSlug rỗng,
// nhánh chết im lặng trong sản xuất suốt cả pha. Ở đây rỗng phải ồn ào.
func TestNotesToolRejectsEmptySlug(t *testing.T) {
	out, err := NewNotesTool(fakeQuerier{}, uuid.New()).Run(context.Background(), `{"slug":""}`)
	if err != nil {
		t.Fatalf("muốn lỗi-có-chữ cho model, không phải error Go: %v", err)
	}
	if !strings.Contains(strings.ToLower(out), "slug") {
		t.Errorf("model không đọc được lý do: %q", out)
	}
}
```

- [ ] **Step 3: Test đỏ — `/ai/chat` truyền `courseSlug` KHÔNG rỗng xuống tool**

```go
// Cổng cho bài học đắt nhất Pha 2: prop tồn tại suốt chuỗi, mặc định "",
// nhánh `if t.CourseSlug != ""` chết trong sản xuất, và không test nào thấy.
func TestChatPassesCourseSlugIntoTurn(t *testing.T) {
	env := newChatEnv(t)
	env.postChat(t, `{"question":"em đang ở đâu","courseSlug":"mau-hop-le"}`)
	if got := env.lastTurn().CourseSlug; got != "mau-hop-le" {
		t.Fatalf("Turn.CourseSlug = %q — đường dây từ web tới tool đứt", got)
	}
}
```

- [ ] **Step 4: Chạy đỏ** — `go test ./internal/ai/ -run 'NotesTool|CourseSlug' -v`
- [ ] **Step 5: Viết `tool_notes.go`.** `Run` trả văn bản thuần: danh sách
      chương đã đọc, và ghi chú kèm đoạn được neo. Trần độ dài đầu ra như
      `tool_course.go` đang có — ghi chú của một người học chăm có thể dài hơn
      cả chương.
- [ ] **Step 6: Thêm tool vào `TurnTools` và vào `defaultAgentConfig()`**

```go
func defaultAgentConfig() AgentConfig {
	return AgentConfig{ToolsEnabled: []string{ToolNameReadCourse, ToolNameReadMyNotes}}
}
```

- [ ] **Step 7: Viết migration `0010`** — hàng `user_agent_config` đã tồn tại
      **không** đọc `defaultAgentConfig()`, nên "mặc định bật" chỉ đúng với
      người dùng mới nếu thiếu bước này:

```sql
-- up
UPDATE user_agent_config
SET tools_enabled = array_append(tools_enabled, 'read_my_notes')
WHERE NOT ('read_my_notes' = ANY(tools_enabled));
```

```sql
-- down
UPDATE user_agent_config SET tools_enabled = array_remove(tools_enabled, 'read_my_notes');
```

- [ ] **Step 8: Web — một dòng công bố trong `AskPanel.tsx`**, kèm đường tắt
      sang Settings để tắt. Khoá i18n `ai.readsYourNotes` ở cả hai catalog. Mặc định
      bật là quyết định của chủ dự án; **không nói cho người học biết** thì là
      một quyết định khác, không ai chọn.
- [ ] **Step 9: Chạy xanh** — `make test-api` + `make test-web`
- [ ] **Step 10: Commit** — `git commit -m "Tool read_my_notes: userID buộc lúc dựng (không nằm trong schema), mặc định bật, có công bố trong panel"`

---

## Task 13: e2e — gỡ cách ly `p2.spec.ts`, và hai thiết bị nay là phép thử THẬT

**Files:**
- Modify: `apps/web/e2e/p2.spec.ts`, `apps/web/playwright.config.ts:70`
  (bỏ `testIgnore: ['**/p2.spec.ts']`), `apps/web/e2e/p1.spec.ts:121`

Cách ly hiện tại có lý do đo được: `COURSE_ID = 'so-dau-phay-dong'` không bao giờ
được seed; `scripts/test-e2e.sh` chỉ publish `mau-hop-le` với chương `c1`/`c2`.

Và có một bài **đang xanh** cần sửa vì lý do ngược lại. `p1.spec.ts:121` —
*"read a chapter, mark it read, see it read on a second device"* — chờ tường
minh hai bộ đếm 15 giây của sync engine (đọc chú thích dài ở dòng 223–245: "device
1's own 15s push timer" và "device 2's own independent 15s pull timer").
Sau pha này **không còn bộ đếm nào**: đánh dấu là một `PUT` đồng bộ, và thiết bị
2 thấy khi tải lại. Bài test sẽ vẫn xanh — chờ một thứ đã biến mất không làm nó
đỏ — nên đây đúng là dạng "test mô tả một cơ chế không còn tồn tại" mà không cổng
nào bắt được. Nó cũng đang tiêu tới 30 giây mỗi lần chạy bộ e2e.

- [ ] **Step 1: Đổi hằng số** — `COURSE_ID = 'mau-hop-le'`, `CHAPTER_ID = 'c1'`
      (`c2` chở widget `dem-so` mà `widget.spec.ts` đang lái; tránh trộn hai
      mối quan tâm vào một chương).
- [ ] **Step 2: Bỏ mục `testIgnore`** trong `playwright.config.ts`, kèm lý do
      trong commit message.
- [ ] **Step 3: Viết lại hai kịch bản "hai thiết bị".** Trước đây chúng chứng
      minh *đồng bộ cuối cùng cũng tới*, nên phải chờ và thử lại. Nay máy chủ là
      nguồn sự thật, nên khẳng định mạnh hơn và ngắn hơn:

```ts
test('ghi chú tạo ở thiết bị A xuất hiện ở B sau một lần tải lại', async () => {
  await pageA.goto(CHAPTER_PATH);
  await selectParagraphByDrag(pageA);
  await pageA.getByRole('button', { name: /ghi chú/i }).click();
  await pageA.getByRole('textbox').fill('viết ở A');
  await pageA.keyboard.press('Escape');

  await pageB.goto(CHAPTER_PATH);   // không chờ, không thử lại: B đọc thẳng từ máy chủ
  await openNotesTab(pageB);
  await expect(pageB.getByText('viết ở A')).toBeVisible();
});
```

- [ ] **Step 4: Thêm một kịch bản mới — mất mạng thì NÓI, không nuốt**

```ts
// Đây là lời hứa mới của pha này với người học, và là chỗ duy nhất kiểm được
// nó đầu-cuối: ghi lạc quan + lùi lại + báo.
test('ghi chú khi API chết: thẻ biến mất và có thông báo', async () => {
  await pageA.goto(CHAPTER_PATH);
  await pageA.route('**/annotations', (route) => route.abort());
  await selectParagraphByDrag(pageA);
  await pageA.getByRole('button', { name: /ghi chú/i }).click();

  await expect(pageA.getByRole('alert')).toBeVisible();
});
```

- [ ] **Step 5: Viết lại `p1.spec.ts:121`** — bỏ hai lần chờ 15 giây và cả đoạn
      chú thích "Judgment 2 — waiting for sync without flake" đã hết đối tượng.
      Khẳng định mới mạnh hơn: thiết bị 2 tải lại là thấy, không có cửa sổ thời
      gian nào để chờ.

```ts
// Trước: chờ tới ~30s cho hai bộ đếm gặp nhau. Nay không có bộ đếm nào —
// nếu bài này cần chờ, tức là có gì đó vẫn đang đồng bộ ngầm, và đó là lỗi.
await pageB.reload();
await expect(pageB.getByRole('listitem', { name: /c1/ })).toHaveClass(/done/);
```

- [ ] **Step 6: Chạy** — `make test-e2e` (cần Docker). Bộ này nay **7 bài**:
      `p1`×4, `p2`×1 (vừa gỡ cách ly), `s2`×1, `widget`×1. Ghi lại thời gian
      chạy trước và sau: bỏ hai lần chờ 15 giây là một phép đo, không phải một
      cảm giác.
- [ ] **Step 7: Commit** — `git commit -m "e2e: p2 hết cách ly (seed đúng mau-hop-le/c1), p1 thôi chờ hai bộ đếm 15s đã chết, thêm bài mất mạng"`

---

## Task 14: Tài liệu thôi mô tả một kiến trúc không còn tồn tại

**Files:**
- Modify: `README.md`, `docs/carried-forward.md`,
  `docs/superpowers/specs/2026-08-25-server-side-pivot.md` (§9, dòng Pha 3),
  mọi tệp còn nhắc `/sync`, outbox, hay đọc ngoại tuyến
- Create: `docs/superpowers/plans/2026-09-01-pha3-ban-giao.md`

Pha 2 bắt dạng lỗi "hồ sơ hứa rộng hơn mã" **hơn sáu lần**, và **bốn lần** một
bản vá tài liệu đẻ ra khẳng định sai MỚI. Task này chịu rủi ro ấy trực tiếp.

- [ ] **Step 1: Quét, có `-a`** — `grep -arn 'outbox\|/sync\|ngoại tuyến\|offline\|IndexedDB\|Dexie' README.md docs/ apps/web/src apps/api`
      Mỗi kết quả xử lý theo một trong ba cách, không có cách thứ tư: (a) còn
      đúng → để yên; (b) sai → sửa; (c) mô tả thứ đã chết → xoá kèm lý do.
- [ ] **Step 2: Sửa §9 của spec** — dòng Pha 3 ghi `/progress /notes /annotations`
      và `POST /migrate`. Sự thật đã ship: hai resource (ghi chú là cột `note`
      của annotation, chưa bao giờ có bảng thứ ba), và **không có** `/migrate`
      — có cú flush cuối qua `POST /sync` cũ. Sửa chính spec, không để plan và
      spec nói hai chuyện.
- [ ] **Step 3: Ghi nợ vào `docs/carried-forward.md`** — `POST /sync` là mã chết
      theo lịch, kèm câu truy vấn `apilog` để kiểm điều kiện 30 ngày, và kèm lỗ
      đã biết (người quay lại sau khi endpoint bị xoá).
- [ ] **Step 4: Viết bàn giao Pha 3** theo khuôn `2026-08-29-pha2-ban-giao.md`:
      quyết định và giá của chúng, chỗ điều phối viên sai, nợ đã park, thứ Pha 4
      thừa kế.
- [ ] **Step 5: Chạy toàn bộ cổng**

```bash
make test-api && make test-web && make test-format && make test-cli && make test-registry
```

- [ ] **Step 6: Commit** — `git commit -m "Tài liệu Pha 3: sửa §9 của spec cho khớp thứ đã ship, ghi nợ POST /sync có điều kiện đóng"`

---

## Ghi chú cho người thi công

**Đừng tin "xanh" mà không kiểm cây.** Pha 2 có ba lần một đột biến test sống
lại trong mã sản phẩm đường tiền, một lần là lỗ phân quyền thật đang chạy.
`git diff apps/api/` và `git diff apps/web/src/` trước mỗi commit.

**Thứ tự Task 3 và Task 10 không được đảo.** Shim flush cuối cần `POST /sync`
còn sống. Nếu Task 3 lỡ xoá cả gói, Task 10 sẽ gọi một endpoint 404 và cú flush
thành trang trí — hỏng đúng theo cách không test nào ở đây bắt được, vì test của
nó mock `api.post`.

**Chữ ký hook là hợp đồng.** Task 6 và 7 giữ nguyên `UseProgressResult` và
`UseAnnotationsResult` không phải vì lịch sự, mà vì đó là thứ giữ ≈6.000 dòng
logic neo/vẽ của annotations nằm ngoài bán kính pha này. Nếu thấy mình đang sửa
`painter.ts` hay `anchor.ts`, dừng lại: hoặc chữ ký vừa bị đổi, hoặc task đã
trượt khỏi phạm vi.

**`grep` không có `-a` sẽ nói dối với anh.** `apps/web/src/api/ratings.ts` chứa
một byte NUL hợp lệ.

---

## Tự soát plan (đã chạy)

**Phủ spec §9.** `/progress` → Task 1. `/annotations` → Task 2. "`/notes`" →
Task 2 (không có bảng thứ ba; sai lệch của spec ghi ở Task 14 Step 2).
`POST /migrate` → **cố ý không làm**, thay bằng Task 10, quyết định và lý do nằm
ở bảng "Quyết định chốt lúc soạn plan" và sẽ sửa vào spec ở Task 14. "nguồn sự
thật qua TanStack Query" → Task 5–7, 9. "gỡ `db/` + `sync/`" → Task 10.
"`RequireAuth` bỏ nhánh ngoại tuyến" → Task 11. "agent thêm tool đọc tiến
độ/ghi chú" → Task 12.

**Chỗ trống không nằm trong spec, đã thêm task:** heartbeat rời outbox (Task 8),
`api.patch`/`api.del` (Task 4), tách `localStorage` khỏi `db/local.ts` (Task 10),
gỡ cách ly `p2.spec.ts` (Task 13).

**Nhất quán kiểu.** `ProgressRow` (Go, `internal/userdata`) và `ProgressRow` (TS,
`api/progress.ts`) cùng tên trường; `AnnotationRow` phía Go đối ứng `Ann` phía
TS — tên khác nhau vì `Ann` là tên `useAnnotations.ts` đã export sẵn cho cả thư
mục annotations, và đổi nó sẽ chạm đúng những tệp mà Task 7 hứa không đụng.
`ToolNameReadMyNotes` dùng cùng một chuỗi `read_my_notes` ở tool, ở
`defaultAgentConfig`, và ở migration `0010`.

**Không còn placeholder.** Mọi bước có mã đều có mã thật; mọi bước "chạy" đều có
lệnh chạy được.
