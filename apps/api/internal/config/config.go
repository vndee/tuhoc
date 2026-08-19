// Package config loads runtime configuration for the API from environment
// variables. It has no dependencies on other internal packages.
package config

import "os"

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
		Port:         getEnv("PORT", "8080"),
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		CORSOrigin:   getEnv("CORS_ORIGIN", "http://localhost:5173"),
		CookieSecure: os.Getenv("COOKIE_SECURE") == "true",
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
