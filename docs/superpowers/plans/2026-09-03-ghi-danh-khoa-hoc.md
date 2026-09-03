# Ghi danh khoá học — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách "khoá có trên hệ thống" khỏi "khoá của tôi", để trang Học tiếp chỉ nói về khoá người đọc đã tự chọn.

**Architecture:** Một bảng `enrollments` mới và ba route trong `internal/userdata`, bám đúng khuôn `progress`/`annotations` đã có ở đó. Phía web thêm một module client theo khuôn `api/progress.ts`, rồi ba màn hình đọc nguồn mới: Học tiếp đổi nguồn chọn khoá, trang khoá thêm nút ghi danh, trang đọc thêm một lối ghi danh cho người vào thẳng.

**Tech Stack:** Go 1.25 + Fiber v2 + pgx v5 + golang-migrate v4.19.1 (API); React 19 + TanStack Query + Vite + Vitest (web); Postgres.

**Spec:** `docs/superpowers/specs/2026-09-03-ghi-danh-khoa-hoc-design.md`

## Global Constraints

- **KHÔNG được sửa `packages/course-kit/`.** `git diff packages/course-kit/` phải rỗng khi xong. Thân chương và `reader.css` bất khả xâm phạm.
- **Không có chuỗi tiếng Việt trong mã Go production.** Thông báo lỗi API viết tiếng Anh kỹ thuật, như mọi handler hiện có.
- **Mọi chuỗi giao diện phải có ở CẢ HAI catalog i18n** — `packages/i18n/src/messages/vi.ts` và `en.ts`. Thiếu một bên là lỗi biên dịch TypeScript, không phải cảnh báo.
- **Thông điệp commit viết tiếng Việt**, nêu nguyên nhân chứ không chỉ nêu việc đã làm.
- **Không backfill.** Migration `0011` không được chèn hàng ghi danh nào từ `progress`.
- `course_id` là `text`, **không** khoá ngoại tới `published_courses`.

---

## File Structure

| Tệp | Trách nhiệm |
|---|---|
| `apps/api/migrations/0011_enrollments.{up,down}.sql` | Bảng `enrollments` và chỉ mục của nó |
| `apps/api/internal/userdata/repo.go` (sửa) | Ba câu SQL của ghi danh — tệp DUY NHẤT trong gói nói SQL |
| `apps/api/internal/userdata/usecase.go` (sửa) | Kiểm đầu vào `courseId` |
| `apps/api/internal/userdata/handler.go` (sửa) | HTTP: parse thân, mã trạng thái, hình dạng JSON |
| `apps/api/internal/server/server.go` (sửa) | Gắn ba route sau `auth.Require` |
| `apps/api/internal/userdata/enrollments_test.go` (tạo) | Test qua HTTP, khuôn `progress_test.go` |
| `apps/web/src/api/enrollments.ts` (tạo) | Client + chặn hình dạng ở biên, khuôn `api/progress.ts` |
| `apps/web/src/api/enrollments.test.ts` (tạo) | Test cho chặn hình dạng |
| `apps/web/src/progress/recent.ts` (sửa) | `pickFocusCourse` đổi tài liệu; không đổi chữ ký |
| `apps/web/src/pages/Dashboard.tsx` (sửa) | Xoá `fallbackCourseIds`; đổi nguồn; thêm danh sách khoá của tôi |
| `apps/web/src/pages/CourseHome.tsx` (sửa) | Nút "Bắt đầu học" / lối "Bỏ khỏi khoá của tôi" |
| `apps/web/src/pages/Reader.tsx` (sửa) | Dòng "Thêm vào khoá của tôi" |
| `packages/i18n/src/messages/{vi,en}.ts` (sửa) | Chuỗi mới, cả hai catalog |

---

### Task 1: Phía Go — bảng, ba route, và bộ test qua HTTP

Cả tầng Go làm trong MỘT việc, không tách nhỏ hơn, vì bộ test của gói này chạy
qua HTTP (`package userdata_test`, dựng app thật bằng `server.New`): một hàm
repo chưa có route thì không có cách nào test được, nên tách ra sẽ tạo một bước
không có chu trình test của riêng nó.

**Files:**
- Create: `apps/api/migrations/0011_enrollments.up.sql`
- Create: `apps/api/migrations/0011_enrollments.down.sql`
- Create: `apps/api/internal/userdata/enrollments_test.go`
- Modify: `apps/api/internal/userdata/repo.go` (thêm cuối tệp)
- Modify: `apps/api/internal/userdata/usecase.go` (thêm cuối tệp)
- Modify: `apps/api/internal/userdata/handler.go` (thêm cuối tệp)
- Modify: `apps/api/internal/server/server.go:331-333` (thêm ngay sau khối `/progress`)

**Interfaces:**
- Consumes: `auth.Require(deps.Pool)`, `auth.UID(c)`, `apilog.Internal`, `userdata.NewRepo/NewUsecase/NewHandler` — đã có.
- Produces, cho Task 2 dùng qua HTTP:
  - `GET /enrollments` → 200 `{"enrollments":[{"courseId":string,"createdAt":string}]}`, mới nhất trước
  - `POST /enrollments` body `{"courseId":string}` → 201, không thân
  - `DELETE /enrollments/:courseId` → 204, không thân
  - `createdAt` theo `timeLayout` của `handler.go` (RFC3339 UTC), cùng định dạng `updatedAt` của progress.

- [ ] **Step 1: Viết migration**

`apps/api/migrations/0011_enrollments.up.sql`:

```sql
-- Ghi danh khoá học: bảng trả lời "khoá nào là CỦA người này", tách hẳn khỏi
-- "khoá nào có trên hệ thống" (published_courses, ai cũng thấy y hệt nhau).
--
-- Trước bảng này, apps/web/src/pages/Dashboard.tsx trả lời câu thứ nhất bằng
-- dữ liệu của câu thứ hai: fallbackCourseIds() hợp danh mục công khai với
-- stats.courses[] rồi lấy phần tử đầu theo bảng chữ cái. Nên mọi tài khoản
-- vừa đăng ký đều thấy một khoá chưa từng mở nằm ở Học tiếp.
--
-- course_id là text, KHÔNG phải khoá ngoại tới published_courses — cùng lựa
-- chọn mà progress (migration 0001) đã làm, vì cùng một lý do: gỡ xuất bản một
-- khoá không được phép xoá tiến độ của người đọc, nên nó cũng không được xoá
-- ghi danh. Một khoá gỡ rồi xuất bản lại phải tìm thấy người đọc cũ y nguyên.
-- Cái giá đã biết: không ràng buộc nào ngăn một hàng trỏ tới course_id không
-- tồn tại; giao diện bỏ qua khoá không tra được manifest, y như đường progress.
--
-- KHÔNG backfill từ progress (quyết định của chủ sản phẩm, 03/09/2026). Hệ quả
-- phải biết trước: ngay sau khi triển khai, người đang đọc dở thấy Học tiếp
-- trống cho tới khi tự bấm "Bắt đầu học". Dữ liệu còn nguyên, chỉ bị giấu.
CREATE TABLE enrollments (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id));

-- GET /enrollments luôn hỏi đúng một hình dạng: mọi hàng của MỘT người, mới
-- nhất trước. Chỉ mục phủ đúng hình dạng ấy nên câu truy vấn không phải sắp xếp.
CREATE INDEX idx_enrollments_user ON enrollments (user_id, created_at DESC);
```

