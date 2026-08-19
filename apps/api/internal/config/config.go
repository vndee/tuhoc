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
}

// Load reads Config from the process environment, applying defaults for
// PORT and CORS_ORIGIN when unset.
func Load() Config {
	return Config{
		Port:         getEnv("PORT", DefaultPort),
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		CORSOrigin:   getEnv("CORS_ORIGIN", DefaultCORSOrigin),
		CookieSecure: parseCookieSecure(os.Getenv("COOKIE_SECURE")),
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
