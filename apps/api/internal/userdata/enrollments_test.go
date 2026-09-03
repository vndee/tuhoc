package userdata_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/vndee/tuhoc-api/internal/store"
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
	cookie := registerUser(t, app, "enroll-empty")

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
	cookie := registerUser(t, app, "enroll-twice")

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
	cookie := registerUser(t, app, "enroll-del")

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
	cookie := registerUser(t, app, "enroll-keeps")

	doRequest(t, app, http.MethodPost, "/enrollments",
		map[string]string{"courseId": "khoa-a"}, cookie)
	doRequest(t, app, http.MethodPut, "/progress", map[string]any{
		"courseId": "khoa-a", "chapterId": "c1", "status": "read", "done": true,
	}, cookie)
	doRequest(t, app, http.MethodPost, "/annotations", map[string]any{
		"id":       "3fa85f64-5717-4562-b3fc-2c963f66afa6",
		"courseId": "khoa-a", "chapterId": "c1",
		"anchor": json.RawMessage(`{"start":0,"end":5}`), "note": "ghi chu",
	}, cookie)

	res, _ := doRequest(t, app, http.MethodDelete, "/enrollments/khoa-a", nil, cookie)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE status = %d, want 204", res.StatusCode)
	}

	// The row itself must actually be gone — "chỉ rời danh sách" means the
	// enrollments row is the ONE thing this DELETE is allowed to remove.
	// Without this check, a Repo.DeleteEnrollment that silently did nothing
	// (wrong WHERE clause, or the statement body lost entirely) would still
	// pass every test in this file: the handler returns 204 regardless of
	// rows affected, and no other test re-queries /enrollments after a real
	// enrollment's DELETE.
	_, enrollBody := doRequest(t, app, http.MethodGet, "/enrollments", nil, cookie)
	if strings.Contains(string(enrollBody), "khoa-a") {
		t.Fatalf("enrollment still listed after DELETE: %s", enrollBody)
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
	cookieA := registerUser(t, app, "enroll-a")
	cookieB := registerUser(t, app, "enroll-b")

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
	cookie := registerUser(t, app, "enroll-empty-id")

	res, _ := doRequest(t, app, http.MethodPost, "/enrollments",
		map[string]string{"courseId": ""}, cookie)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", res.StatusCode)
	}
}

// TestDeleteEnrollmentDecodesPercentEncodedCourseID is the direct
// regression test for DeleteEnrollment's own doc comment (mirroring
// catalog's urlSlug / TestPublishSlugNeedingURLEncodingRoundTrips): fiber's
// UnescapePath is off (server.New's fiber.Config never sets it), so a
// courseId containing a character encodeURIComponent would escape — a "/",
// exactly the case apps/web/src/api/enrollments.ts sends — arrives at
// c.Params("courseId") still percent-encoded. POST stores the courseId from
// the JSON body (already decoded), so a DELETE that never decodes its own
// path segment looks for the wrong string and matches nothing: the row
// survives, the caller gets a 204 anyway (idempotent-delete's "already
// gone" shape, indistinguishable from "actually deleted"), and the web UI
// is left showing a course as still enrolled after "Bỏ khỏi khoá của tôi".
func TestDeleteEnrollmentDecodesPercentEncodedCourseID(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie := registerUser(t, app, "enroll-slash")

	courseID := "khoa/a"
	res, body := doRequest(t, app, http.MethodPost, "/enrollments",
		map[string]string{"courseId": courseID}, cookie)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("POST status = %d, want 201; body = %s", res.StatusCode, body)
	}

	res, body = doRequest(t, app, http.MethodDelete, "/enrollments/"+url.PathEscape(courseID), nil, cookie)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE status = %d, want 204; body = %s", res.StatusCode, body)
	}

	_, listBody := doRequest(t, app, http.MethodGet, "/enrollments", nil, cookie)
	if strings.Contains(string(listBody), courseID) {
		t.Fatalf("enrollment %q still listed after DELETE with a percent-encoded path: %s", courseID, listBody)
	}
}