`apps/api/migrations/0011_enrollments.down.sql`:

```sql
-- Nghịch đảo đúng của up.sql. DROP TABLE cuốn theo cả chỉ mục và khoá ngoại,
-- nên không cần câu lệnh riêng cho chúng.
--
-- Đây là một xoá THẬT và không hoàn tác được: chạy down rồi up lại sẽ cho một
-- bảng rỗng, tức mọi người đọc mất ghi danh và phải bấm "Bắt đầu học" lần nữa.
-- progress và annotations không bị đụng tới, nên không có tiến độ hay ghi chú
-- nào mất theo.
DROP TABLE enrollments;
```

- [ ] **Step 2: Chạy migration lên CSDL dev để chắc nó hợp lệ**

Run: `migrate -path apps/api/migrations -database "$DEV_DATABASE_URL" up`
Expected: in `11/u enrollments`, exit 0. Rồi `migrate ... down 1` và `up` lại: cả hai exit 0.

- [ ] **Step 3: Viết test đỏ trước**

`apps/api/internal/userdata/enrollments_test.go` — dùng lại `newTestApp`,
`uniqueEmail`, `doRequest`, và các helper đăng ký/đăng nhập có sẵn trong
`progress_test.go` (cùng package `userdata_test`, nên gọi thẳng được):

```go
package userdata_test

import (
	"encoding/json"
	"net/http"
	"testing"
)

type enrollmentsBody struct {
	Enrollments []struct {
		CourseID  string `json:"courseId"`
		CreatedAt string `json:"createdAt"`
	} `json:"enrollments"`
}

// Ba route đều phải 401 khi không có phiên. Cùng hàng rào, cùng lý do, như
// GET/PUT /progress: auth.Require là thứ duy nhất đứng giữa dữ liệu của một
// người và mọi người khác.
func TestEnrollmentsRequireSession(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/enrollments"},
		{http.MethodPost, "/enrollments"},
		{http.MethodDelete, "/enrollments/khoa-a"},
	} {
		res, _ := doRequest(t, app, tc.method, tc.path, nil, nil)
		if res.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s %s: status = %d, want 401", tc.method, tc.path, res.StatusCode)
		}
	}
}

// Danh sách rỗng phải là [] chứ không phải null: encoding/json biến slice nil
// thành null, và client gọi .map() trên null sẽ ném lỗi.
func TestListEnrollmentsEmptyIsArrayNotNull(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie := registerAndLogin(t, app, uniqueEmail("enroll-empty"))

	res, body := doRequest(t, app, http.MethodGet, "/enrollments", nil, cookie)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", res.StatusCode, body)
	}
	if got := string(body); !strings.Contains(got, `"enrollments":[]`) {
		t.Fatalf("body = %s, want an empty ARRAY at .enrollments", got)
	}
}

// POST hai lần cùng courseId là một cú bấm đúp, không phải một lỗi.
func TestPostEnrollmentIsIdempotent(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie := registerAndLogin(t, app, uniqueEmail("enroll-twice"))

	for i := 0; i < 2; i++ {
		res, body := doRequest(t, app, http.MethodPost, "/enrollments",
			map[string]string{"courseId": "khoa-a"}, cookie)
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("POST #%d: status = %d, want 201; body = %s", i+1, res.StatusCode, body)
		}
	}

	_, body := doRequest(t, app, http.MethodGet, "/enrollments", nil, cookie)
	var got enrollmentsBody
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("unmarshal: %v; body = %s", err, body)
	}
	if len(got.Enrollments) != 1 {
		t.Fatalf("len = %d, want exactly 1 row after two POSTs", len(got.Enrollments))
	}
}

// DELETE thứ chưa từng ghi danh cũng là 204: kết quả người dùng muốn ("khoá
// này không còn trong danh sách") đã đúng, và một 404 ở đây chỉ dạy giao diện
// phải xử lý một trường hợp không có hậu quả nào.
func TestDeleteEnrollmentIsIdempotent(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie := registerAndLogin(t, app, uniqueEmail("enroll-del"))

	res, body := doRequest(t, app, http.MethodDelete, "/enrollments/chua-tung-co", nil, cookie)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", res.StatusCode, body)
	}
}

// BÀI QUAN TRỌNG NHẤT CỦA TỆP NÀY. Quyết định "bỏ ghi danh chỉ rời danh sách"
// hiện chỉ là một câu trong tài liệu thiết kế, và tài liệu không chặn được ai.
// Đây là chỗ duy nhất biến nó thành thứ chạy được.
func TestDeleteEnrollmentKeepsProgressAndAnnotations(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie := registerAndLogin(t, app, uniqueEmail("enroll-keeps"))

	doRequest(t, app, http.MethodPost, "/enrollments",
		map[string]string{"courseId": "khoa-a"}, cookie)
	doRequest(t, app, http.MethodPut, "/progress", map[string]any{
		"courseId": "khoa-a", "chapterId": "c1", "status": "read", "done": true,
	}, cookie)
	doRequest(t, app, http.MethodPost, "/annotations", map[string]any{
		"courseId": "khoa-a", "chapterId": "c1",
		"anchor": json.RawMessage(`{"start":0,"end":5}`), "note": "ghi chu",
	}, cookie)

	res, _ := doRequest(t, app, http.MethodDelete, "/enrollments/khoa-a", nil, cookie)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE status = %d, want 204", res.StatusCode)
	}

	_, progressBody := doRequest(t, app, http.MethodGet, "/progress", nil, cookie)
	if !strings.Contains(string(progressBody), `"chapterId":"c1"`) {
		t.Fatalf("progress row disappeared after un-enrolling: %s", progressBody)
	}
	_, annBody := doRequest(t, app, http.MethodGet, "/annotations?course=khoa-a", nil, cookie)
	if !strings.Contains(string(annBody), "ghi chu") {
		t.Fatalf("annotation disappeared after un-enrolling: %s", annBody)
	}
}

// Ghi danh của người A không được lọt vào danh sách của người B.
func TestEnrollmentsAreScopedToOneUser(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookieA := registerAndLogin(t, app, uniqueEmail("enroll-a"))
	cookieB := registerAndLogin(t, app, uniqueEmail("enroll-b"))

	doRequest(t, app, http.MethodPost, "/enrollments",
		map[string]string{"courseId": "khoa-cua-a"}, cookieA)

	_, body := doRequest(t, app, http.MethodGet, "/enrollments", nil, cookieB)
	if strings.Contains(string(body), "khoa-cua-a") {
		t.Fatalf("user B sees user A's enrollment: %s", body)
	}
}

// courseId rỗng là một yêu cầu vô nghĩa, không phải một hàng cần lưu.
func TestPostEnrollmentRejectsEmptyCourseID(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie := registerAndLogin(t, app, uniqueEmail("enroll-empty-id"))

	res, _ := doRequest(t, app, http.MethodPost, "/enrollments",
		map[string]string{"courseId": ""}, cookie)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", res.StatusCode)
	}
}
```

