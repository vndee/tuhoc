// Package catalog_test exercises the admin catalog API through
// internal/server.New — the same wiring the CLI (Task 4) and a real admin
// session both depend on — against a real Postgres via store.TestPool. It
// is an external test package so it can import server (which imports
// catalog) without a cycle, the same reason auth_test and course_test are
// external packages too.
package catalog_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/catalog"
	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/pkgcheck"
	"github.com/vndee/tuhoc-api/internal/server"
	"github.com/vndee/tuhoc-api/internal/store"
)

// fixturesRoot is the shared format-v2 corpus (Task 3), the SAME directory
// internal/pkgcheck's own contract_test.go reads — same relative depth
// (apps/api/internal/<pkg>/), so both packages test against one corpus
// rather than a second copy of it.
const fixturesRoot = "../../../../fixtures/format-v2"

const expectFile = "expect.json"

const httpTimeoutMS = 30000

const sessionCookieName = "tuhoc_session"

// adminToken is a fixed test value for cfg.AdminToken — never the empty
// string, since an empty AdminToken means "the token path is off" (see
// server.adminOrToken's own doc comment), which is itself pinned by
// TestEmptyAdminTokenNeverMatches below using its own, separate app.
const adminToken = "catalog-test-admin-token-do-not-use-in-prod"

func newTestApp(pool *pgxpool.Pool) *fiber.App {
	return server.New(config.Config{CookieSecure: false, AdminToken: adminToken},
		server.Deps{Pool: pool, LogOutput: io.Discard})
}

// zipDir zips every file under dir into package bytes, excluding
// expect.json — identical convention to internal/pkgcheck/contract_test.go's
// own zipDir, so a fixture round-trips through the same kind of real
// archive/zip.Writer door a real `tuhoc pack` output arrives by, in both
// test suites.
func zipDir(t *testing.T, dir string) []byte {
	t.Helper()

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if d.Name() == expectFile {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)

		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		w, err := zw.Create(rel)
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	})
	if err != nil {
		t.Fatalf("zipDir(%s): %v", dir, err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zipDir(%s): closing zip writer: %v", dir, err)
	}
	return buf.Bytes()
}

func validCourseZip(t *testing.T) []byte {
	t.Helper()
	return zipDir(t, filepath.Join(fixturesRoot, "valid-course"))
}

// validCourseSlug is valid-course/manifest.json's own "id" (ruling D5).
const validCourseSlug = "mau-hop-le"

// putPackage issues PUT /admin/courses/{slug}. auth, if non-empty, is sent
// verbatim as the Authorization header (so a test can send a malformed or
// wrong-scheme value, not only a well-formed Bearer token).
func putPackage(t *testing.T, app *fiber.App, slug string, zipBytes []byte, auth string, cookie *http.Cookie) (*http.Response, []byte) {
	t.Helper()

	req := httptest.NewRequest(http.MethodPut, "/admin/courses/"+slug, bytes.NewReader(zipBytes))
	req.Header.Set("Content-Type", "application/zip")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("PUT /admin/courses/%s: %v", slug, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("PUT /admin/courses/%s: read body: %v", slug, err)
	}
	resp.Body.Close()
	return resp, raw
}

func deletePackage(t *testing.T, app *fiber.App, slug, auth string) (*http.Response, []byte) {
	t.Helper()

	req := httptest.NewRequest(http.MethodDelete, "/admin/courses/"+slug, nil)
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("DELETE /admin/courses/%s: %v", slug, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("DELETE /admin/courses/%s: read body: %v", slug, err)
	}
	resp.Body.Close()
	return resp, raw
}

func rollbackPackage(t *testing.T, app *fiber.App, slug string, toVersion int, auth string) (*http.Response, []byte) {
	t.Helper()

	body, err := json.Marshal(map[string]int{"version": toVersion})
	if err != nil {
		t.Fatalf("marshal rollback body: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/admin/courses/"+slug+"/rollback", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("POST /admin/courses/%s/rollback: %v", slug, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("POST /admin/courses/%s/rollback: read body: %v", slug, err)
	}
	resp.Body.Close()
	return resp, raw
}

func listAdminCourses(t *testing.T, app *fiber.App, auth string) (*http.Response, []byte) {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, "/admin/courses", nil)
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("GET /admin/courses: %v", err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("GET /admin/courses: read body: %v", err)
	}
	resp.Body.Close()
	return resp, raw
}

// registerUser creates a real account through the real /auth/register
// route (needed so its session cookie validates against the real sessions
// table auth.Require checks) and returns its cookie, id, and email — the
// last so a caller can promote it to role='admin' by a direct SQL UPDATE,
// the same shortcut auth_test.go's own TestRequireAdmin takes.
func registerUser(t *testing.T, app *fiber.App, label string) (*http.Cookie, uuid.UUID, string) {
	t.Helper()

	email := fmt.Sprintf("catalog-%s-%s@example.test", label, uuid.NewString())
	body, err := json.Marshal(map[string]string{"email": email, "password": "catalog-test-password-1", "name": label})
	if err != nil {
		t.Fatalf("register %s: marshal: %v", label, err)
	}
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("register %s: %v", label, err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("register %s: want 200 got %d body=%s", label, resp.StatusCode, raw)
	}

	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("register %s: unmarshal: %v (body=%s)", label, err, raw)
	}
	id, err := uuid.Parse(out.ID)
	if err != nil {
		t.Fatalf("register %s: bad id %q: %v", label, out.ID, err)
	}

	var cookie *http.Cookie
	for _, ck := range resp.Cookies() {
		if ck.Name == sessionCookieName {
			cookie = ck
		}
	}
	if cookie == nil {
		t.Fatalf("register %s: no session cookie", label)
	}
	return cookie, id, email
}

