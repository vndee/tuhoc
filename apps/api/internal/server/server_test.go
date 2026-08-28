package server

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/pkgcheck"
	"github.com/vndee/tuhoc-api/internal/stats"
	appsync "github.com/vndee/tuhoc-api/internal/sync"
)

func TestHealthz(t *testing.T) {
	app := New(config.Config{}, Deps{LogOutput: io.Discard})
	req := httptest.NewRequest("GET", "/healthz", nil)
	resp, _ := app.Test(req)
	if resp.StatusCode != 200 {
		t.Fatalf("want 200 got %d", resp.StatusCode)
	}
}

// TestCORSHeaders_ExplicitOrigin is a regression guard for the middleware
// stack's CORS setup: it must echo the configured origin (not "*") and
// advertise Access-Control-Allow-Credentials, since the API always sends
// the session cookie cross-origin.
func TestCORSHeaders_ExplicitOrigin(t *testing.T) {
	const origin = "https://tuhoc.example"
	app := New(config.Config{CORSOrigin: origin}, Deps{LogOutput: io.Discard})

	req := httptest.NewRequest("GET", "/healthz", nil)
	req.Header.Set("Origin", origin)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != origin {
		t.Fatalf("want Access-Control-Allow-Origin=%q got %q", origin, got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("want Access-Control-Allow-Credentials=true got %q", got)
	}
}

// TestCORSHeaders_DefaultOriginFallback is the direct regression test for
// the panic New used to hit: a zero-value config.Config (CORSOrigin == "")
// combined with AllowCredentials:true made Fiber's CORS middleware treat
// the origin as wildcard "*" and panic ("Insecure setup ..."). New must
// fall back to config.DefaultCORSOrigin instead of passing "" through.
func TestCORSHeaders_DefaultOriginFallback(t *testing.T) {
	app := New(config.Config{}, Deps{LogOutput: io.Discard}) // must not panic

	req := httptest.NewRequest("GET", "/healthz", nil)
	req.Header.Set("Origin", config.DefaultCORSOrigin)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != config.DefaultCORSOrigin {
		t.Fatalf("want Access-Control-Allow-Origin=%q got %q", config.DefaultCORSOrigin, got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("want Access-Control-Allow-Credentials=true got %q", got)
	}
}

// TestRouteScopedBodyLimits pins the arrangement that keeps
// PUT /admin/courses/:slug's ~20 MiB ceiling from being every route's
// ceiling.
//
// This test used to name POST /courses as the wide-ceiling route; Task 9
// deleted that route along with the rest of internal/course (the per-user
// package store it is no longer needed for). The property under test —
// one route legitimately needs a course-package-sized body, and every
// other route must not inherit that ceiling by accident — did not go away
// with it: PUT /admin/courses/:slug (Task 8's publish endpoint) is now the
// route that needs the wide ceiling, and pkgcheck.MaxUploadBytes (not
// course.MaxUploadBytes, which no longer exists) is the number both this
// test and server.go's own fiber.Config read.
//
// fiber v2's BodyLimit is an APP setting. Raising it so a legitimate
// course package can be uploaded raised it for /sync and /events/batch
// too, which used to be cut off at fiber's 4 MiB default — a review
// measured what that bought an attacker: the items one request can carry
// went from ~39 303 to ~204 919 (5.21×), the body is swallowed into RAM at
// ~20× its size on the wire, and every item becomes one row inside a
// single transaction holding one of the pool's 4–8 connections.
//
// The three assertions below are what "route-scoped" means, and none of
// them needs a database or a clock — a body that is over its route's
// limit is refused before auth.Require ever runs, so an oversized body
// cannot even spend a pool connection on session validation:
//
//   - over its own limit  -> 413, from the middleware;
//   - under its own limit -> 401, from auth (i.e. it got past the limit);
//   - the same body on PUT /admin/courses/:slug -> 401 as well (no
//     Bearer token is sent, so adminOrToken falls through to
//     auth.Require, which answers before RequireAdmin or the handler run),
//     which is what proves the 4 MiB cut is this route's and not the
//     app's.
func TestRouteScopedBodyLimits(t *testing.T) {
	// Pool is deliberately nil: every request here is unauthenticated, and
	// auth.Require answers 401 on a missing cookie before it touches the
	// pool. A test that needed a container to prove a byte count would be
	// measuring the wrong thing.
	app := New(config.Config{}, Deps{LogOutput: io.Discard})

	// padded builds a syntactically valid push/batch body of at least n
	// bytes. The padding lives in a field neither handler reads, so the
	// only thing under test is the size.
	padded := func(n int) []byte {
		body := fmt.Sprintf(`{"progress":[],"annotations":[],"events":[],"pad":%q}`, strings.Repeat("a", n))
		return []byte(body)
	}

	// try takes an explicit method: /sync and /events/batch are POST, but
	// the admin publish route this test also exercises is PUT — sending
	// the wrong method wouldn't 401 at auth, it would 405 at the router
	// before auth ever ran, which is a real trap this test fell into once
	// already while being adapted off POST /courses (deleted by this task).
	try := func(method, target string, body []byte) (*http.Response, error) {
		req := httptest.NewRequest(method, target, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req, 30000)
		if resp != nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
		return resp, err
	}

	do := func(t *testing.T, method, target string, body []byte) *http.Response {
		t.Helper()
		resp, err := try(method, target, body)
		if err != nil {
			t.Fatalf("%s %s (%d bytes): %v", method, target, len(body), err)
		}
		return resp
	}

	routes := []struct {
		target string
		limit  int64
	}{
		{"/sync", appsync.MaxPushBytes},
		{"/events/batch", stats.MaxBatchBytes},
	}

	for _, r := range routes {
		over := padded(int(r.limit) + 1)
		if int64(len(over)) <= r.limit {
			t.Fatalf("%s: the fixture is not over the limit (%d bytes vs %d)", r.target, len(over), r.limit)
		}
		if got := do(t, http.MethodPost, r.target, over).StatusCode; got != http.StatusRequestEntityTooLarge {
			t.Errorf("POST %s with %d bytes (limit %d): want 413 got %d", r.target, len(over), r.limit, got)
		}

		// Anti-vacuity: a body inside the limit is NOT stopped here. 401
		// is auth's answer, which means the limit let it through.
		under := padded(1024)
		if got := do(t, http.MethodPost, r.target, under).StatusCode; got != http.StatusUnauthorized {
			t.Errorf("POST %s with %d bytes (limit %d): want 401 got %d", r.target, len(under), r.limit, got)
		}
	}

	// The same oversized body on PUT /admin/courses/:slug is NOT refused by
	// a body limit: that route is the reason the app-wide ceiling is high,
	// and it keeps it. Without this case, dropping the app ceiling to
	// 4 MiB would pass every assertion above while breaking course
	// publishing.
	const adminTarget = "/admin/courses/route-scoped-body-limit-check"
	big := padded(int(appsync.MaxPushBytes) + 1)
	if got := do(t, http.MethodPut, adminTarget, big).StatusCode; got != http.StatusUnauthorized {
		t.Errorf("PUT %s with %d bytes: want 401 (no route body limit) got %d", adminTarget, len(big), got)
	}

	// And the app ceiling still exists above it: past pkgcheck.MaxUploadBytes
	// fasthttp refuses the body outright, before any handler or middleware
	// of ours is reached — which is why this one is asserted on the
	// transport error rather than on a status code.
	huge := padded(int(pkgcheck.MaxUploadBytes) + 1)
	resp, err := try(http.MethodPut, adminTarget, huge)
	if err == nil {
		t.Errorf("PUT %s with %d bytes (app limit %d): want the transport to refuse it, got %d",
			adminTarget, len(huge), pkgcheck.MaxUploadBytes, resp.StatusCode)
	} else if !strings.Contains(err.Error(), "body size exceeds") {
		t.Errorf("PUT %s with %d bytes: refused for an unexpected reason: %v", adminTarget, len(huge), err)
	}
}

// rawRequest issues method against target with no body and no auth,
// draining and closing the response so the connection is freed. Used where
// a case needs a plain, unauthenticated request without going through
// doTestRequest's JSON marshaling (observability_test.go).
func rawRequest(t *testing.T, app *fiber.App, method, target string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	resp, err := app.Test(req, 30000)
	if err != nil {
		t.Fatalf("%s %s: %v", method, target, err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return resp
}

// TestOldPerUserCourseRoutesAreGone is the direct regression pin for this
// task's own removal: internal/course, course_packages, and every route
// that used to serve them are deleted TOGETHER in this commit (see the
// commit message for why — readers no longer import a private copy, so
// there is nothing left for any of it to protect). A request to any of
// them must not silently keep working; it must land on NO route at all.
//
// POST /courses is asserted as "404 or 405" rather than one fixed code:
// fiber's router answers 404 for a path with no registered route, and 405
// for a path that IS registered under a different method — GET /courses
// (the new public listing) now owns this exact path, so which of the two
// fiber returns for a POST here is an implementation detail of its router,
// not a property this task's contract depends on either way.
func TestOldPerUserCourseRoutesAreGone(t *testing.T) {
	app := New(config.Config{}, Deps{LogOutput: io.Discard})

	postResp := rawRequest(t, app, http.MethodPost, "/courses")
	if postResp.StatusCode != http.StatusNotFound && postResp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("POST /courses: want 404 or 405 (no route left to accept an upload) got %d", postResp.StatusCode)
	}

	// The old per-user manifest/asset routes required a literal "@" at the
	// start of the third path segment (":id/@:version/..."); nothing about
	// the new public routes registered at this path shape ever produces
	// that, so both must now be flat, ordinary 404s.
	for _, target := range []string{
		"/courses/some-course/@1.0.0/manifest.json",
		"/courses/some-course/@1.0.0/chapters/c1.html",
	} {
		if resp := rawRequest(t, app, http.MethodGet, target); resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s: want 404 got %d", target, resp.StatusCode)
		}
	}
}
