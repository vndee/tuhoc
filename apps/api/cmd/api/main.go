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

	"github.com/vndee/tuhoc-api/internal/catalog"
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

// backfillTimeout bounds the one-shot plain_text fill (migration 0012).
//
// Generous relative to the work — the fill is one pass over chapters with a
// NULL plain_text, and it is empty on every boot after the first — but bounded
// so a stalled connection cannot hold up serving. Exceeding it is logged, not
// fatal: see the call site.
const backfillTimeout = 60 * time.Second

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
	// Migrations run here when MIGRATE_ON_BOOT says so — the flag this
	// comment used to describe as somebody else's job.
	//
	// It stopped being optional the day the gap cost an outage: a deploy
	// shipped code that read a column its migration had not created, because
	// nothing applied migrations, and `GET /courses` — the front page —
	// answered 500 until the migration was run by hand. Code and the schema
	// it needs travel in the same commit; they should land together.
	//
	// BEFORE store.Open, deliberately. Migrating after the pool is up would
	// leave a window in which the server accepts requests against the old
	// schema, which is the exact 500 this is here to prevent.
	//
	// log.Fatalf on failure, also deliberately: a server whose migration
	// failed will answer some requests correctly and some with column
	// errors, and that is harder to diagnose than a container that refuses
	// to start and says why.
	if cfg.MigrateOnBoot && cfg.DatabaseURL != "" {
		log.Printf("store: MIGRATE_ON_BOOT is set — applying pending migrations")
		if err := store.MigrateUp(cfg.MigrationDSN()); err != nil {
			log.Fatalf("store: migrations failed: %v", err)
		}
		log.Printf("store: migrations up to date")
	}

	if cfg.DatabaseURL != "" {
		connectCtx, cancel := context.WithTimeout(context.Background(), dbConnectTimeout)
		p, err := store.Open(connectCtx, cfg.DatabaseURL)
		cancel()
		if err != nil {
			log.Fatalf("store: database unreachable within %s: %v", dbConnectTimeout, err)
		}
		pool = p
		deps.Pool = pool

		// Backfill published_chapters.plain_text (migration 0012).
		//
		// This runs at boot while migrations deliberately do not (see the
		// note above), and the difference is not an inconsistency: a
		// migration is SQL, and this particular fill cannot be expressed in
		// SQL. Deriving a chapter's plain text needs Go's HTML5 tokenizer
		// and the ten-tag raw-text table in internal/htmltext; a
		// regexp_replace version would be a SECOND definition of what a
		// chapter's text is, which is the thing that package was extracted
		// to prevent. 0012's own comment records the same reasoning at the
		// point where it declines to backfill.
		//
		// Cheap and idempotent: it touches only rows where plain_text IS
		// NULL, so every boot after the first does one indexless scan of a
		// small table and writes nothing.
		//
		// NOT fatal. A failure here degrades search for chapters published
		// before 0012 back to the pre-0012 path — the query COALESCEs to
		// raw html for exactly those rows — and that is not a reason to
		// refuse to serve the API.
		backfillCtx, cancelBackfill := context.WithTimeout(context.Background(), backfillTimeout)
		filled, err := catalog.NewRepo(pool).BackfillPlainText(backfillCtx)
		cancelBackfill()
		switch {
		case err != nil:
			log.Printf("catalog: plain_text backfill failed (search falls back to scanning raw HTML for pre-0012 chapters): %v", err)
		case filled > 0:
			log.Printf("catalog: derived plain_text for %d chapter(s) published before migration 0012", filled)
		}
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
