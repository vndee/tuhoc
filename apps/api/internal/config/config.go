// Package config loads runtime configuration for the API from environment
// variables. It has no dependencies on other internal packages.
package config

import (
	"log"
	"os"
	"strconv"
)

// DefaultCORSOrigin is used by Load when CORS_ORIGIN is unset. It is also
// the single source of truth for server.New's fallback when a caller (e.g.
// a test) constructs a Config directly without going through Load — the
// two must never diverge, so server.New references this constant too.
const DefaultCORSOrigin = "http://localhost:5173"

// DefaultPort is used by Load when PORT is unset.
const DefaultPort = "8080"

// Config holds all environment-derived settings for the API process.
type Config struct {
	// Port is the TCP port the HTTP server listens on.
	Port string
	// DatabaseURL is the Postgres connection string. Empty means no
	// database is configured (this task does not open a connection).
	DatabaseURL string
	// CORSOrigin is the allowed Origin for cross-origin requests from the
	// web app (credentials are always sent, so this must be a concrete
	// origin, not "*").
	CORSOrigin string
	// CookieSecure controls the Secure attribute on session cookies.
	CookieSecure bool

	// ── THE FIRST SECRET THIS SERVER HAS EVER HELD ───────────────────────
	//
	// GitHubToken is THIS SERVER'S OWN credential to GitHub. It is not a
	// user's credential to anybody, and it is emphatically NOT the kind of
	// key spec §1.4 and §3.2 are about.
	//
	// Read this before citing it as a precedent, because somebody will:
	//
	//	§3.2's promise — "a user's AI provider key never touches the
	//	platform's server: not in transit, not in process memory, not in a
	//	log, not in the database, not in a sync payload. No exceptions, no
	//	fallback path." — IS NOT WIDENED BY THIS FIELD, not by one inch.
	//
	// The two are different in kind, not in degree:
	//
	//   - Whose secret it is. A provider key belongs to the reader; the
	//     platform is not a party to it, and holding it would make the
	//     platform a custodian of a credential it can spend on someone
	//     else's account. This token belongs to the platform, and the only
	//     account it can spend against is the platform's own.
	//   - What it unlocks. A provider key unlocks a billable account and,
	//     on several providers, that account's whole history. This token
	//     unlocks PUBLIC, READ-ONLY data — discussion threads on the public
	//     registry repository — which is why it must be minted read-only
	//     (see .env.example) and why the API only ever GETs with it.
	//   - Who can hand it over. A provider key would arrive from a browser,
	//     over the wire, on a request path anyone can reach. This one
	//     arrives from the deployment environment and no request can supply,
	//     replace, or read it.
	//
	// The three source scans in internal/server/no_key_transit_test.go stay
	// GREEN on this field, and that is a measured fact rather than a hope:
	// it carries no JSON tag, so it can never be bound from a request body;
	// nothing reads it out of a header; and it names no AI provider. The one
	// scan Discussions does move — the outbound-call scan — is moved by
	// internal/discuss/client.go importing net/http, NOT by this field, and
	// it is answered with a narrow allowlist there rather than by deleting
	// the scan. See that test's own allowlist and its comment.
	//
	// Empty means Discussions are switched off: the endpoint degrades to
	// "not loaded" instead of failing, exactly as an unset DATABASE_URL
	// leaves /healthz working. Absent configuration is a normal state here,
	// not an error — there is no public registry repository yet
	// (docs/deploy.md §5c).
	GitHubToken string

	// GitHubDiscussionsRepo names the repository whose Discussions the
	// platform embeds, as "owner/name" (e.g. "vndee/tuhoc-registry"). This
	// is the registry repository from docs/deploy.md §5c.
	//
	// It is deliberately a separate variable from the token rather than
	// something derived from it: a token says who we are, not what we may
	// read, and pinning the repository in configuration means a leaked or
	// over-scoped token still cannot make this API read some other
	// repository. Empty means Discussions are switched off, same as an
	// empty GitHubToken.
	GitHubDiscussionsRepo string
}

// Load reads Config from the process environment, applying defaults for
// PORT and CORS_ORIGIN when unset.
//
// GITHUB_TOKEN and GITHUB_DISCUSSIONS_REPO get no default and no warning
// when absent, unlike COOKIE_SECURE: an unparseable COOKIE_SECURE is a typo
// with a security consequence, whereas an unset GitHub token is the normal
// state of every local checkout and of production until the registry
// repository exists. See the GitHubToken field.
func Load() Config {
	return Config{
		Port:                  getEnv("PORT", DefaultPort),
		DatabaseURL:           os.Getenv("DATABASE_URL"),
		CORSOrigin:            getEnv("CORS_ORIGIN", DefaultCORSOrigin),
		CookieSecure:          parseCookieSecure(os.Getenv("COOKIE_SECURE")),
		GitHubToken:           os.Getenv("GITHUB_TOKEN"),
		GitHubDiscussionsRepo: os.Getenv("GITHUB_DISCUSSIONS_REPO"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// parseCookieSecure decides the Secure attribute for session cookies from
// the raw COOKIE_SECURE env value. This flag guards a security property
// (whether the session cookie is sent over plain HTTP), so the three cases
// are handled deliberately rather than falling back to a single "truthy"
// string compare:
//   - unset/empty: false — the correct default for local http dev.
//   - set and parseable (accepts the usual strconv.ParseBool spellings —
//     "1", "t", "T", "TRUE", "true", "True", "0", "f", "F", "FALSE",
//     "false", "False"): that value.
//   - set but unparseable: fail closed to true, and log a warning naming
//     the variable and the bad value, so a typo in an ops config doesn't
//     silently downgrade cookie security.
func parseCookieSecure(raw string) bool {
	if raw == "" {
		return false
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		log.Printf("config: COOKIE_SECURE=%q is not a valid boolean; failing closed to true", raw)
		return true
	}
	return v
}