func promoteToAdmin(t *testing.T, pool *pgxpool.Pool, email string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET role = 'admin' WHERE email = $1`, email); err != nil {
		t.Fatalf("promote %s to admin: %v", email, err)
	}
}

// --- DB-side assertions -------------------------------------------------

func countWhere(t *testing.T, pool *pgxpool.Pool, table, whereClause string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		"SELECT count(*) FROM "+table+" WHERE "+whereClause, args...).Scan(&n); err != nil {
		t.Fatalf("count %s where %s: %v", table, whereClause, err)
	}
	return n
}

type auditRow struct {
	who    *uuid.UUID
	actor  string
	action string
	target string
	note   string
}

func lastAudit(t *testing.T, pool *pgxpool.Pool, target, action string) auditRow {
	t.Helper()
	var row auditRow
	err := pool.QueryRow(context.Background(),
		`SELECT who, actor, action, target, note FROM admin_audit
		 WHERE target = $1 AND action = $2 ORDER BY id DESC LIMIT 1`,
		target, action,
	).Scan(&row.who, &row.actor, &row.action, &row.target, &row.note)
	if err != nil {
		t.Fatalf("last audit row (target=%s action=%s): %v", target, action, err)
	}
	return row
}

// --- (a) + (b): publish, then publish again -----------------------------

func TestPublishCreatesCourseVersion1(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish valid-course: want 201 got %d body=%s", resp.StatusCode, raw)
	}
	var body struct {
		Slug    string `json:"slug"`
		Version int    `json:"version"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal 201 body: %v (body=%s)", err, raw)
	}
	if body.Slug != validCourseSlug {
		t.Errorf("201 slug: want %q got %q", validCourseSlug, body.Slug)
	}
	if body.Version != 1 {
		t.Errorf("201 version: want 1 got %d", body.Version)
	}

	if n := countWhere(t, pool, "published_courses", "slug = $1 AND version = 1", validCourseSlug); n != 1 {
		t.Errorf("published_courses rows for %s@1: want 1 got %d", validCourseSlug, n)
	}
	if n := countWhere(t, pool, "published_chapters", "slug = $1", validCourseSlug); n != 2 {
		t.Errorf("published_chapters rows: want 2 got %d", n)
	}
	// c2 is the chapter D5 pins as carrying data-widget="dem-so".
	var widgetNames []string
	if err := pool.QueryRow(context.Background(),
		`SELECT widget_names FROM published_chapters WHERE slug = $1 AND chapter_id = 'c2'`,
		validCourseSlug).Scan(&widgetNames); err != nil {
		t.Fatalf("read c2's widget_names: %v", err)
	}
	if len(widgetNames) != 1 || widgetNames[0] != "dem-so" {
		t.Errorf("c2 widget_names: want [dem-so] got %v", widgetNames)
	}
	if n := countWhere(t, pool, "published_widgets", "slug = $1 AND name = 'dem-so'", validCourseSlug); n != 1 {
		t.Errorf("published_widgets rows for dem-so: want 1 got %d", n)
	}
	if n := countWhere(t, pool, "course_versions", "slug = $1 AND version = 1", validCourseSlug); n != 1 {
		t.Errorf("course_versions rows for %s@1: want 1 got %d", validCourseSlug, n)
	}

	audit := lastAudit(t, pool, validCourseSlug, "publish")
	if audit.who != nil {
		t.Errorf("audit.who: want NULL (token path) got %v", *audit.who)
	}
	if audit.actor != "cli" {
		t.Errorf("audit.actor: want %q got %q", "cli", audit.actor)
	}
}

func TestPublishAgainIncrementsVersion(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	zipBytes := validCourseZip(t)

	if resp, raw := putPackage(t, app, validCourseSlug, zipBytes, "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("first publish: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	resp, raw := putPackage(t, app, validCourseSlug, zipBytes, "Bearer "+adminToken, nil)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("second publish: want 201 got %d body=%s", resp.StatusCode, raw)
	}
	var body struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal 201 body: %v (body=%s)", err, raw)
	}
	if body.Version != 2 {
		t.Errorf("second publish version: want 2 got %d", body.Version)
	}

	// Version 1's archive is untouched by the second publish — rollback's
	// whole premise depends on this.
	if n := countWhere(t, pool, "course_versions", "slug = $1 AND version = 1", validCourseSlug); n != 1 {
		t.Errorf("course_versions@1 after a second publish: want still 1 row, got %d", n)
	}
	if n := countWhere(t, pool, "course_versions", "slug = $1", validCourseSlug); n != 2 {
		t.Errorf("course_versions total rows for %s: want 2 got %d", validCourseSlug, n)
	}
	// Exactly one LIVE published_courses row, at the newest version — a
	// second publish replaces the live row, it does not add a second one.
	if n := countWhere(t, pool, "published_courses", "slug = $1", validCourseSlug); n != 1 {
		t.Errorf("published_courses rows for %s: want 1 got %d", validCourseSlug, n)
	}
	if n := countWhere(t, pool, "published_courses", "slug = $1 AND version = 2", validCourseSlug); n != 1 {
		t.Errorf("published_courses live version: want 2 got count=%d", n)
	}
}

// --- (c): a hostile package is rejected and changes nothing -------------

