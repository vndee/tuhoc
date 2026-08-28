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

// DefaultDeepSeekBaseURL is used by Load when DEEPSEEK_BASE_URL is unset.
// It is a compile-time default rather than a second mandatory env var
// on purpose: DeepSeek's endpoint has exactly one correct production
// value, and requiring an operator to type it out on every deploy is one
// more way a deployment can be broken for no benefit (docs/deploy.md
// documents the override for anyone pointing at a proxy or a mock in
// tests). Task 4's internal/ai client reads this, not a literal string
// of its own, so this constant is the one place the endpoint can drift.
const DefaultDeepSeekBaseURL = "https://api.deepseek.com"

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

	// AdminToken gates the admin publish API (Task 8: PUT/DELETE
	// /admin/courses/{slug} and friends). Task 4's CLI already sends
	// "Authorization: Bearer <token>" on the publish path; this is the
	// value that header is compared against.
	//
	// Same shape as GitHubToken and for the same reason: it belongs to
	// the platform's OWN admin, not to any reader, so it is unrelated to
	// spec §3.2's promise about a reader's AI provider key. Empty means
	// the admin publish path is switched off (the exact mechanism — e.g.
	// refusing every request rather than comparing against an empty
	// string — is Task 8's to implement); this is the correct default for
	// a checkout that has not chosen an admin credential yet, exactly as
	// an unset GitHubToken leaves Discussions off rather than erroring.
	AdminToken string

	// ── THE SECOND SECRET, AND THE FIRST ONE spec §3.2 IS ACTUALLY ABOUT ─
	//
	// DeepSeekAPIKey is THIS SERVER'S OWN credential to DeepSeek — and,
	// unlike GitHubToken above, it is exactly the kind of key spec §0.1
	// and §3.2 are about, not a look-alike. Pha 1 kept every reader's own
	// AI provider key in their own browser, at a separate origin
	// (apps/vault); this server never saw one, and
	// internal/server/no_key_transit_test.go enforced that. Pha 2
	// deliberately ends it: the agent now runs on this server, against
	// ONE account this platform pays for, so this server now holds a key
	// that can spend real money on the platform's own account if it
	// leaks.
	//
	// That is the trade spec §0.1 names directly: "rủi ro 'một người mất
	// key' biến mất; rủi ro 'một vụ xâm nhập mất key của nền tảng' xuất
	// hiện" — a valid trade, not a regression, and this field is where
	// the new risk actually lives. internal/server/
	// provider_key_never_leaks_test.go is the replacement gate: it
	// enforces spec §3.2(3)'s promise rewritten for this architecture —
	// never a log line, never a response body — and it REPLACES
	// no_key_transit_test.go rather than sitting beside it, because the
	// old test's claim ("this server never receives a provider key at
	// all") is now simply false.
	//
	// Read from DEEPSEEK_API_KEY, no default — same shape as GitHubToken
	// and AdminToken above: an unset key is the correct state for a
	// checkout that hasn't chosen a DeepSeek account yet, and Task 4's
	// internal/ai degrades the AI feature to "unavailable" rather than
	// this package failing to boot over it.
	DeepSeekAPIKey string

	// DeepSeekBaseURL is DeepSeek's own API base URL. Read from
	// DEEPSEEK_BASE_URL, defaulting to DefaultDeepSeekBaseURL
	// (https://api.deepseek.com) when unset — see that constant's
	// comment for why this one gets a default and DeepSeekAPIKey does
	// not: one has exactly one correct production value and the other
	// is, by definition, a secret nobody but the operator can supply.
	DeepSeekBaseURL string

	// BraveAPIKey is THIS SERVER'S OWN credential to the Brave Search
	// API — the second provider spec §3.2 introduces. DeepSeek has no
	// server-run web-search tool of its own (unlike the Anthropic-based
	// design the 2026-08-25 spec first assumed, which is why the switch
	// to DeepSeek was not just a rename — see that spec's §3.2 callout),
	// so web search needs a second account, a second key, and a second
	// bill.
	//
	// Same risk class as DeepSeekAPIKey, not GitHubToken: a leak of this
	// key lets someone else spend against OUR Brave subscription, and
	// provider_key_never_leaks_test.go's scans cover it identically to
	// DeepSeekAPIKey (they name both fields explicitly). Sent to Brave
	// on the X-Subscription-Token header — not Authorization, which is
	// Brave's own API shape and irrelevant to how this key must be
	// handled on the way in.
	//
	// Read from BRAVE_API_KEY, no default. Unset switches the web-search
	// tool off rather than failing startup, same shape as every other
	// optional integration in this struct.
	BraveAPIKey string
}

// Load reads Config from the process environment, applying defaults for
// PORT and CORS_ORIGIN when unset.
//
// GITHUB_TOKEN, GITHUB_DISCUSSIONS_REPO, ADMIN_TOKEN, DEEPSEEK_API_KEY, and
// BRAVE_API_KEY get no default and no warning when absent, unlike
// COOKIE_SECURE: an unparseable COOKIE_SECURE is a typo with a security
// consequence, whereas an unset GitHub token, admin token, or provider key
// is the normal state of every local checkout and of production until an
// operator deliberately chooses one. See the GitHubToken, AdminToken,
// DeepSeekAPIKey, and BraveAPIKey fields. DEEPSEEK_BASE_URL is the one
// exception among the new variables — it gets DefaultDeepSeekBaseURL, same
// as PORT and CORS_ORIGIN above, because it has exactly one correct
// production value rather than being a secret.
func Load() Config {
	return Config{
		Port:                  getEnv("PORT", DefaultPort),
		DatabaseURL:           os.Getenv("DATABASE_URL"),
		CORSOrigin:            getEnv("CORS_ORIGIN", DefaultCORSOrigin),
		CookieSecure:          parseCookieSecure(os.Getenv("COOKIE_SECURE")),
		GitHubToken:           os.Getenv("GITHUB_TOKEN"),
		GitHubDiscussionsRepo: os.Getenv("GITHUB_DISCUSSIONS_REPO"),
		AdminToken:            os.Getenv("ADMIN_TOKEN"),
		DeepSeekAPIKey:        os.Getenv("DEEPSEEK_API_KEY"),
		DeepSeekBaseURL:       getEnv("DEEPSEEK_BASE_URL", DefaultDeepSeekBaseURL),
		BraveAPIKey:           os.Getenv("BRAVE_API_KEY"),
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
