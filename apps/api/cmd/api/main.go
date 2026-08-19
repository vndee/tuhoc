// Command api is the tuhoc backend entrypoint: it wires config, an
// optional database pool, and the HTTP server together, with graceful
// shutdown on SIGINT/SIGTERM so the pool actually gets closed instead of
// leaking on the exit paths a bare `defer pool.Close()` misses (a signal
// terminates the process before deferred funcs run; log.Fatal's os.Exit
// does too) — see P1 T5 fix round 1, finding 1.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/server"
	"github.com/vndee/tuhoc-api/internal/store"
)

// dbConnectTimeout bounds how long startup waits for the initial database
// ping. Without a bound, a reachable-but-slow database (e.g. a suspended
// free-tier instance waking up) turns "fail fast on misconfiguration" into
// an unresponsive process that just hangs past any readiness-probe window
// — see fix round 1, finding 2.
const dbConnectTimeout = 10 * time.Second

// shutdownTimeout bounds how long graceful shutdown waits for in-flight
// requests to finish before forcing connections closed.
const shutdownTimeout = 5 * time.Second

func main() {
	cfg := config.Load()

	deps := server.Deps{}
	var pool *pgxpool.Pool

	// DATABASE_URL is optional: healthz must keep working without one (see
	// P1 T5 ruling F1), so an unset DatabaseURL just leaves deps.Pool nil
	// instead of failing startup. If it IS set but unreachable within
	// dbConnectTimeout, that's a real misconfiguration, so we fail fast
	// instead of serving a broken pool.
	//
	// Migrations are deliberately NOT run here on boot: store.MigrateUp is
	// the entry point for that. Wiring it into the deploy flow (an
	// explicit `migrate` step, or a MIGRATE_ON_BOOT flag) is Task 16's
	// job, not this task's — see fix round 1, finding 3.
	if cfg.DatabaseURL != "" {
		connectCtx, cancel := context.WithTimeout(context.Background(), dbConnectTimeout)
		p, err := store.Open(connectCtx, cfg.DatabaseURL)
		cancel()
		if err != nil {
			log.Fatalf("store: database unreachable within %s: %v", dbConnectTimeout, err)
		}
		pool = p
		deps.Pool = pool
	}

	app := server.New(cfg, deps)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- app.Listen(":" + cfg.Port)
	}()

	select {
	case err := <-serveErr:
		// The server exited on its own (bind failure, etc.) rather than
		// via a shutdown signal. Close the pool explicitly before Fatal's
		// os.Exit, since the deferred pool.Close pattern this replaced
		// never actually ran on that path.
		closePool(pool)
		if err != nil {
			log.Fatalf("server exited: %v", err)
		}
	case <-ctx.Done():
		stop() // restore default signal behavior so a second signal kills us
		log.Printf("shutdown signal received, draining connections (timeout %s)", shutdownTimeout)
		if err := app.ShutdownWithTimeout(shutdownTimeout); err != nil {
			log.Printf("server shutdown: %v", err)
		}
		if err := <-serveErr; err != nil {
			log.Printf("listen returned after shutdown: %v", err)
		}
		closePool(pool)
		log.Printf("shutdown complete")
	}
}

// closePool closes pool if one was opened. pool is nil when DATABASE_URL
// was never set, which is a normal, non-error startup mode (see ruling
// F1), so this is a plain no-op in that case rather than a guarded error.
func closePool(pool *pgxpool.Pool) {
	if pool != nil {
		pool.Close()
	}
}