func TestPublishRejectsHostilePackage(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	dir := filepath.Join(fixturesRoot, "hostile", "script-tag")
	slug := "script-tag" // hostile/script-tag/manifest.json's own "id"

	resp, raw := putPackage(t, app, slug, zipDir(t, dir), "Bearer "+adminToken, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("publish hostile/script-tag: want 400 got %d body=%s", resp.StatusCode, raw)
	}
	var body struct {
		Error    string `json:"error"`
		Findings []struct {
			Code string `json:"code"`
		} `json:"findings"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal 400 body: %v (body=%s)", err, raw)
	}
	found := false
	for _, f := range body.Findings {
		if f.Code == "SCRIPT_TAG" {
			found = true
		}
	}
	if !found {
		t.Errorf("400 findings: want SCRIPT_TAG among them, got %+v", body.Findings)
	}

	if n := countWhere(t, pool, "published_courses", "slug = $1", slug); n != 0 {
		t.Errorf("published_courses rows for rejected %s: want 0 got %d", slug, n)
	}
	if n := countWhere(t, pool, "course_versions", "slug = $1", slug); n != 0 {
		t.Errorf("course_versions rows for rejected %s: want 0 got %d", slug, n)
	}
	if n := countWhere(t, pool, "admin_audit", "target = $1", slug); n != 0 {
		t.Errorf("admin_audit rows for rejected %s: want 0 (a rejection is not an admin action) got %d", slug, n)
	}
}

// --- (d): the session fallback requires role='admin' --------------------

func TestPublishRequiresAdminRole(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie, uid, email := registerUser(t, app, "role")

	// No token, and the session belongs to an ordinary user: 403, and
	// nothing is written.
	resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "", cookie)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("publish as role=user: want 403 got %d body=%s", resp.StatusCode, raw)
	}
	if n := countWhere(t, pool, "published_courses", "slug = $1", validCourseSlug); n != 0 {
		t.Errorf("published_courses after a 403: want 0 rows got %d", n)
	}

	promoteToAdmin(t, pool, email)

	resp, raw = putPackage(t, app, validCourseSlug, validCourseZip(t), "", cookie)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish as role=admin: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	audit := lastAudit(t, pool, validCourseSlug, "publish")
	if audit.who == nil || *audit.who != uid {
		t.Errorf("audit.who: want %s got %v", uid, audit.who)
	}
	if audit.actor != "user" {
		t.Errorf("audit.actor: want %q got %q", "user", audit.actor)
	}
}

// --- (e): unpublish clears the live row but keeps history ---------------

func TestUnpublishClearsPublishedButKeepsVersions(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	if resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	resp, raw := deletePackage(t, app, validCourseSlug, "Bearer "+adminToken)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unpublish: want 200 got %d body=%s", resp.StatusCode, raw)
	}

	if n := countWhere(t, pool, "published_courses", "slug = $1", validCourseSlug); n != 0 {
		t.Errorf("published_courses after unpublish: want 0 rows got %d", n)
	}
	if n := countWhere(t, pool, "published_chapters", "slug = $1", validCourseSlug); n != 0 {
		t.Errorf("published_chapters after unpublish: want 0 rows got %d (ON DELETE CASCADE should have cleared it)", n)
	}
	if n := countWhere(t, pool, "published_widgets", "slug = $1", validCourseSlug); n != 0 {
		t.Errorf("published_widgets after unpublish: want 0 rows got %d", n)
	}
	// The whole point: course_versions has NO foreign key back to
	// published_courses, precisely so this delete cannot cascade the
	// archive away.
	if n := countWhere(t, pool, "course_versions", "slug = $1 AND version = 1", validCourseSlug); n != 1 {
		t.Errorf("course_versions after unpublish: want version 1 preserved, got %d matching rows", n)
	}

	audit := lastAudit(t, pool, validCourseSlug, "unpublish")
	if audit.actor != "cli" {
		t.Errorf("audit.actor: want %q got %q", "cli", audit.actor)
	}

	// Unpublishing an already-unpublished (or never-published) slug is a
	// no-op with nothing to undo: 404, not 200.
	resp2, _ := deletePackage(t, app, validCourseSlug, "Bearer "+adminToken)
	if resp2.StatusCode != http.StatusNotFound {
		t.Errorf("unpublish already-gone slug: want 404 got %d", resp2.StatusCode)
	}
}

// TestUnpublishAndRollbackRecordSessionActor is the same audit.who/actor
// assertion TestPublishRequiresAdminRole makes for Publish, but for the
// OTHER two admin actions that write an audit row (Unpublish, Rollback).
// Every earlier test in this file drives Unpublish/Rollback through the
// token path (actor='cli', who=NULL) — this is the one place a session-
// authenticated admin's uid is checked all the way through to
// admin_audit.who for both of them, rather than assumed to work because
// Publish's own check passed.
func TestUnpublishAndRollbackRecordSessionActor(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie, uid, email := registerUser(t, app, "session-actor")
	promoteToAdmin(t, pool, email)
	zipBytes := validCourseZip(t)

	if resp, raw := putPackage(t, app, validCourseSlug, zipBytes, "", cookie); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish v1 (session): want 201 got %d body=%s", resp.StatusCode, raw)
	}
	if resp, raw := putPackage(t, app, validCourseSlug, zipBytes, "", cookie); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish v2 (session): want 201 got %d body=%s", resp.StatusCode, raw)
	}

	// rollbackPackage/deletePackage below only accept an auth HEADER
	// string, not a cookie, so this test builds its own requests directly
	// to authenticate via the session cookie instead.
	req := httptest.NewRequest(http.MethodPost, "/admin/courses/"+validCourseSlug+"/rollback",
		bytes.NewReader(mustJSONBody(t, map[string]int{"version": 1})))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("rollback (session): %v", err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("rollback (session): want 201 got %d body=%s", resp.StatusCode, raw)
	}

	rollbackAudit := lastAudit(t, pool, validCourseSlug, "rollback")
	if rollbackAudit.who == nil || *rollbackAudit.who != uid {
		t.Errorf("rollback audit.who: want %s got %v", uid, rollbackAudit.who)
	}
	if rollbackAudit.actor != "user" {
		t.Errorf("rollback audit.actor: want %q got %q", "user", rollbackAudit.actor)
	}

	unpubResp := httptest.NewRequest(http.MethodDelete, "/admin/courses/"+validCourseSlug, nil)
	unpubResp.AddCookie(cookie)
	uResp, err := app.Test(unpubResp, httpTimeoutMS)
	if err != nil {
		t.Fatalf("unpublish (session): %v", err)
	}
	uRaw, _ := io.ReadAll(uResp.Body)
	uResp.Body.Close()
	if uResp.StatusCode != http.StatusOK {
		t.Fatalf("unpublish (session): want 200 got %d body=%s", uResp.StatusCode, uRaw)
	}

	unpublishAudit := lastAudit(t, pool, validCourseSlug, "unpublish")
	if unpublishAudit.who == nil || *unpublishAudit.who != uid {
		t.Errorf("unpublish audit.who: want %s got %v", uid, unpublishAudit.who)
	}
	if unpublishAudit.actor != "user" {
		t.Errorf("unpublish audit.actor: want %q got %q", "user", unpublishAudit.actor)
	}
}

func mustJSONBody(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

// --- (f): rollback re-reads and republishes, never mutates history -------

func TestRollbackRepublishesFromStoredZip(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	zipBytes := validCourseZip(t)

	// Two ordinary publishes first, so there is real history to roll back
	// past: version 1, then version 2.
	if resp, raw := putPackage(t, app, validCourseSlug, zipBytes, "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish v1: want 201 got %d body=%s", resp.StatusCode, raw)
	}
	if resp, raw := putPackage(t, app, validCourseSlug, zipBytes, "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish v2: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	resp, raw := rollbackPackage(t, app, validCourseSlug, 1, "Bearer "+adminToken)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("rollback to v1: want 201 got %d body=%s", resp.StatusCode, raw)
	}
	var body struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal rollback body: %v (body=%s)", err, raw)
	}
	// Rollback is a RE-READ: it never resurrects version 1 itself or
	// deletes anything, it republishes as the NEXT sequence number.
	if body.Version != 3 {
		t.Errorf("rollback version: want 3 got %d", body.Version)
	}

	// Every version row from 1 through 3 must exist — nothing was mutated
	// or deleted to "undo" versions 2 or 3.
	for _, v := range []int{1, 2, 3} {
		if n := countWhere(t, pool, "course_versions", "slug = $1 AND version = $2", validCourseSlug, v); n != 1 {
			t.Errorf("course_versions@%d after rollback: want 1 row got %d", v, n)
		}
	}
	if n := countWhere(t, pool, "published_courses", "slug = $1 AND version = 3", validCourseSlug); n != 1 {
		t.Errorf("published_courses live version after rollback: want 3, count=%d", n)
	}

	audit := lastAudit(t, pool, validCourseSlug, "rollback")
	if audit.note == "" {
		t.Fatal("rollback audit note is empty; must state from/to versions")
	}
	if !containsAll(audit.note, "1", "3") {
		t.Errorf("rollback audit note %q must mention both the source version (1) and the new version (3)", audit.note)
	}

	// Rolling back to a version that was never published is a 404, not a
	// 500 or a silent no-op.
	resp2, _ := rollbackPackage(t, app, validCourseSlug, 99, "Bearer "+adminToken)
	if resp2.StatusCode != http.StatusNotFound {
		t.Errorf("rollback to nonexistent version: want 404 got %d", resp2.StatusCode)
	}
}

func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		if !bytes.Contains([]byte(s), []byte(sub)) {
			return false
		}
	}
	return true
}

// --- (g): the URL's slug must equal the manifest's own id ----------------

func TestPublishSlugMismatchIsRejected(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	// valid-course's manifest names "mau-hop-le"; addressing it at a
	// different URL slug must be refused before anything is written —
	// this is the equality that keeps the URL and the package's own
	// identity from silently drifting apart.
	resp, raw := putPackage(t, app, "wrong-slug", validCourseZip(t), "Bearer "+adminToken, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("slug mismatch: want 400 got %d body=%s", resp.StatusCode, raw)
	}

	var body struct {
		Error    string `json:"error"`
		Findings []any  `json:"findings"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal 400 body: %v (body=%s)", err, raw)
	}
	if body.Error == "" {
		t.Error("slug mismatch: want a non-empty error message")
	}
	if body.Findings == nil {
		t.Error(`slug mismatch: "findings" must be present (even if empty), never omitted`)
	}

	for _, slug := range []string{"wrong-slug", validCourseSlug} {
		if n := countWhere(t, pool, "published_courses", "slug = $1", slug); n != 0 {
			t.Errorf("published_courses for %s after a slug mismatch: want 0 got %d", slug, n)
		}
		if n := countWhere(t, pool, "course_versions", "slug = $1", slug); n != 0 {
			t.Errorf("course_versions for %s after a slug mismatch: want 0 got %d", slug, n)
		}
	}
}