**Trước khi chạy:** mở `progress_test.go` và xác nhận tên thật của helper đăng
ký-rồi-đăng-nhập (kế hoạch này gọi nó là `registerAndLogin`) cùng danh sách
import (`strings`, `store`). Dùng đúng tên đang có; đừng viết bản thứ hai.

- [ ] **Step 4: Chạy test cho chắc nó ĐỎ**

Run: `cd apps/api && go test ./internal/userdata/ -run TestEnrollment -v`
Expected: FAIL — 401/404 ở mọi route vì chưa gắn route nào.

- [ ] **Step 5: Thêm repo**

Cuối `apps/api/internal/userdata/repo.go`:

```go
// EnrollmentRow là một hàng ghi danh. UserID vắng mặt có chủ ý, cùng lý do
// ProgressRow không có nó: người gọi đã biết (auth.UID), và nó không bao giờ
// được lấy từ đầu vào của client.
type EnrollmentRow struct {
	CourseID  string
	CreatedAt time.Time
}

// ListEnrollments trả mọi ghi danh của userID, mới nhất trước — đúng thứ tự
// idx_enrollments_user đã phủ, nên câu này không phải sắp xếp thêm lần nào.
func (r *Repo) ListEnrollments(ctx context.Context, userID uuid.UUID) ([]EnrollmentRow, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT course_id, created_at
		 FROM enrollments
		 WHERE user_id = $1
		 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("userdata: list enrollments: %w", err)
	}
	defer rows.Close()

	out := []EnrollmentRow{}
	for rows.Next() {
		var e EnrollmentRow
		if err := rows.Scan(&e.CourseID, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("userdata: scan enrollment row: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("userdata: list enrollments: %w", err)
	}
	return out, nil
}

// ON CONFLICT DO NOTHING chứ không phải DO UPDATE: ghi danh lần hai KHÔNG được
// dời created_at, vì "khoá này là của tôi từ bao giờ" phải giữ nguyên câu trả
// lời đầu tiên. Cú bấm đúp không phải một sự kiện thứ hai.
const createEnrollmentSQL = `
INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)
ON CONFLICT (user_id, course_id) DO NOTHING;
`

// CreateEnrollment ghi danh userID vào courseID. Idempotent: gọi lại không
// lỗi và không đổi gì.
func (r *Repo) CreateEnrollment(ctx context.Context, userID uuid.UUID, courseID string) error {
	if _, err := r.pool.Exec(ctx, createEnrollmentSQL, userID, courseID); err != nil {
		return fmt.Errorf("userdata: create enrollment (course=%s): %w", courseID, err)
	}
	return nil
}

// DeleteEnrollment gỡ courseID khỏi danh sách của userID.
//
// KHÔNG trả bool "có xoá được không", khác PatchAnnotation/DeleteAnnotation ở
// trên: những hàm ấy trả bool để handler dựng 404, vì id ở đó là uuid client
// sinh ra và "không tìm thấy" là một câu trả lời có nghĩa. Ở đây không có gì
// để 404: xoá một ghi danh chưa tồn tại đã đạt đúng kết quả người dùng muốn.
//
// Câu này chỉ chạm bảng enrollments. progress và annotations của cùng cặp
// (người dùng, khoá) KHÔNG bị đụng tới — đó là toàn bộ quyết định "bỏ ghi danh
// chỉ rời danh sách", và TestDeleteEnrollmentKeepsProgressAndAnnotations là
// thứ giữ nó khỏi bị vô hiệu bởi một câu DELETE thêm vào sau này.
func (r *Repo) DeleteEnrollment(ctx context.Context, userID uuid.UUID, courseID string) error {
	if _, err := r.pool.Exec(ctx,
		`DELETE FROM enrollments WHERE user_id = $1 AND course_id = $2`,
		userID, courseID,
	); err != nil {
		return fmt.Errorf("userdata: delete enrollment (course=%s): %w", courseID, err)
	}
	return nil
}
```

- [ ] **Step 6: Thêm usecase**

Cuối `apps/api/internal/userdata/usecase.go`:

```go
// ErrEmptyCourseID là câu trả lời cho một courseId rỗng. Nó là lỗi của NGƯỜI
// GỌI, không phải của máy chủ, nên handler dựng 400 chứ không 500.
var ErrEmptyCourseID = errors.New("userdata: courseId must not be empty")

func (uc *Usecase) ListEnrollments(ctx context.Context, userID uuid.UUID) ([]EnrollmentRow, error) {
	return uc.repo.ListEnrollments(ctx, userID)
}

// CreateEnrollment kiểm đúng một điều: courseId không rỗng. KHÔNG kiểm khoá có
// tồn tại trong published_courses hay không, và đó là cố ý — cùng lập luận
// khiến cột là text chứ không phải khoá ngoại (migration 0011): một khoá gỡ
// xuất bản rồi đăng lại phải tìm thấy người đọc cũ, nên tồn tại-lúc-ghi-danh
// không phải điều kiện đúng để kiểm.
func (uc *Usecase) CreateEnrollment(ctx context.Context, userID uuid.UUID, courseID string) error {
	if courseID == "" {
		return ErrEmptyCourseID
	}
	return uc.repo.CreateEnrollment(ctx, userID, courseID)
}

func (uc *Usecase) DeleteEnrollment(ctx context.Context, userID uuid.UUID, courseID string) error {
	if courseID == "" {
		return ErrEmptyCourseID
	}
	return uc.repo.DeleteEnrollment(ctx, userID, courseID)
}
```

- [ ] **Step 7: Thêm handler**

Cuối `apps/api/internal/userdata/handler.go`:

```go
type enrollmentItem struct {
	CourseID  string `json:"courseId"`
	CreatedAt string `json:"createdAt"`
}

// Object có khoá, không phải mảng trần — cùng hình dạng listProgressResponse
// và listAnnotationsResponse. api/client.ts phía web mặc định TỪ CHỐI một thân
// 2xx parse ra mảng, và chỉ mở ngoại lệ cho đúng một lời gọi; đi mảng trần ở
// đây là buộc phải mở thêm một ngoại lệ nữa mà không có lý do gì.
type listEnrollmentsResponse struct {
	Enrollments []enrollmentItem `json:"enrollments"`
}

type createEnrollmentRequest struct {
	CourseID string `json:"courseId"`
}

// ListEnrollments handles GET /enrollments. Mounted behind auth.Require, so
// auth.UID(c) is always populated by the time this runs.
func (h *Handler) ListEnrollments(c *fiber.Ctx) error {
	rows, err := h.uc.ListEnrollments(c.Context(), auth.UID(c))
	if err != nil {
		apilog.Internal(c, "userdata.ListEnrollments", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "list enrollments failed"})
	}

	// make(..., len) chứ không phải slice nil: encoding/json biến nil thành
	// null, và một client gọi .map() trên null sẽ ném lỗi. Cùng lý do,
	// cùng cách viết, như ListProgress ở trên.
	resp := listEnrollmentsResponse{Enrollments: make([]enrollmentItem, len(rows))}
	for i, e := range rows {
		resp.Enrollments[i] = enrollmentItem{
			CourseID:  e.CourseID,
			CreatedAt: e.CreatedAt.UTC().Format(timeLayout),
		}
	}
	return c.Status(fiber.StatusOK).JSON(resp)
}

// CreateEnrollment handles POST /enrollments {"courseId":"c"} -> 201, no body.
//
// 201 on the second identical call too: the repo's ON CONFLICT DO NOTHING
// makes this idempotent, and a caller who pressed a button twice has the
// result they wanted either way. Distinguishing "created" from "already
// there" would hand the UI a difference it has no use for.
func (h *Handler) CreateEnrollment(c *fiber.Ctx) error {
	var req createEnrollmentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	err := h.uc.CreateEnrollment(c.Context(), auth.UID(c), req.CourseID)
	if errors.Is(err, ErrEmptyCourseID) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "courseId must not be empty"})
	}
	if err != nil {
		apilog.Internal(c, "userdata.CreateEnrollment", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "create enrollment failed"})
	}
	return c.SendStatus(fiber.StatusCreated)
}

// DeleteEnrollment handles DELETE /enrollments/:courseId -> 204, no body.
// 204 even when nothing was there to delete: see Repo.DeleteEnrollment's own
// comment for why there is no 404 to give here.
func (h *Handler) DeleteEnrollment(c *fiber.Ctx) error {
	err := h.uc.DeleteEnrollment(c.Context(), auth.UID(c), c.Params("courseId"))
	if errors.Is(err, ErrEmptyCourseID) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "courseId must not be empty"})
	}
	if err != nil {
		apilog.Internal(c, "userdata.DeleteEnrollment", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "delete enrollment failed"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}
```

