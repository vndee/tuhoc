package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/store"
)

// I4 — before this, all eleven of the API's 500-response sites discarded
// their error. The repo layer builds richly wrapped causes ("sync: upsert
// progress (course=%s chapter=%s status=%s): %w") that were constructed
// and then dropped at the handler boundary, so the only production signal
// that /sync was failing was a 500 in the access log with no reason
// attached. `recover.New()` likewise ran with default config, so a panic
// produced no stack trace either.
//
// These tests assert BOTH halves of that fix at once, because they are in
// tension and getting either one wrong is a real defect:
//
//   - the log must gain the wrapped cause, and
//   - the RESPONSE BODY must stay exactly as generic as it was. The bodies
//     deliberately leak nothing; "add observability" must not become "leak
//     the schema to any client that can provoke a 500."
//
// How the failures are induced: dropping individual tables out from under
// a live app, rather than closing the pool. Closing the pool breaks
// auth.Require first, so every downstream handler 500s before it is ever
// reached — dropping one table at a time is what makes each individual
// call site attributable.

// slogCapture swaps the process-wide default logger (what apilog writes
// through) for one that appends to a buffer, and restores the original
// when the test ends.
type slogCapture struct {
	buf *bytes.Buffer
}

func captureSlog(t *testing.T) *slogCapture {
	t.Helper()
	buf := &bytes.Buffer{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return &slogCapture{buf: buf}
}

// take returns everything logged since the last call to take, and resets
// the buffer, so each assertion below reasons only about its own request.
func (c *slogCapture) take() string {
	out := c.buf.String()
	c.buf.Reset()
	return out
}

func doTestRequest(t *testing.T, app *fiber.App, method, path string, body any, cookie *http.Cookie) (*http.Response, string) {
	t.Helper()

	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
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
	resp, err := app.Test(req, 10000)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read %s %s body: %v", method, path, err)
	}
	return resp, string(raw)
}

func dropTable(t *testing.T, pool *pgxpool.Pool, table string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), "DROP TABLE "+table+" CASCADE"); err != nil {
		t.Fatalf("drop table %s: %v", table, err)
	}
}

// assert500LoggedAndOpaque is the shared shape of every case below: the
// response is a 500 carrying exactly `wantBody` and nothing else, while
// the log line names the call site (`wantOp`) and carries the wrapped
// cause (`wantCause`) the response deliberately withholds.
func assert500LoggedAndOpaque(t *testing.T, label string, resp *http.Response, body, logged, wantOp, wantCause, wantBody string) {
	t.Helper()

	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("%s: want 500 got %d body=%s", label, resp.StatusCode, body)
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		t.Fatalf("%s: 500 body is not JSON: %q", label, body)
	}
	if got, _ := parsed["error"].(string); got != wantBody {
		t.Fatalf("%s: 500 body must stay exactly %q, got %q — the response must not gain detail just because the log did", label, wantBody, got)
	}
	if len(parsed) != 1 {
		t.Fatalf("%s: 500 body must carry only {\"error\": ...}, got %v", label, parsed)
	}
	// The generic body must not have started echoing the cause. Checked
	// against the cause the log DOES carry, so this can never pass just
	// because the cause happened to be empty.
	if strings.Contains(body, wantCause) {
		t.Fatalf("%s: 500 body leaked the internal cause %q: %s", label, wantCause, body)
	}

	if !strings.Contains(logged, wantOp) {
		t.Fatalf("%s: log does not name the call site (%q). Logged:\n%s", label, wantOp, logged)
	}
	if !strings.Contains(logged, wantCause) {
		t.Fatalf("%s: log does not carry the wrapped cause (%q) — this is the detail the response deliberately withholds, so the server has to keep it. Logged:\n%s", label, wantCause, logged)
	}
}

