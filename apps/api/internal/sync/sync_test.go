// Package sync_test exercises the sync package end to end, through
// internal/server.New — the same wiring the web client (a later task) will
// depend on — against a real Postgres via store.TestPool. It is an
// external test package (sync_test, not sync) specifically so it can
// import server (which imports sync) without a cycle, mirroring
// internal/auth/auth_test.go's own approach.
//
// Package-name note: this file lives in package "sync_test", which does
// NOT collide with the standard library's "sync" package — nothing here
// needs to import stdlib "sync" at all, but if it did, there would be no
// conflict, since this file's own package name is "sync_test", not
// "sync". This file does import internal/sync itself (aliased "appsync",
// matching server.go's own convention) purely to reference
// appsync.SyncSafetyLag by name rather than duplicating its value as a
// magic number — that alias is the real (and only) collision-avoidance
// mechanism in this package; see internal/server/server.go for the fuller
// reasoning.
package sync_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/server"
	"github.com/vndee/tuhoc-api/internal/store"
	appsync "github.com/vndee/tuhoc-api/internal/sync"
)

const testTimeoutMS = 10000

const sessionCookieName = "tuhoc_session"

func newTestApp(pool *pgxpool.Pool) *fiber.App {
	return server.New(config.Config{CookieSecure: false}, server.Deps{Pool: pool, LogOutput: io.Discard})
}

func uniqueEmail(label string) string {
	return fmt.Sprintf("sync-%s-%s@example.test", label, uuid.NewString())
}

// nowUTC returns the current time in UTC, truncated to microsecond
// precision. Postgres timestamptz only stores microsecond precision (any
// finer nanosecond component from time.Now() is truncated on write), so
// tests that later assert exact equality against a round-tripped timestamp
// must truncate on the way in too, or they'd be comparing a nanosecond-
// precision Go value against a microsecond-precision stored-and-reread
// value and flake on the rare tick that has a nonzero sub-microsecond
// component.
func nowUTC() time.Time {
	return time.Now().UTC().Truncate(time.Microsecond)
}

// --- request/response shapes mirroring handler.go's JSON contracts ---

type progressOut struct {
	CourseID  string `json:"courseId"`
	ChapterID string `json:"chapterId"`
	Status    string `json:"status"`
	Done      bool   `json:"done"`
	UpdatedAt string `json:"updatedAt"`
}

