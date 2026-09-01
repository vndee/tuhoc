// Package userdata_test exercises the userdata package end to end, through
// internal/server.New — the same wiring the web client will depend on —
// against a real Postgres via store.TestPool. It is an external test
// package (userdata_test, not userdata) specifically so it can import
// server (which imports userdata) without a cycle, mirroring
// internal/sync/sync_test.go's own approach (see that file's package doc
// comment for the fuller reasoning; nothing here needs to import stdlib
// "sync" either, so there is no collision to speak of).
package userdata_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/server"
	"github.com/vndee/tuhoc-api/internal/store"
)

const testTimeoutMS = 10000

const sessionCookieName = "tuhoc_session"

func newTestApp(pool *pgxpool.Pool) *fiber.App {
	return server.New(config.Config{CookieSecure: false}, server.Deps{Pool: pool, LogOutput: io.Discard})
}

func uniqueEmail(label string) string {
	return fmt.Sprintf("userdata-%s-%s@example.test", label, uuid.NewString())
}

// --- generic HTTP helpers, matching internal/sync/sync_test.go's doRequest
// pattern (itself matching auth_test.go's own doJSON pattern) ---

func doRequest(t *testing.T, app *fiber.App, method, path string, body any, cookie *http.Cookie) (*http.Response, []byte) {
	t.Helper()

	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		reader = bytes.NewReader(b)
	}

	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}

	resp, err := app.Test(req, testTimeoutMS)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("%s %s: read body: %v", method, path, err)
	}
	resp.Body.Close()

	return resp, raw
}

func sessionCookie(resp *http.Response) *http.Cookie {
	for _, c := range resp.Cookies() {
		if c.Name == sessionCookieName {
			return c
		}
	}
	return nil
}

type apiUser struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

// registerUser creates a fresh account and returns its session cookie.
// Each test gets its own user(s) so tests never contend over the same
// rows — mirrors sync_test.go's registerUser.
func registerUser(t *testing.T, app *fiber.App, label string) *http.Cookie {
	t.Helper()
	email := uniqueEmail(label)
	resp, raw := doRequest(t, app, http.MethodPost, "/auth/register",
		map[string]string{"email": email, "password": "userdata-test-password-1", "name": label}, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("register %s: want 200 got %d body=%s", label, resp.StatusCode, raw)
	}
	var u apiUser
	if err := json.Unmarshal(raw, &u); err != nil {
		t.Fatalf("register %s: unmarshal: %v", label, err)
	}
	cookie := sessionCookie(resp)
	if cookie == nil {
		t.Fatalf("register %s: no session cookie", label)
	}
	return cookie
}

// --- request/response shapes mirroring handler.go's JSON contract ---

type progressOut struct {
	CourseID  string `json:"courseId"`
	ChapterID string `json:"chapterId"`
	Status    string `json:"status"`
	Done      bool   `json:"done"`
	UpdatedAt string `json:"updatedAt"`
}

type listProgressOut struct {
	Progress []progressOut `json:"progress"`
}

// --- /progress-specific helpers ---

// putProgress sends PUT /progress with the given raw JSON body and asserts
// the response status is wantStatus.
func putProgress(t *testing.T, app *fiber.App, cookie *http.Cookie, rawBody string, wantStatus int) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/progress", bytes.NewReader([]byte(rawBody)))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := app.Test(req, testTimeoutMS)
	if err != nil {
		t.Fatalf("PUT /progress: %v", err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("PUT /progress: read body: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != wantStatus {
		t.Fatalf("PUT /progress: want %d got %d body=%s", wantStatus, resp.StatusCode, raw)
	}
}

// getProgress calls GET /progress, asserts 200, and returns the parsed
// rows.
func getProgress(t *testing.T, app *fiber.App, cookie *http.Cookie) []progressOut {
	t.Helper()
	resp, raw := doRequest(t, app, http.MethodGet, "/progress", nil, cookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /progress: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var out listProgressOut
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal %s: %v", raw, err)
	}
	return out.Progress
}

// mustParseTime parses a wire-format (RFC3339Nano) timestamp, failing the
// test on a malformed one rather than letting a bad response silently
// compare as the time.Time zero value.
func mustParseTime(t *testing.T, s string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t.Fatalf("parse time %q: %v", s, err)
	}
	return parsed
}

// Client KHÔNG gửi updatedAt. Đó là khác biệt lớn nhất so với POST /sync,
// nơi mỗi hàng mang updatedAt của chính nó vì hàng có thể đã nằm hàng đợi
// nhiều ngày. Không còn hàng đợi thì "lúc nào" là lúc server nhận — và để
// client tự khai lại là mở đúng cửa cho một máy lệch giờ ghi đè hàng mới hơn.
func TestPutProgressStampsServerTime(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie := registerUser(t, app, "stamp")

	before := time.Now().UTC()
	putProgress(t, app, cookie, `{"courseId":"c","chapterId":"c1","status":"read","done":true}`, http.StatusNoContent)

	rows := getProgress(t, app, cookie)
	if len(rows) != 1 {
		t.Fatalf("GET /progress = %d hàng, muốn 1", len(rows))
	}
	updatedAt := mustParseTime(t, rows[0].UpdatedAt)
	if updatedAt.Before(before) {
		t.Errorf("updatedAt = %v, sớm hơn lúc gửi request %v — server không tự đóng dấu", updatedAt, before)
	}
}

func TestPutProgressIsUpsertNotInsert(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie := registerUser(t, app, "upsert")

	putProgress(t, app, cookie, `{"courseId":"c","chapterId":"c1","status":"read","done":true}`, http.StatusNoContent)
	putProgress(t, app, cookie, `{"courseId":"c","chapterId":"c1","status":"read","done":false}`, http.StatusNoContent)

	rows := getProgress(t, app, cookie)
	if len(rows) != 1 {
		t.Fatalf("= %d hàng, muốn 1 (khoá chính là user+course+chapter+status)", len(rows))
	}
	if rows[0].Done {
		t.Errorf("done = true, muốn false — lần ghi thứ hai không thắng")
	}
}

func TestListProgressIsScopedToCaller(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	userA := registerUser(t, app, "scope-a")
	userB := registerUser(t, app, "scope-b")

	putProgress(t, app, userB, `{"courseId":"c","chapterId":"c1","status":"read","done":true}`, http.StatusNoContent)

	rows := getProgress(t, app, userA)
	if len(rows) != 0 {
		t.Fatalf("user A thấy %d hàng của user B", len(rows))
	}
}

func TestPutProgressRejectsEmptyIdentifiers(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie := registerUser(t, app, "empty")

	for _, body := range []string{
		`{"courseId":"","chapterId":"c1","status":"read","done":true}`,
		`{"courseId":"c","chapterId":"","status":"read","done":true}`,
		`{"courseId":"c","chapterId":"c1","status":"","done":true}`,
	} {
		putProgress(t, app, cookie, body, http.StatusBadRequest)
	}
	if rows := getProgress(t, app, cookie); len(rows) != 0 {
		t.Fatalf("400 vẫn ghi %d hàng", len(rows))
	}
}