func TestInternalServerErrorsAreLoggedWithTheirWrappedCause(t *testing.T) {
	pool := store.TestPool(t)
	app := New(config.Config{CookieSecure: false}, Deps{Pool: pool, LogOutput: io.Discard})
	logs := captureSlog(t)

	// A real, valid session first — so that every 500 below is
	// attributable to the table we drop, not to a broken cookie.
	regResp, regBody := doTestRequest(t, app, http.MethodPost, "/auth/register",
		map[string]string{"email": "observability@example.test", "password": "observability-password-1", "name": "Obs"}, nil)
	if regResp.StatusCode != http.StatusOK {
		t.Fatalf("register: want 200 got %d body=%s", regResp.StatusCode, regBody)
	}
	var cookie *http.Cookie
	for _, c := range regResp.Cookies() {
		if c.Name == "tuhoc_session" {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatalf("register: no session cookie in %v", regResp.Cookies())
	}
	logs.take()

	progressItem := map[string]any{
		"courseId":  "c1",
		"chapterId": "ch1",
		"status":    "read",
		"done":      true,
		"updatedAt": "2026-08-20T10:00:00Z",
	}

	// --- progress gone: sync.Push, sync.Pull, and the THIRD of Stats'
	// three repo calls (CompletedChaptersByCourse), which is the only one
	// of the three that reads `progress`.
	dropTable(t, pool, "progress")

	resp, body := doTestRequest(t, app, http.MethodPost, "/sync",
		map[string]any{"progress": []any{progressItem}, "annotations": []any{}}, cookie)
	assert500LoggedAndOpaque(t, "POST /sync", resp, body, logs.take(),
		"sync.Push", "sync: upsert progress (course=", "sync push failed")

	resp, body = doTestRequest(t, app, http.MethodGet, "/sync", nil, cookie)
	assert500LoggedAndOpaque(t, "GET /sync", resp, body, logs.take(),
		"sync.Pull", "sync: pull progress", "sync pull failed")

	resp, body = doTestRequest(t, app, http.MethodGet, "/stats", nil, cookie)
	assert500LoggedAndOpaque(t, "GET /stats (completed chapters)", resp, body, logs.take(),
		"stats.Stats/CompletedChaptersByCourse", "stats: completed chapters by course", "stats failed")

	// --- events gone: stats.EventsBatch, and now the FIRST of Stats'
	// three repo calls. (The middle one, HeartbeatCourseCounts, reads the
	// same `events` table as the first, so no single-table drop can reach
	// it while the first still succeeds — it is the one site of the eleven
	// this test cannot isolate, which is noted rather than papered over.)
	dropTable(t, pool, "events")

	resp, body = doTestRequest(t, app, http.MethodPost, "/events/batch",
		map[string]any{"events": []any{map[string]any{"courseId": "c1", "chapterId": "ch1", "kind": "heartbeat", "at": "2026-08-20T10:00:00Z"}}}, cookie)
	assert500LoggedAndOpaque(t, "POST /events/batch", resp, body, logs.take(),
		"stats.EventsBatch", "stats: insert event (course=", "events batch failed")

	resp, body = doTestRequest(t, app, http.MethodGet, "/stats", nil, cookie)
	assert500LoggedAndOpaque(t, "GET /stats (day counts)", resp, body, logs.take(),
		"stats.Stats/HeartbeatDayCounts", "stats: heartbeat day counts", "stats failed")

	// --- users gone, sessions intact: auth.Me, auth.Register, auth.Login.
	// `FindValidSession` reads only `sessions`, so auth.Require keeps
	// working here and /me reaches its own handler.
	dropTable(t, pool, "users")

	resp, body = doTestRequest(t, app, http.MethodGet, "/me", nil, cookie)
	assert500LoggedAndOpaque(t, "GET /me", resp, body, logs.take(),
		"auth.Me", "auth: find user by id", "failed to load user")

	resp, body = doTestRequest(t, app, http.MethodPost, "/auth/register",
		map[string]string{"email": "obs2@example.test", "password": "observability-password-2", "name": "Obs2"}, nil)
	assert500LoggedAndOpaque(t, "POST /auth/register", resp, body, logs.take(),
		"auth.Register", "auth: create user", "registration failed")

	resp, body = doTestRequest(t, app, http.MethodPost, "/auth/login",
		map[string]string{"email": "observability@example.test", "password": "observability-password-1"}, nil)
	assert500LoggedAndOpaque(t, "POST /auth/login", resp, body, logs.take(),
		"auth.Login", "auth: find user by email", "login failed")

	// --- sessions gone: auth.Logout, then auth.Require itself (which must
	// still answer 500, never the 401 it gives a merely-unknown session).
	dropTable(t, pool, "sessions")

	resp, body = doTestRequest(t, app, http.MethodPost, "/auth/logout", nil, cookie)
	assert500LoggedAndOpaque(t, "POST /auth/logout", resp, body, logs.take(),
		"auth.Logout", "auth: delete session", "logout failed")

	resp, body = doTestRequest(t, app, http.MethodGet, "/me", nil, cookie)
	assert500LoggedAndOpaque(t, "GET /me (session validation)", resp, body, logs.take(),
		"auth.Require", "auth: find valid session", "session validation failed")
}

// A panic in a handler already became a 500 without this fix; what the
// stock `recover.New()` threw away was the only thing that makes such a
// 500 actionable — where it came from.
//
// Induced with a nil pool, which needs no container: every DB-backed route
// is wired unconditionally in New (deps.Pool may legitimately be nil when
// DATABASE_URL is unset — /healthz must keep working — see main.go), so
// the first pgxpool call on a nil pool panics inside auth.Require.
func TestRecoveredPanicIsLoggedWithAStackTrace(t *testing.T) {
	app := New(config.Config{}, Deps{LogOutput: io.Discard})
	logs := captureSlog(t)

	resp, body := doTestRequest(t, app, http.MethodGet, "/me", nil,
		&http.Cookie{Name: "tuhoc_session", Value: "3f2504e0-4f89-41d3-9a0c-0305e82c3301"})

	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("a panicking handler must still answer 500, got %d body=%s", resp.StatusCode, body)
	}

	logged := logs.take()
	if !strings.Contains(logged, "panic recovered") {
		t.Fatalf("a recovered panic was not logged at all. Logged:\n%s", logged)
	}
	// The stack itself, not merely the panic value: "the recover
	// middleware ran" was already true before this fix.
	if !strings.Contains(logged, "stack=") || !strings.Contains(logged, "goroutine ") {
		t.Fatalf("a recovered panic was logged without a stack trace — the one thing that makes it actionable. Logged:\n%s", logged)
	}
	if !strings.Contains(logged, "tuhoc-api/internal/auth") {
		t.Fatalf("the stack trace does not reach the faulting package, so it cannot locate the panic. Logged:\n%s", logged)
	}
}
