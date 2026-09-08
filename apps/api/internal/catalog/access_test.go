package catalog_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vndee/tuhoc-api/internal/catalog"
	"github.com/vndee/tuhoc-api/internal/store"
)

// privateCourseWithReader publishes the fixture, marks it private, and returns
// the repo plus one ordinary registered account.
func privateCourseWithReader(t *testing.T) (*catalog.PostgresRepo, *fiber.App, *pgxpool.Pool, uuid.UUID, string) {
	t.Helper()
	pool := store.TestPool(t)
	app := newTestApp(pool)
	if resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish: want 201 got %d body=%s", resp.StatusCode, raw)
	}
	repo := catalog.NewRepo(pool)
	if err := repo.SetVisibility(context.Background(), nil, validCourseSlug, catalog.VisibilityPrivate); err != nil {
		t.Fatalf("SetVisibility: %v", err)
	}
	_, uid, email := registerUser(t, app, "reader")
	return repo, app, pool, uid, email
}

// TestGrantOpensEveryReadPathAndOnlyForTheGrantee is the feature's whole
// claim, and it is one test over all six read paths for the same reason the
// visibility test is: the failure mode is a SEVENTH path that checks only
// some of the rule.
func TestGrantOpensEveryReadPathAndOnlyForTheGrantee(t *testing.T) {
	repo, _, _, uid, email := privateCourseWithReader(t)
	ctx := context.Background()

	granted := catalog.Viewer{UID: uid}
	stranger := catalog.Viewer{UID: uuid.New()}
	anon := catalog.Viewer{}

	// Before the grant, the reader is nobody special.
	if _, err := repo.GetPublished(ctx, validCourseSlug, granted); err != catalog.ErrNotFound {
		t.Fatalf("before grant: want ErrNotFound got %v", err)
	}

	if err := repo.GrantAccess(ctx, nil, validCourseSlug, email); err != nil {
		t.Fatalf("GrantAccess: %v", err)
	}

	// 1. catalogue
	list, err := repo.ListPublished(ctx, granted)
	if err != nil {
		t.Fatalf("ListPublished(granted): %v", err)
	}
	var seen bool
	for _, c := range list {
		if c.Slug == validCourseSlug {
			seen = true
		}
	}
	if !seen {
		t.Errorf("ListPublished(granted): the granted course is missing from their catalogue")
	}

	// 2-5. course, chapter, widget, asset
	if _, err := repo.GetPublished(ctx, validCourseSlug, granted); err != nil {
		t.Errorf("GetPublished(granted): %v", err)
	}
	if _, _, err := repo.GetPublishedChapter(ctx, validCourseSlug, "c1", granted); err != nil {
		t.Errorf("GetPublishedChapter(granted): %v", err)
	}
	if got, err := repo.GetPublishedWidgets(ctx, validCourseSlug, []string{"dem-so"}, granted); err != nil || len(got) == 0 {
		t.Errorf("GetPublishedWidgets(granted): got %d widgets, err %v", len(got), err)
	}

	// 6. and NOBODY else. A grant is for one account, not for "logged in".
	for name, v := range map[string]catalog.Viewer{"stranger": stranger, "anonymous": anon} {
		if _, err := repo.GetPublished(ctx, validCourseSlug, v); err != catalog.ErrNotFound {
			t.Errorf("GetPublished(%s): want ErrNotFound got %v", name, err)
		}
		if _, _, err := repo.GetPublishedChapter(ctx, validCourseSlug, "c1", v); err != catalog.ErrNotFound {
			t.Errorf("GetPublishedChapter(%s): want ErrNotFound got %v", name, err)
		}
		l, err := repo.ListPublished(ctx, v)
		if err != nil {
			t.Fatalf("ListPublished(%s): %v", name, err)
		}
		for _, c := range l {
			if c.Slug == validCourseSlug {
				t.Errorf("ListPublished(%s): private course leaked into the public catalogue", name)
			}
		}
	}

	// Revoke closes it again.
	if err := repo.RevokeAccess(ctx, nil, validCourseSlug, email); err != nil {
		t.Fatalf("RevokeAccess: %v", err)
	}
	if _, err := repo.GetPublished(ctx, validCourseSlug, granted); err != catalog.ErrNotFound {
		t.Errorf("after revoke: want ErrNotFound got %v", err)
	}
}

// TestEnrollmentIsNotAccess is the negative test this design most needs.
//
// `POST /enrollments` sits behind auth.Require alone: ANY logged-in account
// can enroll itself in ANY course id, including one it cannot read. If
// enrollment were ever wired into the visibility rule — it is the obvious
// shortcut, and the table already exists — every reader could grant itself
// the private catalogue by calling one endpoint.
func TestEnrollmentIsNotAccess(t *testing.T) {
	repo, _, pool, uid, _ := privateCourseWithReader(t)
	ctx := context.Background()

	if _, err := pool.Exec(ctx,
		`INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)`, uid, validCourseSlug); err != nil {
		t.Fatalf("self-enroll: %v", err)
	}

	if _, err := repo.GetPublished(ctx, validCourseSlug, catalog.Viewer{UID: uid}); err != catalog.ErrNotFound {
		t.Fatalf("enrolling in a private course granted read access (%v) — enrollment is self-service", err)
	}
}

