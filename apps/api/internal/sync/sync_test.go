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
// appsync.MaxItemsPerPush by name rather than duplicating its value as a
// magic number — that alias is the real (and only) collision-avoidance
// mechanism in this package; see internal/server/server.go for the fuller
// reasoning.
//
// Pha 3 Task 3 note: GET /sync is gone (see internal/sync/handler.go's
// package note). Every subtest below that used to read its own push back
// through GET /sync now reads it back through GET /progress or
// GET /annotations instead — the REST resources Pha 3 Tasks 1 and 2 built,
// reached through this same server.New wiring. A few subtests whose real
// subject WAS the pull path itself (the cursor's safety lag, the `since`
// query param) are deleted outright, not adapted — there is nothing left
// for them to be about. See this task's report for the full per-test
// accounting.
package sync_test

import (
	"bytes"
	"context"
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

// annotationOut deliberately has no DeletedAt field: GET /annotations
// (unlike the old GET /sync) never emits one — a deleted annotation is
// simply absent from the list (see internal/userdata's own AnnotationRow
// doc comment).
type annotationOut struct {
	ID        string          `json:"id"`
	CourseID  string          `json:"courseId"`
	ChapterID string          `json:"chapterId"`
	Anchor    json.RawMessage `json:"anchor"`
	Note      string          `json:"note"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
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

// --- read-back helpers, replacing GET /sync (see this file's Pha 3 Task 3
// note above): every subtest that used to prove a push's effect by reading
// it back through GET /sync now reads it back through one of these two
// instead, mirroring internal/userdata's own getProgress/getAnnotations
// helpers in progress_test.go / annotations_test.go. ---

// getProgress calls GET /progress and returns the parsed rows.
func getProgress(t *testing.T, app *fiber.App, cookie *http.Cookie) []progressOut {
	t.Helper()
	resp, raw := doRequest(t, app, http.MethodGet, "/progress", nil, cookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /progress: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var out struct {
		Progress []progressOut `json:"progress"`
	}
	mustUnmarshal(t, raw, &out)
	return out.Progress
}

// getAnnotations calls GET /annotations (every course, no ?course= filter
// — none of this file's subtests need one) and returns the parsed rows.
func getAnnotations(t *testing.T, app *fiber.App, cookie *http.Cookie) []annotationOut {
	t.Helper()
	resp, raw := doRequest(t, app, http.MethodGet, "/annotations", nil, cookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /annotations: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var out struct {
		Annotations []annotationOut `json:"annotations"`
	}
	mustUnmarshal(t, raw, &out)
	return out.Annotations
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
// convergence, (c) another user's annotations must never leak through a
// read route — plus the additional cases this task's own instructions call
// out: user isolation for progress (not just annotations), tombstone/
// done=false propagation, idempotent batch replay, timezone/precision
// handling, atomic batch rejection, and the auth gate on both /sync verbs.
// Pha 3 Task 3 deleted GET /sync, its `since` cursor, and every subtest
// whose real subject was that cursor's own safety-lag formula (see the
// deletion note inline, below); every OTHER subtest that used to read a
// push back through GET /sync now reads it back through GET /progress or
// GET /annotations instead (see this file's own package note above). All
// subtests share one store.TestPool container (each gets its own
// fiber.App instance and its own user(s)) to keep the container-spin-up
// cost to once per run, exactly like auth_test.go.
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

		rows := getProgress(t, app, cookie)
		if len(rows) != 1 {
			t.Fatalf("want 1 progress row, got %d: %+v", len(rows), rows)
		}
		if !rows[0].Done {
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

		// Both devices read back and must converge on y — never on x.
		for _, device := range []string{"device1", "device2"} {
			rows := getProgress(t, app, cookie)
			if len(rows) != 1 {
				t.Fatalf("%s: want 1 progress row, got %d", device, len(rows))
			}
			if !rows[0].Done {
				t.Fatalf("%s: converged value must be y (done=true), got done=false — the LWW guard did not hold", device)
			}
		}
	})

	// Was "annotations from another user do not leak into GET /sync" before
	// Pha 3 Task 3 deleted that route. Re-expressed through GET /annotations
	// (Task 2's surviving reader) rather than deleted outright: the real
	// invariant under test isn't about GET /sync's own query — it's whether
	// a row this package's push path writes into the shared `annotations`
	// table stays scoped to its owner no matter which route later reads it
	// back. That's still worth proving now that a DIFFERENT package
	// (internal/userdata) owns the read side.
	t.Run("annotations pushed by another user do not leak into GET /annotations", func(t *testing.T) {
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

		rows := getAnnotations(t, app, cookieB)
		for _, a := range rows {
			if a.ID == annID.String() {
				t.Fatalf("user B's GET /annotations leaked user A's annotation %s (pushed through POST /sync)", annID)
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

		rowsA := getAnnotations(t, app, cookieA)
		found := false
		for _, a := range rowsA {
			if a.ID == annID.String() {
				found = true
				if a.Note != "A's note" {
					t.Fatalf("A's annotation was overwritten by B: note=%q", a.Note)
				}
			}
		}
		if !found {
			t.Fatalf("A's annotation missing from A's own GET /annotations")
		}

		rowsB := getAnnotations(t, app, cookieB)
		for _, a := range rowsB {
			if a.ID == annID.String() {
				t.Fatalf("B's GET /annotations shows A's annotation id %s, which must never be visible to B", annID)
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

		rowsA := getProgress(t, app, cookieA)
		if len(rowsA) != 1 || !rowsA[0].Done {
			t.Fatalf("A's own progress must be unaffected by B's push to the same course/chapter/status key: %+v", rowsA)
		}
	})

	// Renamed and rewritten for Pha 3 Task 2 (migration 0009 dropped
	// annotations.deleted_at — see internal/userdata, the REST replacement
	// this column's removal was for). Before that migration, a pushed
	// tombstone still occupied a row (deleted_at set) and GET /sync
	// returned it WITH a deletedAt, so other devices could see the
	// deletion as an event. Now PushBatch translates a DeletedAt-bearing
	// item into a real DELETE (see repo.go's deleteAnnotationSQL and its
	// own doc comment) — there is no tombstone row left to return.
	//
	// Rewritten AGAIN for Pha 3 Task 3, which deleted GET /sync itself
	// (see handler.go's package note): the read-back below now goes
	// through GET /annotations / GET /progress, Tasks 1–2's surviving REST
	// resources, reached through this same server.New wiring. The
	// acceptance criterion is unchanged — the annotation must be GONE, not
	// present-with-deletedAt — only the route proving it changed.
	t.Run("a pushed tombstone hard-deletes the annotation; done=false progress still propagates", func(t *testing.T) {
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
		var delOut pushOut
		mustUnmarshal(t, delRaw, &delOut)
		if delOut.Applied != 1 {
			t.Fatalf("delete push: want applied=1 (the row existed and the delete's updated_at is newer) got %d", delOut.Applied)
		}

		unmarkResp, unmarkRaw := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("c1", "ch2", "read", false, now)}, nil), cookie)
		if unmarkResp.StatusCode != http.StatusOK {
			t.Fatalf("push done=false progress: want 200 got %d body=%s", unmarkResp.StatusCode, unmarkRaw)
		}

		annRows := getAnnotations(t, app, cookie)
		for _, a := range annRows {
			if a.ID == annID.String() {
				t.Fatalf("deleted annotation %s still present in GET /annotations — a real DELETE must not leave a row behind", annID)
			}
		}

		progRows := getProgress(t, app, cookie)
		gotUnmarked := false
		for _, p := range progRows {
			if p.ChapterID == "ch2" {
				if p.Done {
					t.Fatalf("want done=false for ch2, got true")
				}
				gotUnmarked = true
			}
		}
		if !gotUnmarked {
			t.Fatalf("done=false progress row missing entirely from GET /progress — unmarking must propagate")
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

		rows := getProgress(t, app, cookie)
		if len(rows) != 1 {
			t.Fatalf("replay must not create a duplicate row: want 1 progress row got %d", len(rows))
		}
	})

	// DELETED (Pha 3 Task 3), not adapted:
	//   - "cursor is safety-lagged behind max updated_at; echoes since when
	//     nothing changed"
	//   - "a late-committing row with an older updated_at survives the
	//     safety-lagged cursor" (the fix's own regression test for the
	//     commit-ordering race Usecase.Pull's now-deleted doc comment
	//     described)
	// Both subjects were the Pull cursor's own safety-lag formula — since
	// (max updated_at - SyncSafetyLag), floored at `since`. There is no
	// cursor left to be safety-lagged: GET /sync, the `since` query
	// parameter, Usecase.Pull, and the SyncSafetyLag constant are all gone
	// (see handler.go's package note and usecase.go's Usecase doc comment).
	// Re-expressing either test through GET /progress would assert nothing
	// real — neither test's failure mode (a poller silently losing a row
	// that committed late) can happen anymore, because there is no poller.
	// Keeping them around unable to test their own subject would be
	// exactly the "keep a test that now asserts nothing" this task's own
	// instructions rule out.

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

		rows := getProgress(t, app, cookie)
		for _, p := range rows {
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

		rows := getProgress(t, app, cookie)
		found := false
		for _, p := range rows {
			if p.ChapterID == "tz1" {
				found = true
				if p.Done {
					t.Fatalf("want done=false (the later, lower-precision write won), got true")
				}
			}
		}
		if !found {
			t.Fatalf("progress row tz1 missing from GET /progress")
		}
	})

	// DELETED (Pha 3 Task 3): "GET /sync with an unparseable since is 400".
	// Its subject was Pull's own `since` query-parameter parsing, which no
	// longer exists — GET /sync is gone, and POST /sync never had a
	// `since` parameter to begin with. Nothing survives to re-express this
	// against.

	// I3 — a device with a fast clock must not be able to poison a row's
	// LWW position far into the future.
	//
	// Before Pha 3 Task 3 deleted GET /sync, this same concern was framed
	// around Pull's shared cursor (a fast device could poison the
	// watermark every one of that user's devices polled with — see
	// usecase.go's clampFuture doc comment for the fuller history). That
	// framing is gone along with the cursor; what remains, and what this
	// subtest now proves, is that the clamp still protects the STORED row
	// itself: `updated_at` comes from the client (handler.go parses it out
	// of the request body), and an unclamped future value would let that
	// row win every future LWW comparison — against another device's push,
	// or against PUT /progress — until wall-clock time caught up to it.
	t.Run("a future-dated client timestamp is clamped to server time, not stored verbatim", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "fastclock")

		t0 := nowUTC()
		// An hour ahead — far past any plausible commit-ordering jitter,
		// which is the whole point of the assertion below.
		skewed := t0.Add(time.Hour)

		resp, raw := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("c1", "ch-fast", "read", true, skewed)}, nil), cookie)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("push from the fast-clock device: want 200 got %d body=%s", resp.StatusCode, raw)
		}

		// The stored row itself is clamped to server-now, so it cannot be
		// used to beat every future edit under last-write-wins either.
		rows := getProgress(t, app, cookie)
		if len(rows) != 1 {
			t.Fatalf("want 1 progress row back, got %d: %+v", len(rows), rows)
		}
		storedUpdatedAt, err := time.Parse(time.RFC3339Nano, rows[0].UpdatedAt)
		if err != nil {
			t.Fatalf("parse stored updatedAt %q: %v", rows[0].UpdatedAt, err)
		}
		// A generous ceiling: the clamp uses the API server's own clock,
		// which is this same process, so "not meaningfully in the future"
		// is the honest assertion — not equality with any exact instant.
		if storedUpdatedAt.After(t0.Add(time.Minute)) {
			t.Fatalf("stored updatedAt %s was not clamped to server-now (test started at %s) — the client's clock still decides", storedUpdatedAt, t0)
		}
	})

	// The other half of the clamp: it is ONE-SIDED. Offline editing
	// depends on past-dated timestamps being honoured exactly as sent —
	// apps/web/src/db/local.ts stamps an edit when it HAPPENS, not when
	// the outbox eventually flushes, so that an hour-old offline edit
	// cannot dishonestly beat a genuinely newer edit made elsewhere. A
	// clamp that touched the past (or that replaced every timestamp with
	// `now`) would break last-write-wins for exactly that case.
	t.Run("a past-dated client timestamp is stored verbatim — the clamp is future-only", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "offlineedit")

		// An edit made an hour ago on a device that has been offline since.
		offlineEdit := nowUTC().Add(-time.Hour)

		resp, raw := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("c1", "ch-offline", "read", true, offlineEdit)}, nil), cookie)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("push of an offline edit: want 200 got %d body=%s", resp.StatusCode, raw)
		}

		rows := getProgress(t, app, cookie)
		if len(rows) != 1 {
			t.Fatalf("want 1 progress row back, got %d: %+v", len(rows), rows)
		}
		got, err := time.Parse(time.RFC3339Nano, rows[0].UpdatedAt)
		if err != nil {
			t.Fatalf("parse stored updatedAt %q: %v", rows[0].UpdatedAt, err)
		}
		if !got.Equal(offlineEdit) {
			t.Fatalf("past-dated updatedAt was rewritten: sent %s, stored %s — offline edits depend on this being untouched", offlineEdit, got)
		}
	})

	// A review measured what "no cap on the number of items" costs: the
	// body is swallowed whole into RAM at roughly 20× its size on the
	// wire, every item becomes one tx.Exec inside a SINGLE transaction
	// holding one of the pool's 4–8 connections, and one 4 MiB body was
	// confirmed writing 37 216 real rows. The route's byte limit bounds
	// the RAM; only an item cap bounds the transaction, because an item
	// can be made arbitrarily small ({"updatedAt":"..."} is under 40
	// bytes) and the count is therefore not a function of the byte limit
	// at all.
	//
	// The boundary is pinned WITHOUT writing MaxItemsPerPush rows: the cap
	// is checked before the per-item parse loop, so a batch of exactly
	// MaxItemsPerPush whose last item is malformed comes back 400 (the
	// cap let it through, the parser caught it) while MaxItemsPerPush+1
	// comes back 413 (the cap caught it first). Two requests, no clock,
	// and both leave the database untouched.
	t.Run("a batch over the item cap is refused before any of it is parsed", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "itemcap")

		now := nowUTC()
		// The marker is what makes "zero side effects" checkable: if any
		// prefix of an over-cap batch were applied, this row would be it.
		batch := func(n int) []map[string]any {
			items := make([]map[string]any, 0, n)
			items = append(items, progressPushItem("c1", "itemcap-marker", "read", true, now))
			for len(items) < n-1 {
				items = append(items, progressPushItem("c1",
					fmt.Sprintf("itemcap-%d", len(items)), "read", true, now))
			}
			// Last item malformed, so a batch that gets PAST the cap
			// fails in the parse loop with a different status.
			items = append(items, map[string]any{
				"courseId": "c1", "chapterId": "itemcap-last", "status": "read", "done": true,
				"updatedAt": "not-a-timestamp",
			})
			return items
		}

		over := batch(appsync.MaxItemsPerPush + 1)
		resp, raw := doRequest(t, app, http.MethodPost, "/sync", pushBody(over, nil), cookie)
		if resp.StatusCode != http.StatusRequestEntityTooLarge {
			t.Fatalf("%d items (cap is %d): want 413 got %d body=%s",
				len(over), appsync.MaxItemsPerPush, resp.StatusCode, raw)
		}

		atCap := batch(appsync.MaxItemsPerPush)
		atResp, atRaw := doRequest(t, app, http.MethodPost, "/sync", pushBody(atCap, nil), cookie)
		if atResp.StatusCode != http.StatusBadRequest {
			t.Fatalf("exactly %d items (cap is %d): want 400 from the parse loop, got %d body=%s",
				len(atCap), appsync.MaxItemsPerPush, atResp.StatusCode, atRaw)
		}

		// Neither request wrote anything.
		rows := getProgress(t, app, cookie)
		if n := len(rows); n != 0 {
			t.Errorf("a refused batch left %d progress row(s) behind: %+v", n, rows)
		}

		// Anti-vacuity: an ordinary batch from the same session still
		// applies. Without it, "reject every push" would pass the above.
		okResp, okRaw := doRequest(t, app, http.MethodPost, "/sync",
			pushBody([]map[string]any{progressPushItem("c1", "itemcap-ok", "read", true, now)}, nil), cookie)
		if okResp.StatusCode != http.StatusOK {
			t.Fatalf("an ordinary batch: want 200 got %d body=%s", okResp.StatusCode, okRaw)
		}
		var push pushOut
		mustUnmarshal(t, okRaw, &push)
		if push.Applied != 1 {
			t.Errorf("an ordinary batch: want applied=1 got %d", push.Applied)
		}
	})

	// Was "401 without a session cookie on both GET and POST /sync" (ruling
	// F3). GET /sync is deleted by Pha 3 Task 3 — there is no auth gate
	// left on it to 401-check — so this pins the route's actual removal
	// instead: fiber matches the path "/sync" (POST is still registered
	// there) but not the method, which is 405 Method Not Allowed, not 404
	// — confirmed by running this subtest against the pre-fix expectation
	// (404) and observing the real response before writing this comment.
	// This also keeps the still-live half of ruling F3: POST /sync must
	// still reject an unauthenticated request with 401, the same case
	// auth_test.go pins for /me. A future change that silently re-wired
	// Pull back onto GET /sync would turn this 405 into a 200/401 pair
	// instead, which is exactly what this subtest is here to catch.
	t.Run("GET /sync is gone (405); POST /sync still 401s without a session cookie", func(t *testing.T) {
		app := newTestApp(pool)

		getResp, getRaw := doRequest(t, app, http.MethodGet, "/sync", nil, nil)
		if getResp.StatusCode != http.StatusMethodNotAllowed {
			t.Fatalf("GET /sync: want 405 (route removed, POST still claims the path) got %d body=%s", getResp.StatusCode, getRaw)
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

// TestPushAnnotationTombstoneHardDeletes is Pha 3 Task 2's dedicated
// regression test for the ruling that task carries beyond its own brief:
// migration 0009 dropped annotations.deleted_at (see internal/userdata,
// the REST replacement that column's removal was actually for), and
// internal/sync's push path — this package, still depended on by the
// browser's one-time old-outbox flush — had to be adapted to keep working
// without it. This test proves the exact translation PushBatch and
// deleteAnnotationSQL now perform (see repo.go): an incoming annotation
// item whose deletedAt is non-null becomes a REAL DELETE of that row,
// never a write to a marker column, and — the failure mode the ruling
// names explicitly — never lets the row come back. Dropping a queued
// deletedAt on the floor during the browser's old-outbox flush would
// resurrect a note the learner deleted, silently; this is the test that
// would catch it if a future change reintroduced that bug.
func TestPushAnnotationTombstoneHardDeletes(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie, _ := registerUser(t, app, "hard-delete")

	now := nowUTC()
	annID := uuid.New()

	// Push 1: create the annotation.
	createResp, createRaw := doRequest(t, app, http.MethodPost, "/sync",
		pushBody(nil, []map[string]any{annotationPushItem(annID, "c1", "ch1", map[string]any{"pos": 1}, "my note", now, now, nil)}), cookie)
	if createResp.StatusCode != http.StatusOK {
		t.Fatalf("push (create): want 200 got %d body=%s", createResp.StatusCode, createRaw)
	}
	var createOut pushOut
	mustUnmarshal(t, createRaw, &createOut)
	if createOut.Applied != 1 {
		t.Fatalf("push (create): want applied=1 (fresh insert) got %d", createOut.Applied)
	}

	// Push 2: the SAME id, this time carrying deletedAt — exactly what a
	// browser flushing its old offline outbox sends for a note the
	// learner deleted before upgrading off local-first storage (see this
	// task's ruling).
	deletedAt := now.Add(time.Minute)
	delResp, delRaw := doRequest(t, app, http.MethodPost, "/sync",
		pushBody(nil, []map[string]any{annotationPushItem(annID, "c1", "ch1", map[string]any{"pos": 1}, "my note", now, deletedAt, &deletedAt)}), cookie)
	if delResp.StatusCode != http.StatusOK {
		t.Fatalf("push (tombstone): want 200 got %d body=%s", delResp.StatusCode, delRaw)
	}
	var delOut pushOut
	mustUnmarshal(t, delRaw, &delOut)
	if delOut.Applied != 1 {
		t.Fatalf("push (tombstone): want applied=1 (the delete matched the row created above) got %d — the translation did not run", delOut.Applied)
	}

	// Confirm the row is gone — not resurrected — on the read path
	// available to this test. This used to be GET /sync, "the only route
	// this package exposes to read a row back"; Pha 3 Task 3 deleted that
	// route (see handler.go's package note), so the read-back now goes
	// through GET /annotations instead — Task 2's own surviving endpoint,
	// reached through this same server.New wiring — which still proves
	// exactly what this test needs: the row this package's push path
	// deleted is not visible anywhere the API can show it back.
	rows := getAnnotations(t, app, cookie)
	for _, a := range rows {
		if a.ID == annID.String() {
			t.Fatalf("annotation %s reappeared in GET /annotations after its tombstone was pushed through POST /sync — the delete translation resurrected it instead of deleting it", annID)
		}
	}
}

// --- testEnv: a fluent wrapper around one store.TestPool-backed app + pool
// + "current user" cookie, added for TestPushStillPrefersNewerServerRow
// below. Mirrors internal/userdata/annotations_test.go's own testEnv (this
// repo's established shape for this pattern); the rest of this file keeps
// its existing doRequest-based style rather than migrating onto testEnv
// wholesale, since that migration is no part of this task's brief. ---

type testEnv struct {
	pool   *pgxpool.Pool
	app    *fiber.App
	cookie *http.Cookie
	userID uuid.UUID
}

// newTestEnv spins up one store.TestPool-backed app and registers its
// default caller.
func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie, userIDStr := registerUser(t, app, "lww")
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		t.Fatalf("parse registered user id %q: %v", userIDStr, err)
	}
	return &testEnv{pool: pool, app: app, cookie: cookie, userID: userID}
}

// seedProgress writes a progress row directly into Postgres, bypassing
// every HTTP layer on purpose: PUT /progress (Task 1) always stamps
// updated_at as the SERVER's now() and has no way to accept an arbitrary
// timestamp, and POST /sync's own push path is the very thing
// TestPushStillPrefersNewerServerRow verifies — seeding through it would
// test the LWW guard using the LWW guard. This represents "a progress row
// already exists on the server with exactly this updatedAt", however it
// actually got there (in reality: some earlier PUT /progress or push, at
// whatever instant it happened).
func (e *testEnv) seedProgress(t *testing.T, courseID, chapterID, status string, done bool, updatedAt time.Time) {
	t.Helper()
	_, err := e.pool.Exec(context.Background(),
		`INSERT INTO progress (user_id, course_id, chapter_id, status, done, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
		e.userID, courseID, chapterID, status, done, updatedAt)
	if err != nil {
		t.Fatalf("seed progress: %v", err)
	}
}

// push sends rawBody to POST /sync as e's current user and asserts 200.
func (e *testEnv) push(t *testing.T, rawBody string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/sync", bytes.NewReader([]byte(rawBody)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(e.cookie)
	resp, err := e.app.Test(req, testTimeoutMS)
	if err != nil {
		t.Fatalf("POST /sync: %v", err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("POST /sync: read body: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /sync: want 200 got %d body=%s", resp.StatusCode, raw)
	}
}

// progressDone reads a single progress row back through GET /progress
// (Task 1's surviving read route — GET /sync no longer exists, see
// handler.go's package note) and returns its done flag, failing the test
// if the row is missing entirely.
func (e *testEnv) progressDone(t *testing.T, courseID, chapterID, status string) bool {
	t.Helper()
	rows := getProgress(t, e.app, e.cookie)
	for _, p := range rows {
		if p.CourseID == courseID && p.ChapterID == chapterID && p.Status == status {
			return p.Done
		}
	}
	t.Fatalf("progress row %s/%s/%s not found via GET /progress", courseID, chapterID, status)
	return false
}

// parse parses a fixed RFC3339 instant, panicking on a malformed literal.
// Only used by TestPushStillPrefersNewerServerRow below, where every call
// site passes a constant — a parse failure there can only be a typo in
// this file, not a runtime condition worth plumbing *testing.T through for.
func parse(s string) time.Time {
	parsed, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(fmt.Sprintf("parse(%q): %v", s, err))
	}
	return parsed
}

// TestPushStillPrefersNewerServerRow is this package's real reason to
// still exist after Pha 3 Task 3 cut GET /sync (see handler.go's package
// note): an item from a browser's old offline outbox can carry a stale
// updatedAt — the entry may have sat unsynced for days before the upgrade
// — and pushing it through PUT /progress (Task 1, which always stamps
// server now()) would blindly overwrite a genuinely newer server row with
// older content, because PUT /progress has no LWW guard and no client
// timestamp to guard with. POST /sync's push path is what still honors
// the client's own updatedAt and refuses to let it win against something
// newer — this is the test that would go red if that ever stopped being
// true.
func TestPushStillPrefersNewerServerRow(t *testing.T) {
	env := newTestEnv(t)
	env.seedProgress(t, "c", "c1", "read", true, parse("2026-09-01T10:00:00Z"))
	env.push(t, `{"progress":[{"courseId":"c","chapterId":"c1","status":"read","done":false,"updatedAt":"2026-08-01T10:00:00Z"}],"annotations":[]}`)

	if !env.progressDone(t, "c", "c1", "read") {
		t.Fatal("hàng cũ hơn từ outbox đã đè hàng mới hơn trên máy chủ")
	}
}