// minimalPackageZip builds a from-scratch, minimally-valid v2 package
// whose manifest "id" is exactly slug — used where a fixture directory
// name cannot BE the id under test (a directory literally named "slug
// with spaces" is not a portable thing to commit to fixtures/format-v2/).
func minimalPackageZip(t *testing.T, slug string) []byte {
	t.Helper()

	manifest := map[string]any{
		"id": slug, "title": "T", "description": "d", "lang": "vi",
		"version": "1.0.0", "runtime": "^1", "license": "CC0-1.0",
		"generatedBy": "human",
		"authors":     []map[string]string{{"name": "x"}},
		"parts": []map[string]any{{
			"title": "P",
			"chapters": []map[string]any{
				{"id": "c1", "num": "1", "title": "C1", "short": "C1", "file": "chapters/c1.html"},
			},
		}},
	}
	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal synthetic manifest: %v", err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range []struct{ name, data string }{
		{"manifest.json", string(manifestJSON)},
		{"chapters/c1.html", "<p>hi</p>"},
	} {
		w, err := zw.Create(e.name)
		if err != nil {
			t.Fatalf("zip create %s: %v", e.name, err)
		}
		if _, err := w.Write([]byte(e.data)); err != nil {
			t.Fatalf("zip write %s: %v", e.name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

// TestPublishSlugNeedingURLEncodingRoundTrips is the direct regression
// test for urlSlug's own doc comment: nothing restricts a manifest's "id"
// to URL-safe characters, and Task 4's CLI builds the request URL with
// encodeURIComponent(manifest.id). A slug containing a character that
// needs escaping (a space) must still publish successfully — the decoded
// URL segment must equal the decoded manifest id, not the raw, still
// percent-encoded URL segment.
func TestPublishSlugNeedingURLEncodingRoundTrips(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	slug := "slug with spaces"
	zipBytes := minimalPackageZip(t, slug)

	req := httptest.NewRequest(http.MethodPut, "/admin/courses/"+url.PathEscape(slug), bytes.NewReader(zipBytes))
	req.Header.Set("Content-Type", "application/zip")
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("PUT: %v", err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish slug with a space: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	var body struct {
		Slug string `json:"slug"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal 201 body: %v (body=%s)", err, raw)
	}
	if body.Slug != slug {
		t.Errorf("201 slug: want %q got %q", slug, body.Slug)
	}
	if n := countWhere(t, pool, "published_courses", "slug = $1", slug); n != 1 {
		t.Errorf("published_courses for %q: want 1 row got %d", slug, n)
	}
}

// --- Repo.Publish atomicity: no half-published course, no unlogged action

// TestPublishRollsBackOnPartialFailure calls Repo.Publish directly (not
// through the HTTP layer or pkgcheck) with two chapters sharing one
// chapter_id — published_chapters's PRIMARY KEY (slug, chapter_id) accepts
// the first, then rejects the second. If the four writes plus the audit
// insert were not one transaction, course_versions's row (written FIRST,
// before either chapter) would survive this failure; this proves it does
// not.
func TestPublishRollsBackOnPartialFailure(t *testing.T) {
	pool := store.TestPool(t)
	repo := catalog.NewRepo(pool)
	slug := "atomicity-duplicate-chapter"

	in := catalog.PublishInput{
		Slug:         slug,
		Title:        "Atomicity test",
		Lang:         "vi",
		ManifestJSON: []byte(`{"id":"atomicity-duplicate-chapter"}`),
		Chapters: []pkgcheck.Chapter{
			{ID: "dup", File: "chapters/a.html", HTML: "<p>a</p>"},
			{ID: "dup", File: "chapters/b.html", HTML: "<p>b</p>"},
		},
		Widgets:  map[string]string{},
		Assets:   map[string][]byte{},
		ZipBytes: []byte("PK\x03\x04-atomicity-a"),
		Action:   "publish",
	}

	if _, err := repo.Publish(context.Background(), nil, in); err == nil {
		t.Fatal("want an error from a duplicate chapter_id (published_chapters PK violation), got nil")
	}

	if n := countWhere(t, pool, "course_versions", "slug = $1", slug); n != 0 {
		t.Errorf("course_versions after a failed publish: want 0 rows (the FIRST statement must roll back too) got %d", n)
	}
	if n := countWhere(t, pool, "published_courses", "slug = $1", slug); n != 0 {
		t.Errorf("published_courses after a failed publish: want 0 rows got %d", n)
	}
	if n := countWhere(t, pool, "published_chapters", "slug = $1", slug); n != 0 {
		t.Errorf("published_chapters after a failed publish: want 0 rows (not even the ONE chapter that inserted cleanly) got %d", n)
	}
}

// TestPublishRollsBackWhenAuditInsertFails forces the failure into the
// LAST statement Publish executes (admin_audit's who -> users(id) foreign
// key, given a uuid that names no real user) specifically to answer the
// task brief's own question: "if the publish commits and the audit insert
// fails, you have an unlogged admin action." Every other statement here
// WOULD have succeeded on its own — this proves that does not matter: a
// failure anywhere in the sequence, including the very last step, still
// leaves nothing published.
func TestPublishRollsBackWhenAuditInsertFails(t *testing.T) {
	pool := store.TestPool(t)
	repo := catalog.NewRepo(pool)
	slug := "atomicity-bad-audit-fk"
	ghostUser := uuid.New() // well-formed, but no such row in users

	in := catalog.PublishInput{
		Slug:         slug,
		Title:        "Atomicity test",
		Lang:         "vi",
		ManifestJSON: []byte(`{"id":"atomicity-bad-audit-fk"}`),
		Chapters: []pkgcheck.Chapter{
			{ID: "c1", File: "chapters/a.html", HTML: "<p>a</p>"},
		},
		Widgets:  map[string]string{},
		Assets:   map[string][]byte{},
		ZipBytes: []byte("PK\x03\x04-atomicity-b"),
		Action:   "publish",
	}

	if _, err := repo.Publish(context.Background(), &ghostUser, in); err == nil {
		t.Fatal("want an error from admin_audit.who referencing a nonexistent user, got nil")
	}

	if n := countWhere(t, pool, "published_courses", "slug = $1", slug); n != 0 {
		t.Errorf("published_courses after a failed audit insert: want 0 rows (an unlogged publish must never happen) got %d", n)
	}
	if n := countWhere(t, pool, "course_versions", "slug = $1", slug); n != 0 {
		t.Errorf("course_versions after a failed audit insert: want 0 rows got %d", n)
	}
	if n := countWhere(t, pool, "published_chapters", "slug = $1", slug); n != 0 {
		t.Errorf("published_chapters after a failed audit insert: want 0 rows got %d", n)
	}
}

// --- adminOrToken: the empty-configured-token trap ------------------------

// TestEmptyAdminTokenNeverMatches is an end-to-end sanity check that an
// unconfigured admin token (AdminToken == "") never authenticates a real
// HTTP request, in whatever shape that request happens to arrive in.
//
// It does NOT — and, it turns out, cannot — directly exercise the specific
// subtle.ConstantTimeCompare([]byte(""), []byte("")) == 1 edge case: a
// request literally spelling "Authorization: Bearer " (trailing space,
// empty token) reaches server.bearerToken as "Bearer" (six bytes, no
// space) rather than "Bearer " (seven bytes), because fasthttp trims
// trailing OWS from header values while parsing — confirmed empirically
// while writing this test, not assumed. So this request is refused via the
// ordinary "no Bearer token supplied at all" path, not via the
// empty-configured-token guard specifically. The guard itself — the one
// property the task brief calls out by name — is proven directly,
// HTTP-free, by internal/server's own TestAdminTokenMatches (which calls
// the unexported comparison function with configured="" and supplied=""
// and asserts false, then was mutation-verified: deleting the guard turns
// that assertion red). This test is kept anyway as the outer, "does the
// real request path actually refuse it" confirmation.
func TestEmptyAdminTokenNeverMatches(t *testing.T) {
	pool := store.TestPool(t)
	app := server.New(config.Config{CookieSecure: false, AdminToken: ""},
		server.Deps{Pool: pool, LogOutput: io.Discard})

	resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer ", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("empty configured token + empty Bearer: want 401 got %d body=%s", resp.StatusCode, raw)
	}
	if n := countWhere(t, pool, "published_courses", "slug = $1", validCourseSlug); n != 0 {
		t.Errorf("published_courses after a would-be empty-token bypass: want 0 rows got %d", n)
	}
}

func TestWrongAdminTokenIsRejected(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	resp, _ := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer not-the-configured-token", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong token, no session: want 401 got %d", resp.StatusCode)
	}
}

// TestAdminRoutesAllRequireAuth hits every one of the four admin routes
// with neither a token nor a session cookie. mountAdmin (server.go)
// registers all four through the identical four-handler chain, and the
// other tests in this file only ever exercise that chain via PUT — this
// closes the gap directly rather than resting on "the other three surely
// compose the same way".
func TestAdminRoutesAllRequireAuth(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	if resp, _ := putPackage(t, app, validCourseSlug, validCourseZip(t), "", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("PUT /admin/courses/:slug without auth: want 401 got %d", resp.StatusCode)
	}
	if resp, _ := listAdminCourses(t, app, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("GET /admin/courses without auth: want 401 got %d", resp.StatusCode)
	}
	if resp, _ := deletePackage(t, app, validCourseSlug, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("DELETE /admin/courses/:slug without auth: want 401 got %d", resp.StatusCode)
	}
	if resp, _ := rollbackPackage(t, app, validCourseSlug, 1, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("POST /admin/courses/:slug/rollback without auth: want 401 got %d", resp.StatusCode)
	}
}

// --- GET /admin/courses ---------------------------------------------------

func TestAdminListReflectsPublishedCoursesAndVersionHistory(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	zipBytes := validCourseZip(t)

	if resp, raw := putPackage(t, app, validCourseSlug, zipBytes, "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish v1: want 201 got %d body=%s", resp.StatusCode, raw)
	}
	if resp, raw := putPackage(t, app, validCourseSlug, zipBytes, "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish v2: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	resp, raw := listAdminCourses(t, app, "Bearer "+adminToken)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list: want 200 got %d body=%s", resp.StatusCode, raw)
	}

	var rows []struct {
		Slug     string `json:"slug"`
		Version  int    `json:"version"`
		Versions []int  `json:"versions"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("unmarshal list body: %v (body=%s)", err, raw)
	}
	var found *struct {
		Slug     string `json:"slug"`
		Version  int    `json:"version"`
		Versions []int  `json:"versions"`
	}
	for i := range rows {
		if rows[i].Slug == validCourseSlug {
			found = &rows[i]
		}
	}
	if found == nil {
		t.Fatalf("list: %s not present in %+v", validCourseSlug, rows)
	}
	if found.Version != 2 {
		t.Errorf("list: current version want 2 got %d", found.Version)
	}
	if len(found.Versions) != 2 || found.Versions[0] != 1 || found.Versions[1] != 2 {
		t.Errorf("list: versions want [1 2] got %v", found.Versions)
	}
}

// =========================================================================
// Task 9: the public read path.
//
// Every request in this section carries NO cookie and NO Authorization
// header at all — that omission IS the test for "no auth on any of the
// four routes" (spec §2.4); there is no separate assertion for it because
// there is nothing to assert beyond "a request that authenticates nothing
// still gets a 200".
// =========================================================================

// getPublic issues a plain, unauthenticated GET.
func getPublic(t *testing.T, app *fiber.App, target string) (*http.Response, []byte) {
	t.Helper()
	return getPublicWithHeaders(t, app, target, nil)
}

// getPublicWithHeaders is getPublic plus arbitrary request headers — every
// caller that passes any is testing If-None-Match.
func getPublicWithHeaders(t *testing.T, app *fiber.App, target string, headers map[string]string) (*http.Response, []byte) {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, target, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("GET %s: %v", target, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("GET %s: read body: %v", target, err)
	}
	resp.Body.Close()
	return resp, raw
}

// publicListApp mounts ONLY catalogHandler.PublicList, on a throwaway app
// rather than through server.New — see server.go's own comment on why
// GET /courses is not wired into the shared app until this task's second
// commit unmounts the OLD private-catalog route at that exact path (fiber
// dispatches an identical (method, path) pair to whichever route was
// registered FIRST, verified empirically while building this task, so the
// two cannot coexist at "/courses" in the same *fiber.App). This app proves
// the production Handler.PublicList method itself is correct; server.go's
// own wiring is proven separately once the second commit frees the path.
func publicListApp(pool *pgxpool.Pool) *fiber.App {
	h := catalog.NewHandler(catalog.NewUsecase(catalog.NewRepo(pool)))
	app := fiber.New()
	app.Get("/courses", h.PublicList)
	return app
}

type publicCourseSummary struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Lang        string `json:"lang"`
	Description string `json:"description"`
	Version     int    `json:"version"`
}

// TestPublicListNoAuth is the brief's "list" case: GET /courses, no cookie,
// returns every currently-live course with the version integer this SERVER
// owns (the publish sequence), never the manifest's own semver — the two
// are deliberately different numbers (validCourseZip's manifest says
// "version": "1.0.0"; the assertion below is for the INTEGER 1).
func TestPublicListNoAuth(t *testing.T) {
	pool := store.TestPool(t)
	adminApp := newTestApp(pool)
	listApp := publicListApp(pool)

	// Anti-vacuity, checked FIRST: an empty catalog is `[]`, never `null` —
	// a client that calls .map() on the response must not throw.
	resp, raw := getPublic(t, listApp, "/courses")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /courses (empty catalog): want 200 got %d body=%s", resp.StatusCode, raw)
	}
	if strings.TrimSpace(string(raw)) != "[]" {
		t.Errorf("GET /courses (empty catalog): want `[]` got %s", raw)
	}

	if resp, raw := putPackage(t, adminApp, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	resp, raw = getPublic(t, listApp, "/courses")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /courses: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var items []publicCourseSummary
	if err := json.Unmarshal(raw, &items); err != nil {
		t.Fatalf("GET /courses: unmarshal %s: %v", raw, err)
	}
	var found *publicCourseSummary
	for i := range items {
		if items[i].Slug == validCourseSlug {
			found = &items[i]
		}
	}
	if found == nil {
		t.Fatalf("GET /courses: %s not present in %+v", validCourseSlug, items)
	}
	if found.Lang != "vi" {
		t.Errorf("GET /courses: lang want %q got %q", "vi", found.Lang)
	}
	if found.Title == "" || found.Description == "" {
		t.Errorf("GET /courses: title/description must be populated, got %+v", found)
	}
	if found.Version != 1 {
		t.Errorf("GET /courses: version want the server's publish sequence (1) got %d "+
			"(the manifest's own semver is \"1.0.0\" — these must never be confused)", found.Version)
	}

	// ETag: present, and a repeat request naming it back gets 304 with an
	// empty body.
	etag := resp.Header.Get("ETag")
	if etag == "" {
		t.Fatal("GET /courses: no ETag header")
	}
	resp2, raw2 := getPublicWithHeaders(t, listApp, "/courses", map[string]string{"If-None-Match": etag})
	if resp2.StatusCode != http.StatusNotModified {
		t.Errorf("GET /courses with a matching If-None-Match: want 304 got %d", resp2.StatusCode)
	}
	if len(raw2) != 0 {
		t.Errorf("GET /courses 304: want an empty body, got %d bytes", len(raw2))
	}

	// Republishing changes the version, which must change the listing's
	// ETag — an old cached response becomes stale the moment the catalog
	// state it described stops being true.
	if resp, raw := putPackage(t, adminApp, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("republish: want 201 got %d body=%s", resp.StatusCode, raw)
	}
	resp3, _ := getPublicWithHeaders(t, listApp, "/courses", map[string]string{"If-None-Match": etag})
	newETag := resp3.Header.Get("ETag")
	if newETag == etag {
		t.Errorf("ETag did not change after a republish: still %q", etag)
	}
	if resp3.StatusCode != http.StatusOK {
		t.Errorf("GET /courses with a STALE If-None-Match after a republish: want 200 (fresh body) got %d", resp3.StatusCode)
	}
}

// TestPublicManifestNoAuth is the brief's "manifest" case: GET
// /courses/:slug returns manifest.json's own content, unwrapped, with no
// cookie required.
func TestPublicManifestNoAuth(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	if resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	resp, raw := getPublic(t, app, "/courses/"+validCourseSlug)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /courses/%s: want 200 got %d body=%s", validCourseSlug, resp.StatusCode, raw)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("GET manifest Content-Type: want application/json got %q", ct)
	}

	var manifest map[string]any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("GET manifest: unmarshal %s: %v", raw, err)
	}
	if manifest["id"] != validCourseSlug {
		t.Errorf(`manifest "id": want %q got %v`, validCourseSlug, manifest["id"])
	}
	// The response is the manifest ITSELF, not an envelope around it — no
	// "manifest" or "version" wrapper key.
	if _, wrapped := manifest["manifest"]; wrapped {
		t.Errorf("GET manifest response is wrapped in an envelope: %s", raw)
	}

	// 404 for a slug that has never been published.
	notFound, nfBody := getPublic(t, app, "/courses/no-such-course")
	if notFound.StatusCode != http.StatusNotFound {
		t.Errorf("GET /courses/no-such-course: want 404 got %d body=%s", notFound.StatusCode, nfBody)
	}

	// ETag: W/"<slug>-<version>", and a matching If-None-Match gets 304.
	wantETag := `W/"` + validCourseSlug + `-1"`
	if etag := resp.Header.Get("ETag"); etag != wantETag {
		t.Errorf("ETag: want %q got %q", wantETag, etag)
	}
	cached, cachedBody := getPublicWithHeaders(t, app, "/courses/"+validCourseSlug, map[string]string{"If-None-Match": wantETag})
	if cached.StatusCode != http.StatusNotModified {
		t.Errorf("GET manifest with a matching If-None-Match: want 304 got %d body=%s", cached.StatusCode, cachedBody)
	}
	if len(cachedBody) != 0 {
		t.Errorf("GET manifest 304: want an empty body, got %d bytes", len(cachedBody))
	}

	// Republishing bumps the version, which must invalidate a cache holding
	// the old ETag: the OLD validator no longer matches, so the client gets
	// a fresh 200 (never a 304 for content that has moved on) and a NEW
	// ETag naming the new version — this is exactly what the version
	// integer in the ETag is for.
	if resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("republish: want 201 got %d body=%s", resp.StatusCode, raw)
	}
	stale, staleBody := getPublicWithHeaders(t, app, "/courses/"+validCourseSlug, map[string]string{"If-None-Match": wantETag})
	if stale.StatusCode != http.StatusOK {
		t.Errorf("GET manifest with a STALE If-None-Match after republish: want 200 got %d", stale.StatusCode)
	}
	wantNewETag := `W/"` + validCourseSlug + `-2"`
	if got := stale.Header.Get("ETag"); got != wantNewETag {
		t.Errorf("ETag after republish: want %q got %q", wantNewETag, got)
	}
	if len(staleBody) == 0 {
		t.Error("GET manifest after republish (stale If-None-Match): want a real body, got none")
	}
}

