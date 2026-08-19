package server

import (
	"io"
	"net/http/httptest"
	"testing"

	"github.com/vndee/tuhoc-api/internal/config"
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
