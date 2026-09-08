package catalog_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vndee/tuhoc-api/internal/catalog"
	"github.com/vndee/tuhoc-api/internal/store"
)

// anonViewer / adminViewer name the two viewers this file's assertions use.
// Named rather than inline literals: `catalog.Viewer{}` at a call site reads
// like a placeholder, and "anonymous" is the actual claim being tested.
var (
	anonViewer  = catalog.Viewer{}
	adminViewer = catalog.Viewer{IsAdmin: true}
)

// publishAndHide publishes the standard fixture and marks it private,
// returning a repo over the same pool. Every test below starts here, so a
// failure to set up is a failure of the thing under test, not of the test.
func publishAndHide(t *testing.T) *catalog.PostgresRepo {
	t.Helper()
	pool := store.TestPool(t)
	app := newTestApp(pool)
	if resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish: want 201 got %d body=%s", resp.StatusCode, raw)
	}
	repo := catalog.NewRepo(pool)
	if err := repo.SetVisibility(context.Background(), nil, validCourseSlug, catalog.VisibilityPrivate); err != nil {
		t.Fatalf("SetVisibility(private): %v", err)
	}
	return repo
}

// TestPrivateCourseIsHiddenFromEveryReadPath is the whole point of the
// feature, and it is written as ONE test over ALL SIX read paths on purpose.
//
// The tempting shape is six small tests. The failure this guards against is
// not "one path is wrong" — it is "someone adds a seventh path and gates only
// the catalog", which is exactly how a private course ends up invisible in
// the listing and readable by anyone who types the slug. Keeping the six in
// one place, with one comment saying they must stay six, is the cheapest
// warning a future reader gets.
func TestPrivateCourseIsHiddenFromEveryReadPath(t *testing.T) {
	repo := publishAndHide(t)
	ctx := context.Background()

	// 1. the catalog listing
	list, err := repo.ListPublished(ctx, anonViewer)
	if err != nil {
		t.Fatalf("ListPublished(anon): %v", err)
	}
	for _, c := range list {
		if c.Slug == validCourseSlug {
			t.Errorf("ListPublished(anon): private course %s is in the public catalog", validCourseSlug)
		}
	}

	// 2. the course itself, by slug — ErrNotFound, never a distinguishable
	//    "forbidden": a different status would confirm the slug exists.
	if _, err := repo.GetPublished(ctx, validCourseSlug, anonViewer); err != catalog.ErrNotFound {
		t.Errorf("GetPublished(anon): want ErrNotFound got %v", err)
	}

	// 3. a chapter
	if _, _, err := repo.GetPublishedChapter(ctx, validCourseSlug, "c1", anonViewer); err != catalog.ErrNotFound {
		t.Errorf("GetPublishedChapter(anon): want ErrNotFound got %v", err)
	}

	// 4. a widget — a whole embedded program, so it carries content too
	got, err := repo.GetPublishedWidgets(ctx, validCourseSlug, []string{"dem-so"}, anonViewer)
	if err != nil {
		t.Fatalf("GetPublishedWidgets(anon): %v", err)
	}
	if len(got) != 0 {
		t.Errorf("GetPublishedWidgets(anon): want none got %d", len(got))
	}

	// 5. an asset
	if _, _, err := repo.GetPublishedAsset(ctx, validCourseSlug, "assets/anh.png", anonViewer); err != catalog.ErrNotFound {
		t.Errorf("GetPublishedAsset(anon): want ErrNotFound got %v", err)
	}

	// 6. the ADMIN still sees all of it — otherwise this is not a visibility
	//    feature, it is an unpublish with extra steps.
	adminList, err := repo.ListPublished(ctx, adminViewer)
	if err != nil {
		t.Fatalf("ListPublished(admin): %v", err)
	}
	var seen bool
	for _, c := range adminList {
		if c.Slug == validCourseSlug {
			seen = true
			if c.Visibility != catalog.VisibilityPrivate {
				t.Errorf("ListPublished(admin): visibility want private got %q", c.Visibility)
			}
		}
	}
	if !seen {
		t.Errorf("ListPublished(admin): private course %s must still be visible to an admin", validCourseSlug)
	}
	if _, err := repo.GetPublished(ctx, validCourseSlug, adminViewer); err != nil {
		t.Errorf("GetPublished(admin): want the course got %v", err)
	}
}

