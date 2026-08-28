package config

import (
	"bytes"
	"log"
	"strings"
	"testing"
)

// clearAPIEnv ensures each test starts from a clean slate: t.Setenv only
// sets vars the test cares about, but Load reads every one of these, so a
// value leaking from the outer environment (e.g. a developer's shell) would
// make a "default" case flaky.
//
// GITHUB_TOKEN is the one on this list most likely to be set for unrelated
// reasons — `gh auth` and many CI runners export it — so leaving it out
// would make TestLoad_GitHubDiscussionsAreOffByDefault pass or fail
// depending on whose machine ran it.
func clearAPIEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"PORT", "DATABASE_URL", "CORS_ORIGIN", "COOKIE_SECURE",
		"GITHUB_TOKEN", "GITHUB_DISCUSSIONS_REPO", "ADMIN_TOKEN",
	} {
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

// TestLoad_GitHubDiscussionsAreOffByDefault pins the behaviour every local
// checkout and today's production depend on: absent GitHub configuration is
// a NORMAL state, not a misconfiguration.
//
// It reads as trivial and is not. The alternative shapes are all things
// this repo has done elsewhere for good reasons and which would be wrong
// here — a default value (there is no sensible default repository), a
// fail-closed like parseCookieSecure (nothing to fail closed to), or a
// start-up error (the API would refuse to boot over one section of one
// page). Writing the passthrough down as a test is what keeps somebody
// from "fixing" it into one of those later.
func TestLoad_GitHubDiscussionsAreOffByDefault(t *testing.T) {
	clearAPIEnv(t)

	cfg := Load()
	if cfg.GitHubToken != "" || cfg.GitHubDiscussionsRepo != "" {
		t.Fatalf("unset: want both empty, got token=%q repo=%q",
			cfg.GitHubToken, cfg.GitHubDiscussionsRepo)
	}

	t.Setenv("GITHUB_TOKEN", "github_pat_example")
	t.Setenv("GITHUB_DISCUSSIONS_REPO", "vndee/tuhoc-registry")
	cfg = Load()
	if cfg.GitHubToken != "github_pat_example" {
		t.Errorf("GITHUB_TOKEN: want passthrough, got %q", cfg.GitHubToken)
	}
	if cfg.GitHubDiscussionsRepo != "vndee/tuhoc-registry" {
		t.Errorf("GITHUB_DISCUSSIONS_REPO: want passthrough, got %q", cfg.GitHubDiscussionsRepo)
	}
}

// TestLoad_AdminTokenOffByDefault pins the same shape as
// TestLoad_GitHubDiscussionsAreOffByDefault: an unset ADMIN_TOKEN is a
// NORMAL state (Task 4's CLI publish path simply has nothing to send),
// not a misconfiguration, and it must pass through verbatim when set —
// this is the raw value compared against the "Authorization: Bearer
// <token>" header on PUT /admin/courses/{slug} (Task 8), so it must not be
// trimmed, defaulted, or otherwise mangled in either direction.
func TestLoad_AdminTokenOffByDefault(t *testing.T) {
	clearAPIEnv(t)

	if got := Load().AdminToken; got != "" {
		t.Fatalf("ADMIN_TOKEN unset: want empty (publish path off) got %q", got)
	}

	t.Setenv("ADMIN_TOKEN", "s3cret-admin-token")
	if got := Load().AdminToken; got != "s3cret-admin-token" {
		t.Fatalf("ADMIN_TOKEN override: want passthrough got %q", got)
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