- [ ] **Step 8: Gắn route**

`apps/api/internal/server/server.go`, ngay sau dòng `app.Put("/progress", ...)`:

```go
	// Enrollment routes. "Khoá nào là CỦA người này" — câu hỏi mà danh mục
	// công khai (GET /courses) không trả lời được và không nên trả lời.
	//
	// bodyLimit chỉ bọc POST. GET và DELETE không mang thân, nên một giới
	// hạn đặt lên chúng là một dòng không bao giờ chạy được — cùng lập luận
	// đã ghi ở GET /progress ngay trên.
	app.Get("/enrollments", auth.Require(deps.Pool), userdataHandler.ListEnrollments)
	app.Post("/enrollments", bodyLimit(userdata.MaxWriteBytes), auth.Require(deps.Pool), userdataHandler.CreateEnrollment)
	app.Delete("/enrollments/:courseId", auth.Require(deps.Pool), userdataHandler.DeleteEnrollment)
```

- [ ] **Step 9: Chạy test cho tới khi XANH**

Run: `cd apps/api && go test ./internal/userdata/ -v`
Expected: PASS, kể cả các bài `/progress` và `/annotations` cũ.

Rồi chạy cả gói API: `cd apps/api && go test ./...` — Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/migrations/0011_enrollments.up.sql apps/api/migrations/0011_enrollments.down.sql apps/api/internal/userdata/ apps/api/internal/server/server.go
git commit -m "Ghi danh: bảng enrollments và ba route, tách khoá của tôi khỏi danh mục chung"
```

---

### Task 2: Client phía web cho `/enrollments`

**Files:**
- Create: `apps/web/src/api/enrollments.ts`
- Create: `apps/web/src/api/enrollments.test.ts`

**Interfaces:**
- Consumes: `api` và `RequestOptions` từ `./client`; ba route của Task 1.
- Produces, cho Task 3–6:
  - `interface Enrollment { courseId: string; createdAt: string }`
  - `enrollmentsQueryKey(): readonly ['enrollments']`
  - `assertEnrollments(body: unknown): Enrollment[]`
  - `fetchEnrollments(options?: RequestOptions): Promise<Enrollment[]>`
  - `createEnrollment(courseId: string, options?: RequestOptions): Promise<void>`
  - `deleteEnrollment(courseId: string, options?: RequestOptions): Promise<void>`
  - `class MalformedEnrollmentsError extends Error { readonly missing: readonly string[] }`

- [ ] **Step 1: Viết test đỏ trước**

`apps/web/src/api/enrollments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MalformedEnrollmentsError, assertEnrollments } from './enrollments';

describe('assertEnrollments', () => {
  it('nhận danh sách rỗng — người chưa ghi danh khoá nào là hợp lệ, không phải hỏng', () => {
    expect(assertEnrollments({ enrollments: [] })).toEqual([]);
  });

  it('nhận hàng đủ trường', () => {
    const body = { enrollments: [{ courseId: 'khoa-a', createdAt: '2026-09-03T00:00:00Z' }] };
    expect(assertEnrollments(body)).toEqual(body.enrollments);
  });

  it('từ chối mảng trần — máy chủ trả object có khoá', () => {
    expect(() => assertEnrollments([{ courseId: 'khoa-a', createdAt: 'x' }])).toThrow(
      MalformedEnrollmentsError,
    );
  });

  it('từ chối null, thứ mà một slice nil của Go sẽ tạo ra', () => {
    expect(() => assertEnrollments({ enrollments: null })).toThrow(MalformedEnrollmentsError);
  });

  it('nêu ĐÍCH DANH trường sai, không chỉ nói "hỏng"', () => {
    try {
      assertEnrollments({ enrollments: [{ courseId: 42, createdAt: '2026-09-03T00:00:00Z' }] });
      expect.unreachable('phải ném');
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedEnrollmentsError);
      expect((err as MalformedEnrollmentsError).missing).toEqual(['[0].courseId']);
    }
  });
});
```

- [ ] **Step 2: Chạy cho chắc nó ĐỎ**

Run: `cd apps/web && bun run test -- src/api/enrollments.test.ts`
Expected: FAIL — không resolve được `./enrollments`.

- [ ] **Step 3: Viết module**

`apps/web/src/api/enrollments.ts`:

```ts
/**
 * Client của `GET/POST/DELETE /enrollments` —
 * `apps/api/internal/userdata/handler.go`'s `enrollmentItem` và
 * `createEnrollmentRequest`, từng trường một.
 *
 * ```
 * GET    /enrollments             -> 200 {"enrollments":[{courseId,createdAt}]}
 * POST   /enrollments             -> 201 no body   body: {courseId}
 * DELETE /enrollments/:courseId   -> 204 no body
 * ```
 *
 * Đây là nguồn trả lời câu "khoá nào là CỦA người này", tách hẳn khỏi
 * `api/catalog.ts` vốn trả lời "khoá nào có trên hệ thống". Trước module này
 * `pages/Dashboard.tsx` dùng câu thứ hai để trả lời câu thứ nhất — xem
 * `docs/superpowers/specs/2026-09-03-ghi-danh-khoa-hoc-design.md` §1.
 *
 * `createdAt` do MÁY CHỦ đóng dấu, nên không hàm nào ở đây nhận nó vào.
 */

import { api, type RequestOptions } from './client';

export interface Enrollment {
  courseId: string;
  createdAt: string;
}

/**
 * Khoá cache TanStack Query. Không tham số nào để biến thiên: `GET
 * /enrollments` luôn trả mọi ghi danh của người đang đăng nhập trong một lần,
 * nên chỉ có đúng một mục cache — cùng lập luận như `progressQueryKey`.
 */
export function enrollmentsQueryKey(): readonly ['enrollments'] {
  return ['enrollments'] as const;
}