// TestRepublishKeepsVisibility is the regression this feature most needs.
//
// Publish REPLACES the live row (DELETE then INSERT), and `visibility` is set
// by a separate call, so without an explicit read-back the column reverts to
// its default — 'public'. The course would go public again as a side effect
// of the author fixing a typo in it, silently, with no failing test anywhere
// unless this one exists.
func TestRepublishKeepsVisibility(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	repo := catalog.NewRepo(pool)
	ctx := context.Background()

	if resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish 1: want 201 got %d body=%s", resp.StatusCode, raw)
	}
	if err := repo.SetVisibility(ctx, nil, validCourseSlug, catalog.VisibilityPrivate); err != nil {
		t.Fatalf("SetVisibility: %v", err)
	}

	// Publish the SAME package again — the ordinary "I fixed a chapter" path.
	if resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish 2: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	c, err := repo.GetPublished(ctx, validCourseSlug, adminViewer)
	if err != nil {
		t.Fatalf("GetPublished after republish: %v", err)
	}
	if c.Visibility != catalog.VisibilityPrivate {
		t.Fatalf("republish reset visibility to %q — a private course went public by being updated", c.Visibility)
	}
	if _, err := repo.GetPublished(ctx, validCourseSlug, anonViewer); err != catalog.ErrNotFound {
		t.Errorf("after republish the course is readable anonymously again: %v", err)
	}
}

// TestSetVisibilityRoute covers the HTTP door: admin-gated, validating, and
// reversible.
func TestSetVisibilityRoute(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	repo := catalog.NewRepo(pool)
	ctx := context.Background()

	if resp, raw := putPackage(t, app, validCourseSlug, validCourseZip(t), "Bearer "+adminToken, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("publish: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	put := func(t *testing.T, slug, body, auth string) (*http.Response, []byte) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPut, "/admin/courses/"+slug+"/visibility", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		resp, err := app.Test(req, httpTimeoutMS)
		if err != nil {
			t.Fatalf("PUT visibility (%s): %v", slug, err)
		}
		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatalf("PUT visibility (%s): read body: %v", slug, err)
		}
		resp.Body.Close()
		return resp, raw
	}

	// No credentials at all: refused before anything else happens.
	if resp, _ := put(t, validCourseSlug, `{"visibility":"private"}`, ""); resp.StatusCode == http.StatusOK {
		t.Errorf("unauthenticated set-visibility: want refusal got 200")
	}
	if c, _ := repo.GetPublished(ctx, validCourseSlug, anonViewer); c.Slug == "" {
		t.Errorf("unauthenticated call changed state — course is no longer publicly readable")
	}

	// A value that is neither public nor private: 400, naming the two.
	resp, raw := put(t, validCourseSlug, `{"visibility":"secret"}`, "Bearer "+adminToken)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("visibility=secret: want 400 got %d body=%s", resp.StatusCode, raw)
	}

	// The real thing, and back again.
	if resp, raw := put(t, validCourseSlug, `{"visibility":"private"}`, "Bearer "+adminToken); resp.StatusCode != http.StatusOK {
		t.Fatalf("set private: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	if _, err := repo.GetPublished(ctx, validCourseSlug, anonViewer); err != catalog.ErrNotFound {
		t.Errorf("after set private: still readable anonymously (%v)", err)
	}

	resp, raw = put(t, validCourseSlug, `{"visibility":"public"}`, "Bearer "+adminToken)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("set public: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var body struct{ Visibility string }
	if err := json.Unmarshal(raw, &body); err != nil || body.Visibility != catalog.VisibilityPublic {
		t.Errorf("set public: body %s (err %v)", raw, err)
	}
	if _, err := repo.GetPublished(ctx, validCourseSlug, anonViewer); err != nil {
		t.Errorf("after set public: should be readable anonymously again, got %v", err)
	}

	// An unknown slug is 404, not a silent success.
	if resp, raw := put(t, "khong-ton-tai", `{"visibility":"private"}`, "Bearer "+adminToken); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown slug: want 404 got %d body=%s", resp.StatusCode, raw)
	}
}
