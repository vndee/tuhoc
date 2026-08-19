// Package store owns the Postgres connection pool and schema migrations
// for the tuhoc API. Every other backend package (auth, sync, stats) reads
// and writes through the *pgxpool.Pool obtained here; store itself has no
// dependency on any other internal package.
package store

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5" // registers the "pgx5" scheme used by pgx5URL
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/vndee/tuhoc-api/migrations"
)

// Open creates a pgxpool.Pool for databaseURL and verifies connectivity
// with a Ping before returning. Callers own the returned pool and must
// Close it (main does this via defer; TestPool registers a t.Cleanup).
func Open(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("store: create pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping database: %w", err)
	}

	return pool, nil
}

// MigrateUp applies every pending migration embedded in the migrations
// package (see migrations.FS) to databaseURL, using golang-migrate with
// its pgx v5 database driver. Because the migrations are embedded, the
// binary needs nothing on disk at runtime to migrate itself.
func MigrateUp(databaseURL string) error {
	src, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return fmt.Errorf("store: load embedded migrations: %w", err)
	}

	m, err := migrate.NewWithSourceInstance("iofs", src, pgx5URL(databaseURL))
	if err != nil {
		return fmt.Errorf("store: init migrator: %w", err)
	}
	defer func() {
		// Close returns (source error, database error) independently; both
		// are worth knowing about even though neither should change
		// MigrateUp's own result (the Up() error above, if any, is already
		// the actionable one).
		if srcErr, dbErr := m.Close(); srcErr != nil || dbErr != nil {
			log.Printf("store: close migrator: source=%v database=%v", srcErr, dbErr)
		}
	}()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("store: migrate up: %w", err)
	}

	return nil
}

// pgx5URL rewrites databaseURL's scheme to "pgx5", the scheme under which
// golang-migrate's database/pgx/v5 driver registers itself (see that
// package's init, which calls database.Register("pgx5", ...)).
// migrate.NewWithSourceInstance dispatches to a database driver purely by
// URL scheme, so a plain "postgres://" URL — what DATABASE_URL and
// testcontainers' ConnectionString both hand us — needs this rewrite
// before golang-migrate will find the driver we imported for its side
// effect above. The driver itself converts the scheme back to "postgres"
// internally when it opens the connection, so no other part of the URL
// changes.
func pgx5URL(databaseURL string) string {
	u, err := url.Parse(databaseURL)
	if err != nil {
		// Malformed URLs are caught by NewWithSourceInstance itself; return
		// the original string unchanged so its error still names it.
		return databaseURL
	}
	u.Scheme = "pgx5"
	return u.String()
}

// TestPool spins up a disposable postgres:16-alpine container via
// testcontainers-go, runs MigrateUp against it, and returns a ready
// *pgxpool.Pool. The container and the pool are both torn down
// automatically via t.Cleanup, so callers just call TestPool(t) and use
// the result. This is the shared integration-test helper every backend
// package (auth, sync, stats, and this package's own tests) uses to get a
// real Postgres.
func TestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	ctx := context.Background()

	container, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("tuhoc_test"),
		tcpostgres.WithUsername("tuhoc"),
		tcpostgres.WithPassword("tuhoc"),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("store: start postgres container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(container); err != nil {
			t.Logf("store: terminate postgres container: %v", err)
		}
	})

	databaseURL, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("store: get connection string: %v", err)
	}

	if err := MigrateUp(databaseURL); err != nil {
		t.Fatalf("store: migrate up: %v", err)
	}

	connCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	pool, err := Open(connCtx, databaseURL)
	if err != nil {
		t.Fatalf("store: open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	return pool
}