/** Một 200 parse được nhưng không phải `{enrollments: Enrollment[]}`. Cùng
 *  hàng rào, cùng lý do, như `MalformedProgressError`: `api.get<T>` đặt tên
 *  cho một kiểu mà không gì trên đường truyền buộc phải tôn trọng. Chặn ở
 *  BIÊN, để mọi chỗ đọc sau này thừa hưởng thay vì tự suy lại ở từng `.map`. */
export class MalformedEnrollmentsError extends Error {
  // Khai tường minh: `erasableSyntaxOnly` cấm tham số-thuộc tính (TS1294).
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    // Tiếng Anh KỸ THUẬT, có chủ ý — câu cho người học thuộc về nơi vẽ lỗi.
    super(`/enrollments response missing or mistyped at: ${missing.join(', ')}`);
    this.name = 'MalformedEnrollmentsError';
    this.missing = missing;
  }
}

/** Mảng `enrollments` RỖNG là câu trả lời hợp lệ — một người chưa ghi danh
 *  khoá nào — không phải một thân hỏng. */
export function assertEnrollments(body: unknown): Enrollment[] {
  const rows = (body as { enrollments?: unknown } | null)?.enrollments;
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !Array.isArray(rows)) {
    throw new MalformedEnrollmentsError(['(response body is not {enrollments: [...]})']);
  }

  const missing: string[] = [];
  const out: Enrollment[] = [];

  rows.forEach((row: unknown, i) => {
    if (typeof row !== 'object' || row === null) {
      missing.push(`[${i}] (not an object)`);
      return;
    }
    const o = row as Partial<Record<keyof Enrollment, unknown>>;
    if (typeof o.courseId !== 'string') missing.push(`[${i}].courseId`);
    if (typeof o.createdAt !== 'string') missing.push(`[${i}].createdAt`);
    out.push(row as Enrollment);
  });

  if (missing.length > 0) throw new MalformedEnrollmentsError(missing);
  return out;
}

export async function fetchEnrollments(options: RequestOptions = {}): Promise<Enrollment[]> {
  return assertEnrollments(await api.get<unknown>('/enrollments', options));
}

/** Idempotent: máy chủ dùng `ON CONFLICT DO NOTHING`, nên gọi lại không tạo
 *  hàng thứ hai và KHÔNG dời `createdAt`. Một cú bấm đúp không phải sự kiện
 *  thứ hai. */
export async function createEnrollment(courseId: string, options: RequestOptions = {}): Promise<void> {
  await api.post('/enrollments', { courseId }, options);
}

/** Idempotent như trên: xoá thứ chưa ghi danh cũng trả 204. Chỉ gỡ khỏi danh
 *  sách — tiến độ và ghi chú của khoá ấy KHÔNG bị đụng tới (server-side, xem
 *  `Repo.DeleteEnrollment`). */
export async function deleteEnrollment(courseId: string, options: RequestOptions = {}): Promise<void> {
  await api.delete(`/enrollments/${encodeURIComponent(courseId)}`, options);
}
```

**Trước khi chạy:** mở `apps/web/src/api/client.ts` và xác nhận `api` có sẵn
`post` và `delete` với đúng chữ ký kế hoạch này dùng. Nếu tên khác, dùng tên
thật; đừng thêm phương thức mới vào `client.ts` trong việc này.

- [ ] **Step 4: Chạy cho tới khi XANH**

Run: `cd apps/web && bun run test -- src/api/enrollments.test.ts`
Expected: PASS, 5 bài.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/enrollments.ts apps/web/src/api/enrollments.test.ts
git commit -m "Client /enrollments: nguồn trả lời \"khoá nào là của tôi\", tách khỏi danh mục"
```

---

### Task 3: Học tiếp — cắt đường rò từ danh mục

Việc này SỬA ĐÚNG lỗi chủ sản phẩm báo, và không thêm giao diện nào. Tách khỏi
Task 4 vì một người soát có thể duyệt việc này mà từ chối cách bày danh sách,
và ngược lại.

**Files:**
- Modify: `apps/web/src/pages/Dashboard.tsx` (xoá `fallbackCourseIds`, đổi nguồn, sửa `settled`)
- Modify: `apps/web/src/progress/recent.ts` (chỉ sửa chú thích của `pickFocusCourse`)
- Modify: `apps/web/src/pages/Dashboard.test.tsx` (thêm bài canh)

**Interfaces:**
- Consumes: `fetchEnrollments`, `enrollmentsQueryKey` (Task 2).
- Produces: không có API mới. Task 4 dựng tiếp trên cùng `useQuery` này.

- [ ] **Step 1: Viết bài canh ĐỎ trước — chính là lỗi đã báo**

Thêm vào `apps/web/src/pages/Dashboard.test.tsx`. Dùng đúng cách dựng
`renderWithProviders`/MSW mà các bài sẵn có trong tệp đang dùng:

```tsx
it('danh mục có khoá nhưng người dùng chưa ghi danh ⇒ KHÔNG mượn khoá nào', async () => {
  // Đây là lỗi mà chủ sản phẩm báo, viết thành thứ chạy được: trước khi có
  // enrollments, fallbackCourseIds() hợp danh mục công khai rồi lấy phần tử
  // đầu theo bảng chữ cái, nên màn này hiện một khoá người dùng chưa từng mở.
  server.use(
    http.get('*/courses', () => HttpResponse.json([
      { slug: 'aaa-khoa-dau-bang-chu-cai', title: 'Khoá A', lang: 'vi', description: '', version: 1 },
      { slug: 'zzz-khoa-cuoi', title: 'Khoá Z', lang: 'vi', description: '', version: 1 },
    ])),
    http.get('*/enrollments', () => HttpResponse.json({ enrollments: [] })),
    http.get('*/progress', () => HttpResponse.json({ progress: [] })),
  );

  renderWithProviders(<Dashboard />);

  // Trạng thái rỗng, không phải một khoá mượn từ danh mục.
  expect(await screen.findByText(/chưa có khoá nào|mở danh mục/i)).toBeInTheDocument();
  expect(screen.queryByText('Khoá A')).not.toBeInTheDocument();
  expect(screen.queryByText('Khoá Z')).not.toBeInTheDocument();
});
```

**Trước khi chạy:** mở `Dashboard.test.tsx`, dùng đúng tên helper dựng và đúng
chuỗi mà `<EmptyHome>` thật sự vẽ ra (tra khoá i18n của nó trong `vi.ts`) thay
cho biểu thức chính quy phỏng đoán ở trên.

- [ ] **Step 2: Chạy cho chắc nó ĐỎ**

Run: `cd apps/web && bun run test -- src/pages/Dashboard.test.tsx`
Expected: FAIL — màn hiện "Khoá A", vì `fallbackCourseIds` vẫn còn.

- [ ] **Step 3: Xoá đường rò**

Trong `apps/web/src/pages/Dashboard.tsx`:

1. **Xoá trọn hàm `fallbackCourseIds`** cùng khối chú thích của nó. Xoá chứ
   không sửa: tên hàm hứa "tập dự phòng lấy từ danh mục", và mọi bản sửa đều để
   lại một cái tên đã thôi đúng.
2. Xoá import `catalogQueryKey, fetchCatalog` nếu không còn chỗ dùng.
3. Thay khối nguồn dữ liệu:

