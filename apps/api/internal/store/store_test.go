package store

import (
	"context"
	"testing"
)

// TestTestPool_MigratesAndSeedsInitialCourse is the store package's own
// integration test, and doubles as the first exercise of TestPool — the
// helper every later backend package (auth, sync, stats) uses to get a
// migrated, ready-to-query pool in its own tests. It spins up a real
// postgres:16-alpine container, runs MigrateUp against it, and checks that
// the 0001_init seed row (courses: '***REMOVED***') is present.
func TestTestPool_MigratesAndSeedsInitialCourse(t *testing.T) {
	pool := TestPool(t)

	var count int
	err := pool.QueryRow(context.Background(), "SELECT count(*) FROM courses").Scan(&count)
	if err != nil {
		t.Fatalf("query courses count: %v", err)
	}

	if count != 1 {
		t.Fatalf("want 1 seeded course, got %d", count)
	}
}