// chapterResponse mirrors GET /courses/:slug/chapters/:chapterId's JSON
// contract — declared here rather than imported so a change to the wire
// shape has to be made twice, deliberately, the same discipline
// courseSummary above already applies to the admin listing.
type chapterResponse struct {
	HTML    string `json:"html"`
	Widgets []struct {
		Name string `json:"name"`
		HTML string `json:"html"`
	} `json:"widgets"`
}

// TestPublicChapterNoAuth is the brief's "chapter (+ widgets đúng theo
// widget_names)" case: valid-course's own c1 (no widget) and c2 (one
// widget, "dem-so") pin both shapes — an ordinary chapter's widgets array
// must be `[]`, never `null`, and a chapter that references a widget must
// get that widget's OWN html back, not merely its name.
func TestPublicChapterNoAuth(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	if resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	widgetHTML, err := os.ReadFile(filepath.Join(fixturesRoot, "valid-course", "widgets", "dem-so", "index.html"))
	if err != nil {
		t.Fatalf("read widget fixture: %v", err)
	}

	resp1, raw1 := getPublic(t, app, "/courses/"+validCourseSlug+"/chapters/c1")
	if resp1.StatusCode != http.StatusOK {
		t.Fatalf("GET chapter c1: want 200 got %d body=%s", resp1.StatusCode, raw1)
	}
	var ch1 chapterResponse
	if err := json.Unmarshal(raw1, &ch1); err != nil {
		t.Fatalf("GET chapter c1: unmarshal %s: %v", raw1, err)
	}
	if !strings.Contains(ch1.HTML, "Vì sao đếm cần một biến") {
		t.Errorf("GET chapter c1: html does not look like the packed fixture: %s", ch1.HTML)
	}
	if ch1.Widgets == nil || len(ch1.Widgets) != 0 {
		t.Errorf("GET chapter c1 (no data-widget): widgets want [] got %+v", ch1.Widgets)
	}

	resp2, raw2 := getPublic(t, app, "/courses/"+validCourseSlug+"/chapters/c2")
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("GET chapter c2: want 200 got %d body=%s", resp2.StatusCode, raw2)
	}
	var ch2 chapterResponse
	if err := json.Unmarshal(raw2, &ch2); err != nil {
		t.Fatalf("GET chapter c2: unmarshal %s: %v", raw2, err)
	}
	if len(ch2.Widgets) != 1 || ch2.Widgets[0].Name != "dem-so" {
		t.Fatalf("GET chapter c2: widgets want exactly one entry named %q, got %+v", "dem-so", ch2.Widgets)
	}
	if ch2.Widgets[0].HTML != string(widgetHTML) {
		t.Errorf("GET chapter c2: widget html does not match the packed widgets/dem-so/index.html "+
			"(want %d bytes, got %d)", len(widgetHTML), len(ch2.Widgets[0].HTML))
	}

	// 404: unknown chapter within a real slug, and any chapter within an
	// unknown slug — indistinguishable, per repo.go's own doc.
	for _, target := range []string{
		"/courses/" + validCourseSlug + "/chapters/no-such-chapter",
		"/courses/no-such-slug/chapters/c1",
	} {
		resp, raw := getPublic(t, app, target)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s: want 404 got %d body=%s", target, resp.StatusCode, raw)
		}
	}

	// ETag: same shape and same republish-invalidates property as the
	// manifest route, keyed on the SAME course version (there is no
	// per-chapter version — see GetPublishedChapter's own doc).
	wantETag := `W/"` + validCourseSlug + `-1"`
	if etag := resp1.Header.Get("ETag"); etag != wantETag {
		t.Errorf("chapter ETag: want %q got %q", wantETag, etag)
	}
	cached, cachedBody := getPublicWithHeaders(t, app, "/courses/"+validCourseSlug+"/chapters/c1",
		map[string]string{"If-None-Match": wantETag})
	if cached.StatusCode != http.StatusNotModified {
		t.Errorf("GET chapter with a matching If-None-Match: want 304 got %d body=%s", cached.StatusCode, cachedBody)
	}
}

