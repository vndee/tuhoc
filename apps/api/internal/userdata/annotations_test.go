// This file extends package userdata_test (see progress_test.go's own doc
// comment for the fuller reasoning on why this is an external test
// package) with the four /annotations verbs. It reuses progress_test.go's
// generic helpers (doRequest, registerUser, sessionCookie, uniqueEmail,
// newTestApp, apiUser, sessionCookieName, testTimeoutMS) rather than
// redefining them — both files share package userdata_test, so they are
// already in scope here.
package userdata_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/vndee/tuhoc-api/internal/store"
	"github.com/vndee/tuhoc-api/internal/userdata"
)

// --- response shapes mirroring handler.go's JSON contract ---

type annotationOut struct {
	ID        string          `json:"id"`
	CourseID  string          `json:"courseId"`
	ChapterID string          `json:"chapterId"`
	Anchor    json.RawMessage `json:"anchor"`
	Note      string          `json:"note"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
}

type listAnnotationsOut struct {
	Annotations []annotationOut `json:"annotations"`
}

// --- testEnv: a fluent wrapper around one fiber.App + "current user"
// cookie, so the test bodies below can read as a sequence of actions
// (post/patch/del/getAnnotations) instead of repeating doRequest/cookie
// plumbing at every call site. asUser swaps the acting identity without
// spinning up a second app/pool, which is what lets two users exercise
// ownership checks against the same rows. ---

type testEnv struct {
	app    *fiber.App
	cookie *http.Cookie
}

// newTestEnv spins up one store.TestPool-backed app and registers its
// default caller. Every subtest gets its own pool-backed app (store.
// TestPool itself shares one container across a test binary run, per its
// own doc comment), so annotation rows never leak across tests.
func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie := registerUser(t, app, "ann")
	return &testEnv{app: app, cookie: cookie}
}

func (e *testEnv) asUser(t *testing.T, cookie *http.Cookie) *testEnv {
	t.Helper()
	return &testEnv{app: e.app, cookie: cookie}
}

func (e *testEnv) doRaw(t *testing.T, method, path, rawBody string, wantStatus int) {
	t.Helper()
	var reader io.Reader
	if rawBody != "" {
		reader = bytes.NewReader([]byte(rawBody))
	}
	req := httptest.NewRequest(method, path, reader)
	if rawBody != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if e.cookie != nil {
		req.AddCookie(e.cookie)
	}
	resp, err := e.app.Test(req, testTimeoutMS)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("%s %s: read body: %v", method, path, err)
	}
	resp.Body.Close()
	if resp.StatusCode != wantStatus {
		t.Fatalf("%s %s: want %d got %d body=%s", method, path, wantStatus, resp.StatusCode, raw)
	}
	// 201/204 are this API's two documented "no body" success statuses for
	// every verb `doRaw` drives (see handler.go's own doc comments on
	// CreateAnnotation/PatchAnnotation/DeleteAnnotation) — asserted here,
	// not only by status code, because a status code alone missed a real
	// regression: `CreateAnnotation` used to end in `c.SendStatus(201)`,
	// which fiber fills with the literal text "Created" whenever nothing
	// else has written to the body first (201, unlike 204, is not a
	// status the HTTP spec forbids a body on, so nothing strips it before
	// the wire) — every annotation a reader ever created answered 201
	// with a non-empty, non-JSON body, and the web client's `NotJsonError`
	// guard (`api/client.ts`) correctly rejected it, rolling back the
	// optimistic paint and showing a false "could not save" toast for a
	// row that, underneath, had been written correctly. `doRaw`'s own
	// `resp.StatusCode != wantStatus` check could not see this — 201 was
	// still 201 — so a same-shape regression on PATCH/DELETE would have
	// been just as invisible without this line.
	if (wantStatus == http.StatusCreated || wantStatus == http.StatusNoContent) && len(raw) != 0 {
		t.Fatalf("%s %s: status %d must carry no body, got %d bytes: %q", method, path, wantStatus, len(raw), raw)
	}
}

func (e *testEnv) post(t *testing.T, path, rawBody string, wantStatus int) {
	t.Helper()
	e.doRaw(t, http.MethodPost, path, rawBody, wantStatus)
}

func (e *testEnv) patch(t *testing.T, path, rawBody string, wantStatus int) {
	t.Helper()
	e.doRaw(t, http.MethodPatch, path, rawBody, wantStatus)
}

func (e *testEnv) del(t *testing.T, path string, wantStatus int) {
	t.Helper()
	e.doRaw(t, http.MethodDelete, path, "", wantStatus)
}

// getAnnotations calls GET /annotations (course == "" means every course)
// or GET /annotations?course=<course>, asserts 200, and returns the
// parsed rows.
func (e *testEnv) getAnnotations(t *testing.T, course string) []annotationOut {
	t.Helper()
	path := "/annotations"
	if course != "" {
		path += "?course=" + course
	}
	resp, raw := doRequest(t, e.app, http.MethodGet, path, nil, e.cookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: want 200 got %d body=%s", path, resp.StatusCode, raw)
	}
	var out listAnnotationsOut
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal %s: %v", raw, err)
	}
	return out.Annotations
}

// --- task-2-brief.md Step 2: full lifecycle, create -> patch -> delete ->
// no longer visible. ---

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

// --- task-2-brief.md Step 3: PATCH/DELETE on someone else's row is 404,
// never 403, and never touches the data. ---

// 404 chứ không 403: trả 403 là xác nhận với người hỏi rằng id ấy TỒN TẠI
// và thuộc về ai đó. Với một uuid đoán được thì đó là rò rỉ; với một uuid
// không đoán được thì hai mã trạng thái ấy như nhau với người dùng thật.
func TestAnnotationWritesAreOwnerScoped(t *testing.T) {
	env := newTestEnv(t)
	userA := env.cookie
	userB := registerUser(t, env.app, "ann-owner-b")

	id := uuid.NewString()
	env.asUser(t, userB).post(t, "/annotations", `{"id":"`+id+`","courseId":"c","chapterId":"c1","anchor":{},"note":"riêng tư"}`, 201)

	env.asUser(t, userA).patch(t, "/annotations/"+id, `{"note":"đã bị sửa"}`, 404)
	env.asUser(t, userA).del(t, "/annotations/"+id, 404)

	if got := env.asUser(t, userB).getAnnotations(t, "")[0].Note; got != "riêng tư" {
		t.Fatalf("note của B = %q — A chạm được vào", got)
	}
}

// --- task-2-brief.md Step 4: ?course= filters; its absence returns every
// course. ---

func TestListAnnotationsCourseFilter(t *testing.T) {
	env := newTestEnv(t)
	idA := uuid.NewString()
	idB := uuid.NewString()
	env.post(t, "/annotations", `{"id":"`+idA+`","courseId":"course-a","chapterId":"c1","anchor":{},"note":"a"}`, 201)
	env.post(t, "/annotations", `{"id":"`+idB+`","courseId":"course-b","chapterId":"c1","anchor":{},"note":"b"}`, 201)

	filtered := env.getAnnotations(t, "course-a")
	if len(filtered) != 1 || filtered[0].Note != "a" {
		t.Fatalf("?course=course-a = %+v, muốn đúng 1 hàng của course-a", filtered)
	}

	all := env.getAnnotations(t, "")
	if len(all) != 2 {
		t.Fatalf("không ?course= = %d hàng, muốn 2 (mọi khoá)", len(all))
	}
}

// --- task-2-brief.md Step 5: POST with a duplicate client-generated id is
// 409, never a silent overwrite. ---

// id do client sinh, nên trùng là chuyện có thật (một retry sau khi
// response đầu bị mất). Ghi đè im lặng ở đây sẽ nuốt ghi chú của chính
// người dùng nếu hai tab cùng sinh trùng uuid; 409 để client biết mà đọc
// lại.
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

// --- code review fix: a POST missing `anchor` (absent key OR explicit
// null) must be a 400 from usecase validation, not a 500 from the
// annotations.anchor jsonb NOT NULL constraint failing at INSERT. `{}` is
// a syntactically valid anchor and must still be accepted — this package
// carries anchor opaquely by design (see repo.go's AnnotationRow doc
// comment) and has no business judging its shape beyond "present". ---

func TestCreateAnnotationRejectsMissingAnchor(t *testing.T) {
	env := newTestEnv(t)

	idAbsent := uuid.NewString()
	env.post(t, "/annotations", `{"id":"`+idAbsent+`","courseId":"c","chapterId":"c1","note":"x"}`, 400)

	idNull := uuid.NewString()
	env.post(t, "/annotations", `{"id":"`+idNull+`","courseId":"c","chapterId":"c1","anchor":null,"note":"x"}`, 400)

	if rows := env.getAnnotations(t, ""); len(rows) != 0 {
		t.Fatalf("400 vẫn ghi %d hàng — anchor thiếu hoặc null phải bị chặn trước khi chạm CSDL", len(rows))
	}
}

// --- final whole-branch review, Important 3: `note` had NO length bound of
// any kind. CreateAnnotation checked id/course/chapter/anchor for PRESENCE
// and PatchAnnotation validated nothing at all, so the only ceiling on a
// note was the HTTP body limit — which, until the same review, was the
// app-wide 21 MiB one meant for course packages. /annotations is not rate
// limited either, so "how much can one account write into this table" had
// no answer.
//
// The cap is in RUNES, not bytes (userdata.MaxNoteChars): this platform is
// bilingual, and a byte cap hands an English writer roughly three times the
// characters a Vietnamese writer gets for the same allowance — the same
// reasoning ai.MaxSystemPromptChars and ai's maxNotesToolOutputRunes each
// give for their own fields. ---

// overlongNote is one rune past the cap, built out of a MULTI-BYTE rune on
// purpose: with a byte-counting implementation this fixture is over the
// limit three times over, so a test built on it would pass against exactly
// the implementation this cap must not have. `đ` is 2 bytes in UTF-8.
func overlongNote() string {
	return strings.Repeat("đ", userdata.MaxNoteChars+1)
}

func TestCreateAnnotationRejectsOverlongNote(t *testing.T) {
	env := newTestEnv(t)

	env.post(t, "/annotations", `{"id":"`+uuid.NewString()+`","courseId":"c","chapterId":"c1","anchor":{},"note":"`+overlongNote()+`"}`, 400)

	if rows := env.getAnnotations(t, ""); len(rows) != 0 {
		t.Fatalf("400 vẫn ghi %d hàng — ghi chú quá dài phải bị chặn trước khi chạm CSDL", len(rows))
	}

	// Anti-vacuity, and the half that pins the cap as a CHARACTER count: a
	// note of exactly MaxNoteChars multi-byte runes (well over the cap in
	// bytes) is accepted.
	atCap := strings.Repeat("đ", userdata.MaxNoteChars)
	env.post(t, "/annotations", `{"id":"`+uuid.NewString()+`","courseId":"c","chapterId":"c1","anchor":{},"note":"`+atCap+`"}`, 201)
	rows := env.getAnnotations(t, "")
	if len(rows) != 1 || utf8.RuneCountInString(rows[0].Note) != userdata.MaxNoteChars {
		t.Fatalf("một ghi chú đúng bằng trần phải được nhận nguyên vẹn; nhận %d hàng", len(rows))
	}
}

func TestPatchAnnotationRejectsOverlongNote(t *testing.T) {
	env := newTestEnv(t)
	id := uuid.NewString()
	env.post(t, "/annotations", `{"id":"`+id+`","courseId":"c","chapterId":"c1","anchor":{},"note":"ngắn"}`, 201)

	env.patch(t, "/annotations/"+id, `{"note":"`+overlongNote()+`"}`, 400)

	// A refused PATCH must leave the row exactly as it was — a 400 that
	// still wrote would be worse than no validation at all.
	if got := env.getAnnotations(t, "")[0].Note; got != "ngắn" {
		t.Errorf("note = %q — PATCH bị từ chối vẫn ghi vào hàng", got)
	}

	// Anti-vacuity: the same PATCH one rune shorter lands.
	atCap := strings.Repeat("đ", userdata.MaxNoteChars)
	env.patch(t, "/annotations/"+id, `{"note":"`+atCap+`"}`, 204)
	if got := env.getAnnotations(t, "")[0].Note; utf8.RuneCountInString(got) != userdata.MaxNoteChars {
		t.Errorf("một PATCH đúng bằng trần phải được nhận: nhận %d ký tự", utf8.RuneCountInString(got))
	}
}