```tsx
  const enrollmentsQuery = useQuery({
    queryKey: enrollmentsQueryKey(),
    queryFn: () => fetchEnrollments(),
    retry: false,
  });
  const statsQuery = useStats();
  const lastStudied = useLastStudiedCourseId();

  // Chỉ khoá ĐÃ GHI DANH mới được vào đây. Trước đây tham số này là hợp của
  // danh mục công khai với stats.courses[] — tức là mọi khoá trên hệ thống —
  // nên một tài khoản chưa mở gì vẫn có "khoá đang dở".
  const enrolledIds = useMemo(
    () => (enrollmentsQuery.data ?? []).map((e) => e.courseId),
    [enrollmentsQuery.data],
  );
  const focusCourseId = pickFocusCourse(enrolledIds, lastStudied.courseId);

  const settled = !enrollmentsQuery.isPending && !statsQuery.isPending && lastStudied.settled;
```

4. Thêm import: `import { useMemo } from 'react';` và
   `import { enrollmentsQueryKey, fetchEnrollments } from '../api/enrollments';`

- [ ] **Step 4: Sửa chú thích của `pickFocusCourse`**

Trong `apps/web/src/progress/recent.ts`, đoạn chú thích hiện viết *"`courseIds`
giờ do chỗ gọi tự hợp từ bất kỳ nguồn nào nó cho là hợp lý làm gợi ý
(`pages/Dashboard.tsx` hợp danh mục công khai với `stats.courses[]`)"*. Câu ấy
mô tả đúng thứ vừa bị xoá. Thay bằng:

```
 * `courseIds` là danh sách khoá NGƯỜI NÀY ĐÃ GHI DANH (`GET /enrollments`),
 * không phải danh mục công khai. Bản trước của chú thích này nói chỗ gọi được
 * hợp "bất kỳ nguồn nào nó cho là hợp lý", và `pages/Dashboard.tsx` đã hợp
 * danh mục chung vào — nên mọi tài khoản đều có một "khoá đang dở" chưa từng
 * mở. Hàm này vẫn không cần biết khoá đến từ đâu; điều đổi là chỗ gọi không
 * còn được phép đưa vào đây thứ không thuộc về người dùng.
```

Chữ ký hàm KHÔNG đổi — nó vẫn thuần và vẫn nhận `readonly string[]`.

- [ ] **Step 5: Chạy cho tới khi XANH**

Run: `cd apps/web && bun run test -- src/pages/Dashboard.test.tsx`
Expected: PASS. Bài cũ nào giả lập danh mục để dựng "khoá đang dở" sẽ đỏ — sửa
chúng thành giả lập `/enrollments`, và ghi trong commit rằng chúng đổi vì
nguồn đổi, không phải vì hành vi đúng đã đổi.

Rồi `cd apps/web && bunx tsc -b && bun run test` — Expected: toàn bộ PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/Dashboard.tsx apps/web/src/pages/Dashboard.test.tsx apps/web/src/progress/recent.ts
git commit -m "Học tiếp không mượn khoá từ danh mục chung nữa"
```

---

### Task 4: Học tiếp — danh sách "Khoá của tôi"

**Files:**
- Modify: `apps/web/src/pages/Dashboard.tsx`
- Modify: `apps/web/src/styles/home.css`
- Modify: `packages/i18n/src/messages/vi.ts`, `packages/i18n/src/messages/en.ts`
- Modify: `apps/web/src/pages/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `enrollmentsQuery.data` (Task 3), `loadManifest`/`manifestQueryKey`, `useProgress`, `flatChapters`.
- Produces: không có API mới.

- [ ] **Step 1: Thêm khoá i18n vào CẢ HAI catalog**

`packages/i18n/src/messages/vi.ts`, cạnh cụm `home.*`:

```ts
  'home.myCourses': 'Khoá của tôi',
  'home.myCoursesEmpty': 'Bạn chưa ghi danh khoá nào.',
```

`packages/i18n/src/messages/en.ts`, cùng vị trí tương ứng:

```ts
  'home.myCourses': 'My courses',
  'home.myCoursesEmpty': 'You have not started any course yet.',
```

Thiếu một bên là lỗi biên dịch TypeScript — kiểu của catalog thứ hai được suy
từ catalog thứ nhất.

- [ ] **Step 2: Viết test đỏ**

```tsx
it('mỗi khoá đã ghi danh có một dòng, kèm số chương đã đọc', async () => {
  server.use(
    http.get('*/enrollments', () => HttpResponse.json({
      enrollments: [
        { courseId: 'khoa-a', createdAt: '2026-09-02T00:00:00Z' },
        { courseId: 'khoa-b', createdAt: '2026-09-01T00:00:00Z' },
      ],
    })),
    http.get('*/progress', () => HttpResponse.json({ progress: [] })),
  );

  renderWithProviders(<Dashboard />);

  expect(await screen.findByText('Khoá của tôi')).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: /khoa-a/i })).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: /khoa-b/i })).toBeInTheDocument();
});
```

**Trước khi chạy:** giả lập cả `GET /courses/:slug` cho hai slug ấy theo đúng
cách các bài sẵn có trong tệp giả lập manifest, để tên khoá hiện ra thay vì
slug.

- [ ] **Step 3: Chạy cho chắc nó ĐỎ**

Run: `cd apps/web && bun run test -- src/pages/Dashboard.test.tsx`
Expected: FAIL — không tìm thấy "Khoá của tôi".

- [ ] **Step 4: Dựng khối**

Trong `apps/web/src/pages/Dashboard.tsx`, thêm dưới `<Continue>` trong
`.doc-main`:

```tsx
{enrolledIds.length > 0 && <MyCourses courseIds={enrolledIds} focusCourseId={focusCourseId} />}
```

và component, đặt cạnh `Continue`:

```tsx
/**
 * "KHOÁ CỦA TÔI" — một dòng cho mỗi khoá đã ghi danh.
 *
 * MỘT DÒNG, không phải một thẻ, và KHÔNG phải mục lục. Đặc tả IA của trang này
 * chỉ cho phép MỘT hành động; khối trên đã dùng hết suất ấy. Khối này trả lời
 * một câu khác — "tôi còn khoá nào nữa" — nên nó phải nhỏ hơn hành động kia
 * một bậc rõ rệt, bằng không cái dài hơn sẽ thắng cái quan trọng hơn (cùng lỗi
 * đã đuổi bảng số liệu và mục lục 44 chương ra khỏi trang này).
 *
 * Khoá đang là tiêu điểm bị BỎ QUA: nó vừa được nói bằng cỡ chữ lớn nhất
 * trang, in lại tên nó ngay dưới là nói hai lần.
 */
function MyCourses({ courseIds, focusCourseId }: { courseIds: readonly string[]; focusCourseId: string | undefined }) {
  const { t } = useLanguage();
  const rest = courseIds.filter((id) => id !== focusCourseId);
  if (rest.length === 0) return null;

  return (
    <section className="mine">
      <h2 className="mine-title">{t('home.myCourses')}</h2>
      <ul className="mine-list">
        {rest.map((id) => (
          <MyCourseRow key={id} courseId={id} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Một dòng. Manifest tra không được thì dòng ấy BIẾN MẤT, không hiện lỗi: một
 * ghi danh trỏ tới khoá đã gỡ xuất bản là trạng thái hợp lệ (migration 0011
 * cố ý không có khoá ngoại), và một dòng đỏ ở đây chỉ nói với người đọc một
 * chuyện họ không làm gì được.
 */
function MyCourseRow({ courseId }: { courseId: string }) {
  const { t } = useLanguage();
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId),
    queryFn: () => loadManifest(courseId),
    retry: false,
  });
  const { rows } = useProgress(courseId);

  const manifest = manifestQuery.data;
  if (manifest === undefined) return null;

  const chapters = flatChapters(manifest);
  const read = rows.filter((r) => r.done).length;

  return (
    <li className="mine-row">
      <Link to={`/c/${courseId}`} className="mine-link">
        {manifest.title}
      </Link>
      <span className="mine-meta">{t('home.chapters', String(read), String(chapters.length))}</span>
    </li>
  );
}
```

