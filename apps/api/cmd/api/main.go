// Command api is the tuhoc backend entrypoint: it wires config, an
// optional database pool, and the HTTP server together.
package main

import (
	"context"
	"log"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/server"
	"github.com/vndee/tuhoc-api/internal/store"
)

func main() {
	cfg := config.Load()

	deps := server.Deps{}

	// DATABASE_URL is optional: healthz must keep working without one (see
	// P1 T5 ruling F1), so an unset DatabaseURL just leaves deps.Pool nil
	// instead of failing startup. If it IS set but unreachable, that's a
	// real misconfiguration, so we fail fast instead of serving a broken
	// pool.
	if cfg.DatabaseURL != "" {
		pool, err := store.Open(context.Background(), cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("store: open pool: %v", err)
		}
		defer pool.Close()
		deps.Pool = pool
	}

	app := server.New(cfg, deps)

	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