// packageWithAssets builds a minimal, valid v2 package for slug carrying
// exactly one chapter plus whatever extra package-relative paths are given
// in extra — used where the case under test is about ASSET behavior
// (content type, ETag) rather than chapter/widget mechanics, which
// TestPublicChapterNoAuth already covers via valid-course.
func packageWithAssets(t *testing.T, slug string, extra map[string][]byte) []byte {
	t.Helper()

	manifest := map[string]any{
		"id": slug, "title": "T", "description": "d", "lang": "vi",
		"version": "1.0.0", "runtime": "^1", "license": "CC0-1.0",
		"generatedBy": "human",
		"authors":     []map[string]string{{"name": "x"}},
		"parts": []map[string]any{{
			"title": "P",
			"chapters": []map[string]any{
				{"id": "c1", "num": "1", "title": "C1", "short": "C1", "file": "chapters/c1.html"},
			},
		}},
	}
	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	write := func(name string, data []byte) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatalf("zip write %s: %v", name, err)
		}
	}
	write("manifest.json", manifestJSON)
	write("chapters/c1.html", []byte("<p>hi</p>"))
	for name, data := range extra {
		write(name, data)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

// pngFixtureBytes is a PNG file signature plus filler that contains no
// '<' byte, so pkgcheck's content scan (gated on bytes.ContainsRune(data,
// '<')) never runs over it — the point of this fixture is Content-Type by
// EXTENSION, not package validation, and a false content-rule finding here
// would fail the publish for a reason unrelated to what this test checks.
var pngFixtureBytes = []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D}