**Trước khi chạy:** xác nhận chữ ký thật của `useProgress(courseId)`,
`flatChapters(manifest)` và `manifestQueryKey(courseId)` trong
`apps/web/src/progress/useProgress.ts`, `course/chapters.ts`, `course/loader.ts`.
Dùng đúng tên và đúng hình dạng trả về; đừng suy diễn từ kế hoạch này.

- [ ] **Step 5: Gỡ mục lục đầy đủ khỏi trang này**

Spec §4 nói mục lục 44 chương rời khỏi Học tiếp về `/c/:slug`. Đây là bước làm
điều đó; không có nó thì trang vẫn đổ trọn mục lục dưới danh sách vừa thêm, và
khối "Khoá của tôi" bị đẩy xuống dưới bốn mươi bốn dòng — tức là không ai thấy.

Trong `apps/web/src/pages/Dashboard.tsx`:

1. Xoá `<Toc courseId={courseId} manifest={manifest} doneChapterIds={doneChapterIds} … />`
   khỏi chỗ nó được vẽ trong `Continue` (dòng ~210).
2. Xoá trọn component `Toc` (dòng ~224 tới hết) và mọi hàm phụ chỉ nó dùng.
3. Xoá kiểu `.toc-*` khỏi `apps/web/src/styles/home.css`.
4. Sửa chú thích đầu tệp `Dashboard.tsx`: đoạn *"rồi mục lục của khoá ấy với
   dấu đã đọc từng chương"* và danh sách lớp `.toc-*` đều mô tả thứ vừa bị xoá.
   Thay bằng: *"rồi danh sách khoá đã ghi danh, mỗi khoá một dòng. Mục lục đầy
   đủ ở `/c/:slug`, không ở đây: trang này chỉ được có MỘT hành động, và bốn
   mươi bốn dòng mục lục dưới một hành động là để cái dài hơn thắng cái quan
   trọng hơn."*
5. Giữ `flatChapters` — nó vẫn được dùng để đếm `n/m chương`. Nếu `nextChapter`
   thành không ai dùng thì xoá khỏi import; nếu vẫn dùng thì giữ.

**Trước khi xoá:** mở `Dashboard.test.tsx` và tìm mọi bài khẳng định về mục
lục. Chúng sẽ đỏ, và đó là đúng — sửa hoặc xoá chúng, và nói rõ trong commit
rằng chúng đổi vì mục lục đã dời chỗ, không phải vì hành vi đúng đã đổi.

- [ ] **Step 6: Thêm kiểu vào `home.css`**

```css
/* KHỐI "KHOÁ CỦA TÔI". Nhỏ hơn hành động phía trên đúng một bậc, và cùng ngôn
   ngữ với phần còn lại của trang: gạch chân mảnh, không thẻ, không bóng. */
.mine {
  margin-top: 44px;
}

.mine-title {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin: 0 0 10px;
}

.mine-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.mine-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
  border-top: 1px solid var(--rule);
}

.mine-link {
  font-family: var(--font-serif);
  font-size: 17px;
  color: var(--ink);
}

.mine-meta {
  font-family: var(--font-sans);
  font-size: 12.5px;
  color: var(--ink-3);
  white-space: nowrap;
}
```

- [ ] **Step 7: Chạy cho tới khi XANH**

Run: `cd apps/web && bunx tsc -b && bun run test`
Expected: toàn bộ PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/Dashboard.tsx apps/web/src/pages/Dashboard.test.tsx apps/web/src/styles/home.css packages/i18n/src/messages/vi.ts packages/i18n/src/messages/en.ts
git commit -m "Học tiếp: thêm danh sách khoá của tôi dưới một hành động duy nhất"
```

---

### Task 5: Trang khoá — "Bắt đầu học" và "Bỏ khỏi khoá của tôi"

**Files:**
- Modify: `apps/web/src/pages/CourseHome.tsx:105-130`
- Modify: `apps/web/src/styles/courses.css`
- Modify: `packages/i18n/src/messages/{vi,en}.ts`
- Modify: `apps/web/src/pages/CourseHome.test.tsx`

**Interfaces:**
- Consumes: `createEnrollment`, `deleteEnrollment`, `fetchEnrollments`, `enrollmentsQueryKey` (Task 2); `useMutation`, `useQueryClient`.
- Produces: không có API mới.

- [ ] **Step 1: Thêm khoá i18n vào CẢ HAI catalog**

`vi.ts`:

```ts
  'course.enroll': 'Bắt đầu học',
  'course.unenroll': 'Bỏ khỏi khoá của tôi',
  'course.enrolling': 'Đang thêm…',
```

`en.ts`:

```ts
  'course.enroll': 'Start this course',
  'course.unenroll': 'Remove from my courses',
  'course.enrolling': 'Adding…',
```

- [ ] **Step 2: Viết test đỏ**

```tsx
it('chưa ghi danh ⇒ hiện "Bắt đầu học"; bấm xong thì hiện lối bỏ ghi danh', async () => {
  const posted: unknown[] = [];
  server.use(
    http.get('*/enrollments', () => HttpResponse.json({ enrollments: [] })),
    http.post('*/enrollments', async ({ request }) => {
      posted.push(await request.json());
      return new HttpResponse(null, { status: 201 });
    }),
  );

  renderWithProviders(<CourseHome />, { route: '/c/khoa-a' });

  const btn = await screen.findByRole('button', { name: 'Bắt đầu học' });
  await userEvent.click(btn);

  expect(posted).toEqual([{ courseId: 'khoa-a' }]);
});
```

**Trước khi chạy:** dùng đúng cách `CourseHome.test.tsx` hiện dựng route và giả
lập manifest.

- [ ] **Step 3: Chạy cho chắc nó ĐỎ**

Run: `cd apps/web && bun run test -- src/pages/CourseHome.test.tsx`
Expected: FAIL — không có nút nào tên "Bắt đầu học".

- [ ] **Step 4: Dựng**

Trong `CourseHome.tsx`, thêm cạnh `<Link className="btn primary">` trong
`.ch-resume-row`:

```tsx
const queryClient = useQueryClient();
const enrollmentsQuery = useQuery({
  queryKey: enrollmentsQueryKey(),
  queryFn: () => fetchEnrollments(),
  retry: false,
});
const enrolled = (enrollmentsQuery.data ?? []).some((e) => e.courseId === courseId);

