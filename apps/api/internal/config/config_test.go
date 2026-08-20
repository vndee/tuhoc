package config

import (
	"bytes"
	"log"
	"strings"
	"testing"
)

// clearAPIEnv ensures each test starts from a clean slate: t.Setenv only
// sets vars the test cares about, but Load reads all four, so a value
// leaking from the outer environment (e.g. a developer's shell) would
// make a "default" case flaky.
func clearAPIEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{"PORT", "DATABASE_URL", "CORS_ORIGIN", "COOKIE_SECURE"} {
		t.Setenv(k, "")
	}
}

func TestLoad_PortDefaultAndOverride(t *testing.T) {
	clearAPIEnv(t)

	if got := Load().Port; got != DefaultPort {
		t.Fatalf("PORT unset: want default %q got %q", DefaultPort, got)
	}

	t.Setenv("PORT", "9090")
	if got := Load().Port; got != "9090" {
		t.Fatalf("PORT=9090: want %q got %q", "9090", got)
	}
}

func TestLoad_CORSOriginDefaultAndOverride(t *testing.T) {
	clearAPIEnv(t)

	if got := Load().CORSOrigin; got != DefaultCORSOrigin {
		t.Fatalf("CORS_ORIGIN unset: want default %q got %q", DefaultCORSOrigin, got)
	}

	t.Setenv("CORS_ORIGIN", "https://tuhoc.example")
	if got := Load().CORSOrigin; got != "https://tuhoc.example" {
		t.Fatalf("CORS_ORIGIN override: want %q got %q", "https://tuhoc.example", got)
	}
}

func TestLoad_DatabaseURLPassthrough(t *testing.T) {
	clearAPIEnv(t)

	if got := Load().DatabaseURL; got != "" {
		t.Fatalf("DATABASE_URL unset: want empty got %q", got)
	}

	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/tuhoc")
	if got := Load().DatabaseURL; got != "postgres://u:p@localhost:5432/tuhoc" {
		t.Fatalf("DATABASE_URL override: want passthrough got %q", got)
	}
}

func TestLoad_CookieSecureCases(t *testing.T) {
	cases := []struct {
		name string
		raw  string // env value; "" means unset (not set at all)
		set  bool
		want bool
	}{
		{name: "unset defaults to false (safe for local http)", set: false, want: false},
		{name: "true parses to true", raw: "true", set: true, want: true},
		{name: "TRUE (different case) parses to true", raw: "TRUE", set: true, want: true},
		{name: "1 parses to true", raw: "1", set: true, want: true},
		{name: "false parses to false", raw: "false", set: true, want: false},
		{name: "0 parses to false", raw: "0", set: true, want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clearAPIEnv(t)
			if tc.set {
				t.Setenv("COOKIE_SECURE", tc.raw)
			}

			if got := Load().CookieSecure; got != tc.want {
				t.Fatalf("COOKIE_SECURE=%q: want %v got %v", tc.raw, tc.want, got)
			}
		})
	}
}

// TestLoad_CookieSecureGarbageFailsClosedWithWarning covers the security-
// sensitive failure path directly: an unparseable COOKIE_SECURE must not
// silently become false (insecure cookies), and the misconfiguration must
// be visible in the logs by variable name and offending value.
func TestLoad_CookieSecureGarbageFailsClosedWithWarning(t *testing.T) {
	clearAPIEnv(t)
	t.Setenv("COOKIE_SECURE", "not-a-bool")

	var buf bytes.Buffer
	orig := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(orig) })

	cfg := Load()

	if !cfg.CookieSecure {
		t.Fatalf("want CookieSecure=true (fail closed) for unparseable value, got false")
	}
	if got := buf.String(); !strings.Contains(got, "COOKIE_SECURE") || !strings.Contains(got, "not-a-bool") {
		t.Fatalf("want warning naming COOKIE_SECURE and the bad value, got log output: %q", got)
	}
}