// svgFixtureBytes is a small, benign SVG document: it DOES contain '<' and
// so is content-scanned at publish time, but carries none of the seven
// content rules' triggers (no <script>, no event-handler attribute, no
// javascript: URL, no embedded frame, no <form>), so it publishes cleanly —
// the point of this fixture is that SVG, despite being "an image" and
// despite passing every content rule, is STILL served as octet-stream, not
// as image/svg+xml (see assetContentType's own doc for why).
var svgFixtureBytes = []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2"/></svg>`)

// TestPublicAssetContentTypeAndETag is the brief's "asset" case: a bitmap
// extension gets its real Content-Type; everything else — SVG included —
// gets application/octet-stream plus X-Content-Type-Options: nosniff.
func TestPublicAssetContentTypeAndETag(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	const slug = "asset-content-type"

	pkg := packageWithAssets(t, slug, map[string][]byte{
		"pic.png":  pngFixtureBytes,
		"icon.svg": svgFixtureBytes,
	})
	if resp, raw := putPackage(t, app, slug, pkg, "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	png, pngBody := getPublic(t, app, "/courses/"+slug+"/assets/pic.png")
	if png.StatusCode != http.StatusOK {
		t.Fatalf("GET pic.png: want 200 got %d body=%s", png.StatusCode, pngBody)
	}
	if ct := png.Header.Get("Content-Type"); ct != "image/png" {
		t.Errorf("GET pic.png Content-Type: want image/png got %q", ct)
	}
	if !bytes.Equal(pngBody, pngFixtureBytes) {
		t.Errorf("GET pic.png: bytes do not round-trip: want %v got %v", pngFixtureBytes, pngBody)
	}
	if nosniff := png.Header.Get("X-Content-Type-Options"); nosniff != "" {
		t.Errorf("GET pic.png: a bitmap must not carry nosniff (its type is trusted), got %q", nosniff)
	}

	svg, svgBody := getPublic(t, app, "/courses/"+slug+"/assets/icon.svg")
	if svg.StatusCode != http.StatusOK {
		t.Fatalf("GET icon.svg: want 200 got %d body=%s", svg.StatusCode, svgBody)
	}
	if ct := svg.Header.Get("Content-Type"); ct != "application/octet-stream" {
		t.Errorf("GET icon.svg Content-Type: want application/octet-stream (SVG can carry script — "+
			"see assetContentType's own doc) got %q", ct)
	}
	if nosniff := svg.Header.Get("X-Content-Type-Options"); nosniff != "nosniff" {
		t.Errorf("GET icon.svg X-Content-Type-Options: want nosniff got %q", nosniff)
	}
	if !bytes.Equal(svgBody, svgFixtureBytes) {
		t.Errorf("GET icon.svg: bytes do not round-trip: want %s got %s", svgFixtureBytes, svgBody)
	}

	// 404: unknown asset within a real slug, and any asset within an
	// unknown slug.
	for _, target := range []string{
		"/courses/" + slug + "/assets/does-not-exist.png",
		"/courses/no-such-slug/assets/pic.png",
	} {
		resp, raw := getPublic(t, app, target)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s: want 404 got %d body=%s", target, resp.StatusCode, raw)
		}
	}

	// ETag: keyed on the course's version (there is no per-asset version —
	// see GetPublishedAsset's own doc), same shape as manifest/chapter.
	wantETag := `W/"` + slug + `-1"`
	if etag := png.Header.Get("ETag"); etag != wantETag {
		t.Errorf("asset ETag: want %q got %q", wantETag, etag)
	}
	cached, cachedBody := getPublicWithHeaders(t, app, "/courses/"+slug+"/assets/pic.png",
		map[string]string{"If-None-Match": wantETag})
	if cached.StatusCode != http.StatusNotModified {
		t.Errorf("GET asset with a matching If-None-Match: want 304 got %d body=%s", cached.StatusCode, cachedBody)
	}
	if len(cachedBody) != 0 {
		t.Errorf("GET asset 304: want an empty body, got %d bytes", len(cachedBody))
	}
}