const enroll = useMutation({
  mutationFn: () => createEnrollment(courseId),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: enrollmentsQueryKey() }),
});
const unenroll = useMutation({
  mutationFn: () => deleteEnrollment(courseId),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: enrollmentsQueryKey() }),
});
```

và trong JSX, ngay sau `<Link ... className="btn primary">`:

```tsx
{!enrolled && (
  <button
    type="button"
    className="btn primary"
    disabled={enroll.isPending}
    onClick={() => enroll.mutate()}
  >
    {t(enroll.isPending ? 'course.enrolling' : 'course.enroll')}
  </button>
)}
{enrolled && (
  /* KHÔNG hộp xác nhận. Thao tác này chỉ xoá một hàng trong `enrollments`;
     tiến độ và ghi chú còn nguyên (Repo.DeleteEnrollment), và ghi danh lại
     khôi phục đúng trạng thái cũ. Một hộp xác nhận cho một việc hoàn tác
     được chỉ dạy người dùng bấm qua mọi hộp xác nhận. */
  <button
    type="button"
    className="ch-unenroll"
    disabled={unenroll.isPending}
    onClick={() => unenroll.mutate()}
  >
    {t('course.unenroll')}
  </button>
)}
```

`courses.css`:

```css
/* Lối bỏ ghi danh: một liên kết mảnh, KHÔNG phải nút. Nó không được cạnh
   tranh với hành động chính ngay bên cạnh — người vào trang này để đọc, không
   phải để dọn danh sách. */
.ch-unenroll {
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-sans);
  font-size: 12.5px;
  color: var(--ink-3);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.ch-unenroll:hover {
  color: var(--accent);
}
```

- [ ] **Step 5: Chạy cho tới khi XANH**

Run: `cd apps/web && bunx tsc -b && bun run test`
Expected: toàn bộ PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/CourseHome.tsx apps/web/src/pages/CourseHome.test.tsx apps/web/src/styles/courses.css packages/i18n/src/messages/vi.ts packages/i18n/src/messages/en.ts
git commit -m "Trang khoá: ghi danh tường minh bằng một nút, bỏ ghi danh không hỏi lại"
```

---

### Task 6: Trang đọc — lối ghi danh cho người vào thẳng

**Files:**
- Modify: `apps/web/src/pages/Reader.tsx`
- Modify: `apps/web/src/styles/reader-layout.css`
- Modify: `packages/i18n/src/messages/{vi,en}.ts`
- Modify: `apps/web/src/pages/Reader.test.tsx` (tạo nếu chưa có)

**Interfaces:**
- Consumes: `createEnrollment`, `fetchEnrollments`, `enrollmentsQueryKey` (Task 2).
- Produces: không có API mới. Đây là việc cuối.

- [ ] **Step 1: Thêm khoá i18n vào CẢ HAI catalog**

`vi.ts`: `'reader.addToMine': 'Thêm vào khoá của tôi',`
`en.ts`: `'reader.addToMine': 'Add to my courses',`

- [ ] **Step 2: Viết test đỏ**

```tsx
it('đọc khoá chưa ghi danh ⇒ hiện lối thêm vào khoá của tôi', async () => {
  server.use(http.get('*/enrollments', () => HttpResponse.json({ enrollments: [] })));
  renderWithProviders(<Reader />, { route: '/c/khoa-a/c1' });
  expect(await screen.findByRole('button', { name: 'Thêm vào khoá của tôi' })).toBeInTheDocument();
});

it('đã ghi danh ⇒ KHÔNG hiện lối ấy, vì nó không còn nghĩa gì', async () => {
  server.use(http.get('*/enrollments', () =>
    HttpResponse.json({ enrollments: [{ courseId: 'khoa-a', createdAt: '2026-09-03T00:00:00Z' }] })));
  renderWithProviders(<Reader />, { route: '/c/khoa-a/c1' });
  await screen.findByRole('article');
  expect(screen.queryByRole('button', { name: 'Thêm vào khoá của tôi' })).not.toBeInTheDocument();
});
```

**Trước khi chạy:** mở `Reader.tsx` để tìm đúng chỗ dòng *"Đăng nhập để lưu
tiến độ, ghi chú và hỏi AI"* được vẽ, và dùng đúng vai (`role`) mà bài thứ hai
chờ đợi.

- [ ] **Step 3: Chạy cho chắc nó ĐỎ**

Run: `cd apps/web && bun run test -- src/pages/Reader.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Dựng, TRONG VỎ APP**

Đặt dòng mới ở đúng chỗ dòng "Đăng nhập để lưu tiến độ…" đang nằm — tức trong
`Reader.tsx`, **không** trong `packages/course-kit/`.

Khai báo trước, trong thân component (Task 5 khai những thứ này trong
`CourseHome`, và mỗi tệp cần bản của riêng nó — không có gì dùng chung giữa hai
màn ngoài chính ba hàm của `api/enrollments.ts`):

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createEnrollment, enrollmentsQueryKey, fetchEnrollments } from '../api/enrollments';
import { useMe } from '../api/useMe';

// …trong thân component, `courseId` lấy từ useParams như phần còn lại của tệp:
const me = useMe();
const queryClient = useQueryClient();
const enrollmentsQuery = useQuery({
  queryKey: enrollmentsQueryKey(),
  queryFn: () => fetchEnrollments(),
  retry: false,
});
const enrolled = (enrollmentsQuery.data ?? []).some((e) => e.courseId === courseId);
const enroll = useMutation({
  mutationFn: () => createEnrollment(courseId),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: enrollmentsQueryKey() }),
});
```

Rồi dòng, chỉ hiện khi đã đăng nhập (khách chưa đăng nhập đã có dòng riêng của
họ, và hai lời mời chồng nhau là một lời mời bị bỏ qua) và chưa ghi danh:

```tsx
{me.data !== undefined && !enrolled && (
  <p className="rd-addmine">
    <button type="button" className="rd-addmine-btn" onClick={() => enroll.mutate()}>
      {t('reader.addToMine')}
    </button>
  </p>
)}
```

- [ ] **Step 5: Chạy cho tới khi XANH, và kiểm ràng buộc cứng**

Run: `cd apps/web && bunx tsc -b && bun run test` — Expected: toàn bộ PASS.
Run: `git diff --stat packages/course-kit/` — Expected: **không in ra gì**.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/Reader.tsx apps/web/src/pages/Reader.test.tsx apps/web/src/styles/reader-layout.css packages/i18n/src/messages/vi.ts packages/i18n/src/messages/en.ts
git commit -m "Trang đọc: lối ghi danh cho người vào thẳng, đặt trong vỏ app"
```

---

## Kiểm cuối, sau Task 6

- [ ] `cd apps/api && go test ./...` — PASS
- [ ] `cd apps/web && bunx tsc -b && bun run test` — PASS
- [ ] `git diff packages/course-kit/` — rỗng
- [ ] `cd apps/web && bun run build` — exit 0
- [ ] Chạy tay: tài khoản mới ⇒ Học tiếp trống dù danh mục có khoá; bấm "Bắt đầu học" ⇒ khoá hiện ra; bỏ ghi danh ⇒ khoá rời danh sách nhưng `/progress` vẫn còn tiến độ