type annotationOut struct {
	ID        string          `json:"id"`
	CourseID  string          `json:"courseId"`
	ChapterID string          `json:"chapterId"`
	Anchor    json.RawMessage `json:"anchor"`
	Note      string          `json:"note"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
	DeletedAt *string         `json:"deletedAt"`
}

type pullOut struct {
	Progress    []progressOut   `json:"progress"`
	Annotations []annotationOut `json:"annotations"`
	Cursor      string          `json:"cursor"`
}

type pushOut struct {
	Applied int `json:"applied"`
}

type apiUser struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

// --- generic HTTP helpers, matching auth_test.go's doJSON pattern ---

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

// registerUser creates a fresh account and returns its session cookie and
// user id. Each subtest gets its own user(s) so subtests never contend
// over the same rows.
func registerUser(t *testing.T, app *fiber.App, label string) (*http.Cookie, string) {
	t.Helper()
	email := uniqueEmail(label)
	resp, raw := doRequest(t, app, http.MethodPost, "/auth/register",
		map[string]string{"email": email, "password": "sync-test-password-1", "name": label}, nil)
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
	return cookie, u.ID
}

// --- push body builders ---

func progressPushItem(courseID, chapterID, status string, done bool, updatedAt time.Time) map[string]any {
	return map[string]any{
		"courseId":  courseID,
		"chapterId": chapterID,
		"status":    status,
		"done":      done,
		"updatedAt": updatedAt.Format(time.RFC3339Nano),
	}
}

func annotationPushItem(id uuid.UUID, courseID, chapterID string, anchor map[string]any, note string, createdAt, updatedAt time.Time, deletedAt *time.Time) map[string]any {
	m := map[string]any{
		"id":        id.String(),
		"courseId":  courseID,
		"chapterId": chapterID,
		"anchor":    anchor,
		"note":      note,
		"createdAt": createdAt.Format(time.RFC3339Nano),
		"updatedAt": updatedAt.Format(time.RFC3339Nano),
	}
	if deletedAt != nil {
		m["deletedAt"] = deletedAt.Format(time.RFC3339Nano)
	} else {
		m["deletedAt"] = nil
	}
	return m
}

func pushBody(progress []map[string]any, annotations []map[string]any) map[string]any {
	if progress == nil {
		progress = []map[string]any{}
	}
	if annotations == nil {
		annotations = []map[string]any{}
	}
	return map[string]any{"progress": progress, "annotations": annotations}
}

// TestSyncFlows covers the three cases the task brief names — (a) a
// strictly older write must not overwrite a newer one, (b) two-device
// convergence, (c) another user's annotations must never leak through
// GET — plus the additional cases this task's own instructions call out:
// user isolation for progress (not just annotations), tombstone/done=false
// propagation, idempotent batch replay, cursor semantics, timezone/
// precision handling, atomic batch rejection, and the 401 case for both
// routes. All subtests share one store.TestPool container (each gets its
// own fiber.App instance and its own user(s)) to keep the container-spin-
// up cost to once per run, exactly like auth_test.go.
func TestSyncFlows(t *testing.T) {
	pool := store.TestPool(t)

	t.Run("push newer then older keeps newer", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "older")

		tNew := nowUTC()
		tOld := tNew.Add(-1 * time.Hour)

		respA, rawA := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("c1", "ch1", "read", true, tNew)}, nil), cookie)
		if respA.StatusCode != http.StatusOK {
			t.Fatalf("push A (newer): want 200 got %d body=%s", respA.StatusCode, rawA)
		}
		var outA pushOut
		mustUnmarshal(t, rawA, &outA)
		if outA.Applied != 1 {
			t.Fatalf("push A (newer, fresh insert): want applied=1 got %d", outA.Applied)
		}

		respB, rawB := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("c1", "ch1", "read", false, tOld)}, nil), cookie)
		if respB.StatusCode != http.StatusOK {
			t.Fatalf("push B (older): want 200 got %d body=%s", respB.StatusCode, rawB)
		}
		var outB pushOut
		mustUnmarshal(t, rawB, &outB)
		if outB.Applied != 0 {
			t.Fatalf("push B (older, must lose LWW): want applied=0 got %d", outB.Applied)
		}

		getResp, getRaw := doRequest(t, app, http.MethodGet, "/sync", nil, cookie)
		if getResp.StatusCode != http.StatusOK {
			t.Fatalf("get: want 200 got %d body=%s", getResp.StatusCode, getRaw)
		}
		var pull pullOut
		mustUnmarshal(t, getRaw, &pull)
		if len(pull.Progress) != 1 {
			t.Fatalf("want 1 progress row, got %d: %+v", len(pull.Progress), pull.Progress)
		}
		if !pull.Progress[0].Done {
			t.Fatalf("want done=true (A kept), got done=false (B's older write leaked through)")
		}
	})

	// This is the task's real acceptance criterion. It is deliberately
	// written so that the *push order* is the reverse of the *timestamp
	// order*: device2's newer value (y) is pushed to the server FIRST,
	// and device1's older value (x) is pushed SECOND — simulating x
	// arriving late (network delay / retry) after y already landed. A
	// naive "last write wins by execution order" implementation (i.e. the
	// SQL upsert with its WHERE EXCLUDED.updated_at > ... guard simply
	// deleted) would let x's later-executed-but-earlier-timestamped push
	// clobber y, because it runs last. Only the timestamp guard prevents
	// that. See this task's report for the manual verification (guard
	// temporarily removed, test re-run, confirmed failing) that this test
	// genuinely depends on it.
	t.Run("two-device convergence depends on the LWW guard, not push order", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "convergence")

		tNewer := nowUTC()
		tOlder := tNewer.Add(-2 * time.Hour)

		// Device 2 pushes y (the newer state, done=true) first.
		respY, rawY := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("c1", "convergence", "read", true, tNewer)}, nil), cookie)
		if respY.StatusCode != http.StatusOK {
			t.Fatalf("device2 push y: want 200 got %d body=%s", respY.StatusCode, rawY)
		}

		// Device 1 pushes x (the older state, done=false) second — later
		// in wall-clock request order, but strictly older in updated_at.
		respX, rawX := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("c1", "convergence", "read", false, tOlder)}, nil), cookie)
		if respX.StatusCode != http.StatusOK {
			t.Fatalf("device1 push x: want 200 got %d body=%s", respX.StatusCode, rawX)
		}
		var outX pushOut
		mustUnmarshal(t, rawX, &outX)
		if outX.Applied != 0 {
			t.Fatalf("device1's older-but-later-arriving push must be rejected (applied=0), got applied=%d", outX.Applied)
		}

		// Both devices pull and must converge on y — never on x.
		for _, device := range []string{"device1", "device2"} {
			getResp, getRaw := doRequest(t, app, http.MethodGet, "/sync", nil, cookie)
			if getResp.StatusCode != http.StatusOK {
				t.Fatalf("%s get: want 200 got %d body=%s", device, getResp.StatusCode, getRaw)
			}
			var pull pullOut
			mustUnmarshal(t, getRaw, &pull)
			if len(pull.Progress) != 1 {
				t.Fatalf("%s: want 1 progress row, got %d", device, len(pull.Progress))
			}
			if !pull.Progress[0].Done {
				t.Fatalf("%s: converged value must be y (done=true), got done=false — the LWW guard did not hold", device)
			}
		}
	})

	t.Run("annotations from another user do not leak into GET /sync", func(t *testing.T) {
		app := newTestApp(pool)
		cookieA, _ := registerUser(t, app, "leak-a")
		cookieB, _ := registerUser(t, app, "leak-b")

		now := nowUTC()
		annID := uuid.New()
		resp, raw := doRequest(t, app, http.MethodPost, "/sync",
			pushBody(nil, []map[string]any{annotationPushItem(annID, "c1", "ch1", map[string]any{"pos": 1}, "hello", now, now, nil)}), cookieA)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("push annotation as user A: want 200 got %d body=%s", resp.StatusCode, raw)
		}

		getResp, getRaw := doRequest(t, app, http.MethodGet, "/sync", nil, cookieB)
		if getResp.StatusCode != http.StatusOK {
			t.Fatalf("get as user B: want 200 got %d", getResp.StatusCode)
		}
		var pull pullOut
		mustUnmarshal(t, getRaw, &pull)
		for _, a := range pull.Annotations {
			if a.ID == annID.String() {
				t.Fatalf("user B's GET /sync leaked user A's annotation %s", annID)
			}
		}
	})

	t.Run("a user cannot hijack another user's annotation by reusing its id", func(t *testing.T) {
		app := newTestApp(pool)
		cookieA, _ := registerUser(t, app, "own-a")
		cookieB, _ := registerUser(t, app, "own-b")

		tA := nowUTC()
		annID := uuid.New()
		respA, rawA := doRequest(t, app, http.MethodPost, "/sync",
			pushBody(nil, []map[string]any{annotationPushItem(annID, "c1", "ch1", map[string]any{"pos": 1}, "A's note", tA, tA, nil)}), cookieA)
		if respA.StatusCode != http.StatusOK {
			t.Fatalf("push as A: want 200 got %d body=%s", respA.StatusCode, rawA)
		}

		// B pushes the SAME id, with a much newer updated_at, trying to
		// hijack it.
		tB := tA.Add(1 * time.Hour)
		respB, rawB := doRequest(t, app, http.MethodPost, "/sync",
			pushBody(nil, []map[string]any{annotationPushItem(annID, "c1", "ch1", map[string]any{"pos": 99}, "B's hijack attempt", tB, tB, nil)}), cookieB)
		if respB.StatusCode != http.StatusOK {
			t.Fatalf("push as B: want 200 got %d body=%s", respB.StatusCode, rawB)
		}
		var outB pushOut
		mustUnmarshal(t, rawB, &outB)
		if outB.Applied != 0 {
			t.Fatalf("B's attempt to hijack A's annotation id must be rejected (applied=0), got applied=%d", outB.Applied)
		}

		getRespA, getRawA := doRequest(t, app, http.MethodGet, "/sync", nil, cookieA)
		if getRespA.StatusCode != http.StatusOK {
			t.Fatalf("get as A: want 200 got %d", getRespA.StatusCode)
		}
		var pullA pullOut
		mustUnmarshal(t, getRawA, &pullA)
		found := false
		for _, a := range pullA.Annotations {
			if a.ID == annID.String() {
				found = true
				if a.Note != "A's note" {
					t.Fatalf("A's annotation was overwritten by B: note=%q", a.Note)
				}
			}
		}
		if !found {
			t.Fatalf("A's annotation missing from A's own GET /sync")
		}

		getRespB, getRawB := doRequest(t, app, http.MethodGet, "/sync", nil, cookieB)
		if getRespB.StatusCode != http.StatusOK {
			t.Fatalf("get as B: want 200 got %d", getRespB.StatusCode)
		}
		var pullB pullOut
		mustUnmarshal(t, getRawB, &pullB)
		for _, a := range pullB.Annotations {
			if a.ID == annID.String() {
				t.Fatalf("B's GET /sync shows A's annotation id %s, which must never be visible to B", annID)
			}
		}
	})

	t.Run("progress rows are isolated per user even with identical course/chapter/status keys", func(t *testing.T) {
		app := newTestApp(pool)
		cookieA, _ := registerUser(t, app, "iso-a")
		cookieB, _ := registerUser(t, app, "iso-b")

		now := nowUTC()
		respA, rawA := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("shared-course", "shared-chapter", "read", true, now)}, nil), cookieA)
		if respA.StatusCode != http.StatusOK {
			t.Fatalf("push as A: want 200 got %d body=%s", respA.StatusCode, rawA)
		}
		respB, rawB := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("shared-course", "shared-chapter", "read", false, now.Add(time.Second))}, nil), cookieB)
		if respB.StatusCode != http.StatusOK {
			t.Fatalf("push as B: want 200 got %d body=%s", respB.StatusCode, rawB)
		}

		getA, rawGetA := doRequest(t, app, http.MethodGet, "/sync", nil, cookieA)
		if getA.StatusCode != http.StatusOK {
			t.Fatalf("get A: want 200 got %d", getA.StatusCode)
		}
		var pullA pullOut
		mustUnmarshal(t, rawGetA, &pullA)
		if len(pullA.Progress) != 1 || !pullA.Progress[0].Done {
			t.Fatalf("A's own progress must be unaffected by B's push to the same course/chapter/status key: %+v", pullA.Progress)
		}
	})

	t.Run("pull includes tombstoned annotations and done=false progress", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "tomb")

		now := nowUTC()
		annID := uuid.New()
		createResp, createRaw := doRequest(t, app, http.MethodPost, "/sync",
			pushBody(nil, []map[string]any{annotationPushItem(annID, "c1", "ch1", map[string]any{"pos": 1}, "note", now, now, nil)}), cookie)
		if createResp.StatusCode != http.StatusOK {
			t.Fatalf("create annotation: want 200 got %d body=%s", createResp.StatusCode, createRaw)
		}

		deletedAt := now.Add(time.Minute)
		delResp, delRaw := doRequest(t, app, http.MethodPost, "/sync",
			pushBody(nil, []map[string]any{annotationPushItem(annID, "c1", "ch1", map[string]any{"pos": 1}, "note", now, deletedAt, &deletedAt)}), cookie)
		if delResp.StatusCode != http.StatusOK {
			t.Fatalf("delete (tombstone) push: want 200 got %d body=%s", delResp.StatusCode, delRaw)
		}

		unmarkResp, unmarkRaw := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("c1", "ch2", "read", false, now)}, nil), cookie)
		if unmarkResp.StatusCode != http.StatusOK {
			t.Fatalf("push done=false progress: want 200 got %d body=%s", unmarkResp.StatusCode, unmarkRaw)
		}

		getResp, getRaw := doRequest(t, app, http.MethodGet, "/sync", nil, cookie)
		if getResp.StatusCode != http.StatusOK {
			t.Fatalf("get: want 200 got %d", getResp.StatusCode)
		}
		var pull pullOut
		mustUnmarshal(t, getRaw, &pull)

		gotTombstone := false
		for _, a := range pull.Annotations {
			if a.ID == annID.String() {
				if a.DeletedAt == nil {
					t.Fatalf("tombstone missing deletedAt in GET /sync response")
				}
				gotTombstone = true
			}
		}
		if !gotTombstone {
			t.Fatalf("tombstoned annotation missing entirely from GET /sync — deletions must propagate")
		}

		gotUnmarked := false
		for _, p := range pull.Progress {
			if p.ChapterID == "ch2" {
				if p.Done {
					t.Fatalf("want done=false for ch2, got true")
				}
				gotUnmarked = true
			}
		}
		if !gotUnmarked {
			t.Fatalf("done=false progress row missing entirely from GET /sync — unmarking must propagate")
		}
	})

	t.Run("replaying an identical batch is idempotent", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "idempotent")

		now := nowUTC()
		body := pushBody([]map[string]any{progressPushItem("c1", "idem", "read", true, now)}, nil)

		resp1, raw1 := doRequest(t, app, http.MethodPost, "/sync", body, cookie)
		if resp1.StatusCode != http.StatusOK {
			t.Fatalf("first push: want 200 got %d body=%s", resp1.StatusCode, raw1)
		}
		var out1 pushOut
		mustUnmarshal(t, raw1, &out1)
		if out1.Applied != 1 {
			t.Fatalf("first push: want applied=1 got %d", out1.Applied)
		}

		// Simulate a client retry after a dropped response: identical
		// body, same updated_at, sent again.
		resp2, raw2 := doRequest(t, app, http.MethodPost, "/sync", body, cookie)
		if resp2.StatusCode != http.StatusOK {
			t.Fatalf("retried push: want 200 got %d body=%s", resp2.StatusCode, raw2)
		}
		var out2 pushOut
		mustUnmarshal(t, raw2, &out2)
		if out2.Applied != 0 {
			t.Fatalf("retried identical push: want applied=0 (equal timestamp does not re-write) got %d", out2.Applied)
		}

		getResp, getRaw := doRequest(t, app, http.MethodGet, "/sync", nil, cookie)
		if getResp.StatusCode != http.StatusOK {
			t.Fatalf("get: want 200 got %d", getResp.StatusCode)
		}
		var pull pullOut
		mustUnmarshal(t, getRaw, &pull)
		if len(pull.Progress) != 1 {
			t.Fatalf("replay must not create a duplicate row: want 1 progress row got %d", len(pull.Progress))
		}
	})

	t.Run("cursor is safety-lagged behind max updated_at; echoes since when nothing changed", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "cursor")

		getResp0, getRaw0 := doRequest(t, app, http.MethodGet, "/sync", nil, cookie)
		if getResp0.StatusCode != http.StatusOK {
			t.Fatalf("get (empty account): want 200 got %d", getResp0.StatusCode)
		}
		var pull0 pullOut
		mustUnmarshal(t, getRaw0, &pull0)
		if pull0.Cursor != "" {
			t.Fatalf("empty account, since absent: want cursor=\"\" got %q", pull0.Cursor)
		}

		t1 := nowUTC()
		pushResp, pushRaw := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("c1", "cursor1", "read", true, t1)}, nil), cookie)
		if pushResp.StatusCode != http.StatusOK {
			t.Fatalf("push: want 200 got %d body=%s", pushResp.StatusCode, pushRaw)
		}

		getResp1, getRaw1 := doRequest(t, app, http.MethodGet, "/sync", nil, cookie)
		if getResp1.StatusCode != http.StatusOK {
			t.Fatalf("get (after push): want 200 got %d", getResp1.StatusCode)
		}
		var pull1 pullOut
		mustUnmarshal(t, getRaw1, &pull1)
		if pull1.Cursor == "" {
			t.Fatalf("want non-empty cursor after a push")
		}
		cursorTime, err := time.Parse(time.RFC3339Nano, pull1.Cursor)
		if err != nil {
			t.Fatalf("cursor not parseable as RFC3339Nano: %v", err)
		}
		// The cursor must trail t1 by exactly SyncSafetyLag, not equal it —
		// this is the fix's whole point: a raw max(updated_at) cursor is
		// unsafe (see the regression test right below this one).
		wantCursor := t1.Add(-appsync.SyncSafetyLag)
		if !cursorTime.Equal(wantCursor) {
			t.Fatalf("cursor: want t1-SyncSafetyLag=%v got %v", wantCursor, cursorTime)
		}
		if !cursorTime.Before(t1) {
			t.Fatalf("cursor must lag strictly behind t1, got cursor=%v t1=%v", cursorTime, t1)
		}

		// Poll again using the lagged cursor as since: t1 falls INSIDE the
		// trailing SyncSafetyLag window behind that cursor (by
		// construction — the cursor is t1-lag), so the row is deliberately
		// re-delivered. This is the intentional, harmless re-delivery
		// behavior the fix's doc comment calls out: a client re-applying
		// the same row under the same LWW rule is a no-op (see
		// TestSyncFlows/replaying_an_identical_batch_is_idempotent).
		nextURL := "/sync?" + url.Values{"since": {pull1.Cursor}}.Encode()
		getResp2, getRaw2 := doRequest(t, app, http.MethodGet, nextURL, nil, cookie)
		if getResp2.StatusCode != http.StatusOK {
			t.Fatalf("get with since=cursor: want 200 got %d body=%s", getResp2.StatusCode, getRaw2)
		}
		var pull2 pullOut
		mustUnmarshal(t, getRaw2, &pull2)
		if len(pull2.Progress) != 1 {
			t.Fatalf("polling again with since=<lagged cursor>: want the row re-delivered (still inside the lag window), got %d progress rows", len(pull2.Progress))
		}
		if pull2.Cursor != pull1.Cursor {
			t.Fatalf("polling again with the same data and no new writes: want cursor to stay put at %q, got %q", pull1.Cursor, pull2.Cursor)
		}

		// Poll with a since far beyond any row and beyond the lag window
		// entirely (simulating a client that has fully caught up): nothing
		// new is found, and the cursor is echoed back exactly as sent,
		// proving the "nothing changed -> unchanged, non-blank cursor"
		// property still holds under the new formula (the `since` floor).
		future := t1.Add(2 * appsync.SyncSafetyLag)
		futureURL := "/sync?" + url.Values{"since": {future.Format(time.RFC3339Nano)}}.Encode()
		getResp3, getRaw3 := doRequest(t, app, http.MethodGet, futureURL, nil, cookie)
		if getResp3.StatusCode != http.StatusOK {
			t.Fatalf("get with since=<far future>: want 200 got %d body=%s", getResp3.StatusCode, getRaw3)
		}
		var pull3 pullOut
		mustUnmarshal(t, getRaw3, &pull3)
		if len(pull3.Progress) != 0 || len(pull3.Annotations) != 0 {
			t.Fatalf("polling with since beyond every row: want empty result, got %+v", pull3)
		}
		cursor3, err := time.Parse(time.RFC3339Nano, pull3.Cursor)
		if err != nil {
			t.Fatalf("cursor not parseable as RFC3339Nano: %v", err)
		}
		if !cursor3.Equal(future) {
			t.Fatalf("polling with since beyond every row: want cursor echoed back as %v, got %v", future, cursor3)
		}
	})

	// This is the fix's real acceptance test — it reproduces the exact
	// commit-ordering race described in Usecase.Pull's doc comment and
	// proves the safety-lagged cursor closes it. It is deliberately
	// written so it would fail against the pre-fix cursor formula
	// (cursor = raw max(updated_at) of the returned rows): see this task's
	// report for the before/after run confirming that.
	t.Run("a late-committing row with an older updated_at survives the safety-lagged cursor", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "latecommit")

		// Step 1: device B pushes "now" and its transaction commits first.
		tB := nowUTC()
		respB, rawB := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("c1", "chB", "read", true, tB)}, nil), cookie)
		if respB.StatusCode != http.StatusOK {
			t.Fatalf("device B push: want 200 got %d body=%s", respB.StatusCode, rawB)
		}

		// Step 2: a poller captures the cursor right after B's row lands —
		// this models the poll that happens *between* device A's push
		// beginning and it committing.
		pollResp, pollRaw := doRequest(t, app, http.MethodGet, "/sync", nil, cookie)
		if pollResp.StatusCode != http.StatusOK {
			t.Fatalf("poll after B: want 200 got %d body=%s", pollResp.StatusCode, pollRaw)
		}
		var poll pullOut
		mustUnmarshal(t, pollRaw, &poll)
		if poll.Cursor == "" {
			t.Fatalf("want a non-empty cursor after B's push")
		}

		// Step 3: device A's push lands now, but carries an updated_at
		// strictly OLDER than B's — modeling a transaction that started
		// before B's but committed after this poll captured its cursor.
		// Critically, tA is older than the RAW max the poller already
		// observed (tB), which is exactly the scenario a naive
		// max(updated_at) cursor cannot handle.
		tA := tB.Add(-5 * time.Second)
		respA, rawA := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("c1", "chA", "read", true, tA)}, nil), cookie)
		if respA.StatusCode != http.StatusOK {
			t.Fatalf("device A push: want 200 got %d body=%s", respA.StatusCode, rawA)
		}
		var outA pushOut
		mustUnmarshal(t, rawA, &outA)
		if outA.Applied != 1 {
			t.Fatalf("device A's push is a fresh row (different chapter), not a conflict: want applied=1 got %d", outA.Applied)
		}

		// Step 4: resume from the cursor captured in step 2, BEFORE A
		// committed. A's row must still be visible: its updated_at
		// (tB-5s) is inside the trailing SyncSafetyLag window behind the
		// cursor (tB-lag, since B was the only row seen at that point), so
		// tA > cursor holds and the row is returned.
		resumeURL := "/sync?" + url.Values{"since": {poll.Cursor}}.Encode()
		resumeResp, resumeRaw := doRequest(t, app, http.MethodGet, resumeURL, nil, cookie)
		if resumeResp.StatusCode != http.StatusOK {
			t.Fatalf("resume from captured cursor: want 200 got %d body=%s", resumeResp.StatusCode, resumeRaw)
		}
		var resume pullOut
		mustUnmarshal(t, resumeRaw, &resume)

		found := false
		for _, p := range resume.Progress {
			if p.ChapterID == "chA" {
				found = true
			}
		}
		if !found {
			t.Fatalf("device A's late-committing row (updated_at=%v) was lost: resuming from the cursor captured before it committed (cursor=%s) did not return it — got %+v", tA, poll.Cursor, resume.Progress)
		}
	})

	t.Run("push applies progress and annotations together in one call", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "combo")
		now := nowUTC()
		annID := uuid.New()

		resp, raw := doRequest(t, app, http.MethodPost, "/sync",
			pushBody(
				[]map[string]any{progressPushItem("c1", "combo", "read", true, now)},
				[]map[string]any{annotationPushItem(annID, "c1", "combo", map[string]any{"pos": 1}, "note", now, now, nil)},
			), cookie)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("combo push: want 200 got %d body=%s", resp.StatusCode, raw)
		}
		var out pushOut
		mustUnmarshal(t, raw, &out)
		if out.Applied != 2 {
			t.Fatalf("combo push: want applied=2 (1 progress + 1 annotation) got %d", out.Applied)
		}
	})

	t.Run("a malformed batch item rejects the whole request atomically", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "atomic")

		now := nowUTC()
		validItem := progressPushItem("c1", "atomic-valid", "read", true, now)
		invalidItem := map[string]any{
			"courseId": "c1", "chapterId": "atomic-invalid", "status": "read", "done": true,
			"updatedAt": "not-a-timestamp",
		}
		resp, raw := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{validItem, invalidItem}, nil), cookie)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("batch with one malformed item: want 400 got %d body=%s", resp.StatusCode, raw)
		}

		getResp, getRaw := doRequest(t, app, http.MethodGet, "/sync", nil, cookie)
		if getResp.StatusCode != http.StatusOK {
			t.Fatalf("get: want 200 got %d", getResp.StatusCode)
		}
		var pull pullOut
		mustUnmarshal(t, getRaw, &pull)
		for _, p := range pull.Progress {
			if p.ChapterID == "atomic-valid" {
				t.Fatalf("the valid item in a rejected batch must not have been applied (want all-or-nothing), but it was")
			}
		}
	})

	t.Run("updated_at comparison is correct across timezones and differing precision", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "timezone")

		base := nowUTC()
		loc := time.FixedZone("test+07", 7*3600)
		baseInZone := base.In(loc) // same instant, different string representation (non-UTC offset)

		resp1, raw1 := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{{
				"courseId": "c1", "chapterId": "tz1", "status": "read", "done": true,
				"updatedAt": baseInZone.Format(time.RFC3339Nano),
			}}, nil), cookie)
		if resp1.StatusCode != http.StatusOK {
			t.Fatalf("push non-UTC-offset instant: want 200 got %d body=%s", resp1.StatusCode, raw1)
		}

		// A strictly LATER instant, expressed at second precision (no
		// fractional digits) — lower precision than the stored value.
		later := base.Add(time.Hour).Truncate(time.Second)
		resp2, raw2 := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{{
				"courseId": "c1", "chapterId": "tz1", "status": "read", "done": false,
				"updatedAt": later.Format(time.RFC3339), // second precision, no fraction
			}}, nil), cookie)
		if resp2.StatusCode != http.StatusOK {
			t.Fatalf("push later, lower-precision instant: want 200 got %d body=%s", resp2.StatusCode, raw2)
		}
		var out2 pushOut
		mustUnmarshal(t, raw2, &out2)
		if out2.Applied != 1 {
			t.Fatalf("a genuinely later write, even at lower (second) precision, must still win: want applied=1 got %d", out2.Applied)
		}

		getResp, getRaw := doRequest(t, app, http.MethodGet, "/sync", nil, cookie)
		if getResp.StatusCode != http.StatusOK {
			t.Fatalf("get: want 200 got %d", getResp.StatusCode)
		}
		var pull pullOut
		mustUnmarshal(t, getRaw, &pull)
		found := false
		for _, p := range pull.Progress {
			if p.ChapterID == "tz1" {
				found = true
				if p.Done {
					t.Fatalf("want done=false (the later, lower-precision write won), got true")
				}
			}
		}
		if !found {
			t.Fatalf("progress row tz1 missing from GET /sync")
		}
	})

	t.Run("GET /sync with an unparseable since is 400", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "badsince")
		resp, raw := doRequest(t, app, http.MethodGet, "/sync?since=not-a-timestamp", nil, cookie)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("GET /sync with garbage since: want 400 got %d body=%s", resp.StatusCode, raw)
		}
	})

	// Ruling F3: both routes must reject an unauthenticated request with
	// 401 — the same case auth_test.go pins for /me, exercised here for
	// sync's own two routes.
	t.Run("401 without a session cookie on both GET and POST /sync", func(t *testing.T) {
		app := newTestApp(pool)

		getResp, getRaw := doRequest(t, app, http.MethodGet, "/sync", nil, nil)
		if getResp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("GET /sync without cookie: want 401 got %d body=%s", getResp.StatusCode, getRaw)
		}

		postResp, postRaw := doRequest(t, app, http.MethodPost, "/sync", pushBody(nil, nil), nil)
		if postResp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("POST /sync without cookie: want 401 got %d body=%s", postResp.StatusCode, postRaw)
		}
	})
}

func mustUnmarshal(t *testing.T, raw []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatalf("unmarshal %s: %v", raw, err)
	}
}
