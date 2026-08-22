package server

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/course"
	"github.com/vndee/tuhoc-api/internal/stats"
	"github.com/vndee/tuhoc-api/internal/store"
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

// TestRouteScopedBodyLimits pins the arrangement that keeps POST /courses's
// 21 MiB ceiling from being every route's ceiling.
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
//   - the same body on POST /courses -> 401 as well, which is what proves
//     the 4 MiB cut is this route's and not the app's.
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

	try := func(target string, body []byte) (*http.Response, error) {
		req := httptest.NewRequest(http.MethodPost, target, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req, 30000)
		if resp != nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
		return resp, err
	}

	post := func(t *testing.T, target string, body []byte) *http.Response {
		t.Helper()
		resp, err := try(target, body)
		if err != nil {
			t.Fatalf("POST %s (%d bytes): %v", target, len(body), err)
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
		if got := post(t, r.target, over).StatusCode; got != http.StatusRequestEntityTooLarge {
			t.Errorf("POST %s with %d bytes (limit %d): want 413 got %d", r.target, len(over), r.limit, got)
		}

		// Anti-vacuity: a body inside the limit is NOT stopped here. 401
		// is auth's answer, which means the limit let it through.
		under := padded(1024)
		if got := post(t, r.target, under).StatusCode; got != http.StatusUnauthorized {
			t.Errorf("POST %s with %d bytes (limit %d): want 401 got %d", r.target, len(under), r.limit, got)
		}
	}

	// The same oversized body on POST /courses is NOT refused by a body
	// limit: that route is the reason the app-wide ceiling is high, and it
	// keeps it. Without this case, dropping the app ceiling to 4 MiB would
	// pass every assertion above while breaking package upload.
	big := padded(int(appsync.MaxPushBytes) + 1)
	if got := post(t, "/courses", big).StatusCode; got != http.StatusUnauthorized {
		t.Errorf("POST /courses with %d bytes: want 401 (no route body limit) got %d", len(big), got)
	}

	// And the app ceiling still exists above it: past course.MaxUploadBytes
	// fasthttp refuses the body outright, before any handler or middleware
	// of ours is reached — which is why this one is asserted on the
	// transport error rather than on a status code.
	huge := padded(int(course.MaxUploadBytes) + 1)
	resp, err := try("/courses", huge)
	if err == nil {
		t.Errorf("POST /courses with %d bytes (app limit %d): want the transport to refuse it, got %d",
			len(huge), course.MaxUploadBytes, resp.StatusCode)
	} else if !strings.Contains(err.Error(), "body size exceeds") {
		t.Errorf("POST /courses with %d bytes: refused for an unexpected reason: %v", len(huge), err)
	}
}

// TestCourseUploadRateLimit pins the second half of the answer to "an
// authenticated account can upload without limit".
//
// The per-owner storage quota (course.MaxOwnerBytes) is what actually
// bounds the disk; it is enforced in internal/course and pinned there.
// This is the other resource an upload spends: CPU and memory expanding
// an archive, which is spent whether or not the row is ever stored — a
// full library re-posting 20 MiB packages still costs the server every
// one of those expansions. So POST /courses gets the same treatment P1
// gave /auth, with one difference that matters: the key is the SESSION's
// user id, not the client IP, because the thing being rationed here is
// per-account work and an IP is neither necessary nor sufficient to
// identify an account.
//
// The budget is deliberately generous (see courseUploadRateLimitMax): it
// is not the storage defense, and a human importing course packages will
// never come near it.
func TestCourseUploadRateLimit(t *testing.T) {
	pool := store.TestPool(t)
	app := New(config.Config{CookieSecure: false}, Deps{Pool: pool, LogOutput: io.Discard})

	regResp, regBody := doTestRequest(t, app, http.MethodPost, "/auth/register",
		map[string]string{"email": "uploadlimit@example.test", "password": "uploadlimit-password-1", "name": "UL"}, nil)
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
		t.Fatalf("register: no session cookie")
	}

	// A body with no multipart "package" field: every one of these is a
	// 400 from the handler, which is the point — the budget counts
	// REQUESTS, not successful imports. Skipping the failures would leave
	// the cheapest flood (a bomb that is rejected only after being
	// expanded) entirely unrationed.
	for i := 0; i < courseUploadRateLimitMax; i++ {
		resp, body := doTestRequest(t, app, http.MethodPost, "/courses", map[string]any{}, cookie)
		if resp.StatusCode == http.StatusTooManyRequests {
			t.Fatalf("request %d of %d was already rate limited: %s", i+1, courseUploadRateLimitMax, body)
		}
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("request %d: want 400 (no package field) got %d body=%s", i+1, resp.StatusCode, body)
		}
	}

	resp, body := doTestRequest(t, app, http.MethodPost, "/courses", map[string]any{}, cookie)
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("request %d: want 429 got %d body=%s", courseUploadRateLimitMax+1, resp.StatusCode, body)
	}
	if !strings.Contains(body, "too many") {
		t.Errorf("the 429 body says nothing useful: %s", body)
	}

	// Anti-vacuity: the budget is per session, so another account is
	// unaffected by this one's spending. Without this, a limiter keyed on
	// something global would pass everything above.
	otherResp, otherBody := doTestRequest(t, app, http.MethodPost, "/auth/register",
		map[string]string{"email": "uploadlimit2@example.test", "password": "uploadlimit-password-2", "name": "UL2"}, nil)
	if otherResp.StatusCode != http.StatusOK {
		t.Fatalf("register other: want 200 got %d body=%s", otherResp.StatusCode, otherBody)
	}
	var otherCookie *http.Cookie
	for _, c := range otherResp.Cookies() {
		if c.Name == "tuhoc_session" {
			otherCookie = c
		}
	}
	freshResp, freshBody := doTestRequest(t, app, http.MethodPost, "/courses", map[string]any{}, otherCookie)
	if freshResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("a second account's first upload: want 400 got %d body=%s", freshResp.StatusCode, freshBody)
	}
}