// TestGrantSurvivesRepublish guards the trap migration 0014 declines to walk
// into: course_access has NO foreign key to published_courses, because
// Publish deletes and reinserts that row and a cascade would wipe every grant
// each time the author fixes a typo.
func TestGrantSurvivesRepublish(t *testing.T) {
	repo, app, _, uid, email := privateCourseWithReader(t)
	ctx := context.Background()

	if err := repo.GrantAccess(ctx, nil, validCourseSlug, email); err != nil {
		t.Fatalf("GrantAccess: %v", err)
	}
	if resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("republish: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	if _, err := repo.GetPublished(ctx, validCourseSlug, catalog.Viewer{UID: uid}); err != nil {
		t.Fatalf("republishing revoked a grant: %v", err)
	}
}

// TestAccessRoutes covers the admin door.
func TestAccessRoutes(t *testing.T) {
	repo, app, _, uid, email := privateCourseWithReader(t)
	ctx := context.Background()

	call := func(t *testing.T, method, slug, body, auth string) (*http.Response, []byte) {
		t.Helper()
		var r io.Reader
		if body != "" {
			r = strings.NewReader(body)
		}
		req := httptest.NewRequest(method, "/admin/courses/"+slug+"/access", r)
		req.Header.Set("Content-Type", "application/json")
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		resp, err := app.Test(req, httpTimeoutMS)
		if err != nil {
			t.Fatalf("%s access: %v", method, err)
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return resp, raw
	}
	tok := "Bearer " + adminToken

	// No credentials: refused, and nothing changes.
	if resp, _ := call(t, http.MethodPost, validCourseSlug, `{"email":"`+email+`"}`, ""); resp.StatusCode == http.StatusOK {
		t.Errorf("unauthenticated grant: want refusal got 200")
	}
	if _, err := repo.GetPublished(ctx, validCourseSlug, catalog.Viewer{UID: uid}); err != catalog.ErrNotFound {
		t.Errorf("unauthenticated call changed state: %v", err)
	}

	// An email nobody has: 404 that says so, distinct from an unknown slug.
	if resp, raw := call(t, http.MethodPost, validCourseSlug, `{"email":"nobody@example.test"}`, tok); resp.StatusCode != http.StatusNotFound || !strings.Contains(string(raw), "account") {
		t.Errorf("unknown email: want 404 naming the account, got %d body=%s", resp.StatusCode, raw)
	}
	// An unknown slug: also 404, and not the account message.
	if resp, raw := call(t, http.MethodPost, "khong-ton-tai", `{"email":"`+email+`"}`, tok); resp.StatusCode != http.StatusNotFound || strings.Contains(string(raw), "account") {
		t.Errorf("unknown slug: want plain 404, got %d body=%s", resp.StatusCode, raw)
	}
	// Missing email: 400, not a silent no-op.
	if resp, _ := call(t, http.MethodPost, validCourseSlug, `{}`, tok); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("empty email: want 400 got %d", resp.StatusCode)
	}

	// The real grant, twice — the second must not be an error.
	for i := 0; i < 2; i++ {
		if resp, raw := call(t, http.MethodPost, validCourseSlug, `{"email":"`+email+`"}`, tok); resp.StatusCode != http.StatusOK {
			t.Fatalf("grant #%d: want 200 got %d body=%s", i+1, resp.StatusCode, raw)
		}
	}
	if _, err := repo.GetPublished(ctx, validCourseSlug, catalog.Viewer{UID: uid}); err != nil {
		t.Fatalf("after grant: %v", err)
	}

	// Listing shows them once, not twice.
	resp, raw := call(t, http.MethodGet, validCourseSlug, "", tok)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list access: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var rows []struct{ Email string }
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("list access: unmarshal %s: %v", raw, err)
	}
	if len(rows) != 1 || !strings.EqualFold(rows[0].Email, email) {
		t.Errorf("list access: want exactly [%s] got %+v", email, rows)
	}

	// Revoke, then revoke again: the second is 404, because telling an admin
	// "closed" when nothing was open is worse than telling them nothing.
	if resp, raw := call(t, http.MethodDelete, validCourseSlug, `{"email":"`+email+`"}`, tok); resp.StatusCode != http.StatusOK {
		t.Fatalf("revoke: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	if resp, _ := call(t, http.MethodDelete, validCourseSlug, `{"email":"`+email+`"}`, tok); resp.StatusCode != http.StatusNotFound {
		t.Errorf("revoke twice: want 404 got %d", resp.StatusCode)
	}
}
